# SmartRoute

**Умная логистика для дистрибьюторов** — веб-приложение для оптимизации маршрутов доставки с поддержкой нескольких транспортных средств, временных окон и учёта грузоподъёмности.

## Стек технологий

| Слой | Технология |
|---|---|
| Frontend | React 19, Vite 7, Tailwind CSS 4, shadcn/ui |
| Backend API | Python 3.11, FastAPI, Uvicorn |
| Оптимизация маршрутов | Google OR-Tools (VRP solver) + балансировка нагрузки |
| Матрица расстояний | GraphHopper Matrix API → Haversine (fallback) |
| Геокодер (primary) | Yandex Geocoder API (без задержки) |
| Геокодер (fallback) | Nominatim / OpenStreetMap (1 req/sec) |
| Карты | Leaflet.js + OpenStreetMap |
| База данных | PostgreSQL (Replit managed) |
| Excel | openpyxl |
| Графики | Recharts |
| Type-safe API клиент | Orval v8 (OpenAPI codegen) + Zod |

## Возможности

- Управление базой магазинов с умным геокодированием (Яндекс → Nominatim fallback)
- Импорт магазинов из Excel-файла (`.xlsx`) со встроенным шаблоном
- Построение оптимальных маршрутов для 1–50 машин с OR-Tools VRP
- **Балансировка нагрузки**: `SetGlobalSpanCostCoefficient(100)` равномерно распределяет точки между курьерами
- **Гибридная матрица расстояний**: GraphHopper для точных дорожных расстояний с Haversine fallback
- Учёт грузоподъёмности и временных окон
- Интерактивная карта Leaflet с цветными маршрутами
- Ссылки на Яндекс Навигатор и отправка через WhatsApp
- Аналитика: пробег по дням, экономия по месяцам, топ-10 магазинов

## Структура проекта

```
smartroute/
├── artifacts/
│   ├── api-server/          # Python FastAPI backend
│   │   └── main.py          # VRP-логика, геокодер, GraphHopper, OR-Tools
│   └── smartroute/          # React + Vite frontend
│       └── src/
│           ├── pages/       # Страницы приложения
│           └── components/  # UI-компоненты (shadcn/ui)
├── lib/
│   ├── api-spec/            # OpenAPI 3.1 спецификация + конфиг Orval
│   │   └── openapi.yaml
│   ├── api-client-react/    # Сгенерированные React-хуки (Orval)
│   └── api-zod/             # Сгенерированные Zod-схемы (Orval)
├── docs/
│   ├── ARCHITECTURE.md      # Архитектура системы
│   ├── PROJECT_FLOW.md      # Потоки данных и диаграммы
│   └── CONTEXT.md           # Контекст проекта, решения, ограничения
└── README.md
```

## Ключевые модули

| Модуль | Расположение |
|---|---|
| VRP-логика (OR-Tools) | `artifacts/api-server/main.py` → `solve_vrp()` |
| GraphHopper Matrix API | `artifacts/api-server/main.py` → `get_matrix_from_graphhopper()` |
| Yandex Geocoder | `artifacts/api-server/main.py` → `geocode_address_yandex()` |
| Nominatim (fallback) | `artifacts/api-server/main.py` → `geocode_address_nominatim()` |
| Балансировка нагрузки | `artifacts/api-server/main.py` → `SetGlobalSpanCostCoefficient(100)` |
| UI карты (Leaflet) | `artifacts/smartroute/src/pages/result.tsx` |
| Аналитика | `artifacts/smartroute/src/pages/analytics.tsx` |
| OpenAPI спецификация | `lib/api-spec/openapi.yaml` |

## Гибридная стратегия GraphHopper

Бесплатный план GraphHopper ограничен **5 точками на запрос**. Используется трёхуровневый подход:

```
≤ 4 магазинов → 1 запрос GraphHopper для всей матрицы → OR-Tools VRP
> 4 магазинов → Haversine-кластеризация → GraphHopper на кластер (≤4 точки) → OR-Tools
HTTP 429      → автоматический fallback на Haversine (60 сек блокировка)
```

## Переменные окружения

| Переменная | Обязательна | Описание |
|---|---|---|
| `DATABASE_URL` | Да | PostgreSQL строка подключения |
| `GRAPHHOPPER_API_KEY` | Рекомендована | Ключ GraphHopper Matrix API |
| `YANDEX_GEOCODER_API_KEY` | Рекомендована | Ключ Яндекс Геокодера |

При отсутствии ключей система выводит предупреждение и работает через fallback (Haversine / Nominatim).

## Запуск локально

```bash
# Установить зависимости
pnpm install

# Запустить API-сервер (порт 8080)
cd artifacts/api-server && python3 main.py

# Запустить фронтенд (порт 24853)
PORT=24853 BASE_PATH=/ pnpm --filter @workspace/smartroute run dev
```

## Codegen (после изменений OpenAPI spec)

```bash
pnpm --filter @workspace/api-spec run codegen
```

## Алгоритм расчёта arrive_by

Для каждой точки маршрута время прибытия вычисляется нарастающим итогом от 09:00:

1. `drive_min = haversine(prev, curr) / AVG_SPEED_KMH (30 км/ч)` 
2. `cumulative += drive_min`
3. `arrive_by = 09:00 + cumulative`
4. `cumulative += unload_minutes` (для следующей точки)

Это гарантирует реалистичное расписание, а не просто дедлайн из временного окна.

## Документация

- [Архитектура](docs/ARCHITECTURE.md)
- [Потоки данных](docs/PROJECT_FLOW.md)
- [Контекст проекта](docs/CONTEXT.md)
