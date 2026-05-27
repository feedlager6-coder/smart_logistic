# SmartRoute — Architecture

## Overview

SmartRoute is a monorepo (pnpm workspace) containing a React SPA frontend,
a Python FastAPI backend, and shared TypeScript libraries.

```
smartroute/
├── artifacts/
│   ├── api-server/        Python 3.11 + FastAPI + OR-Tools  (port 8080)
│   └── smartroute/        React 19 + Vite + Tailwind         (port 24853)
├── lib/
│   ├── api-spec/          OpenAPI 3.1 spec + Orval codegen config
│   ├── api-client-react/  Generated React-Query hooks
│   └── api-zod/           Generated Zod validation schemas
└── docs/                  This directory
```

---

## Backend (`artifacts/api-server/main.py`)

**Runtime:** Python 3.11 · FastAPI · Uvicorn

### External services

| Service | Role | Fallback |
|---|---|---|
| **Yandex Geocoder** | Primary geocoder (fast, no rate limit) | Nominatim |
| **Nominatim (OSM)** | Secondary geocoder (1 req/sec) | — |
| **GraphHopper Matrix API** | Precise road-distance matrix | Haversine formula |
| **Yandex Navigator** | Driver navigation links | — |
| **WhatsApp** | Route sharing links | — |

### Route optimisation — three-tier strategy

```
Total stores ≤ 4
  └─► ONE GraphHopper Matrix call (all points)
        └─► OR-Tools VRP (workload balancing ON)
              └─► on GH 429/error → Haversine fallback

Total stores > 4
  └─► Haversine sweep-clustering (polar-angle sectors → N clusters)
        └─► Per-cluster GraphHopper Matrix call (depot + ≤4 stores)
              └─► OR-Tools VRP per cluster (polish order)
                    └─► on GH 429/error → Haversine fallback per cluster
```

### Workload balancing

`SetGlobalSpanCostCoefficient(100)` is applied to the distance dimension so
OR-Tools penalises the gap between the longest and shortest vehicle route.
This distributes stops evenly instead of concentrating them on one vehicle.

### GraphHopper Free Plan limit

The free plan allows **5 locations per Matrix API request**.
The hybrid strategy above keeps every request within this limit.
Rate-limit (HTTP 429) triggers a 60-second back-off; all requests during
that window transparently use Haversine.

---

## Frontend (`artifacts/smartroute/`)

**Runtime:** React 19 · Vite 7 · TypeScript · Tailwind CSS 4

| Library | Purpose |
|---|---|
| `shadcn/ui` + Radix UI | Component system |
| `react-leaflet` | Interactive route maps (OpenStreetMap tiles) |
| `recharts` | Analytics charts |
| `@tanstack/react-query` | Server state, caching, mutations |
| `wouter` | Client-side routing |
| `zod` | Runtime validation of API responses |

### Pages

| Route | Page | Description |
|---|---|---|
| `/` | Home | Dashboard with summary cards |
| `/stores` | Stores | CRUD + geocoding + Excel import |
| `/route` | Route | Vehicle/store selection + route build |
| `/result` | Result | Map, route cards, Yandex/WhatsApp links |
| `/analytics` | Analytics | Mileage, savings, top-stores charts |

### Arrive-by (расчётное время прибытия)

Для каждой точки маршрута вычисляется ожидаемое время прибытия нарастающим итогом, начиная от 09:00 (депо):

```
prev_coord = depot
cumulative_min = 0

for each stop in route:
    leg_m = haversine(prev_coord, stop_coord)
    drive_min = max(1, int(leg_m / 1000 / AVG_SPEED_KMH * 60))
    cumulative_min += drive_min
    arrive_by = format(09:00 + cumulative_min)
    if use_unload_time:
        cumulative_min += stop.unload_minutes  # учитывается для следующей точки
    prev_coord = stop_coord
```

`AVG_SPEED_KMH = 30` (городская скорость). Поле `arrive_by` всегда рассчитывается,
независимо от флага `use_time_windows`.

### Порядок endpoints `/api/stores/`

FastAPI сопоставляет маршруты в порядке объявления. Статические пути (`/template`,
`/import`) объявлены **до** параметрических (`/{id}`), чтобы избежать
ошибочного сопоставления строки `"template"` с целочисленным `id`.

### Скачивание Excel-шаблона на фронтенде

`window.open("/api/stores/template", "_blank")` **не работает** в Replit-прокси —
прокси не пробрасывает `Content-Disposition: attachment`, из-за чего браузер
открывает пустую страницу вместо диалога сохранения файла.

Правильный способ — `fetch` + `Blob` + динамический `<a download>`:

```ts
const response = await fetch("/api/stores/template");
const blob = await response.blob();
const url = window.URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = "smartroute_template.xlsx";
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
window.URL.revokeObjectURL(url);
```

Это правило применимо ко **всем** файловым скачиваниям в приложении.

---

## API contract

The backend exposes a REST API documented in `lib/api-spec/openapi.yaml`.
TypeScript types and React-Query hooks are auto-generated from this spec
via **Orval** (`pnpm --filter @workspace/api-spec run codegen`).

The frontend consumes only the generated hooks — it never calls `fetch` directly.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GRAPHHOPPER_API_KEY` | Recommended | GraphHopper Matrix API key |
| `YANDEX_GEOCODER_API_KEY` | Recommended | Yandex Geocoder API key |

Missing keys trigger a warning at startup; the system degrades gracefully
(Haversine / Nominatim fallbacks).
