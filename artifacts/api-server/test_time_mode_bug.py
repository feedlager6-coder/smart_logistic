"""
Диагностический тест: optimize_by="time" vs "distance"

Запуск: cd artifacts/api-server && python3 test_time_mode_bug.py
"""
import sys, os, time, math, traceback, logging

# Silence INFO logs so output is readable
logging.basicConfig(level=logging.WARNING)

sys.path.insert(0, os.path.dirname(__file__))

import main as M

# Ensure OR-Tools is used
print(f"OR-Tools available: {M.ORTOOLS_AVAILABLE}")
print(f"ORTOOLS_TIME_LIMIT_SECONDS: {M.ORTOOLS_TIME_LIMIT_SECONDS}")
print()

# Depot: тестовый репрезентативный российский город
DEPOT = (42.9849, 47.5046)

def gen_coords(n, seed=42):
    """Generate n synthetic store coordinates near test depot."""
    import random
    random.seed(seed)
    coords = [DEPOT]
    for _ in range(n):
        lat = DEPOT[0] + random.uniform(-0.08, 0.08)
        lon = DEPOT[1] + random.uniform(-0.08, 0.08)
        coords.append((round(lat, 5), round(lon, 5)))
    return coords

def run_test(label, n_stores, n_vehicles, optimize_by, use_tw=False):
    print(f"{'='*60}")
    print(f"TEST: {label}")
    print(f"  stores={n_stores}  vehicles={n_vehicles}  mode={optimize_by}  tw={use_tw}")
    print(f"{'='*60}")

    coords = gen_coords(n_stores)

    # Simple time windows: all stores 09:00-18:00, 15 min service
    tw = [(9*60, 18*60, 15)] * n_stores if use_tw else None

    t0 = time.time()
    try:
        routes, src = M.solve_vrp(
            coords,
            n_vehicles,
            capacities=None,
            demands=None,
            store_time_windows=tw,
            max_stops_per_vehicle=None,
            optimize_by=optimize_by,
        )
        elapsed = time.time() - t0

        # Compute total km using Haversine
        full_m = M._build_haversine_matrix(coords)
        total_m = 0
        total_stops = 0
        for route in routes:
            if not route:
                continue
            total_stops += len(route)
            total_m += full_m[0][route[0]] + full_m[route[-1]][0]
            for a, b in zip(route, route[1:]):
                total_m += full_m[a][b]

        # Estimate total travel minutes (Haversine → road factor 2.0)
        speed_ms = M.AVG_SPEED_KMH / 3.6  # m/s
        total_min = (total_m * 2.0) / speed_ms / 60

        print(f"  ✅ OK  elapsed={elapsed:.1f}s  routes={len(routes)}  "
              f"stops_covered={total_stops}/{n_stores}")
        print(f"  total_km={total_m/1000:.1f}  est_minutes={total_min:.0f}  "
              f"matrix_src={src}")
        sizes = sorted([len(r) for r in routes], reverse=True)
        print(f"  route_sizes={sizes}")
        return True, elapsed, total_m / 1000

    except Exception:
        elapsed = time.time() - t0
        print(f"  ❌ FAILED after {elapsed:.1f}s")
        traceback.print_exc()
        return False, elapsed, None


# ─── Tests ────────────────────────────────────────────────────────────────────

results = []

# Test 1: 20 stores / 5 vehicles
for mode in ("distance", "time"):
    ok, t, km = run_test(f"T1 20×5 {mode}", 20, 5, mode, use_tw=True)
    results.append((f"20×5 {mode}", ok, t, km))

print()

# Test 2: 50 stores / 5 vehicles  
for mode in ("distance", "time"):
    ok, t, km = run_test(f"T2 50×5 {mode}", 50, 5, mode, use_tw=True)
    results.append((f"50×5 {mode}", ok, t, km))

print()

# Test 3: 120 stores / 9 vehicles (the failing scenario)
for mode in ("distance", "time"):
    ok, t, km = run_test(f"T3 120×9 {mode}", 120, 9, mode, use_tw=True)
    results.append((f"120×9 {mode}", ok, t, km))

# ─── Summary ──────────────────────────────────────────────────────────────────
print()
print("="*60)
print("SUMMARY")
print("="*60)
print(f"{'Test':<20} {'OK':<5} {'Time':>8} {'km':>8}")
print("-"*45)
for name, ok, t, km in results:
    km_s = f"{km:.1f}" if km is not None else "N/A"
    print(f"{name:<20} {'✅' if ok else '❌':<5} {t:>7.1f}s {km_s:>8}")
