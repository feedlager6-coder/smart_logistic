# SmartRoute

B2B SaaS для оптимизации маршрутов доставки. Диспетчер загружает точки доставки (магазины), указывает машины и водителей — система строит оптимальные маршруты с помощью Google OR-Tools VRP solver, отправляет водителям через WhatsApp или Яндекс Навигатор.

**Базовый город**: Махачкала (дефолтный депо — 42.9849, 47.5046)

## Run & Operate

- `pnpm --filter @workspace/api-spec run codegen` — пересобрать API hooks + Zod schemas из OpenAPI spec (запускать после изменения `lib/api-spec/openapi.yaml`)
- `pnpm run typecheck` — проверить типы по всему монорепо
- Workflow `Start API Server` — FastAPI бэкенд на порту 8080 (`cd artifacts/api-server && python3 main.py`)
- Workflow `Start Frontend` — Vite dev server, порт 24853, BASE_PATH=/

## Stack

- **Монорепо**: pnpm workspaces
- **Backend**: Python 3.11, FastAPI, PostgreSQL (psycopg2), openpyxl, Google OR-Tools
- **Frontend**: React 19, Vite, TypeScript, Tailwind CSS, shadcn/ui, Leaflet, Recharts, wouter
- **API codegen**: Orval (OpenAPI → React Query hooks + Zod)
- **Геокодинг**: Yandex Geocoder API (primary), Nominatim (fallback, 1 req/sec)
- **VRP**: Google OR-Tools с fallback на greedy если не установлен
- **Дистанции**: GraphHopper Matrix API (primary) → Haversine fallback

## Where things live

| Файл/директория | Назначение |
|---|---|
| `artifacts/api-server/main.py` | Весь бэкенд (FastAPI, VRP, geocoding, DB) |
| `artifacts/smartroute/src/pages/` | Фронтенд страницы (home, stores, route, result, analytics) |
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

## Product

- **Магазины**: CRUD точек доставки с геокодингом (Яндекс/Nominatim), импорт из Excel (7 колонок), поддержка ссылок Яндекс Карт, кнопка «Открыть на карте», редактирование через диалог, подтверждение удаления
- **Склад (депо)**: адрес + опциональная ссылка Яндекс Карт, геокодинг через `/api/geocode`, кнопка «Открыть в Яндекс Картах», сохранение в localStorage
- **Маршруты**: VRP оптимизация с временными окнами и временем разгрузки, поддержка 1-50 машин, сохранение автопарка как шаблон
- **Результат**: интерактивная карта Leaflet с автозумом, цветная легенда, детализация по машинам, ссылки Яндекс Навигатора, отправка в WhatsApp, мобильный режим водителя
- **История маршрутов**: таблица сессий с пагинацией, дата/машины/точки/пробег/экономия, ссылки на результаты
- **Аналитика**: выбор периода (30д/90д/6м/1год/произвольный с DatePicker), пробег по дням, экономия по месяцам, загрузка машин (точек/авт.), топ-10 магазинов
- **Умный выбор магазинов**: фильтр по городу (chip-кнопки, только если > 1 города), предупреждение AlertDialog при выборе точек без координат

## API эндпоинты

| Метод | Путь | Описание |
|---|---|---|
| GET | `/api/stores` | Список магазинов |
| POST | `/api/stores` | Создать магазин |
| PUT | `/api/stores/{id}` | Обновить магазин |
| DELETE | `/api/stores/{id}` | Удалить магазин |
| POST | `/api/stores/{id}/geocode` | Геокодировать магазин |
| POST | `/api/stores/import` | Импорт из Excel |
| GET | `/api/stores/template` | Скачать шаблон Excel (base64 JSON) |
| GET | `/api/geocode` | Геокодировать адрес/ссылку Яндекс Карт |
| POST | `/api/route/build` | Построить маршруты (VRP) |
| GET | `/api/route/sessions` | Список сессий маршрутов (пагинация: page, page_size) |
| GET | `/api/route/sessions/{id}` | Получить сохранённый маршрут |
| GET | `/api/analytics/summary` | Сводка аналитики |
| GET | `/api/analytics/daily` | Ежедневная статистика (query: date_from, date_to) |
| GET | `/api/analytics/monthly` | Помесячная статистика (query: date_from, date_to) |
| GET | `/api/analytics/vehicle-load` | Загрузка машин по дням (query: date_from, date_to) |
| GET | `/api/analytics/top-stores` | Топ магазинов |

## User preferences

- Язык интерфейса: русский
- Документация пишется на русском
- Базовый город: Махачкала

## Gotchas

- `artifacts/smartroute: web` workflow всегда FAILED (конфликт порта с `Start Frontend`) — это ожидаемо, не чинить
- После изменения `openapi.yaml` всегда запускать codegen, затем typecheck
- `YANDEX_GEOCODER_API_KEY` не установлен → Nominatim (1 req/sec, медленный импорт больших файлов)
- `GRAPHHOPPER_API_KEY` не установлен → Haversine-расстояния (приблизительные, не дорожные); GraphHopper 429 — автоматический fallback на 60 секунд
- При импорте Excel строки начинающиеся с `←` — подсказки, пропускаются
- Демо-данные (магазины Махачкалы) загружаются автоматически при первом запуске если БД пустая
