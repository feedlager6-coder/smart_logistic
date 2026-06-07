---
name: Savings metrics cost model
description: cost_per_km from DB company_settings table (not hardcoded), formula, ROAD_FACTOR, savings response fields
---

## Rule

`calculate_savings()` in `main.py` reads settings from `company_settings` table via `get_company_settings()`.

- Formula: `cost_per_km = (fuel_price × consumption / 100) + (salary / 22 / 200)`
- Defaults: 67 ₽/л, 13 л/100 км, 55 000 ₽/мес → cost_per_km ≈ 21.21 ₽/км
- `ROAD_FACTOR = 1.4` — **geographic constant**, applied **only** to monetary calculations (fuel_l, rub_day). Not user-settable.
- `saved_km` and `saved_pct` use raw Haversine — both baseline and optimized use Haversine, comparison is internally consistent

## Savings response fields (additional fields added)

POST /api/route/build → result.savings now includes:
- `cost_per_km` — the value used for this build
- `fuel_price`, `fuel_consumption`, `driver_salary` — for frontend breakdown display

## DB schema

`company_settings` table (single row):
- `fuel_price`, `fuel_consumption`, `driver_salary`, `cost_per_km`, `updated_at`
- Seeded on startup with defaults if empty

`route_sessions` table now has `cost_per_km` column (historical — the value at build time).

## Endpoints

- `GET /api/settings` — returns current settings
- `PUT /api/settings` — updates settings, recalculates cost_per_km automatically

**Why:** Needed to let users configure real fleet costs. Past sessions store cost_per_km historically so analytics remains consistent.

**How to apply:** Settings page `/settings` shows live calculator. Result page shows savings breakdown with link to /settings.
