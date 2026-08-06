#!/usr/bin/env python3
"""
Integration tests: plan_qty parsing, partial delivery, remaining/rescheduled-order
against the live API.

Test user setup and teardown happen directly through psycopg2 (no admin account
needed) so these tests run on any fresh environment.

Usage:
  cd artifacts/api-server
  python3 tests/test_qty_integration.py [--host localhost] [--port 8080]

Exit: 0 = all pass, 1 = one or more failures.
"""

import argparse
import http.client
import json
import os
import sys
import time
from datetime import date, timedelta

import psycopg2
import psycopg2.extras

# ── CLI ───────────────────────────────────────────────────────────────────────
parser = argparse.ArgumentParser()
parser.add_argument("--host", default="localhost")
parser.add_argument("--port", type=int, default=8080)
args = parser.parse_args()

HOST, PORT = args.host, args.port

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN, RED, YELLOW, RESET = "\033[92m", "\033[91m", "\033[93m", "\033[0m"

ok = 0
fail = 0
issues: list[str] = []


def check(label: str, cond: bool, detail: str = "") -> bool:
    global ok, fail
    if cond:
        print(f"  {GREEN}✅{RESET} {label}")
        ok += 1
    else:
        print(f"  {RED}❌{RESET} {label}{f': {detail}' if detail else ''}")
        fail += 1
        issues.append(f"{label}: {detail}")
    return cond


def section(title: str) -> None:
    print(f"\n{YELLOW}{'═' * 60}{RESET}")
    print(f"{YELLOW}  {title}{RESET}")
    print(f"{YELLOW}{'═' * 60}{RESET}")


# ── DB connection ─────────────────────────────────────────────────────────────

def get_db():
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url:
        db_url = "postgresql://{u}:{pw}@{h}:{p}/{db}".format(
            u=os.environ.get("PGUSER", "postgres"),
            pw=os.environ.get("PGPASSWORD", "password"),
            h=os.environ.get("PGHOST", "helium"),
            p=os.environ.get("PGPORT", "5432"),
            db=os.environ.get("PGDATABASE", "heliumdb"),
        )
    return psycopg2.connect(db_url)


# ── HTTP helper ───────────────────────────────────────────────────────────────

def api(method: str, path: str, *, cookie: str = "", body=None, timeout: int = 30):
    conn = http.client.HTTPConnection(HOST, PORT, timeout=timeout)
    headers: dict = {}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if cookie:
        headers["Cookie"] = cookie
    payload = json.dumps(body).encode() if body is not None else None
    conn.request(method, path, body=payload, headers=headers)
    r = conn.getresponse()
    raw = r.read()
    try:
        data = json.loads(raw) if raw else {}
    except Exception:
        data = {}
    return r.status, data, dict(r.getheaders())


def extract_cookie(headers: dict) -> str:
    for k, v in headers.items():
        if k.lower() == "set-cookie" and "smartroute_token=" in v:
            part = [p for p in v.split(";") if "smartroute_token=" in p][0]
            return "smartroute_token=" + part.split("smartroute_token=", 1)[1]
    return ""


# ─────────────────────────────────────────────────────────────────────────────
section("0. Sanity check")
# ─────────────────────────────────────────────────────────────────────────────

s, _, _ = api("GET", "/api/healthz")
if not check("API server reachable", s == 200, f"status={s}"):
    sys.exit(1)

# ─────────────────────────────────────────────────────────────────────────────
section("1. Create isolated test user via psycopg2")
# ─────────────────────────────────────────────────────────────────────────────

TEST_USER = f"tst_qty_{int(time.time())}"
TEST_PASS = "TestQty1234"

import bcrypt as _bcrypt_lib  # same lib as main.py uses

hashed = _bcrypt_lib.hashpw(TEST_PASS.encode(), _bcrypt_lib.gensalt()).decode()

db = get_db()
cur = db.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
cur.execute(
    """INSERT INTO users (username, password_hash, is_admin, is_active, plan, admin_note)
       VALUES (%s, %s, false, true, 'trial', 'qty integration test')
       RETURNING id""",
    (TEST_USER, hashed),
)
test_user_id: int = cur.fetchone()["id"]
db.commit()
check("Test user created in DB", test_user_id > 0)

# Login via HTTP to get JWT cookie
s, _, h = api("POST", "/api/auth/login", body={"username": TEST_USER, "password": TEST_PASS})
user_cookie = extract_cookie(h)
check("Test user HTTP login", bool(user_cookie) and s == 200, f"status={s}")

if not user_cookie:
    print(f"{RED}Cannot continue without a session cookie.{RESET}")
    # cleanup
    cur.execute("DELETE FROM users WHERE id=%s", (test_user_id,))
    db.commit()
    sys.exit(1)


# ── DB helper: create a minimal route session ─────────────────────────────────

def create_session(stores: list[dict]) -> int:
    """Insert a bare-bones route_session row with one route and given stops."""
    result = {
        "routes": [{
            "vehicle_name": "TestVehicle",
            "yandex_url": "",
            "stores": stores,
            "estimated_minutes": 10,
            "total_km": 1.0,
        }],
        "delivery_date": str(date.today()),
        "savings": {"saved_km": 0, "saved_rub_day": 0, "cost_per_km": 0},
        "total_km": 1.0,
        "matrix_source": "haversine",
        "geocoder_used": "nominatim",
        "session_id": 0,
        "warnings": [],
        "use_unload_time": False,
        "optimize_by": "distance",
    }
    cur.execute(
        """INSERT INTO route_sessions
               (date, num_vehicles, total_km, saved_km, saved_rub, num_points,
                cost_per_km, result_json, owner_id)
           VALUES (%s,1,1.0,0,0,%s,0,%s,%s) RETURNING id""",
        (str(date.today()), len(stores), json.dumps(result), test_user_id),
    )
    sid = cur.fetchone()["id"]
    result["session_id"] = sid
    cur.execute("UPDATE route_sessions SET result_json=%s WHERE id=%s",
                (json.dumps(result), sid))
    db.commit()
    return sid


def make_stop(name: str, products: str, stored_qty: float = 0, order: int = 1) -> dict:
    return {
        "store_id": None, "store_name": name,
        "address": f"ул. Тест, {order}",
        "lat": 42.98, "lon": 47.50,
        "order": order, "products": products,
        "quantity": stored_qty,
        "arrive_by": "", "yandex_url": "",
    }


def create_assignment(session_id: int) -> tuple[int, str]:
    """Create assignment via HTTP; return (assignment_id, driver_token)."""
    s, body, _ = api(
        "POST", f"/api/route/sessions/{session_id}/assignments",
        cookie=user_cookie,
        body={"route_index": 0, "driver_name": "IntTestDriver", "vehicle_name": "TestVehicle"},
    )
    assert s == 201, f"create_assignment returned {s}: {body}"
    driver_url = body.get("driver_url", "")
    token = driver_url.split("/driver/")[-1] if "/driver/" in driver_url else ""
    return body["id"], token


def get_executions(driver_token: str) -> list[dict]:
    s, body, _ = api("GET", f"/api/driver/{driver_token}")
    assert s == 200, f"GET driver returned {s}"
    return body.get("executions", [])


def patch_execution(driver_token: str, exec_id: int, **kwargs) -> tuple[int, dict]:
    return api("PATCH", f"/api/driver/{driver_token}/executions/{exec_id}",
               body=kwargs)


# ─────────────────────────────────────────────────────────────────────────────
section("A. products='1 вода' stored_qty=0 → delivered 1")
# ─────────────────────────────────────────────────────────────────────────────

sess_a = create_session([make_stop("Точка А", "1 вода", 0)])
asgn_id_a, tok_a = create_assignment(sess_a)
execs_a = get_executions(tok_a)

check("A: execution created", len(execs_a) == 1)
if execs_a:
    e = execs_a[0]
    check("A: plan_qty parsed as 1", e.get("plan_qty") == 1.0, str(e.get("plan_qty")))
    s, upd, _ = patch_execution(tok_a, e["id"],
                                status="delivered", actual_qty=1,
                                payment_method="cash", payment_status="paid",
                                driver_comment="")
    check("A: PATCH delivered → HTTP 200 (not 422)", s == 200, f"{s}: {upd}")
    check("A: shortfall_qty=0", upd.get("shortfall_qty") == 0.0, str(upd.get("shortfall_qty")))


# ─────────────────────────────────────────────────────────────────────────────
section("B. products='2 воды' stored_qty=0 → partial 1 → remaining-order")
# ─────────────────────────────────────────────────────────────────────────────

sess_b = create_session([make_stop("Точка Б", "2 воды", 0)])
asgn_id_b, tok_b = create_assignment(sess_b)
execs_b = get_executions(tok_b)

check("B: execution created", len(execs_b) == 1)
if execs_b:
    e = execs_b[0]
    check("B: plan_qty=2", e.get("plan_qty") == 2.0, str(e.get("plan_qty")))

    s, upd, _ = patch_execution(tok_b, e["id"],
                                status="partial", actual_qty=1,
                                payment_method="cash", payment_status="paid",
                                driver_comment="")
    check("B: partial PATCH → HTTP 200 (no 422)", s == 200, f"{s}: {upd}")
    check("B: shortfall_qty=1", upd.get("shortfall_qty") == 1.0, str(upd.get("shortfall_qty")))

    tomorrow = str(date.today() + timedelta(days=1))
    s, rem, _ = api("POST",
                    f"/api/route/assignments/{asgn_id_b}/executions/{e['id']}/remaining-order",
                    cookie=user_cookie, body={"delivery_date": tomorrow})
    check("B: remaining-order → HTTP 201", s == 201, f"{s}: {rem}")
    check("B: remaining_qty=1", rem.get("remaining_qty") == 1.0, str(rem.get("remaining_qty")))


# ─────────────────────────────────────────────────────────────────────────────
section("C. products='2 воды' stored_qty=0 → failed → remaining-order (full 2)")
# ─────────────────────────────────────────────────────────────────────────────

sess_c = create_session([make_stop("Точка В", "2 воды", 0)])
asgn_id_c, tok_c = create_assignment(sess_c)
execs_c = get_executions(tok_c)

if execs_c:
    e = execs_c[0]
    s, upd, _ = patch_execution(tok_c, e["id"],
                                status="failed", payment_method="none",
                                payment_status="pending", driver_comment="закрыто")
    check("C: failed PATCH → HTTP 200", s == 200, f"{s}: {upd}")
    check("C: shortfall_qty=2 for failed", upd.get("shortfall_qty") == 2.0,
          str(upd.get("shortfall_qty")))

    tomorrow = str(date.today() + timedelta(days=1))
    s, rem, _ = api("POST",
                    f"/api/route/assignments/{asgn_id_c}/executions/{e['id']}/remaining-order",
                    cookie=user_cookie, body={"delivery_date": tomorrow})
    check("C: remaining-order for failed → HTTP 201", s == 201, f"{s}: {rem}")
    check("C: remaining_qty=2 (full plan)", rem.get("remaining_qty") == 2.0,
          str(rem.get("remaining_qty")))


# ─────────────────────────────────────────────────────────────────────────────
section("D. products='2 воды' stored_qty=0 → rescheduled → rescheduled-order")
# ─────────────────────────────────────────────────────────────────────────────

sess_d = create_session([make_stop("Точка Г", "2 воды", 0)])
asgn_id_d, tok_d = create_assignment(sess_d)
execs_d = get_executions(tok_d)

if execs_d:
    e = execs_d[0]
    s, upd, _ = patch_execution(tok_d, e["id"],
                                status="rescheduled", payment_method="none",
                                payment_status="pending",
                                driver_comment="перенос по просьбе")
    check("D: rescheduled PATCH → HTTP 200", s == 200, f"{s}: {upd}")

    tomorrow = str(date.today() + timedelta(days=1))
    s, rsch, _ = api("POST",
                     f"/api/route/assignments/{asgn_id_d}/executions/{e['id']}/rescheduled-order",
                     cookie=user_cookie, body={"delivery_date": tomorrow})
    check("D: rescheduled-order → HTTP 200/201", s in (200, 201), f"{s}: {rsch}")
    new_qty = rsch.get("order", {}).get("quantity") if isinstance(rsch.get("order"), dict) else None
    check("D: new order qty=2 (full plan_qty)", new_qty == 2.0, str(new_qty))


# ─────────────────────────────────────────────────────────────────────────────
section("E. products='Молоко x5' stored_qty=0 → partial 2, shortfall=3")
# ─────────────────────────────────────────────────────────────────────────────

sess_e = create_session([make_stop("Точка Д", "Молоко x5", 0)])
asgn_id_e, tok_e = create_assignment(sess_e)
execs_e = get_executions(tok_e)

if execs_e:
    e = execs_e[0]
    check("E: plan_qty=5", e.get("plan_qty") == 5.0, str(e.get("plan_qty")))
    s, upd, _ = patch_execution(tok_e, e["id"],
                                status="partial", actual_qty=2,
                                payment_method="cash", payment_status="paid",
                                driver_comment="")
    check("E: partial(2/5) → HTTP 200", s == 200, f"{s}: {upd}")
    check("E: shortfall_qty=3", upd.get("shortfall_qty") == 3.0, str(upd.get("shortfall_qty")))


# ─────────────────────────────────────────────────────────────────────────────
section("F. products='Сыр' stored_qty=0 → delivered 1 (default qty=1)")
# ─────────────────────────────────────────────────────────────────────────────

sess_f = create_session([make_stop("Точка Е", "Сыр", 0)])
asgn_id_f, tok_f = create_assignment(sess_f)
execs_f = get_executions(tok_f)

if execs_f:
    e = execs_f[0]
    check("F: plan_qty=1 (no number in 'Сыр' → default)", e.get("plan_qty") == 1.0,
          str(e.get("plan_qty")))
    s, upd, _ = patch_execution(tok_f, e["id"],
                                status="delivered", actual_qty=1,
                                payment_method="cash", payment_status="paid",
                                driver_comment="")
    check("F: delivered(1/1) → HTTP 200", s == 200, f"{s}: {upd}")
    check("F: shortfall_qty=0", upd.get("shortfall_qty") == 0.0, str(upd.get("shortfall_qty")))


# ─────────────────────────────────────────────────────────────────────────────
section("G. Dispatcher view: plan_qty and remaining_qty visible per execution")
# ─────────────────────────────────────────────────────────────────────────────

s, disp, _ = api("GET", f"/api/route/sessions/{sess_b}/assignments", cookie=user_cookie)
check("Dispatcher GET → HTTP 200", s == 200, f"{s}")
asgns = disp.get("assignments", [])
if asgns and asgns[0].get("executions"):
    ex0 = asgns[0]["executions"][0]
    check("Dispatcher: plan_qty present", "plan_qty" in ex0, str(list(ex0.keys())))
    check("Dispatcher: plan_qty=2 for '2 воды'", ex0.get("plan_qty") == 2.0,
          str(ex0.get("plan_qty")))
    check("Dispatcher: remaining_qty present", "remaining_qty" in ex0, str(list(ex0.keys())))
    check("Dispatcher: shortfall_qty present", "shortfall_qty" in ex0, str(list(ex0.keys())))


# ─────────────────────────────────────────────────────────────────────────────
section("H. Legacy simulation: execution with stored quantity=0, plan_qty=0 in DB")
# ─────────────────────────────────────────────────────────────────────────────
# Manually set plan_qty=0 and quantity=0 on an execution to simulate a row
# created before the migration, then verify the driver PATCH still works.

sess_h = create_session([make_stop("Точка Ж", "3 воды", 0)])
asgn_id_h, tok_h = create_assignment(sess_h)
execs_h = get_executions(tok_h)

if execs_h:
    exec_id_h = execs_h[0]["id"]
    # Forcibly reset both quantity and plan_qty to 0 to simulate legacy row
    cur.execute(
        "UPDATE route_executions SET quantity=0, plan_qty=0 WHERE id=%s",
        (exec_id_h,),
    )
    db.commit()

    # Driver GET should still return plan_qty>=1 (parsed from products)
    s, drv_h, _ = api("GET", f"/api/driver/{tok_h}")
    exh = drv_h.get("executions", [])
    check("H: legacy row plan_qty recovered from '3 воды'",
          len(exh) > 0 and exh[0].get("plan_qty") == 3.0,
          str(exh[0] if exh else "empty"))

    # partial delivery should succeed without 422
    s, upd_h, _ = patch_execution(tok_h, exec_id_h,
                                  status="partial", actual_qty=1,
                                  payment_method="cash", payment_status="paid",
                                  driver_comment="")
    check("H: legacy row partial → HTTP 200 (no 422)", s == 200, f"{s}: {upd_h}")
    check("H: shortfall_qty=2", upd_h.get("shortfall_qty") == 2.0,
          str(upd_h.get("shortfall_qty")))


# ─────────────────────────────────────────────────────────────────────────────
section("Cleanup — delete test user cascade")
# ─────────────────────────────────────────────────────────────────────────────

try:
    # route_executions → route_assignments → route_session_stores → route_sessions
    cur.execute("""
        DELETE FROM route_executions
        WHERE assignment_id IN (
            SELECT a.id FROM route_assignments a
            JOIN route_sessions s ON s.id=a.session_id
            WHERE s.owner_id=%s
        )
    """, (test_user_id,))
    cur.execute("""
        DELETE FROM route_assignments
        WHERE session_id IN (SELECT id FROM route_sessions WHERE owner_id=%s)
    """, (test_user_id,))
    cur.execute("DELETE FROM route_session_stores WHERE session_id IN (SELECT id FROM route_sessions WHERE owner_id=%s)", (test_user_id,))
    cur.execute("DELETE FROM daily_orders WHERE owner_id=%s", (test_user_id,))
    cur.execute("DELETE FROM route_sessions WHERE owner_id=%s", (test_user_id,))
    cur.execute("DELETE FROM stores WHERE owner_id=%s", (test_user_id,))
    cur.execute("DELETE FROM users WHERE id=%s", (test_user_id,))
    db.commit()
    print(f"  {GREEN}✅{RESET} Test data cleaned up")
except Exception as exc:
    db.rollback()
    print(f"  {RED}⚠️  Cleanup failed (data may remain): {exc}{RESET}")

cur.close()
db.close()


# ─────────────────────────────────────────────────────────────────────────────
section("RESULTS")
# ─────────────────────────────────────────────────────────────────────────────

total = ok + fail
print(f"\n  {GREEN if fail == 0 else RED}{ok}/{total} passed{RESET}")
if issues:
    print(f"\n  {RED}Failures:{RESET}")
    for issue in issues:
        print(f"    • {issue}")

sys.exit(0 if fail == 0 else 1)
