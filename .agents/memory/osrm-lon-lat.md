---
name: OSRM lon-lat coordinate order
description: OSRM Table API URL requires lon,lat order; Python code uses lat,lon tuples everywhere else — easy silent bug.
---

## Rule
When building the OSRM Table API URL from `(lat, lon)` tuples, ALWAYS swap to `lon,lat`:
```python
coord_str = ";".join(f"{lon},{lat}" for lat, lon in coords)
url = f"{OSRM_BASE_URL}/table/v1/driving/{coord_str}?annotations=duration,distance"
```

**Why:** OSRM follows GeoJSON/WGS84 convention (longitude first), while the rest of the codebase uses `(lat, lon)` tuples (Haversine, GH, OR-Tools). Swapping silently puts coordinates ~90° wrong.

**How to apply:** Every new OSRM API call in the codebase must do the lon,lat swap. grep for `OSRM_BASE_URL` to find all call sites.
