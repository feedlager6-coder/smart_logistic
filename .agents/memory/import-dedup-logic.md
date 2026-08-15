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

## Daily-orders (/api/orders/*) is a SEPARATE import path from /api/stores/import

Invariants (don't regress):
- Orders match & dedup by **(name+address)**, never name-only. Same name at different
  addresses are distinct delivery points (the canonical 1С test file must yield 50
  points, not 25 — name-only dedup collapses them).
- A multi-row 1С file (one product per row) aggregates into ONE point per
  (norm name, norm addr): sums qty/weight/volume/amount + a "products" summary string.
- `Количество`/products are **display-only**. VRP demand per point stays 1 unit; product
  quantity is never cargo load.

### Debounced mapping-override recompute (UI race invariants)
When the user re-maps a column, the preview is recomputed silently against the same
uploaded file. Two guards are mandatory or you get data-integrity bugs:
- **Out-of-order responses:** gate every state write behind a per-request sequence id;
  only the latest request may apply its result.
- **Stale import:** any mapping change must immediately mark the preview stale and block
  import until a *successful* recompute clears it — otherwise you import points built
  from an outdated mapping. A new full file-upload must force-clear the recompute flags
  (they can otherwise stick and permanently disable import).

### Bulk-create result keying
Pending-unmatched cleanup must key by (name+address), not name-only, because 1С files
contain many same-name/different-address points; the bulk-create result therefore echoes
`address` for each row.
