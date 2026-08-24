# SmartRoute — Project Context

## Purpose

SmartRoute is a SaaS-style logistics tool for Russian distributors.
It turns a list of delivery addresses into optimised multi-vehicle routes,
saving fuel costs and driver time.

## Key Design Decisions

### Contract-first API

All frontend↔backend communication is governed by `lib/api-spec/openapi.yaml`.
No direct `fetch` calls in the frontend — only Orval-generated hooks.
This catches type mismatches at compile time before they reach production.

### Python backend, not Node

OR-Tools (Google's VRP solver) has an excellent Python SDK and mediocre
Node bindings. Python was chosen specifically to access OR-Tools natively.
The Express stub in `artifacts/api-server/src/` is intentionally unused.

### Hybrid GraphHopper strategy

GraphHopper's free plan caps matrix requests at 5 locations.
The backend works around this by:
1. Using Haversine for coarse geographic clustering (free, instant).
2. Calling GraphHopper only for small per-vehicle groups (≤ 4 stops + depot).

This keeps every API request within the free limit while still getting
road-accurate distances for the final optimisation.

### Yandex Geocoder as primary

Nominatim (OpenStreetMap) enforces 1 request/second and times out on Russian
addresses more often than Yandex. Yandex Geocoder is used as the primary
because:
- No rate-limit delay needed.
- Better coverage of Russian postal addresses.
- Nominatim is kept as a silent fallback.

### Workload balancing

`SetGlobalSpanCostCoefficient(100)` is set on the distance dimension.
Without it OR-Tools might assign 7 stops to vehicle 1 and 1 to vehicle 2.
The coefficient penalises the imbalance, producing fairer distributions.

## Configuration

All sensitive values are stored as Replit environment variables (userenv):

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Auto-provided by Replit Postgres |
| `GRAPHHOPPER_API_KEY` | Free tier key, 5 loc/request limit |
| `YANDEX_GEOCODER_API_KEY` | Yandex Cloud key |

The backend logs warnings at startup if keys are missing and automatically
degrades to Haversine / Nominatim — it never throws an error due to
missing external service credentials.

## Current Limitations

| Limitation | Workaround |
|---|---|
| GraphHopper free plan: 5 pts/request | Hybrid clustering strategy |
| Nominatim: 1 req/sec | Yandex primary + sleep only when Yandex absent |
| No real-time traffic | GraphHopper uses average travel times |
| No persistent user accounts | Single-tenant, all stores shared |
| Route result not persisted | Stored in localStorage, lost on tab close |

## Tech Stack Summary

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, Tailwind CSS 4, shadcn/ui, Leaflet, Recharts |
| Backend | Python 3.11, FastAPI, Uvicorn |
| VRP Solver | Google OR-Tools (ortools 9.x) |
| Primary Geocoder | Yandex Geocoder API |
| Fallback Geocoder | Nominatim (OpenStreetMap) |
| Distance Matrix | GraphHopper Matrix API (road-accurate) |
| Distance Fallback | Haversine formula (as-the-crow-flies) |
| Database | PostgreSQL (Replit managed) |
| API Contract | OpenAPI 3.1 → Orval v8 (React-Query + Zod) |
| Excel | openpyxl |
