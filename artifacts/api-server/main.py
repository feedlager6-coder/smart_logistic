import os
import math
import json
import traceback
import urllib.request
import urllib.parse
import time
import io
import logging
from datetime import date, datetime
from typing import Optional
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

try:
    from ortools.constraint_solver import routing_enums_pb2
    from ortools.constraint_solver import pywrapcp
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False
    logging.warning("OR-Tools not available, using greedy fallback")

try:
    import openpyxl
    OPENPYXL_AVAILABLE = True
except ImportError:
    OPENPYXL_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SmartRoute API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ.get("DATABASE_URL", "")
AVG_SPEED_KMH = 30
TRAFFIC_MULTIPLIER = 1.2
geocode_cache: dict = {}

# ── GraphHopper Matrix API ────────────────────────────────────────────────────

GRAPHHOPPER_API_KEY: str = os.environ.get("GRAPHHOPPER_API_KEY", "")
YANDEX_GEOCODER_API_KEY: str = os.environ.get("YANDEX_GEOCODER_API_KEY", "")
GRAPHHOPPER_FREE_LIMIT = 5           # max locations per single Matrix API request (Free Plan)
GRAPHHOPPER_RATE_LIMIT_TTL = 60      # seconds to suppress GH calls after a 429

# Epoch-seconds timestamp; GH calls are suppressed while time.time() < this value
_gh_rate_limited_until: float = 0.0


def get_matrix_from_graphhopper(coords: list) -> Optional[tuple]:
    """
    Send ONE POST request to the GraphHopper Matrix API and return the full
    distance + time matrix for the given coordinate list.

    Args:
        coords: list of (lat, lon) tuples (any length ≤ GRAPHHOPPER_FREE_LIMIT)

    Returns:
        (distance_matrix, time_matrix) where values are metres / seconds
        respectively, or None on any failure (caller should fall back to
        Haversine transparently).
    """
    global _gh_rate_limited_until

    # Honour the rate-limit cool-down period set by a previous 429
    if time.time() < _gh_rate_limited_until:
        remaining = int(_gh_rate_limited_until - time.time())
        logger.info("GraphHopper still rate-limited (%ds left), using Haversine", remaining)
        return None

    if not coords or len(coords) < 2:
        return None

    # Guard: silently skip if the batch exceeds the Free Plan point limit
    if len(coords) > GRAPHHOPPER_FREE_LIMIT:
        logger.info(
            "GraphHopper: %d coords exceeds free limit %d, using Haversine",
            len(coords), GRAPHHOPPER_FREE_LIMIT,
        )
        return None

    # GraphHopper Matrix API expects [longitude, latitude] order
    gh_points = [[lon, lat] for lat, lon in coords]

    payload = json.dumps({
        "from_points": gh_points,
        "to_points": gh_points,
        "out_arrays": ["distances", "times"],
        "vehicle": "car",
    }).encode("utf-8")

    url = f"https://graphhopper.com/api/1/matrix?key={GRAPHHOPPER_API_KEY}"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        distances = data.get("distances")   # list[list[float]] — metres
        times = data.get("times")           # list[list[float]] — seconds

        if distances and times:
            logger.info(
                "GraphHopper matrix fetched: %dx%d", len(distances), len(distances[0])
            )
            return distances, times

        logger.warning("GraphHopper response missing distances/times: %s", data)

    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            # Rate limit hit — back off and fall through to Haversine seamlessly
            _gh_rate_limited_until = time.time() + GRAPHHOPPER_RATE_LIMIT_TTL
            logger.warning(
                "GraphHopper 429 — switching to Haversine for next %ds",
                GRAPHHOPPER_RATE_LIMIT_TTL,
            )
        else:
            logger.warning("GraphHopper HTTP error %d: %s", exc.code, exc.reason)

    except Exception as exc:
        logger.warning("GraphHopper API call failed: %s", exc)

    return None


def _build_haversine_matrix(coords: list) -> list:
    """Build a full NxN distance matrix (metres) using Haversine."""
    n = len(coords)
    return [[haversine_meters(coords[i], coords[j]) for j in range(n)] for i in range(n)]


def _cluster_by_sweep(store_indices: list, all_coords: list, num_vehicles: int) -> list:
    """
    Partition store node-indices into geographic clusters using the
    polar-angle sweep algorithm (sectors around the depot).

    Each cluster is guaranteed to contain at most GRAPHHOPPER_FREE_LIMIT-1
    stops so that a single GraphHopper Matrix API call (depot + cluster)
    never exceeds the Free Plan limit.  When `num_vehicles` alone would
    produce oversized clusters, the function automatically increases the
    number of clusters and merges extras onto the last vehicle group.

    Returns a list of lists: each sub-list contains the node indices assigned
    to one vehicle.  Indices refer to positions in `all_coords` (0 = depot).
    """
    max_stops_per_cluster = GRAPHHOPPER_FREE_LIMIT - 1  # depot takes one slot
    # Minimum number of clusters needed to keep each ≤ max_stops_per_cluster
    min_clusters = math.ceil(len(store_indices) / max_stops_per_cluster)
    effective_vehicles = max(num_vehicles, min_clusters)

    depot = all_coords[0]

    def angle_from_depot(node_idx):
        lat, lon = all_coords[node_idx]
        return math.atan2(lon - depot[1], lat - depot[0])

    sorted_nodes = sorted(store_indices, key=angle_from_depot)

    # Distribute evenly round-robin across effective_vehicles buckets
    chunks = [[] for _ in range(effective_vehicles)]
    for i, node in enumerate(sorted_nodes):
        chunks[i % effective_vehicles].append(node)

    # If we created more clusters than vehicles, merge extra clusters back into
    # the last num_vehicles bucket so the caller gets exactly num_vehicles routes
    if effective_vehicles > num_vehicles:
        merged = chunks[:num_vehicles]
        for extra in chunks[num_vehicles:]:
            # Append extra stops to the smallest existing bucket
            smallest = min(range(len(merged)), key=lambda k: len(merged[k]))
            # Only merge if it stays within the per-cluster limit
            if len(merged[smallest]) + len(extra) <= max_stops_per_cluster:
                merged[smallest].extend(extra)
            else:
                merged.append(extra)  # keep as separate cluster (extra vehicle)
        chunks = merged

    return [c for c in chunks if c]


def _ortools_solve_group(depot_coord: tuple, group_node_indices: list,
                         group_coords: list, dist_matrix: list) -> list:
    """
    Run OR-Tools VRP on a single vehicle's group of stops using a pre-built
    distance matrix.  Returns the stop nodes in optimised visit order
    (values from group_node_indices, NOT positional indices).
    """
    if not ORTOOLS_AVAILABLE or len(group_node_indices) <= 1:
        return group_node_indices  # nothing to optimise

    n = len(group_coords)  # includes depot at position 0
    manager = pywrapcp.RoutingIndexManager(n, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    int_matrix = [[int(v) for v in row] for row in dist_matrix]

    def dist_cb(from_idx, to_idx):
        return int_matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    transit_idx = routing.RegisterTransitCallback(dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = 5

    solution = routing.SolveWithParameters(params)
    if not solution:
        return group_node_indices  # fallback: return as-is

    ordered = []
    idx = routing.Start(0)
    while not routing.IsEnd(idx):
        node = manager.IndexToNode(idx)
        if node != 0:
            ordered.append(group_node_indices[node - 1])
        idx = solution.Value(routing.NextVar(idx))
    return ordered


def _fallback_distribution(store_nodes: list, num_vehicles: int) -> list:
    """Round-robin split when OR-Tools finds no solution."""
    routes = [[] for _ in range(num_vehicles)]
    for i, node in enumerate(store_nodes):
        routes[i % num_vehicles].append(node)
    return [r for r in routes if r]


def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS stores (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            lat DOUBLE PRECISION,
            lon DOUBLE PRECISION,
            map_url TEXT,
            geocode_status TEXT DEFAULT 'pending',
            time_window_from TEXT DEFAULT '09:00',
            time_window_to TEXT DEFAULT '18:00',
            unload_minutes INTEGER DEFAULT 15,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS route_sessions (
            id SERIAL PRIMARY KEY,
            date TEXT,
            num_vehicles INTEGER,
            total_km DOUBLE PRECISION,
            saved_km DOUBLE PRECISION,
            saved_rub INTEGER,
            num_points INTEGER DEFAULT 0,
            result_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        ALTER TABLE route_sessions ADD COLUMN IF NOT EXISTS result_json TEXT
    """)
    cur.execute("""
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS map_url TEXT
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS route_session_stores (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES route_sessions(id) ON DELETE CASCADE,
            store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
            visit_order INTEGER
        )
    """)
    # Performance indexes
    cur.execute("CREATE INDEX IF NOT EXISTS idx_stores_geocode ON stores(geocode_status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_date ON route_sessions(date DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_session_stores_session ON route_session_stores(session_id)")
    conn.commit()
    cur.close()
    conn.close()


def haversine_meters(c1: tuple, c2: tuple) -> int:
    R = 6371000
    lat1, lon1 = math.radians(c1[0]), math.radians(c1[1])
    lat2, lon2 = math.radians(c2[0]), math.radians(c2[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return int(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def solve_vrp(all_coords: list, num_vehicles: int, capacities=None, demands=None) -> list:
    """
    Solve the Vehicle Routing Problem with a three-tier strategy:

    Tier 1 — Small dataset (≤ GRAPHHOPPER_FREE_LIMIT points total):
        Send ONE GraphHopper Matrix request for the full matrix, then run
        OR-Tools on the precise road distances/times.

    Tier 2 — Large dataset (> GRAPHHOPPER_FREE_LIMIT points):
        a) Pre-cluster stores into `num_vehicles` geographic groups using the
           polar-angle sweep algorithm (Haversine-based, no API calls).
        b) For each cluster (guaranteed ≤ FREE_LIMIT-1 stops), send ONE precise
           GraphHopper Matrix request (depot + cluster stops).
        c) Run OR-Tools on the precise per-cluster matrix to polish the order.

    Tier 3 — Fallback (GraphHopper unavailable / 429 / OR-Tools missing):
        Pure Haversine distance matrix fed into OR-Tools (or simple greedy
        split when OR-Tools is also unavailable).  Activated transparently so
        the user never sees an error.
    """
    n = len(all_coords)
    store_count = n - 1  # node 0 is depot

    if store_count == 0:
        return []

    # ── Tier 3a: no OR-Tools — round-robin fallback ───────────────────────────
    if not ORTOOLS_AVAILABLE:
        return _fallback_distribution(list(range(1, n)), num_vehicles), "haversine"

    # ── Helper: run full OR-Tools VRP on an NxN matrix (all vehicles) ─────────
    def _ortools_full(matrix: list) -> list:
        manager = pywrapcp.RoutingIndexManager(len(matrix), num_vehicles, 0)
        routing = pywrapcp.RoutingModel(manager)

        int_mat = [[int(v) for v in row] for row in matrix]

        def dist_cb(fi, ti):
            return int_mat[manager.IndexToNode(fi)][manager.IndexToNode(ti)]

        transit_idx = routing.RegisterTransitCallback(dist_cb)
        routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

        # ── Workload balancing: penalise gap between shortest and longest route ──
        # This forces OR-Tools to spread stops more evenly across vehicles
        # instead of leaving some idle while one vehicle takes all the work.
        routing.AddDimension(transit_idx, 0, 10_000_000, True, "Distance")
        distance_dim = routing.GetDimensionOrDie("Distance")
        distance_dim.SetGlobalSpanCostCoefficient(100)

        if capacities and demands and len(capacities) == num_vehicles:
            def demand_cb(fi):
                node = manager.IndexToNode(fi)
                return demands[node] if 0 < node < len(demands) else 0
            demand_idx = routing.RegisterUnaryTransitCallback(demand_cb)
            routing.AddDimensionWithVehicleCapacity(demand_idx, 0, capacities, True, "Capacity")

        params = pywrapcp.DefaultRoutingSearchParameters()
        params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
        params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
        # Adaptive time limit based on problem size
        n_nodes = len(matrix)
        if n_nodes > 20:
            params.time_limit.seconds = 30
        elif n_nodes > 10:
            params.time_limit.seconds = 15
        else:
            params.time_limit.seconds = 10

        try:
            sol = routing.SolveWithParameters(params)
        except Exception as e:
            logger.error("OR-Tools solve error: %s", e, exc_info=True)
            sol = None

        result = []
        if sol:
            for v in range(num_vehicles):
                route = []
                idx = routing.Start(v)
                while not routing.IsEnd(idx):
                    node = manager.IndexToNode(idx)
                    if node != 0:
                        route.append(node)
                    idx = sol.Value(routing.NextVar(idx))
                if route:
                    result.append(route)
        if not result:
            # Fallback: round-robin distribution across vehicles
            result = _fallback_distribution(list(range(1, len(matrix))), num_vehicles)
        return result

    # ── Tier 1: small dataset — one GraphHopper call for the whole matrix ─────
    if store_count < GRAPHHOPPER_FREE_LIMIT:
        gh_result = get_matrix_from_graphhopper(all_coords)
        if gh_result:
            dist_matrix, _time_matrix = gh_result
            logger.info("Tier 1: GraphHopper full matrix used (%d nodes)", n)
            return _ortools_full(dist_matrix), "graphhopper"

        # GraphHopper unavailable / rate-limited — fall back to Haversine
        logger.info("Tier 1 fallback: Haversine matrix (%d nodes)", n)
        return _ortools_full(_build_haversine_matrix(all_coords)), "haversine"

    # ── Tier 2: large dataset — sweep cluster → per-cluster GraphHopper ───────
    logger.info(
        "Tier 2: %d stores > limit %d — sweep clustering into %d vehicles",
        store_count, GRAPHHOPPER_FREE_LIMIT - 1, num_vehicles,
    )

    all_store_nodes = list(range(1, n))
    clusters = _cluster_by_sweep(all_store_nodes, all_coords, num_vehicles)

    routes = []
    gh_used = False
    for cluster_nodes in clusters:
        # Build coordinate list: depot first, then this cluster's stores
        group_coords = [all_coords[0]] + [all_coords[node] for node in cluster_nodes]

        # Attempt precise GraphHopper call for this cluster (≤ FREE_LIMIT pts)
        gh_result = get_matrix_from_graphhopper(group_coords)

        if gh_result:
            dist_matrix, _time_matrix = gh_result
            gh_used = True
            logger.info(
                "Tier 2 cluster: GraphHopper matrix used (%d nodes)", len(group_coords)
            )
        else:
            # 429 or network error — seamlessly fall back to Haversine
            logger.info(
                "Tier 2 cluster fallback: Haversine matrix (%d nodes)", len(group_coords)
            )
            dist_matrix = _build_haversine_matrix(group_coords)

        # Polish the order within this cluster using OR-Tools (single vehicle)
        ordered_local = _ortools_solve_group(
            all_coords[0], cluster_nodes, group_coords, dist_matrix
        )
        if ordered_local:
            routes.append(ordered_local)

    return routes, "graphhopper" if gh_used else "haversine"


def geocode_address_yandex(address: str) -> Optional[tuple]:
    """
    Geocode using Yandex Geocoder API (primary, no rate-limit delay needed).
    Returns (lat, lon) or None if unavailable / API key not configured.
    """
    if not YANDEX_GEOCODER_API_KEY:
        return None
    try:
        url = (
            "https://geocode-maps.yandex.ru/1.x/?"
            f"geocode={urllib.parse.quote(address)}"
            "&format=json"
            f"&apikey={YANDEX_GEOCODER_API_KEY}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "smartroute-app-1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        members = data["response"]["GeoObjectCollection"]["featureMember"]
        if members:
            pos = members[0]["GeoObject"]["Point"]["pos"]
            lon_str, lat_str = pos.split()
            return (float(lat_str), float(lon_str))
    except Exception as e:
        logger.warning(f"Yandex geocoding failed for '{address}': {e}")
    return None


def geocode_address_nominatim(address: str) -> Optional[tuple]:
    """Geocode using Nominatim (fallback, 1 req/sec limit)."""
    try:
        url = (
            "https://nominatim.openstreetmap.org/search?"
            f"q={urllib.parse.quote(address)}"
            "&format=json&limit=1&accept-language=ru"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "smartroute-app-1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data:
            return (float(data[0]["lat"]), float(data[0]["lon"]))
    except Exception as e:
        logger.warning(f"Nominatim geocoding failed for '{address}': {e}")
    return None


def geocode_address(address: str) -> Optional[tuple]:
    """
    Geocode an address, trying Yandex Geocoder first (fast, no rate limit),
    then falling back to Nominatim.  Results are cached in-memory.
    """
    cache_key = address.strip().lower()
    if cache_key in geocode_cache:
        return geocode_cache[cache_key]

    # ── Primary: Yandex Geocoder ──────────────────────────────────────────────
    result = geocode_address_yandex(address)

    # ── Fallback: Nominatim ───────────────────────────────────────────────────
    if result is None:
        result = geocode_address_nominatim(address)

    geocode_cache[cache_key] = result
    return result


def parse_yandex_link(url: str) -> tuple:
    """
    Extract (lat, lon) from various Yandex Maps URL formats.
    Returns (None, None) if extraction fails.
    """
    from urllib.parse import urlparse, parse_qs, unquote
    try:
        decoded = unquote(url)
        parsed = urlparse(decoded)
        params = parse_qs(parsed.query)

        # Format: whatshere[point]=lon,lat
        if "whatshere[point]" in params:
            lon_s, lat_s = params["whatshere[point]"][0].split(",")
            return float(lat_s), float(lon_s)

        # Format: ll=lon,lat (map centre)
        if "ll" in params:
            lon_s, lat_s = params["ll"][0].split(",")
            return float(lat_s), float(lon_s)

        # Format: rtext=lat,lon~lat,lon (route first point)
        if "rtext" in params:
            parts = params["rtext"][0].split("~")[0].split(",")
            if len(parts) >= 2:
                return float(parts[0]), float(parts[1])

        # Short links (/-/) — follow redirect
        if "/-/" in url or "maps.yandex" in url:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0"}, method="GET"
            )
            opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
            response = opener.open(req, timeout=10)
            final_url = response.geturl()
            if final_url != url:
                return parse_yandex_link(final_url)

        return None, None
    except Exception as e:
        logger.error("parse_yandex_link error for '%s': %s", url, e)
        return None, None


def reverse_geocode_nominatim(lat: float, lon: float) -> Optional[str]:
    """Get a human-readable address from coordinates using Nominatim."""
    try:
        url = (
            "https://nominatim.openstreetmap.org/reverse?"
            f"lat={lat}&lon={lon}&format=json&accept-language=ru"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "smartroute-app-1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        addr = data.get("address", {})
        road = addr.get("road", "")
        house = addr.get("house_number", "")
        city = addr.get("city") or addr.get("town") or addr.get("village") or ""
        parts = [p for p in [city, road, house] if p]
        return ", ".join(parts) if parts else data.get("display_name", "")
    except Exception as e:
        logger.warning("reverse_geocode_nominatim error: %s", e)
        return None


def calculate_savings(optimized_km: float, num_points: int, num_vehicles: int) -> dict:
    unoptimized_km = optimized_km * 1.3
    saved_km = unoptimized_km - optimized_km
    cost_per_km = 12
    saved_rub_day = round(saved_km * cost_per_km)
    saved_rub_month = saved_rub_day * 30
    return {
        "optimized_km": round(optimized_km, 1),
        "unoptimized_km": round(unoptimized_km, 1),
        "saved_km": round(saved_km, 1),
        "saved_rub_day": saved_rub_day,
        "saved_rub_month": saved_rub_month,
    }


def yandex_nav_url(coords_list: list) -> str:
    points = "~".join(f"{lat},{lon}" for lat, lon in coords_list)
    return f"https://yandex.ru/maps/?rtext={points}&rtt=auto"


def whatsapp_url(vehicle_name: str, stores: list, total_km: float, yandex_url: str) -> str:
    lines = [f"🚗 {vehicle_name} — маршрут на {total_km:.1f} км:"]
    for i, s in enumerate(stores, 1):
        lines.append(f"{i}. {s['store_name']} — {s['address']}")
    lines.append(f"🗺 Навигатор: {yandex_url}")
    text = "\n".join(lines)
    return f"https://wa.me/?text={urllib.parse.quote(text)}"


def store_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "address": row["address"],
        "lat": row["lat"],
        "lon": row["lon"],
        "map_url": row.get("map_url"),
        "geocode_status": row["geocode_status"] or "pending",
        "time_window_from": row["time_window_from"] or "09:00",
        "time_window_to": row["time_window_to"] or "18:00",
        "unload_minutes": row["unload_minutes"] or 15,
        "created_at": str(row["created_at"]) if row["created_at"] else None,
    }


# ── Pydantic models ──────────────────────────────────────────────────────────

class StoreInput(BaseModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    yandex_url: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    map_url: Optional[str] = None
    time_window_from: Optional[str] = "09:00"
    time_window_to: Optional[str] = "18:00"
    unload_minutes: Optional[int] = 15


class StoreUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    yandex_url: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    map_url: Optional[str] = None
    time_window_from: Optional[str] = None
    time_window_to: Optional[str] = None
    unload_minutes: Optional[int] = None


class VehicleInput(BaseModel):
    name: str
    capacity_kg: Optional[int] = None
    average_speed: Optional[float] = None


class RouteRequest(BaseModel):
    store_ids: list[int]
    vehicles: list[VehicleInput]
    depot_lat: Optional[float] = None
    depot_lon: Optional[float] = None
    use_time_windows: Optional[bool] = False
    use_unload_time: Optional[bool] = False


# ── Routes ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    if not GRAPHHOPPER_API_KEY:
        logger.warning(
            "GRAPHHOPPER_API_KEY not set — GraphHopper Matrix API disabled, Haversine will be used"
        )
    if not YANDEX_GEOCODER_API_KEY:
        logger.warning(
            "YANDEX_GEOCODER_API_KEY not set — Yandex Geocoder disabled, falling back to Nominatim"
        )
    init_db()
    seed_demo_data()


def seed_demo_data():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT COUNT(*) as cnt FROM stores")
    row = cur.fetchone()
    if row["cnt"] > 0:
        cur.close()
        conn.close()
        return

    demo_stores = [
        ("Магазин Пятёрочка #1", "Москва, ул. Ленина, 5", 55.7558, 37.6173, "found"),
        ("Магазин Магнит #2", "Москва, ул. Гагарина, 12", 55.7488, 37.6051, "found"),
        ("Перекрёсток Центр", "Москва, ул. Тверская, 3", 55.7619, 37.6156, "found"),
        ("ВкусВилл Арбат", "Москва, ул. Арбат, 44", 55.7507, 37.5929, "found"),
        ("Дикси Юго-Запад", "Москва, пр. Вернадского, 18", 55.7037, 37.5543, "found"),
        ("Ашан Каширское", "Москва, ш. Каширское, 24", 55.6494, 37.6667, "found"),
        ("Лента Бутово", "Москва, ул. Бутово, 9", 55.5537, 37.5865, "found"),
        ("Метро Марьино", "Москва, ул. Люблинская, 80", 55.6524, 37.7400, "found"),
    ]

    for name, address, lat, lon, status in demo_stores:
        cur.execute(
            """INSERT INTO stores (name, address, lat, lon, geocode_status, time_window_from, time_window_to, unload_minutes)
               VALUES (%s, %s, %s, %s, %s, '09:00', '18:00', 15)""",
            (name, address, lat, lon, status)
        )

    # Seed some historical route sessions
    today = date.today()
    for i in range(14):
        d = today.replace(day=max(1, today.day - i))
        total_km = 80 + (i * 7) % 40
        saved_km = total_km * 0.23
        cur.execute(
            """INSERT INTO route_sessions (date, num_vehicles, total_km, saved_km, saved_rub, num_points)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (str(d), 2 + i % 3, round(total_km, 1), round(saved_km, 1), round(saved_km * 12), 8 + i % 6)
        )

    conn.commit()
    cur.close()
    conn.close()


@app.get("/api/healthz")
def health_check():
    return {"status": "ok"}


@app.get("/api/stores")
def list_stores():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM stores ORDER BY id")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [store_row_to_dict(r) for r in rows]


@app.post("/api/stores", status_code=201)
def create_store(body: StoreInput):
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=422, detail="Название магазина не может быть пустым")
    if not body.yandex_url and not body.address and not body.city and body.lat is None:
        raise HTTPException(status_code=422, detail="Укажите ссылку из Яндекс Карт или адрес")
    if body.lat is not None and not (-90 <= body.lat <= 90):
        raise HTTPException(status_code=422, detail="Широта должна быть от -90 до 90")
    if body.lon is not None and not (-180 <= body.lon <= 180):
        raise HTTPException(status_code=422, detail="Долгота должна быть от -180 до 180")

    raw_address = (body.address or "").strip()
    city = (body.city or "").strip()
    geocode_query = f"{city} {raw_address}".strip() if city and city not in raw_address else raw_address

    lat, lon, status = None, None, "not_found"
    address = raw_address or city

    # Priority 1: explicit lat/lon
    if body.lat is not None and body.lon is not None:
        lat, lon, status = body.lat, body.lon, "found"

    # Priority 2: parse Yandex Maps URL
    elif body.yandex_url:
        lat, lon = parse_yandex_link(body.yandex_url)
        if lat is not None and lon is not None:
            status = "found"
            if not address:
                address = reverse_geocode_nominatim(lat, lon) or body.yandex_url
            logger.info("create_store: coords from yandex_url → (%.5f, %.5f)", lat, lon)
        elif geocode_query:
            coords = geocode_address(geocode_query)
            lat = coords[0] if coords else None
            lon = coords[1] if coords else None
            status = "found" if coords else "not_found"
            logger.info("create_store: yandex_url parse failed, geocoded '%s' → %s", geocode_query, status)

    # Priority 3: geocode address
    elif geocode_query:
        coords = geocode_address(geocode_query)
        lat = coords[0] if coords else None
        lon = coords[1] if coords else None
        status = "found" if coords else "not_found"
        logger.info("create_store: geocoded '%s' → %s", geocode_query, status)

    if not address:
        address = geocode_query or body.yandex_url or "Адрес не указан"

    # Store yandex_url as map_url if no explicit map_url provided
    map_url = body.map_url or body.yandex_url

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """INSERT INTO stores (name, address, lat, lon, map_url, geocode_status, time_window_from, time_window_to, unload_minutes)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (body.name.strip(), address, lat, lon, map_url,
         status, body.time_window_from, body.time_window_to, body.unload_minutes)
    )
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return store_row_to_dict(row)


@app.get("/api/geocode")
def geocode_endpoint(address: Optional[str] = None, yandex_url: Optional[str] = None):
    """Geocode an address or parse a Yandex Maps URL. Returns {lat, lon, display}."""
    if yandex_url and yandex_url.strip():
        lat, lon = parse_yandex_link(yandex_url.strip())
        if lat is not None and lon is not None:
            display = reverse_geocode_nominatim(lat, lon) or yandex_url.strip()
            return {"lat": lat, "lon": lon, "display": display}
        raise HTTPException(status_code=422, detail="Не удалось извлечь координаты из ссылки Яндекс Карт")
    if address and address.strip():
        result = geocode_address(address.strip())
        if result:
            lat, lon = result
            return {"lat": lat, "lon": lon, "display": address.strip()}
        raise HTTPException(status_code=404, detail="Адрес не найден. Попробуйте уточнить запрос.")
    raise HTTPException(status_code=400, detail="Укажите параметр address или yandex_url")


@app.get("/api/stores/template")
def download_stores_template():
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    from openpyxl.styles import Font, PatternFill, Alignment, PatternFill
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Магазины"

    # 7-column simplified template
    headers = [
        "Название",         # A — required
        "Ссылка Яндекс",    # B — recommended (coords parsed automatically)
        "Адрес",            # C — if no Yandex link
        "Город",            # D — optional, prepended to address
        "Разгрузка мин",    # E — optional
        "Время с",          # F — optional
        "Время до",         # G — optional
    ]
    ws.append(headers)

    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    # Example row 1: with Yandex URL
    ws.append([
        "Магазин Пятёрочка",
        "https://yandex.ru/maps/?whatshere[point]=37.617635,55.755814",
        "",
        "",
        15, "09:00", "18:00",
    ])
    # Example row 2: with address + city
    ws.append([
        "Магазин Магнит",
        "",
        "ул. Гагарина 12",
        "Москва",
        20, "10:00", "17:00",
    ])

    col_widths = [28, 52, 36, 16, 16, 12, 12]
    for i, width in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width

    # Hint row (skipped on import — starts with ←)
    note_row = [
        "← Название магазина",
        "← Ссылка из Яндекс: зажми место → Поделиться",
        "← Адрес если нет ссылки",
        "← Город",
        "← Минут (число)",
        "← ЧЧ:ММ",
        "← ЧЧ:ММ",
    ]
    ws.append(note_row)
    for col_num in range(1, len(note_row) + 1):
        cell = ws.cell(row=ws.max_row, column=col_num)
        cell.font = Font(italic=True, color="888888")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    content = buf.read()

    import base64
    return {
        "data": base64.b64encode(content).decode("ascii"),
        "filename": "smartroute_template.xlsx",
    }


@app.post("/api/stores/import")
async def import_stores(file: UploadFile = File(...)):
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    content = await file.read()
    wb = openpyxl.load_workbook(io.BytesIO(content))
    ws = wb.active

    # Read header row to detect column layout
    header_row = [str(c).strip().lower() if c else "" for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True), [])]

    # Map header names → column indices (0-based)
    def _col(candidates: list) -> Optional[int]:
        for name in candidates:
            for i, h in enumerate(header_row):
                if name in h:
                    return i
        return None

    c_name    = _col(["назван", "name", "store_name"])
    c_yandex  = _col(["ссылка яндекс", "яндекс", "yandex", "ссылка"])
    c_address = _col(["адрес", "address"])
    c_city    = _col(["город", "city"])
    c_lat     = _col(["широта", "lat", "latitude"])
    c_lon     = _col(["долгота", "lon", "longitude"])
    c_mapurl  = _col(["map_url", "ссылка на карт"])
    c_unload  = _col(["разгрузка", "unload"])
    c_from    = _col(["время с", "open_time", "с (", "time_from"])
    c_to      = _col(["время до", "close_time", "до (", "time_to"])

    # Fall back to positional mapping for old-format files (5-column):
    # Col0=name, Col1=address, Col2=tw_from, Col3=tw_to, Col4=unload
    if c_name is None:
        c_name = 0
    if c_address is None and c_yandex is None:
        c_address = 1

    def _get(row, idx, default=""):
        if idx is None or idx >= len(row):
            return default
        val = row[idx]
        return val if val is not None else default

    imported = 0
    failed = 0
    stores = []
    # Skip header row and any trailing note rows (those with col A starting with ←)
    all_data_rows = [
        r for r in ws.iter_rows(min_row=2, values_only=True)
        if r and r[0] and not str(r[0]).strip().startswith("←")
    ]
    total_rows = len(all_data_rows)
    logger.info("Excel import: %d data rows found (headers: %s)", total_rows, header_row)

    for i, row in enumerate(all_data_rows, start=1):
        name       = str(_get(row, c_name, "")).strip()
        yandex_url = str(_get(row, c_yandex, "")).strip() or None
        city       = str(_get(row, c_city, "")).strip()
        raw_addr   = str(_get(row, c_address, "")).strip()

        # Combine city + address
        if city and city not in raw_addr:
            address = f"{raw_addr}, {city}" if raw_addr else city
        else:
            address = raw_addr

        if not name or (not yandex_url and not address):
            logger.warning("Import row %d skipped: missing name or location", i)
            failed += 1
            continue

        # Parse optional lat/lon columns
        raw_lat = _get(row, c_lat)
        raw_lon = _get(row, c_lon)
        map_url = str(_get(row, c_mapurl, "")).strip() or None

        # Parse time window
        if c_from is None and len(row) > 2 and row[2] and ":" in str(row[2]):
            tw_from = str(row[2]).strip()
            tw_to   = str(row[3]).strip() if len(row) > 3 and row[3] else "18:00"
            unload  = int(row[4]) if len(row) > 4 and row[4] else 15
        else:
            tw_from = str(_get(row, c_from, "09:00")).strip() or "09:00"
            tw_to   = str(_get(row, c_to,   "18:00")).strip() or "18:00"
            try:
                unload = int(_get(row, c_unload, 15))
            except (ValueError, TypeError):
                unload = 15

        # ── Coord resolution (priority order) ────────────────────────────────
        lat, lon, status = None, None, "not_found"

        # 1. Explicit lat/lon columns
        try:
            prov_lat = float(raw_lat) if raw_lat not in (None, "", "None") else None
            prov_lon = float(raw_lon) if raw_lon not in (None, "", "None") else None
        except (ValueError, TypeError):
            prov_lat = prov_lon = None

        if prov_lat is not None and prov_lon is not None and (-90 <= prov_lat <= 90) and (-180 <= prov_lon <= 180):
            lat, lon, status = prov_lat, prov_lon, "found"
            logger.info("Import %d/%d — %s → explicit coords (%.4f, %.4f)", i, total_rows, name, lat, lon)

        # 2. Parse Yandex URL
        elif yandex_url:
            lat, lon = parse_yandex_link(yandex_url)
            if lat is not None and lon is not None:
                status = "found"
                if not address:
                    address = reverse_geocode_nominatim(lat, lon) or yandex_url
                logger.info("Import %d/%d — %s → yandex_url (%.4f, %.4f)", i, total_rows, name, lat, lon)
            elif address:
                coords = geocode_address(address)
                lat = coords[0] if coords else None
                lon = coords[1] if coords else None
                status = "found" if coords else "not_found"
                if not YANDEX_GEOCODER_API_KEY:
                    time.sleep(1.1)
                logger.info("Import %d/%d — %s → geocoded (yandex failed) → %s", i, total_rows, name, status)

        # 3. Geocode address
        elif address:
            coords = geocode_address(address)
            lat = coords[0] if coords else None
            lon = coords[1] if coords else None
            status = "found" if coords else "not_found"
            logger.info("Import %d/%d — %s → geocoded '%s' → %s", i, total_rows, name, address, status)
            if not YANDEX_GEOCODER_API_KEY:
                time.sleep(1.1)

        if not address:
            address = yandex_url or "Адрес не указан"

        final_map_url = map_url or yandex_url

        try:
            conn = get_db()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                """INSERT INTO stores (name, address, lat, lon, map_url, geocode_status, time_window_from, time_window_to, unload_minutes)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (name, address, lat, lon, final_map_url, status, tw_from, tw_to, unload)
            )
            db_row = cur.fetchone()
            conn.commit()
            cur.close()
            conn.close()
            stores.append(store_row_to_dict(db_row))
            imported += 1
        except Exception as e:
            logger.error(f"Failed to insert store row {i}: {e}")
            failed += 1

    return {"total": imported + failed, "imported": imported, "failed": failed, "stores": stores}


@app.get("/api/stores/{id}")
def get_store(id: int):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM stores WHERE id = %s", (id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Store not found")
    return store_row_to_dict(row)


@app.put("/api/stores/{id}")
def update_store(id: int, body: StoreUpdate):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM stores WHERE id = %s", (id,))
    existing = cur.fetchone()
    if not existing:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Store not found")

    fields = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.address is not None:
        fields["address"] = body.address
        # Re-geocode if address changed
        coords = geocode_address(body.address)
        if coords:
            fields["lat"] = coords[0]
            fields["lon"] = coords[1]
            fields["geocode_status"] = "found"
        else:
            fields["lat"] = None
            fields["lon"] = None
            fields["geocode_status"] = "not_found"
    if body.lat is not None:
        fields["lat"] = body.lat
    if body.lon is not None:
        fields["lon"] = body.lon
    if body.time_window_from is not None:
        fields["time_window_from"] = body.time_window_from
    if body.time_window_to is not None:
        fields["time_window_to"] = body.time_window_to
    if body.unload_minutes is not None:
        fields["unload_minutes"] = body.unload_minutes

    if fields:
        set_clause = ", ".join(f"{k} = %s" for k in fields)
        values = list(fields.values()) + [id]
        cur.execute(f"UPDATE stores SET {set_clause} WHERE id = %s RETURNING *", values)
        row = cur.fetchone()
        conn.commit()
    else:
        row = existing

    cur.close()
    conn.close()
    return store_row_to_dict(row)


@app.delete("/api/stores/{id}", status_code=204)
def delete_store(id: int):
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM stores WHERE id = %s", (id,))
    conn.commit()
    cur.close()
    conn.close()


@app.post("/api/stores/{id}/geocode")
def geocode_store(id: int):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM stores WHERE id = %s", (id,))
    store = cur.fetchone()
    if not store:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Store not found")

    coords = geocode_address(store["address"])
    lat = coords[0] if coords else None
    lon = coords[1] if coords else None
    status = "found" if coords else "not_found"

    cur.execute(
        "UPDATE stores SET lat = %s, lon = %s, geocode_status = %s WHERE id = %s RETURNING *",
        (lat, lon, status, id)
    )
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return store_row_to_dict(row)


@app.post("/api/route/build")
def build_route(body: RouteRequest):
    if not body.store_ids:
        raise HTTPException(status_code=400, detail="No stores selected")
    if not body.vehicles:
        raise HTTPException(status_code=400, detail="No vehicles provided")

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    placeholders = ",".join(["%s"] * len(body.store_ids))
    cur.execute(f"SELECT * FROM stores WHERE id IN ({placeholders})", body.store_ids)
    stores_rows = {r["id"]: r for r in cur.fetchall()}
    cur.close()
    conn.close()

    # Depot coordinates
    depot_lat = body.depot_lat or 55.7558
    depot_lon = body.depot_lon or 37.6173

    # Build coordinate list: depot first, then stores
    store_list = [stores_rows[sid] for sid in body.store_ids if sid in stores_rows and stores_rows[sid]["lat"]]
    if not store_list:
        raise HTTPException(status_code=400, detail="No geocoded stores found")

    all_coords = [(depot_lat, depot_lon)] + [(s["lat"], s["lon"]) for s in store_list]
    num_vehicles = len(body.vehicles)

    capacities = None
    demands = None
    if any(v.capacity_kg for v in body.vehicles):
        capacities = [int(v.capacity_kg) if v.capacity_kg else 99999 for v in body.vehicles]
        demands = [0] + [1] * len(store_list)  # 1 unit per store

    logger.info(
        "solve_vrp: %d stores, %d vehicles, capacities=%s",
        len(store_list), num_vehicles, capacities,
    )

    try:
        vehicle_routes_indices, matrix_source = solve_vrp(all_coords, num_vehicles, capacities, demands)
    except Exception as vrp_exc:
        logger.error("solve_vrp failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"VRP solver error: {vrp_exc}")

    logger.info("solve_vrp result: %s routes", len(vehicle_routes_indices))

    # Build result
    routes = []
    total_km = 0.0

    for vi, vehicle in enumerate(body.vehicles):
        if vi >= len(vehicle_routes_indices):
            break
        route_indices = vehicle_routes_indices[vi]
        if not route_indices:
            continue

        ROUTE_START_MINUTES = 9 * 60  # 09:00 departure from depot
        route_stores = []
        route_coords = [(depot_lat, depot_lon)]
        dist_m = 0
        cumulative_min = 0  # elapsed minutes since 09:00
        prev_coord = (depot_lat, depot_lon)

        for order, idx in enumerate(route_indices, 1):
            store_idx = idx - 1  # node 0 = depot, node i = store_list[i-1]
            if store_idx < 0 or store_idx >= len(store_list):
                logger.warning("VRP returned out-of-range node %d (store_list len=%d) — skipping", idx, len(store_list))
                continue
            store = store_list[store_idx]
            curr_coord = (store["lat"], store["lon"])

            # Drive time from previous point
            leg_m = haversine_meters(prev_coord, curr_coord)
            dist_m += leg_m
            effective_speed = vehicle.average_speed if vehicle.average_speed else (AVG_SPEED_KMH * TRAFFIC_MULTIPLIER)
            leg_drive_min = max(1, int(leg_m / 1000 / effective_speed * 60))
            cumulative_min += leg_drive_min

            # Estimated arrival time at this stop
            abs_min = ROUTE_START_MINUTES + cumulative_min
            arrive_hour = (abs_min // 60) % 24
            arrive_min_part = abs_min % 60
            arrive_by = f"{arrive_hour:02d}:{arrive_min_part:02d}"

            route_coords.append(curr_coord)
            route_stores.append({
                "order": order,
                "store_id": store["id"],
                "store_name": store["name"],
                "address": store["address"],
                "lat": store["lat"],
                "lon": store["lon"],
                "arrive_by": arrive_by,
            })

            # Add unload time before driving to the next stop
            if body.use_unload_time:
                cumulative_min += store.get("unload_minutes", 15)

            prev_coord = curr_coord

        # Return to depot distance
        if len(route_coords) > 1:
            dist_m += haversine_meters(route_coords[-1], (depot_lat, depot_lon))

        km = dist_m / 1000.0
        total_km += km

        unload_min = sum(s["unload_minutes"] for s in store_list if s["id"] in [rs["store_id"] for rs in route_stores]) if body.use_unload_time else 0
        eff_spd = vehicle.average_speed if vehicle.average_speed else (AVG_SPEED_KMH * TRAFFIC_MULTIPLIER)
        drive_min = int(km / eff_spd * 60)
        est_minutes = drive_min + unload_min

        nav_coords = route_coords[1:]  # exclude depot for nav
        yurl = yandex_nav_url(nav_coords) if nav_coords else ""
        wurl = whatsapp_url(vehicle.name, route_stores, km, yurl)

        routes.append({
            "vehicle_name": vehicle.name,
            "stores": route_stores,
            "total_km": round(km, 1),
            "estimated_minutes": est_minutes,
            "yandex_url": yurl,
            "whatsapp_url": wurl,
        })

    savings = calculate_savings(total_km, len(store_list), num_vehicles)

    result = {
        "routes": routes,
        "savings": savings,
        "total_km": round(total_km, 1),
        "matrix_source": matrix_source,
        "geocoder_used": "yandex" if YANDEX_GEOCODER_API_KEY else "nominatim",
        "session_id": None,
    }

    # Save session to DB
    try:
        conn2 = get_db()
        cur2 = conn2.cursor()
        cur2.execute(
            """INSERT INTO route_sessions (date, num_vehicles, total_km, saved_km, saved_rub, num_points, result_json)
               VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (str(date.today()), num_vehicles, round(total_km, 1),
             savings["saved_km"], savings["saved_rub_day"], len(store_list),
             json.dumps(result))
        )
        session_id = cur2.fetchone()[0]
        result["session_id"] = session_id
        cur2.execute("UPDATE route_sessions SET result_json = %s WHERE id = %s",
                     (json.dumps(result), session_id))
        for rs in routes:
            for stop in rs["stores"]:
                cur2.execute(
                    "INSERT INTO route_session_stores (session_id, store_id, visit_order) VALUES (%s, %s, %s)",
                    (session_id, stop["store_id"], stop["order"])
                )
        conn2.commit()
        cur2.close()
        conn2.close()
    except Exception as e:
        logger.error(f"Failed to save route session: {e}")

    return result


@app.get("/api/route/sessions/{id}")
def get_route_session(id: int):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT result_json FROM route_sessions WHERE id = %s", (id,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row or not row["result_json"]:
        raise HTTPException(status_code=404, detail="Route session not found")
    return json.loads(row["result_json"])


@app.get("/api/analytics/summary")
def get_analytics_summary():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            COUNT(*) as total_routes,
            COALESCE(SUM(total_km), 0) as total_km,
            COALESCE(SUM(saved_km), 0) as saved_km,
            COALESCE(SUM(saved_rub), 0) as saved_rub,
            COALESCE(AVG(num_points), 0) as avg_points_per_route
        FROM route_sessions
    """)
    row = cur.fetchone()
    cur.close()
    conn.close()
    return {
        "total_routes": row["total_routes"] or 0,
        "total_km": round(float(row["total_km"] or 0), 1),
        "saved_km": round(float(row["saved_km"] or 0), 1),
        "saved_rub": int(row["saved_rub"] or 0),
        "avg_points_per_route": round(float(row["avg_points_per_route"] or 0), 1),
    }


@app.get("/api/analytics/daily")
def get_analytics_daily():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            date,
            COUNT(*) as routes,
            COALESCE(SUM(total_km), 0) as total_km,
            COALESCE(SUM(saved_km), 0) as saved_km,
            COALESCE(SUM(saved_rub), 0) as saved_rub
        FROM route_sessions
        WHERE date >= (CURRENT_DATE - INTERVAL '30 days')::TEXT
        GROUP BY date
        ORDER BY date
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "date": r["date"],
            "routes": r["routes"],
            "total_km": round(float(r["total_km"]), 1),
            "saved_km": round(float(r["saved_km"]), 1),
            "saved_rub": int(r["saved_rub"]),
        }
        for r in rows
    ]


@app.get("/api/analytics/monthly")
def get_analytics_monthly():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            TO_CHAR(created_at, 'YYYY-MM') as month,
            COUNT(*) as routes,
            COALESCE(SUM(total_km), 0) as total_km,
            COALESCE(SUM(saved_rub), 0) as saved_rub
        FROM route_sessions
        WHERE created_at >= NOW() - INTERVAL '12 months'
        GROUP BY month
        ORDER BY month
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "month": r["month"],
            "routes": r["routes"],
            "total_km": round(float(r["total_km"]), 1),
            "saved_rub": int(r["saved_rub"]),
        }
        for r in rows
    ]


@app.get("/api/analytics/top-stores")
def get_top_stores():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            s.id as store_id,
            s.name as store_name,
            COUNT(rss.id) as visit_count
        FROM stores s
        LEFT JOIN route_session_stores rss ON rss.store_id = s.id
        GROUP BY s.id, s.name
        ORDER BY visit_count DESC
        LIMIT 10
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "store_id": r["store_id"],
            "store_name": r["store_name"],
            "visit_count": r["visit_count"],
        }
        for r in rows
    ]


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
