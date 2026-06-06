import os
import math
import json
import traceback
import urllib.request
import urllib.parse
import time
import io
import logging
import threading
import concurrent.futures
import uuid as _uuid
from datetime import date, datetime, timedelta
from typing import Optional
import secrets
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, UploadFile, File, Query, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import jwt, JWTError

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

# ALLOWED_ORIGINS env var — comma-separated list of allowed origins.
# Default "*" works for single-service deployments where frontend and backend
# share the same Railway domain. Restrict to your domain for production:
#   ALLOWED_ORIGINS=https://smartroute.up.railway.app
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "*")
_ALLOWED_ORIGINS: list = (
    ["*"] if _raw_origins.strip() == "*"
    else [o.strip() for o in _raw_origins.split(",") if o.strip()]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATABASE_URL = os.environ.get("DATABASE_URL", "")

# ── JWT / Auth ────────────────────────────────────────────────────────────────
_JWT_SECRET_ENV = os.environ.get("JWT_SECRET", "")
if not _JWT_SECRET_ENV:
    _JWT_SECRET_ENV = secrets.token_hex(32)
    logging.warning(
        "JWT_SECRET env var is not set — using a random secret. "
        "All sessions will be invalidated on server restart. "
        "Set JWT_SECRET in production for persistent sessions."
    )
JWT_SECRET: str = _JWT_SECRET_ENV
JWT_ALGORITHM: str = "HS256"
JWT_TOKEN_TTL_HOURS: int = int(os.environ.get("JWT_TOKEN_TTL_HOURS", "24"))
JWT_COOKIE_NAME: str = "smartroute_token"
COOKIE_SECURE: bool = os.environ.get("COOKIE_SECURE", "").lower() in ("1", "true", "yes")

# passlib is imported but NOT used for bcrypt — direct bcrypt calls avoid the
# bcrypt≥4.0 passlib incompatibility (missing __about__.__version__).
# CryptContext left in place only so the import doesn't break; never call it.

ADMIN_PASSWORD: str = os.environ.get("ADMIN_PASSWORD", "")

# Paths that do NOT require authentication
_AUTH_PUBLIC_PATHS = {"/api/healthz", "/api/auth/login"}

AVG_SPEED_KMH = 30
TRAFFIC_MULTIPLIER = 1.2
geocode_cache: dict = {}
import_jobs: dict = {}  # job_id → progress/result dict (in-memory, TTL not needed for MVP)

# ── GraphHopper Matrix API ────────────────────────────────────────────────────

GRAPHHOPPER_API_KEY: str = os.environ.get("GRAPHHOPPER_API_KEY", "")
YANDEX_GEOCODER_API_KEY: str = os.environ.get("YANDEX_GEOCODER_API_KEY", "")

# Max locations per single GH Matrix request.  Free plan = 5; Starter = 25+.
# Override via GRAPHHOPPER_CLUSTER_MAX env-var if you are on a higher-tier plan.
GRAPHHOPPER_FREE_LIMIT = 5           # legacy constant kept for compatibility
GRAPHHOPPER_CLUSTER_MAX: int = int(os.environ.get("GRAPHHOPPER_CLUSTER_MAX", "25"))
GRAPHHOPPER_RATE_LIMIT_TTL = 60      # seconds to suppress GH calls after a 429

# Epoch-seconds timestamp; GH calls are suppressed while time.time() < this value
_gh_rate_limited_until: float = 0.0

# ── In-memory GraphHopper matrix cache ────────────────────────────────────────
# Key: tuple of (lat, lon) pairs (ordered: depot first, then stores).
# Value: (distance_matrix, time_matrix) from GH API.
# Lives for the process lifetime; cleared on server restart.
_matrix_cache: dict = {}
_matrix_cache_hits: int = 0    # cache lookups that returned a cached result
_matrix_cache_misses: int = 0  # cache lookups that triggered a live API call
_gh_call_successes: int = 0    # live API calls that returned a valid matrix

# Auto-calibrated from the first GH 400 "Too many points" response.
# Starts at GRAPHHOPPER_CLUSTER_MAX; reduced if the API key plan allows fewer.
_gh_plan_limit: int = GRAPHHOPPER_CLUSTER_MAX

# ── OSRM Matrix API ────────────────────────────────────────────────────────────
# OSRM (Open Source Routing Machine) uses real OpenStreetMap road data.
# Public demo server: free, no API key, fair-use policy (≤ 100 locations/request).
# Override OSRM_BASE_URL env-var to point at a self-hosted instance.
OSRM_BASE_URL: str = os.environ.get("OSRM_BASE_URL", "https://router.project-osrm.org")
OSRM_MAX_LOCATIONS: int = int(os.environ.get("OSRM_MAX_LOCATIONS", "100"))
OSRM_RATE_LIMIT_TTL = 30      # seconds to suppress OSRM calls after error/timeout

# OR-Tools TSP time budget per cluster (seconds).
# Increase for larger clusters on a dedicated server; lower for test environments.
ORTOOLS_TIME_LIMIT_SECONDS: float = float(os.environ.get("ORTOOLS_TIME_LIMIT_SECONDS", "2"))

# Minimum number of stops per vehicle route.
# If any vehicle ends up with fewer stops after VRP+Or-opt, the rebalancer
# steals the cheapest (min-distance-penalty) stops from overloaded vehicles.
# Scales down automatically when total_stops < MIN_STOPS_PER_VEHICLE * num_vehicles.
MIN_STOPS_PER_VEHICLE: int = 5

# Post-assignment centroid refinement for _cluster_by_sweep().
# Number of nearest-centroid reassignment iterations (0 = sweep-only, no refinement).
# Each iteration moves border-point stores to the geometrically nearest cluster centroid.
CLUSTER_CENTROID_REFINEMENT_ROUNDS: int = int(
    os.environ.get("CLUSTER_CENTROID_REFINEMENT_ROUNDS", "3")
)

_osrm_rate_limited_until: float = 0.0
_osrm_call_successes: int = 0
_osrm_cache_hits: int = 0


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


def get_cluster_matrix_gh(coords: list) -> Optional[tuple]:
    """
    Fetch a GraphHopper distance + time matrix for a geographic cluster.

    Key differences from the legacy ``get_matrix_from_graphhopper``:
    • Accepts up to ``GRAPHHOPPER_CLUSTER_MAX`` locations (default 25) instead of
      the old hard-coded free-plan limit of 5.
    • Results are stored in ``_matrix_cache`` keyed by the ordered coordinate
      tuple (rounded to 6 decimals).  Repeated calls for the same cluster
      (e.g. when rebuilding a route with the same stores) cost 0 extra API calls.
    • Logs every cache hit, cache miss, and the latency of every live API call.
    • Falls back transparently to ``None`` on any failure so the caller can
      switch to Haversine without surfacing an error.

    Args:
        coords: ordered list of (lat, lon) tuples; index 0 should be the depot.

    Returns:
        (distance_matrix, time_matrix) with values in metres / seconds,
        or None when GH is unavailable, rate-limited, or the cluster is too large.
    """
    global _gh_rate_limited_until, _matrix_cache_hits, _matrix_cache_misses
    global _gh_call_successes, _gh_plan_limit
    import re as _re

    if not GRAPHHOPPER_API_KEY:
        return None

    if time.time() < _gh_rate_limited_until:
        remaining = int(_gh_rate_limited_until - time.time())
        logger.info("GH rate-limited (%ds remaining) — using Haversine", remaining)
        return None

    if not coords or len(coords) < 2:
        return None

    if len(coords) > _gh_plan_limit:
        logger.info(
            "GH cluster size %d exceeds plan limit %d — using Haversine "
            "(set GRAPHHOPPER_CLUSTER_MAX env-var to increase for higher-tier plans)",
            len(coords), _gh_plan_limit,
        )
        return None

    # ── Cache lookup ──────────────────────────────────────────────────────────
    cache_key = tuple((round(lat, 6), round(lon, 6)) for lat, lon in coords)
    if cache_key in _matrix_cache:
        _matrix_cache_hits += 1
        logger.info(
            "GH matrix cache HIT (size=%d, hits=%d, misses=%d, successes=%d)",
            len(coords), _matrix_cache_hits, _matrix_cache_misses, _gh_call_successes,
        )
        return _matrix_cache[cache_key]

    # ── Live API call ─────────────────────────────────────────────────────────
    _matrix_cache_misses += 1
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

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        distances = data.get("distances")
        times = data.get("times")

        if distances and times:
            elapsed_ms = int((time.time() - t0) * 1000)
            _gh_call_successes += 1
            logger.info(
                "GH matrix OK: %dx%d in %dms "
                "(successes=%d, cache_hits=%d, cache_size=%d)",
                len(distances), len(distances[0]), elapsed_ms,
                _gh_call_successes, _matrix_cache_hits, len(_matrix_cache),
            )
            _matrix_cache[cache_key] = (distances, times)
            return distances, times

        logger.warning("GH response missing distances/times: %s", data)

    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            _gh_rate_limited_until = time.time() + GRAPHHOPPER_RATE_LIMIT_TTL
            logger.warning(
                "GH 429 rate-limit hit — Haversine for next %ds",
                GRAPHHOPPER_RATE_LIMIT_TTL,
            )
        elif exc.code == 400:
            try:
                body_str = exc.read(512).decode("utf-8", errors="replace")
                body = json.loads(body_str)
                msg = body.get("message", body_str)
            except Exception:
                msg = "(unparseable 400 body)"
            # Auto-calibrate plan limit from "Too many points, allowed: N"
            m = _re.search(r"allowed[:\s]+(\d+)", msg)
            if m:
                detected = int(m.group(1))
                if detected < _gh_plan_limit:
                    old = _gh_plan_limit
                    _gh_plan_limit = detected
                    logger.warning(
                        "GH 400: plan limit detected — auto-set _gh_plan_limit %d→%d. "
                        "Upgrade GH subscription for larger clusters. Falling back to Haversine.",
                        old, _gh_plan_limit,
                    )
                else:
                    logger.warning("GH 400: %s", msg)
            else:
                logger.warning("GH 400: %s", msg)
        else:
            try:
                body_preview = exc.read(256).decode("utf-8", errors="replace")
            except Exception:
                body_preview = ""
            logger.warning("GH HTTP %d: %s | %s", exc.code, exc.reason, body_preview)

    except Exception as exc:
        logger.warning("GH cluster matrix call failed: %s", exc)

    return None


def get_cluster_matrix_osrm(coords: list) -> Optional[tuple]:
    """
    Fetch a road distance + time matrix for a geographic cluster via OSRM.

    OSRM uses real OpenStreetMap road network data — handles one-way streets,
    tunnels, bridges, and actual road detours that Haversine cannot model.

    The public demo server (router.project-osrm.org) is:
    • Free with no API key required
    • Supports up to ~100 locations per matrix request (OSRM_MAX_LOCATIONS)
    • Subject to fair-use policy (avoid high-frequency batching)

    Coordinate order in OSRM URL: longitude,latitude (opposite of (lat,lon) tuples).

    Results are cached in ``_matrix_cache`` with an ``("osrm",)`` prefix key to
    avoid collisions with the GraphHopper cache entries.

    Returns:
        (distance_matrix, time_matrix) with values in metres / seconds,
        or None on any failure so the caller can fall back to Haversine.
    """
    global _osrm_rate_limited_until, _osrm_call_successes, _osrm_cache_hits

    if not coords or len(coords) < 2:
        return None

    if len(coords) > OSRM_MAX_LOCATIONS:
        logger.info(
            "OSRM: cluster size %d exceeds max %d — using Haversine",
            len(coords), OSRM_MAX_LOCATIONS,
        )
        return None

    if time.time() < _osrm_rate_limited_until:
        remaining = int(_osrm_rate_limited_until - time.time())
        logger.info("OSRM rate-limited (%ds remaining) — using Haversine", remaining)
        return None

    # ── Cache lookup ──────────────────────────────────────────────────────────
    # Key uses "osrm" prefix tuple to avoid collision with GH cache entries.
    cache_key = ("osrm",) + tuple((round(lat, 6), round(lon, 6)) for lat, lon in coords)
    if cache_key in _matrix_cache:
        _osrm_cache_hits += 1
        logger.info(
            "OSRM matrix cache HIT (size=%d, hits=%d, successes=%d)",
            len(coords), _osrm_cache_hits, _osrm_call_successes,
        )
        return _matrix_cache[cache_key]

    # ── Live API call ─────────────────────────────────────────────────────────
    # OSRM URL uses lon,lat order (not lat,lon)
    coord_str = ";".join(f"{lon},{lat}" for lat, lon in coords)
    url = (
        f"{OSRM_BASE_URL}/table/v1/driving/{coord_str}"
        "?annotations=duration,distance"
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "SmartRoute/1.0 (delivery-route-optimizer)"},
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if data.get("code") != "Ok":
            logger.warning("OSRM non-Ok response code: %s", data.get("code"))
            return None

        durations = data.get("durations")    # seconds (always present on Ok)
        distances = data.get("distances")    # metres (present with ?annotations=distance)

        if not durations:
            logger.warning("OSRM response missing durations")
            return None

        n = len(durations)

        # Build time matrix (seconds); None values → 0 (unreachable)
        time_matrix = [[int(t) if t is not None else 0 for t in row] for row in durations]

        # Build distance matrix (metres)
        if distances:
            dist_matrix = [[int(d) if d is not None else 0 for d in row] for row in distances]
        else:
            # Approximate from duration at average city speed (30 km/h)
            avg_ms = AVG_SPEED_KMH / 3.6
            dist_matrix = [
                [int(t * avg_ms) if t is not None else 0 for t in row]
                for row in durations
            ]

        elapsed_ms = int((time.time() - t0) * 1000)
        _osrm_call_successes += 1
        logger.info(
            "OSRM matrix OK: %dx%d in %dms (successes=%d, cache_hits=%d, cache_size=%d)",
            n, n, elapsed_ms,
            _osrm_call_successes, _osrm_cache_hits, len(_matrix_cache),
        )
        _matrix_cache[cache_key] = (dist_matrix, time_matrix)
        return dist_matrix, time_matrix

    except urllib.error.HTTPError as exc:
        logger.warning("OSRM HTTP %d: %s", exc.code, exc.reason)
        if exc.code in (429, 503):
            _osrm_rate_limited_until = time.time() + OSRM_RATE_LIMIT_TTL
            logger.warning(
                "OSRM throttled (HTTP %d) — suppressing for %ds",
                exc.code, OSRM_RATE_LIMIT_TTL,
            )
    except Exception as exc:
        elapsed = time.time() - t0
        if elapsed >= 14.0:
            _osrm_rate_limited_until = time.time() + OSRM_RATE_LIMIT_TTL
            logger.warning(
                "OSRM timeout (%.1fs) — suppressing for %ds",
                elapsed, OSRM_RATE_LIMIT_TTL,
            )
        else:
            logger.warning("OSRM cluster matrix call failed: %s", exc)

    return None


def _build_haversine_matrix(coords: list) -> list:
    """Build a full NxN distance matrix (metres) using Haversine."""
    n = len(coords)
    return [[haversine_meters(coords[i], coords[j]) for j in range(n)] for i in range(n)]


def _cluster_by_sweep(store_indices: list, all_coords: list, num_vehicles: int,
                      max_cluster_size: int = None) -> list:
    """
    Partition store node-indices into geographic clusters using the
    polar-angle sweep algorithm (contiguous sectors around the depot).

    Each vehicle receives a contiguous angular wedge — denser wedges get
    more stops, sparser wedges get fewer.  This is the primary mechanism
    for unequal but geographically efficient stop distribution.

    Args:
        store_indices:   node indices of stores (0 = depot in all_coords)
        all_coords:      full coordinate list (depot at index 0)
        num_vehicles:    desired number of vehicles / clusters
        max_cluster_size: optional hard cap per cluster (used only when
                          GraphHopper Free Plan limits apply); None = no cap.

    Returns a list of lists: each sub-list holds the node indices for one
    vehicle.  Length ≤ num_vehicles (some may be absent if dataset is tiny).
    """
    if max_cluster_size is not None:
        min_clusters = math.ceil(len(store_indices) / max_cluster_size)
        effective_vehicles = max(num_vehicles, min_clusters)
    else:
        effective_vehicles = num_vehicles

    depot = all_coords[0]

    def angle_from_depot(node_idx):
        lat, lon = all_coords[node_idx]
        return math.atan2(lon - depot[1], lat - depot[0])

    # ── Equal-angle sector partition ──────────────────────────────────────────
    # Divide the full 360° circle into effective_vehicles equal angular wedges.
    # Stores are assigned to whichever wedge their angle falls into.
    # Dense wedges naturally collect more stores; sparse wedges get fewer.
    # This is the key mechanism for unequal (geography-driven) distribution.
    all_angles = [(node, angle_from_depot(node)) for node in store_indices]
    if not all_angles:
        return []

    min_angle = min(a for _, a in all_angles)
    sector_width = 2 * math.pi / effective_vehicles

    chunks = [[] for _ in range(effective_vehicles)]
    for node, angle in all_angles:
        normalized = (angle - min_angle) % (2 * math.pi)
        sector = min(int(normalized / sector_width), effective_vehicles - 1)
        chunks[sector].append(node)

    # If we created more clusters than vehicles, merge extra clusters back into
    # the last num_vehicles bucket so the caller gets exactly num_vehicles routes
    if effective_vehicles > num_vehicles:
        merged = chunks[:num_vehicles]
        for extra in chunks[num_vehicles:]:
            smallest = min(range(len(merged)), key=lambda k: len(merged[k]))
            # Respect max_cluster_size cap if provided, otherwise always merge
            if max_cluster_size is None or len(merged[smallest]) + len(extra) <= max_cluster_size:
                merged[smallest].extend(extra)
            else:
                merged.append(extra)
        chunks = merged

    # ── Post-assignment: nearest-centroid border-point refinement ──────────────
    # After the initial equal-angle sweep, stores near sector boundaries may be
    # geographically closer to a neighbouring cluster's centroid than their own.
    # We iterate (up to CLUSTER_CENTROID_REFINEMENT_ROUNDS times) reassigning each
    # store to its nearest cluster centroid, which reduces cross-boundary detours.
    active = [c for c in chunks if c]
    for _iter in range(CLUSTER_CENTROID_REFINEMENT_ROUNDS):
        centroids = []
        for cluster in active:
            lats = [all_coords[n][0] for n in cluster]
            lons = [all_coords[n][1] for n in cluster]
            centroids.append((sum(lats) / len(lats), sum(lons) / len(lons)))

        new_active = [[] for _ in range(len(active))]
        for node in store_indices:
            coord = all_coords[node]
            best = min(range(len(centroids)),
                       key=lambda i: haversine_meters(coord, centroids[i]))
            new_active[best].append(node)

        if new_active == active:
            break  # converged
        active = new_active

    return [c for c in active if c]


def _parse_time_to_minutes(time_str: str) -> int:
    """Parse 'HH:MM' string to integer minutes from midnight.  Defaults to 09:00."""
    try:
        h, m = str(time_str).strip().split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 9 * 60


def _ortools_solve_group(depot_coord: tuple, group_node_indices: list,
                         group_coords: list, dist_matrix: list,
                         time_windows: list = None) -> list:
    """
    Run OR-Tools TSP on a single vehicle's cluster of stops.

    Args:
        depot_coord:        (lat, lon) of the depot (unused directly; coord is at
                            group_coords[0]).
        group_node_indices: global node indices of the stores in this cluster
                            (1-based: node 1 = store_list[0]).
        group_coords:       coordinate list [depot, store_a, store_b, ...].
        dist_matrix:        NxN distance matrix (metres) matching group_coords order.
        time_windows:       optional list of (tw_from_min, tw_to_min, service_min)
                            for each store in group_node_indices order.
                            When provided OR-Tools adds a Time dimension and enforces
                            the windows.  When None, pure distance optimisation.

    Returns the stores in optimised visit order (values from group_node_indices).
    Falls back to the original order on any solver failure.
    """
    if not ORTOOLS_AVAILABLE or len(group_node_indices) <= 1:
        return group_node_indices

    n = len(group_coords)  # includes depot at index 0
    manager = pywrapcp.RoutingIndexManager(n, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    int_matrix = [[int(v) for v in row] for row in dist_matrix]

    def dist_cb(from_idx, to_idx):
        return int_matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    transit_idx = routing.RegisterTransitCallback(dist_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

    # ── Time dimension (enforced only when caller supplies time_windows) ──────
    if time_windows and len(time_windows) == len(group_node_indices):
        speed_m_per_min = AVG_SPEED_KMH * 1000 / 60  # ~500 m/min at 30 km/h

        # tw_data[0] = depot (full day), tw_data[k] = store k-1
        tw_data = [(5 * 60, 23 * 60, 0)] + list(time_windows)

        def time_cb(from_idx, to_idx):
            from_node = manager.IndexToNode(from_idx)
            to_node = manager.IndexToNode(to_idx)
            travel_min = int(int_matrix[from_node][to_node] / max(speed_m_per_min, 1))
            service_min = tw_data[from_node][2] if from_node > 0 else 0
            return travel_min + service_min

        time_transit_idx = routing.RegisterTransitCallback(time_cb)
        routing.AddDimension(
            time_transit_idx,
            60,       # max slack (early arrival wait) per stop: 60 min
            24 * 60,  # max cumulative time horizon
            False,    # do NOT force start cumul to zero
            "Time",
        )
        time_dim = routing.GetDimensionOrDie("Time")
        time_dim.SetGlobalSpanCostCoefficient(0)

        # Depot departs exactly at 09:00
        time_dim.CumulVar(routing.Start(0)).SetRange(9 * 60, 9 * 60)

        # Enforce time window on each store node
        for local_node in range(1, n):
            tw_from, tw_to, _ = tw_data[local_node]
            routing_idx = manager.NodeToIndex(local_node)
            time_dim.CumulVar(routing_idx).SetRange(tw_from, tw_to)

        logger.info(
            "OR-Tools time-windows enabled for cluster of %d stops",
            len(group_node_indices),
        )

    # ── Adaptive time limit based on cluster size ─────────────────────────────
    # Small clusters (≤5 stops) are trivial TSPs — 0.3 s is more than enough.
    # Medium clusters (≤10) need ~1 s.  Large clusters get the full budget.
    cluster_size = len(group_node_indices)
    if cluster_size <= 5:
        adaptive_tl = min(0.3, float(ORTOOLS_TIME_LIMIT_SECONDS))
    elif cluster_size <= 10:
        adaptive_tl = min(1.0, float(ORTOOLS_TIME_LIMIT_SECONDS))
    else:
        adaptive_tl = float(ORTOOLS_TIME_LIMIT_SECONDS)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = int(adaptive_tl)
    params.time_limit.nanos = int((adaptive_tl - int(adaptive_tl)) * 1_000_000_000)

    solution = routing.SolveWithParameters(params)
    if not solution:
        logger.warning(
            "OR-Tools found no solution for cluster of %d stops "
            "(time_windows=%s) — keeping original order",
            len(group_node_indices), time_windows is not None,
        )
        return group_node_indices

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


def _inter_route_relocate(routes: list, full_matrix: list, max_iter: int = 5,
                          min_stops: int = 1) -> list:
    """
    Post-process routes with inter-route Or-opt relocate moves.

    For each stop in each route, tries removing it and inserting it into every
    position in every other route.  Applies the best move (highest km saving)
    if it reduces total distance.  Repeats up to max_iter passes or until no
    improvement is found.

    min_stops: do not reduce a route below this many stops (hard floor).
    This equalises route quality across all vehicles — the first route solved
    by TSP is typically the best; relocate spreads good stops more evenly.

    Complexity: O(max_iter * stops * routes * max_route_len) — fast for ≤ 50 stops.
    Uses the pre-built full Haversine matrix (metres).
    """
    if len(routes) <= 1:
        return routes

    def route_cost(route):
        if not route:
            return 0
        cost = full_matrix[0][route[0]] + full_matrix[route[-1]][0]
        for a, b in zip(route, route[1:]):
            cost += full_matrix[a][b]
        return cost

    for iteration in range(max_iter):
        improved = False
        for i in range(len(routes)):
            si = 0
            while si < len(routes[i]):
                # Respect the minimum-stops floor: never reduce a route below min_stops.
                if len(routes[i]) <= min_stops:
                    si += 1
                    continue

                stop = routes[i][si]
                r_i_without = routes[i][:si] + routes[i][si + 1:]
                removal_gain = route_cost(routes[i]) - route_cost(r_i_without)

                best_gain = 1  # minimum threshold: 1 metre improvement
                best_j = -1
                best_pos = -1

                for j in range(len(routes)):
                    if i == j:
                        continue
                    base_j = route_cost(routes[j])
                    for pos in range(len(routes[j]) + 1):
                        r_j_with = routes[j][:pos] + [stop] + routes[j][pos:]
                        insertion_cost = route_cost(r_j_with) - base_j
                        net_gain = removal_gain - insertion_cost
                        if net_gain > best_gain:
                            best_gain = net_gain
                            best_j = j
                            best_pos = pos

                if best_j >= 0:
                    routes[i] = r_i_without
                    routes[best_j] = (
                        routes[best_j][:best_pos] + [stop] + routes[best_j][best_pos:]
                    )
                    improved = True
                    # Do NOT increment si — routes[i] shrank, next element is at si
                else:
                    si += 1

        if not improved:
            logger.info("inter_route_relocate: converged after %d iteration(s)", iteration + 1)
            break

    return [r for r in routes if r]


def _rebalance_min_stops(routes: list, full_matrix: list, min_stops: int) -> list:
    """
    Ensure every route has at least `min_stops` stops by stealing cheapest stops
    from donor routes (those above the floor).

    The algorithm picks the stop whose (removal_gain - insertion_cost) is best,
    i.e. it minimises the total distance penalty of the rebalancing move.
    Runs until no underfull routes remain or no donor can provide more stops.

    effective_min = min(min_stops, total_stops // num_routes) so that small
    datasets (e.g. 8 stops on 3 vehicles → effective_min=2) scale gracefully.
    """
    if len(routes) <= 1:
        return routes

    total = sum(len(r) for r in routes)
    effective_min = max(1, min(min_stops, total // len(routes)))
    if effective_min < 2:
        return routes

    def route_cost(route):
        if not route:
            return 0
        cost = full_matrix[0][route[0]] + full_matrix[route[-1]][0]
        for a, b in zip(route, route[1:]):
            cost += full_matrix[a][b]
        return cost

    changed = True
    while changed:
        changed = False
        for i, route in enumerate(routes):
            if len(route) >= effective_min:
                continue

            # Route i is underfull — find the cheapest stop to steal from any donor.
            best_net_cost = float("inf")
            best_stop_val = None
            best_donor_idx = -1
            best_donor_stop_pos = -1
            best_insert_pos = -1

            for j, donor in enumerate(routes):
                if i == j or len(donor) <= effective_min:
                    continue  # donor must keep at least effective_min stops

                base_donor = route_cost(donor)
                base_route = route_cost(route)

                for k, stop in enumerate(donor):
                    donor_without = donor[:k] + donor[k + 1:]
                    removal_gain = base_donor - route_cost(donor_without)

                    for pos in range(len(route) + 1):
                        route_with = route[:pos] + [stop] + route[pos:]
                        insertion_cost = route_cost(route_with) - base_route
                        net_cost = insertion_cost - removal_gain  # lower = better
                        if net_cost < best_net_cost:
                            best_net_cost = net_cost
                            best_stop_val = stop
                            best_donor_idx = j
                            best_donor_stop_pos = k
                            best_insert_pos = pos

            if best_stop_val is not None:
                # Apply the best steal
                routes[i] = route[:best_insert_pos] + [best_stop_val] + route[best_insert_pos:]
                d = routes[best_donor_idx]
                routes[best_donor_idx] = d[:best_donor_stop_pos] + d[best_donor_stop_pos + 1:]
                logger.info(
                    "rebalance_min_stops: moved stop %d from route %d→%d "
                    "(route %d now %d stops, net_cost %+.0f m)",
                    best_stop_val, best_donor_idx, i, i, len(routes[i]), best_net_cost,
                )
                changed = True
                break  # restart outer loop — route sizes have changed

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
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Performance indexes
    cur.execute("CREATE INDEX IF NOT EXISTS idx_stores_geocode ON stores(geocode_status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_date ON route_sessions(date DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_session_stores_session ON route_session_stores(session_id)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)")
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


def solve_vrp(all_coords: list, num_vehicles: int, capacities=None, demands=None,
              store_time_windows: list = None) -> list:
    """
    Solve VRP with efficiency as the primary objective (min total km / time).

    Strategy
    ────────
    1. Build a full NxN Haversine distance matrix once (instant, no API).
       For small datasets (≤ GH_FREE_LIMIT) attempt GraphHopper first.

    2. Partition stores into `num_vehicles` contiguous geographic SECTORS using
       the polar-angle sweep around the depot.  Contiguous sectors (not
       round-robin) mean each vehicle is assigned a geographic wedge, so
       denser areas naturally get more stops and sparse areas fewer stops.
       This is the principal mechanism for unequal-but-efficient distribution.

    3. For each sector, extract the relevant sub-matrix and run a single-vehicle
       OR-Tools TSP to polish the visit order within the sector.
       If store_time_windows is provided, OR-Tools also enforces arrival time
       windows (TSPTW) so deliveries respect opening-hour constraints.

    Why this approach
    ─────────────────
    • All vehicles are used (each non-empty sector → one vehicle).
    • Stop counts per vehicle reflect geographic density, NOT a count target.
      A dense north cluster → 12 stops; a sparse south sector → 5 stops.
    • No GlobalSpanCostCoefficient — no artificial balancing penalty.
    • Fast: single-vehicle TSPs are much cheaper than full multi-vehicle VRP.

    Args:
        all_coords:          list of (lat, lon); index 0 is the depot.
        num_vehicles:        number of vehicles / routes to generate.
        capacities:          optional list of vehicle capacity (kg).
        demands:             optional list of store demands (index 0 = depot = 0).
        store_time_windows:  optional list of (tw_from_min, tw_to_min, service_min)
                             for each store, 0-indexed matching all_coords[1:].
                             When supplied, OR-Tools TSPTW is used per cluster.

    Fallback chain (transparent to caller):
      OR-Tools per-sector  →  sector order as-is  →  greedy round-robin
    """
    n = len(all_coords)
    store_count = n - 1  # node 0 is depot

    if store_count == 0:
        return [], "haversine"

    # ── No OR-Tools: geographic sectors, then greedy ordering ─────────────────
    if not ORTOOLS_AVAILABLE:
        if store_count >= 1:
            all_store_nodes = list(range(1, n))
            clusters = _cluster_by_sweep(all_store_nodes, all_coords, num_vehicles)
            return [c for c in clusters if c], "haversine"
        return _fallback_distribution(list(range(1, n)), num_vehicles), "haversine"

    # ── Step 1: full Haversine matrix (always-available baseline) ─────────────
    # Used as fallback when GraphHopper is unavailable for a given cluster.
    full_matrix = _build_haversine_matrix(all_coords)

    logger.info(
        "solve_vrp: %d stores / %d vehicles — building clusters",
        store_count, num_vehicles,
    )

    # ── Step 2: geographic sector partition (contiguous sweep) ────────────────
    # Each vehicle receives a contiguous angular sector around the depot.
    # Denser sectors have more stores → vehicle gets more stops naturally.
    all_store_nodes = list(range(1, n))
    clusters = _cluster_by_sweep(all_store_nodes, all_coords, num_vehicles)

    # ── Step 3: per-cluster road matrix → OR-Tools TSP ────────────────────────
    # Routing priority per cluster:
    #   GH   (paid plan, precise road distances)     → if GH key set + fits plan limit
    #   OSRM (free, real OSM roads, no key needed)   → public demo server fallback
    #   Haversine (instant math, always available)   → final fallback
    #
    # Matrix fetching is parallelised with ThreadPoolExecutor so that network-
    # bound GH/OSRM requests for different clusters overlap.  OR-Tools TSP
    # solving is run sequentially afterwards (CPU-bound, GIL-limited).
    t_vrp_start = time.time()

    non_empty_clusters = [c for c in clusters if c]
    # Phase A: fetch matrices for all clusters in parallel -----------------------
    def _fetch_matrix(cluster_nodes):
        """Return (cluster_nodes, sub_matrix, source) for one cluster."""
        if len(cluster_nodes) == 1:
            return (cluster_nodes, None, "hv_single")
        group_indices = [0] + cluster_nodes
        group_coords = [all_coords[i] for i in group_indices]
        gh_result = get_cluster_matrix_gh(group_coords)
        if gh_result:
            sub_matrix, _ = gh_result
            return (cluster_nodes, sub_matrix, "gh")
        osrm_result = get_cluster_matrix_osrm(group_coords)
        if osrm_result:
            sub_matrix, _ = osrm_result
            return (cluster_nodes, sub_matrix, "osrm")
        group_indices2 = [0] + cluster_nodes
        sub_matrix = [[full_matrix[r][c] for c in group_indices2] for r in group_indices2]
        return (cluster_nodes, sub_matrix, "hv")

    max_workers = min(len(non_empty_clusters), 8)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(max_workers, 1)) as pool:
        matrix_futures = [pool.submit(_fetch_matrix, c) for c in non_empty_clusters]
        matrix_results = [f.result() for f in matrix_futures]

    # Phase B: OR-Tools TSP per cluster (sequential; CPU-bound) -----------------
    routes = []
    gh_clusters = 0
    osrm_clusters = 0
    hv_clusters = 0

    for cluster_nodes, sub_matrix, source in matrix_results:
        if source == "hv_single":
            routes.append(cluster_nodes)
            hv_clusters += 1
            continue
        if source == "gh":
            gh_clusters += 1
        elif source == "osrm":
            osrm_clusters += 1
        else:
            hv_clusters += 1

        group_indices = [0] + cluster_nodes
        group_coords = [all_coords[i] for i in group_indices]
        cluster_tw = None
        if store_time_windows:
            try:
                cluster_tw = [store_time_windows[node - 1] for node in cluster_nodes]
            except IndexError:
                cluster_tw = None

        ordered = _ortools_solve_group(all_coords[0], cluster_nodes, group_coords, sub_matrix,
                                       time_windows=cluster_tw)
        routes.append(ordered if ordered else cluster_nodes)

    # Determine reported matrix source
    total_clusters = gh_clusters + osrm_clusters + hv_clusters
    if osrm_clusters == total_clusters:
        matrix_source = "osrm"
    elif gh_clusters == total_clusters:
        matrix_source = "graphhopper"
    elif hv_clusters == total_clusters:
        matrix_source = "haversine"
    else:
        parts = []
        if gh_clusters:   parts.append(f"gh={gh_clusters}")
        if osrm_clusters: parts.append(f"osrm={osrm_clusters}")
        if hv_clusters:   parts.append(f"hv={hv_clusters}")
        matrix_source = "mixed (" + ", ".join(parts) + ")"

    logger.info(
        "solve_vrp clusters: total=%d, graphhopper=%d, osrm=%d, haversine=%d, "
        "elapsed=%.1fs, cache_hits=%d, cache_total=%d",
        total_clusters, gh_clusters, osrm_clusters, hv_clusters,
        time.time() - t_vrp_start,
        _matrix_cache_hits + _osrm_cache_hits, len(_matrix_cache),
    )

    if not routes:
        routes = _fallback_distribution(all_store_nodes, num_vehicles)

    # ── Step 4: fill unused vehicles by splitting oversized routes ────────────
    # If equal-angle sectors left some vehicles idle (empty angular wedge),
    # break the largest route in half by polar angle until all vehicles are used.
    while len(routes) < num_vehicles and any(len(r) > 1 for r in routes):
        largest_idx = max(range(len(routes)), key=lambda i: len(routes[i]))
        largest = routes[largest_idx]
        if len(largest) < 2:
            break
        # Sort by angle and split at midpoint — each half stays geographic
        depot = all_coords[0]
        def _angle(node):
            lat, lon = all_coords[node]
            return math.atan2(lon - depot[1], lat - depot[0])
        sorted_half = sorted(largest, key=_angle)
        mid = len(sorted_half) // 2
        routes[largest_idx] = sorted_half[:mid]
        routes.append(sorted_half[mid:])

    # Compute effective min-stops floor: scale down when there aren't enough
    # total stops to give every vehicle the full minimum.
    effective_min = max(1, min(MIN_STOPS_PER_VEHICLE, store_count // max(len(routes), 1)))

    # ── Step 5: inter-route relocate post-processing ──────────────────────────
    # Move individual stops between routes if it reduces total Haversine distance.
    # This equalises quality across all vehicles: TSP sectors are optimised in
    # isolation, so route 1 can end up much shorter than route 2.  Relocate fixes
    # this by shifting misplaced stops to the route where they cost the least.
    # The min_stops guard prevents Or-opt from draining routes below the floor.
    if len(routes) > 1 and store_count <= 80:
        before_km = sum(
            sum(full_matrix[r[k]][r[k + 1]] for k in range(len(r) - 1))
            + (full_matrix[0][r[0]] + full_matrix[r[-1]][0] if r else 0)
            for r in routes
        ) / 1000
        routes = _inter_route_relocate(routes, full_matrix, min_stops=effective_min)
        after_km = sum(
            sum(full_matrix[r[k]][r[k + 1]] for k in range(len(r) - 1))
            + (full_matrix[0][r[0]] + full_matrix[r[-1]][0] if r else 0)
            for r in routes
        ) / 1000
        logger.info(
            "inter_route_relocate: %.1f km → %.1f km (saved %.1f km across all vehicles)",
            before_km, after_km, before_km - after_km,
        )

    # ── Step 6: rebalance to minimum stops per vehicle ────────────────────────
    # After sector sweep + Or-opt some vehicles may still be underfull (< effective_min
    # stops).  Steal the cheapest stop (minimum distance penalty) from any donor
    # route that has more than effective_min stops and insert it optimally.
    # This step runs always (also when store_count > 80, where Or-opt is skipped).
    if len(routes) > 1 and effective_min >= 2:
        routes = _rebalance_min_stops(routes, full_matrix, effective_min)

    return routes, matrix_source


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
            result = (float(lat_str), float(lon_str))
            logger.info("geocode_yandex OK: '%s' → (%.5f, %.5f)", address, result[0], result[1])
            return result
    except Exception as e:
        logger.warning("geocode_yandex FAILED for '%s': %s", address, e)
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


def find_nearby_stores(lat: float, lon: float, radius_m: float = 20, exclude_id: int = None) -> list:
    """Return stores within radius_m metres of (lat, lon), sorted by distance.
    Uses a degree-based bounding box pre-filter then exact Haversine check."""
    try:
        delta = radius_m / 111320.0
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if exclude_id is not None:
            cur.execute(
                """SELECT id, name, address, lat, lon,
                    SQRT(POWER((lat-%s)*111320.0,2)
                         + POWER((lon-%s)*111320.0*COS(RADIANS(lat)),2)) AS dist_m
                   FROM stores
                   WHERE id != %s AND lat IS NOT NULL
                     AND ABS(lat-%s) < %s AND ABS(lon-%s) < %s
                   ORDER BY dist_m LIMIT 5""",
                (lat, lon, exclude_id, lat, delta, lon, delta),
            )
        else:
            cur.execute(
                """SELECT id, name, address, lat, lon,
                    SQRT(POWER((lat-%s)*111320.0,2)
                         + POWER((lon-%s)*111320.0*COS(RADIANS(lat)),2)) AS dist_m
                   FROM stores
                   WHERE lat IS NOT NULL
                     AND ABS(lat-%s) < %s AND ABS(lon-%s) < %s
                   ORDER BY dist_m LIMIT 5""",
                (lat, lon, lat, delta, lon, delta),
            )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [dict(r) for r in rows if r["dist_m"] < radius_m]
    except Exception as e:
        logger.error("find_nearby_stores error: %s", e)
        return []


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


def calculate_savings(
    optimized_km: float,
    store_list: list,
    num_vehicles: int,
    depot_lat: float,
    depot_lon: float,
) -> dict:
    """
    Baseline: маршрут в порядке загрузки из Excel (как диспетчер без оптимизации),
    распределённый по машинам round-robin.  Сравниваем с оптимизированным SmartRoute.

    Методика прозрачна для клиента:
      «Если бы водители ехали в том же порядке, в котором магазины загружены в систему»
    """
    # Distribute stores round-robin across vehicles (same order as input)
    n = max(num_vehicles, 1)
    buckets: list = [[] for _ in range(n)]
    for idx, store in enumerate(store_list):
        buckets[idx % n].append(store)

    unoptimized_km = 0.0
    depot = (depot_lat, depot_lon)
    for bucket in buckets:
        if not bucket:
            continue
        prev = depot
        for s in bucket:
            if s.get("lat") and s.get("lon"):
                curr = (float(s["lat"]), float(s["lon"]))
                unoptimized_km += haversine_meters(prev, curr) / 1000.0
                prev = curr
        unoptimized_km += haversine_meters(prev, depot) / 1000.0

    unoptimized_km = max(float(unoptimized_km), optimized_km)
    saved_km = round(max(0.0, unoptimized_km - optimized_km), 1)
    saved_pct = round(saved_km / unoptimized_km * 100) if unoptimized_km > 0 else 0

    # ── Реалистичная модель стоимости (Газель, РФ, 2026) ─────────────────────
    #
    # ROAD_FACTOR: средний коэффициент реальных дорог к Haversine-расстоянию.
    # Оба сравниваемых маршрута (baseline и optimized_km) используют Haversine,
    # поэтому saved_pct и saved_km честны как относительное сравнение.
    # Однако для расчёта реальной экономии топлива и денег необходимо перевести
    # прямолинейные км в фактический пробег по дорогам (OSRM показывает ×1.4–1.5
    # для Махачкалы и аналогичных городов).
    #
    # Разбивка cost_per_km (руб/км по реальным дорогам):
    #   • Топливо:     10 л × 70 руб/л / 100 км  =  7.0 руб/км
    #   • Водитель:    65 000 руб/мес / 25 дн / 200 км/дн = 13.0 руб/км
    #                  (50 000 зарплата + 30% страх.взносы)
    #   • ТО + износ:  7.0 руб/км  (нормативы для Газели)
    #   • Накладные:   4.0 руб/км  (ОСАГО, прочее)
    #   ────────────────────────────────────────────────────────
    #   ИТОГО:        31.0 руб/км  (реальных дорог)
    #
    ROAD_FACTOR: float = 1.4           # Haversine → реальный пробег
    fuel_l_per_100km: float = 10.0
    fuel_price_rub: float = 70.0       # руб. за литр (дизель, 2026)
    cost_per_km: float = 31.0          # руб/км реальных дорог (с разбивкой выше)

    # Применяем ROAD_FACTOR только к монетарным метрикам, а не к saved_km,
    # чтобы не искажать честное сравнение маршрутов.
    saved_km_road = saved_km * ROAD_FACTOR
    saved_fuel_l = round(saved_km_road * fuel_l_per_100km / 100.0, 1)
    saved_fuel_cost_rub = round(saved_fuel_l * fuel_price_rub)
    saved_rub_day = round(saved_km_road * cost_per_km)

    return {
        "optimized_km": round(optimized_km, 1),
        "unoptimized_km": round(unoptimized_km, 1),
        "saved_km": saved_km,
        "saved_pct": saved_pct,
        "saved_fuel_l": saved_fuel_l,
        "saved_fuel_cost_rub": saved_fuel_cost_rub,
        "saved_rub_day": saved_rub_day,
        "saved_rub_month": saved_rub_day * 30,
    }


# Яндекс.Навигатор (мобильное приложение) поддерживает максимум 20 промежуточных
# точек в одной ссылке rtext. При большем числе маршрут не строится.
YANDEX_NAV_MAX_STOPS = 20


def yandex_nav_url(coords_list: list) -> str:
    """Генерирует одну ссылку Яндекс.Навигатора.
    coords_list[0] = склад (depot) — первая точка rtext.
    Яндекс заменяет её GPS-позицией водителя, но все магазины (точки 2…N) сохраняются.
    """
    chunk = coords_list[:YANDEX_NAV_MAX_STOPS]
    points = "~".join(f"{lat},{lon}" for lat, lon in chunk)
    return f"https://yandex.ru/maps/?rtext={points}&rtt=auto"


def yandex_nav_urls(coords_list: list) -> list:
    """
    coords_list[0] = склад (depot), coords_list[1:] = магазины в порядке объезда.

    Разбивает маршрут на сегменты по YANDEX_NAV_MAX_STOPS точек (включая точку
    отправления). Каждый сегмент:
      - сегмент 1: [склад, магазин1 … магазин19]  (20 точек)
      - сегмент 2: [магазин19, магазин20 … магазин37] (20 точек)
      - …

    Яндекс Навигатор заменяет первую точку GPS-позицией водителя — это нормально:
    водитель стоит на складе в начале смены. Все магазины остаются на месте.
    """
    if not coords_list:
        return []

    stores = coords_list[1:]        # магазины (без склада)
    if not stores:
        return []

    max_stores = YANDEX_NAV_MAX_STOPS - 1  # 19 магазинов + 1 точка отправления = 20
    origin = coords_list[0]         # склад — точка отправления первого сегмента

    urls = []
    idx = 0
    while idx < len(stores):
        chunk = stores[idx: idx + max_stores]
        idx += max_stores

        segment = [origin] + chunk
        points = "~".join(f"{lat},{lon}" for lat, lon in segment)
        urls.append(f"https://yandex.ru/maps/?rtext={points}&rtt=auto")

        # Следующий сегмент стартует с последнего магазина текущего
        origin = chunk[-1]

    return urls


def whatsapp_url(vehicle_name: str, stores: list, total_km: float, yandex_urls: list) -> str:
    lines = [f"🚚 {vehicle_name} — маршрут на {total_km:.1f} км:"]
    for i, s in enumerate(stores, 1):
        lines.append(f"{i}. {s['store_name']} — {s['address']}")
    if len(yandex_urls) == 1:
        lines.append(f"\n🗺 Навигатор: {yandex_urls[0]}")
    elif len(yandex_urls) > 1:
        lines.append("")
        for idx, url in enumerate(yandex_urls, 1):
            lines.append(f"🗺 Маршрут {idx}: {url}")
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
    # ── Routing chain status ──────────────────────────────────────────────────
    gh_status = f"enabled (plan_limit={_gh_plan_limit})" if GRAPHHOPPER_API_KEY else "disabled (no API key)"
    logger.info(
        "Routing chain: GH[%s] → OSRM[%s] → Haversine[always]",
        gh_status, OSRM_BASE_URL,
    )
    if not GRAPHHOPPER_API_KEY:
        logger.warning(
            "GRAPHHOPPER_API_KEY not set — GraphHopper disabled. "
            "OSRM (%s) will be used for real road distances.",
            OSRM_BASE_URL,
        )
    if not YANDEX_GEOCODER_API_KEY:
        logger.warning(
            "YANDEX_GEOCODER_API_KEY not set — Yandex Geocoder disabled, falling back to Nominatim"
        )
    init_db()
    # NOTE: migrate_moscow_stores() deliberately NOT called here.
    # It was a one-time dev migration that ran when the DB held old Moscow demo data.
    # Calling it on every startup is catastrophically dangerous for production clients
    # in any Russian city with lat > 50 (Moscow, SPb, Novosibirsk, Yekaterinburg, etc.).
    seed_demo_data()
    seed_admin_user()


def migrate_moscow_stores():
    """Удаляем старые московские демо-магазины (lat > 50), сохраняя всё остальное."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            "SELECT COUNT(*) as moscow_cnt "
            "FROM stores WHERE lat IS NOT NULL AND lat > 50"
        )
        row = cur.fetchone()
        moscow_cnt = int(row["moscow_cnt"])
        # Only remove if there are Moscow-like stores and it's a small demo-sized batch
        if moscow_cnt > 0 and moscow_cnt <= 15:
            logger.info("Removing %d Moscow demo stores (lat > 50)...", moscow_cnt)
            cur.execute("DELETE FROM stores WHERE lat IS NOT NULL AND lat > 50")
            conn.commit()
            logger.info("Migration done: %d Moscow stores removed.", moscow_cnt)
    except Exception as exc:
        logger.error("migrate_moscow_stores failed: %s", exc)
        conn.rollback()
    finally:
        cur.close()
        conn.close()


def seed_demo_data():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT COUNT(*) as cnt FROM stores")
    row = cur.fetchone()
    # Seed if empty, or if only a handful remain after migration
    if row["cnt"] >= 3:
        cur.close()
        conn.close()
        return

    demo_stores = [
        ("Продукты Центр", "Махачкала, пр. Расула Гамзатова, 37", 42.9849, 47.5046, "found"),
        ("Супермаркет Каспий", "Махачкала, ул. Ленина, 15", 42.9800, 47.5012, "found"),
        ("Магазин Дагестан", "Махачкала, ул. Коркмасова, 8", 42.9764, 47.4989, "found"),
        ("Торговый дом Север", "Махачкала, ул. Батырая, 22", 42.9838, 47.5155, "found"),
        ("Мини-маркет Восток", "Махачкала, пр. Акушинского, 10", 42.9912, 47.5078, "found"),
        ("Продукты Юг", "Махачкала, ул. Имама Шамиля, 31", 42.9691, 47.5034, "found"),
        ("Супермаркет Горный", "Махачкала, ул. Гагарина, 44", 42.9857, 47.4921, "found"),
        ("Магазин Приморский", "Махачкала, ул. Приморская, 5", 42.9929, 47.5196, "found"),
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
            (str(d), 2 + i % 3, round(total_km, 1), round(saved_km, 1), round(saved_km * 1.4 * 31), 8 + i % 6)
        )

    conn.commit()
    cur.close()
    conn.close()


# ── Auth utilities ────────────────────────────────────────────────────────────

import bcrypt as _bcrypt_lib


def _truncate_password(password: str) -> bytes:
    """bcrypt silently truncates at 72 bytes — enforce explicitly."""
    return password.encode("utf-8")[:72]


def _hash_password(password: str) -> str:
    pw = _truncate_password(password)
    return _bcrypt_lib.hashpw(pw, _bcrypt_lib.gensalt(rounds=12)).decode("utf-8")


def _verify_password(plain: str, hashed: str) -> bool:
    try:
        pw = _truncate_password(plain)
        return _bcrypt_lib.checkpw(pw, hashed.encode("utf-8"))
    except Exception:
        return False


def _create_access_token(username: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=JWT_TOKEN_TTL_HOURS)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> Optional[str]:
    """Return username from token, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def seed_admin_user():
    """Create the admin user from ADMIN_PASSWORD env var if not exists."""
    if not ADMIN_PASSWORD:
        logger.warning(
            "ADMIN_PASSWORD env var is not set — admin user will NOT be created. "
            "Set ADMIN_PASSWORD to enable login."
        )
        return
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("SELECT id FROM users WHERE username = %s", ("admin",))
        row = cur.fetchone()
        if row is None:
            hashed = _hash_password(ADMIN_PASSWORD)
            cur.execute(
                "INSERT INTO users (username, password_hash) VALUES (%s, %s)",
                ("admin", hashed),
            )
            conn.commit()
            logger.info("Admin user created.")
        else:
            logger.info("Admin user already exists — skipping creation.")
    except Exception as exc:
        logger.error("seed_admin_user failed: %s", exc)
        conn.rollback()
    finally:
        cur.close()
        conn.close()


# ── Auth middleware ───────────────────────────────────────────────────────────

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Always pass through OPTIONS (CORS pre-flight) and public paths
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    if path in _AUTH_PUBLIC_PATHS or not path.startswith("/api/"):
        return await call_next(request)

    token = request.cookies.get(JWT_COOKIE_NAME)
    if not token:
        return JSONResponse(
            status_code=401,
            content={"detail": "Не авторизован. Войдите в систему."},
        )

    username = _decode_token(token)
    if not username:
        return JSONResponse(
            status_code=401,
            content={"detail": "Токен недействителен или истёк. Войдите снова."},
        )

    request.state.username = username
    return await call_next(request)


# ── Auth endpoints ────────────────────────────────────────────────────────────

class LoginForm(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
async def login(request: Request, response: Response):
    """Authenticate with username + password (form-encoded). Sets HttpOnly JWT cookie."""
    content_type = request.headers.get("content-type", "")
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        username = str(form.get("username", "")).strip()
        password = str(form.get("password", ""))
    else:
        try:
            body = await request.json()
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", ""))
        except Exception:
            raise HTTPException(status_code=422, detail="Неверный формат запроса")

    if not username or not password:
        raise HTTPException(status_code=422, detail="Укажите логин и пароль")

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("SELECT password_hash FROM users WHERE username = %s", (username,))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row or not _verify_password(password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    token = _create_access_token(username)
    resp = JSONResponse(content={"ok": True, "username": username})
    resp.set_cookie(
        key=JWT_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=JWT_TOKEN_TTL_HOURS * 3600,
        path="/",
    )
    return resp


@app.post("/api/auth/logout")
async def logout():
    """Clear the JWT cookie."""
    resp = JSONResponse(content={"ok": True})
    resp.delete_cookie(key=JWT_COOKIE_NAME, path="/", samesite="lax")
    return resp


@app.get("/api/auth/me")
async def me(request: Request):
    """Return the currently authenticated user."""
    username = getattr(request.state, "username", None)
    if not username:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return {"username": username}


# ── Business routes ───────────────────────────────────────────────────────────

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
def create_store(body: StoreInput, force: bool = Query(False, description="Пропустить предупреждение о дубликате")):
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
                address = reverse_geocode_nominatim(lat, lon) or f"{lat:.5f}, {lon:.5f}"
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
        address = geocode_query or (f"{lat:.5f}, {lon:.5f}" if lat is not None else "Адрес не указан")

    # Duplicate detection (skip if force=True)
    if lat is not None and lon is not None and not force:
        nearby = find_nearby_stores(lat, lon, radius_m=20)
        if nearby:
            near = nearby[0]
            raise HTTPException(
                status_code=409,
                detail={
                    "type": "duplicate_warning",
                    "message": (
                        f"Найден похожий магазин в {near['dist_m']:.0f} м: "
                        f"«{near['name']}» ({near['address']}). "
                        "Создать всё равно?"
                    ),
                    "existing": {
                        "id": near["id"],
                        "name": near["name"],
                        "address": near["address"],
                        "dist_m": round(float(near["dist_m"]), 1),
                    },
                },
            )

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
        "Супермаркет Каспий",
        "https://yandex.ru/maps/?whatshere[point]=47.5046,42.9849",
        "",
        "",
        15, "09:00", "18:00",
    ])
    # Example row 2: with address + city
    ws.append([
        "Магазин Горный",
        "",
        "ул. Ленина 15",
        "Махачкала",
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
    duplicates = []
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

        # Combine city + address: city goes FIRST so address.split(",")[0] == city
        if city and city not in raw_addr:
            address = f"{city}, {raw_addr}" if raw_addr else city
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
                    address = reverse_geocode_nominatim(lat, lon) or f"{lat:.5f}, {lon:.5f}"
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
            address = (f"{lat:.5f}, {lon:.5f}" if lat is not None else "Адрес не указан")

        final_map_url = map_url or yandex_url

        # Duplicate detection (non-blocking — warn only)
        dup_warning = None
        if lat is not None and lon is not None:
            nearby = find_nearby_stores(lat, lon, radius_m=20)
            if nearby:
                near = nearby[0]
                dup_warning = {
                    "row": i,
                    "name": name,
                    "existing_id": near["id"],
                    "existing_name": near["name"],
                    "dist_m": round(float(near["dist_m"]), 1),
                }
                logger.info("Import row %d — possible duplicate: '%s' ≈ id=%d '%s' (%.1fm)",
                            i, name, near["id"], near["name"], near["dist_m"])

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
            if dup_warning:
                duplicates.append(dup_warning)
        except Exception as e:
            logger.error(f"Failed to insert store row {i}: {e}")
            failed += 1

    return {
        "total": imported + failed,
        "imported": imported,
        "failed": failed,
        "stores": stores,
        "duplicates": duplicates,
    }


def _import_process_content_sync(content_bytes: bytes, job: dict) -> None:
    """Run Excel import synchronously, updating job dict for progress tracking.
    Called from background thread by /api/stores/import/start endpoint."""
    if not OPENPYXL_AVAILABLE:
        job["error"] = "openpyxl not installed"
        job["done"] = True
        return
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content_bytes))
    except Exception as e:
        job["error"] = f"Не удалось открыть Excel файл: {e}"
        job["done"] = True
        return

    ws = wb.active
    header_row = [str(c).strip().lower() if c else "" for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True), [])]

    def _col(candidates):
        for name in candidates:
            for i, h in enumerate(header_row):
                if name in h:
                    return i
        return None

    c_name   = _col(["назван", "name", "store_name"])
    c_yandex = _col(["ссылка яндекс", "яндекс", "yandex", "ссылка"])
    c_addr   = _col(["адрес", "address"])
    c_city   = _col(["город", "city"])
    c_lat    = _col(["широта", "lat", "latitude"])
    c_lon    = _col(["долгота", "lon", "longitude"])
    c_mapurl = _col(["map_url", "ссылка на карт"])
    c_unload = _col(["разгрузка", "unload"])
    c_from   = _col(["время с", "open_time", "с (", "time_from"])
    c_to     = _col(["время до", "close_time", "до (", "time_to"])

    if c_name is None:
        c_name = 0
    if c_addr is None and c_yandex is None:
        c_addr = 1

    def _get(row, idx, default=""):
        if idx is None or idx >= len(row):
            return default
        v = row[idx]
        return v if v is not None else default

    all_rows = [
        r for r in ws.iter_rows(min_row=2, values_only=True)
        if r and r[0] and not str(r[0]).strip().startswith("←")
    ]
    total_rows = len(all_rows)
    job["total"] = total_rows
    imported, failed = 0, 0
    stores_out: list = []
    duplicates: list = []

    for i, row in enumerate(all_rows, start=1):
        name      = str(_get(row, c_name, "")).strip()
        yandex_url = str(_get(row, c_yandex, "")).strip() or None
        city      = str(_get(row, c_city, "")).strip()
        raw_addr  = str(_get(row, c_addr, "")).strip()
        address   = f"{city}, {raw_addr}" if city and city not in raw_addr else raw_addr
        if not address:
            address = city

        if not name or (not yandex_url and not address):
            failed += 1
            job["processed"] = i; job["failed"] = failed
            continue

        raw_lat = _get(row, c_lat)
        raw_lon = _get(row, c_lon)
        map_url = str(_get(row, c_mapurl, "")).strip() or None

        if c_from is None and len(row) > 2 and row[2] and ":" in str(row[2]):
            tw_from = str(row[2]).strip()
            tw_to   = str(row[3]).strip() if len(row) > 3 and row[3] else "18:00"
            unload  = int(row[4]) if len(row) > 4 and row[4] else 15
        else:
            tw_from = str(_get(row, c_from, "09:00")).strip() or "09:00"
            tw_to   = str(_get(row, c_to, "18:00")).strip() or "18:00"
            try:
                unload = int(_get(row, c_unload, 15))
            except (ValueError, TypeError):
                unload = 15

        lat, lon, status = None, None, "not_found"
        try:
            pv_lat = float(raw_lat) if raw_lat not in (None, "", "None") else None
            pv_lon = float(raw_lon) if raw_lon not in (None, "", "None") else None
        except (ValueError, TypeError):
            pv_lat = pv_lon = None

        if pv_lat is not None and pv_lon is not None and (-90 <= pv_lat <= 90) and (-180 <= pv_lon <= 180):
            lat, lon, status = pv_lat, pv_lon, "found"
        elif yandex_url:
            lat, lon = parse_yandex_link(yandex_url)
            if lat is not None:
                status = "found"
                if not address:
                    address = reverse_geocode_nominatim(lat, lon) or f"{lat:.5f}, {lon:.5f}"
            elif address:
                coords = geocode_address(address)
                lat, lon = (coords[0], coords[1]) if coords else (None, None)
                status = "found" if coords else "not_found"
                if not YANDEX_GEOCODER_API_KEY:
                    time.sleep(1.1)
        elif address:
            coords = geocode_address(address)
            lat, lon = (coords[0], coords[1]) if coords else (None, None)
            status = "found" if coords else "not_found"
            if not YANDEX_GEOCODER_API_KEY:
                time.sleep(1.1)

        if not address:
            address = f"{lat:.5f}, {lon:.5f}" if lat is not None else "Адрес не указан"

        final_map_url = map_url or yandex_url

        dup_warning = None
        if lat is not None and lon is not None:
            nearby = find_nearby_stores(lat, lon, radius_m=20)
            if nearby:
                near = nearby[0]
                dup_warning = {
                    "row": i, "name": name,
                    "existing_id": near["id"], "existing_name": near["name"],
                    "dist_m": round(float(near["dist_m"]), 1),
                }

        try:
            conn2 = get_db()
            cur2 = conn2.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur2.execute(
                """INSERT INTO stores (name, address, lat, lon, map_url, geocode_status, time_window_from, time_window_to, unload_minutes)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (name, address, lat, lon, final_map_url, status, tw_from, tw_to, unload),
            )
            db_row = cur2.fetchone()
            conn2.commit(); cur2.close(); conn2.close()
            stores_out.append(store_row_to_dict(db_row))
            imported += 1
            if dup_warning:
                duplicates.append(dup_warning)
        except Exception as e:
            logger.error("Import job row %d failed: %s", i, e)
            failed += 1

        job["processed"] = i
        job["imported"] = imported
        job["failed"] = failed
        job["duplicates"] = duplicates

    job["stores"] = stores_out
    job["done"] = True
    logger.info("Import job done: %d imported, %d failed, %d duplicates", imported, failed, len(duplicates))


@app.post("/api/stores/import/start", status_code=202)
async def start_import_stores(file: UploadFile = File(...)):
    """Start async background import. Returns job_id for progress polling."""
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")
    content = await file.read()
    job_id = _uuid.uuid4().hex[:8]
    job: dict = {
        "total": 0, "processed": 0, "imported": 0, "failed": 0,
        "done": False, "stores": [], "duplicates": [], "error": None,
    }
    import_jobs[job_id] = job
    t = threading.Thread(target=_import_process_content_sync, args=(content, job), daemon=True)
    t.start()
    return {"job_id": job_id}


@app.get("/api/stores/import/progress/{job_id}")
def get_import_progress(job_id: str):
    """Poll import job progress. Returns current counters + done flag."""
    if job_id not in import_jobs:
        raise HTTPException(status_code=404, detail="Import job not found")
    job = import_jobs[job_id]
    return {
        "job_id": job_id,
        "total": job["total"],
        "processed": job["processed"],
        "imported": job["imported"],
        "failed": job["failed"],
        "done": job["done"],
        "duplicate_count": len(job.get("duplicates", [])),
        "error": job.get("error"),
    }


@app.get("/api/stores/import/result/{job_id}")
def get_import_result(job_id: str):
    """Fetch final result of a completed import job."""
    if job_id not in import_jobs:
        raise HTTPException(status_code=404, detail="Import job not found")
    job = import_jobs[job_id]
    return {
        "total": job["total"],
        "imported": job["imported"],
        "failed": job["failed"],
        "stores": job.get("stores", []),
        "duplicates": job.get("duplicates", []),
        "done": job["done"],
        "error": job.get("error"),
    }


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
    if body.yandex_url is not None:
        yurl = body.yandex_url.strip() if body.yandex_url else None
        fields["map_url"] = yurl
        if yurl:
            lat_y, lon_y = parse_yandex_link(yurl)
            if lat_y is not None and lon_y is not None:
                fields["lat"] = lat_y
                fields["lon"] = lon_y
                fields["geocode_status"] = "found"
    if body.city is not None:
        # Store city as part of address if address not separately updated
        pass  # city is used in geocoding, stored implicitly in address
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
    deleted = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Store not found")


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

    # Validate depot coordinates
    if body.depot_lat is not None and not (-90 <= body.depot_lat <= 90):
        raise HTTPException(status_code=422, detail="Широта склада должна быть от -90 до 90")
    if body.depot_lon is not None and not (-180 <= body.depot_lon <= 180):
        raise HTTPException(status_code=422, detail="Долгота склада должна быть от -180 до 180")

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    placeholders = ",".join(["%s"] * len(body.store_ids))
    cur.execute(f"SELECT * FROM stores WHERE id IN ({placeholders})", body.store_ids)
    stores_rows = {r["id"]: r for r in cur.fetchall()}
    cur.close()
    conn.close()

    # Depot coordinates
    depot_lat = body.depot_lat or 42.9849
    depot_lon = body.depot_lon or 47.5046

    # Build coordinate list: depot first, then stores (preserve input order for savings baseline)
    store_list = [stores_rows[sid] for sid in body.store_ids if sid in stores_rows and stores_rows[sid]["lat"]]
    if not store_list:
        raise HTTPException(status_code=400, detail="No geocoded stores found")

    num_vehicles = len(body.vehicles)

    # ── Vehicle count validation ──────────────────────────────────────────────
    if num_vehicles > len(store_list):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Количество машин ({num_vehicles}) превышает количество магазинов "
                f"({len(store_list)}). Уменьшите число машин до {len(store_list)} или меньше."
            ),
        )

    all_coords = [(depot_lat, depot_lon)] + [(s["lat"], s["lon"]) for s in store_list]

    capacities = None
    demands = None
    if any(v.capacity_kg for v in body.vehicles):
        capacities = [int(v.capacity_kg) if v.capacity_kg else 99999 for v in body.vehicles]
        demands = [0] + [1] * len(store_list)  # 1 unit per store

    # ── Time windows (TSPTW) ─────────────────────────────────────────────────
    # When use_time_windows is True, pass (tw_from_min, tw_to_min, service_min)
    # per store to solve_vrp so OR-Tools enforces arrival constraints.
    store_time_windows = None
    if body.use_time_windows:
        store_time_windows = []
        for s in store_list:
            tw_from = _parse_time_to_minutes(s.get("time_window_from") or "09:00")
            tw_to   = _parse_time_to_minutes(s.get("time_window_to")   or "18:00")
            service = int(s.get("unload_minutes") or 15) if body.use_unload_time else 0
            store_time_windows.append((tw_from, tw_to, service))
        logger.info(
            "build_route: time windows enabled for %d stores (use_unload=%s)",
            len(store_time_windows), body.use_unload_time,
        )

    logger.info(
        "solve_vrp: %d stores, %d vehicles, capacities=%s, time_windows=%s",
        len(store_list), num_vehicles, capacities,
        "yes" if store_time_windows else "no",
    )

    try:
        vehicle_routes_indices, matrix_source = solve_vrp(
            all_coords, num_vehicles, capacities, demands, store_time_windows
        )
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

        # depot (route_coords[0]) остаётся первой точкой — Яндекс заменит его
        # GPS-позицией водителя, но все магазины сохранятся на своих местах.
        yurls = yandex_nav_urls(route_coords) if len(route_coords) > 1 else []
        yurl = yurls[0] if yurls else ""
        wurl = whatsapp_url(vehicle.name, route_stores, km, yurls)

        routes.append({
            "vehicle_name": vehicle.name,
            "stores": route_stores,
            "total_km": round(km, 1),
            "estimated_minutes": est_minutes,
            "yandex_url": yurl,
            "yandex_urls": yurls,
            "whatsapp_url": wurl,
        })

    savings = calculate_savings(
        total_km,
        store_list,      # passed in original input order — used as baseline
        num_vehicles,
        depot_lat,
        depot_lon,
    )

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


@app.get("/api/route/sessions")
def list_route_sessions(page: int = 1, page_size: int = 20):
    """Список сессий маршрутов с пагинацией."""
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        page_size = 20
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("SELECT COUNT(*) as total FROM route_sessions")
        total = int(cur.fetchone()["total"])
        offset = (page - 1) * page_size
        cur.execute(
            """SELECT id, date, num_vehicles, total_km, saved_km, saved_rub, num_points, created_at
               FROM route_sessions
               ORDER BY created_at DESC
               LIMIT %s OFFSET %s""",
            (page_size, offset),
        )
        rows = cur.fetchall()
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": r["id"],
                    "date": r["date"],
                    "num_vehicles": r["num_vehicles"] or 0,
                    "total_km": round(float(r["total_km"] or 0), 1),
                    "saved_km": round(float(r["saved_km"] or 0), 1),
                    "saved_rub": int(r["saved_rub"] or 0),
                    "num_points": r["num_points"] or 0,
                    "created_at": str(r["created_at"]) if r["created_at"] else None,
                }
                for r in rows
            ],
        }
    finally:
        cur.close()
        conn.close()


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
def get_analytics_daily(date_from: Optional[str] = None, date_to: Optional[str] = None):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    params: list = []
    conditions: list = []
    if date_from:
        conditions.append("date >= %s")
        params.append(date_from)
    else:
        conditions.append("date >= (CURRENT_DATE - INTERVAL '30 days')::TEXT")
    if date_to:
        conditions.append("date <= %s")
        params.append(date_to)
    where = "WHERE " + " AND ".join(conditions)
    cur.execute(f"""
        SELECT
            date,
            COUNT(*) as routes,
            COALESCE(SUM(total_km), 0) as total_km,
            COALESCE(SUM(saved_km), 0) as saved_km,
            COALESCE(SUM(saved_rub), 0) as saved_rub
        FROM route_sessions
        {where}
        GROUP BY date
        ORDER BY date
    """, params)
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
def get_analytics_monthly(date_from: Optional[str] = None, date_to: Optional[str] = None):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    params: list = []
    conditions: list = []
    if date_from:
        conditions.append("date >= %s")
        params.append(date_from)
    else:
        conditions.append("created_at >= NOW() - INTERVAL '12 months'")
    if date_to:
        conditions.append("date <= %s")
        params.append(date_to)
    where = "WHERE " + " AND ".join(conditions)
    cur.execute(f"""
        SELECT
            TO_CHAR(created_at, 'YYYY-MM') as month,
            COUNT(*) as routes,
            COALESCE(SUM(total_km), 0) as total_km,
            COALESCE(SUM(saved_rub), 0) as saved_rub
        FROM route_sessions
        {where}
        GROUP BY month
        ORDER BY month
    """, params)
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


@app.get("/api/analytics/vehicle-load")
def get_analytics_vehicle_load(date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Среднее количество точек на машину по дням."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    params: list = []
    conditions = ["num_vehicles > 0", "num_points > 0"]
    if date_from:
        conditions.append("date >= %s")
        params.append(date_from)
    else:
        conditions.append("date >= (CURRENT_DATE - INTERVAL '30 days')::TEXT")
    if date_to:
        conditions.append("date <= %s")
        params.append(date_to)
    where = "WHERE " + " AND ".join(conditions)
    cur.execute(f"""
        SELECT
            date,
            ROUND(AVG(num_points::float / NULLIF(num_vehicles, 0))::numeric, 1) as avg_points_per_vehicle,
            SUM(num_points) as total_points,
            SUM(num_vehicles) as total_vehicles
        FROM route_sessions
        {where}
        GROUP BY date
        ORDER BY date
    """, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "date": r["date"],
            "avg_points_per_vehicle": float(r["avg_points_per_vehicle"] or 0),
            "total_points": int(r["total_points"] or 0),
            "total_vehicles": int(r["total_vehicles"] or 0),
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


# ── Production static file serving ────────────────────────────────────────────
# In production (Docker / Railway), FastAPI serves the Vite build output from
# ./static/. In development, the Vite dev server handles this via the proxy.
# This block must come AFTER all /api/* routes so the catch-all doesn't
# shadow them. FastAPI matches routes in registration order.
from pathlib import Path as _Path  # noqa: E402

_STATIC_DIR = _Path(__file__).parent / "static"
if _STATIC_DIR.exists() and _STATIC_DIR.is_dir():
    from fastapi.staticfiles import StaticFiles as _StaticFiles  # noqa: E402
    from fastapi.responses import FileResponse as _FileResponse  # noqa: E402

    # Vite outputs JS/CSS bundles under /assets/ — mount separately so
    # FileResponse header (Content-Type) is set correctly.
    _assets_dir = _STATIC_DIR / "assets"
    if _assets_dir.exists():
        app.mount("/assets", _StaticFiles(directory=str(_assets_dir)), name="static-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _serve_spa(full_path: str):
        """Serve exact static file if it exists, otherwise fall back to SPA index.html."""
        if full_path and ".." not in full_path:
            candidate = _STATIC_DIR / full_path
            if candidate.is_file():
                return _FileResponse(str(candidate))
        return _FileResponse(str(_STATIC_DIR / "index.html"))

    logger.info("Static dir found at %s — serving frontend from FastAPI", _STATIC_DIR)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
