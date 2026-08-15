---
name: Integration package location
description: Where integration docs, SDKs, and Postman collection live.
---

## Location
All files in `artifacts/api-server/docs/`:

| File | Purpose |
|---|---|
| README.md | Index for integrators |
| integration-google-sheets.md | Apps Script + auto-trigger |
| integration-moysklad.md | Python sync + webhook adapter |
| integration-bitrix24.md | Webhook adapter + REST polling |
| integration-1c.md | BSL code for 1С 8.3+ |
| smartroute_client.py | Python SDK (full typed client) |
| smartroute-client.js | JS/ESM SDK (no dependencies) |
| SmartRoute.postman_collection.json | Postman collection with all endpoints |
| public-api-examples.md | curl examples |

## Why
Single location for all external developer-facing content. All guides follow same structure: overview → step 1 (get key) → implementation → troubleshooting table.

## How to apply
When adding a new endpoint to Public API v1, update:
1. public-api-examples.md (curl example)
2. SmartRoute.postman_collection.json (new request item)
3. smartroute_client.py + smartroute-client.js (new method)
