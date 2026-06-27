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
| `ADMIN_PASSWORD` | ✅ | Пароль для входа в систему (логин: `admin`). Минимум 12 символов |
| `JWT_SECRET` | ✅ | Случайная строка ≥32 символов для подписи JWT. `openssl rand -hex 32` |
| `YANDEX_GEOCODER_API_KEY` | Рекомендуется | Ключ от [developer.tech.yandex.ru](https://developer.tech.yandex.ru/) |
| `GRAPHHOPPER_API_KEY` | Опционально | Ключ от [graphhopper.com](https://www.graphhopper.com/) |
| `ALLOWED_ORIGINS` | Опционально | `https://your-app.up.railway.app` (для ограничения CORS) |
| `ORTOOLS_TIME_LIMIT_SECONDS` | Опционально | `2` (увеличить на мощных серверах) |
| `COOKIE_SAMESITE` | Опционально | `none` (дефолт) — требуется для iframe-контекстов. Альтернатива: `lax` |
| `COOKIE_SECURE` | Опционально | `true` (дефолт) — флаг `Secure` на JWT cookie. Обязательно при `COOKIE_SAMESITE=none` |
| `JWT_TOKEN_TTL_HOURS` | Опционально | `24` — время жизни сессии в часах |

> **PORT** устанавливать не нужно — Railway инжектирует его автоматически.

> **Cookie в production**: Railway всегда HTTPS. Дефолты `COOKIE_SAMESITE=none` + `COOKIE_SECURE=true` работают в Railway без изменений.

### 4. Деплой

Деплой запускается автоматически при push в ветку. Или вручную:
- Railway dashboard → сервис → **Deploy** → **Deploy Now**

### 5. Проверить health check

Railway ждёт `GET /api/healthz → {"status": "ok"}` до 60 секунд.
Если health check не проходит за 60 секунд — деплой откатывается.

---

## Авторизация

SmartRoute использует JWT-авторизацию на основе HttpOnly cookie.

### Как это работает

1. Пользователь вводит логин/пароль → `POST /api/auth/login`
2. Сервер проверяет bcrypt-хеш → устанавливает HttpOnly cookie `smartroute_token`
3. Все `/api/*` запросы (кроме `/api/healthz` и `/api/auth/login`) проверяются middleware
4. Без валидного токена → `401 Unauthorized`
5. `POST /api/auth/logout` → cookie удаляется

### Создание нового пользователя

Прямой SQL через Railway Database console:

```sql
-- Генерировать хеш через Python:
-- python3 -c "import bcrypt; print(bcrypt.hashpw(b'NewPass123!', bcrypt.gensalt(12)).decode())"
INSERT INTO users (username, password_hash)
VALUES ('newuser', '$2b$12$...<bcrypt hash>...');
```

### Смена пароля

```sql
-- Генерировать новый хеш:
-- python3 -c "import bcrypt; print(bcrypt.hashpw(b'NewPass!456', bcrypt.gensalt(12)).decode())"
UPDATE users SET password_hash = '$2b$12$...<new hash>...' WHERE username = 'admin';
```

### При перезапуске Railway

- `JWT_SECRET` должен быть одинаковым до и после перезапуска
- Если `JWT_SECRET` изменился — все активные сессии инвалидируются (пользователи переходят на страницу входа)
- `ADMIN_PASSWORD` проверяется при старте: если пользователя `admin` нет — создаётся автоматически

---

## Первый запуск (автосидирование)

При первом подключении к пустой PostgreSQL базе:
1. `init_db()` создаёт таблицы (`CREATE TABLE IF NOT EXISTS`), включая `users`
2. `seed_demo_data()` добавляет демо-данные аналитики (магазины не добавляются — пользователь начинает с онбординга)
3. `seed_admin_user()` создаёт пользователя `admin` с паролем из `ADMIN_PASSWORD`

Если база уже содержит данные (≥3 магазинов) — сидирование пропускается.
Если пользователь `admin` уже есть — `seed_admin_user()` ничего не делает.

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
  → pnpm@10 install
  → COPY tsconfig.base.json + tsconfig.json (нужны для Vite/esbuild)
  → COPY всех package.json (для pnpm workspace graph)
  → pnpm install --frozen-lockfile
  → COPY lib/ + artifacts/smartroute/
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

### Страница входа не появляется / 401 на всех запросах
→ Нормально — авторизация работает. Откройте браузер и войдите через страницу логина.

### Залогинился, но всё равно 401 / «история маршрутов — загрузка данных»
→ Проблема с cookie: либо `COOKIE_SAMESITE=none` без `COOKIE_SECURE=true`, либо приложение открыто
  в iframe на стороннем домене без нужных флагов.
  Убедитесь что оба установлены: `COOKIE_SAMESITE=none` и `COOKIE_SECURE=true` (дефолт в production).

### `Admin user will NOT be created`
→ `ADMIN_PASSWORD` не установлен. Добавьте переменную в Railway Variables.

### Сессии сбрасываются при каждом перезапуске
→ `JWT_SECRET` не установлен или генерируется случайно. Установите фиксированный `JWT_SECRET`.

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

---

## Известные проблемы и исправления сборки

### `.dockerignore` и `artifacts/mockup-sandbox/`

`artifacts/mockup-sandbox/` исключён из Docker-образа (dev-only артефакт),
но pnpm регистрирует его в `pnpm-lock.yaml` как workspace-importer.
`pnpm install --frozen-lockfile` требует наличия его `package.json` для
разрешения графа зависимостей.

**Решение:** в `.dockerignore` после исключения директории добавлено:
```
artifacts/mockup-sandbox/
!artifacts/mockup-sandbox/package.json
```

### `tsconfig.base.json` не копировался в Dockerfile

`artifacts/smartroute/tsconfig.json` делает `extends: "../../tsconfig.base.json"`.
Vite/esbuild разрешает этот путь во время сборки — без файла build падал с:
```
failed to resolve "extends":"../../tsconfig.base.json"
```

**Решение:** добавлен в Layer 1 Dockerfile:
```dockerfile
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json tsconfig.json ./
```
