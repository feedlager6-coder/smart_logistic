---
name: Depot geocoding via backend endpoint
description: Why geocoding must go through /api/geocode, not directly to Nominatim/Yandex
---
**Rule:** The frontend must never call external geocoding APIs (Nominatim, Yandex Geocoder) directly. Always use `/api/geocode?address=...` or `/api/geocode?yandex_url=...`.

**Why:** CORS blocks browser-to-Nominatim requests in production. Yandex Geocoder requires an API key that only exists server-side. The backend has in-memory caching for geocode results.

**How to apply:** Any feature requiring geocoding from the frontend (stores, depot, etc.) must route through the FastAPI backend.
