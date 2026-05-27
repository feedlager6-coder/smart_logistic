# CHANGELOG

## [Unreleased] — 2026-05-27 (Production-Ready Refactor)

### Шаг 1: Синхронизация API и Кодогенерация
- `lib/api-spec/openapi.yaml` — добавлены пути `/stores/import`, `/stores/template`, `/route/sessions/{id}`
- `lib/api-spec/openapi.yaml` — обновлены схемы: `VehicleInput.average_speed`, `RouteResult.session_id`
- Выполнена кодогенерация (`pnpm --filter @workspace/api-spec run codegen`)
- `lib/api-zod/tsconfig.json` — добавлен `"DOM"` в lib для типов File/Blob
- `lib/api-zod/src/index.ts` — исправлен конфликт дублирующего экспорта `ImportStoresBody`
- `artifacts/smartroute/src/pages/stores.tsx` — `handleImport` переписан на хук `useImportStores` (убрал raw fetch)

### Шаг 2: Серверное хранение результатов
- `artifacts/api-server/main.py` — колонка `result_json TEXT` добавлена в `route_sessions`
- `artifacts/api-server/main.py` — эндпоинт `GET /api/route/sessions/{id}` возвращает полный JSON маршрута
- `artifacts/api-server/main.py` — `build_route` сохраняет `result_json` и возвращает `session_id`
- `artifacts/smartroute/src/App.tsx` — добавлен роут `/result/:id`
- `artifacts/smartroute/src/pages/route.tsx` — редирект на `/result/{session_id}` вместо localStorage
- `artifacts/smartroute/src/pages/result.tsx` — полная переработка: чтение по `session_id` из URL через хук `useGetRouteSession`

### Шаг 3: Улучшение VRP-логики и параметров
- `artifacts/api-server/main.py` — добавлена глобальная переменная `TRAFFIC_MULTIPLIER = 1.2`
- `artifacts/api-server/main.py` — модель `VehicleInput` дополнена полем `average_speed`
- `artifacts/api-server/main.py` — расчёт времени маршрута использует `vehicle.average_speed` или `AVG_SPEED_KMH * TRAFFIC_MULTIPLIER`
- `artifacts/smartroute/src/pages/route.tsx` — в форме транспорта добавлено поле "Скорость (км/ч)"

### Шаг 4: UI/UX и мобильная адаптация
- `artifacts/smartroute/src/components/ui/status-badge.tsx` — создан общий компонент `StatusBadge`
- `artifacts/smartroute/src/pages/stores.tsx` — inline Badge заменён на `StatusBadge`
- `artifacts/smartroute/src/pages/route.tsx` — inline Badge удалён, используется `Badge` из ui/badge
- `artifacts/smartroute/src/pages/result.tsx` — реализован "Режим водителя" на мобильных: упрощённый вид с переключением машин и кнопками навигации
- `artifacts/smartroute/src/pages/result.tsx` — добавлена кнопка "Копировать ссылку на маршрут" (только если есть session_id)
