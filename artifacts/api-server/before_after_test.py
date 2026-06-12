"""
SmartRoute — Controlled Before vs After
OR-Tools runs ONCE per scenario. Then we compare:
  (A) no post-processing  (= old code for >80 stores)
  (B) 2-opt + relocate    (= new code)
This eliminates OR-Tools non-determinism from the comparison.
Run: cd artifacts/api-server && python3 before_after_test.py
"""
import copy, math, random, time, sys, os, logging, concurrent.futures
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault("DATABASE_URL", "")
os.environ.setdefault("ADMIN_PASSWORD", "test")
logging.disable(logging.WARNING)

from main import (
    _build_haversine_matrix, _cluster_by_sweep,
    _ortools_solve_group, _inter_route_relocate,
    _rebalance_min_stops, _two_opt_route,
    MIN_STOPS_PER_VEHICLE, ORTOOLS_AVAILABLE,
)

DEPOT_LAT, DEPOT_LON = 42.9849, 47.5046

def gen_coords(n, seed=42):
    rng = random.Random(seed)
    c = [(DEPOT_LAT, DEPOT_LON)]
    for _ in range(n):
        c.append((DEPOT_LAT + rng.uniform(-0.15, 0.15),
                  DEPOT_LON + rng.uniform(-0.15, 0.15)))
    return c

def route_km(r, M):
    if not r: return 0.0
    d = M[0][r[0]] + M[r[-1]][0]
    for a, b in zip(r, r[1:]): d += M[a][b]
    return d / 1000.0

def mets(routes, M):
    kms  = [route_km(r, M) for r in routes]
    lens = [len(r) for r in routes]
    tot  = sum(kms)
    mx, mn = max(kms), min(kms)
    return dict(total=tot, avg=tot/len(kms), mx=mx, mn=mn,
                ratio=mx/mn if mn > 0 else 0,
                max_st=max(lens), min_st=min(lens))

def controlled(n_stores, n_vehicles, seed=42):
    coords = gen_coords(n_stores, seed)
    M = _build_haversine_matrix(coords)
    store_nodes = list(range(1, n_stores + 1))

    # ── Step 1: deterministic sweep + centroid (identical for A and B) ─────────
    clusters = _cluster_by_sweep(store_nodes, coords, n_vehicles)
    non_empty = [c for c in clusters if c]

    # ── Step 2: OR-Tools once (save raw output) ─────────────────────────────────
    t_ortools = time.time()
    raw_routes = []
    for cluster_nodes in non_empty:
        group_idx = [0] + cluster_nodes
        group_coords = [coords[i] for i in group_idx]
        sub_M = [[M[r][c] for c in group_idx] for r in group_idx]
        if ORTOOLS_AVAILABLE and len(cluster_nodes) > 1:
            try:
                ordered = _ortools_solve_group(coords[0], cluster_nodes,
                                               group_coords, sub_M)
            except Exception:
                ordered = cluster_nodes
        else:
            ordered = cluster_nodes
        raw_routes.append((cluster_nodes, ordered if ordered else cluster_nodes, sub_M))
    t_ortools_elapsed = time.time() - t_ortools

    # ── Variant A: OLD — no 2-opt, no relocate for >80 ────────────────────────
    routes_A = [list(ordered) for _, ordered, _ in raw_routes]
    eff_min_A = max(1, min(MIN_STOPS_PER_VEHICLE, n_stores // max(len(routes_A), 1)))
    if len(routes_A) > 1 and n_stores <= 80:
        routes_A = _inter_route_relocate(routes_A, M, max_iter=5, min_stops=eff_min_A)
    if len(routes_A) > 1 and eff_min_A >= 2:
        routes_A = _rebalance_min_stops(routes_A, M, eff_min_A)

    # ── Variant B: NEW — 2-opt per route + relocate for all sizes ──────────────
    routes_B = []
    for cluster_nodes, ordered, sub_M in raw_routes:
        r = list(ordered)
        if len(r) >= 3:
            group_idx = [0] + cluster_nodes
            local_idx = {gn: li for li, gn in enumerate(group_idx)}
            local_r = [local_idx[gn] for gn in r]
            local_r = _two_opt_route(local_r, sub_M)
            r = [group_idx[li] for li in local_r]
        routes_B.append(r)

    avg_stops_B = n_stores // max(len(routes_B), 1)
    eff_min_B = (max(1, avg_stops_B - 1) if avg_stops_B <= MIN_STOPS_PER_VEHICLE
                 else max(MIN_STOPS_PER_VEHICLE, int(avg_stops_B * 0.70)))
    if n_stores <= 80:
        iters_B = 5
    elif n_stores <= 150:
        iters_B = 3
    elif n_stores <= 300:
        iters_B = 2
    else:
        iters_B = 1
    if len(routes_B) > 1:
        routes_B = _inter_route_relocate(routes_B, M, max_iter=iters_B, min_stops=eff_min_B)
    if len(routes_B) > 1 and eff_min_B >= 2:
        routes_B = _rebalance_min_stops(routes_B, M, eff_min_B)

    return mets(routes_A, M), mets(routes_B, M), t_ortools_elapsed


# ── Stress scenarios ────────────────────────────────────────────────────────────
SCENARIOS = [(50, 5), (100, 9), (120, 10), (150, 10), (200, 10), (300, 12)]

print("\n=== SmartRoute — Controlled Before vs After ===")
print("OR-Tools runs once; A=old (no relocate>80, no 2-opt), B=new (2-opt+relocate all)")
print(f"\n{'Stores':>7} {'Veh':>4} | {'TotalA':>8} {'TotalB':>8} {'Δkm':>7} {'Δ%':>6} |"
      f" {'RatioA':>7} {'RatioB':>7} | {'MinStA':>6} {'MinStB':>6} | {'OR-Ts':>6}")
print("-" * 90)

rows_120_plus = []
for n, v in SCENARIOS:
    A, B, t_ort = controlled(n, v)
    delta = B["total"] - A["total"]
    pct   = delta / A["total"] * 100
    print(f"{n:>7} {v:>4} | {A['total']:>8.1f} {B['total']:>8.1f} {delta:>+7.1f} {pct:>+6.1f}% |"
          f" {A['ratio']:>7.2f} {B['ratio']:>7.2f} | {A['min_st']:>6} {B['min_st']:>6} | {t_ort:>5.1f}s")
    if n >= 120:
        rows_120_plus.append((n, v, A, B))

# ── Detail for 120, 150, 200 ────────────────────────────────────────────────────
print("\n=== Detailed comparison: 120 / 150 / 200 stores ===\n")
KEYS = [
    ("Total km",       "total",  ".1f"),
    ("Avg km/vehicle", "avg",    ".1f"),
    ("Max route km",   "mx",     ".1f"),
    ("Min route km",   "mn",     ".1f"),
    ("Ratio max/min",  "ratio",  ".2f"),
    ("Max stops",      "max_st", "d"),
    ("Min stops",      "min_st", "d"),
]
for n, v, A, B in rows_120_plus[:3]:  # 120, 150, 200 only
    print(f"  [{n} stores / {v} vehicles]")
    print(f"  {'Metric':<22} {'Before (A)':>11} {'After (B)':>11} {'Δ':>13}")
    print(f"  {'-'*57}")
    for lbl, k, fmt in KEYS:
        a, b = A[k], B[k]
        as_ = f"{int(a)}" if fmt == "d" else f"{a:{fmt}}"
        bs_ = f"{int(b)}" if fmt == "d" else f"{b:{fmt}}"
        if fmt != "d":
            d = b - a
            sg = "+" if d > 0 else ""
            pct = d / a * 100 if a else 0
            chg = f"{sg}{d:.2f} ({sg}{pct:.1f}%)"
        else:
            chg = f"{int(b)-int(a):+d}"
        print(f"  {lbl:<22} {as_:>11} {bs_:>11} {chg:>13}")
    print()

# ── Summary ─────────────────────────────────────────────────────────────────────
tot_A = sum(A["total"] for _,_,A,_ in rows_120_plus[:3])
tot_B = sum(B["total"] for _,_,_,B in rows_120_plus[:3])
rat_A = sum(A["ratio"] for _,_,A,_ in rows_120_plus[:3]) / 3
rat_B = sum(B["ratio"] for _,_,_,B in rows_120_plus[:3]) / 3
print("=== Summary (120+150+200 combined, controlled) ===")
print(f"  Total km:          {tot_A:.1f} → {tot_B:.1f}   Δ={tot_B-tot_A:+.1f} km ({(tot_B-tot_A)/tot_A*100:+.1f}%)")
print(f"  Avg ratio max/min: {rat_A:.2f} → {rat_B:.2f}   Δ={rat_B-rat_A:+.2f}")
bad = [(n,v,A,B) for n,v,A,B in rows_120_plus if B["ratio"] > 3.0]
if bad:
    print(f"\n  ⚠ Ratio > 3.0 in new code: {[(x[0],x[1]) for x in bad]}")
else:
    print("\n  ✓ All ratio max/min ≤ 3.0 in new code")
