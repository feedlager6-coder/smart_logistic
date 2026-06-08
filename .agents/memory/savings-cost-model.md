---
name: Savings metrics cost model
description: cost_per_km from DB company_settings table (not hardcoded), formula, ROAD_FACTOR, savings response fields
---

## Rule

`calculate_savings()` in `main.py` reads settings from `company_settings` table via `get_company_settings()`.

- Formula: `cost_per_km = fuel_price × consumption / 100` (fuel-only, no salary)
- Defaults: 67 ₽/л, 13 л/100 км → cost_per_km = 8.71 ₽/км
- `ROAD_FACTOR = 1.4` — **geographic constant**, applied **only** to monetary calculations (fuel_l, rub_day). Not user-settable.
- `saved_km` and `saved_pct` use raw Haversine — both baseline and optimized use Haversine, comparison is internally consistent

**Why driver_salary removed:** Simplification — salary is a fixed cost, not proportional to km. Fuel-only formula is transparent and auditable.

## Savings response fields

POST /api/route/build → result.savings includes:
- `cost_per_km` — the value used for this build
- `fuel_price`, `fuel_consumption` — for frontend breakdown display
- `driver_salary` field REMOVED (no longer in formula or response)

## DB schema

`company_settings` table (single row):
- `fuel_price`, `fuel_consumption`, `cost_per_km`, `updated_at`
- Column `driver_salary` kept in DB for backward compat but NOT read or written by any code path
- Seeded on startup with defaults if empty
- Migration on startup: rows with old salary-inflated cost_per_km auto-corrected to fuel-only formula

`route_sessions` table has `cost_per_km` column (historical — the value at build time).

## Endpoints

- `GET /api/settings` — returns `{fuel_price, fuel_consumption, cost_per_km}`
- `PUT /api/settings` — body: `{fuel_price, fuel_consumption}`; recalculates cost_per_km automatically

**Why:** Needed to let users configure real fleet costs. Past sessions store cost_per_km historically so analytics remains consistent.

**How to apply:** Settings page `/settings` shows live calculator with example savings. Result page shows savings breakdown.
