"""
VRP distribution test — verify efficiency-first routing.

Primary metric: total km savings vs naive equal baseline.
Secondary metric: geographic cohesion (vehicles cover contiguous sectors).

GraphHopper disabled to avoid rate-limit delays.
Usage: python3 scripts/test_vrp_scenarios.py
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "artifacts", "api-server"))

import main as _main_mod
_main_mod.get_matrix_from_graphhopper = lambda coords: None  # force Haversine

from main import solve_vrp, haversine_meters

DEPOT = (42.9849, 47.5046)  # Makhachkala depot


def total_route_km(routes, all_coords):
    depot = all_coords[0]
    total = 0.0
    for route in routes:
        prev = depot
        for node in route:
            total += haversine_meters(prev, all_coords[node]) / 1000.0
            prev = all_coords[node]
        total += haversine_meters(prev, depot) / 1000.0
    return round(total, 2)


def naive_equal_km(stores, num_vehicles, depot):
    """Baseline: naive round-robin split, no route optimisation."""
    all_coords = [depot] + stores
    routes = [list(range(1, len(stores) + 1))[i::num_vehicles] for i in range(num_vehicles)]
    return total_route_km([r for r in routes if r], all_coords)


def run_scenario(name, stores, num_vehicles):
    print(f"\n{'=' * 64}")
    print(f"Scenario: {name}  ({len(stores)} stores / {num_vehicles} vehicles)")
    all_coords = [DEPOT] + stores
    routes, source = solve_vrp(all_coords, num_vehicles)
    km = total_route_km(routes, all_coords)
    baseline = naive_equal_km(stores, num_vehicles, DEPOT)
    savings_pct = round((baseline - km) / baseline * 100, 1) if baseline > 0 else 0
    counts = sorted([len(r) for r in routes], reverse=True)
    spread = counts[0] - counts[-1] if len(counts) > 1 else 0
    print(f"  Matrix: {source}")
    print(f"  Distribution: {counts}  (spread={spread})")
    print(f"  Total km: {km}  |  naive baseline: {baseline}  |  savings: {savings_pct}%")
    return routes, km, baseline, counts


# ── Scenario A: 33 stores, 4 vehicles ────────────────────────────────────────
# Three directional clusters + far east outliers.
# Key check: km < naive baseline (geographic routing beats round-robin).
scenario_a = [
    # Centre (10 stores, within 500m of depot)
    (42.984, 47.502), (42.985, 47.504), (42.983, 47.506), (42.986, 47.503),
    (42.982, 47.501), (42.987, 47.505), (42.981, 47.507), (42.988, 47.502),
    (42.980, 47.503), (42.986, 47.501),
    # North (8 stores, ~2 km north)
    (43.005, 47.510), (43.007, 47.512), (43.003, 47.508), (43.009, 47.514),
    (43.002, 47.509), (43.008, 47.511), (43.006, 47.513), (43.004, 47.507),
    # South (8 stores, ~2 km south)
    (42.960, 47.495), (42.958, 47.493), (42.962, 47.497), (42.956, 47.491),
    (42.964, 47.499), (42.955, 47.492), (42.963, 47.494), (42.957, 47.496),
    # East outliers (7 stores, 5-8 km east)
    (42.990, 47.560), (42.992, 47.562), (42.988, 47.558), (42.994, 47.564),
    (42.986, 47.556), (42.993, 47.561), (42.989, 47.559),
]

# ── Scenario B: 52 stores, 6 vehicles ────────────────────────────────────────
scenario_b = [
    # NW cluster (12)
    (43.010, 47.480), (43.012, 47.482), (43.008, 47.478), (43.014, 47.484),
    (43.006, 47.476), (43.013, 47.481), (43.009, 47.483), (43.011, 47.479),
    (43.015, 47.485), (43.007, 47.477), (43.016, 47.486), (43.005, 47.475),
    # NE cluster (10)
    (43.010, 47.540), (43.012, 47.542), (43.008, 47.538), (43.014, 47.544),
    (43.006, 47.536), (43.013, 47.541), (43.009, 47.543), (43.011, 47.539),
    (43.015, 47.545), (43.007, 47.537),
    # SW cluster (12)
    (42.950, 47.480), (42.952, 47.482), (42.948, 47.478), (42.954, 47.484),
    (42.946, 47.476), (42.953, 47.481), (42.949, 47.483), (42.951, 47.479),
    (42.955, 47.485), (42.947, 47.477), (42.956, 47.486), (42.945, 47.475),
    # SE cluster (8)
    (42.950, 47.540), (42.952, 47.542), (42.948, 47.538), (42.954, 47.544),
    (42.946, 47.536), (42.953, 47.541), (42.949, 47.543), (42.951, 47.539),
    # Scattered (10)
    (42.980, 47.510), (42.970, 47.520), (42.990, 47.530), (42.975, 47.505),
    (42.985, 47.515), (42.965, 47.525), (42.995, 47.535), (42.972, 47.512),
    (42.988, 47.522), (42.968, 47.517),
]

# ── Scenario C: 12 stores tightly clustered FAR EAST + 12 stores scattered
# The east cluster is ~8 km east, all within a 300m radius.
# Expected: km < naive baseline; east stores go to 1-2 vehicles (not 4).
scenario_c = [
    # Far east tight cluster (12 stores, ~8 km east, very dense)
    (42.985, 47.574), (42.986, 47.575), (42.984, 47.573),
    (42.987, 47.576), (42.983, 47.572), (42.988, 47.577),
    (42.985, 47.572), (42.986, 47.574), (42.984, 47.575),
    (42.987, 47.573), (42.983, 47.576), (42.988, 47.575),
    # Scattered around depot (12 stores in different directions)
    (43.005, 47.480), (43.000, 47.490), (42.995, 47.500),  # north-west
    (43.005, 47.530), (43.000, 47.540), (42.995, 47.520),  # north-east
    (42.960, 47.480), (42.965, 47.490), (42.970, 47.495),  # south-west
    (42.960, 47.530), (42.965, 47.520), (42.970, 47.510),  # south-east
]

if __name__ == "__main__":
    print("SmartRoute VRP Test — efficiency-first routing\n")

    r_a, km_a, base_a, cnt_a = run_scenario("A — 33 stores / 4 vehicles", scenario_a, 4)
    r_b, km_b, base_b, cnt_b = run_scenario("B — 52 stores / 6 vehicles", scenario_b, 6)
    r_c, km_c, base_c, cnt_c = run_scenario("C — 12 far-east dense + 12 scattered / 4 vehicles", scenario_c, 4)

    print("\n" + "=" * 64)
    print("SUMMARY")
    print(f"  A: {km_a} km  (naive {base_a}, saved {round((base_a-km_a)/base_a*100,1)}%)  dist={cnt_a}")
    print(f"  B: {km_b} km  (naive {base_b}, saved {round((base_b-km_b)/base_b*100,1)}%)  dist={cnt_b}")
    print(f"  C: {km_c} km  (naive {base_c}, saved {round((base_c-km_c)/base_c*100,1)}%)  dist={cnt_c}")

    print("\nValidation checks:")

    # Each scenario must beat the naive baseline
    a_ok = km_a < base_a
    b_ok = km_b < base_b
    c_ok = km_c < base_c
    print(f"  A — km < naive baseline: {'PASS ✓' if a_ok else 'FAIL ✗'}  ({km_a} < {base_a})")
    print(f"  B — km < naive baseline: {'PASS ✓' if b_ok else 'FAIL ✗'}  ({km_b} < {base_b})")
    print(f"  C — km < naive baseline: {'PASS ✓' if c_ok else 'FAIL ✗'}  ({km_c} < {base_c})")

    # C: east cluster should concentrate on 1-2 vehicles — max ≥ 7
    c_max = cnt_c[0] if cnt_c else 0
    c_cluster_ok = c_max >= 7
    print(f"  C — east cluster consolidated (max≥7): {'PASS ✓' if c_cluster_ok else 'FAIL ✗'}  (max={c_max})")

    # All requested vehicles should be used (inter-route relocate no longer
    # empties routes, so vehicle count must equal num_vehicles).
    a_all_used = len(r_a) == 4
    b_all_used = len(r_b) == 6
    c_all_used = len(r_c) == 4
    print(f"  A — all 4 vehicles used: {'PASS ✓' if a_all_used else 'FAIL ✗'}  (got {len(r_a)})")
    print(f"  B — all 6 vehicles used: {'PASS ✓' if b_all_used else 'FAIL ✗'}  (got {len(r_b)})")
    print(f"  C — all 4 vehicles used: {'PASS ✓' if c_all_used else 'FAIL ✗'}  (got {len(r_c)})")

    print()
    all_pass = a_ok and b_ok and c_ok and c_cluster_ok and a_all_used and b_all_used and c_all_used
    print("ALL CHECKS PASSED ✓" if all_pass else "Some checks failed — see details above.")
