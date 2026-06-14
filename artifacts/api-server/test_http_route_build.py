"""
HTTP-тест: POST /api/route/build с optimize_by="time" vs "distance"
Вызывает реальный работающий API сервер на порту 8080.

Запуск: cd artifacts/api-server && python3 test_http_route_build.py
"""
import json, time, urllib.request, urllib.error, sys

BASE = "http://localhost:8080"

def get_stores():
    """Получить первые N магазинов с координатами из реальной БД."""
    with urllib.request.urlopen(f"{BASE}/api/stores") as r:
        stores = json.loads(r.read())
    valid = [s for s in stores if s.get("lat") and s.get("lon")]
    print(f"Found {len(stores)} stores, {len(valid)} with coordinates")
    return valid

def call_build(store_ids, num_vehicles, optimize_by, use_tw=True, label=""):
    payload = json.dumps({
        "store_ids": store_ids,
        "vehicles": [{"name": f"Машина {i+1}"} for i in range(num_vehicles)],
        "depot_lat": 42.9849,
        "depot_lon": 47.5046,
        "use_time_windows": use_tw,
        "use_unload_time": False,
        "optimize_by": optimize_by,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{BASE}/api/route/build",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    t0 = time.time()
    print(f"\n{'='*60}")
    print(f"{label or f'{len(store_ids)}×{num_vehicles} {optimize_by}'}")
    print(f"  stores={len(store_ids)}  vehicles={num_vehicles}  mode={optimize_by}  tw={use_tw}")

    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            elapsed = time.time() - t0
            data = json.loads(resp.read())
            routes = data.get("routes", [])
            total_km = data.get("total_km", 0)
            src = data.get("matrix_source", "?")
            warnings = data.get("warnings", [])
            print(f"  ✅ HTTP 200  elapsed={elapsed:.1f}s  routes={len(routes)}  "
                  f"total_km={total_km}  src={src}")
            if warnings:
                for w in warnings:
                    print(f"  ⚠️  {w}")
            sizes = sorted([len(r.get("stores",[])) for r in routes], reverse=True)
            print(f"  route_sizes={sizes}")
            return True, elapsed, total_km

    except urllib.error.HTTPError as e:
        elapsed = time.time() - t0
        body = e.read(4096).decode("utf-8", errors="replace")
        print(f"  ❌ HTTP {e.code} after {elapsed:.1f}s")
        print(f"  body: {body[:500]}")
        return False, elapsed, None
    except Exception as exc:
        elapsed = time.time() - t0
        print(f"  ❌ ERROR after {elapsed:.1f}s: {exc}")
        return False, elapsed, None


print("=" * 60)
print("Fetching real stores from DB...")
stores = get_stores()

if len(stores) < 10:
    print("Not enough stores with coordinates. Loading from scratch.")
    sys.exit(1)

results = []

# Use different subsets
ids_20  = [s["id"] for s in stores[:20]]
ids_50  = [s["id"] for s in stores[:50]] if len(stores) >= 50 else [s["id"] for s in stores]
ids_120 = [s["id"] for s in stores[:120]] if len(stores) >= 120 else [s["id"] for s in stores]
ids_all = [s["id"] for s in stores]

print(f"\nStore subsets: 20={len(ids_20)}, 50={len(ids_50)}, "
      f"120={len(ids_120)}, all={len(ids_all)}")

# ─── Test 1: 20 stores / 5 vehicles ──────────────────────────────────────────
for mode in ("distance", "time"):
    ok, t, km = call_build(ids_20, 5, mode, use_tw=True, label=f"T1 20×5 {mode}")
    results.append((f"20×5 {mode}", ok, t, km))

# ─── Test 2: 50 stores / 5 vehicles ──────────────────────────────────────────
if len(ids_50) >= 30:
    for mode in ("distance", "time"):
        ok, t, km = call_build(ids_50, 5, mode, use_tw=True, label=f"T2 50×5 {mode}")
        results.append((f"50×5 {mode}", ok, t, km))

# ─── Test 3: 120 stores / 9 vehicles (the failing scenario) ──────────────────
if len(ids_120) >= 80:
    for mode in ("distance", "time"):
        ok, t, km = call_build(ids_120, 9, mode, use_tw=True, label=f"T3 120×9 {mode}")
        results.append((f"120×9 {mode}", ok, t, km))

# ─── Test 4: all stores / 9 vehicles ─────────────────────────────────────────
if len(ids_all) > len(ids_120):
    ok, t, km = call_build(ids_all, 9, "time", use_tw=True, label=f"T4 all({len(ids_all)})×9 time")
    results.append((f"all({len(ids_all)})×9 time", ok, t, km))

# ─── Summary ──────────────────────────────────────────────────────────────────
print("\n" + "="*60)
print("SUMMARY")
print("="*60)
print(f"{'Test':<22} {'OK':<5} {'Time':>8} {'km':>8}")
print("-"*47)
for name, ok, t, km in results:
    km_s = f"{km}" if km is not None else "N/A"
    print(f"{name:<22} {'✅' if ok else '❌':<5} {t:>7.1f}s {km_s:>8}")
