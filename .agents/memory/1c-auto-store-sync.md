---
name: 1C auto-store-sync design
description: Why counterparty_code ≠ stores.external_id naming asymmetry; auto-store-creation algorithm priority order
---

# 1C Auto-Store Sync Design

## The naming asymmetry

`WebhookOrderItem.external_id` (str) = **order's** external ID (idempotency key for the order itself, e.g. document number "ЗП-000123").

`WebhookOrderItem.counterparty_code` (str) = **store's** external ID in 1C (code of the counterparty/store, e.g. "000000042"). This maps to `stores.external_id` in the database.

**Why:** `external_id` was already taken for order-level idempotency before the store-sync feature was designed. Using it for counterparty would have broken existing API consumers.

## Auto-store-creation priority in `_auto_create_store_if_missing`

1. Match by `stores.external_id = counterparty_code` (exact, fast)
2. Fuzzy name match via `_match_store_to_db` (Jaccard ≥ 0.85)
   - Side effect: backfills `stores.external_id` if store found by name and has no external_id yet
3. Auto-create store with `geocode_status='pending'`, `source='1c'` — only if `address OR counterparty_code` present (not enough info otherwise)

## db_stores mutation

`db_stores` list is mutated in-place (`.append(new_store)`) so subsequent orders **in the same batch** from the same counterparty find the newly created store without a DB round-trip.

## Deliverables

- `stores.external_id TEXT DEFAULT ''` and `stores.source TEXT DEFAULT 'manual'` — added via migration
- `WebhookIngestRequest.auto_create_stores: bool = True` — client-side flag to enable/disable
- Response now includes `auto_created_stores: int` — EPF shows this to operator
- BSL module sends `counterparty_code` (from `З.Контрагент.Код`), `order_number`, `replace_date=Истина`, `auto_create_stores=Истина`
