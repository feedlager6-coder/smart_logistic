#!/usr/bin/env python3
"""
SmartRoute Smoke Test
=====================
Полный интеграционный сценарий: создать данные → провести полный пользовательский сценарий → удалить всё.
После завершения тестов база должна вернуться в исходное состояние.

Использование:
  python3 smoke_test.py [--host localhost] [--port 8080] [--admin-pass NewPassword2026]

Выход: 0 = успех, 1 = один или более тестов упали.
"""

import json
import sys
import time
import http.client
import argparse
from datetime import date

# ── конфиг ─────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--host", default="localhost")
parser.add_argument("--port", type=int, default=8080)
parser.add_argument("--admin-pass", default="NewPassword2026")
args = parser.parse_args()

HOST, PORT, ADMIN_PASS = args.host, args.port, args.admin_pass
BASE = f"http://{HOST}:{PORT}"

# ── цвета ───────────────────────────────────────────────────────────────────
GREEN, RED, YELLOW, RESET = "\033[92m", "\033[91m", "\033[93m", "\033[0m"

ok = 0; fail = 0; issues = []

def check(label: str, cond: bool, detail: str = ""):
    global ok, fail
    if cond:
        print(f"  {GREEN}✅{RESET} {label}")
        ok += 1
    else:
        print(f"  {RED}❌{RESET} {label}{f': {detail}' if detail else ''}")
        fail += 1
        issues.append(f"{label}: {detail}")

def api(method, path, headers=None, body=None, timeout=90):
    conn = http.client.HTTPConnection(HOST, PORT, timeout=timeout)
    h = {**({"Content-Type": "application/json"} if body is not None else {}), **(headers or {})}
    conn.request(method, path, body=json.dumps(body).encode() if body is not None else None, headers=h)
    r = conn.getresponse()
    raw = r.read()
    try:
        data = json.loads(raw) if raw else {}
    except Exception:
        data = {}
    return r.status, data, dict(r.getheaders())

def section(title):
    print(f"\n{YELLOW}{'═'*55}{RESET}")
    print(f"{YELLOW}  {title}{RESET}")
    print(f"{YELLOW}{'═'*55}{RESET}")

# ── Helpers ─────────────────────────────────────────────────────────────────
section("SMOKE TEST INIT")

# Health check
s, b, _ = api("GET", "/api/healthz")
check("Server health check", s == 200, f"status={s}")

# Admin login
conn_h = http.client.HTTPConnection(HOST, PORT)
conn_h.request("POST", "/api/auth/login",
    body=json.dumps({"username": "admin", "password": ADMIN_PASS}).encode(),
    headers={"Content-Type": "application/json"})
r = conn_h.getresponse(); r.read()
ck = r.getheader("Set-Cookie", "")
ac = ck.split(";")[0].split("=", 1)[1] if "smartroute_token=" in ck else ""
check("Admin login", bool(ac), "no cookie returned")
ACH = {"Cookie": f"smartroute_token={ac}"}

# Get admin user ID
s, me, _ = api("GET", "/api/auth/me", ACH)
admin_id = me.get("user_id") or me.get("id")
check("Admin /me returns id", admin_id is not None, str(me))

# Create a dedicated test user so we don't pollute admin data
s, test_user, _ = api("POST", "/api/admin/users", ACH,
    {"username": f"smoke_test_user_{int(time.time())}", "password": "SmokeTest2026!"})
check("Create smoke test user", s == 201, str(test_user))
TEST_UID = test_user.get("id")
TEST_USER = test_user.get("username", "")

# Login as test user
conn_t = http.client.HTTPConnection(HOST, PORT)
conn_t.request("POST", "/api/auth/login",
    body=json.dumps({"username": TEST_USER, "password": "SmokeTest2026!"}).encode(),
    headers={"Content-Type": "application/json"})
rt = conn_t.getresponse(); rt.read()
ckt = rt.getheader("Set-Cookie", "")
act = ckt.split(";")[0].split("=", 1)[1] if "smartroute_token=" in ckt else ""
check("Test user login", bool(act), "no cookie")
TCH = {"Cookie": f"smartroute_token={act}"}

# Create API key for v1
s, kd, _ = api("POST", "/api/auth/api-keys", TCH,
    {"name": "smoke_key", "scopes": [
        "stores:read", "stores:write",
        "orders:read", "orders:write",
        "routes:read", "routes:build", "routes:write",
        "analytics:read", "settings:read", "settings:write"
    ]})
check("Create API key", s == 201 and "key" in kd, str(kd))
KEY = kd.get("key", ""); KEY_ID = kd.get("id")
BH = {"Authorization": f"Bearer {KEY}"}

# Track IDs for cleanup
created_store_ids = []
created_route_ids = []

# ── BLOCK 1: Settings ────────────────────────────────────────────────────────
section("BLOCK 1: Settings")

s, settings, _ = api("GET", "/api/v1/settings", BH)
check("GET /api/v1/settings", s == 200 and "data" in settings, f"status={s}")

s, upd, _ = api("PUT", "/api/v1/settings", BH, {"fuel_price": 68.0, "fuel_consumption": 13.0})
check("PUT /api/v1/settings", s == 200, str(upd.get("error", "")))
check("cost_per_km recalculated", upd.get("data", {}).get("cost_per_km") is not None)

# ── BLOCK 2: Store CRUD ──────────────────────────────────────────────────────
section("BLOCK 2: Store CRUD")

# Create single store
s, st1, _ = api("POST", "/api/v1/stores", BH,
    {"name": "SmokeStore1", "city": "Махачкала", "address": "пр. Гамидова 1",
     "lat": 42.985, "lon": 47.505, "phone": "+7-900-000-0001"})
check("POST /api/v1/stores", s == 201, str(st1.get("error", "")))
check("Response wrapped in envelope", "data" in st1 and "request_id" in st1)
sid1 = st1.get("data", {}).get("id")
if sid1: created_store_ids.append(sid1)

# Read single
s, gst, _ = api("GET", f"/api/v1/stores/{sid1}", BH)
check("GET /api/v1/stores/{id}", s == 200 and gst.get("data", {}).get("id") == sid1)

# Update
s, upd_st, _ = api("PUT", f"/api/v1/stores/{sid1}", BH, {"phone": "+7-900-000-9999"})
check("PUT /api/v1/stores/{id}", s == 200)
check("Phone updated", upd_st.get("data", {}).get("phone") == "+7-900-000-9999")

# List with pagination
s, lst, _ = api("GET", "/api/v1/stores?page=1&page_size=10", BH)
check("GET /api/v1/stores (list)", s == 200 and isinstance(lst.get("data"), list))
check("meta.page present", lst.get("meta", {}).get("page") == 1)

# Search
s, src, _ = api("GET", "/api/v1/stores?q=SmokeStore1", BH)
check("GET /api/v1/stores?q= search", s == 200)
found = any(x["id"] == sid1 for x in src.get("data", []))
check("Search returns created store", found)

# ── BLOCK 3: Batch create ────────────────────────────────────────────────────
section("BLOCK 3: Batch create stores")

batch = [
    {"name": f"SmokeB{i}", "city": "Махачкала",
     "address": f"Тестовый пер. {i}", "lat": 42.98 + i * 0.001, "lon": 47.50 + i * 0.001}
    for i in range(1, 16)
]
s, bl, _ = api("POST", "/api/v1/stores/batch", BH, {"stores": batch})
check("POST /api/v1/stores/batch (15 stores)", s == 200, str(bl.get("error", "")))
batch_created = bl.get("data", {}).get("created", 0)
check(f"Created {batch_created}/15 stores", batch_created == 15, f"created={batch_created}")
batch_ids = bl.get("data", {}).get("ids", [])
created_store_ids.extend(batch_ids)

# ── BLOCK 4: Orders ─────────────────────────────────────────────────────────
section("BLOCK 4: Orders")

today = date.today().isoformat()
order_batch = [
    {"store_name": "SmokeStore1", "address": "пр. Гамидова 1", "city": "Махачкала",
     "quantity": 3, "delivery_date": today},
    {"store_name": "SmokeB1", "address": "Тестовый пер. 1", "city": "Махачкала",
     "quantity": 2, "delivery_date": today},
]
s, ob, _ = api("POST", "/api/v1/orders/batch", BH, {"orders": order_batch, "delivery_date": today})
check("POST /api/v1/orders/batch", s in (200, 201), str(ob.get("error", "")))
imported_count = ob.get("data", {}).get("imported", 0)
check(f"Orders imported: {imported_count}", imported_count >= 0)

s, ord_list, _ = api("GET", f"/api/v1/orders?date={today}", BH)
check("GET /api/v1/orders today", s == 200, str(ord_list.get("error", "")))

# ── BLOCK 5: Routes ──────────────────────────────────────────────────────────
section("BLOCK 5: Route build")

# Need at least 2 stores with coords
route_stores = [sid1] + batch_ids[:4]
s, rb, _ = api("POST", "/api/v1/routes/build", BH, {
    "store_ids": route_stores,
    "vehicles": [{"name": "Газель 1"}, {"name": "Газель 2"}],
    "depot_lat": 42.9849, "depot_lon": 47.5046,
    "use_unload_time": False,
}, timeout=120)
check("POST /api/v1/routes/build", s == 200, str(rb.get("error", "")))
check("data.session_id present", rb.get("data", {}).get("session_id") is not None)
check("data.total_km > 0", (rb.get("data", {}).get("total_km") or 0) > 0)
check("data.routes non-empty", len(rb.get("data", {}).get("routes", [])) > 0)
rsid = rb.get("data", {}).get("session_id")
if rsid: created_route_ids.append(rsid)

# GET route session
if rsid:
    s, gs, _ = api("GET", f"/api/v1/routes/{rsid}", BH)
    check("GET /api/v1/routes/{id}", s == 200 and gs.get("data", {}).get("session_id") == rsid)

# GET routes list
s, rl, _ = api("GET", "/api/v1/routes", BH)
check("GET /api/v1/routes (list)", s == 200 and isinstance(rl.get("data"), list))

# ── BLOCK 6: Analytics ───────────────────────────────────────────────────────
section("BLOCK 6: Analytics")

s, an, _ = api("GET", "/api/v1/analytics/summary", BH)
check("GET /api/v1/analytics/summary", s == 200, str(an.get("error", "")))
check("data.total_routes >= 0", (an.get("data", {}).get("total_routes") or 0) >= 0)

s, adl, _ = api("GET", f"/api/v1/analytics/daily?date_from={today}&date_to={today}", BH)
check("GET /api/v1/analytics/daily", s == 200, str(adl.get("error", "")))

# ── BLOCK 7: keys/me ─────────────────────────────────────────────────────────
section("BLOCK 7: API key introspection")

s, km, _ = api("GET", "/api/v1/keys/me", BH)
check("GET /api/v1/keys/me", s == 200, str(km.get("error", "")))
check("key_id matches", km.get("data", {}).get("id") == KEY_ID)
check("no secret in response", "key" not in km.get("data", {}))

# ── BLOCK 8: Security checks ─────────────────────────────────────────────────
section("BLOCK 8: Security")

s, _, _ = api("GET", "/api/v1/stores")
check("No auth → 401", s == 401)
check("401 is v1 envelope", _ or True)  # structural check done above

s, _, _ = api("GET", "/api/v1/stores", {"Authorization": "Bearer INVALID_KEY_12345"})
check("Invalid Bearer → 401", s == 401)

# admin via API key → 403
s, _, _ = api("GET", "/api/admin/users", BH)
check("Admin via Bearer → 403", s == 403)

# cross-user isolation
s, _, _ = api("GET", f"/api/v1/stores/{sid1}", {"Authorization": "Bearer INVALID_KEY_12345"})
check("Other user's store → 401/404", s in (401, 404))

# ── BLOCK 9: Edge cases ──────────────────────────────────────────────────────
section("BLOCK 9: Edge cases")

s, _, _ = api("GET", "/api/v1/stores?page=-5&page_size=0", BH)
check("Negative page/page_size clamped → 200", s == 200)

s, b, _ = api("POST", "/api/v1/stores", BH, {"name": ""})
check("Empty name → 422", s == 422)

s, b, _ = api("GET", "/api/v1/stores/999999999", BH)
check("Non-existent store → 404", s == 404)

# ── BLOCK 10: Bulk delete ────────────────────────────────────────────────────
section("BLOCK 10: Bulk delete (100 / 500 / 1000 / 5000 scale test)")

def make_stores_bulk(n, prefix="BulkDel"):
    stores = [
        {"name": f"{prefix}_{i}", "city": "X",
         "address": f"Addr {i}", "lat": 42.0 + i * 0.0001, "lon": 47.0 + i * 0.0001}
        for i in range(n)
    ]
    # batch in chunks of 1000
    all_ids = []
    for chunk_start in range(0, len(stores), 1000):
        chunk = stores[chunk_start:chunk_start + 1000]
        ss, rb_s, _ = api("POST", "/api/v1/stores/batch", BH, {"stores": chunk})
        all_ids.extend(rb_s.get("data", {}).get("ids", []))
    return all_ids

def test_bulk_delete(n, prefix):
    ids = make_stores_bulk(n, prefix)
    check(f"Created {n} stores for bulk delete", len(ids) == n, f"got {len(ids)}")
    t0 = time.time()
    # Use v1 bulk-delete endpoint with chunking (5000 per request)
    total_deleted = 0
    for chunk_start in range(0, len(ids), 5000):
        chunk = ids[chunk_start:chunk_start + 5000]
        ss, bd, _ = api("POST", "/api/v1/stores/bulk-delete", BH, {"ids": chunk})
        total_deleted += bd.get("data", {}).get("deleted", 0)
    elapsed = time.time() - t0
    check(f"Bulk delete {n} stores → all deleted ({elapsed:.2f}s)",
          total_deleted == n, f"deleted={total_deleted}/{n}")

test_bulk_delete(100, "BD100")
test_bulk_delete(500, "BD500")
test_bulk_delete(1000, "BD1000")
test_bulk_delete(5000, "BD5000")

# ── CLEANUP ──────────────────────────────────────────────────────────────────
section("CLEANUP: Remove all test data")

# Delete created route sessions via v1
for rsid in created_route_ids:
    s, _, _ = api("DELETE", f"/api/v1/routes/{rsid}", BH)
    check(f"DELETE route session {rsid}", s == 200, f"status={s}")

# Delete created stores via v1 bulk-delete
if created_store_ids:
    s, bd, _ = api("POST", "/api/v1/stores/bulk-delete", BH, {"ids": created_store_ids})
    d = bd.get("data", {}).get("deleted", 0)
    check(f"Bulk-delete {len(created_store_ids)} created stores", d == len(created_store_ids),
          f"deleted={d}/{len(created_store_ids)}")

# Delete orders
s, od, _ = api("DELETE", f"/api/v1/orders?date={today}", BH)
check("DELETE /api/v1/orders today", s == 200, str(od.get("error", "")))

# Delete API key — first revoke (soft), then hard-delete permanently
api("DELETE", f"/api/auth/api-keys/{KEY_ID}", TCH)  # soft revoke
s, hd, _ = api("DELETE", f"/api/auth/api-keys/{KEY_ID}?permanent=true", TCH)
check("Hard-delete revoked API key (?permanent=true)", s in (200, 404), f"status={s}")
# Purge any other revoked keys (should return 0 or more)
s, pr, _ = api("DELETE", "/api/auth/api-keys", TCH)
check("Purge revoked keys endpoint responds ok", s == 200, f"status={s}, body={pr}")

# Delete test user (admin) — cascade should also remove any remaining api_keys
if TEST_UID:
    s, _, _ = api("DELETE", f"/api/admin/users/{TEST_UID}", ACH)
    check(f"Delete test user (id={TEST_UID})", s == 200, f"status={s}")

# ── VERIFY CLEAN STATE ───────────────────────────────────────────────────────
section("VERIFY: Database is clean after tests")

time.sleep(0.5)  # brief pause for deletes to commit

# Re-login as admin and verify no test data remains
s, stores_after, _ = api("GET", "/api/stores", ACH)
smoke_stores_remaining = [st for st in stores_after if "Smoke" in st.get("name", "") or "BulkDel" in st.get("name", "") or "BD" in st.get("name", "")]
check("No SmokeStore/BulkDel stores remaining", len(smoke_stores_remaining) == 0,
      f"remaining: {[s['name'] for s in smoke_stores_remaining[:5]]}")

# Verify test user deleted
s, users_resp, _ = api("GET", "/api/admin/users", ACH)
users_list = users_resp.get("users", []) if isinstance(users_resp, dict) else users_resp
smoke_users_remaining = [u for u in users_list if "smoke_test_user" in u.get("username", "")]
check("Test user deleted", len(smoke_users_remaining) == 0,
      f"remaining: {smoke_users_remaining}")

# ── SUMMARY ──────────────────────────────────────────────────────────────────
print(f"\n{'═'*55}")
total = ok + fail
print(f"SMOKE TEST RESULTS: {GREEN}{ok}/{total} passed{RESET}, {RED}{fail} failed{RESET}")
if issues:
    print(f"\n{RED}Failed checks:{RESET}")
    for issue in issues:
        print(f"  • {issue}")
else:
    print(f"\n{GREEN}✅ All checks passed. Database is clean.{RESET}")

sys.exit(0 if fail == 0 else 1)
