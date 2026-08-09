# Delivery Operations MVP

## What changed

- Added a per-company driver directory with name, phone, optional vehicle, and archive state.
- Route assignments can reference a directory driver and keep a phone snapshot.
- WhatsApp links are generated in the browser flow and contain route date, point count, mileage, Yandex Navigator URL, and the token-scoped execution URL. No WhatsApp API or server-side broadcast is used.
- Added browser geolocation for the driver page. The phone sends one low-accuracy position immediately and approximately every 20 seconds while the driver keeps tracking enabled.
- Only the latest location per assignment is kept in PostgreSQL.
- Dispatcher assignments expose the latest location, next planned point, progress, and a local ETA estimate.
- Added an `.xlsx` route report endpoint using the existing `openpyxl` dependency.

## Database additions

`init_db()` applies additive PostgreSQL changes on startup:

- `drivers`: `owner_id`, `name`, `phone`, `vehicle_name`, `is_active`, timestamps.
- `route_assignments.driver_id` and `route_assignments.driver_phone`.
- `driver_locations`: one upserted row per assignment with latitude, longitude, accuracy, and capture time.

## API additions

- `GET /api/drivers`
- `POST /api/drivers`
- `PATCH /api/drivers/{driver_id}`
- `DELETE /api/drivers/{driver_id}` (archive)
- `POST /api/driver/{token}/location`
- `GET /api/route/sessions/{session_id}/report.xlsx`

The existing assignment and driver execution endpoints remain compatible.

## Manual smoke test

1. Open Settings → Drivers and add a driver using an international phone format, for example `+7 900 000-00-00`.
2. Build a route, open Execution, select the directory driver, and issue the assignment.
3. Confirm the individual WhatsApp button opens a prefilled message. The bulk button may be subject to browser popup protection.
4. Open the driver URL on an HTTPS phone browser, allow location, and confirm the dispatcher sees a timestamp, coordinates, next point, and ETA after the next polling cycle.
5. Mark a delivery as delivered/partial, then download `Отчёт Excel`; verify plan, delivered, remainder, payment, comment, and mileage columns.

## Performance notes

- Dispatcher assignment polling is 5 seconds; driver page polling is 15 seconds; location writes are approximately 20 seconds and rate-limited to 6/minute per token.
- Assignment list uses one aggregate query plus one execution query; latest location is loaded with a lateral lookup and indexed by assignment.
- ETA does not call an external service during polling. It uses Haversine distance, a conservative road factor, and 30 km/h. This avoids paid Matrix APIs and public OSRM rate-limit risk.
- Route construction keeps its existing GraphHopper → OSRM → Haversine chain.
- Full frontend typecheck/build must be run in CI/Railway or an environment with npm registry access; this workspace timed out while downloading the existing 486-package pnpm lockfile.

## Browser limitations

Geolocation requires HTTPS (localhost is an exception), explicit user permission, and an active page. Mobile browsers may suspend timers in the background, so this MVP is not a guaranteed background tracker and should not be presented as one.
