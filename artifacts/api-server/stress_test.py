"""
SmartRoute — Stress Test & Before/After Comparison
===================================================
Запуск: cd artifacts/api-server && python3 stress_test.py

Генерирует синтетические координаты вокруг тестового депо,
запускает solve_vrp и выводит подробные метрики.
"""

import math
import random
import time
import sys
import os

# Ensure we can import from the same directory
sys.path.insert(0, os.path.dirname(__file__))

# Patch environment before importing main
os.environ.setdefault("DATABASE_URL", "")
os.environ.setdefault("ADMIN_PASSWORD", "test")

# Suppress startup logs for clean output
import logging
logging.disable(logging.WARNING)

from main import solve_vrp, _build_haversine_matrix

logging.disable(logging.NOTSET)
logging.basicConfig(level=logging.WARNING)


# ── Тестовый депо (репрезентативный российский город) ──────────────────────────
DEPOT_LAT = 42.9849
DEPOT_LON = 47.5046
RANDOM_SEED = 42


def gen_coords(n_stores: int, seed: int = RANDOM_SEED) -> list:
    """Generate n_stores random coords around test depot (±0.15°)."""
    rng = random.Random(seed)
    coords = [(DEPOT_LAT, DEPOT_LON)]
    for _ in range(n_stores):
        lat = DEPOT_LAT + rng.uniform(-0.15, 0.15)
        lon = DEPOT_LON + rng.uniform(-0.15, 0.15)
        coords.append((lat, lon))
    return coords


def route_km(route: list, matrix: list) -> float:
    if not route:
        return 0.0
    dist = matrix[0][route[0]] + matrix[route[-1]][0]
    for a, b in zip(route, route[1:]):
        dist += matrix[a][b]
    return dist / 1000.0


def run_scenario(n_stores: int, n_vehicles: int, seed: int = RANDOM_SEED) -> dict:
    coords = gen_coords(n_stores, seed)
    matrix = _build_haversine_matrix(coords)

    t0 = time.time()
    routes, src = solve_vrp(coords, n_vehicles)
    elapsed = time.time() - t0

    route_kms = [route_km(r, matrix) for r in routes]
    total_km = sum(route_kms)
    max_km = max(route_kms) if route_kms else 0
    min_km = min(route_kms) if route_kms else 0
    avg_km = total_km / len(routes) if routes else 0
    ratio = max_km / min_km if min_km > 0 else float("inf")

    route_lens = [len(r) for r in routes]
    max_stops = max(route_lens) if route_lens else 0
    min_stops = min(route_lens) if route_lens else 0

    return {
        "n_stores": n_stores,
        "n_vehicles": n_vehicles,
        "total_km": total_km,
        "avg_km": avg_km,
        "max_km": max_km,
        "min_km": min_km,
        "ratio": ratio,
        "max_stops": max_stops,
        "min_stops": min_stops,
        "elapsed_s": elapsed,
        "matrix_src": src,
    }


def print_table(results: list):
    header = (
        f"{'Points':>7} {'Veh':>4} {'Total km':>9} {'Avg km':>8} "
        f"{'Max km':>8} {'Min km':>7} {'R max/min':>10} "
        f"{'MaxSt':>6} {'MinSt':>6} {'Time s':>7}"
    )
    print(header)
    print("-" * len(header))
    for r in results:
        print(
            f"{r['n_stores']:>7} {r['n_vehicles']:>4} {r['total_km']:>9.1f} "
            f"{r['avg_km']:>8.1f} {r['max_km']:>8.1f} {r['min_km']:>7.1f} "
            f"{r['ratio']:>10.2f} {r['max_stops']:>6} {r['min_stops']:>6} "
            f"{r['elapsed_s']:>7.2f}"
        )


if __name__ == "__main__":
    scenarios = [
        (50,  5),
        (100, 9),
        (120, 10),
        (150, 10),
        (200, 10),
        (300, 12),
    ]

    print("\n=== SmartRoute Stress Test ===")
    print(f"Depot: ({DEPOT_LAT}, {DEPOT_LON})")
    print(f"Seed: {RANDOM_SEED}  |  Matrix: Haversine (local, no network)\n")

    results = []
    for n_stores, n_vehicles in scenarios:
        print(f"  Running {n_stores} stores / {n_vehicles} vehicles ...", end="", flush=True)
        r = run_scenario(n_stores, n_vehicles)
        results.append(r)
        print(f" done ({r['elapsed_s']:.2f}s)")

    print()
    print_table(results)

    # ── Highlight ratio warnings ──────────────────────────────────────────────
    print()
    bad = [r for r in results if r["ratio"] > 3.0]
    if bad:
        print("⚠  Routes with ratio max/min > 3.0:")
        for r in bad:
            print(f"   {r['n_stores']} stores / {r['n_vehicles']} veh → ratio {r['ratio']:.2f}")
    else:
        print("✓  All scenarios: ratio max/min ≤ 3.0")

    slow = [r for r in results if r["elapsed_s"] > 30]
    if slow:
        print("⚠  Scenarios taking > 30 s:")
        for r in slow:
            print(f"   {r['n_stores']} stores → {r['elapsed_s']:.1f}s")
    else:
        print("✓  All scenarios completed within 30 s")
