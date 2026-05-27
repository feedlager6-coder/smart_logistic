# SmartRoute

**Умная логистика для дистрибьюторов** — веб-приложение для оптимизации маршрутов доставки с поддержкой нескольких транспортных средств, временных окон и учёта грузоподъёмности.

## Стек технологий

| Слой | Технология |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS, shadcn/ui |
| Backend API | Python 3.11, FastAPI, Uvicorn |
| Оптимизация маршрутов | Google OR-Tools (VRP solver) |
| Карты | Leaflet.js + OpenStreetMap / Nominatim |
| База данных | PostgreSQL (Replit managed) |
| Excel | openpyxl |
| Графики | Recharts |
| Type-safe API клиент | Orval (OpenAPI codegen) + Zod |

## Возможности

- Управление базой магазинов с геокодированием через Nominatim
- Импорт магазинов из Excel-файла (`.xlsx`) со встроенным шаблоном
- Построение оптимальных маршрутов для 1–50 машин с OR-Tools VRP
- Учёт грузоподъёмности и временных окон
- Интерактивная карта Leaflet с цветными маршрутами
- Ссылки на Яндекс Навигатор и отправка через WhatsApp
- Аналитика: пробег по дням, экономия по месяцам, топ-10 магазинов

## Структура проекта

```
smartroute/
├── artifacts/
│   ├── api-server/          # Python FastAPI backend
│   │   └── main.py          # Все API-эндпоинты, VRP-логика, геокодер
│   └── smartroute/          # React + Vite frontend
│       └── src/
│           ├── pages/       # Страницы приложения
│           ├── components/  # UI-компоненты (shadcn/ui)
│           └── main.tsx
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 спецификация
│   │   └── openapi.yaml
│   ├── api-client-react/    # Сгенерированные React-хуки (Orval)
│   └── api-zod/             # Сгенерированные Zod-схемы (Orval)
└── package.json             # pnpm workspace
```

## Ключевые модули

| Модуль | Расположение |
|---|---|
| VRP-логика (OR-Tools) | `artifacts/api-server/main.py` → `solve_vrp()` |
| Геокодер (Nominatim) | `artifacts/api-server/main.py` → `geocode_address()` |
| Импорт Excel | `artifacts/api-server/main.py` → `import_stores()` |
| UI карты (Leaflet) | `artifacts/smartroute/src/pages/result.tsx` |
| Аналитика | `artifacts/smartroute/src/pages/analytics.tsx` |
| OpenAPI спецификация | `lib/api-spec/openapi.yaml` |

## Запуск локально

### Предварительные требования

- Node.js 20+ и pnpm
- Python 3.11+
- PostgreSQL (или переменная окружения `DATABASE_URL`)

### 1. Установка зависимостей

```bash
# Node-зависимости
pnpm install

# Python-зависимости
pip install fastapi uvicorn ortools openpyxl psycopg2-binary python-multipart
```

### 2. Переменные окружения

Скопируйте `.env.example` в `.env` и заполните значения:

```bash
cp .env.example .env
```

### 3. Запуск backend

```bash
cd artifacts/api-server
python main.py
# API будет доступен на http://localhost:8080
```

### 4. Запуск frontend

```bash
pnpm --filter @workspace/smartroute run dev
# Приложение будет доступно на http://localhost:24853
```

### 5. Кодогенерация (после изменений OpenAPI)

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Деплой

Проект развёртывается в одно нажатие через Replit Deployments. После публикации:

- Backend: `python main.py` (PORT задаётся через env)
- Frontend: сборка через `pnpm --filter @workspace/smartroute run build`

## Переменные окружения

| Переменная | Обязательная | Описание |
|---|---|---|
| `DATABASE_URL` | Да | Строка подключения PostgreSQL |
| `PORT` | Нет | Порт backend-сервера (по умолчанию 8080) |
| `PGHOST` | Нет | Хост PostgreSQL |
| `PGPORT` | Нет | Порт PostgreSQL |
| `PGUSER` | Нет | Пользователь PostgreSQL |
| `PGPASSWORD` | Нет | Пароль PostgreSQL |
| `PGDATABASE` | Нет | Имя базы данных |

## API-эндпоинты

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/healthz` | Проверка работоспособности |
| GET | `/api/stores` | Список магазинов |
| POST | `/api/stores` | Добавить магазин |
| GET | `/api/stores/template` | Скачать Excel-шаблон |
| POST | `/api/stores/import` | Импорт из Excel |
| PUT | `/api/stores/{id}` | Обновить магазин |
| DELETE | `/api/stores/{id}` | Удалить магазин |
| POST | `/api/stores/{id}/geocode` | Геокодировать адрес |
| POST | `/api/route/build` | Построить маршруты |
| GET | `/api/analytics/summary` | Итоги за всё время |
| GET | `/api/analytics/daily` | Статистика по дням |
| GET | `/api/analytics/monthly` | Статистика по месяцам |
| GET | `/api/analytics/top-stores` | Топ-10 магазинов |

## Лицензия

MIT
