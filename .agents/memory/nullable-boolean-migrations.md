---
name: Nullable boolean migrations
description: Safe migration pattern for legacy nullable activity flags
---

When an existing table gains or standardizes an activity boolean, backfill NULL values before setting a default or NOT NULL constraint. During rollout, use `COALESCE(flag, TRUE)` in critical lookup paths if legacy rows must remain usable.

**Why:** PostgreSQL treats `NULL = TRUE` as unknown, so legacy records can silently disappear from active-user or driver lookups even though they exist.

**How to apply:** For every legacy boolean used in authentication, ownership, or operational assignment queries, pair the schema backfill with a temporary/null-safe query path and verify the migration runs against the actual production database.