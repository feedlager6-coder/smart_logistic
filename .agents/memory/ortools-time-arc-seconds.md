---
name: OR-Tools time-mode arc cost scale
description: int_time_arc must use raw seconds (not minutes) to prevent GLS hang on dense clusters
---

## Rule

In `_ortools_solve_group`, when building `int_time_arc` for time-mode optimization, use **raw seconds** from the time_matrix, NOT minutes:

```python
# CORRECT — values 60–1800, GLS works
int_time_arc = [[max(1, int(v)) for v in row] for row in time_matrix]

# WRONG — values 1–30, GLS hangs on dense clusters
int_time_arc = [[max(1, int(v / 60)) for v in row] for row in time_matrix]
```

## Why

OR-Tools GLS (Guided Local Search) uses arc costs to compute penalties. With minute-scale values (1–30), in dense urban clusters (Mahachkala center) where many stores are < 1 km apart, most arc costs round to **1 minute**. A near-uniform cost matrix causes GLS's penalty function to produce zero or identical penalties — the solver can no longer distinguish good from bad moves and enters an infinite evaluation loop. The `params.time_limit` is set correctly but GLS never reaches the time-limit check because it's stuck evaluating millions of identical-cost moves via the Python callback.

Confirmed with stack trace: main thread stuck in `arc_cb` inside `routing.SolveWithParameters` after 60+ seconds on a 33-stop cluster.

## How to apply

- `arc_cb` (arc cost for optimization objective) → raw seconds  
- `time_cb` (Time Dimension for TW constraints) → minutes (unchanged, must match tw_from/tw_to in minutes)  
- These are independent OR-Tools dimensions; different units are fine
- Safety fallback also added: if time-mode returns no solution, retry with distance objective in same function
