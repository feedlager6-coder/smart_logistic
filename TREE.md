# SmartRoute — Project Structure

## Full Tree

```
smartroute/                          # Monorepo root (pnpm workspace)
│
├── artifacts/                       # Runnable application artifacts
│   │
│   ├── api-server/                  # ── BACKEND ──────────────────────────
│   │   └── main.py                  # FastAPI application (single file)
│   │                                #   · Database init & seed
│   │                                #   · solve_vrp()    ← OR-Tools VRP
│   │                                #   · geocode_address() ← Nominatim
│   │                                #   · calculate_savings()
│   │                                #   · yandex_nav_url()
│   │                                #   · All REST endpoints
│   │
│   └── smartroute/                  # ── FRONTEND ─────────────────────────
│       ├── index.html
│       ├── package.json
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx             # React entry point
│           ├── App.tsx              # Router + QueryClient setup
│           ├── index.css            # Global styles + theme variables
│           │
│           ├── pages/               # ── PAGES ───────────────────────────
│           │   ├── home.tsx         # Landing page + live metrics
│           │   ├── stores.tsx       # Store CRUD + Excel import/template
│           │   ├── route.tsx        # Route planning (store picker + vehicles)
│           │   ├── result.tsx       # Results map (Leaflet) + route cards
│           │   ├── analytics.tsx    # Recharts dashboards
│           │   └── not-found.tsx
│           │
│           ├── components/
│           │   ├── layout.tsx       # App shell: sidebar + main area
│           │   └── ui/              # shadcn/ui components (50+ files)
│           │
│           └── hooks/
│               └── use-mobile.tsx
│
├── lib/                             # ── SHARED LIBRARIES ─────────────────
│   │
│   ├── api-spec/                    # OpenAPI 3.1 specification
│   │   ├── openapi.yaml             # Single source of truth for the API
│   │   └── orval.config.ts          # Code generation config
│   │
│   ├── api-client-react/            # Generated React hooks (Orval output)
│   │   └── src/generated/
│   │       └── api.ts               # useListStores, useBuildRoute, etc.
│   │
│   └── api-zod/                     # Generated Zod schemas (Orval output)
│       └── src/generated/
│           ├── api.ts               # Validators for all request/response shapes
│           └── types/               # TypeScript types
│
├── scripts/                         # Build/setup scripts
├── .env.example                     # Environment variable reference
├── .gitignore
├── README.md
├── TREE.md                          # This file
├── package.json                     # Workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Module Responsibilities

### Backend (`artifacts/api-server/main.py`)

| Function / Endpoint | Responsibility |
|---|---|
| `solve_vrp()` | Google OR-Tools VRP — distributes stops across vehicles optimally |
| `haversine_meters()` | Distance matrix builder (great-circle distance) |
| `geocode_address()` | Nominatim reverse geocoding with in-memory + DB cache |
| `calculate_savings()` | Estimates fuel/cost savings vs. unoptimized routing |
| `yandex_nav_url()` | Generates Yandex Navigator deep link for couriers |
| `GET /api/stores/template` | Returns a styled Excel template via openpyxl |
| `POST /api/stores/import` | Bulk import from Excel, geocodes each address |
| `POST /api/route/build` | Main optimization endpoint — runs VRP, returns routes |
| `GET /api/analytics/*` | SQL aggregations over `route_sessions` history |

### Frontend (`artifacts/smartroute/src/pages/`)

| Page | Key features |
|---|---|
| `home.tsx` | SaaS landing, live summary metrics via `useGetAnalyticsSummary` |
| `stores.tsx` | Table CRUD, geocode trigger, Excel import with progress, template download |
| `route.tsx` | Dual-panel: store picker (search + checkboxes) + dynamic vehicle list |
| `result.tsx` | Leaflet map (colored polylines per vehicle), route cards, Yandex/WhatsApp links |
| `analytics.tsx` | 3 Recharts graphs: daily mileage, monthly savings, top-10 stores |

### Database Schema

```sql
stores              -- Delivery points (name, address, lat/lon, time windows)
route_sessions      -- Historical route builds (km, savings, vehicle count)
route_session_stores -- Which stores were visited in each session (for analytics)
```

## Data Flow

```
User selects stores & vehicles
         │
         ▼
POST /api/route/build
         │
         ├─ Fetch store coords from DB
         ├─ Build distance matrix (haversine_meters)
         ├─ solve_vrp()  ──► OR-Tools VRP solver
         ├─ Calculate km per vehicle
         ├─ Generate Yandex Navigator URLs
         ├─ Save session to route_sessions
         │
         ▼
RouteResult → localStorage → /result page
         │
         ├─ Leaflet map renders colored polylines
         └─ Route cards show ordered stops + action buttons
```
