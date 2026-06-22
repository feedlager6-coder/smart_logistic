# SmartRoute — Developer Onboarding

> Этот документ предназначен для нового разработчика или агента, впервые открывающего репозиторий.
> Цель: за 10–15 минут понять что это, как работает, и как запустить.

---

## Что это

**SmartRoute** — B2B SaaS для оптимизации маршрутов доставки.

Целевая аудитория: логисты/диспетчеры малого бизнеса (Дагестан, Махачкала). Диспетчер:
1. Вносит магазины (точки доставки) один раз
2. Каждый день загружает заявки (вес, объём из 1С/Антор/любой системы)
3. Нажимает «Построить маршрут» — система за 5–60 сек строит оптимальные маршруты
4. Отправляет водителям ссылку Яндекс.Навигатора в WhatsApp

---

## Архитектура

```
Browser (React + Vite)
       │
       │  /api/*  (Vite proxy → localhost:8080 в dev)
       ▼
FastAPI (Python 3.11) — artifacts/api-server/main.py
       │
       ├── PostgreSQL (psycopg2) — stores, users, route_sessions, daily_orders
       ├── OSRM (router.project-osrm.org) — матрицы расстояний
       ├── OR-Tools (Google) — VRP solver
       └── Yandex Geocoder / Nominatim — геокодинг
```

**Ключевой принцип**: весь бэкенд — один файл `artifacts/api-server/main.py` (~5400 строк). Намеренно для простоты MVP.

---

## Структура файлов

```
artifacts/
  api-server/
    main.py              ← ВЕСЬ бэкенд: FastAPI, VRP, geocoding, auth, DB
    requirements.txt     ← Python зависимости
  smartroute/
    src/
      pages/             ← Страницы React (home, stores, route, result, orders,
      │                     analytics, history, settings)
      components/        ← Компоненты (layout.tsx, sidebar, ui/*)
      context/auth.tsx   ← Контекст авторизации, JWT cookie
    vite.config.ts       ← Proxy /api → :8080, BASE_PATH
    index.html           ← translate="no" (защита от Google Translate)

lib/
  api-spec/openapi.yaml             ← OpenAPI контракт
  api-client-react/src/generated/   ← Сгенерированные React Query хуки (НЕ редактировать)
  zod/src/generated/                ← Сгенерированные Zod схемы

Dockerfile                          ← Для Railway
railway.toml                        ← Railway config
DEPLOY.md                           ← Инструкция по деплою Railway
```

---

## База данных

Все таблицы создаются в `init_db()` при старте (CREATE TABLE IF NOT EXISTS):

| Таблица | Назначение |
|---------|-----------|
| `users` | Логин/пароль (bcrypt), plan (trial/basic/pro/enterprise), is_admin |
| `stores` | Точки доставки: name, address, lat, lon, time_window, unload_minutes, owner_id |
| `geocode_cache` | Кэш геокодинга: address → lat/lon, hit_count |
| `route_sessions` | Сохранённые маршруты: result_json (JSONB), total_km, cost_per_km |
| `route_session_stores` | Связь сессия ↔ магазин (для аналитики) |
| `company_settings` | Настройки стоимости на компанию: fuel_price, fuel_consumption, cost_per_km |
| `daily_orders` | Заявки на день: store_id FK (nullable), weight_kg, volume_m3, amount_rub, delivery_date |

**Мульти-пользователь**: каждая таблица имеет `owner_id INTEGER REFERENCES users(id)`. Все запросы фильтруют по `owner_id = get_user_id(request)`.

---

## Авторизация

- **Метод**: JWT в HttpOnly cookie (`smartroute_token`)
- **Middleware**: `auth_middleware` (до маршрутов) — декодирует JWT, пишет `request.state.user_id`
- **Получение user_id в эндпоинте**: `uid = get_user_id(request)` — 401 если нет куки
- **Важно**: Cookie `SameSite=none; Secure=true` — обязательно для работы в Replit iframe

```python
# Паттерн в каждом защищённом эндпоинте:
@app.get("/api/some-resource")
def some_endpoint(request: Request):
    uid = get_user_id(request)  # ← ВСЕГДА так, не _require_auth
    ...
```

---

## VRP — Алгоритм построения маршрутов

Функция `solve_vrp()` в main.py, ~600 строк:

```
Шаг 1: Матрица расстояний
  OSRM Table API (публичный, без ключа, реальные дороги OSM)
  → fallback GraphHopper Matrix API (Free план, ≤5 точек/кластер)
  → fallback Haversine (прямые расстояния, всегда работает)

Шаг 2: Кластеризация
  equal-angle sweep sectors — делит stores по углу от депо на N кластеров
  (N = число машин), каждый кластер идёт к одной машине

Шаг 3: TSP per cluster
  OR-Tools (Google) — оптимизирует порядок внутри каждого кластера
  Time windows: опционально (учёт временных окон магазинов)

Шаг 4: Inter-route Or-opt
  _inter_route_relocate() — перемещает точки между маршрутами если это
  уменьшает суммарный пробег (обычно −15-40%)

Шаг 5: Балансировка
  _rebalance_min_stops() — гарантирует ≥ 0.70×avg точек у каждой машины
  _rebalance_max_stops() — гарантирует ≤ cap точек (если задан лимит)
  _rebalance_count_balance() — финальный баланс ±1 точки между машинами
  auto_cap — автолимит = ceil(avg × 1.5) если пользователь не задал

Шаг 6: ETA
  Параллельный OSRM Table API per маршрут → drive_minutes
  Fallback: Haversine × 2.0 (средняя городская поправка)
```

**Известное ограничение**: Sweep-кластеризация не учитывает веса при распределении. `capacity_kg` используется как demand в OR-Tools, но только внутри уже созданных кластеров. При сильно неравномерных весах возможно превышение ёмкости у одной машины.

---

## Заявки на день (daily_orders)

**Сценарий**: диспетчер каждое утро выгружает список заявок из 1С/Антор в Excel, загружает в SmartRoute, затем строит маршрут.

**Поток данных**:
```
Excel файл (1С/Антор/Google Sheets)
    ↓ POST /api/orders/preview
Автодетект колонок (_detect_column_mapping)
    ↓ Пользователь подтверждает маппинг
    ↓ POST /api/orders/import
Сохранение в daily_orders (сопоставление с stores по fuzzy-matching)
    ↓ При POST /api/route/build
Загрузка весов → OR-Tools demands → per-stop weight_kg → per-route total_weight_kg
```

**Детектирование колонок** (`_detect_column_mapping`):
- 8 полей: store_name, order_number, weight_kg, volume_m3, amount_rub, zone, address, notes
- Для каждого поля — список ключевых слов (рус + eng), проверяются в порядке от специфичного к общему
- "Название" → store_name, "Вес, кг" → weight_kg, "Объём, м3" → volume_m3

**Сопоставление магазинов** (`_match_store_to_db`):
- Проход 1: точное совпадение нормализованного имени
- Проход 2: substring match (одно имя содержится в другом)
- Проход 3: word overlap ≥ 50% (по нормализованным словам)
- Несопоставленные строки сохраняются (`store_id = NULL`), в маршрут не попадают

---

## Геокодинг

Всегда через `/api/geocode` (никогда прямо из браузера — CORS):

```
Яндекс Geocoder API (YANDEX_GEOCODER_API_KEY)  ← быстро, точно для РФ
    → fallback Nominatim (1 req/sec, без ключа)
    → не найдено → geocode_status = "not_found"

Кэш: таблица geocode_cache (city+address ключ, hit_count)
```

Ссылки Яндекс Карт: `parse_yandex_link()` парсит `whatshere[point]=LON,LAT` (важно: порядок LON,LAT, не LAT,LON).

---

## Excel-обмен

**Скачивание файлов** (Excel export): через base64 JSON `{"data": "<base64>", "filename": "..."}` — StreamingResponse/binary ломается в Replit proxy. Frontend: `atob(data)` → Blob → `<a download>`.

**Формат магазинов** (7 колонок): Название, Ссылка Яндекс, Адрес, Город, Разгрузка мин, Время с, Время до.

---

## Яндекс.Навигатор

- Лимит 20 точек в URL (склад + 19 магазинов)
- При > 19 магазинов маршрут разбивается на сегменты автоматически
- Константа `YANDEX_NAV_MAX_STOPS = 20`
- Склад всегда первой точкой (Яндекс заменяет на GPS водителя)
- `yandex_urls: list[str]` — все сегменты; `yandex_url: str` — первый (backward compat)

---

## Основные API эндпоинты

```
GET    /api/healthz                    — health check (no auth)
POST   /api/auth/login                 — JWT cookie (rate limit: 5 попыток/15 мин)
GET    /api/auth/me                    — текущий пользователь
POST   /api/auth/logout

GET    /api/stores                     — список магазинов
POST   /api/stores                     — создать магазин
PUT    /api/stores/{id}                — обновить
DELETE /api/stores/{id}                — удалить
POST   /api/stores/{id}/geocode        — геокодировать
POST   /api/stores/import              — импорт из Excel
POST   /api/stores/import/preview      — предпросмотр (с дедупликацией)
GET    /api/stores/export              — экспорт всех магазинов в Excel (base64)
GET    /api/stores/template            — скачать шаблон Excel (base64)

GET    /api/geocode?address=...        — геокодировать адрес
GET    /api/geocode?yandex_url=...     — распарсить ссылку Яндекс Карт

POST   /api/orders/preview             — разобрать Excel заявок (multipart/form-data)
POST   /api/orders/import              — сохранить заявки
GET    /api/orders?date=YYYY-MM-DD     — получить заявки за дату
DELETE /api/orders?date=YYYY-MM-DD    — удалить заявки за дату

POST   /api/route/build                — построить маршруты (VRP)
GET    /api/route/sessions             — история маршрутов (paged)
GET    /api/route/sessions/{id}        — получить маршрут
DELETE /api/route/sessions/{id}        — удалить маршрут

GET    /api/analytics/summary          — сводка
GET    /api/analytics/daily            — по дням (date_from, date_to)
GET    /api/analytics/monthly          — по месяцам
GET    /api/analytics/vehicle-load     — загрузка машин
GET    /api/analytics/top-stores       — топ магазинов

GET    /api/settings                   — настройки компании
PUT    /api/settings                   — обновить настройки

GET    /api/admin/users                — список пользователей [admin only]
POST   /api/admin/users                — создать пользователя [admin only]
PUT    /api/admin/users/{id}           — обновить (plan, note, is_active) [admin only]
DELETE /api/admin/users/{id}           — удалить пользователя [admin only]
```

---

## Локальный запуск (Replit)

```bash
# Запускаем API сервер (Workflow: "Start API Server")
cd artifacts/api-server && python3 main.py
# → http://localhost:8080

# Запускаем фронтенд (Workflow: "Start Frontend")
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/smartroute run dev
# → http://localhost:5000

# Переменные окружения в Replit:
# ADMIN_PASSWORD — пароль admin-пользователя (обязательно)
# JWT_SECRET — секрет для JWT (обязательно в prod, иначе рандомный при каждом старте)
# PGHOST/PGUSER/PGPASSWORD/PGDATABASE/PGPORT — Replit PostgreSQL (автоматически)
# YANDEX_GEOCODER_API_KEY — опционально, улучшает геокодинг
```

---

## Деплой на Railway

```bash
# В Railway: New Project → Deploy from GitHub
# + New → Database → PostgreSQL  (auto: DATABASE_URL)
# Variables: установить ADMIN_PASSWORD, JWT_SECRET, YANDEX_GEOCODER_API_KEY
# Health check: /api/healthz
```

FastAPI отдаёт `/api/*` и собранный Vite frontend из `./static/` (один сервис).
Dockerfile: node:20-slim → pnpm → vite build → python:3.11-slim → uvicorn.

---

## Известные ограничения

| Ограничение | Описание |
|-------------|---------|
| Sweep без учёта весов | Кластеризация не учитывает weight_kg при распределении по машинам. Weights используются в OR-Tools demands, но только внутри уже назначенного кластера. При крайне неравных весах capacity может быть нарушена. |
| Unit demands по умолчанию | Если заявки на день не загружены, каждый магазин = 1 единица груза |
| OSRM публичный | router.project-osrm.org — публичный, без гарантий uptime. Fallback: Haversine |
| GraphHopper Free | 5 точек/кластер на Free плане, авто-fallback на OSRM/Haversine |
| Яндекс Навигатор ≤20 точек | Автоматическая сегментация при превышении |
| Orval codegen сломан | Orval v8.9.1 в Replit падает с "Failed to resolve input". Для новых эндпоинтов использовать прямой fetch() в компоненте |
| `_capacitated_cluster_sweep` | Функция определена (~строка 664), но нигде не вызывается — мёртвый код |

---

## Известные архитектурные решения

- **Одиночный файл бэкенд** — намеренно для простоты MVP, не рефакторить без нужды
- **base64 для Excel** — обход бага Replit proxy (обрезает binary responses)
- **Cookie SameSite=none** — для работы в Replit iframe/Canvas
- **Глобальный 401-handler** — QueryCache/MutationCache в App.tsx → DOM event `api:unauthorized` → auth.tsx
- **`migrate_moscow_stores()` ОТКЛЮЧЕНА** — вызов убран из startup, не возвращать

---

## Быстрые ссылки на ключевые функции в main.py

| Функция | Назначение |
|---------|-----------|
| `init_db()` | Создание всех таблиц |
| `get_db()` | Получение psycopg2 connection |
| `get_user_id(request)` | Получить uid текущего пользователя (401 если нет) |
| `solve_vrp(...)` | Весь VRP solver |
| `geocode_address(addr)` | Геокодирование с кэшем |
| `parse_yandex_link(url)` | Парсинг ссылок Яндекс Карт |
| `calculate_savings(...)` | Расчёт экономии (км, топливо, деньги) |
| `yandex_nav_urls(coords)` | Формирование Яндекс.Навигатор URLs с сегментацией |
| `_detect_column_mapping(hdrs)` | Автодетект колонок Excel для заявок |
| `_match_store_to_db(name, stores)` | Fuzzy-matching магазинов по имени |
| `_inter_route_relocate(routes)` | Or-opt пост-обработка (межмаршрутная оптимизация) |
