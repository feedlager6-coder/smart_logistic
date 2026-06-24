#!/bin/bash
set -e

# Install JS workspace dependencies (frozen to the committed lockfile).
pnpm install --frozen-lockfile

# NOTE: The database schema is owned and migrated by the Python backend
# (artifacts/api-server/main.py runs idempotent `ALTER TABLE ... IF NOT EXISTS`
# statements on startup). The Drizzle schema (lib/db) is unused/empty, so we do
# NOT run `drizzle-kit push` here — doing so would try to drop all tables and
# wipe the database. Leave schema migration to the backend startup.
