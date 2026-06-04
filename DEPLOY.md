# SmartRoute — деплой на Railway

## Архитектура production-деплоя

```
Railway Service (единственный)
├── Docker build:
│   ├── Stage 1: Node.js 20 → pnpm build → dist/public/
│   └── Stage 2: Python 3.11 + FastAPI
│       ├── /api/*        → FastAPI endpoints
│       ├── /assets/*     → Vite JS/CSS bundles (StaticFiles)
│       └── /*            → index.html (SPA catch-all)
│
└── Railway Postgres plugin → DATABASE_URL (auto-injected)
```

FastAPI отдаёт и API, и собранный React frontend из одного процесса.
Нет отдельного Nginx, нет двух сервисов — один порт, один контейнер.

---

## Быстрый старт

### 1. Создать Railway проект

1. Открыть [railway.app](https://railway.app) → New Project
2. **Deploy from GitHub repo** → выбрать репозиторий SmartRoute
3. Railway автоматически найдёт `railway.toml` и `Dockerfile`

### 2. Добавить PostgreSQL

В Railway dashboard → **+ New** → **Database** → **Add PostgreSQL**

Railway автоматически установит `DATABASE_URL` в переменные сервиса.

### 3. Установить переменные окружения

В Railway dashboard → выбрать сервис → **Variables**:

| Переменная | Обязательно | Значение |
|-----------|-------------|---------|
| `DATABASE_URL` | ✅ авто | Устанавливается PostgreSQL плагином автоматически |
| `YANDEX_GEOCODER_API_KEY` | Рекомендуется | Ключ от [developer.tech.yandex.ru](https://developer.tech.yandex.ru/) |
| `GRAPHHOPPER_API_KEY` | Опционально | Ключ от [graphhopper.com](https://www.graphhopper.com/) |
| `ALLOWED_ORIGINS` | Опционально | `https://your-app.up.railway.app` (для ограничения CORS) |
| `ORTOOLS_TIME_LIMIT_SECONDS` | Опционально | `2` (увеличить на мощных серверах) |

> **PORT** устанавливать не нужно — Railway инжектирует его автоматически.

### 4. Деплой

Деплой запускается автоматически при push в ветку. Или вручную:
- Railway dashboard → сервис → **Deploy** → **Deploy Now**

### 5. Проверить health check

Railway ждёт `GET /api/healthz → {"status": "ok"}` до 60 секунд.
Если health check не проходит за 60 секунд — деплой откатывается.

---

## Первый запуск (автосидирование)

При первом подключении к пустой PostgreSQL базе:
1. `init_db()` создаёт таблицы (`CREATE TABLE IF NOT EXISTS`)
2. `seed_demo_data()` добавляет 8 демо-магазинов Махачкалы

Если база уже содержит данные (≥3 магазинов) — сидирование пропускается.

---

## Обновление схемы БД

Миграции встроены в `init_db()` через `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
При каждом рестарте выполняются безопасно (idempotent). Новые колонки
добавляются автоматически — ручное применение миграций не нужно.

---

## Масштабирование

Railway позволяет горизонтальное масштабирование (несколько реплик).
**Ограничения текущей архитектуры:**

| Компонент | Stateful? | Масштабируется? |
|-----------|-----------|-----------------|
| `geocode_cache` | In-memory | ❌ Не синхронизируется между репликами |
| `import_jobs` | In-memory | ❌ Прогресс теряется при ребалансировке |
| `_matrix_cache` | In-memory | ❌ Не синхронизируется |
| PostgreSQL | Внешняя БД | ✅ Общая для всех реплик |

**Вывод для MVP:** одна реплика достаточна. Для multi-replica scale нужно
вынести кэши в Redis.

---

## Мониторинг

Railway предоставляет:
- Логи в реальном времени (Dashboard → Logs)
- Метрики CPU/памяти
- Алёрты при сбоях через webhooks

Приложение логирует:
- Маршруты матриц (OSRM / GraphHopper / Haversine)
- Статус геокодера
- VRP solve время и экономию

---

## Структура Dockerfile

```
Stage 1 (frontend):        ~2-3 мин
  node:20-slim
  → pnpm install (кэшируется между деплоями)
  → BASE_PATH=/ vite build
  → dist/public/ (≈1.2 МБ)

Stage 2 (runtime):         ~5-7 мин (ortools большой)
  python:3.11-slim
  → pip install requirements.txt
  → COPY main.py
  → COPY --from=frontend dist/public → ./static/
  → CMD python3 main.py
```

Полная сборка: **7-10 минут** (первый раз). Повторные деплои быстрее
благодаря Docker layer cache.

---

## Troubleshooting

### `DATABASE_URL not set` / `psycopg2.OperationalError`
→ Убедитесь что PostgreSQL плагин добавлен и `DATABASE_URL` виден в Variables.

### Health check timeout
→ OR-Tools при первом импорте может занять 30-40 сек на холодном старте.
   `healthcheckTimeout = 60` в `railway.toml` учитывает это.

### 502 Bad Gateway
→ FastAPI ещё не запустился. Railway ждёт health check — подождите 60 сек.

### Geocoding медленный
→ `YANDEX_GEOCODER_API_KEY` не установлен → используется Nominatim (1 req/sec).
   Установите ключ Яндекс Геокодера для быстрого геокодинга.

### Маршрут строится долго
→ Нормально при 50+ точках (OSRM + OR-Tools = 7-12 сек).
   Увеличьте `ORTOOLS_TIME_LIMIT_SECONDS` для более качественных маршрутов.
