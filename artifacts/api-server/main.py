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
geocode_cache: dict = {}


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
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS route_session_stores (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES route_sessions(id) ON DELETE CASCADE,
            store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
            visit_order INTEGER
        )
    """)
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
    if not ORTOOLS_AVAILABLE:
        # Simple greedy fallback: distribute points evenly
        points = list(range(1, len(all_coords)))
        chunk = max(1, len(points) // max(1, num_vehicles))
        return [points[i:i+chunk] for i in range(0, len(points), chunk)][:num_vehicles]

    n = len(all_coords)
    if n <= 1:
        return []

    matrix = [[haversine_meters(all_coords[i], all_coords[j]) for j in range(n)] for i in range(n)]

    manager = pywrapcp.RoutingIndexManager(n, num_vehicles, 0)
    routing = pywrapcp.RoutingModel(manager)

    def distance_callback(from_index, to_index):
        return matrix[manager.IndexToNode(from_index)][manager.IndexToNode(to_index)]

    transit_idx = routing.RegisterTransitCallback(distance_callback)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

    if capacities and demands and len(capacities) == num_vehicles:
        def demand_callback(from_index):
            node = manager.IndexToNode(from_index)
            return demands[node] if node > 0 and node < len(demands) else 0
        demand_idx = routing.RegisterUnaryTransitCallback(demand_callback)
        routing.AddDimensionWithVehicleCapacity(demand_idx, 0, capacities, True, "Capacity")

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = 10

    solution = routing.SolveWithParameters(params)
    routes = []
    if solution:
        for v in range(num_vehicles):
            route = []
            idx = routing.Start(v)
            while not routing.IsEnd(idx):
                node = manager.IndexToNode(idx)
                if node != 0:
                    route.append(node)
                idx = solution.Value(routing.NextVar(idx))
            if route:
                routes.append(route)
    return routes


def geocode_address(address: str) -> Optional[tuple]:
    cache_key = address.strip().lower()
    if cache_key in geocode_cache:
        return geocode_cache[cache_key]
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
            lat = float(data[0]["lat"])
            lon = float(data[0]["lon"])
            geocode_cache[cache_key] = (lat, lon)
            return (lat, lon)
    except Exception as e:
        logger.warning(f"Geocoding failed for '{address}': {e}")
    geocode_cache[cache_key] = None
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
        "geocode_status": row["geocode_status"] or "pending",
        "time_window_from": row["time_window_from"] or "09:00",
        "time_window_to": row["time_window_to"] or "18:00",
        "unload_minutes": row["unload_minutes"] or 15,
        "created_at": str(row["created_at"]) if row["created_at"] else None,
    }


# ── Pydantic models ──────────────────────────────────────────────────────────

class StoreInput(BaseModel):
    name: str
    address: str
    time_window_from: Optional[str] = "09:00"
    time_window_to: Optional[str] = "18:00"
    unload_minutes: Optional[int] = 15


class StoreUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    time_window_from: Optional[str] = None
    time_window_to: Optional[str] = None
    unload_minutes: Optional[int] = None


class VehicleInput(BaseModel):
    name: str
    capacity_kg: Optional[int] = None


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
    coords = geocode_address(body.address)
    lat = coords[0] if coords else None
    lon = coords[1] if coords else None
    status = "found" if coords else "not_found"

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """INSERT INTO stores (name, address, lat, lon, geocode_status, time_window_from, time_window_to, unload_minutes)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (body.name, body.address, lat, lon, status,
         body.time_window_from, body.time_window_to, body.unload_minutes)
    )
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return store_row_to_dict(row)


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


@app.get("/api/stores/template")
def download_stores_template():
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Магазины"

    headers = ["Название", "Адрес", "Время с", "Время до", "Время разгрузки мин"]
    ws.append(headers)

    # Bold the header row
    from openpyxl.styles import Font, PatternFill, Alignment
    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    # Example rows
    ws.append(["Магазин Пятёрочка", "ул. Ленина 5", "09:00", "18:00", 15])
    ws.append(["Магазин Магнит", "ул. Гагарина 12", "10:00", "17:00", 20])
    ws.append(["Аптека Здоровье", "пр. Победы 7", "08:00", "20:00", 10])

    # Auto-fit column widths
    col_widths = [30, 40, 12, 12, 22]
    for i, width in enumerate(col_widths, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = width

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=smartroute_template.xlsx"},
    )


@app.post("/api/stores/import")
async def import_stores(file: UploadFile = File(...)):
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    content = await file.read()
    wb = openpyxl.load_workbook(io.BytesIO(content))
    ws = wb.active

    imported = 0
    failed = 0
    stores = []
    all_data_rows = [r for r in ws.iter_rows(min_row=2, values_only=True) if r and r[0]]
    total_rows = len(all_data_rows)
    logger.info("Excel import: %d data rows found", total_rows)

    for i, row in enumerate(all_data_rows, start=1):
        name = str(row[0]).strip() if row[0] else ""
        address = str(row[1]).strip() if len(row) > 1 and row[1] else ""
        tw_from = str(row[2]).strip() if len(row) > 2 and row[2] else "09:00"
        tw_to = str(row[3]).strip() if len(row) > 3 and row[3] else "18:00"
        unload = int(row[4]) if len(row) > 4 and row[4] else 15

        if not name or not address:
            failed += 1
            continue

        coords = geocode_address(address)
        lat = coords[0] if coords else None
        lon = coords[1] if coords else None
        status = "found" if coords else "not_found"
        logger.info("Import geocode %d/%d — %s → %s", i - 1, total_rows, address, status)

        try:
            conn = get_db()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                """INSERT INTO stores (name, address, lat, lon, geocode_status, time_window_from, time_window_to, unload_minutes)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (name, address, lat, lon, status, tw_from, tw_to, unload)
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
        time.sleep(1.1)  # Nominatim rate limit: max 1 req/sec

    return {"total": imported + failed, "imported": imported, "failed": failed, "stores": stores}


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
        vehicle_routes_indices = solve_vrp(all_coords, num_vehicles, capacities, demands)
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

        route_stores = []
        route_coords = [(depot_lat, depot_lon)]
        dist_m = 0

        for order, idx in enumerate(route_indices, 1):
            store_idx = idx - 1  # node 0 = depot, node i = store_list[i-1]
            if store_idx < 0 or store_idx >= len(store_list):
                logger.warning("VRP returned out-of-range node %d (store_list len=%d) — skipping", idx, len(store_list))
                continue
            store = store_list[store_idx]
            route_coords.append((store["lat"], store["lon"]))
            arrive_by = None
            if body.use_time_windows:
                arrive_by = store["time_window_to"]
            route_stores.append({
                "order": order,
                "store_id": store["id"],
                "store_name": store["name"],
                "address": store["address"],
                "lat": store["lat"],
                "lon": store["lon"],
                "arrive_by": arrive_by,
            })

        # Calc distance
        for i in range(len(route_coords) - 1):
            dist_m += haversine_meters(route_coords[i], route_coords[i+1])
        # Return to depot
        if route_coords:
            dist_m += haversine_meters(route_coords[-1], (depot_lat, depot_lon))

        km = dist_m / 1000.0
        total_km += km

        unload_min = sum(s["unload_minutes"] for s in store_list if s["id"] in [rs["store_id"] for rs in route_stores]) if body.use_unload_time else 0
        drive_min = int(km / AVG_SPEED_KMH * 60)
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

    # Save session to DB
    try:
        conn2 = get_db()
        cur2 = conn2.cursor()
        cur2.execute(
            """INSERT INTO route_sessions (date, num_vehicles, total_km, saved_km, saved_rub, num_points)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
            (str(date.today()), num_vehicles, round(total_km, 1),
             savings["saved_km"], savings["saved_rub_day"], len(store_list))
        )
        session_id = cur2.fetchone()[0]
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

    return {
        "routes": routes,
        "savings": savings,
        "total_km": round(total_km, 1),
    }


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
