---
name: Excel download via base64 JSON
description: How to correctly download Excel files through Replit proxy
---
**Rule:** Never return xlsx files as `StreamingResponse` or binary `Response` — return `{"data": "<base64>", "filename": "<name>"}`.

**Why:** Replit proxy strips `Content-Disposition` headers from streaming responses, making direct binary downloads fail silently. Frontend decodes with `atob()` → `Uint8Array` → `Blob` → `<a download>`.

**How to apply:** Any file download in SmartRoute must use this base64 JSON pattern.
