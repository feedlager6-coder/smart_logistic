# SmartRoute — Roadmap

## ✅ Выполнено (Stabilization Session, 27.05.2026)

- [x] Серверная и клиентская валидация при создании магазина
- [x] Поле `map_url` в базе данных и во всех API/формах
- [x] Умное геокодирование: lat/lon → пропуск геокодинга
- [x] Новый Excel-шаблон (9 колонок) с подсказками
- [x] Импорт Excel с поддержкой старого и нового формата
- [x] Collapsible "Точные координаты" в форме добавления
- [x] Колонка "Координаты" в таблице магазинов
- [x] Кнопка "Открыть на карте" для магазинов с map_url

## ✅ Выполнено (Production-Ready Refactor, 27.05.2026)

- [x] Шаг 1: Синхронизация API и кодогенерация
  - [x] `/stores/import` и `/stores/template` в OpenAPI spec
  - [x] Хук `useImportStores` заменил raw fetch
- [x] Шаг 2: Серверное хранение результатов
  - [x] `session_id` в URL (`/result/:id`)
  - [x] `GET /api/route/sessions/{id}`
- [x] Шаг 3: VRP-логика и параметры
  - [x] `TRAFFIC_MULTIPLIER = 1.2`
  - [x] `average_speed` на уровне каждого авто
- [x] Шаг 4: UI/UX и мобильная адаптация
  - [x] `StatusBadge` компонент
  - [x] Режим водителя на мобильных
  - [x] Кнопка "Копировать ссылку на маршрут"

## ✅ Выполнено (VRP Efficiency-First Routing, 31.05.2026)

- [x] Удалён `SetGlobalSpanCostCoefficient(100)` из OR-Tools — убран балансировочный штраф
- [x] `_cluster_by_sweep()`: round-robin → равно-угловые секторы (360° / N машин)
- [x] `solve_vrp()`: полная Haversine NxN матрица + OR-Tools TSP per sector
- [x] Шаг 4 (post-processing): разбивка крупнейшего сектора если машин > секторов
- [x] Тест: 3 сценария, экономия 62–71% vs наивный baseline, все проверки PASS
- [x] `scripts/test_vrp_scenarios.py` — тест VRP с тремя сценариями

## ✅ Выполнено (OSRM Integration, 31.05.2026)

- [x] `get_cluster_matrix_osrm()`: публичный сервер OSRM, без API-ключа, до 100 точек
- [x] Цепочка GH → OSRM → Haversine в `solve_vrp()` Step 3
- [x] `ORTOOLS_TIME_LIMIT_SECONDS`: конфигурируемый лимит OR-Tools (default 2s)
- [x] `OSRM_BASE_URL`, `OSRM_MAX_LOCATIONS` env-vars для кастомного сервера
- [x] Startup log: полная цепочка маршрутизации
- [x] `scripts/test_vrp_stress.py` — 16 сценариев (20/50/100/200 × 2/4/6/10 машин)
- [x] `scripts/test_vrp_makhachkala.py` — 25 реальных координат Махачкалы

## 🔜 Следующие шаги

- [ ] Аутентификация пользователей (Replit Auth или Clerk)
- [ ] Push-уведомления водителям при изменении маршрута
- [ ] Экспорт маршрута в PDF с логотипом компании
- [ ] История маршрутов с фильтрацией по дате/водителю
- [ ] Редактирование магазина прямо в таблице (inline edit)
- [ ] Карта для выбора координат вместо ручного ввода (click-to-pin)
- [ ] Тёмная тема
- [ ] Batch-геокодирование для магазинов со статусом "not_found"
- [x] GraphHopper per-cluster матрицы: `get_cluster_matrix_gh()` с in-memory кэшем, авто-калибровкой плана (400 → `_gh_plan_limit`), раздельными счётчиками и graceful Haversine fallback
