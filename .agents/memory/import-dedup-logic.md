---
name: Import deduplication logic
description: Rules for how store import deduplication works; which signals classify rows as duplicates vs warnings
---

# Import Dedup Logic (post-audit revision)

## Three Phases

**Phase A — In-file dedup** (unchanged):
Collapses rows with same normalized (name, address) within the upload. Handles 1C exports where one store appears once per product line.

**Phase B — DB identity check** (import_mode):
- `new_only` (default): skip row if (name, address) matches DB store
- `update`: overwrite existing store
- `all`: always insert
- Key matching: tries BOTH `raw_addr` AND `city+raw_addr` keys to handle city-prepended addresses stored in DB.

**Phase C — Proximity check** (name-aware, NOT auto-dedup):
- Same name + close coords → `match_reason: "name_coords"`, `is_likely_duplicate: true`
- Same name + same address → `match_reason: "name_address"`, `is_likely_duplicate: true`
- **Different names + close coords → `match_reason: "coords_only"`, `is_likely_duplicate: false` (WARNING only)**

## Preview endpoint signals

`POST /api/stores/import/preview` returns `matches` array with per-row details:
- `reason: "name_address"` — strong duplicate (name AND address match)
- `reason: "yandex_url"` — strong duplicate (same Yandex URL in map_url)
- `reason: "address_only"` — NOT a duplicate (same address, different name = different tenants)

**Why:** MANGO + Спортмастер + Детский Мир at the same address are different stores. Old code flagged them all as proximity duplicates.

## Geocoding cache

Now uses persistent DB table `geocode_cache` (normalized_address UNIQUE):
- Lookup order: in-memory dict → DB cache → Yandex API → Nominatim
- Only successful results stored (never caches "not found")
- Admin endpoints: `GET/DELETE /api/admin/geocode-cache[/{id}]`
- Evicts in-memory cache when DB entry deleted

## City+address key fix

Import row lookup now tries BOTH:
1. `(normalize(name), normalize(raw_addr))` — file as-is
2. `(normalize(name), normalize(city+raw_addr))` — as stored in DB after city prepending

Without this, stores with separate city column were never deduped against DB.
