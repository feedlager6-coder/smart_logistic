---
name: VRP balance benchmark results
description: Empirical A/B/C test results for centroid refinement rounds and max_stops_per_vehicle on 120 stores / 9 vehicles using Railway PostgreSQL data.
---

# VRP Balance Benchmark (120 stores / 9 vehicles, Haversine, Railway DB)

## Root cause of 37-stop route
- Angular density: 42 stores in 140°..180° (3.2x expected for 9 vehicles)
- Equal-angle sweep assigns all 42 to one 40° sector → one route gets 37+ stops
- This is geographic reality, not a bug

## A/B/C: centroid_refinement_rounds (2.0s OR-Tools budget)
| Rounds | Total km | Max stops | Ratio | Max span |
|--------|----------|-----------|-------|----------|
| 0      | 147.6    | 35        | 3.9x  | 357°     |
| 1      | 145.6 ★  | 36        | 4.0x  | 355°     |
| 3 (cur)| 145.7    | 38        | 4.2x  | 358°     |

**Why:** at 0.3s budget all 3 are identical (TSP limits dominate). At 2s budget, rounds=1 saves 0.1km vs rounds=3. Difference is negligible. Do NOT change rounds.

## max_stops_per_vehicle (rounds=3, 0.3s OR-Tools)
| Cap  | Total km | Δkm    | Max | Ratio | ΔRatio | Moved | OK? |
|------|----------|--------|-----|-------|--------|-------|-----|
| None | 147.6    | 0      | 35  | 3.9x  | 0      | 0     | —   |
| 30   | 146.7    | −0.9   | 30  | 3.3x  | −15%   | 5     | ⚠️  |
| 26   | 146.8    | −0.8   | 26  | 2.9x  | −26%   | 9     | ⚠️  |
| 24   | 146.8    | −0.8   | 24  | 2.7x  | −31%   | 11    | ✅  |

**Winner: max_stops=24** — meets criteria (km ≤5% worse AND ratio ≥30% better).
**Why:** rebalancer moves 11 stops from the 37-stop cluster to adjacent routes with minimal km penalty because all stores are densely packed in same geographic area.

## Yandex comparison (OSRM real roads, 19 stops, Авто 9 session 49)
- SmartRoute OSRM: 78.0 min, 50.81 km
- Yandex order OSRM: 80.2 min, 52.43 km  
- SmartRoute WINS by 2.2 min (statistically insignificant, <3 min threshold)
- **The 14-min Yandex gap is from Yandex's proprietary traffic/speed database, NOT stop ordering**

## What to apply
- `max_stops_per_vehicle=24` optional parameter in POST /api/route/build ✅ implemented
- `_rebalance_max_stops()` function in main.py ✅ implemented
- centroid_refinement_rounds: leave at 3 (no measurable benefit to change)

## How to apply
- No default cap (backward compatible)
- User selects: Без лимита / ≤30 / ≤26 / ≤24 in route builder UI
- Recommend ≤24 when dispatcher reports one driver has 3x more stops than others
