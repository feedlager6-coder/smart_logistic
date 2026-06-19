# SmartRoute

**Умная логистика для дистрибьюторов** — B2B SaaS для оптимизации маршрутов доставки с поддержкой нескольких транспортных средств, временных окон и расчёта экономии.

**Базовый город**: Махачкала (дефолтный депо — 42.9849, 47.5046)

## Стек технологий

| Слой | Технология |
|---|---|
| Frontend | React 19, Vite 7, Tailwind CSS 4, shadcn/ui, wouter |
| Backend API | Python 3.11, FastAPI, Uvicorn |
| Оптимизация маршрутов | Google OR-Tools (VRP solver) + inter-route Or-opt |
| Матрица расстояний | OSRM (публичный, без ключа) → GraphHopper → Haversine |
| Геокодер (primary) | Yandex Geocoder API |
| Геокодер (fallback) | Nominatim / OpenStreetMap (1 req/sec) |
| Карты | react-leaflet + 2ГИС тайлы |
| База данных | PostgreSQL |
| Excel | openpyxl |
| Графики | Recharts |
| Type-safe API клиент | Orval v8 (OpenAPI codegen) + Zod |

## Возможности

- **Авторизация**: JWT в HttpOnly cookie, логин/выход, rate limiting (5 попыток / 15 мин)
- **Мультипользовательская изоляция**: каждый пользователь видит только свои магазины и маршруты
- **Администраторская панель**: создание/блокировка/удаление пользователей, назначение планов, журнал действий
- **Управление базой магазинов**: CRUD, умное геокодирование (Яндекс → Nominatim fallback), импорт/экспорт Excel
- **Построение маршрутов**: VRP для 1–50 машин, временны́е окна, время разгрузки, лимит точек на машину
- **Навигация**: ссылки Яндекс Навигатора с авто-сегментацией (≤20 точек), отправка в WhatsApp, печать маршрутного листа
- **История маршрутов**: сохранение сессий, повторный просмотр на карте, удаление
- **Аналитика**: пробег по дням, экономия по месяцам, загрузка машин, топ-10 магазинов
- **Настройки компании**: цена топлива, расход, расчёт стоимости km и экономии

## Структура проекта

```
smartroute/
├── artifacts/
│   ├── api-server/          # Python FastAPI backend (single-file main.py)
│   └── smartroute/          # React + Vite frontend
│       └── src/
│           ├── pages/       # Страницы: home, stores, route, result, analytics, history, settings, login
│           └── components/  # UI-компоненты (shadcn/ui, UsersPanel)
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 спецификация + конфиг Orval
│   ├── api-client-react/    # Сгенерированные React-хуки (Orval)
│   └── api-zod/             # Сгенерированные Zod-схемы (Orval)
├── docs/                    # Коммерческий пакет и технические документы
├── Dockerfile               # Production build (Railway)
├── railway.toml             # Railway config
└── DEPLOY.md                # Инструкция деплоя
```

## Ключевые модули

| Модуль | Расположение |
|---|---|
| VRP-логика (OR-Tools + Or-opt) | `artifacts/api-server/main.py` → `solve_vrp()` |
| OSRM Matrix API | `artifacts/api-server/main.py` → `get_cluster_matrix_osrm()` |
| Yandex Geocoder | `artifacts/api-server/main.py` → `geocode_address_yandex()` |
| Авторизация / JWT | `artifacts/api-server/main.py` → `/api/auth/*` |
| Администраторская панель | `artifacts/api-server/main.py` → `/api/admin/*` |
| UI карты (Leaflet + 2GIS) | `artifacts/smartroute/src/pages/result.tsx` |
| Аналитика | `artifacts/smartroute/src/pages/analytics.tsx` |
| Пользователи (admin UI) | `artifacts/smartroute/src/components/UsersPanel.tsx` |
| OpenAPI спецификация | `lib/api-spec/openapi.yaml` |

## Переменные окружения

| Переменная | Обязательна | Описание |
|---|---|---|
| `DATABASE_URL` | Да | PostgreSQL строка подключения |
| `ADMIN_PASSWORD` | Да | Пароль администратора (создаётся при первом старте) |
| `JWT_SECRET` | Да | Секрет для подписи JWT |
| `YANDEX_GEOCODER_API_KEY` | Рекомендована | Ключ Яндекс Геокодера (быстрый геокодинг РФ) |
| `GRAPHHOPPER_API_KEY` | Опциональна | Ключ GraphHopper (реальные дороги в матрицах) |
| `ALLOWED_ORIGINS` | Опциональна | CORS origins (default `*`) |

## Запуск локально

```bash
# Установить зависимости
pnpm install

# Запустить API-сервер (порт 8080)
cd artifacts/api-server && python3 main.py

# Запустить фронтенд (порт 5000)
PORT=5000 BASE_PATH=/ pnpm --filter @workspace/smartroute run dev
```

Или через Replit: Workflow `Start API Server` + Workflow `Start Frontend`.

## Деплой на Railway

Один сервис: FastAPI отдаёт и `/api/*`, и собранный Vite frontend из `./static/`.

1. New Project → Deploy from GitHub
2. + New → Database → PostgreSQL
3. Variables: `ADMIN_PASSWORD`, `JWT_SECRET`, `YANDEX_GEOCODER_API_KEY`
4. Health check → `/api/healthz`

Подробнее: [`DEPLOY.md`](DEPLOY.md)

## Документация

### Техническая
- [Архитектура](ARCHITECTURE.md)
- [Деплой на Railway](DEPLOY.md)
- [API справочник](API.md)
- [Changelog](CHANGELOG.md)
- [Roadmap](ROADMAP.md)

### Коммерческий пакет

| Документ | Назначение |
|---|---|
| [docs/demo-script-15min.md](docs/demo-script-15min.md) | Сценарий демонстрации 15 мин |
| [docs/call-script.md](docs/call-script.md) | Скрипт звонка клиенту |
| [docs/commercial-offer.md](docs/commercial-offer.md) | Коммерческое предложение с ROI |
| [docs/objections.md](docs/objections.md) | Ответы на возражения |
| [docs/pre-meeting-checklist.md](docs/pre-meeting-checklist.md) | Чеклист перед встречей |
| [PILOT_AGREEMENT.md](PILOT_AGREEMENT.md) | Договор пилотного использования |
| [TERMS_OF_SERVICE.md](TERMS_OF_SERVICE.md) | Пользовательское соглашение |
| [PRIVACY_POLICY.md](PRIVACY_POLICY.md) | Политика обработки данных |
