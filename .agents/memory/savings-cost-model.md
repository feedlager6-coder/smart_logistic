---
name: Savings metrics cost model
description: Audit findings for calculate_savings() — cost_per_km breakdown, ROAD_FACTOR, Haversine consistency
---

## Rule

`calculate_savings()` in `main.py`:
- `cost_per_km = 31` руб/км (real roads, Gazelle, Russia 2026)
- `ROAD_FACTOR = 1.4` — applied **only** to monetary calculations (fuel_l, fuel_cost_rub, rub_day)
- `saved_km` and `saved_pct` use raw Haversine — both baseline and optimized_km use Haversine, so comparison is internally consistent

## Cost breakdown (31 руб/км)

| Component | руб/км | Basis |
|-----------|--------|-------|
| Fuel | 7.0 | 10 л/100 км × 70 руб/л |
| Driver (gross + taxes) | 13.0 | 65 000 руб/мес / 25 дн / 200 км/дн |
| Maintenance + wear | 7.0 | Gazelle industry norms |
| Insurance + overhead | 4.0 | OSAGO, misc |
| **Total** | **31.0** | |

## Why ROAD_FACTOR = 1.4

Both baseline_km and optimized_km are computed with `haversine_meters()` (straight-line).
This makes the percentage comparison honest (apples-to-apples).
BUT fuel and money savings should reflect what drivers actually drive on real roads.
OSRM data for Makhachkala shows real roads ≈ 1.4–1.5× Haversine distance.
ROAD_FACTOR = 1.4 (conservative estimate) converts straight-line saved km to real road saved km for monetary purposes.

## Audit findings (2026-06-03)

| Metric | Before fix | After fix | Notes |
|--------|-----------|-----------|-------|
| saved_pct | ✅ correct | ✅ correct | Both Haversine |
| saved_km | ✅ correct | ✅ correct | Haversine straight-line |
| saved_fuel_l | ⚠️ -31% low | ✅ correct | Now uses ROAD_FACTOR |
| saved_rub_day | ⚠️ +11% high | ✅ -13% vs old | cost 50→31, +ROAD_FACTOR |

**How to apply:** Any future change to fuel price, driver wage, or cost breakdown → update `cost_per_km` and the comment breakdown. Any change to the distance calculation method → reconsider whether ROAD_FACTOR is still needed.
