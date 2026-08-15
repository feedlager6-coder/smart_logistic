---
name: Shell/test-harness DB creds point at stale prod
description: Why direct psql from shell and runTest fail with "password authentication failed for user postgres"
---

The repo `.env` sets `DATABASE_URL=postgresql://...@<railway-prod-host>` with a password
that is NOT valid from this dev environment. The shell, ad-hoc `psql`/`psycopg2`
scripts, and the `runTest` e2e harness pick up that `.env` value and fail with
`FATAL: password authentication failed for user "postgres"`.

The running **API server** is unaffected — it connects to the correct dev DB via the
environment-injected connection (Replit-managed), not the `.env` file.

**How to apply:**
- Don't verify DB state by connecting from the shell with the `.env` URL; it will fail.
- Verify through the live API instead: log in (`POST /api/auth/login`, username `admin`,
  password in `$ADMIN_PASSWORD` shell env), extract the `smartroute_token` cookie from
  the Set-Cookie header, and curl the real endpoints.
- `runTest` may report `unable` with this same postgres auth error — that's an
  environment limitation, not a bug in the code under test. Fall back to curl smoke tests.
