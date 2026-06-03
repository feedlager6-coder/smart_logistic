# SmartRoute — Контекст проекта

## О проекте

SmartRoute — веб-приложение для оптимизации маршрутов доставки. Диспетчер загружает список магазинов, указывает автомобили, нажимает одну кнопку — и получает готовые маршруты на карте с Яндекс Навигатором и WhatsApp-шарингом.

## Текущее состояние (на 03.06.2026)

- **Статус:** Production-Ready — полный VRP аудит пройден, аудит метрик экономии завершён, Haversine+ROAD_FACTOR подтверждена как правильная модель
- **Backend:** FastAPI (Python) + PostgreSQL
- **Frontend:** React + Vite + TanStack Query + shadcn/ui
- **Оптимизация:** OR-Tools VRP (equal-angle sweep + centroid refinement, adaptive TSP/TSPTW per cluster)
  + цепочка матриц GH → OSRM → Haversine с in-memory кэшем и graceful fallback
- **Временные окна:** OR-Tools Time Dimension активируется при `use_time_windows=true`;
  данные `time_window_from/to` и `unload_minutes` из БД реально влияют на порядок посещений

## Ключевые функции

1. **База магазинов** — ручное добавление + Excel-импорт с геокодированием
2. **Точные координаты** — ручной ввод lat/lon пропускает геокодинг (быстрее и точнее)
3. **Ссылка на карту** — `map_url` поле для Яндекс/Google/2GIS ссылок
4. **Построение маршрутов** — VRP-оптимизация по нескольким автомобилям
5. **Результат** — карта Leaflet, маршруты по машинам, ссылки в навигатор
6. **Аналитика** — сводка по сэкономленным километрам и рублям
7. **Режим водителя** — упрощённый мобильный вид с навигацией по точкам
8. **Ссылка на маршрут** — шаринг по session_id без localStorage
9. **Авторазбивка для Яндекс.Навигатора** — маршруты >20 точек автоматически делятся на сегменты ≤20 точек; каждый сегмент — отдельная ссылка и кнопки; предупреждение пользователю
10. **Проверенная модель экономии** — `cost_per_km=31 руб/км` с задокументированной разбивкой, `ROAD_FACTOR=1.4` для монетарных расчётов; аудит 10 сценариев подтвердил что Haversine+ROAD_FACTOR надёжнее OSRM (OSRM ненадёжен для Махачкалы — 30% аномалий)

## Схема базы данных (stores)

```sql
CREATE TABLE stores (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    address TEXT NOT NULL,
    lat DOUBLE PRECISION,         -- координаты (могут быть NULL)
    lon DOUBLE PRECISION,
    map_url TEXT,                 -- прямая ссылка на карту
    geocode_status TEXT DEFAULT 'pending',  -- found | pending | not_found
    time_window_from TEXT DEFAULT '09:00',
    time_window_to TEXT DEFAULT '18:00',
    unload_minutes INTEGER DEFAULT 15,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Умное геокодирование

При создании магазина (ручном или через Excel):
- Если `lat` И `lon` переданы → используются как есть, геокодинг НЕ выполняется
- Иначе → вызывается `geocode_address(address)` (Yandex → Nominatim fallback)

## Критические переменные окружения

- `DATABASE_URL` — PostgreSQL connection string
- `GRAPHHOPPER_API_KEY` — для точных дорожных матриц
- `YANDEX_GEOCODER_API_KEY` — основной геокодер (без него — Nominatim с задержкой 1.1с)
- `GITHUB_PERSONAL_ACCESS_TOKEN` — для бэкапов в GitHub

## Формат Excel-шаблона (текущий)

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| Название | Адрес | Город | Широта | Долгота | Ссылка на карту | Разгрузка мин | Время с | Время до |

Совместимость: импорт поддерживает как старый формат (5 колонок), так и новый (9 колонок), определяя структуру по заголовкам.
