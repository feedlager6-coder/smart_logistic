"""
Clustering Audit — SmartRoute
==============================
Compares 4 clustering strategies across 8 geographic scenarios.

For speed, TSP within each cluster is solved by a fast greedy
nearest-neighbour heuristic (not OR-Tools).  The key variable under test
is cluster assignment, not intra-cluster sequencing.  Inter-route relocate
(same as production, max 3 passes) is applied equally to all methods.

Methods
-------
  sweep          — current production: equal-angle sectors + centroid refinement
  bal_sweep      — balanced sweep: sort by angle, equal-count slices
  depot_kmeans   — k-means initialised on arc around depot (no balance)
  bal_kmeans     — depot k-means + greedy rebalancing (target ±30%)

Scenarios
---------
  S1  50  stores, one district (dense patch)
  S2  100 stores, one district (dense patch)
  S3  50  stores along highway (linear E-W)
  S4  100 stores along highway (linear E-W)
  S5  40  stores, 2 dense clusters far apart
  S6  45  stores, 3 dense clusters far apart
  S7  60  stores, random city distribution
  S8  48  stores, real Makhachkala landmarks

Decision rule
-------------
  Adopt new method if across all 8 scenarios it achieves:
    • ≥ 10% less total km (avg)  — OR —
    • ≥ 30% spread reduction on scenarios where current spread ≥ 6

Usage
-----
  python3 scripts/test_clustering_audit.py
"""

import sys, os, time, math, random
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "artifacts", "api-server"))

import main as _main_mod

# Force Haversine-only: no network calls, fully reproducible
_main_mod.get_cluster_matrix_gh   = lambda coords: None
_main_mod.get_cluster_matrix_osrm = lambda coords: None

import logging
logging.getLogger("main").setLevel(logging.WARNING)

from main import (
    haversine_meters,
    _build_haversine_matrix,
    _inter_route_relocate,
    _cluster_by_sweep,
)

DEPOT  = (42.9849, 47.5046)
random.seed(42)


# ══════════════════════════════════════════════════════════════════════════════
# Greedy nearest-neighbour TSP  (replaces OR-Tools for benchmark speed)
# ══════════════════════════════════════════════════════════════════════════════

def _greedy_tsp(cluster_nodes, matrix):
    """
    Nearest-neighbour TSP starting from depot (node 0) and returning to depot.
    cluster_nodes contains GLOBAL node indices (matching the full matrix).
    Returns cluster_nodes in visit order.
    """
    if len(cluster_nodes) <= 1:
        return list(cluster_nodes)
    unvisited = list(cluster_nodes)
    route, current = [], 0  # start at depot
    while unvisited:
        nearest = min(unvisited, key=lambda n: matrix[current][n])
        route.append(nearest)
        current = nearest
        unvisited.remove(nearest)
    return route


# ══════════════════════════════════════════════════════════════════════════════
# Alternative clustering methods
# ══════════════════════════════════════════════════════════════════════════════

def _angle(node_idx, all_coords):
    lat, lon = all_coords[node_idx]
    depot = all_coords[0]
    return math.atan2(lon - depot[1], lat - depot[0])


def cluster_sweep(store_indices, all_coords, num_vehicles):
    """Current production sweep (imported from main)."""
    return _cluster_by_sweep(store_indices, all_coords, num_vehicles)


def cluster_bal_sweep(store_indices, all_coords, num_vehicles):
    """
    Balanced sweep: sort by polar angle, slice into equal-count chunks.
    Guarantees each vehicle gets ⌊n/k⌋ or ⌈n/k⌉ stops.
    """
    if not store_indices:
        return []
    k = max(1, num_vehicles)
    sorted_nodes = sorted(store_indices, key=lambda n: _angle(n, all_coords))
    n = len(sorted_nodes)
    base, extra = divmod(n, k)
    clusters, pos = [], 0
    for i in range(k):
        size = base + (1 if i < extra else 0)
        if size:
            clusters.append(sorted_nodes[pos: pos + size])
        pos += size
    return [c for c in clusters if c]


def cluster_depot_kmeans(store_indices, all_coords, num_vehicles, max_iter=25):
    """
    K-means with centroids initialised on a circle around the depot.
    No size constraint — purely geographic convergence.
    """
    if not store_indices:
        return []
    k, depot = max(1, num_vehicles), all_coords[0]
    avg_r = sum(haversine_meters(depot, all_coords[n]) for n in store_indices) / len(store_indices)
    r_lat = avg_r / 111_320
    r_lon = avg_r / (111_320 * math.cos(math.radians(depot[0])))
    centroids = [
        (depot[0] + r_lat * math.sin(2*math.pi*i/k),
         depot[1] + r_lon * math.cos(2*math.pi*i/k))
        for i in range(k)
    ]
    clusters = [[] for _ in range(k)]
    for _ in range(max_iter):
        new_c = [[] for _ in range(k)]
        for nd in store_indices:
            coord = all_coords[nd]
            best = min(range(k), key=lambda i: haversine_meters(coord, centroids[i]))
            new_c[best].append(nd)
        changed = False
        for i, cl in enumerate(new_c):
            if cl:
                nc = (sum(all_coords[n][0] for n in cl)/len(cl),
                      sum(all_coords[n][1] for n in cl)/len(cl))
                if nc != centroids[i]:
                    centroids[i] = nc
                    changed = True
        clusters = new_c
        if not changed:
            break
    return _fill_empty(clusters, store_indices, all_coords, k)


def cluster_bal_kmeans(store_indices, all_coords, num_vehicles, max_iter=25):
    """
    Depot-aware k-means with greedy rebalancing.
    After each assignment step, over-capacity clusters donate 'border' stores
    (closest to an under-capacity centroid) until sizes are within ±30% of target.
    """
    if not store_indices:
        return []
    k, depot = max(1, num_vehicles), all_coords[0]
    n = len(store_indices)
    target = n / k
    hi = math.ceil(target * 1.30) + 1
    lo = max(1, int(target * 0.70))

    avg_r = sum(haversine_meters(depot, all_coords[nd]) for nd in store_indices) / n
    r_lat = avg_r / 111_320
    r_lon = avg_r / (111_320 * math.cos(math.radians(depot[0])))
    centroids = [
        (depot[0] + r_lat * math.sin(2*math.pi*i/k),
         depot[1] + r_lon * math.cos(2*math.pi*i/k))
        for i in range(k)
    ]
    clusters = [[] for _ in range(k)]
    for _ in range(max_iter):
        new_c = [[] for _ in range(k)]
        for nd in store_indices:
            coord = all_coords[nd]
            best = min(range(k), key=lambda i: haversine_meters(coord, centroids[i]))
            new_c[best].append(nd)

        # Greedy rebalancing
        for _ in range(k * 3):
            over  = [i for i in range(k) if len(new_c[i]) > hi]
            under = [i for i in range(k) if len(new_c[i]) < lo]
            if not over or not under:
                break
            oi, ui = over[0], under[0]
            # Move store in oi closest to centroid[ui]
            new_c[oi].sort(key=lambda nd: haversine_meters(all_coords[nd], centroids[ui]))
            new_c[ui].append(new_c[oi].pop(0))

        changed = False
        for i, cl in enumerate(new_c):
            if cl:
                nc = (sum(all_coords[n][0] for n in cl)/len(cl),
                      sum(all_coords[n][1] for n in cl)/len(cl))
                if nc != centroids[i]:
                    centroids[i] = nc
                    changed = True
        clusters = new_c
        if not changed:
            break
    return _fill_empty(clusters, store_indices, all_coords, k)


def _fill_empty(clusters, store_indices, all_coords, k):
    """Split oversized clusters to fill any empty slots."""
    non_empty = [c for c in clusters if c]
    while len(non_empty) < k and any(len(c) > 1 for c in non_empty):
        li = max(range(len(non_empty)), key=lambda i: len(non_empty[i]))
        half = len(non_empty[li]) // 2
        non_empty.append(non_empty[li][half:])
        non_empty[li] = non_empty[li][:half]
    return [c for c in non_empty if c]


# ══════════════════════════════════════════════════════════════════════════════
# VRP pipeline (greedy TSP + inter-route relocate)
# ══════════════════════════════════════════════════════════════════════════════

METHODS = [
    ("sweep",       cluster_sweep),
    ("bal_sweep",   cluster_bal_sweep),
    ("depot_kmeans", cluster_depot_kmeans),
    ("bal_kmeans",  cluster_bal_kmeans),
]


def run_vrp(all_coords, num_vehicles, clustering_fn):
    """
    Full VRP pipeline:
      1. Haversine matrix
      2. Cluster (using clustering_fn)
      3. Fill unused vehicles
      4. Greedy NN-TSP per cluster
      5. Inter-route relocate (≤3 passes)
    """
    t0 = time.time()
    store_indices = list(range(1, len(all_coords)))
    full_matrix   = _build_haversine_matrix(all_coords)

    clusters = clustering_fn(store_indices, all_coords, num_vehicles)

    # Fill unused vehicles by splitting largest cluster
    while len(clusters) < num_vehicles and any(len(c) > 1 for c in clusters):
        li = max(range(len(clusters)), key=lambda i: len(clusters[i]))
        if len(clusters[li]) < 2:
            break
        srt = sorted(clusters[li], key=lambda n: _angle(n, all_coords))
        mid = len(srt) // 2
        clusters[li] = srt[:mid]
        clusters.append(srt[mid:])

    # Greedy TSP per cluster
    routes = []
    for cl in clusters:
        if not cl:
            continue
        routes.append(_greedy_tsp(cl, full_matrix))

    # Inter-route relocate (3 passes max)
    if len(routes) > 1 and len(store_indices) <= 120:
        routes = _inter_route_relocate(routes, full_matrix, max_iter=3)

    elapsed = time.time() - t0
    return routes, elapsed, full_matrix


def route_km(routes, matrix):
    total = 0.0
    for r in routes:
        if not r:
            continue
        total += matrix[0][r[0]] + matrix[r[-1]][0]
        for a, b in zip(r, r[1:]):
            total += matrix[a][b]
    return total / 1000.0


def naive_km(stores, num_vehicles, depot_coord):
    all_coords = [depot_coord] + stores
    k = max(1, num_vehicles)
    matrix = _build_haversine_matrix(all_coords)
    buckets = [list(range(1, len(stores)+1))[i::k] for i in range(k)]
    return route_km([b for b in buckets if b], matrix)


# ══════════════════════════════════════════════════════════════════════════════
# Scenarios
# ══════════════════════════════════════════════════════════════════════════════

def jitter(lat, lon, r=400):
    dlat = random.gauss(0, r / 111_320)
    dlon = random.gauss(0, r / (111_320 * math.cos(math.radians(lat))))
    return (lat + dlat, lon + dlon)

def highway(n, lat0, lon0, lat1, lon1, spread=120):
    return [jitter(lat0+(lat1-lat0)*i/max(n-1,1),
                   lon0+(lon1-lon0)*i/max(n-1,1), spread) for i in range(n)]

def dense(n, lat, lon, r=500):
    return [jitter(lat, lon, r) for _ in range(n)]

SCENARIOS = [
    # (name, stores, vehicles)
    ("S1  50 магаз / 1 район",
     dense(50, 43.010, 47.510, r=700), 4),

    ("S2  100 магаз / 1 район",
     dense(100, 43.010, 47.510, r=700), 6),

    ("S3  50 магаз / трасса Е-З",
     highway(50, 42.985, 47.420, 42.985, 47.590, 120), 4),

    ("S4  100 магаз / трасса Е-З",
     highway(100, 42.985, 47.390, 42.985, 47.620, 120), 6),

    ("S5  40 магаз / 2 кластера",
     dense(20, 43.015, 47.460, 600) + dense(20, 42.950, 47.560, 600), 4),

    ("S6  45 магаз / 3 кластера",
     dense(15, 43.015, 47.460, 450) +
     dense(15, 42.950, 47.460, 450) +
     dense(15, 42.985, 47.575, 450), 6),

    ("S7  60 магаз / случайно",
     [(42.96 + random.uniform(0, 0.07),
       47.48 + random.uniform(0, 0.09)) for _ in range(60)], 5),

    ("S8  48 магаз / реальная Махачкала",
     [
        (42.9830,47.4980),(42.9835,47.5010),(42.9820,47.5025),(42.9845,47.4995),
        (42.9815,47.4970),(42.9855,47.5030),(42.9810,47.5040),(42.9860,47.5000),
        (43.0050,47.5040),(43.0070,47.5080),(43.0020,47.5010),(43.0090,47.5060),
        (43.0030,47.5100),(43.0060,47.5020),(43.0080,47.5090),(43.0040,47.5070),
        (42.9620,47.4920),(42.9580,47.4880),(42.9650,47.4960),(42.9560,47.4850),
        (42.9670,47.4990),(42.9590,47.4910),(42.9640,47.4940),(42.9600,47.4870),
        (42.9900,47.5550),(42.9920,47.5600),(42.9880,47.5520),(42.9940,47.5580),
        (42.9870,47.5490),(42.9930,47.5540),(42.9910,47.5570),(42.9890,47.5510),
        (42.9950,47.4750),(42.9970,47.4720),(42.9930,47.4780),(42.9980,47.4700),
        (42.9920,47.4810),(42.9960,47.4760),(42.9940,47.4730),(42.9910,47.4790),
        (43.0180,47.4650),(43.0150,47.4680),(43.0200,47.4620),(43.0130,47.4710),
        (42.9750,47.5100),(42.9780,47.5180),(42.9720,47.5050),(42.9800,47.5220),
     ], 5),
]


# ══════════════════════════════════════════════════════════════════════════════
# Runner + reporting
# ══════════════════════════════════════════════════════════════════════════════

W = 96  # table width


def run_all():
    all_results = []     # [(name, stores, vehicles, {method: metrics})]

    for name, stores, vehicles in SCENARIOS:
        all_coords  = [DEPOT] + stores
        naive       = naive_km(stores, vehicles, DEPOT)
        method_data = {}

        for mname, mfn in METHODS:
            routes, elapsed, matrix = run_vrp(all_coords, vehicles, mfn)
            km      = route_km(routes, matrix)
            counts  = sorted([len(r) for r in routes], reverse=True)
            spread  = (counts[0] - counts[-1]) if len(counts) > 1 else 0
            savings = round((naive - km) / naive * 100, 1) if naive > 0 else 0.0
            method_data[mname] = dict(
                km=round(km, 2), elapsed=round(elapsed, 3),
                n_routes=len(routes), distribution=counts,
                spread=spread, savings_pct=savings, naive_km=round(naive, 2),
            )

        all_results.append((name, stores, vehicles, method_data))

        # Per-scenario table
        print(f"\n{'═'*W}")
        print(f"  {name}   ({len(stores)} маг / {vehicles} маш)")
        print(f"{'═'*W}")
        print(f"  {'Метод':<14} {'км':>7} {'vs sweep':>9} {'экон%':>7} {'с':>5} "
              f"{'маш':>4}  {'разброс':>7}  распред.")
        print(f"  {'-'*(W-2)}")
        sweep_km = method_data["sweep"]["km"]
        for mname, _ in METHODS:
            d = method_data[mname]
            vs = ""
            if mname != "sweep" and sweep_km > 0:
                delta = (d["km"] - sweep_km) / sweep_km * 100
                vs = f"{'+' if delta>=0 else ''}{delta:.1f}%"
            dist_s = str(d["distribution"])
            if len(dist_s) > 30:
                dist_s = dist_s[:27] + "..."
            marker = " ◄" if mname == "sweep" else ""
            print(f"  {mname:<14} {d['km']:>7.2f} {vs:>9} {d['savings_pct']:>6.1f}% "
                  f"{d['elapsed']:>5.2f} {d['n_routes']:>4}  {d['spread']:>7}  "
                  f"{dist_s}{marker}")

    return all_results


def aggregate(all_results):
    """Return per-method averages."""
    agg = {m: dict(km=[], vs_sweep=[], spread=[], savings=[], elapsed=[])
           for m, _ in METHODS}
    for name, stores, vehicles, mdata in all_results:
        sw_km = mdata["sweep"]["km"]
        for mname, _ in METHODS:
            d = mdata[mname]
            agg[mname]["km"].append(d["km"])
            agg[mname]["vs_sweep"].append(
                (d["km"] - sw_km) / sw_km * 100 if sw_km > 0 else 0)
            agg[mname]["spread"].append(d["spread"])
            agg[mname]["savings"].append(d["savings_pct"])
            agg[mname]["elapsed"].append(d["elapsed"])
    return {m: {k: sum(v)/len(v) for k, v in vals.items() if v}
            for m, vals in agg.items()}


def decide(all_results, agg):
    """Apply decision rule; return list of (method, reason) or []."""
    candidates = []
    for mname, _ in METHODS:
        if mname == "sweep":
            continue
        avg_vs = agg[mname]["vs_sweep"]

        # Condition 1: ≥10% km improvement
        if avg_vs <= -10.0:
            candidates.append((mname, f"км улучшение {-avg_vs:.1f}% ≥ 10%"))
            continue

        # Condition 2: spread ≥30% better on high-imbalance scenarios
        hi_scenarios = [(n, md) for (n, _, _, md) in all_results
                        if md["sweep"]["spread"] >= 6]
        if hi_scenarios:
            reductions = []
            for _, md in hi_scenarios:
                sw_sp = md["sweep"]["spread"]
                me_sp = md[mname]["spread"]
                if sw_sp > 0:
                    reductions.append((sw_sp - me_sp) / sw_sp * 100)
            if reductions:
                avg_r = sum(reductions) / len(reductions)
                if avg_r >= 30.0:
                    candidates.append((mname,
                        f"разброс −{avg_r:.0f}% на {len(hi_scenarios)} несбаланс. сцен."))
    return candidates


if __name__ == "__main__":
    print(f"\n{'═'*W}")
    print("SmartRoute — Аудит качества кластеризации")
    print("Методы : sweep (текущий) · bal_sweep · depot_kmeans · bal_kmeans")
    print("TSP    : жадный NN (не OR-Tools) — измеряем КЛАСТЕРИЗАЦИЮ, не TSP")
    print("Матрица: Haversine (без сети, воспроизводимо)")
    print(f"{'═'*W}")

    all_results = run_all()

    agg = aggregate(all_results)

    print(f"\n{'═'*W}")
    print("СВОДНАЯ ТАБЛИЦА (средние по 8 сценариям)")
    print(f"{'═'*W}")
    print(f"  {'Метод':<14} {'ср. км':>8} {'vs sweep':>10} {'ср. экон%':>10} "
          f"{'ср. разброс':>12} {'ср. с':>8}")
    print(f"  {'-'*70}")
    for mname, _ in METHODS:
        a = agg[mname]
        sign = "+" if a["vs_sweep"] >= 0 else ""
        tag  = "  ← текущий" if mname == "sweep" else ""
        print(f"  {mname:<14} {a['km']:>8.2f} {sign}{a['vs_sweep']:>8.1f}% "
              f"{a['savings']:>9.1f}% {a['spread']:>11.1f} {a['elapsed']:>7.3f}s{tag}")

    # Imbalance breakdown
    hi_scenarios = [(n, md) for (n, _, _, md) in all_results
                    if md["sweep"]["spread"] >= 6]
    print(f"\n{'═'*W}")
    print(f"ДИСБАЛАНС — сценарии со spread ≥ 6 у sweep ({len(hi_scenarios)} из {len(all_results)})")
    print(f"{'═'*W}")
    if hi_scenarios:
        for sname, md in hi_scenarios:
            print(f"\n  {sname}")
            print(f"  {'Метод':<14} {'разброс':>8}  {'распред.'}")
            print(f"  {'-'*60}")
            for mname, _ in METHODS:
                d = md[mname]
                tag = " ◄" if mname == "sweep" else ""
                print(f"  {mname:<14} {d['spread']:>8}  {d['distribution']}{tag}")
    else:
        print("  Все сценарии сбалансированы (spread < 6 у sweep).")

    # Decision
    candidates = decide(all_results, agg)
    print(f"\n{'═'*W}")
    print("РЕШЕНИЕ")
    print(f"{'═'*W}")
    if not candidates:
        print("  ✅  Текущая кластеризация (sweep) ОСТАВЛЕНА.")
        print("      Ни один метод не достигает:")
        print("        • avg km улучшение ≥ 10%, или")
        print("        • разброс −30%+ на несбалансированных сценариях.")
    else:
        best = min(candidates, key=lambda x: agg[x[0]]["km"])
        print(f"  ⚠️  РЕКОМЕНДУЕТСЯ внедрить: {best[0]}")
        print(f"      Причина: {best[1]}")
        for mname, reason in candidates:
            print(f"      • {mname}: {reason}")

    # Commercial readiness summary
    print(f"\n{'═'*W}")
    print("ГОТОВНОСТЬ К КОММЕРЧЕСКОМУ ИСПОЛЬЗОВАНИЮ")
    print(f"{'═'*W}")
    sweep_agg = agg["sweep"]
    print(f"  Средняя экономия vs наивный baseline : {sweep_agg['savings']:.1f}%")
    print(f"  Средний разброс нагрузки             : {sweep_agg['spread']:.1f} стопов")
    print(f"  Среднее время кластеризации + relocate: {sweep_agg['elapsed']:.3f} с")
    fastest = min(agg[m]["elapsed"] for m, _ in METHODS)
    print(f"  (самый быстрый альтернативный метод  : {fastest:.3f} с)")
    print(f"{'═'*W}\n")
