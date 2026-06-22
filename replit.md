# SmartRoute

B2B SaaS для оптимизации маршрутов доставки. Диспетчер загружает точки доставки (магазины), указывает машины и водителей — система строит оптимальные маршруты с помощью Google OR-Tools VRP solver, отправляет водителям через WhatsApp или Яндекс Навигатор.

**Базовый город**: Махачкала (дефолтный депо — 42.9849, 47.5046)

## Run & Operate

- `pnpm --filter @workspace/api-spec run codegen` — пересобрать API hooks + Zod schemas из OpenAPI spec (запускать после изменения `lib/api-spec/openapi.yaml`). **Внимание**: codegen очищает `generated/` папку перед генерацией. Если orval падает с "Failed to resolve input", восстанавливать из git: `git show HEAD:lib/api-client-react/src/generated/api.ts > lib/api-client-react/src/generated/api.ts` (аналогично для api.schemas.ts и lib/api-zod). Для новых DELETE-эндпоинтов проще использовать прямой `fetch()` в компоненте, не ждать codegen.
- `pnpm run typecheck` — проверить типы по всему монорепо
- Workflow `Start API Server` — FastAPI бэкенд на порту 8080 (`cd artifacts/api-server && python3 main.py`)
- Workflow `Start Frontend` — Vite dev server, порт 24853, BASE_PATH=/

## Railway Deployment

**Файлы деплоя**: `Dockerfile`, `railway.toml`, `.env.example`, `DEPLOY.md`

**Архитектура**: один Railway-сервис. FastAPI отдаёт и `/api/*` (бизнес-логика), и собранный Vite frontend из `./static/`.

**Быстрый старт Railway:**
1. New Project → Deploy from GitHub
2. + New → Database → PostgreSQL (auto-устанавливает `DATABASE_URL`)
3. Variables: установить `YANDEX_GEOCODER_API_KEY` (рекомендуется)
4. Деплой запускается автоматически; health check → `/api/healthz`

**Ключевые env vars** (см. `.env.example` для полного списка):

| Переменная | Обязательно | Примечание |
|-----------|-------------|-----------|
| `DATABASE_URL` | ✅ авто | Устанавливается PostgreSQL плагином Railway |
| `PG_CONNECTION_URL` | Опционально | Переопределяет `DATABASE_URL` (Replit dev env или кастомный Postgres) |
| `YANDEX_GEOCODER_API_KEY` | Рекомендуется | Быстрый геокодинг российских адресов |
| `GRAPHHOPPER_API_KEY` | Опционально | Реальные дороги в матрицах расстояний |
| `ALLOWED_ORIGINS` | Опционально | CORS origins (default `*` = ок для single-service) |

Подробнее: `DEPLOY.md`

## Stack

- **Монорепо**: pnpm workspaces
- **Backend**: Python 3.11, FastAPI, PostgreSQL (psycopg2), openpyxl, Google OR-Tools
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS, shadcn/ui, react-leaflet + 2ГИС тайлы, Recharts, wouter
- **API codegen**: Orval (OpenAPI → React Query hooks + Zod)
- **Геокодинг**: Yandex Geocoder API (primary, требует `YANDEX_GEOCODER_API_KEY`), Nominatim (fallback, 1 req/sec, без ключа)
- **VRP**: Google OR-Tools — equal-angle sweep sectors → TSP per sector → **inter-route Or-opt relocate** (пост-обработка, обычно −15-40% км); fallback на greedy если OR-Tools не установлен
- **Дистанции**: OSRM (router.project-osrm.org, без API-ключа, реальные дороги OSM, до 100 точек/кластер) → GraphHopper Matrix API per-cluster (Free план = 5 точек/кластер → авто-fallback) → Haversine (гарантированный fallback)
- **Карты**: react-leaflet + тайлы 2ГИС (`tile{0-3}.maps.2gis.com`) — российский провайдер, без политически спорного контента

## Where things live

| Файл/директория | Назначение |
|---|---|
| `artifacts/api-server/main.py` | Весь бэкенд (FastAPI, VRP, geocoding, DB) |
| `artifacts/smartroute/src/pages/` | Фронтенд страницы (home, stores, route, result, analytics, history) |
| `artifacts/smartroute/index.html` | Root HTML, `translate="no"` для защиты от Google Translate |
| `lib/api-spec/openapi.yaml` | Источник истины для API контракта |
| `lib/api-client-react/src/generated/api.ts` | Сгенерированные React Query хуки (не редактировать вручную) |
| `lib/zod/src/generated/` | Сгенерированные Zod схемы (не редактировать вручную) |

## Architecture decisions

- **Single-file backend**: весь Python код в одном `main.py` — намеренно для простоты MVP
- **Excel download as base64 JSON**: файлы возвращаются как `{"data": "<base64>", "filename": "..."}` — Replit proxy strips `Content-Disposition` при StreamingResponse/binary ответах; frontend декодирует через `atob()` → Blob → `<a download>`
- **Vite proxy**: `vite.config.ts` проксирует `/api/*` → `http://localhost:8080`. Без этого браузерные fetch к `/api/` попадают на Vite dev server и получают HTML вместо JSON
- **Frontend geocoding → backend**: геокодинг ВСЕГДА через `/api/geocode` (использует существующие `geocode_address` и `parse_yandex_link`). Прямые вызовы Nominatim/Яндекс из браузера заблокированы CORS
- **Depot UI**: координаты склада задаются на странице `/route`, сохраняются в `localStorage` (ключ `smartroute_depot`), отправляются в `POST /api/route/build` как `depot_lat`/`depot_lon`. Дефолт — Махачкала (42.9849, 47.5046)
- **Button asChild для ссылок**: кнопки-ссылки используют `<Button asChild><a href="...">...</a></Button>` — вложение `<a><button>` нарушает React 19 DOM reconciliation (`insertBefore` error)
- **translate="no"**: `index.html` имеет `lang="ru" translate="no"` для защиты от Google Translate, который ломает React reconciliation модификацией текстовых узлов
- **VRP unit demands = 1**: каждая точка = 1 единица груза. Реальный вес товара не учитывается — упрощение для MVP
- **Orval/TanStack Query mismatch**: `useGetRouteSession` в result.tsx использует `as any` для опции `enabled` из-за несовместимости версий
- **Yandex URL → coords**: `parse_yandex_link()` парсит `whatshere[point]=LON,LAT` (не LAT,LON!). При импорте из Excel адрес = результат обратного геокодинга Nominatim, fallback = `"lat, lon"` строка (НЕ сам URL)
- **2GIS тайлы**: Leaflet использует `tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1`, subdomains="0123". Тайлы загружаются как img — CORS не применяется
- **Inter-route Or-opt**: `_inter_route_relocate()` запускается после всех TSP (шаг 5 в `solve_vrp`). **Адаптивное число итераций** (ограничение ≤80 точек удалено): ≤80 стор → 5 итераций; ≤150 → 3; ≤300 → 2; >300 → 1. Логирует сохранение км. Не меняет распределение если уже оптимально. **Важно: не обнуляет маршруты** — если в маршруте остался 1 стоп, он не переносится (защита от исчезновения машин).
- **max_stops_per_vehicle**: опциональный параметр `POST /api/route/build`. Реализован через `_rebalance_max_stops()` — симметрично `_rebalance_min_stops()`. Перемещает избыточные точки из перегруженных маршрутов с минимальным km-штрафом. Бенчмарк (120 стор / 9 машин): cap=24 → ratio 3.9x→2.7x (−31%), km −0.5%. UI: кнопки "Без лимита / ≤30 / ≤26 / ≤24" в разделе "Параметры оптимизации". Валидация: cap не может быть меньше avg_stops (иначе 422).
- **ETA breakdown**: `POST /api/route/build` response включает `drive_minutes` (только езда) и `service_minutes` (время обслуживания, 0 если use_unload_time=false) в addition к `estimated_minutes` (сумма, обратная совместимость). Результат также сохраняет `use_unload_time: bool` в result_json. Frontend показывает `"X ч Y мин (езда Z мин)"` при наличии service_minutes > 0.
- **Яндекс.Навигатор лимит 20 точек**: мобильное приложение не строит маршрут при `rtext` > 20 точек. Константа `YANDEX_NAV_MAX_STOPS = 20`. Склад включён как **первая точка** rtext-ссылки — Яндекс заменяет её GPS-позицией водителя (водитель стоит на складе), все магазины (точки 2…N) сохраняются. Сегментация: склад + 19 магазинов = 20 точек; сегмент 2+ стартует с последнего магазина предыдущего. В ответе: `yandex_urls: list[str]` + `yandex_url: str` (backward compat = первый сегмент). Фронтенд показывает отдельные кнопки и amber-предупреждение при нескольких сегментах.
- **Параллельные OSRM-запросы**: Step 3 в `solve_vrp` использует `concurrent.futures.ThreadPoolExecutor` для одновременного запроса матриц по всем кластерам (Phase A). OR-Tools TSP решается последовательно (Phase B). Выигрыш: −38% времени при 100 точках / 10 машинах.
- **Модель стоимости**: `cost_per_km` читается из `company_settings` (БД). Формула: `cost_per_km = fuel_price × consumption / 100` (только топливо). Дефолты: 67 ₽/л, 13 л/100 км → 8.71 ₽/км. `ROAD_FACTOR = 1.4` — географическая константа (Haversine → реальный пробег), применяется ТОЛЬКО к монетарным метрикам. `saved_fuel_cost_rub` — экономия только топлива. `saved_rub_day` — полная экономия. Ответ `POST /api/route/build` → `savings` содержит `cost_per_km`, `fuel_price`, `fuel_consumption` (без `driver_salary`). `route_sessions` хранит `cost_per_km` на момент построения. Колонка `driver_salary` в БД сохранена для обратной совместимости но не используется в формуле.

## Product

- **Настройки компании**: страница `/settings` — цена топлива (₽/л), расход (л/100 км); live-калькулятор стоимости км с примерами экономии; хранится в БД (`company_settings`); применяется при каждом построении маршрута; новые настройки не пересчитывают прошлые сессии — `cost_per_km` сохраняется исторически в `route_sessions`
- **Магазины**: CRUD точек доставки с геокодингом (Яндекс/Nominatim), импорт из Excel (7 колонок), поддержка ссылок Яндекс Карт, кнопка «Открыть на карте», редактирование через диалог, подтверждение удаления
- **Склад (депо)**: адрес + опциональная ссылка Яндекс Карт, геокодинг через `/api/geocode`, кнопка «Открыть в Яндекс Картах», сохранение в localStorage
- **Маршруты**: VRP оптимизация с временными окнами и временем разгрузки, поддержка 1-50 машин, сохранение автопарка как шаблон; автоматическая разбивка маршрутов на сегменты ≤20 точек для Яндекс.Навигатора
- **Результат**: интерактивная карта 2ГИС/Leaflet с автозумом, цветная легенда, детализация по машинам, ссылки Яндекс Навигатора + кнопка копирования для каждого водителя, отправка в WhatsApp, мобильный режим водителя
- **История маршрутов**: таблица сессий с пагинацией, дата/машины/точки/пробег/экономия, ссылки на результаты; **удаление маршрута** — кнопка корзины появляется при наведении, AlertDialog с подтверждением, `DELETE /api/route/sessions/{id}`
- **Аналитика**: выбор периода (30д/90д/6м/1год/произвольный с DatePicker), пробег по дням, экономия по месяцам, загрузка машин (точек/авт.), топ-10 магазинов
- **Умный выбор магазинов**: фильтр по городу (chip-кнопки, только если > 1 города), предупреждение AlertDialog при выборе точек без координат

## API эндпоинты

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/stores` | Список магазинов |
| POST | `/api/stores` | Создать магазин |
| PUT | `/api/stores/{id}` | Обновить магазин |
| DELETE | `/api/stores/{id}` | Удалить магазин |
| POST | `/api/stores/{id}/geocode` | Геокодировать магазин (forward; если address = coords → reverse) |
| POST | `/api/stores/import` | Импорт из Excel |
| GET | `/api/stores/export` | Экспорт всех магазинов в Excel (base64 JSON) |
| GET | `/api/stores/template` | Скачать шаблон Excel (base64 JSON) |
| GET | `/api/geocode` | Геокодировать адрес/ссылку Яндекс Карт |
| POST | `/api/route/build` | Построить маршруты (VRP, OR-Tools + OSRM + Or-opt) |
| GET | `/api/route/sessions` | Список сессий маршрутов (пагинация: page, page_size) |
| GET | `/api/route/sessions/{id}` | Получить сохранённый маршрут |
| DELETE | `/api/route/sessions/{id}` | Удалить сессию маршрута |
| GET | `/api/analytics/summary` | Сводка аналитики |
| GET | `/api/analytics/daily` | Ежедневная статистика (query: date_from, date_to) |
| GET | `/api/analytics/monthly` | Помесячная статистика (query: date_from, date_to) |
| GET | `/api/analytics/vehicle-load` | Загрузка машин по дням (query: date_from, date_to) |
| GET | `/api/analytics/top-stores` | Топ магазинов |
| GET | `/api/settings` | Настройки компании (параметры стоимости км) |
| PUT | `/api/settings` | Обновить настройки; `cost_per_km` рассчитывается автоматически |

## User preferences

- Язык интерфейса: русский
- Документация пишется на русском
- Базовый город: Махачкала

## Architecture decisions (продолжение)

- **`migrate_moscow_stores()` ОТКЛЮЧЕНА**: функция существует в коде, но НЕ вызывается при старте. Была нужна однократно для замены московских демо-данных. Повторный вызов при каждом старте удалял бы реальные магазины любого клиента из города с lat > 50 (Москва, СПб, Новосибирск, Екатеринбург и т.д.) если у него ≤ 15 таких магазинов. **Не возвращать в startup.**
- **Валидация depot_lat/lon**: добавлена в `POST /api/route/build` — диапазоны -90..90 и -180..180. Без этого невалидные координаты давали маршрут через весь мир (11783км, arrive_by=04:37).
- **page_size**: зажимается к 1..200 в `GET /api/route/sessions`. Отрицательные значения используют дефолт 20.
- **Railway single-service**: FastAPI отдаёт и API, и собранный фронтенд из `./static/`. В dev Vite-proxy обращается к `localhost:8080`; в production они на одном origin — proxy не нужен. Catch-all `/{full_path:path}` зарегистрирован ПОСЛЕДНИМ, поэтому `/api/*` маршруты имеют приоритет.
- **PORT опционален при `vite build`**: `vite.config.ts` принимает PORT fallback=5173 для build-шага. Railway инжектирует PORT только в runtime, не при сборке.
- **Static dir не коммитится**: `artifacts/api-server/static/` создаётся Docker-сборкой (COPY --from=frontend), исключён из `.gitignore`.
- **CORS через env var**: `ALLOWED_ORIGINS` (comma-separated, default `*`). Для single-service Railway CORS не нужен (same origin), но конфигурируется для внешних API-клиентов.
- **Favicon**: `artifacts/smartroute/public/favicon.svg` — синий (#0E7490) скруглённый квадрат с грузовиком и пунктирной дорогой. Ссылка в `index.html` как `type="image/svg+xml"`.
- **Print маршрутный лист**: каждый водитель на отдельной странице (`pageBreakBefore: 'always'`). Шапка: имя, дата, точки, км, время — без данных экономии. Таблица: №, Магазин, Адрес, Кол-во товара (пустая), Прибытие, Отметка. Строки подписей внизу. Карточки экономии и главный заголовок скрыты при печати (`print:hidden`).
- **Удаление сессий маршрутов**: `DELETE /api/route/sessions/{id}` — backend удаляет строку из `route_sessions` (каскадно удаляет связанные vehicle_tracks). Frontend: кнопка корзины появляется при наведении на строку, AlertDialog с подтверждением, прямой `fetch()` без сгенерированного хука.
- **Мобильный вид `route.tsx`**: панель магазинов `h-[60vh] lg:h-[calc(100vh-200px)]`, правая панель `lg:h-[calc(100vh-200px)]`, поля транспорта `grid-cols-1 sm:grid-cols-3`. Таблица магазинов `overflow-x-auto`.
- **Cookie SameSite=none**: JWT-cookie выставляется с `SameSite=none; Secure=true` (дефолт). Это обязательно для работы в Replit Canvas (iframe) и любых embedded-сценариях. `SameSite=lax` блокирует cookie для script-initiated fetch из кросс-сайтового iframe (top-level = replit.com, iframe = xxx.replit.dev). Конфигурируется через `COOKIE_SAMESITE` / `COOKIE_SECURE` env vars. В production (Railway, HTTPS) дефолты работают без изменений.
- **Глобальный 401-handler**: `App.tsx` содержит `QueryCache` + `MutationCache` с `onError`, который при получении `ApiError` со статусом 401 диспатчит кастомный DOM-event `api:unauthorized`. `auth.tsx` слушает этот event → вызывает `fetchMe()`. Если `/api/auth/me` тоже возвращает 401 → `isAuthenticated = false` → login page показывается автоматически.
- **TanStack Query v5 keepPreviousData**: `keepPreviousData: true` удалён из TanStack Query v5 (v5.100.9). Заменять на `staleTime` или `placeholderData`. В generated-хуках использовать `as any` для несовместимых опций.
- **История маршрутов error state**: `history.tsx` имеет полный error state (Alert + retry button) при ошибке запроса, не бесконечный "Загрузка данных...".
- **ETA через OSRM (Stable 1.0)**: после `solve_vrp` для каждого финального маршрута выполняется отдельный параллельный OSRM-запрос (`_fetch_route_leg_times_osrm`). Возвращает `list[int]` (секунды на плечо), читает `durations[i][i+1]` из Table API. Если плечо > 7200 сек (2 ч) — весь маршрут дисквалифицируется, fallback на Haversine×2.0. `solve_vrp` не трогается. Добавляет ~1–2 сек к построению (9 параллельных вызовов).
- **auto_cap max_stops_per_vehicle**: если пользователь не выбрал ручной лимит, система автоматически применяет `effective_max_stops = ceil(avg × 1.5)`. Симметрично полу 0.70×avg из `_rebalance_min_stops`. Передаётся в `solve_vrp` как `effective_max_stops` (не перезаписывает `body.max_stops_per_vehicle`). Предотвращает сценарии 34/8/7 при плотных районах.
- **optimize_by скрыт из UI**: переключатель "Минимум км / Минимум времени" убран из `route.tsx`. Код и API параметр сохранены — всегда шлётся `"distance"` как default. Полевые тесты не показали измеримой разницы между режимами.

## Changelog — Pre-Demo Audit (19 Jun 2026)

1. **`GET /api/stores/export`** — новый endpoint. Возвращает все магазины пользователя в Excel (base64 JSON), совместимом с форматом импорта. Имя файла: `smartroute_stores_YYYY-MM-DD.xlsx`. Frontend: кнопка "Экспорт магазинов" в шапке страницы /stores (показывается только если есть магазины).
2. **AlertDialog для удаления магазина** — `window.confirm` заменён на AlertDialog, единый UX с историей маршрутов.
3. **Кнопка "Построить заново"** — добавлена внизу страницы результата (`/result/:id`), дополняет кнопку в шапке.
4. **Авто-сохранение автопарка** — `useEffect` в `route.tsx` сохраняет vehicles в localStorage при каждом изменении. Кнопка "Шаблон" по-прежнему работает, показывает toast.
5. **Login rate limiting** — `_check_login_rate_limit()` в `POST /api/auth/login`: 5 попыток за 15 мин → 429 на 15 мин. Сбрасывается при успешном входе.
6. **Онбординг** при 0 магазинов — трёхшаговый блок в /stores.
7. **Коммерческие материалы** — `docs/` содержит: `audit-report.md`, `demo-script-15min.md`, `call-script.md`, `commercial-offer.md`, `objections.md`, `pre-meeting-checklist.md`.

## Production Audit — Stable 1.0 (14 Jun 2026)

Независимая проверка перед деплоем. Код читался напрямую, без опоры на предыдущие ответы.

### Мёртвый код
- **`_cluster_by_capacitated_sweep`** (строка 664, ~70 строк) — определена, но **нигде не вызывается**. `solve_vrp` использует `_cluster_by_sweep` (строка 1448). Функция инертна, риска нет, но является избыточным кодом.

### Скрытые UI-параметры, влияющие на backend
| Параметр | UI | Backend |
|---|---|---|
| `optimize_by` | Скрыт (всегда "distance") | Валидируется, передаётся в OR-Tools. Time-path жив в коде, но не используется. |
| `average_speed` | Видим | Используется для Haversine ETA когда OSRM недоступен |
| `use_time_windows`, `use_unload_time`, `max_stops_per_vehicle` | Видимы | Полностью активны |

### Анализ циклов на зависание
| Цикл | Где | Ограничение | Вывод |
|---|---|---|---|
| `while improved` | `_two_opt_route` | Каждый swap строго уменьшает стоимость → конечная сходимость | SAFE |
| `while changed` | `_rebalance_min_stops` | Каждая итерация перемещает один стоп → ≤ total_stops итераций | SAFE |
| `while changed` | `_rebalance_max_stops` | Bounded oversized routes count + `break` на каждом шаге | SAFE |
| `for iteration in range(max_iter)` | `_inter_route_relocate` | Жёсткий bound max_iter (≤5) | SAFE |
| `while len(routes) < num_vehicles` | solve_vrp step 4 | Каждая итерация добавляет маршрут + `break` при len<2 | SAFE |

### Race conditions
- `_osrm_rate_limited_until` (float), `_gh_plan_limit` (int) — записываются из нескольких потоков без lock. CPython GIL делает запись float/int атомарной. Worst case: два одновременных билда — один видит stale значение. Результат: лишний OSRM-вызов или пропуск rate limit на секунду. Graceful degradation, не hard failure.
- `import_jobs` dict — daemon-thread пишет, main-thread читает. Отдельные dict-операции GIL-safe в CPython. Безопасно для MVP.

### Повторные OSRM-запросы
- **Матрицы кластеров** (`get_cluster_matrix_osrm`): есть кэш `_matrix_cache` — повторные вызовы с теми же координатами возвращают кэшированный результат.
- **ETA prefetch** (`_fetch_route_leg_times_osrm`): кэша нет. Один вызов на маршрут (9 для 9 машин), параллельно, ≤8 workers. Не повторные — у каждой машины уникальный маршрут.

### Утечки памяти
- `import_jobs: dict` — растёт без ограничений (нет TTL, нет cleanup). Комментарий в коде: "TTL not needed for MVP". Один Excel-файл ~50KB. 1000 импортов = ~50MB. Низкий риск для MVP.
- `_matrix_cache`: без eviction. Растёт при многих разных билдах. ~80KB на запись × 100 = ~8MB. Низкий риск.

### DB-подключения
- Нет connection pool. Каждый API-запрос: `psycopg2.connect()` → query → `close()`. PostgreSQL default: 100 connections. При единственном пользователе — ок. При нагрузочном тесте (>50 concurrent запросов) — риск "too many connections". Паттерн pre-existed Stable 1.0.

### Риски при нагрузке по числу точек
| Объём | relocate_iters | OSRM cluster fit | Оценка времени | Риск |
|---|---|---|---|---|
| 100 стор / 9 машин | 3 | ✅ (≤100 точек) | ~20-30s | Низкий |
| 150 стор / 9 машин | 3 | ✅ | ~25-40s | Низкий |
| 300 стор / 9 машин | 2 | ✅ (~33 стора/кластер) | ~45-70s | Средний (на грани FastAPI timeout) |
| 300 стор / 50 машин | 2 | ✅ (~6 стор/кластер) | ~30-50s | Средний |

При 300 стор + OSRM rate-limit → Haversine fallback на оставшиеся кластеры. Graceful degradation.

### Изменения за последние сессии (Stable 1.0)
1. **`_fetch_route_leg_times_osrm`** — новая функция, post-solve ETA via OSRM Table API. `solve_vrp` не тронут.
2. **`effective_max_stops = ceil(avg × 1.5)`** — auto_cap в `build_route`, нет влияния на алгоритм при уже-сбалансированном распределении.
3. **`optimize_by` hidden from UI** — `route.tsx` всегда шлёт "distance", кнопки убраны.
4. **`PG_CONNECTION_URL` priority** — `DATABASE_URL = os.environ.get("PG_CONNECTION_URL") or os.environ.get("DATABASE_URL", "")`.

### Вердикт
**✅ SAFE FOR DEPLOY** — все новые изменения изолированы, fallback-цепочки полные, while-циклы bounded.

---

## Заявки на день (daily_orders)

**Сценарий**: диспетчер выгружает список заявок из 1С/Антор/Google Sheets в Excel, загружает в SmartRoute. Система автоматически определяет колонки, сопоставляет строки с магазинами из базы (fuzzy-matching) и сохраняет веса/объёмы. При следующем построении маршрута `build_route` читает данные за сегодня и использует реальные веса как VRP demands.

**API эндпоинты**:
- `POST /api/orders/preview` — multipart/form-data, возвращает auto-detected маппинг колонок + предпросмотр строк с результатом сопоставления
- `POST /api/orders/import` — JSON `{delivery_date, rows[], clear_existing}`, сохраняет заявки в `daily_orders`
- `GET /api/orders?date=YYYY-MM-DD` — список заявок + агрегаты (сумма весов, объёмов, рублей)
- `DELETE /api/orders?date=YYYY-MM-DD` — удалить заявки за дату

**Детектирование колонок** (`_detect_column_mapping`): словарь `_ORDER_COLUMN_PATTERNS` (8 полей). Ключевые слова — рус + eng, от специфичных к общим. Колонка `"Название"` → field `store_name` (включает export SmartRoute).

**Fuzzy-matching магазинов** (`_match_store_to_db`): 3 прохода — точное совпадение → substring → word overlap ≥ 50%. Несопоставленные сохраняются с `store_id = NULL` (в маршрут не попадают, но видны в UI).

**Интеграция с build_route**: запрос `daily_orders` за `date.today()` с `store_id IS NOT NULL` → `_store_weights: dict[int, float]`. Если ёмкость машин задана (`capacity_kg`) И веса загружены → используются как OR-Tools integer demands (с auto-scale если > 10000 кг). Результат: `weight_kg`/`volume_m3` в каждом `route_stores` элементе; `total_weight_kg`/`total_volume_m3` в каждом маршруте.

**Ограничение**: sweep-кластеризация по углу не учитывает веса. Capacity constraint применяется только внутри уже назначенного кластера. При крайне неравных весах возможно превышение capacity у отдельных машин.

**Важные паттерны в коде**:
- Auth: `uid = get_user_id(request)` (не `_require_auth` — такой функции нет)
- `import re` и `import openpyxl` — на уровне модуля (строки 1 и 13)
- Лимит импорта: 2000 строк за раз (защита от зависания)
- Фильтр пустых строк в preview: по наличию имени в `name_col`, не по `any(cells.values())`

## Changelog — Release Candidate 1 (22 Jun 2026)

1. **Capacity overflow warning** — backend добавляет `capacity_kg` (0 = не задана) в каждый route-объект ответа. После построения: если `total_weight_kg > capacity_kg` → добавляет человекочитаемое сообщение в `route_warnings`. Frontend result.tsx: per-vehicle progress bar (зелёный/amber/красный по % загрузки), текст "⚖ 1200 кг / 1000 кг" красным при перегрузе.
2. **Unmatched stores UX (Variant C)** — orders.tsx показывает amber-карточку "Несопоставленные точки (N)" для store_id=NULL строк. Кнопка "Добавить магазин" → `/stores?prefill=НАЗВАНИЕ`. stores.tsx детектирует `?prefill=` → предзаполняет имя + scrollIntoView к форме.
3. **NaN guard для capacity_kg** — route.tsx: `parseInt(v.capacity_kg) || null` (защита от `parseInt("abc") = NaN` → 422).
4. **Backend audit** — все endpoints проверены: SQL-инъекции отсутствуют (параметризованные запросы), auth_middleware покрывает все `/api/` кроме `/healthz` и `/api/auth/login`, rate limiting работает.
5. **Frontend audit** — NaN в capacity_kg исправлен. Inconsistent fetch (stores.tsx force-create обходит TQ) задокументирован как низкий риск (не влияет на функциональность, 401 обрабатывается на уровне cookie middleware).
6. **DEVELOPER_ONBOARDING.md обновлён** — добавлены разделы: Capacity Overflow Warning, Unmatched Stores UX, Volume limitation (plan), Auto-select API test results, Regression test results, Итоговая оценка готовности.

## Gotchas

- `Start API Server` и `artifacts/smartroute: web` workflows — всегда FAILED (конфликт портов с уже запущенными `artifacts/api-server: API Server` и `Start Frontend`) — ожидаемо, не чинить
- **Codegen orval падает с "Failed to resolve input"** в Replit-окружении (orval v8.9.1 не может разрезолвить `./openapi.yaml` из TypeScript конфига). Workaround: восстанавливать сгенерированные файлы из git-истории (см. Run & Operate выше). Для новых DELETE/PUT/PATCH эндпоинтов в компонентах — использовать прямой `fetch()` вместо сгенерированного хука.
- После изменения `openapi.yaml` всегда запускать codegen, затем typecheck
- `YANDEX_GEOCODER_API_KEY` не установлен → Nominatim (1 req/sec, медленный импорт больших файлов); нужен ключ для быстрого геокодинга
- `GRAPHHOPPER_API_KEY` не установлен → OSRM используется как primary дистанционная матрица (real roads, free); Haversine как итоговый fallback
- При импорте Excel строки начинающиеся с `←` — подсказки, пропускаются
- Демо-данные (магазины Махачкалы) загружаются автоматически при первом запуске если БД пустая
- Обновление `body.address` через PUT `/api/stores/{id}` автоматически запускает `geocode_address()` → меняет lat/lon. При прямом патче координат использовать только SQL UPDATE напрямую или передавать `lat`+`lon` явно
- 2ГИС тайлы: загружаются браузером как img-теги, не подпадают под CORS ограничения. При недоступности 2ГИС — Leaflet покажет серые клетки (graceful degradation)
