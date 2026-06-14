"""
Тест полного build_route без HTTP — имитирует реальный запрос с магазинами из БД.
Запуск: cd artifacts/api-server && python3 test_full_build_route.py
"""
import sys, os, time, traceback, logging

logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s %(name)s: %(message)s",
)
# Keep only warnings and errors from 3rd-party
logging.getLogger("urllib3").setLevel(logging.WARNING)

sys.path.insert(0, os.path.dirname(__file__))
import psycopg2.extras

import main as M

# ── Get stores from DB ─────────────────────────────────────────────────────────
conn = M.get_db()
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute("SELECT * FROM stores WHERE lat IS NOT NULL AND lon IS NOT NULL ORDER BY id LIMIT 120")
stores_raw = cur.fetchall()
cur.close()
conn.close()

store_ids = [s["id"] for s in stores_raw]
print(f"Loaded {len(store_ids)} stores from DB\n")

# ── Simulate RouteRequest ──────────────────────────────────────────────────────
class FakeVehicle:
    def __init__(self, name):
        self.name = name
        self.capacity_kg = None
        self.average_speed = None

class FakeBody:
    def __init__(self, store_ids, n_vehicles, optimize_by, use_tw, use_unload):
        self.store_ids = store_ids
        self.vehicles = [FakeVehicle(f"Машина {i+1}") for i in range(n_vehicles)]
        self.depot_lat = 42.9849
        self.depot_lon = 47.5046
        self.use_time_windows = use_tw
        self.use_unload_time = use_unload
        self.max_stops_per_vehicle = None
        self.optimize_by = optimize_by

# ── Core build_route logic (extracted from main.py, identical) ─────────────────
def run_build_route(body, label=""):
    import math, json
    from datetime import date
    
    print(f"\n{'='*60}")
    print(f"{label}")
    print(f"  stores={len(body.store_ids)}  vehicles={len(body.vehicles)}")
    print(f"  mode={body.optimize_by}  tw={body.use_time_windows}  unload={body.use_unload_time}")
    
    t0 = time.time()
    
    try:
        # Get store data
        conn = M.get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        
        placeholders = ",".join(["%s"] * len(body.store_ids))
        cur.execute(
            f"SELECT * FROM stores WHERE id IN ({placeholders}) AND lat IS NOT NULL AND lon IS NOT NULL",
            tuple(body.store_ids)
        )
        store_list = [dict(r) for r in cur.fetchall()]
        cur.close()
        conn.close()
        
        print(f"  → fetched {len(store_list)} stores with coords")
        
        if not store_list:
            print("  ❌ No stores with coordinates!")
            return False, 0, None
        
        depot_lat = body.depot_lat or 42.9849
        depot_lon = body.depot_lon or 47.5046
        num_vehicles = len(body.vehicles)
        
        all_coords = [(depot_lat, depot_lon)] + [(s["lat"], s["lon"]) for s in store_list]
        capacities = None
        demands = None
        
        # Time windows
        store_time_windows = None
        if body.use_time_windows:
            store_time_windows = []
            for s in store_list:
                tw_from = M._parse_time_str(s.get("time_window_from") or "09:00")
                tw_to   = M._parse_time_str(s.get("time_window_to")   or "18:00")
                svc     = int(s.get("unload_minutes") or 15) if body.use_unload_time else 0
                store_time_windows.append((tw_from, tw_to, svc))
        
        max_stops_cap = body.max_stops_per_vehicle
        
        print(f"  → calling solve_vrp (mode={body.optimize_by})")
        t_vrp = time.time()
        
        try:
            vehicle_routes_indices, matrix_source = M.solve_vrp(
                all_coords, num_vehicles, capacities, demands, store_time_windows,
                max_stops_per_vehicle=max_stops_cap,
                optimize_by=body.optimize_by,
            )
        except Exception as e:
            print(f"  ❌ solve_vrp FAILED: {e}")
            traceback.print_exc()
            return False, time.time() - t0, None
        
        t_vrp_elapsed = time.time() - t_vrp
        print(f"  → solve_vrp OK in {t_vrp_elapsed:.1f}s  "
              f"routes={len(vehicle_routes_indices)}  src={matrix_source}")
        
        # Build result
        routes = []
        total_km = 0.0
        
        for vi, vehicle in enumerate(body.vehicles):
            if vi >= len(vehicle_routes_indices):
                break
            route_indices = vehicle_routes_indices[vi]
            if not route_indices:
                continue
            
            ETA_ROAD_FACTOR = 2.0
            ROUTE_START_MINUTES = 9 * 60
            route_coords = [(depot_lat, depot_lon)]
            dist_m = 0.0
            cumulative_min = 0
            prev_coord = (depot_lat, depot_lon)
            route_stores = []
            
            for order, idx in enumerate(route_indices, 1):
                store_idx = idx - 1
                if store_idx < 0 or store_idx >= len(store_list):
                    print(f"  ⚠️ out-of-range node {idx} (store_list len={len(store_list)})")
                    continue
                store = store_list[store_idx]
                curr_coord = (store["lat"], store["lon"])
                
                leg_m = M.haversine_meters(prev_coord, curr_coord)
                dist_m += leg_m
                eff_spd = vehicle.average_speed or M.AVG_SPEED_KMH
                leg_drive_min = max(1, int(leg_m * ETA_ROAD_FACTOR / 1000 / eff_spd * 60))
                cumulative_min += leg_drive_min
                
                abs_min = ROUTE_START_MINUTES + cumulative_min
                arrive_hour = (abs_min // 60) % 24
                arrive_min_part = abs_min % 60
                
                route_coords.append(curr_coord)
                route_stores.append({
                    "order": order,
                    "store_id": store["id"],
                    "store_name": store["name"],
                    "arrive_by": f"{arrive_hour:02d}:{arrive_min_part:02d}",
                })
                
                if body.use_unload_time:
                    cumulative_min += store.get("unload_minutes", 15)
                
                prev_coord = curr_coord
            
            if len(route_coords) > 1:
                dist_m += M.haversine_meters(route_coords[-1], (depot_lat, depot_lon))
            
            km = dist_m / 1000.0
            total_km += km
            
            routes.append({
                "vehicle": vehicle.name,
                "stores_count": len(route_stores),
                "km": round(km, 1),
            })
        
        elapsed = time.time() - t0
        print(f"  ✅ DONE in {elapsed:.1f}s  "
              f"total_km={total_km:.1f}  routes={len(routes)}")
        sizes = sorted([r["stores_count"] for r in routes], reverse=True)
        print(f"  route_sizes={sizes}")
        return True, elapsed, total_km
    
    except Exception:
        elapsed = time.time() - t0
        print(f"  ❌ EXCEPTION after {elapsed:.1f}s:")
        traceback.print_exc()
        return False, elapsed, None


# ── Run tests ──────────────────────────────────────────────────────────────────

ids_20  = store_ids[:20]
ids_50  = store_ids[:50]
ids_120 = store_ids[:120]

results = []

# T1: 20×5
for mode in ("distance", "time"):
    ok, t, km = run_build_route(FakeBody(ids_20, 5, mode, True, True), f"T1 20×5 {mode}")
    results.append((f"20×5 {mode}", ok, t, km))

# T2: 50×5
for mode in ("distance", "time"):
    ok, t, km = run_build_route(FakeBody(ids_50, 5, mode, True, True), f"T2 50×5 {mode}")
    results.append((f"50×5 {mode}", ok, t, km))

# T3: 120×9 (the critical case)
for mode in ("distance", "time"):
    ok, t, km = run_build_route(FakeBody(ids_120, 9, mode, True, True), f"T3 120×9 {mode}")
    results.append((f"120×9 {mode}", ok, t, km))

# T4: 120×9 without time windows (isolate TW contribution)
for mode in ("distance", "time"):
    ok, t, km = run_build_route(FakeBody(ids_120, 9, mode, False, False), f"T4 120×9 {mode} no-TW")
    results.append((f"120×9 {mode} noTW", ok, t, km))

# ── Summary ────────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("FINAL SUMMARY")
print("="*60)
print(f"{'Test':<25} {'OK':<5} {'Time':>8} {'km':>8}")
print("-"*50)
for name, ok, t, km in results:
    km_s = f"{km:.1f}" if km is not None else "N/A"
    print(f"{name:<25} {'✅' if ok else '❌':<5} {t:>7.1f}s {km_s:>8}")
