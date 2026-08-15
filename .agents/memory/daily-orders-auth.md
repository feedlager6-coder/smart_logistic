---
name: Daily orders auth and import pattern
description: Correct auth and import patterns for orders endpoints; bugs found and fixed during audit
---

# Daily orders — auth and import patterns

## The rule
All orders endpoints (and ALL endpoints in main.py) must use `get_user_id(request)` to obtain the current user ID.

`_require_auth` does NOT exist in the codebase. Using it causes `NameError` at runtime — the endpoint always returns 500.

**Why:** `get_user_id` is defined at line ~2761, reads `request.state.user_id` (set by `auth_middleware`), raises HTTP 401 if absent. `_require_auth` was invented during code generation but never defined.

**How to apply:** Every protected endpoint:
```python
@app.post("/api/orders/...")
def my_endpoint(request: Request, ...):
    uid = get_user_id(request)   # ← correct
    # NOT: uid = _require_auth(request)  ← NameError
```

## Module-level imports required
`re` and `openpyxl` must be imported at the top of main.py (lines 1, 13):
```python
import re
import openpyxl
```
These were missing; `_normalize_name` (called in tight loops) did `import re` inside the function body, and `orders_preview` did `import openpyxl as _xl` inside the function. Now both are at module level.

## Row filter in preview
The filter for empty rows in `orders_preview` must check the name column specifically:
```python
# CORRECT:
preview_rows = [r for r in preview_rows
                if name_col is None
                or r["cells"].get(name_col, "").strip() not in ("", "None", "nan")]

# WRONG (was): any(v.strip() for v in r["cells"].values())
# — kept rows with any non-empty cell (subtotal rows, separator rows, etc.)
```

## Column pattern must include "Название"
`_ORDER_COLUMN_PATTERNS["store_name"]` must include `"название"` (plain, without suffix) so that the SmartRoute store export format (column header = "Название") is auto-detected correctly.

## Import limit
`orders_import` enforces a 2000-row limit per call to prevent slowdowns on large files.
