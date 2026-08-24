---
name: OR-Tools protobuf Duration time limit (float support)
description: OR-Tools time_limit is a protobuf Duration; setting .seconds alone gives integer granularity; use .nanos for sub-second limits needed in tests.
---

## Rule
To set a fractional OR-Tools time limit (e.g. 0.5s in tests):
```python
_tl = float(ORTOOLS_TIME_LIMIT_SECONDS)
params.time_limit.seconds = int(_tl)
params.time_limit.nanos = int((_tl - int(_tl)) * 1_000_000_000)
```

The global `ORTOOLS_TIME_LIMIT_SECONDS` (default 2) can be patched at module level in tests:
```python
M.ORTOOLS_TIME_LIMIT_SECONDS = 0.5  # in reset_counters() before solve_vrp()
```

**Why:** `params.time_limit.seconds` is a protobuf int64 field — assigning 0.5 silently truncates to 0 (meaning infinite time). Stress tests with 2s limit × 10 clusters = 20s per scenario, blowing CI timeouts.

**How to apply:** All test scripts that call `solve_vrp()` repeatedly should patch `M.ORTOOLS_TIME_LIMIT_SECONDS = 0.5` in their reset function.
