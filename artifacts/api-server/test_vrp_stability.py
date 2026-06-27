"""
VRP stability test — воспроизводит сценарий 120 магазинов / 9 машин с TW.
Тестирует деградационную цепочку и разные размеры входных данных.
Запуск: cd artifacts/api-server && python3 test_vrp_stability.py
"""
import sys
import math
import time
import traceback

# Patch env before importing main
import os
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")  # не нужна реальная БД

# We only test the VRP functions, not the FastAPI app
sys.path.insert(0, os.path.dirname(__file__))

try:
    from main import (
        solve_vrp,
        _ortools_solve_group,
        _parse_time_to_minutes,
        _fallback_distribution,
        ORTOOLS_AVAILABLE,
        AVG_SPEED_KMH,
    )
except ImportError as e:
    print(f"[FAIL] Could not import main.py: {e}")
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
DEPOT = (42.9849, 47.5046)  # тестовый депо (репрезентативный российский город)

def make_test_coords(n: int):
    """Generate n store coordinates around the test depot (±0.15°)."""
    import random
    random.seed(42)
    coords = [DEPOT]
    for _ in range(n):
        lat = DEPOT[0] + random.uniform(-0.15, 0.15)
        lon = DEPOT[1] + random.uniform(-0.15, 0.15)
        coords.append((lat, lon))
    return coords

# Backward-compatible alias
make_makhachkala_coords = make_test_coords

def make_time_windows(n: int, tight: bool = False):
    """Generate n time-window tuples (tw_from_min, tw_to_min, service_min)."""
    import random
    random.seed(7)
    windows = []
    for i in range(n):
        if tight:
            # Some stores close at 10:00 — very tight window
            tw_from = 9 * 60
            tw_to = 10 * 60 if i % 5 == 0 else 18 * 60
        else:
            tw_from = 9 * 60
            tw_to = 18 * 60
        service = 15
        windows.append((tw_from, tw_to, service))
    return windows

def make_invalid_time_windows(n: int):
    """Generate windows with intentional bad data to test sanitizer."""
    windows = []
    for i in range(n):
        if i % 10 == 0:
            # tw_from > tw_to (swapped)
            windows.append((18 * 60, 9 * 60, 15))
        elif i % 7 == 0:
            # tw_to closes before depot start
            windows.append((0, 480, 15))  # midnight to 08:00
        else:
            windows.append((9 * 60, 18 * 60, 15))
    return windows


# ─────────────────────────────────────────────────────────────────────────────
# Test runner
# ─────────────────────────────────────────────────────────────────────────────
PASS = "\033[92mPASS\033[0m"
FAIL = "\033[91mFAIL\033[0m"
WARN = "\033[93mWARN\033[0m"

results = []

def run_test(name, fn):
    t0 = time.time()
    try:
        msg = fn()
        elapsed = time.time() - t0
        print(f"  [{PASS}] {name}  ({elapsed:.2f}s){f' — {msg}' if msg else ''}")
        results.append(("pass", name))
    except AssertionError as e:
        elapsed = time.time() - t0
        print(f"  [{FAIL}] {name}  ({elapsed:.2f}s) — AssertionError: {e}")
        results.append(("fail", name))
    except Exception as e:
        elapsed = time.time() - t0
        print(f"  [{FAIL}] {name}  ({elapsed:.2f}s) — Exception: {e}")
        traceback.print_exc()
        results.append(("fail", name))


# ─────────────────────────────────────────────────────────────────────────────
# 1. Unit: time-window sanitizer in _ortools_solve_group
# ─────────────────────────────────────────────────────────────────────────────
print("\n══ 1. Time-window sanitizer ══")

def test_invalid_tw_swapped():
    """tw_from > tw_to must not crash — should fall back gracefully."""
    coords = make_makhachkala_coords(5)
    # cluster of 5 stores, all have swapped windows
    bad_tw = [(18*60, 9*60, 15)] * 5
    group = list(range(1, 6))
    group_coords = [coords[i] for i in [0]+group]
    # Build a trivial Haversine matrix
    def hav(c1, c2):
        R = 6371000
        lat1, lon1 = math.radians(c1[0]), math.radians(c1[1])
        lat2, lon2 = math.radians(c2[0]), math.radians(c2[1])
        dlat, dlon = lat2-lat1, lon2-lon1
        a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
        return int(R*2*math.atan2(math.sqrt(a), math.sqrt(1-a)))
    n = len(group_coords)
    mat = [[hav(group_coords[r], group_coords[c]) for c in range(n)] for r in range(n)]
    # Must return a list, never raise
    result = _ortools_solve_group(coords[0], group, group_coords, mat, time_windows=bad_tw)
    assert isinstance(result, list), "Expected list"
    assert len(result) == 5, f"Expected 5 items, got {len(result)}"

run_test("swapped tw_from>tw_to (5 stores)", test_invalid_tw_swapped)

def test_invalid_tw_closes_before_9():
    """Window closing before 09:00 must not crash."""
    coords = make_makhachkala_coords(5)
    bad_tw = [(0, 480, 15)] * 5  # midnight to 08:00
    group = list(range(1, 6))
    group_coords = [coords[i] for i in [0]+group]
    def hav(c1, c2):
        R = 6371000
        lat1,lon1=math.radians(c1[0]),math.radians(c1[1])
        lat2,lon2=math.radians(c2[0]),math.radians(c2[1])
        dlat,dlon=lat2-lat1,lon2-lon1
        a=math.sin(dlat/2)**2+math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
        return int(R*2*math.atan2(math.sqrt(a),math.sqrt(1-a)))
    n = len(group_coords)
    mat = [[hav(group_coords[r], group_coords[c]) for c in range(n)] for r in range(n)]
    result = _ortools_solve_group(coords[0], group, group_coords, mat, time_windows=bad_tw)
    assert isinstance(result, list)
    assert len(result) == 5

run_test("tw_to closes before 09:00 (5 stores)", test_invalid_tw_closes_before_9)


# ─────────────────────────────────────────────────────────────────────────────
# 2. solve_vrp — never crashes for various sizes
# ─────────────────────────────────────────────────────────────────────────────
print("\n══ 2. solve_vrp stability (normal TW) ══")

def make_solve_test(n_stores, n_vehicles, use_tw=True, tight=False):
    def _test():
        coords = make_makhachkala_coords(n_stores)
        tw = make_time_windows(n_stores, tight=tight) if use_tw else None
        routes, src = solve_vrp(coords, n_vehicles, store_time_windows=tw)
        assert isinstance(routes, list), f"Expected list, got {type(routes)}"
        assert len(routes) > 0, "No routes returned"
        total_stops = sum(len(r) for r in routes)
        assert total_stops == n_stores, f"Expected {n_stores} stops total, got {total_stops}"
        return f"{len(routes)} routes, {total_stops} stops, src={src}"
    return _test

for n, v in [(50, 4), (100, 8), (120, 9), (150, 11), (200, 15)]:
    run_test(f"solve_vrp {n} stores / {v} vehicles, TW ON", make_solve_test(n, v, use_tw=True))

print("\n══ 3. solve_vrp stability (no TW) ══")
for n, v in [(50, 4), (100, 8), (120, 9), (150, 11), (200, 15)]:
    run_test(f"solve_vrp {n} stores / {v} vehicles, TW OFF", make_solve_test(n, v, use_tw=False))

print("\n══ 4. solve_vrp stability (tight TW — worst case) ══")
for n, v in [(50, 4), (120, 9), (150, 11)]:
    run_test(f"solve_vrp {n} stores / {v} vehicles, TIGHT TW", make_solve_test(n, v, use_tw=True, tight=True))

print("\n══ 5. solve_vrp stability (mixed invalid TW) ══")

def make_invalid_tw_test(n_stores, n_vehicles):
    def _test():
        coords = make_makhachkala_coords(n_stores)
        tw = make_invalid_time_windows(n_stores)
        routes, src = solve_vrp(coords, n_vehicles, store_time_windows=tw)
        assert isinstance(routes, list)
        assert len(routes) > 0
        total_stops = sum(len(r) for r in routes)
        assert total_stops == n_stores
        return f"{len(routes)} routes, src={src}"
    return _test

for n, v in [(50, 4), (120, 9), (200, 15)]:
    run_test(f"solve_vrp {n} stores / {v} vehicles, INVALID TW", make_invalid_tw_test(n, v))

print("\n══ 6. Exact reproduction: 120 stores / 9 vehicles (TW+unload) ══")

def test_exact_120_9():
    """Exact reproduction of the production failure scenario."""
    coords = make_makhachkala_coords(120)
    # Simulate 120 stores with use_unload=True (15 min each)
    # Some have tight windows like the production data
    import random
    random.seed(2026)
    tw = []
    for i in range(120):
        if i % 15 == 0:
            # Some stores close at 14:00
            tw.append((9*60, 14*60, 15))
        elif i % 20 == 0:
            # Some stores have swapped windows (bad data)
            tw.append((18*60, 9*60, 15))
        else:
            tw.append((9*60, 18*60, 15))
    routes, src = solve_vrp(coords, 9, store_time_windows=tw)
    assert isinstance(routes, list)
    total = sum(len(r) for r in routes)
    assert total == 120, f"Expected 120, got {total}"
    return f"{len(routes)} routes, {total} stops, src={src}"

run_test("EXACT reproduction 120/9 with mixed bad TW", test_exact_120_9)

print("\n══ 7. Large cluster (34 stores in 1 cluster) ══")

def test_large_single_cluster():
    """Single vehicle / 34 stores — reproduced from production cluster logs."""
    coords = make_makhachkala_coords(34)
    tw = [(9*60, 18*60, 15)] * 34
    routes, src = solve_vrp(coords, 1, store_time_windows=tw)
    assert isinstance(routes, list)
    total = sum(len(r) for r in routes)
    assert total == 34
    return f"src={src}"

run_test("34 stores / 1 vehicle (production cluster size)", test_large_single_cluster)

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
total = len(results)
passed = sum(1 for s, _ in results if s == "pass")
failed = sum(1 for s, _ in results if s == "fail")
print(f"\n{'═'*50}")
print(f"Results: {passed}/{total} passed, {failed} failed")
if failed == 0:
    print(f"\033[92m✓ All tests passed — VRP solver is stable for up to 200+ stores\033[0m")
else:
    print(f"\033[91m✗ {failed} test(s) FAILED — see above for details\033[0m")
    sys.exit(1)
