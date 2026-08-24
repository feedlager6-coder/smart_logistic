---
name: post-merge script (scripts/post-merge.sh)
description: What the post-merge reconciliation script may and may not do in this repo
---

The repo runs `scripts/post-merge.sh` after a task merge (configured in `.replit` `[postMerge]`).

**Rule:** the script must only run `pnpm install --frozen-lockfile`. It must NOT run `drizzle-kit push` (or any `pnpm --filter db push`).

**Why:** The Drizzle schema (`lib/db/src/schema/index.ts`) is intentionally empty — the Python FastAPI backend owns and migrates the database via idempotent `ALTER TABLE ... IF NOT EXISTS` statements on startup. Running `drizzle-kit push` against an empty schema asks Drizzle to drop every existing table, which would wipe the production/dev database. `--force` makes this silent and catastrophic.

**How to apply:** any schema change goes into the Python backend startup migrations, never Drizzle. Keep post-merge.sh limited to dependency install.
