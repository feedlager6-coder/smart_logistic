---
name: OR-Tools SetRange CP Solver fail
description: Root cause and fix for the "CP Solver fail" crash on large (>30 stop) clusters with time windows enabled
---

## Rule

`time_dim.CumulVar(routing_idx).SetRange(tw_from, tw_to)` in OR-Tools raises `Exception: CP Solver fail` when constraint propagation makes the variable's domain empty during model CONSTRUCTION (before any solving).

## Three Trigger Conditions

1. **`tw_from >= tw_to`** — swapped or overnight window; `SetRange(1080, 540)` immediately creates empty domain.
2. **`tw_to < depot_start (9*60=540)`** — window closes before 09:00; min arrival after depot propagation > tw_to.
3. **Large cluster cumulative infeasibility** — with 30+ stops + 15 min unload each, cumulative time can exceed 18:00 for stops later in the route; OR-Tools propagates and finds wipeout.

## Fix (4 levels)

**Level 1 — Pre-validation in `_ortools_solve_group`:**
- Sanitize all windows before touching OR-Tools
- If `tw_from >= tw_to` or `tw_to < 9*60` → expand to (9*60, 23*60)
- Log count of bad windows as WARNING

**Level 2 — try/except around model construction:**
- Wrap entire `AddDimension` + `SetRange` loop in try/except
- On exception → rebuild fresh model without time dimension (distance-only)
- This handles the large-cluster cumulative infeasibility case

**Level 3 — per-cluster catch in `solve_vrp` Phase B:**
- `_ortools_solve_group` call wrapped in try/except
- On exception → use original sweep order (`cluster_nodes`)

**Level 4 — degradation chain in `build_route`:**
- Try 1: solve_vrp with TW
- Try 2 (on exception): solve_vrp without TW + add warning to response
- Try 3 (on exception): greedy round-robin _fallback_distribution + add warning
- `result["warnings"]` list returned to frontend for amber notification
- NEVER returns HTTP 500 for solver failures

## Pre-validation also added in `build_route`
Before calling solve_vrp, validates all store_time_windows:
- Replaces invalid windows with (9*60, 23*60)
- Counts and logs `invalid_tw_count`
- Adds warning string to route_warnings if any were fixed

**Why:** Production crash at 120 stores / 9 vehicles with use_time_windows=True. Cluster of 34 stops caused CP propagation domain wipeout. Exception was uncaught → HTTP 500.

**How to apply:** All large builds (>50 stores with TW) are now safe. `result.warnings` is non-empty when degradation occurred.
