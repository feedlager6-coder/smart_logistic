---
name: Capacitated sweep clustering
description: VRP clustering uses dynamic per-cluster cap to prevent runaway sectors on city-edge depots
---

## Rule
`_cluster_by_capacitated_sweep()` replaced `_cluster_by_sweep()` in `solve_vrp` Step 2.
Cap = `max(2, ceil(n / vehicles * 1.5))`. When a sector overflows the cap, remaining points spill into the next sector.

**Why:** On real data (Makhachkala, 120 stores, depot on north city edge), 42/120 stores fell in one 40° arc (320°–360°), giving max=37 stops, ratio=4.1x. Capacitated sweep reduced to max=22, ratio=1.8x, **−15.4% km** (126.9 vs 149.9). Confirmed on Railway PostgreSQL session 49.

**How to apply:** Both OR-Tools and no-OR-Tools fallback paths in `solve_vrp` call `_cluster_by_capacitated_sweep`. Do not revert to equal-angle `_cluster_by_sweep` — it collapses when depot is outside the store centroid.

## ETA breakdown fields
`POST /api/route/build` response per route now includes:
- `drive_minutes` — road time only (km × ETA_ROAD_FACTOR / speed × 60)
- `service_minutes` — total unload time (15 min/stop × stops), 0 if use_unload_time=false
- `estimated_minutes` — sum of both (unchanged, backward compat)
- Result-level `use_unload_time: bool` saved in result_json for historical replay

Frontend in result.tsx shows `"X ч Y мин (езда Z мин)"` when service_minutes > 0.
