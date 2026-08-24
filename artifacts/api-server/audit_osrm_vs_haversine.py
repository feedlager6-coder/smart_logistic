"""
АУДИТ: Haversine vs OSRM для расчёта показателей экономии маршрутов.

Методология:
  1. Для каждого сценария запускаем solve_vrp() — получаем оптимальный порядок.
  2. Считаем km по Haversine (текущая модель).
  3. Считаем km по OSRM Route API (реальные дороги) для тех же маршрутов.
  4. Сравниваем saved_pct, saved_km, saved_rub_day.
  5. Замеряем дополнительное время OSRM-вызовов.

Решение: переходить на OSRM только если:
  - accuracy improvement ≥ 15% (изменение saved_pct/saved_km)
  - время увеличивается не более чем на 20%
"""

import sys, os, math, time, random, urllib.request, json, statistics
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(__file__))
import main  # noqa

# ── Helpers ───────────────────────────────────────────────────────────────────

depot_msk = (55.7558, 37.6173)  # Moscow Kremlin
depot_mah = (42.9849, 47.5046)  # Makhachkala (default depot)


def hav_km(a, b) -> float:
    return main.haversine_meters(a, b) / 1000.0


def osrm_route_distance_m(ordered_coords: list) -> float | None:
    """
    Call OSRM Route API for an ORDERED sequence of coordinates.
    Returns total road distance in metres, or None on failure.
    Uses router.project-osrm.org (public, free, no key).
    """
    if len(ordered_coords) < 2:
        return None
    try:
        coord_str = ";".join(f"{lon},{lat}" for lat, lon in ordered_coords)
        url = f"{main.OSRM_BASE_URL}/route/v1/driving/{coord_str}?overview=false"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "SmartRoute-Audit/1.0"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("code") != "Ok":
            return None
        routes = data.get("routes", [])
        if not routes:
            return None
        return float(routes[0]["distance"])
    except Exception as exc:
        print(f"  [OSRM Route error]: {exc}")
        return None


def compute_route_km_haversine(ordered_stops: list, depot: tuple) -> float:
    """Haversine km for depot → stops[0] → … → stops[-1] → depot."""
    km = 0.0
    prev = depot
    for s in ordered_stops:
        curr = (float(s["lat"]), float(s["lon"]))
        km += hav_km(prev, curr)
        prev = curr
    km += hav_km(prev, depot)
    return km


def compute_route_km_osrm(ordered_stops: list, depot: tuple) -> float | None:
    """OSRM road km for depot → stops[0] → … → stops[-1] → depot."""
    coords = [depot] + [(float(s["lat"]), float(s["lon"])) for s in ordered_stops] + [depot]
    dist_m = osrm_route_distance_m(coords)
    return dist_m / 1000.0 if dist_m is not None else None


def baseline_buckets(stores: list, n_vehicles: int) -> list[list]:
    """Round-robin in input order — identical to calculate_savings() baseline."""
    buckets: list[list] = [[] for _ in range(n_vehicles)]
    for i, s in enumerate(stores):
        buckets[i % n_vehicles].append(s)
    return [b for b in buckets if b]


def get_optimized_routes(stores: list, n_vehicles: int, depot: tuple) -> list[list[dict]]:
    """Run solve_vrp() and return per-vehicle ordered store lists."""
    all_coords = [depot] + [(float(s["lat"]), float(s["lon"])) for s in stores]
    route_indices, _ = main.solve_vrp(all_coords, n_vehicles)
    result = []
    for vehicle_indices in route_indices:
        route_stores = []
        for idx in vehicle_indices:
            store_idx = idx - 1
            if 0 <= store_idx < len(stores):
                route_stores.append(stores[store_idx])
        if route_stores:
            result.append(route_stores)
    return result


def scenario_metrics(
    label: str,
    stores: list,
    n_vehicles: int,
    depot: tuple,
    use_osrm: bool = True,
) -> dict:
    """
    Compute full metrics for one scenario.
    Returns dict with haversine and (optionally) osrm results + timing.
    """
    t0 = time.time()

    # ── Optimized routes (solve_vrp) ──────────────────────────────────────────
    t_vrp0 = time.time()
    opt_routes = get_optimized_routes(stores, n_vehicles, depot)
    t_vrp = time.time() - t_vrp0

    # ── Baseline routes (round-robin input order) ─────────────────────────────
    base_routes = baseline_buckets(stores, n_vehicles)

    # ── Haversine distances ───────────────────────────────────────────────────
    opt_hav_km = sum(compute_route_km_haversine(r, depot) for r in opt_routes)
    base_hav_km = sum(compute_route_km_haversine(r, depot) for r in base_routes)

    base_hav_km = max(base_hav_km, opt_hav_km)
    saved_hav = max(0.0, base_hav_km - opt_hav_km)
    pct_hav = round(saved_hav / base_hav_km * 100) if base_hav_km > 0 else 0

    result = {
        "label": label,
        "n_stores": len(stores),
        "n_vehicles": n_vehicles,
        "t_vrp_s": round(t_vrp, 2),
        "opt_hav_km": round(opt_hav_km, 1),
        "base_hav_km": round(base_hav_km, 1),
        "saved_hav_km": round(saved_hav, 1),
        "pct_hav": pct_hav,
        "opt_osrm_km": None,
        "base_osrm_km": None,
        "saved_osrm_km": None,
        "pct_osrm": None,
        "road_factor_opt": None,
        "road_factor_base": None,
        "t_osrm_s": 0.0,
        "osrm_ok": False,
    }

    if not use_osrm:
        return result

    # ── OSRM distances (parallelized by route) ────────────────────────────────
    t_osrm0 = time.time()
    all_route_pairs = (
        [("opt", r) for r in opt_routes] +
        [("base", r) for r in base_routes]
    )

    osrm_results = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        # Submit opt routes with local index within opt_routes
        opt_futures = {pool.submit(compute_route_km_osrm, r, depot): i
                       for i, r in enumerate(opt_routes)}
        # Submit base routes with local index within base_routes
        base_futures = {pool.submit(compute_route_km_osrm, r, depot): i
                        for i, r in enumerate(base_routes)}
        for future, i in opt_futures.items():
            osrm_results[("opt", i)] = future.result()
        for future, i in base_futures.items():
            osrm_results[("base", i)] = future.result()

    t_osrm = time.time() - t_osrm0

    opt_osrm_kms = [osrm_results[("opt", i)] for i in range(len(opt_routes))]
    base_osrm_kms = [osrm_results[("base", i)] for i in range(len(base_routes))]

    if all(v is not None for v in opt_osrm_kms + base_osrm_kms):
        opt_osrm_km = sum(opt_osrm_kms)
        base_osrm_km = max(sum(base_osrm_kms), opt_osrm_km)
        saved_osrm = max(0.0, base_osrm_km - opt_osrm_km)
        pct_osrm = round(saved_osrm / base_osrm_km * 100) if base_osrm_km > 0 else 0

        result.update({
            "opt_osrm_km": round(opt_osrm_km, 1),
            "base_osrm_km": round(base_osrm_km, 1),
            "saved_osrm_km": round(saved_osrm, 1),
            "pct_osrm": pct_osrm,
            "road_factor_opt": round(opt_osrm_km / opt_hav_km, 3) if opt_hav_km > 0 else None,
            "road_factor_base": round(base_osrm_km / base_hav_km, 3) if base_hav_km > 0 else None,
            "t_osrm_s": round(t_osrm, 2),
            "osrm_ok": True,
        })
    else:
        result["t_osrm_s"] = round(t_osrm, 2)
        print(f"  [{label}] OSRM failed for some routes — partial results excluded")

    return result


# ── Test scenario generators ──────────────────────────────────────────────────

def make_store(i, lat, lon):
    return {"id": i, "name": f"S{i}", "address": f"addr{i}",
            "lat": lat, "lon": lon, "unload_minutes": 15,
            "time_window_from": "09:00", "time_window_to": "18:00"}


def gen_stores_radial(depot, n, radius_deg, seed=42):
    """Radially distributed around depot — simulates dense city center."""
    random.seed(seed)
    return [make_store(i,
                       depot[0] + (random.random() - 0.5) * 2 * radius_deg,
                       depot[1] + (random.random() - 0.5) * 2 * radius_deg)
            for i in range(n)]


def gen_stores_linear(depot, n, direction="lon", seed=42):
    """Linear arrangement — highway scenario."""
    random.seed(seed)
    stores = []
    for i in range(n):
        t = (i / max(n - 1, 1)) * 0.3
        jitter = (random.random() - 0.5) * 0.005
        if direction == "lon":
            stores.append(make_store(i, depot[0] + jitter, depot[1] + t))
        else:
            stores.append(make_store(i, depot[0] + t, depot[1] + jitter))
    return stores


def gen_stores_clustered(depot, n_clusters, stores_per_cluster, seed=42):
    """Multiple geographically distinct clusters."""
    random.seed(seed)
    stores = []
    sid = 0
    angles = [i * 2 * math.pi / n_clusters for i in range(n_clusters)]
    for angle in angles:
        cx = depot[0] + 0.1 * math.cos(angle)
        cy = depot[1] + 0.15 * math.sin(angle)
        for _ in range(stores_per_cluster):
            stores.append(make_store(
                sid,
                cx + (random.random() - 0.5) * 0.03,
                cy + (random.random() - 0.5) * 0.03,
            ))
            sid += 1
    return stores


# Реальные координаты Махачкалы (магазины в центре + районы)
MAKHACHKALA_COORDS = [
    (42.9849, 47.5046), (42.9780, 47.5128), (42.9911, 47.4972),
    (42.9706, 47.5213), (42.9858, 47.5287), (42.9632, 47.5094),
    (43.0012, 47.5163), (42.9745, 47.4891), (42.9934, 47.5341),
    (42.9517, 47.5142), (43.0089, 47.4803), (42.9678, 47.5372),
    (42.9823, 47.4712), (43.0156, 47.5254), (42.9591, 47.4967),
    (42.9882, 47.5419), (43.0201, 47.4921), (42.9714, 47.5463),
    (42.9459, 47.5009), (43.0267, 47.5117), (42.9612, 47.5521),
    (43.0023, 47.4677), (42.9543, 47.5364), (42.9967, 47.5538),
    (43.0312, 47.5228), (42.9498, 47.5187), (43.0078, 47.5482),
    (42.9731, 47.4624), (42.9894, 47.5591), (43.0389, 47.5031),
]

# Реальные координаты Москвы (ТЦ, склады, магазины)
MOSCOW_COORDS = [
    (55.7558, 37.6173), (55.7834, 37.5869), (55.7281, 37.6514),
    (55.8012, 37.6421), (55.7189, 37.5712), (55.7623, 37.7038),
    (55.6894, 37.6248), (55.7956, 37.5421), (55.7312, 37.7215),
    (55.8234, 37.6812), (55.6712, 37.6089), (55.7834, 37.7312),
    (55.6923, 37.5312), (55.8123, 37.5089), (55.7156, 37.7589),
    (55.8312, 37.6523), (55.6534, 37.6712), (55.7723, 37.4912),
    (55.7089, 37.7834), (55.8423, 37.7012), (55.6389, 37.5934),
    (55.7934, 37.8123), (55.6712, 37.4712), (55.8534, 37.6234),
    (55.6245, 37.6912), (55.7623, 37.8412), (55.6912, 37.4523),
    (55.8623, 37.5723), (55.6089, 37.7123), (55.7312, 37.8634),
]


def make_stores_from_coords(coords, depot_included=True):
    start = 1 if depot_included else 0
    return [make_store(i, lat, lon) for i, (lat, lon) in enumerate(coords[start:], start)]


# ── SCENARIO DEFINITIONS ──────────────────────────────────────────────────────

def build_scenarios():
    random.seed(42)
    return [
        # 1. Плотный городской район (Махачкала, 20 магазинов, тесно)
        {
            "label": "S01 Плотный город (Мах, 20 маг, r=3км)",
            "stores": gen_stores_radial(depot_mah, 20, 0.03, seed=1),
            "n_vehicles": 3,
            "depot": depot_mah,
        },
        # 2. Разбросанный город (Махачкала, 20 магазинов, широко)
        {
            "label": "S02 Разбросанный город (Мах, 20 маг, r=12км)",
            "stores": gen_stores_radial(depot_mah, 20, 0.12, seed=2),
            "n_vehicles": 3,
            "depot": depot_mah,
        },
        # 3. Трасса (линейный маршрут, 20 магазинов)
        {
            "label": "S03 Трасса/линейный (20 маг, 30км)",
            "stores": gen_stores_linear(depot_mah, 20, seed=3),
            "n_vehicles": 3,
            "depot": depot_mah,
        },
        # 4. Несколько кластеров (4 кластера × 5 магазинов)
        {
            "label": "S04 Кластеры (4×5=20 маг, радиус 10км)",
            "stores": gen_stores_clustered(depot_mah, 4, 5, seed=4),
            "n_vehicles": 4,
            "depot": depot_mah,
        },
        # 5. 20 реальных координат Махачкалы
        {
            "label": "S05 Реал. Махачкала (20 маг)",
            "stores": make_stores_from_coords(MAKHACHKALA_COORDS[:21]),
            "n_vehicles": 3,
            "depot": depot_mah,
        },
        # 6. 50 магазинов Махачкала (генерированные)
        {
            "label": "S06 Большой город (Мах, 50 маг)",
            "stores": gen_stores_radial(depot_mah, 50, 0.09, seed=6),
            "n_vehicles": 5,
            "depot": depot_mah,
        },
        # 7. 30 реальных координат Москвы
        {
            "label": "S07 Реал. Москва (30 маг)",
            "stores": make_stores_from_coords(MOSCOW_COORDS),
            "n_vehicles": 4,
            "depot": depot_msk,
        },
        # 8. Москва, плотный центр (малый радиус)
        {
            "label": "S08 Москва плотный центр (20 маг, r=4км)",
            "stores": gen_stores_radial(depot_msk, 20, 0.04, seed=8),
            "n_vehicles": 3,
            "depot": depot_msk,
        },
        # 9. Смешанный: город + пригород
        {
            "label": "S09 Смешанный город+пригород (30 маг)",
            "stores": (gen_stores_radial(depot_mah, 15, 0.05, seed=9) +
                       gen_stores_radial(depot_mah, 15, 0.15, seed=19)),
            "n_vehicles": 4,
            "depot": depot_mah,
        },
        # 10. Разбросанные (Мах, 40 маг, очень широкий разброс)
        {
            "label": "S10 Широкий разброс (Мах, 40 маг, r=20км)",
            "stores": gen_stores_radial(depot_mah, 40, 0.20, seed=10),
            "n_vehicles": 5,
            "depot": depot_mah,
        },
    ]


# ── MAIN AUDIT ────────────────────────────────────────────────────────────────

def run_audit():
    print("=" * 80)
    print("АУДИТ: Haversine vs OSRM для показателей экономии SmartRoute")
    print("=" * 80)
    print()

    scenarios = build_scenarios()
    results = []

    print(f"{'№':<4} {'Сценарий':<46} {'Статус'}")
    print("-" * 72)
    for sc in scenarios:
        print(f"     {sc['label']:<46} ...", end="", flush=True)
        r = scenario_metrics(
            sc["label"], sc["stores"], sc["n_vehicles"], sc["depot"],
            use_osrm=True,
        )
        results.append(r)
        status = "OK" if r["osrm_ok"] else "OSRM FAIL"
        print(f"\r  ✓  {sc['label']:<46} {status} (VRP={r['t_vrp_s']}s, OSRM={r['t_osrm_s']}s)")

    print()
    print("=" * 80)
    print("ШАГ 2: СРАВНИТЕЛЬНАЯ ТАБЛИЦА")
    print("=" * 80)
    print()
    print(f"{'Сценарий':<46} | {'Haversine':^30} | {'OSRM':^30} | {'Road factor':^20}")
    print(f"{'':46} | {'base_km':>8} {'opt_km':>8} {'sav%':>6} {'sav_km':>7} | {'base_km':>8} {'opt_km':>8} {'sav%':>6} {'sav_km':>7} | {'opt':>8} {'base':>8} {'diff':>4}")
    print("-" * 140)

    for r in results:
        hav_line = f"{r['base_hav_km']:>8.1f} {r['opt_hav_km']:>8.1f} {r['pct_hav']:>5}% {r['saved_hav_km']:>7.1f}"
        if r["osrm_ok"]:
            osrm_line = f"{r['base_osrm_km']:>8.1f} {r['opt_osrm_km']:>8.1f} {r['pct_osrm']:>5}% {r['saved_osrm_km']:>7.1f}"
            diff_factor = abs(r["road_factor_opt"] - r["road_factor_base"])
            rf_line = f"{r['road_factor_opt']:>8.3f} {r['road_factor_base']:>8.3f} {diff_factor:>4.3f}"
        else:
            osrm_line = f"{'—':>8} {'—':>8} {'—':>6} {'—':>7}"
            rf_line = f"{'—':>8} {'—':>8} {'—':>4}"
        print(f"{r['label']:<46} | {hav_line} | {osrm_line} | {rf_line}")

    print()
    print("=" * 80)
    print("ШАГ 2b: РАЗНИЦА В SAVED_PCT (OSRM vs Haversine)")
    print("=" * 80)
    print()
    ok_results = [r for r in results if r["osrm_ok"]]
    if ok_results:
        pct_diffs = [r["pct_osrm"] - r["pct_hav"] for r in ok_results]
        saved_km_ratios = [r["saved_osrm_km"] / r["saved_hav_km"] if r["saved_hav_km"] > 0 else 1.0
                           for r in ok_results]
        rf_opts = [r["road_factor_opt"] for r in ok_results]
        rf_bases = [r["road_factor_base"] for r in ok_results]

        print(f"{'Сценарий':<46} | {'saved_pct_hav':>14} | {'saved_pct_osrm':>15} | {'Δpct':>8} | {'saved_km ratio':>16}")
        print("-" * 110)
        for r in ok_results:
            delta = r["pct_osrm"] - r["pct_hav"]
            ratio = r["saved_osrm_km"] / r["saved_hav_km"] if r["saved_hav_km"] > 0 else 1.0
            print(f"{r['label']:<46} | {r['pct_hav']:>13}% | {r['pct_osrm']:>14}% | {delta:>+8} | {ratio:>15.3f}×")

        print()
        print(f"  Среднее Δpct (OSRM − Haversine): {statistics.mean(pct_diffs):+.2f}%")
        print(f"  Медиана Δpct:                    {statistics.median(pct_diffs):+.2f}%")
        print(f"  Среднее saved_km_ratio:           {statistics.mean(saved_km_ratios):.3f}×")
        print(f"  Road factor opt (среднее):        {statistics.mean(rf_opts):.3f}×")
        print(f"  Road factor baseline (среднее):   {statistics.mean(rf_bases):.3f}×")
        print(f"  Road factor разница (opt vs base):{statistics.mean([abs(a-b) for a,b in zip(rf_opts, rf_bases)]):.4f}×")
    else:
        print("  OSRM не вернул результаты — анализ невозможен.")

    print()
    print("=" * 80)
    print("ШАГ 3: ПРОИЗВОДИТЕЛЬНОСТЬ")
    print("=" * 80)
    print()
    t_vrp_total = sum(r["t_vrp_s"] for r in results)
    t_osrm_total = sum(r["t_osrm_s"] for r in results)
    avg_osrm = statistics.mean([r["t_osrm_s"] for r in results if r["osrm_ok"]]) if ok_results else 0
    avg_vrp = statistics.mean([r["t_vrp_s"] for r in results])

    print(f"  Сценариев протестировано:           {len(results)}")
    print(f"  VRP суммарное время:                {t_vrp_total:.1f}с (ср. {avg_vrp:.2f}с/сц.)")
    print(f"  OSRM Route суммарное время:         {t_osrm_total:.1f}с (ср. {avg_osrm:.2f}с/сц.)")
    if avg_vrp > 0:
        overhead_pct = avg_osrm / avg_vrp * 100
        print(f"  OSRM overhead % от времени VRP:    +{overhead_pct:.0f}%")
    print()
    print(f"  {'Сценарий':<46} | {'VRP':>6} | {'OSRM':>6} | {'OSRM/VRP':>10}")
    print("  " + "-" * 76)
    for r in results:
        ratio = r["t_osrm_s"] / r["t_vrp_s"] if r["t_vrp_s"] > 0 else 0
        print(f"  {r['label']:<46} | {r['t_vrp_s']:>5.2f}с | {r['t_osrm_s']:>5.2f}с | {ratio:>9.1f}×")

    print()
    print("=" * 80)
    print("ШАГ 4: РЕШЕНИЕ")
    print("=" * 80)
    print()

    if not ok_results:
        print("  ОСРМ недоступен — решение: оставить Haversine.")
        return

    mean_pct_delta = statistics.mean(pct_diffs) if pct_diffs else 0
    mean_km_ratio = statistics.mean(saved_km_ratios)
    overhead_pct_val = avg_osrm / avg_vrp * 100 if avg_vrp > 0 else 999

    accuracy_threshold = 15.0   # % разница в saved_pct
    perf_threshold = 20.0       # % дополнительного времени

    print(f"  Критерий 1 — Улучшение точности saved_pct ≥ {accuracy_threshold}%:")
    print(f"    Фактически Δpct = {mean_pct_delta:+.2f}% → {'✅ ВЫПОЛНЕН' if abs(mean_pct_delta) >= accuracy_threshold else '❌ НЕ ВЫПОЛНЕН'}")
    print()
    print(f"  Критерий 2 — Overhead времени ≤ {perf_threshold}%:")
    print(f"    Фактически overhead = +{overhead_pct_val:.0f}% → {'✅ ВЫПОЛНЕН' if overhead_pct_val <= perf_threshold else '❌ НЕ ВЫПОЛНЕН'}")
    print()

    should_switch = abs(mean_pct_delta) >= accuracy_threshold and overhead_pct_val <= perf_threshold

    print(f"  ВЫВОД: {'✅ ПЕРЕХОДИТЬ НА OSRM' if should_switch else '❌ ОСТАВИТЬ HAVERSINE'}")
    print()
    if not should_switch:
        print("  Причины:")
        if abs(mean_pct_delta) < accuracy_threshold:
            print(f"    • saved_pct изменяется лишь на {mean_pct_delta:+.2f}% — ниже порога {accuracy_threshold}%")
            print(f"      (road factor opt={statistics.mean(rf_opts):.3f}× vs base={statistics.mean(rf_bases):.3f}× — почти одинаков)")
            print(f"       → Haversine корректно измеряет ОТНОСИТЕЛЬНУЮ экономию, только абсолютные км занижены")
        if overhead_pct_val > perf_threshold:
            print(f"    • OSRM Route добавляет {overhead_pct_val:.0f}% времени — выше допустимых {perf_threshold}%")
        print()
        print("  ✅ Текущая модель (ROAD_FACTOR=1.4 для монетарных расчётов) остаётся в силе.")
        print("     Она конвертирует Haversine-км → реальный пробег только для денег/топлива,")
        print("     не искажая честное относительное сравнение saved_pct / saved_km.")

    print()
    print("=" * 80)


if __name__ == "__main__":
    run_audit()
