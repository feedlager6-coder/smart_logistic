---
name: Cookie SameSite iframe fix
description: Why SameSite=none+Secure is required for Replit Canvas and cross-site iframe contexts
---

## The rule
JWT auth cookie must be set with `SameSite=none; Secure=true`.

**Why:** Replit Canvas (and any embedded iframe) places the app in an iframe where the top-level origin (replit.com) differs from the iframe origin (xxx.replit.dev). Browsers treat script-initiated fetch/XHR from within a cross-site iframe as cross-site requests. `SameSite=lax` blocks cookies for cross-site requests → all API calls return 401 even after a successful login.

**How to apply:** In `artifacts/api-server/main.py`:
- `COOKIE_SAMESITE = os.environ.get("COOKIE_SAMESITE", "none")`
- `COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() in ("1", "true", "yes")`
- Both `set_cookie` and `delete_cookie` calls use these variables.

In production (Railway, HTTPS) the defaults work without any env var changes.
For pure HTTP localhost (no iframe), set `COOKIE_SAMESITE=lax` and `COOKIE_SECURE=false`.
`SameSite=none` REQUIRES `Secure=true` — browsers reject none+insecure.
