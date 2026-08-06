#!/usr/bin/env python3
"""
Tests for plan_qty parsing and partial delivery fix.

Scenarios from the task spec:
  A. products="1 вода"  → delivered 1
  B. products="2 воды"  → partial 1
  C. products="2 воды"  → failed
  D. products="2 воды"  → rescheduled
  E. products="Молоко x5" → partial 2
  F. products="Сыр"     → delivered 1

Also tests the parser directly for all documented formats.
"""
import sys
import os
import re
import math

# ─── Copy the two helpers from main.py (don't import the whole server) ────────

def _parse_qty_from_products(text: str) -> float:
    if not text or not text.strip():
        return 1.0
    cross_hits = re.findall(r"[×xX×]\s*(\d+(?:[.,]\d+)?)", text)
    if cross_hits:
        total = sum(float(h.replace(",", ".")) for h in cross_hits)
        return max(total, 1.0)
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)\s+\S", text)
    if m:
        return max(float(m.group(1).replace(",", ".")), 1.0)
    m = re.search(r"\b(\d+(?:[.,]\d+)?)\s*$", text)
    if m:
        return max(float(m.group(1).replace(",", ".")), 1.0)
    for hit in re.finditer(r"\b(\d+(?:[.,]\d+)?)\b", text):
        after = text[hit.end():].lstrip()
        if not after or after[0] not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ\u0430-\u044f\u0410-\u042f":
            return max(float(hit.group(1).replace(",", ".")), 1.0)
    return 1.0


def _effective_planned_qty(row_quantity, products_text: str) -> float:
    stored = float(row_quantity or 0)
    if stored > 0:
        return stored
    return _parse_qty_from_products(products_text or "")


def _validate_execution_quantities(status: str, planned_qty: float, actual_qty: float):
    epsilon = 1e-9
    if not math.isfinite(planned_qty) or not math.isfinite(actual_qty):
        raise ValueError("non-finite")
    if planned_qty < 0:
        raise ValueError("negative plan")
    if actual_qty < 0 or actual_qty > planned_qty:
        raise ValueError("actual out of range")
    if status == "delivered" and abs(actual_qty - planned_qty) > epsilon:
        raise ValueError("delivered: actual != planned")
    if status == "partial" and (
        planned_qty <= epsilon or actual_qty <= epsilon or actual_qty >= planned_qty - epsilon
    ):
        raise ValueError("partial: bad quantities")


# ─── Parser unit tests ────────────────────────────────────────────────────────

PARSER_CASES = [
    ("2 воды",          2.0),
    ("1 вода",          1.0),
    ("Воды 3",          3.0),
    ("Вода 19л x2",     2.0),
    ("2 бутыли",        2.0),
    ("Бутыль 1",        1.0),
    ("Молоко x5",       5.0),
    ("Молоко×4, Сахар×16", 20.0),
    ("Сыр",             1.0),
    ("",                1.0),
    ("Вода",            1.0),
]

passed = failed = 0

print("=== Parser unit tests ===")
for text, expected in PARSER_CASES:
    got = _parse_qty_from_products(text)
    ok = abs(got - expected) < 1e-9
    status = "OK" if ok else "FAIL"
    if ok:
        passed += 1
    else:
        failed += 1
    print(f"  [{status}] '{text}' → {got} (expected {expected})")

# ─── _effective_planned_qty tests ─────────────────────────────────────────────

print("\n=== _effective_planned_qty ===")
EFF_CASES = [
    (2.0, "2 воды",   2.0),   # stored wins
    (0,   "2 воды",   2.0),   # parse from products
    (0,   "Сыр",      1.0),   # default 1
    (0,   "",         1.0),   # empty → 1
    (5.0, "Молоко x5", 5.0),  # stored wins even when match
]
for qty, prod, expected in EFF_CASES:
    got = _effective_planned_qty(qty, prod)
    ok = abs(got - expected) < 1e-9
    status = "OK" if ok else "FAIL"
    passed += ok; failed += (not ok)
    print(f"  [{status}] qty={qty!r} products={prod!r} → {got} (expected {expected})")

# ─── Delivery scenario tests ──────────────────────────────────────────────────

print("\n=== Delivery scenarios ===")

def scenario(label: str, products: str, stored_qty: float, action: str, actual: float):
    plan = _effective_planned_qty(stored_qty, products)
    try:
        if action in ("delivered", "partial"):
            _validate_execution_quantities(action, plan, actual)
        remaining = max(plan - actual, 0)
        return True, plan, actual, remaining
    except ValueError as exc:
        return False, plan, actual, None

SCENARIOS = [
    # label,        products,       stored, action,       actual
    ("A: delivered 1", "1 вода",   0,      "delivered",  1.0),
    ("B: partial 1",   "2 воды",   0,      "partial",    1.0),
    ("C: failed",      "2 воды",   0,      "failed",     0.0),
    ("D: rescheduled", "2 воды",   0,      "rescheduled",0.0),
    ("E: partial 2",   "Молоко x5",0,      "partial",    2.0),
    ("F: delivered 1", "Сыр",      0,      "delivered",  1.0),
]

for label, products, stored, action, actual in SCENARIOS:
    ok, plan, act, rem = scenario(label, products, stored, action, actual)
    status = "OK" if ok else "FAIL"
    passed += ok; failed += (not ok)
    rem_str = f"остаток={rem}" if rem is not None else "n/a"
    print(f"  [{status}] {label}: plan={plan} actual={act} {rem_str}")

# ─── Critical: partial with 0-quantity legacy row ─────────────────────────────

print("\n=== Critical: partial 422 fix ===")
# Simulate legacy row: stored quantity=0, products="2 воды"
plan = _effective_planned_qty(0, "2 воды")
try:
    _validate_execution_quantities("partial", plan, 1.0)
    ok = True
except ValueError:
    ok = False
passed += ok; failed += (not ok)
print(f"  [{'OK' if ok else 'FAIL'}] products='2 воды' stored_qty=0 → partial(actual=1) plan={plan}")

# Simulate products="Сыр" (no number) → partial should still work with default plan=1
# But partial requires actual < planned, so actual=0.5 with plan=1 should work
plan = _effective_planned_qty(0, "Сыр")
try:
    _validate_execution_quantities("partial", plan, 0.5)
    ok = True
except ValueError:
    ok = False
passed += ok; failed += (not ok)
print(f"  [{'OK' if ok else 'FAIL'}] products='Сыр' stored_qty=0 → partial(actual=0.5) plan={plan}")

# ─── Summary ──────────────────────────────────────────────────────────────────

print(f"\n=== Results: {passed} passed, {failed} failed ===")
sys.exit(0 if failed == 0 else 1)
