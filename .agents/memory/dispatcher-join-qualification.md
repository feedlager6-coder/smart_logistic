---
name: Dispatcher join qualification
description: SQL safety rule for the dispatcher assignments endpoint.
---

When a dispatcher query joins `route_assignments` with `route_executions`, qualify every selected column with its table alias, including `id`, `status`, and `updated_at`.

**Why:** Both operational tables have overlapping column names; an unqualified SELECT can fail at runtime and make the manager panel appear empty even while driver updates continue to work.

**How to apply:** Review any future changes to the assignments/executions endpoint for qualified `e.*` and `a.*` references before changing frontend behavior or data filters.