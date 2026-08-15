---
name: Integrations pattern
description: How the integrations feature (1C and future ones) is architected in SmartRoute
---

# Integration Architecture

**Tables**: `integrations` (owner_id, type, name, status, config JSONB, last_sync_at) + `integration_sync_logs` (integration_id FK CASCADE, status, orders_received, stores_matched, stores_unmatched, errors_count)

**Why:** Integrations store their API key reference in `config->>'api_key_id'` (int cast). The sync logging hook (`_record_integration_sync`) in `v1_orders_batch` checks `request.state.username` for `api_key:ID` pattern and writes a log row automatically — no changes needed in the 1C BSL module.

**How to apply:** When adding new integration types (МойСклад, Bitrix24), add their type to the allowlist in `POST /api/integrations`, add a card in `INTEGRATION_CARDS` in `integrations.tsx`, add a wizard and dashboard component similar to OneCWizard/OneCDashboard.

**Status transitions**: setup → active (first successful sync via API key) | active → error (sync with errors only) | any → disabled (manual). Derived from `integration_sync_logs` via `_record_integration_sync`.

**BSL module**: Served as base64 JSON `{data, filename}` from `GET /api/integrations/{id}/download-module`. Template string `_1C_BSL_MODULE` in main.py, placeholders `{{BASE_URL}}` and `{{API_KEY}}`. API key value is always a placeholder (never stored full key — only hash in DB).

**Endpoints**: GET/POST /api/integrations, GET/PUT/DELETE /api/integrations/{id}, POST /{id}/test, POST /{id}/sync, GET /{id}/logs, GET /{id}/download-module
