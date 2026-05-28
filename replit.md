# SmartRoute

B2B SaaS для оптимизации маршрутов доставки. Диспетчер загружает точки доставки (магазины), указывает машины и водителей — система строит оптимальные маршруты с помощью Google OR-Tools VRP solver, отправляет водителям через WhatsApp или Яндекс Навигатор.

## Run & Operate

- `pnpm --filter @workspace/api-spec run codegen` — пересобрать API hooks + Zod schemas из OpenAPI spec (запускать после изменения `lib/api-spec/openapi.yaml`)
- `pnpm run typecheck` — проверить типы по всему монорепо
- Workflow `artifacts/api-server: API Server` — FastAPI бэкенд на порту 8080
- Workflow `Start Frontend` — Vite dev server, порт 24853, BASE_PATH=/
- **НЕ** запускать `Start API Server` (дублирует порт 8080)

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
| `lib/api-spec/openapi.yaml` | Источник истины для API контракта |
| `lib/api-client-react/src/generated/api.ts` | Сгенерированные React Query хуки (не редактировать вручную) |
| `lib/zod/src/generated/` | Сгенерированные Zod схемы (не редактировать вручную) |

## Architecture decisions

- **Single-file backend**: весь Python код в одном `main.py` — намеренно для простоты MVP
- **StreamingResponse → Response**: шаблон Excel возвращается через `Response` с явным `Content-Length`, т.к. Replit-прокси не пробрасывает `Content-Disposition` при StreamingResponse
- **fetch + Blob download**: все файлы скачиваются через `fetch → Blob → <a download>`, а не `window.open` — Replit proxy strips Content-Disposition
- **Depot hardcoded**: координаты склада (55.7558, 37.6173 — центр Москвы) захардкожены в `build_route`. API поддерживает `depot_lat`/`depot_lon`, но UI их не отправляет — TODO
- **VRP unit demands = 1**: каждая точка = 1 единица груза. Реальный вес товара не учитывается — упрощение для MVP
- **Orval/TanStack Query mismatch**: `useGetRouteSession` в result.tsx использует `as any` для опции `enabled` из-за несовместимости версий

## Product

- **Магазины**: CRUD точек доставки с геокодингом (Яндекс/Nominatim), импорт из Excel (7 колонок), поддержка ссылок Яндекс Карт
- **Маршруты**: VRP оптимизация с временными окнами и временем разгрузки, поддержка 1-50 машин
- **Результат**: интерактивная карта Leaflet, детализация по машинам, ссылки Яндекс Навигатора, отправка в WhatsApp
- **Аналитика**: пробег/экономия за 30 дней/12 месяцев, топ-10 магазинов по частоте
- **Мобильный режим**: упрощённый вид для водителя (отдельный UI на телефоне)

## User preferences

- Язык интерфейса: русский
- Документация пишется на русском
- Changelog и SESSION_NOTES обновляются после каждой сессии

## Gotchas

- `artifacts/smartroute: web` workflow всегда FAILED (конфликт порта с `Start Frontend`) — это ожидаемо, не чинить
- После изменения `openapi.yaml` всегда запускать codegen, затем typecheck
- `YANDEX_GEOCODER_API_KEY` не установлен → Nominatim (1 req/sec, медленный импорт больших файлов)
- `GRAPHHOPPER_API_KEY` не установлен → Haversine-расстояния (приблизительные, не дорожные)
- При импорте Excel строки начинающиеся с `←` — подсказки, пропускаются
- Удаление магазина без подтверждения (confirm dialog добавлен в 28.05.2026)
