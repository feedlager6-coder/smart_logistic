#!/usr/bin/env python3
"""
SmartRoute Release Checklist
=============================
Автоматическая проверка перед каждым релизом. Покрывает:
  API, Frontend, импорт, экспорт, маршрутизация, аналитика,
  безопасность, документация, производительность, очистка данных.

Использование:
  python3 release_checklist.py [--host localhost] [--port 8080] [--admin-pass NewPassword2026]

Выход: 0 = готов к релизу, 1 = есть блокеры.
"""

import json
import sys
import time
import http.client
import argparse
from datetime import date

parser = argparse.ArgumentParser()
parser.add_argument("--host", default="localhost")
parser.add_argument("--port", type=int, default=8080)
parser.add_argument("--admin-pass", default="NewPassword2026")
args = parser.parse_args()

HOST, PORT, ADMIN_PASS = args.host, args.port, args.admin_pass

GREEN, RED, YELLOW, CYAN, RESET = "\033[92m", "\033[91m", "\033[93m", "\033[96m", "\033[0m"

checks = []

def check(category, label, cond, detail="", blocking=True):
    status = "PASS" if cond else ("FAIL" if blocking else "WARN")
    checks.append({"category": category, "label": label, "status": status, "detail": detail})
    icon = f"{GREEN}✅{RESET}" if cond else (f"{RED}❌{RESET}" if blocking else f"{YELLOW}⚠{RESET}")
    print(f"  {icon} [{category}] {label}{f' — {detail}' if detail and not cond else ''}")

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
    print(f"\n{CYAN}┌{'─'*53}┐{RESET}")
    print(f"{CYAN}│  {title:<51}│{RESET}")
    print(f"{CYAN}└{'─'*53}┘{RESET}")

# ── Auth ─────────────────────────────────────────────────────────────────────
conn_h = http.client.HTTPConnection(HOST, PORT)
conn_h.request("POST", "/api/auth/login",
    body=json.dumps({"username": "admin", "password": ADMIN_PASS}).encode(),
    headers={"Content-Type": "application/json"})
r = conn_h.getresponse(); r.read()
ck = r.getheader("Set-Cookie", "")
ac = ck.split(";")[0].split("=", 1)[1] if "smartroute_token=" in ck else ""
ACH = {"Cookie": f"smartroute_token={ac}"}

s, kd, _ = api("POST", "/api/auth/api-keys", ACH,
    {"name": "release_check", "scopes": [
        "stores:read", "stores:write", "orders:read", "orders:write",
        "routes:read", "routes:build", "routes:write",
        "analytics:read", "settings:read", "settings:write"
    ]})
KEY = kd.get("key", ""); KEY_ID = kd.get("id")
BH = {"Authorization": f"Bearer {KEY}"}

created_ids = {"stores": [], "routes": []}

print(f"\n{YELLOW}SmartRoute Release Checklist — {date.today()}{RESET}")
print(f"{YELLOW}{'═'*55}{RESET}")

# ═══════════════════════════════════════════════════════
section("1. API — Core")
# ═══════════════════════════════════════════════════════

s, b, _ = api("GET", "/api/healthz")
check("API", "Health check /api/healthz → 200", s == 200, f"got {s}")

s, b, _ = api("GET", "/api/v1/stores", BH)
check("API", "GET /api/v1/stores → 200 + envelope", s == 200 and "data" in b, f"got {s}")
check("API", "Response has request_id", "request_id" in b)
check("API", "Pagination meta present", b.get("meta", {}).get("page") is not None)

s, b, _ = api("GET", "/api/v1/settings", BH)
check("API", "GET /api/v1/settings → 200", s == 200, f"got {s}")

s, b, _ = api("GET", "/api/v1/analytics/summary", BH)
check("API", "GET /api/v1/analytics/summary → 200", s == 200, f"got {s}")

# ═══════════════════════════════════════════════════════
section("2. Безопасность")
# ═══════════════════════════════════════════════════════

s, b, _ = api("GET", "/api/v1/stores")
check("Security", "No auth → 401 v1 envelope", s == 401 and b.get("error", {}).get("code") == "UNAUTHORIZED")

s, b, _ = api("GET", "/api/v1/stores", {"Authorization": "Bearer INVALID_9999"})
check("Security", "Bad Bearer → 401", s == 401)

s, b, _ = api("GET", "/api/admin/users", BH)
check("Security", "Admin endpoint via Bearer → 403", s == 403)

# Scope enforcement: create key with stores:read only
s, limited_kd, _ = api("POST", "/api/auth/api-keys", ACH,
    {"name": "rc_limited", "scopes": ["stores:read"]})
lkey = limited_kd.get("key", ""); lkid = limited_kd.get("id")
if lkey:
    s, _, _ = api("POST", "/api/v1/stores", {"Authorization": f"Bearer {lkey}"},
                  {"name": "X", "city": "Y", "address": "Z", "lat": 55.0, "lon": 37.0})
    check("Security", "stores:read key → stores:write blocked (403)", s == 403, f"got {s}")
    api("DELETE", f"/api/auth/api-keys/{lkid}", ACH)

s, b, _ = api("GET", "/api/admin/users", ACH)
check("Security", "Admin via cookie → 200", s == 200, f"got {s}")

# ═══════════════════════════════════════════════════════
section("3. CRUD магазинов + импорт/экспорт")
# ═══════════════════════════════════════════════════════

s, b, _ = api("POST", "/api/v1/stores", BH,
    {"name": "RC_TestStore", "city": "Махачкала", "address": "пр. Гамидова 1",
     "lat": 42.985, "lon": 47.505})
check("Stores", "POST /api/v1/stores → 201", s == 201, str(b.get("error", "")))
sid = b.get("data", {}).get("id")
if sid: created_ids["stores"].append(sid)

if sid:
    s, b, _ = api("GET", f"/api/v1/stores/{sid}", BH)
    check("Stores", "GET /api/v1/stores/{id} → 200", s == 200)

    s, b, _ = api("PUT", f"/api/v1/stores/{sid}", BH, {"phone": "+7-000-000-0000"})
    check("Stores", "PUT /api/v1/stores/{id} → 200", s == 200)
    check("Stores", "Updated phone reflected", b.get("data", {}).get("phone") == "+7-000-000-0000")

# Batch create
s, b, _ = api("POST", "/api/v1/stores/batch", BH, {"stores": [
    {"name": f"RC_Batch_{i}", "city": "X", "address": f"A{i}", "lat": 42.0 + i*0.001, "lon": 47.0 + i*0.001}
    for i in range(5)
]})
check("Stores", "POST /api/v1/stores/batch (5) → 200", s == 200, str(b.get("error", "")))
check("Stores", "batch created=5", b.get("data", {}).get("created") == 5)
batch_ids = b.get("data", {}).get("ids", [])
created_ids["stores"].extend(batch_ids)

# Excel export (old API, backward compat)
s, b, _ = api("GET", "/api/stores/export", ACH)
check("Export", "GET /api/stores/export → 200 + base64", s == 200 and "data" in b and b.get("filename"), f"got {s}")
check("Export", "Filename is .xlsx", (b.get("filename", "")).endswith(".xlsx"))

# Excel template
s, b, _ = api("GET", "/api/stores/template", ACH)
check("Export", "GET /api/stores/template → 200", s == 200 and "data" in b)

# ═══════════════════════════════════════════════════════
section("4. Маршрутизация (VRP)")
# ═══════════════════════════════════════════════════════

route_store_ids = ([sid] if sid else []) + batch_ids[:3]
if len(route_store_ids) >= 2:
    t0 = time.time()
    s, b, _ = api("POST", "/api/v1/routes/build", BH, {
        "store_ids": route_store_ids,
        "vehicles": [{"name": "Авто 1"}],
        "depot_lat": 42.9849, "depot_lon": 47.5046,
        "use_unload_time": False,
    }, timeout=120)
    elapsed = time.time() - t0
    check("Routes", "POST /api/v1/routes/build → 200", s == 200, str(b.get("error", "")))
    check("Routes", f"Build time ≤ 30s ({elapsed:.1f}s)", elapsed <= 30, f"{elapsed:.1f}s", blocking=False)
    check("Routes", "data.session_id present", b.get("data", {}).get("session_id") is not None)
    check("Routes", "data.total_km > 0", (b.get("data", {}).get("total_km") or 0) > 0)
    rsid = b.get("data", {}).get("session_id")
    if rsid: created_ids["routes"].append(rsid)

    s, b, _ = api("GET", "/api/v1/routes", BH)
    check("Routes", "GET /api/v1/routes → 200 + list", s == 200 and isinstance(b.get("data"), list))

    if rsid:
        s, b, _ = api("GET", f"/api/v1/routes/{rsid}", BH)
        check("Routes", "GET /api/v1/routes/{id} → 200", s == 200)

        # Old API backward compat
        s, b, _ = api("GET", f"/api/route/sessions/{rsid}", ACH)
        check("Routes", "Old API GET /api/route/sessions/{id} still works", s == 200)
else:
    check("Routes", "Skipped (no stores with coords)", True, blocking=False)

# ═══════════════════════════════════════════════════════
section("5. Аналитика")
# ═══════════════════════════════════════════════════════

today = date.today().isoformat()
for path in ["summary", "daily", "monthly", "top-stores"]:
    s, b, _ = api("GET", f"/api/v1/analytics/{path}?date_from={today}&date_to={today}", BH)
    check("Analytics", f"GET /api/v1/analytics/{path} → 200", s == 200, str(b.get("error", "")))

# Old API backward compat
s, b, _ = api("GET", "/api/analytics/summary", ACH)
check("Analytics", "Old /api/analytics/summary (no envelope)", s == 200 and "data" not in b)

# ═══════════════════════════════════════════════════════
section("6. Производительность")
# ═══════════════════════════════════════════════════════

times = []
for _ in range(5):
    t0 = time.time()
    api("GET", "/api/v1/stores", BH)
    times.append(time.time() - t0)
avg_ms = sum(times) / len(times) * 1000
check("Perf", f"Avg GET /stores latency ≤ 200ms ({avg_ms:.0f}ms)", avg_ms <= 200, f"{avg_ms:.0f}ms", blocking=False)

# Batch 1000 create + delete
t0 = time.time()
stores_1k = [{"name": f"PerfT_{i}", "city": "X", "address": f"A{i}", "lat": 42.0+i*0.0001, "lon": 47.0+i*0.0001} for i in range(1000)]
s, b, _ = api("POST", "/api/v1/stores/batch", BH, {"stores": stores_1k})
t_batch = time.time() - t0
perf_ids = b.get("data", {}).get("ids", [])
check("Perf", f"Batch create 1000 stores ≤ 5s ({t_batch:.2f}s)", t_batch <= 5, f"{t_batch:.2f}s", blocking=False)

if perf_ids:
    t0 = time.time()
    s, bd, _ = api("POST", "/api/v1/stores/bulk-delete", BH, {"ids": perf_ids})
    t_del = time.time() - t0
    check("Perf", f"Bulk delete 1000 stores ≤ 2s ({t_del:.2f}s)", t_del <= 2, f"{t_del:.2f}s", blocking=False)
    check("Perf", f"All 1000 deleted", bd.get("data", {}).get("deleted") == 1000)

# ═══════════════════════════════════════════════════════
section("7. Документация")
# ═══════════════════════════════════════════════════════

s, b, _ = api("GET", "/api/v1/openapi.json")
check("Docs", "GET /api/v1/openapi.json → 200", s == 200, f"got {s}")
check("Docs", "openapi.json has paths", bool(b.get("paths")))
check("Docs", "v1-stores tag present", any("v1-stores" in str(v) for v in b.get("paths", {}).values()), blocking=False)

# ═══════════════════════════════════════════════════════
section("8. Bulk delete scale test")
# ═══════════════════════════════════════════════════════

for n in [100, 500]:
    b_stores = [{"name": f"RCBulk_{n}_{i}", "city": "X", "address": f"A{i}", "lat": 42.0+i*0.0001, "lon": 47.0+i*0.0001} for i in range(n)]
    s, br, _ = api("POST", "/api/v1/stores/batch", BH, {"stores": b_stores})
    b_ids = br.get("data", {}).get("ids", [])
    check("BulkDel", f"Created {n} stores for test", len(b_ids) == n, f"got {len(b_ids)}")
    if b_ids:
        s, bd, _ = api("POST", "/api/v1/stores/bulk-delete", BH, {"ids": b_ids})
        d = bd.get("data", {}).get("deleted", 0)
        check("BulkDel", f"Bulk delete {n} → all deleted", d == n, f"deleted={d}/{n}")

# ═══════════════════════════════════════════════════════
section("9. Очистка тестовых данных")
# ═══════════════════════════════════════════════════════

for rsid in created_ids["routes"]:
    s, _, _ = api("DELETE", f"/api/v1/routes/{rsid}", BH)
    check("Cleanup", f"DELETE route {rsid}", s == 200, f"status={s}")

if created_ids["stores"]:
    s, bd, _ = api("POST", "/api/v1/stores/bulk-delete", BH, {"ids": created_ids["stores"]})
    d = bd.get("data", {}).get("deleted", 0)
    check("Cleanup", f"Bulk delete {len(created_ids['stores'])} created stores",
          d == len(created_ids["stores"]), f"deleted={d}/{len(created_ids['stores'])}")

# API key cleanup: soft revoke → verify still listed → hard delete → verify gone
api("DELETE", f"/api/auth/api-keys/{KEY_ID}", ACH)  # soft revoke
s2, klist, _ = api("GET", "/api/auth/api-keys", ACH)
revoked_in_list = any(k.get("id") == KEY_ID and not k.get("is_active") for k in (klist if isinstance(klist, list) else []))
check("APIKeys", "Revoked key still in list (audit trail)", revoked_in_list, f"KEY_ID={KEY_ID}")
s3, _, _ = api("DELETE", f"/api/auth/api-keys/{KEY_ID}?permanent=true", ACH)
check("APIKeys", "Hard-delete revoked key (?permanent=true) → 200", s3 == 200, f"status={s3}")
s4, pr, _ = api("DELETE", "/api/auth/api-keys", ACH)
check("APIKeys", "Purge revoked endpoint → 200", s4 == 200, f"status={s4}, body={pr}")

# Final DB state check
s, stores_after, _ = api("GET", "/api/stores", ACH)
rc_remaining = [st for st in stores_after if "RC_" in st.get("name", "") or "RCBulk" in st.get("name", "") or "PerfT_" in st.get("name", "")]
check("Cleanup", "No RC_/RCBulk/PerfT_ stores remaining in DB",
      len(rc_remaining) == 0, f"remaining: {[s['name'] for s in rc_remaining[:3]]}")

# ═══════════════════════════════════════════════════════
# SUMMARY
# ═══════════════════════════════════════════════════════

print(f"\n{'═'*55}")
total = len(checks)
passed = sum(1 for c in checks if c["status"] == "PASS")
failed = sum(1 for c in checks if c["status"] == "FAIL")
warned = sum(1 for c in checks if c["status"] == "WARN")

print(f"\n{YELLOW}RELEASE CHECKLIST RESULTS{RESET}")
print(f"  {GREEN}✅ Passed:{RESET}  {passed}/{total}")
if warned:
    print(f"  {YELLOW}⚠ Warnings:{RESET} {warned} (non-blocking)")
if failed:
    print(f"  {RED}❌ Failed:{RESET}  {failed} (BLOCKING)")

by_cat = {}
for c in checks:
    by_cat.setdefault(c["category"], []).append(c)

print(f"\n{YELLOW}Category breakdown:{RESET}")
for cat, cat_checks in by_cat.items():
    cat_pass = sum(1 for c in cat_checks if c["status"] == "PASS")
    cat_fail = sum(1 for c in cat_checks if c["status"] == "FAIL")
    cat_warn = sum(1 for c in cat_checks if c["status"] == "WARN")
    icon = f"{GREEN}✅{RESET}" if cat_fail == 0 else f"{RED}❌{RESET}"
    extra = f" (+{cat_warn}w)" if cat_warn else ""
    print(f"  {icon} {cat:<12} {cat_pass}/{len(cat_checks)}{extra}")

if failed:
    print(f"\n{RED}BLOCKING failures:{RESET}")
    for c in checks:
        if c["status"] == "FAIL":
            print(f"  [{c['category']}] {c['label']}: {c['detail']}")
    print(f"\n{RED}❌ NOT READY FOR RELEASE — fix blocking issues first{RESET}")
else:
    print(f"\n{GREEN}✅ READY FOR RELEASE{RESET}")

sys.exit(0 if failed == 0 else 1)
