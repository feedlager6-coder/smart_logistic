"""
SmartRoute — VRP Stress Test
Матрица: stores=[20,50,100,200] × vehicles=[2,4,6,10]

Для каждого сценария:
  - OSRM реальные дорожные расстояния (GH отключён — тестируется в test_vrp_graphhopper.py)
  - Замер времени (wall-clock)
  - Общий пробег km (Haversine post-hoc для честного сравнения)
  - Экономия % vs naive round-robin
  - Счётчики osrm/hv кластеров
  - Потребление памяти (tracemalloc)

Режимы:
  python3 scripts/test_vrp_stress.py          # --quick (12 сценариев, без 200-store, CI budget)
  python3 scripts/test_vrp_stress.py --full   # все 16 сценариев включая 200-store (~2-3 мин)

Usage: python3 scripts/test_vrp_stress.py [--full]
"""

import sys
import os
import math
import time
import random
import tracemalloc
import logging
import argparse

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "artifacts", "api-server"))

logging.basicConfig(level=logging.WARNING)

import main as M

DEPOT = (42.9849, 47.5046)
random.seed(7)


def rand_coord(radius_km=10.0):
    r = radius_km * math.sqrt(random.random())
    theta = random.uniform(0, 2 * math.pi)
    dlat = r / 111.0 * math.cos(theta)
    dlon = r / (111.0 * math.cos(math.radians(DEPOT[0]))) * math.sin(theta)
    return (round(DEPOT[0] + dlat, 5), round(DEPOT[1] + dlon, 5))


def total_km(routes, all_coords):
    depot = all_coords[0]
    km = 0.0
    for route in routes:
        prev = depot
        for node in route:
            km += M.haversine_meters(prev, all_coords[node]) / 1000.0
            prev = all_coords[node]
        km += M.haversine_meters(prev, depot) / 1000.0
    return round(km, 2)


def naive_km(stores, nv):
    all_c = [DEPOT] + stores
    routes = [list(range(1, len(stores) + 1))[i::nv] for i in range(nv)]
    return total_km([r for r in routes if r], all_c)


# Store the original get_cluster_matrix_gh to restore after test if needed
_orig_gh = None


def reset_counters():
    global _orig_gh
    M._matrix_cache.clear()
    M._matrix_cache_hits = 0
    M._matrix_cache_misses = 0
    M._gh_call_successes = 0
    M._osrm_call_successes = 0
    M._osrm_cache_hits = 0
    M._gh_rate_limited_until = 0.0
    M._osrm_rate_limited_until = 0.0
    M._gh_plan_limit = M.GRAPHHOPPER_CLUSTER_MAX
    # Keep OR-Tools budget at 0.5s — fast enough for stress-test accuracy,
    # avoids 2s × N_clusters wall-time that blows the test timeout.
    M.ORTOOLS_TIME_LIMIT_SECONDS = 0.5
    # Disable GH in stress tests — GH integration is covered by test_vrp_graphhopper.py.
    # This eliminates ~500ms × N_clusters of GH HTTP overhead (400/429 responses) per scenario.
    M.get_cluster_matrix_gh = lambda coords: None


def run_one(stores, nv):
    reset_counters()
    all_coords = [DEPOT] + stores
    tracemalloc.start()
    t0 = time.time()
    routes, source = M.solve_vrp(all_coords, nv)
    elapsed = time.time() - t0
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()
    km = total_km(routes, all_coords)
    naive = naive_km(stores, nv)
    savings = round((naive - km) / naive * 100, 1) if naive > 0 else 0
    dist = sorted([len(r) for r in routes], reverse=True)
    return {
        "km": km,
        "naive": naive,
        "savings": savings,
        "elapsed": elapsed,
        "source": source,
        "dist": dist,
        "gh": M._gh_call_successes,
        "osrm": M._osrm_call_successes,
        "hv": len(routes) - M._gh_call_successes - M._osrm_call_successes,
        "peak_kb": peak // 1024,
    }


# Full 4×4 matrix (all 16 scenarios)
STORE_COUNTS_ALL = [20, 50, 100, 200]
VEHICLE_COUNTS = [2, 4, 6, 10]

# Pre-generate all store sets deterministically (including 200-store for --full mode)
ALL_STORES = {n: [rand_coord() for _ in range(n)] for n in STORE_COUNTS_ALL}


def main():
    parser = argparse.ArgumentParser(description="SmartRoute VRP Stress Test")
    parser.add_argument(
        "--full", action="store_true",
        help="Run all 16 scenarios including 200-store (~2-3 min). Default: 12 scenarios (20/50/100)."
    )
    args, _ = parser.parse_known_args()

    store_counts = STORE_COUNTS_ALL if args.full else [20, 50, 100]
    mode_label = "FULL (16 scenarios)" if args.full else "QUICK (12 scenarios, no 200-store)"

    print("SmartRoute VRP Stress Test")
    print(f"  Mode: {mode_label}")
    print(f"  OSRM endpoint: {M.OSRM_BASE_URL}")
    print(f"  GH key: {'SET' if M.GRAPHHOPPER_API_KEY else 'NOT SET'} (disabled in this test)")
    print(f"  OSRM_MAX_LOCATIONS: {M.OSRM_MAX_LOCATIONS}")
    print()

    # Warm up OSRM connection with a small call
    print("Warming up OSRM connection...", end=" ", flush=True)
    warm = M.get_cluster_matrix_osrm([DEPOT, (42.99, 47.51), (42.97, 47.53)])
    print("OK" if warm else "FAILED (will use Haversine)")
    print()

    results = {}
    warnings = []

    for n_stores in store_counts:
        stores = ALL_STORES[n_stores]
        for n_vehicles in VEHICLE_COUNTS:
            label = f"{n_stores}s/{n_vehicles}v"
            # Dynamic threshold: 200s/10v may take ~14s — acceptable for --full mode
            slow_threshold = 30 if n_stores < 200 else 60
            print(f"  Running {label}...", end=" ", flush=True)
            r = run_one(stores, n_vehicles)
            results[(n_stores, n_vehicles)] = r
            flag = ""
            if r["elapsed"] > slow_threshold:
                flag = " ⚠ SLOW"
                warnings.append(f"{label}: {r['elapsed']:.1f}s > {slow_threshold}s threshold")
            if r["savings"] < 30:
                flag += " ⚠ LOW_SAVINGS"
                warnings.append(f"{label}: savings={r['savings']}% < 30%")
            print(f"done in {r['elapsed']:.1f}s  km={r['km']}  savings={r['savings']}%  "
                  f"src={r['source'][:12]}  peak={r['peak_kb']}KB{flag}")

    # Summary table
    print()
    print("=" * 108)
    print(f"STRESS TEST SUMMARY  [{mode_label}]")
    print("=" * 108)
    hdr = (
        f"  {'Stores':>6} {'Vehicles':>8} {'km':>8} {'Naive':>8} {'Savings':>8} "
        f"{'Time(s)':>8} {'GH':>4} {'OSRM':>5} {'HV':>4} {'Mem(KB)':>8} {'Source':<20}"
    )
    print(hdr)
    print("  " + "-" * 104)

    all_pass = True
    for n_stores in store_counts:
        for n_vehicles in VEHICLE_COUNTS:
            r = results[(n_stores, n_vehicles)]
            slow_threshold = 30 if n_stores < 200 else 60
            slow = r["elapsed"] > slow_threshold
            low = r["savings"] < 30
            if slow or low:
                all_pass = False
            flag = (" ⚠" if slow else "") + (" ↓" if low else "")
            print(
                f"  {n_stores:>6} {n_vehicles:>8} {r['km']:>8.1f} {r['naive']:>8.1f} "
                f"{r['savings']:>7.1f}% {r['elapsed']:>8.2f} {r['gh']:>4} {r['osrm']:>5} "
                f"{r['hv']:>4} {r['peak_kb']:>8} {r['source']:<20}{flag}"
            )

    print()
    print("OSRM USAGE SUMMARY:")
    total_runs = len(store_counts) * len(VEHICLE_COUNTS)
    osrm_runs = sum(1 for (ns, _), r in results.items()
                    if ns in store_counts and "osrm" in r["source"])
    hv_only_runs = sum(1 for (ns, _), r in results.items()
                       if ns in store_counts and r["source"] == "haversine")
    print(f"  Total scenarios:        {total_runs}")
    print(f"  OSRM used (any):        {osrm_runs} ({100*osrm_runs//total_runs}%)")
    print(f"  Haversine-only:         {hv_only_runs} ({100*hv_only_runs//total_runs}%)")
    print(f"  Cache entries (total):  {len(M._matrix_cache)}")

    print()
    print("CAPACITY ESTIMATE (500-1000 deliveries/day):")
    r_100_10 = results.get((100, 10), {})
    r_200_10 = results.get((200, 10), {})
    if r_100_10:
        print(f"  100 stops / 10 vehicles: {r_100_10['elapsed']:.1f}s — "
              f"{'OK (<30s)' if r_100_10['elapsed'] < 30 else 'EXCEEDS 30s threshold'}")
    if r_200_10:
        print(f"  200 stops / 10 vehicles: {r_200_10['elapsed']:.1f}s — "
              f"{'OK (<60s)' if r_200_10['elapsed'] < 60 else 'EXCEEDS 60s threshold'}")
    elif not args.full:
        print("  200 stops / 10 vehicles: not run (use --full flag to include 200-store scenarios)")

    if warnings:
        print()
        print("WARNINGS:")
        for w in warnings:
            print(f"  ⚠ {w}")

    print()
    if all_pass:
        print("ALL CHECKS PASSED ✓")
    else:
        print("Some checks failed — see warnings above.")

    return all_pass


if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
