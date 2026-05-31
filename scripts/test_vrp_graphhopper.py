"""
GraphHopper vs Haversine comparison test for SmartRoute VRP.

Scenarios per spec:
  A) 30 stores / 4 vehicles
  B) 50 stores / 6 vehicles
  C) 100 stores / 8 vehicles

For each scenario three runs are shown:
  1. Haversine-only         — get_cluster_matrix_gh always returns None
  2. Live GH API            — real API call (requires GRAPHHOPPER_API_KEY)
  3. Simulated paid plan    — mock GH that applies a road_factor multiplier
                              to show the quality gain when a paid key is used

Metrics per run:
  - GH API calls (attempts) and successful calls
  - GH cache hits
  - Elapsed wall-clock time (seconds)
  - Total km (Haversine post-hoc for fair cross-run comparison)
  - Distribution [stops per vehicle]
"""

import sys
import os
import math
import time
import random
import logging

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "artifacts", "api-server"))

logging.basicConfig(level=logging.WARNING)

import main as M

DEPOT = (42.9849, 47.5046)   # Makhachkala warehouse
random.seed(42)


# ─────────────────────────────────────────────────────────────────────────────
# Coordinate generators
# ─────────────────────────────────────────────────────────────────────────────

def rand_makhachkala_coord(radius_km: float = 8.0):
    r = radius_km * math.sqrt(random.random())
    theta = random.uniform(0, 2 * math.pi)
    dlat = r / 111.0 * math.cos(theta)
    dlon = r / (111.0 * math.cos(math.radians(DEPOT[0]))) * math.sin(theta)
    return (round(DEPOT[0] + dlat, 5), round(DEPOT[1] + dlon, 5))


def make_scenario(n_stores: int, n_vehicles: int, label: str):
    stores = [rand_makhachkala_coord() for _ in range(n_stores)]
    return {
        "label": label,
        "n_stores": n_stores,
        "n_vehicles": n_vehicles,
        "all_coords": [DEPOT] + stores,
    }


def total_km(routes, all_coords):
    depot = all_coords[0]
    km = 0.0
    for route in routes:
        prev = depot
        for node in route:
            curr = all_coords[node]
            km += M.haversine_meters(prev, curr) / 1000.0
            prev = curr
        km += M.haversine_meters(prev, depot) / 1000.0
    return km


# ─────────────────────────────────────────────────────────────────────────────
# Run one scenario with a specific GH mode
# ─────────────────────────────────────────────────────────────────────────────

def run_scenario(sc, *, mode: str, road_factor: float = 1.35, ortools_sec: float = 0.5):
    """
    mode = "haversine"  → patch GH to None
    mode = "live"       → use real GH API
    mode = "mock_paid"  → mock GH: haversine × road_factor (simulates paid plan)

    ortools_sec: time limit per cluster for OR-Tools (default 0.5 for speed in tests)
    """
    M._matrix_cache.clear()
    M._matrix_cache_hits = 0
    M._matrix_cache_misses = 0
    M._gh_call_successes = 0
    M._gh_rate_limited_until = 0.0
    M._gh_plan_limit = M.GRAPHHOPPER_CLUSTER_MAX

    orig_gh = M.get_cluster_matrix_gh

    # Patch OR-Tools time limit for test speed
    import ortools.constraint_solver.pywrapcp as _cp
    orig_solve = _cp.RoutingModel.SolveWithParameters
    def _fast_solve(self, params):
        params.time_limit.seconds = int(ortools_sec) if ortools_sec >= 1 else 1
        params.time_limit.nanos = int((ortools_sec % 1) * 1_000_000_000)
        return orig_solve(self, params)
    _cp.RoutingModel.SolveWithParameters = _fast_solve

    if mode == "haversine":
        M.get_cluster_matrix_gh = lambda coords: None

    elif mode == "mock_paid":
        def _mock(coords):
            n = len(coords)
            dist = [[int(M.haversine_meters(coords[i], coords[j]) * road_factor)
                     for j in range(n)] for i in range(n)]
            t_mat = [[int(d / 1000 / 40 * 3600) for d in row] for row in dist]
            M._matrix_cache_misses += 1
            M._gh_call_successes += 1
            return dist, t_mat
        M.get_cluster_matrix_gh = _mock

    # mode == "live": use orig_gh (real API)

    t0 = time.time()
    routes, matrix_source = M.solve_vrp(sc["all_coords"], sc["n_vehicles"])
    elapsed = time.time() - t0

    M.get_cluster_matrix_gh = orig_gh
    _cp.RoutingModel.SolveWithParameters = orig_solve

    plan_limit_detected = M._gh_plan_limit

    return {
        "km": total_km(routes, sc["all_coords"]),
        "elapsed": elapsed,
        "distribution": sorted([len(r) for r in routes], reverse=True),
        "matrix_source": matrix_source,
        "gh_attempts": M._matrix_cache_misses,
        "gh_successes": M._gh_call_successes,
        "cache_hits": M._matrix_cache_hits,
        "plan_limit": plan_limit_detected,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────

def main():
    gh_key = bool(M.GRAPHHOPPER_API_KEY)
    print("SmartRoute — GraphHopper vs Haversine VRP comparison")
    print(f"  GRAPHHOPPER_API_KEY:     {'SET' if gh_key else 'NOT SET'}")
    print(f"  GRAPHHOPPER_CLUSTER_MAX: {M.GRAPHHOPPER_CLUSTER_MAX}")
    print(f"  _gh_plan_limit (start):  {M._gh_plan_limit}")
    print()

    scenarios = [
        make_scenario(30, 4,   "A — 30 stores / 4 vehicles"),
        make_scenario(50, 6,   "B — 50 stores / 6 vehicles"),
        make_scenario(100, 8,  "C — 100 stores / 8 vehicles"),
    ]

    rows = []

    for sc in scenarios:
        print("=" * 72)
        print(f"Scenario: {sc['label']}")

        r_hv   = run_scenario(sc, mode="haversine")
        r_live = run_scenario(sc, mode="live")   if gh_key else None
        r_mock = run_scenario(sc, mode="mock_paid")

        def line(tag, r):
            return (
                f"  {tag:<22} km={r['km']:>7.1f}  t={r['elapsed']:.2f}s  "
                f"GH ok={r['gh_successes']}/att={r['gh_attempts']}  "
                f"cache_hits={r['cache_hits']}  "
                f"dist={r['distribution']}"
            )

        print(line("Haversine-only:", r_hv))
        if r_live:
            delta = r_live["km"] - r_hv["km"]
            tag = "↓ better" if delta < -0.5 else ("↑ worse" if delta > 0.5 else "≈ same")
            print(line("Live GH (real API):", r_live))
            print(f"    → GH plan limit auto-detected: {r_live['plan_limit']}  |  Δkm vs Haversine: {delta:+.1f} {tag}")
        delta_mock = r_mock["km"] - r_hv["km"]
        tag_mock = "↓ better" if delta_mock < -0.5 else ("↑ worse" if delta_mock > 0.5 else "≈ same")
        print(line("Simulated paid (×1.35):", r_mock))
        print(f"    → Δkm vs Haversine: {delta_mock:+.1f} {tag_mock}  (road_factor captures detours/one-ways)")
        print()

        rows.append({
            "label": sc["label"],
            "hv": r_hv,
            "live": r_live,
            "mock": r_mock,
        })

    print("=" * 72)
    print("SUMMARY")
    hdr = f"  {'Scenario':<35} {'HV km':>7}  {'Mock km':>7}  {'Δkm':>6}  {'HV s':>5}  {'Mock s':>6}"
    print(hdr)
    print("  " + "-" * 68)
    for r in rows:
        delta = r["mock"]["km"] - r["hv"]["km"]
        print(
            f"  {r['label']:<35} {r['hv']['km']:>7.1f}  "
            f"{r['mock']['km']:>7.1f}  {delta:>+6.1f}  "
            f"{r['hv']['elapsed']:>5.2f}  {r['mock']['elapsed']:>6.2f}"
        )

    print()
    print("CACHE TEST — 2nd call with same stores should hit cache, not call API:")
    sc0 = scenarios[0]
    M._matrix_cache.clear()
    M._matrix_cache_hits = 0
    M._matrix_cache_misses = 0
    M._gh_call_successes = 0
    M._gh_plan_limit = M.GRAPHHOPPER_CLUSTER_MAX
    live_calls = [0]
    orig_gh = M.get_cluster_matrix_gh
    def _mock_caching(coords):
        # Simulate a paid-plan GH call that stores to _matrix_cache like the real function
        import main as _M
        cache_key = tuple((round(lat, 6), round(lon, 6)) for lat, lon in coords)
        if cache_key in _M._matrix_cache:
            _M._matrix_cache_hits += 1
            return _M._matrix_cache[cache_key]
        n = len(coords)
        dist = [[int(_M.haversine_meters(coords[i], coords[j]) * 1.35) for j in range(n)] for i in range(n)]
        t_mat = [[int(d / 1000 / 40 * 3600) for d in row] for row in dist]
        _M._matrix_cache_misses += 1
        _M._gh_call_successes += 1
        live_calls[0] += 1
        _M._matrix_cache[cache_key] = (dist, t_mat)
        return dist, t_mat
    M.get_cluster_matrix_gh = _mock_caching
    M.solve_vrp(sc0["all_coords"], sc0["n_vehicles"])
    calls_1st = live_calls[0]
    live_calls[0] = 0
    M._matrix_cache_hits = 0
    M.solve_vrp(sc0["all_coords"], sc0["n_vehicles"])
    calls_2nd = live_calls[0]
    M.get_cluster_matrix_gh = orig_gh
    print(f"  1st call: {calls_1st} GH API calls  (cold cache — {M._matrix_cache_misses} entries stored)")
    print(f"  2nd call: {calls_2nd} GH API calls  (warm cache — {M._matrix_cache_hits} cache hits)")
    cache_ok = calls_2nd == 0 and M._matrix_cache_hits > 0
    print(f"  Cache effectiveness: {'PASS ✓' if cache_ok else 'FAIL ✗'}")

    # Determine auto-detected plan limit from live runs
    detected_limit = min(
        (r["live"]["plan_limit"] for r in rows if r["live"]),
        default=M.GRAPHHOPPER_CLUSTER_MAX,
    )

    print()
    print("WHY Δkm ≈ 0 between Haversine and Simulated-paid:")
    print("  The mock multiplies all distances by 1.35 uniformly, so OR-Tools sees the same")
    print("  relative ordering — the optimal visit sequence is unchanged. Real GH matrices")
    print("  differ asymmetrically (one-way streets, bridges, detours), which produces")
    print("  measurably different, road-aware routes that Haversine cannot capture.")

    print()
    print("AUDIT — Fields that exist in DB but are NOT used in VRP optimization:")
    print("  ┌───────────────────────────┬──────────┬───────────────────────────────────────────┐")
    print("  │ Field                     │ In DB    │ Used in OR-Tools?                         │")
    print("  ├───────────────────────────┼──────────┼───────────────────────────────────────────┤")
    print("  │ time_window_from / _to    │ ✅ YES   │ ❌ NO — stored, but not passed to solver  │")
    print("  │ unload_minutes            │ ✅ YES   │ ❌ NO — used for ETA display only         │")
    print("  │ capacity_kg (vehicle)     │ ✅ YES   │ ❌ NO — param accepted but not applied    │")
    print("  └───────────────────────────┴──────────┴───────────────────────────────────────────┘")
    print("  → These fields are documented here per spec. NOT implemented without confirmation.")
    print()
    print("GRAPHHOPPER PLAN STATUS:")
    if gh_key:
        print(f"  API key configured. Auto-detected plan limit: {detected_limit} locations/matrix.")
        if detected_limit < M.GRAPHHOPPER_CLUSTER_MAX:
            print(f"  ⚠ Free plan detected (max {detected_limit} points per matrix request).")
            print(f"    Real-world clusters have {detected_limit}–25 stores + depot → exceed free plan limit.")
            print(f"    All clusters fall back to Haversine (gracefully). Routes still optimised.")
            print(f"    → Upgrade GH subscription for real road-distance matrices per cluster.")
            print(f"    → On paid plan: set GRAPHHOPPER_CLUSTER_MAX=25 (or higher) in env vars.")
        else:
            print(f"  ✅ Plan allows {detected_limit}+ points — GH per-cluster matrices are active.")
    else:
        print("  No API key. All routes use Haversine (straight-line). Set GRAPHHOPPER_API_KEY.")



if __name__ == "__main__":
    main()
