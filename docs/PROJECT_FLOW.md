# SmartRoute — Project Flow

## 1. Store Management

```
User fills store form / uploads .xlsx
        │
        ▼
POST /api/stores  (or  POST /api/stores/import)
        │
        ▼
geocode_address(address)
  ├── geocode_address_yandex()   ← primary (fast, no sleep)
  │       └── YANDEX_GEOCODER_API_KEY present?
  │              yes → HTTP call to geocode-maps.yandex.ru
  │              no  → skip, try Nominatim
  └── geocode_address_nominatim()  ← fallback (1 req/sec)
              └── HTTP call to nominatim.openstreetmap.org
                   (sleep 1.1s only when Yandex key absent)
        │
        ▼
Store saved to PostgreSQL with lat/lon/geocode_status
```

---

## 2. Route Building

```
User selects stores + vehicles → clicks "Build"
        │
        ▼
POST /api/route/build
  {store_ids, vehicles, depot_lat, depot_lon, ...}
        │
        ▼
Load stores from DB, build all_coords list
  [depot, store_1, store_2, ..., store_N]
        │
        ▼
solve_vrp(all_coords, num_vehicles)
  ├── Tier 1  (N ≤ 4 stores)
  │     └── get_matrix_from_graphhopper(all_coords)  → ONE API call
  │           ├── success → OR-Tools VRP (workload balancing)
  │           │              matrix_source = "graphhopper"
  │           └── fail/429 → Haversine matrix → OR-Tools VRP
  │                          matrix_source = "haversine"
  │
  └── Tier 2  (N > 4 stores)
        ├── Haversine sweep-clustering (polar-angle)
        │     → N vehicle clusters, each ≤ 4 stops
        │
        └── Per cluster:
              get_matrix_from_graphhopper([depot] + cluster_stops)
              ├── success → OR-Tools (single vehicle, polish order)
              │              gh_used = True
              └── fail/429 → Haversine matrix → OR-Tools
              matrix_source = "graphhopper" if any gh_used else "haversine"
        │
        ▼
Build response:
  routes[]  (vehicle_name, stops, total_km, yandex_url, whatsapp_url)
  savings   (optimized_km, saved_km, saved_rub_day)
  matrix_source   ("graphhopper" | "haversine")
  geocoder_used   ("yandex" | "nominatim")
        │
        ▼
Session saved to route_sessions table
        │
        ▼
Frontend stores result in localStorage
        │
        ▼
ResultPage: Leaflet map + route cards + navigation links
```

---

## 3. Analytics

```
GET /api/analytics/summary    → total routes, km, savings
GET /api/analytics/daily      → last 30 days aggregated
GET /api/analytics/monthly    → last 12 months aggregated
GET /api/analytics/top-stores → top 10 most visited stores
```

---

## 4. Codegen workflow

```
Edit lib/api-spec/openapi.yaml
        │
        ▼
pnpm --filter @workspace/api-spec run codegen
        │
        ▼
Orval reads orval.config.ts → generates:
  lib/api-client-react/src/generated/api.ts        (React-Query hooks)
  lib/api-client-react/src/generated/api.schemas.ts (TypeScript interfaces)
  lib/api-zod/src/generated/api.ts                 (Zod validators)
  lib/api-zod/src/generated/types/                 (individual TS types)
        │
        ▼
Frontend imports from @workspace/api-client-react
Backend response must match the schema
```
