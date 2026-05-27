# CHANGELOG

## [Unreleased] — 2026-05-27 (Stores Flow Stabilization)

### Step 1: Debug & Fix Stores Creation
- `POST /api/stores` — добавлена серверная валидация (пустое имя/адрес, диапазоны координат)
- Форма в `stores.tsx` — клиентская валидация с тостами перед отправкой запроса
- `store_row_to_dict` — добавлено поле `map_url` в возвращаемый словарь

### Step 2: Fix Excel Template Download
- Шаблон скачивается принудительно через `fetch` + `Blob` + динамический `<a download>` (ранее `window.open` открывало пустую страницу в Replit-прокси)
- Исправлено: импорт теперь пропускает note-строки (начинаются с `←`)

### Step 3: Add Precise Location Support
- `stores` таблица: добавлена колонка `map_url TEXT` (`ALTER TABLE IF NOT EXISTS`)
- `StoreInput` Pydantic модель: добавлены `lat`, `lon`, `map_url` (все опциональные)
- `StoreUpdate` Pydantic модель: добавлено `map_url`
- OpenAPI spec: `Store`, `StoreInput`, `StoreUpdate` обновлены с `map_url`, `lat`, `lon`
- `stores.tsx` таблица: новый столбец "Координаты"; кнопка "Открыть на карте" если есть `map_url`

### Step 4: Smart Geocoding Logic
- `create_store`: если `lat` И `lon` предоставлены → используются напрямую, геокодинг пропускается
- `import_stores`: аналогичная логика — если оба поля числовые и в диапазоне → пропускает geocode_address
- Это ускоряет импорт и даёт точность при ручном вводе координат

### Step 5: Upgrade Excel Template
Новая структура шаблона (9 колонок вместо 5):
- A: Название (обязательное)
- B: Адрес (обязательное)
- C: Город (необязательное, добавляется к адресу)
- D: Широта (необязательное число)
- E: Долгота (необязательное число)
- F: Ссылка на карту (необязательный URL)
- G: Разгрузка мин
- H: Время с (ЧЧ:ММ)
- I: Время до (ЧЧ:ММ)
- Строка-подсказка с описаниями полей (пропускается при импорте)

### Step 6: Validation
- Backend: `HTTPException 422` для пустого имени/адреса; неверных координат
- Frontend: `validateForm()` перед отправкой → тосты с понятным текстом ошибки
- Import: пропуск пустых строк и строк-подсказок (`←`)

### Step 7: UI Improvements
- "Точные координаты" — collapsible секция в форме добавления магазина
- Таблица магазинов: колонка "Координаты" (широта, долгота в формате monospace)
- Кнопка ExternalLink в таблице при наличии `map_url`

### Step 8: Documentation Update
- `CHANGELOG.md` обновлён (этот файл)
- `CONTEXT.md` обновлён
- `API.md` обновлён
- `ROADMAP.md` обновлён

---

## [Previous] — 2026-05-27 (Production-Ready Refactor, Steps 1–4)

### Step 1: API синхронизация и кодогенерация
- `/stores/import`, `/stores/template`, `/route/sessions/{id}` добавлены в OpenAPI spec
- Хук `useImportStores` заменил raw fetch в `stores.tsx`

### Step 2: Серверное хранение результатов
- `session_id` в URL (`/result/:id`)
- `GET /api/route/sessions/{id}` эндпоинт

### Step 3: VRP-логика
- `TRAFFIC_MULTIPLIER = 1.2`
- `average_speed` на уровне каждого авто

### Step 4: UI/UX и мобильная адаптация
- `StatusBadge` компонент
- Режим водителя на мобильных
- Кнопка "Копировать ссылку на маршрут"
