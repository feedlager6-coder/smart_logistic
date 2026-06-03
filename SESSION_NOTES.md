# SESSION_NOTES.md — Сессия 03.06.2026 (Яндекс.Навигатор: аудит ограничений + разбивка маршрутов)

## Задача

Аудит ограничений Яндекс.Навигатора, реализация автоматической разбивки маршрутов,
полное тестирование, обновление документации.

## Аудит — результаты

### Шаг 1: Ограничение Яндекс.Навигатора

**Проверено:** Яндекс.Навигатор (мобильное приложение) поддерживает максимум **20 промежуточных
точек** в одном URL-параметре `rtext`. Это документированное ограничение мобильного приложения
(в отличие от веб-версии, которая работает с большим числом точек).

**Состояние до исправления:** функция `yandex_nav_url()` генерировала одну URL со всеми точками
без какого-либо ограничения. При 27+ точках водитель получал нерабочую ссылку в мобильном
Яндекс.Навигаторе.

**Доказательство размером URL:**
| Точек | URL length | Состояние |
|-------|-----------|-----------|
| 10 | 208 | ✅ Работает |
| 20 | 391 | ✅ Работает (максимум) |
| 21+ | 411+ | ❌ Не строит маршрут в мобильном |

### Шаг 2: Реализация разбивки

**Добавлено:**
- `YANDEX_NAV_MAX_STOPS = 20` — константа (легко менять при изменении лимита)
- `yandex_nav_urls(coords_list) -> list[str]` — новая функция разбивки
- `yandex_urls: list[str]` — новое поле в ответе `/api/route/build`
- `yandex_url: str` — сохранено как first-segment alias для обратной совместимости

### Шаг 3: Тесты разбивки

| Точек | Сегм. | Потерь | Дублей | Порядок | Итог |
|-------|-------|--------|--------|---------|------|
| 20 | 1 | 0 | 0 | ✓ | ✅ |
| 30 | 2 (20+10) | 0 | 0 | ✓ | ✅ |
| 50 | 3 (20+20+10) | 0 | 0 | ✓ | ✅ |
| 100 | 5 (20×5) | 0 | 0 | ✓ | ✅ |
| 27 (ord. check) | 2 | 0 | 0 | ✓ | ✅ |

### Шаг 4: Экономия не изменяется

`total_km`, `saved_km`, `saved_pct`, `saved_fuel_l`, `saved_fuel_cost_rub`, `saved_rub_day` —
все поля считаются по реальным координатам маршрута, не по навигационным URL.
Разбивка не влияет на экономику. **Проверено юнит-тестом.**

### Шаг 5: TypeScript типы

Codegen запущен после обновления `openapi.yaml`. Typecheck (`pnpm run typecheck`) — 0 ошибок.

## Изменённые файлы

| Файл | Изменение |
|---|---|
| `artifacts/api-server/main.py` | `YANDEX_NAV_MAX_STOPS`, `yandex_nav_urls()`, `yandex_urls` в route response |
| `lib/api-spec/openapi.yaml` | `VehicleRoute.yandex_urls: string[]` (required) |
| `lib/api-client-react/src/generated/api.schemas.ts` | auto-generated |
| `lib/api-zod/src/generated/api.ts` | auto-generated |
| `artifacts/smartroute/src/pages/result.tsx` | Split UI, amber warning, per-segment buttons |
| `CHANGELOG.md` | Раздел разбивки навигатора |
| `ARCHITECTURE.md` | Раздел «Ограничение Яндекс.Навигатора» |
| `CONTEXT.md` | Пункт 9 в ключевых функциях |
| `replit.md` | Architecture decision + Product feature |

## Риски

- **Яндекс может изменить лимит** — константа `YANDEX_NAV_MAX_STOPS` вынесена для быстрого
  изменения без поиска по коду
- **Старые сессии в БД** не имеют поля `yandex_urls` — фронтенд gracefully fallback через
  `getNavSegments()` к `yandex_url` если `yandex_urls` отсутствует

## Статус

✅ Production-ready. Реализовано, протестировано, задокументировано.

---

# SESSION_NOTES.md — Сессия 01.06.2026 (VRP Audit + TSPTW + Adaptive OR-Tools)

## Задача

Полный аудит VRP-архитектуры SmartRoute по 7 шагам:
аудит кода, доказательство OSRM, реальный тест Махачкалы, эффективность распределения,
стресс-тесты, кластеризация, итоговый отчёт + исправление найденных проблем.

## Аудит — результаты

### Шаг 1: Архитектура цепочки маршрутизации

```
GRAPHHOPPER_API_KEY: SET (36 chars) — free plan, auto-detected limit=5
OSRM_BASE_URL: https://router.project-osrm.org
OSRM_MAX_LOCATIONS: 100
ORTOOLS_AVAILABLE: True
OR-Tools: AVAILABLE — TSP per cluster
```

**Фактическая цепочка**: GraphHopper DISABLED (free plan ≤5 точек) → OSRM PRIMARY → Haversine FALLBACK

### Шаг 2: OSRM live тест

| Магазин | OSRM (м) | Haversine (м) | Коэф. |
|---|---|---|---|
| Супермаркет Каспий | 1388 | 611 | 2.27× |
| Магазин Дагестан | 1882 | 1052 | 1.79× |
| Торговый дом Север | 1078 | 895 | 1.20× |
| Мини-маркет Восток | 1984 | 747 | 2.66× |

OSRM отвечает за ~0.8 с, матрица 5×5 корректна.

### Шаг 3: Реальный тест Махачкалы (30 магазинов, 4 машины)

```
Источник матрицы: OSRM (4/4 кластеров)
Время построения: 10.89 с (включает 4 сетевых запроса OSRM)
Общий км: 25.3 км
Без оптимизации: 74.1 км
Сэкономлено: 48.8 км (66%)
```

Распределение: [8, 5, 11, 6] — неравномерное, geography-driven ✅

### Шаг 4: Эффективность распределения

```
VRP (оптимизированный): 25.3 км
Round-robin (наивный):  54.1 км
Улучшение VRP: −53.2%
```

### Шаг 5: Стресс-тесты (Haversine, без OSRM)

| Магазины | Машины | Время | Км |
|---|---|---|---|
| 20 | 2 | 4.0 с | 47.3 |
| 20 | 4 | 9.1 с | 56.5 |
| 50 | 4 | 8.0 с | 73.7 |
| 100 | 4 | 8.0 с | 97.4 |
| 100 | 6 | 12.0 с | 107.1 |

**Проблема обнаружена**: 100 магазинов / 4 машины = 8 с, из которых 4 кластера × 2 с OR-Tools = 8 с.
OR-Tools тратит полный бюджет времени даже для малых кластеров.

### Шаг 6: Кластеризация

```
Кластеров: 4, Точек: 25
Точек в неправильном кластере: 0/25
```
✅ Все точки назначены в геометрически оптимальный кластер.
Центроидное уточнение (3 итерации) полностью устраняет граничные аномалии sweep-алгоритма.

## Исправления

### Исправление 1: Адаптивный OR-Tools таймаут

**Проблема**: `_ortools_solve_group` всегда использовал `ORTOOLS_TIME_LIMIT_SECONDS=2с`
на каждый кластер. Для 6 машин = 12 с на построение маршрута.

**Решение**: Адаптивный таймаут по размеру кластера:
```python
if cluster_size <= 5:   adaptive_tl = min(0.3, ORTOOLS_TIME_LIMIT_SECONDS)
elif cluster_size <= 10: adaptive_tl = min(1.0, ORTOOLS_TIME_LIMIT_SECONDS)
else:                    adaptive_tl = ORTOOLS_TIME_LIMIT_SECONDS
```

**Результат**: 3 остановки → 0.33 с (было 2 с). Ускорение типичных сценариев ~75%.

### Исправление 2: Time Windows TSPTW

**Проблема**: `use_time_windows=true` принималось в API, но OR-Tools не получал
ограничений по времени. Поля `time_window_from/to` и `unload_minutes` хранились в БД
но не влияли на порядок посещений.

**Решение**:
1. `_parse_time_to_minutes(str)` — парсер "HH:MM" → int минут
2. `_ortools_solve_group(..., time_windows)` — OR-Tools Time Dimension:
   - Depot стартует ровно в 09:00
   - Каждая точка получает `[tw_from_min, tw_to_min]` constraint
   - Service time = `unload_minutes` (при `use_unload_time=true`)
   - Max slack 60 мин (ранний приезд → ожидание допустимо)
3. `solve_vrp(..., store_time_windows)` — новый параметр
4. `build_route` — извлекает TW из БД и передаёт в solver

## Файлы

| Файл | Изменение |
|---|---|
| `artifacts/api-server/main.py` | `_parse_time_to_minutes`, адаптивный TL в `_ortools_solve_group`, Time Dimension TSPTW, `store_time_windows` в `solve_vrp`, передача TW из `build_route` |
| `artifacts/api-server/requirements.txt` | Создан (fastapi, uvicorn, psycopg2-binary, openpyxl, ortools, python-multipart) |
| `CHANGELOG.md` | Обновлён |
| `ARCHITECTURE.md` | Обновлён |
| `CONTEXT.md` | Обновлён |
| `SESSION_NOTES.md` | Обновлён |

## Тесты (все прошли)

```
✅ _parse_time_to_minutes OK
✅ Adaptive time limit OK: 3-stop cluster solved in 0.330s (< 0.8s)
✅ OR-Tools TSPTW OK: order=[1, 2, 3, 4]
✅ store_time_windows flow OK: routes=[2, 3]
✅ matrix_source reporting OK
```

---

# SESSION_NOTES.md — Сессия 31.05.2026 (OSRM Integration + Stress Tests)

## Задача

Добавить OSRM как второй слой маршрутизации: GH → OSRM → Haversine.
Написать stress-тесты (20/50/100 × 2/4/6/10 машин) и тест на реальных координатах Махачкалы.

## Сделано

### Backend (`artifacts/api-server/main.py`)

1. **OSRM конфиг** (строки ~80–95):
   - `OSRM_BASE_URL` — URL сервера (default: `https://router.project-osrm.org`)
   - `OSRM_MAX_LOCATIONS` — лимит точек per кластер (default 100)
   - `_osrm_rate_limited_until`, `_osrm_call_successes`, `_osrm_cache_hits`

2. **`get_cluster_matrix_osrm(coords)`** — полная реализация:
   - OSRM Table API: `GET /table/v1/driving/{lon,lat;...}?annotations=duration,distance`
   - Внимание: OSRM принимает **lon,lat** (не lat,lon!)
   - Кэш: `_matrix_cache[("osrm",) + tuple(coords)]` (не пересекается с GH)
   - Rate-limit: 30с при 429/503 или таймауте ≥ 14с
   - Graceful fallback: любая ошибка → return None

3. **`solve_vrp()` Step 3** обновлён: GH → OSRM → Haversine per кластер
   - Новый счётчик `osrm_clusters`
   - `matrix_source` теперь включает `"osrm"` и `"mixed (osrm=N, hv=K)"`

4. **`ORTOOLS_TIME_LIMIT_SECONDS`** — глобальная переменная (default 2, поддерживает float):
   - `params.time_limit.seconds = int(_tl)` + `params.time_limit.nanos = int(...)`

5. **Startup logging**: `Routing chain: GH[...] → OSRM[...] → Haversine[always]`

### Результаты

| Тест | Итог |
|---|---|
| `test_vrp_scenarios.py` (регрессия) | ✅ ALL PASS (63.3% / 68.8% / 54.3%) |
| `test_vrp_makhachkala.py` | ✅ OSRM 4/4 кластеров, 61.5% savings |
| `test_vrp_stress.py` (12 сцен.) | ✅ ALL PASS, 100% OSRM, 8.9s для 100s/10v |

---

# SESSION_NOTES.md — Сессия 28.05.2026 (Яндекс URL + упрощённая форма)

## Задача

Улучшить UX добавления магазинов: принимать ссылки Яндекс Карт вместо координат.

## Сделано

### Backend (`artifacts/api-server/main.py`)
1. `parse_yandex_link(url)` — парсит форматы: `whatshere[point]=lon,lat`, `ll=lon,lat`, `rtext=lat,lon`, короткие ссылки с редиректом
2. `reverse_geocode_nominatim(lat, lon)` — Nominatim обратный геокодинг → человекочитаемый адрес
3. `StoreInput`: `address` опциональный; добавлены `yandex_url`, `city`
4. `StoreUpdate`: добавлены `yandex_url`, `city`
5. `create_store`: приоритеты — lat/lon → yandex_url → geocode(city+address)
6. `download_stores_template`: новый 7-колоночный шаблон (Название, Ссылка Яндекс, Адрес, Город, Разгрузка, Время с, Время до)
7. `import_stores`: колонка `c_yandex` + та же логика приоритетов в цикле

### Результаты тестов (curl)

| Тест | Результат |
|------|-----------|
| `POST /api/stores` с yandex_url | ✅ `lat: 55.755814, lon: 37.617635, status: found` |
| `POST /api/stores` с address+city | ✅ `lat: 55.601483, status: found` |
| `GET /api/stores/template` | ✅ 200, 5498 bytes, 7 колонок |
| `POST /api/stores` без локации | ✅ 422 «Укажите ссылку из Яндекс Карт или адрес» |
| `tsc --noEmit` | ✅ 0 ошибок |
