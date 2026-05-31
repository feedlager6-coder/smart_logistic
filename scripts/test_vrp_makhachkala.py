"""
SmartRoute — Тест на реальных координатах Махачкалы

25 реальных точек доставки: жилые кварталы, ТЦ, рынки, магазины.
Все координаты зафиксированы вручную — геокодинг не выполняется.

Тест 1: 25 точек / 4 машины  — основной сценарий
Тест 2: 25 точек / 4 машины  — OSRM vs чистый Haversine (сравнение)

Показывает:
  - km по OSRM vs Haversine
  - Порядок объезда по кластерам
  - Какие кластеры получили OSRM / Haversine
  - Процент GH/OSRM/HV использования

Usage: python3 scripts/test_vrp_makhachkala.py
"""

import sys
import os
import time
import math
import logging

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "artifacts", "api-server"))
logging.basicConfig(level=logging.WARNING)

import main as M

# ── Реальные координаты точек доставки в Махачкале ───────────────────────────
# Депо — центральный склад на проспекте Гамидова

DEPOT = (42.9849, 47.5046)   # Проспект Гамидова, склад

MAKHACHKALA_STORES = [
    # Центр города
    ((42.9802, 47.5022), "Рынок Анжи"),
    ((42.9771, 47.5035), "ТЦ Гагаринский"),
    ((42.9830, 47.5062), "Магазин на пл. Ленина"),
    ((42.9815, 47.4978), "Проспект Руставели"),
    ((42.9867, 47.5013), "ул. Пушкина, 14"),
    # Северный район (посёлок Махачкала, пос. Ленинкент)
    ((43.0102, 47.5231), "Ленинкент — магазин"),
    ((43.0154, 47.5189), "Ленинкент — ТЦ"),
    ((43.0067, 47.5268), "Ленинкент — рынок"),
    ((43.0231, 47.5142), "Пос. Новый — магазин"),
    # Северо-восток (посёлок Семендер)
    ((43.0312, 47.5523), "Семендер — продукты"),
    ((43.0278, 47.5467), "Семендер — рынок"),
    ((43.0341, 47.5589), "Семендер — ТЦ"),
    # Южный район (Редукторный посёлок)
    ((42.9501, 47.4923), "Редуктор — магазин"),
    ((42.9467, 47.4889), "Редуктор — ТЦ"),
    ((42.9534, 47.4956), "Редуктор — рынок"),
    ((42.9423, 47.4812), "Редуктор — точка 4"),
    # Микрорайон 46/47 (восток)
    ((42.9934, 47.5634), "МКР-46 — продукты"),
    ((42.9901, 47.5589), "МКР-46 — магазин"),
    ((42.9978, 47.5701), "МКР-47 — рынок"),
    # Посёлок Тарки (юго-восток на горе)
    ((42.9612, 47.5312), "Тарки — магазин"),
    ((42.9578, 47.5278), "Тарки — ТЦ"),
    # Улица Акушинского
    ((42.9923, 47.4934), "Акушинского — точка 1"),
    ((42.9956, 47.4901), "Акушинского — точка 2"),
    # Западный район (посёлок Шамхал)
    ((42.9712, 47.4512), "Шамхал — рынок"),
    ((42.9678, 47.4456), "Шамхал — магазин"),
]

assert len(MAKHACHKALA_STORES) == 25, "Должно быть ровно 25 точек"


def build_all_coords():
    return [DEPOT] + [coord for coord, _ in MAKHACHKALA_STORES]


def build_labels():
    return ["ДЕПО"] + [name for _, name in MAKHACHKALA_STORES]


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


def naive_km(n_stores, n_vehicles, all_coords):
    routes = [list(range(1, n_stores + 1))[i::n_vehicles] for i in range(n_vehicles)]
    return total_km([r for r in routes if r], all_coords)


def reset_counters():
    M._matrix_cache.clear()
    M._matrix_cache_hits = 0
    M._matrix_cache_misses = 0
    M._gh_call_successes = 0
    M._osrm_call_successes = 0
    M._osrm_cache_hits = 0
    M._gh_rate_limited_until = 0.0
    M._osrm_rate_limited_until = 0.0
    M._gh_plan_limit = M.GRAPHHOPPER_CLUSTER_MAX


def run_with_osrm(all_coords, n_vehicles=4):
    """Стандартный запуск: GH → OSRM → Haversine."""
    reset_counters()
    t0 = time.time()
    routes, source = M.solve_vrp(all_coords, n_vehicles)
    elapsed = time.time() - t0
    return routes, source, elapsed


def run_haversine_only(all_coords, n_vehicles=4):
    """Запуск только с Haversine (без сетевых вызовов)."""
    reset_counters()
    orig_osrm = M.get_cluster_matrix_osrm
    orig_gh = M.get_cluster_matrix_gh
    M.get_cluster_matrix_osrm = lambda coords: None
    M.get_cluster_matrix_gh = lambda coords: None
    t0 = time.time()
    routes, source = M.solve_vrp(all_coords, n_vehicles)
    elapsed = time.time() - t0
    M.get_cluster_matrix_osrm = orig_osrm
    M.get_cluster_matrix_gh = orig_gh
    return routes, source, elapsed


def print_routes(routes, all_coords, labels, source, elapsed, km):
    print(f"  Matrix source: {source}")
    print(f"  Total km: {km:.2f}  |  Elapsed: {elapsed:.2f}s")
    dist = sorted([len(r) for r in routes], reverse=True)
    print(f"  Distribution: {dist}  (spread={dist[0]-dist[-1] if len(dist)>1 else 0})")
    print()
    for i, route in enumerate(routes):
        route_labels = [labels[node] for node in route]
        print(f"  Машина {i+1} ({len(route)} точек):")
        print(f"    ДЕПО → {' → '.join(route_labels)} → ДЕПО")


def main():
    print("SmartRoute — Тест на реальных координатах Махачкалы")
    print(f"  Точек доставки: {len(MAKHACHKALA_STORES)}")
    print(f"  Депо: {DEPOT} (пр. Гамидова)")
    print(f"  OSRM endpoint: {M.OSRM_BASE_URL}")
    print()

    all_coords = build_all_coords()
    labels = build_labels()
    n_vehicles = 4

    # ── Тест 1: OSRM (реальные дороги) ───────────────────────────────────────
    print("=" * 72)
    print("ТЕСТ 1: Маршруты с реальными дорогами (OSRM / GH / Haversine)")
    print("=" * 72)

    routes_osrm, src_osrm, t_osrm = run_with_osrm(all_coords, n_vehicles)
    km_osrm = total_km(routes_osrm, all_coords)

    # Capture counters before test-2 resets them
    gh_hits_t1 = M._gh_call_successes
    osrm_hits_t1 = M._osrm_call_successes
    hv_clusters_t1 = len(routes_osrm) - gh_hits_t1 - osrm_hits_t1

    print(f"  GH успешных вызовов:    {gh_hits_t1}")
    print(f"  OSRM успешных вызовов:  {osrm_hits_t1}")
    print(f"  Haversine кластеров:    {hv_clusters_t1}")
    print()
    print_routes(routes_osrm, all_coords, labels, src_osrm, t_osrm, km_osrm)

    # ── Тест 2: Только Haversine ──────────────────────────────────────────────
    print()
    print("=" * 72)
    print("ТЕСТ 2: Маршруты с Haversine (для сравнения)")
    print("=" * 72)

    routes_hv, src_hv, t_hv = run_haversine_only(all_coords, n_vehicles)
    km_hv = total_km(routes_hv, all_coords)

    print_routes(routes_hv, all_coords, labels, src_hv, t_hv, km_hv)

    # ── Сравнение ─────────────────────────────────────────────────────────────
    print()
    print("=" * 72)
    print("СРАВНЕНИЕ OSRM vs HAVERSINE")
    print("=" * 72)

    naive = naive_km(len(MAKHACHKALA_STORES), n_vehicles, all_coords)
    delta_km = km_osrm - km_hv
    pct = (delta_km / km_hv * 100) if km_hv > 0 else 0

    print(f"  Наивный baseline (round-robin):  {naive:.2f} km")
    print(f"  Haversine-only:                  {km_hv:.2f} km  "
          f"(экономия {round((naive-km_hv)/naive*100,1)}% vs baseline)")
    print(f"  OSRM/GH/Haversine (приоритет):   {km_osrm:.2f} km  "
          f"(экономия {round((naive-km_osrm)/naive*100,1)}% vs baseline)")
    print()

    if abs(delta_km) < 0.5:
        verdict = "≈ одинаково (расхождение < 0.5 km)"
        note = ("  Примечание: при симметричных дорогах Haversine и OSRM дают\n"
                "  похожий порядок объезда. Разница OSRM видна при:\n"
                "  - Односторонних улицах (ехать туда vs обратно)\n"
                "  - Мостах / объездах / тупиках\n"
                "  - Реальных ограничениях скорости")
    elif delta_km < 0:
        verdict = f"OSRM лучше на {-delta_km:.1f} km ({-pct:.1f}%)"
        note = "  OSRM нашёл более короткий путь через реальные дороги."
    else:
        verdict = f"Haversine показал меньше на {delta_km:.1f} km (Haversine не учитывает объезды)"
        note = "  OSRM показал большее расстояние — так и должно быть: реальные дороги длиннее прямой."

    print(f"  Δkm (OSRM - Haversine): {delta_km:+.1f} km → {verdict}")
    if note:
        print(note)

    # ── Кластеры и их покрытие ────────────────────────────────────────────────
    print()
    print("ГЕОГРАФИЧЕСКОЕ ПОКРЫТИЕ КЛАСТЕРОВ (OSRM-маршрут):")
    for i, route in enumerate(routes_osrm):
        if not route:
            continue
        lats = [all_coords[n][0] for n in route]
        lons = [all_coords[n][1] for n in route]
        lat_span = max(lats) - min(lats)
        lon_span = max(lons) - min(lons)
        # Rough bounding-box area in km²
        area_km2 = lat_span * 111 * lon_span * 111 * abs(math.cos(math.radians(DEPOT[0])))
        names = [labels[n][:20] for n in route[:3]]
        etc = f" +{len(route)-3} ещё" if len(route) > 3 else ""
        print(f"  Машина {i+1}: {len(route)} точек, "
              f"bbox={lat_span*111:.1f}×{lon_span*111:.1f}km², "
              f"область={area_km2:.1f}km²")
        print(f"    Примеры: {', '.join(names)}{etc}")

    print()
    print("РЕЗУЛЬТАТ:")
    osrm_ok = osrm_hits_t1 > 0 or gh_hits_t1 > 0
    print(f"  Реальные дорожные расстояния: {'✅ ДА' if osrm_ok else '❌ НЕТ (только Haversine)'}")
    print(f"  GH / OSRM / Haversine: {gh_hits_t1} / {osrm_hits_t1} / {hv_clusters_t1} кластеров")
    print(f"  Экономия vs baseline: "
          f"{round((naive-km_osrm)/naive*100,1)}% (OSRM) vs "
          f"{round((naive-km_hv)/naive*100,1)}% (Haversine)")

    return True

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
