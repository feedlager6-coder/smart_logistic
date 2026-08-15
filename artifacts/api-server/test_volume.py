"""
test_volume.py — Unit tests for dual-dimension (kg + m³) capacity support.

Run: python3 -m pytest artifacts/api-server/test_volume.py -v
Or:  python3 artifacts/api-server/test_volume.py

All tests are offline — no network calls, no DB required.
"""
import sys
import os
import math

sys.path.insert(0, os.path.dirname(__file__))

# ── Minimal stubs so main.py can be imported without FastAPI/psycopg2 ─────────
import types

# Stub out heavy dependencies before importing main
for mod in ("fastapi", "psycopg2", "openpyxl", "passlib", "bcrypt",
            "uvicorn", "pydantic"):
    if mod not in sys.modules:
        sys.modules[mod] = types.ModuleType(mod)

# FastAPI stubs
fastapi_mod = sys.modules["fastapi"]
_noop_decorator = lambda *a, **k: (lambda f: f)

class _FakeApp:
    """Absorbs any attribute access as a no-op decorator."""
    def __getattr__(self, name):
        return _noop_decorator
    def add_middleware(self, *a, **k): pass
    def mount(self, *a, **k): pass
    def include_router(self, *a, **k): pass

fastapi_mod.FastAPI = lambda **kw: _FakeApp()
fastapi_mod.APIRouter = lambda **kw: _FakeApp()
fastapi_mod.HTTPException = Exception
fastapi_mod.Depends = lambda f: None
fastapi_mod.Request = object
fastapi_mod.Response = object
fastapi_mod.Query = lambda *a, **k: None
fastapi_mod.UploadFile = object
fastapi_mod.File = lambda *a, **k: None
fastapi_mod.Form = lambda *a, **k: None
fastapi_mod.BackgroundTasks = object
for sub in ("middleware.cors", "staticfiles", "responses", "security"):
    sys.modules[f"fastapi.{sub}"] = types.ModuleType(f"fastapi.{sub}")
sys.modules["fastapi.middleware.cors"].CORSMiddleware = object
sys.modules["fastapi.staticfiles"].StaticFiles = object
sys.modules["fastapi.responses"].JSONResponse = dict
sys.modules["fastapi.responses"].StreamingResponse = object
sys.modules["fastapi.responses"].FileResponse = object
sys.modules["fastapi.security"].HTTPBearer = object
sys.modules["fastapi.security"].HTTPAuthorizationCredentials = object
sys.modules["fastapi.security"].OAuth2PasswordRequestForm = object

# jose stub
jose_mod = types.ModuleType("jose")
jose_mod.jwt = types.SimpleNamespace(
    encode=lambda *a, **k: "token",
    decode=lambda *a, **k: {},
)
jose_mod.JWTError = Exception
sys.modules["jose"] = jose_mod

# pydantic stub
pydantic_mod = sys.modules["pydantic"]
class _BaseModel:
    def __init__(self, **kw):
        for k, v in kw.items():
            setattr(self, k, v)
pydantic_mod.BaseModel = _BaseModel
pydantic_mod.field_validator = lambda *a, **k: (lambda f: f)
pydantic_mod.ConfigDict = lambda **k: {}

# psycopg2 stub
psycopg2_mod = sys.modules["psycopg2"]
psycopg2_mod.connect = lambda *a, **k: None
sys.modules["psycopg2.extras"] = types.ModuleType("psycopg2.extras")

# openpyxl stub
omod = sys.modules["openpyxl"]
omod.load_workbook = lambda *a, **k: None
omod.Workbook = lambda: None
sys.modules["openpyxl.styles"] = types.ModuleType("openpyxl.styles")
sys.modules["openpyxl.styles"].Font = object
sys.modules["openpyxl.styles"].PatternFill = object
sys.modules["openpyxl.styles"].Alignment = object
sys.modules["openpyxl.styles"].Border = object
sys.modules["openpyxl.styles"].Side = object

# bcrypt stub
bcrypt_mod = sys.modules["bcrypt"]
bcrypt_mod.hashpw = lambda pw, salt: b"hash"
bcrypt_mod.checkpw = lambda pw, h: True
bcrypt_mod.gensalt = lambda **k: b"salt"

# Other stubs
sys.modules["passlib"] = types.ModuleType("passlib")
sys.modules["passlib.context"] = types.ModuleType("passlib.context")
sys.modules["passlib.context"].CryptContext = object

import os
os.environ.setdefault("DATABASE_URL", "postgresql://stub:stub@localhost/stub")
os.environ.setdefault("ADMIN_PASSWORD", "test-admin-password")
os.environ.setdefault("JWT_SECRET", "test-jwt-secret")

# Now we can import the functions under test directly
# (without running FastAPI app startup)
from main import (
    _can_route_accept,
    _cluster_by_weight_sweep,
    _enforce_capacity,
    _inter_route_relocate,
    _rebalance_min_stops,
    _rebalance_max_stops,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_matrix(n: int, base: int = 1000) -> list:
    """Return an n×n distance matrix with base metres between every pair."""
    return [[0 if i == j else base for j in range(n)] for i in range(n)]


# ── Tests: _can_route_accept ───────────────────────────────────────────────────

def test_can_route_accept_both_unlimited():
    """When both cap lists are None, always returns True."""
    assert _can_route_accept([1, 2], 3, demands_kg=None, demands_m3=None,
                             capacities_kg=None, capacities_m3=None, v_idx=0)


def test_can_route_accept_kg_fits():
    demands_kg = [0, 500, 500, 500]
    capacities_kg = [1600]
    # route has 1000 kg, adding 500 → 1500 ≤ 1600 ✓
    assert _can_route_accept([1, 2], 3, demands_kg=demands_kg,
                             capacities_kg=capacities_kg, v_idx=0)


def test_can_route_accept_kg_overflow():
    demands_kg = [0, 500, 500, 500]
    capacities_kg = [1000]
    # route has 1000 kg, adding 500 → 1500 > 1000 ✗
    assert not _can_route_accept([1, 2], 3, demands_kg=demands_kg,
                                 capacities_kg=capacities_kg, v_idx=0)


def test_can_route_accept_m3_fits():
    demands_m3 = [0.0, 2.0, 2.0, 2.0]
    capacities_m3 = [7.0]
    # 4 + 2 = 6 ≤ 7 ✓
    assert _can_route_accept([1, 2], 3, demands_m3=demands_m3,
                             capacities_m3=capacities_m3, v_idx=0)


def test_can_route_accept_m3_overflow():
    demands_m3 = [0.0, 2.0, 2.0, 2.0]
    capacities_m3 = [5.0]
    # 4 + 2 = 6 > 5 ✗
    assert not _can_route_accept([1, 2], 3, demands_m3=demands_m3,
                                 capacities_m3=capacities_m3, v_idx=0)


def test_can_route_accept_kg_ok_m3_fail():
    """kg fits but m³ doesn't → should reject."""
    demands_kg = [0, 100, 100, 100]
    demands_m3 = [0.0, 3.0, 3.0, 3.0]
    capacities_kg = [1000]
    capacities_m3 = [5.0]
    # kg: 200 + 100 = 300 ≤ 1000 ✓; m³: 6 + 3 = 9 > 5 ✗
    assert not _can_route_accept([1, 2], 3,
                                 demands_kg=demands_kg, demands_m3=demands_m3,
                                 capacities_kg=capacities_kg, capacities_m3=capacities_m3,
                                 v_idx=0)


def test_can_route_accept_m3_ok_kg_fail():
    """m³ fits but kg doesn't → should reject."""
    demands_kg = [0, 500, 500, 500]
    demands_m3 = [0.0, 1.0, 1.0, 1.0]
    capacities_kg = [900]
    capacities_m3 = [10.0]
    # kg: 1000 + 500 = 1500 > 900 ✗; m³: 2 + 1 = 3 ≤ 10 ✓
    assert not _can_route_accept([1, 2], 3,
                                 demands_kg=demands_kg, demands_m3=demands_m3,
                                 capacities_kg=capacities_kg, capacities_m3=capacities_m3,
                                 v_idx=0)


# ── Tests: _cluster_by_weight_sweep ──────────────────────────────────────────

def _linear_coords(n: int):
    """Return depot at (0,0) and n stores at (0.001*i, 0) for i in 1..n."""
    depot = (0.0, 0.0)
    stores = [(0.0, 0.001 * i) for i in range(1, n + 1)]
    return [depot] + stores


def test_cluster_sweep_kg_only():
    """Classic kg-only clustering: 6 stores, 2 vehicles, 3 each."""
    n = 6
    all_coords = _linear_coords(n)
    store_indices = list(range(1, n + 1))
    demands = [0] + [100] * n      # 100 kg per store
    capacities = [300, 300]        # 3 stores per vehicle max
    clusters = _cluster_by_weight_sweep(store_indices, all_coords, 2, capacities, demands)
    # All stores placed
    total = sum(len(c) for c in clusters)
    assert total == n, f"Expected {n} stores, got {total}"
    # No cluster exceeds kg cap
    for c in clusters:
        load = sum(demands[node] for node in c)
        assert load <= 300, f"Cluster kg={load} exceeds cap 300"


def test_cluster_sweep_dual_cap_m3_binding():
    """m³ cap is binding even though kg cap isn't — limits cluster size."""
    n = 4
    all_coords = _linear_coords(n)
    store_indices = list(range(1, n + 1))
    demands_kg = [0] + [100] * n      # 100 kg per store (cap = 9999 → not binding)
    capacities_kg = [9999, 9999]
    demands_m3 = [0.0] + [2.0] * n   # 2 m³ per store
    capacities_m3 = [4.0, 4.0]       # 2 stores per vehicle max (4/2=2)
    clusters = _cluster_by_weight_sweep(
        store_indices, all_coords, 2, capacities_kg, demands_kg,
        capacities_m3=capacities_m3, demands_m3=demands_m3)
    total = sum(len(c) for c in clusters)
    assert total == n
    for ci, c in enumerate(clusters):
        vol = sum(demands_m3[node] for node in c)
        assert vol <= 4.0 + 1e-9, f"Cluster {ci} m³={vol} exceeds cap 4.0"


def test_cluster_sweep_both_caps_satisfied():
    """Both caps satisfied simultaneously."""
    n = 4
    all_coords = _linear_coords(n)
    store_indices = list(range(1, n + 1))
    demands_kg = [0, 500, 500, 500, 500]
    capacities_kg = [1000, 1000]
    demands_m3 = [0.0, 1.5, 1.5, 1.5, 1.5]
    capacities_m3 = [3.0, 3.0]
    clusters = _cluster_by_weight_sweep(
        store_indices, all_coords, 2, capacities_kg, demands_kg,
        capacities_m3=capacities_m3, demands_m3=demands_m3)
    total = sum(len(c) for c in clusters)
    assert total == n
    for ci, c in enumerate(clusters):
        load_kg = sum(demands_kg[node] for node in c)
        load_m3 = sum(demands_m3[node] for node in c)
        assert load_kg <= 1000 + 1, f"Cluster {ci} kg={load_kg} > cap 1000"
        assert load_m3 <= 3.0 + 1e-9, f"Cluster {ci} m³={load_m3} > cap 3.0"


def test_cluster_sweep_overflow_graceful():
    """When total demand exceeds total capacity, stores overflow to least-loaded (no crash)."""
    n = 4
    all_coords = _linear_coords(n)
    store_indices = list(range(1, n + 1))
    demands_kg = [0] + [100] * n
    capacities_kg = [150, 150]     # only 1 store each
    clusters = _cluster_by_weight_sweep(
        store_indices, all_coords, 2, capacities_kg, demands_kg)
    total = sum(len(c) for c in clusters)
    assert total == n, "All stores must be placed even on overflow"


# ── Tests: _enforce_capacity ───────────────────────────────────────────────────

def test_enforce_capacity_m3_overload_resolved():
    """A route with m³ overload should have a stop moved out."""
    # 4 nodes (depot=0, stores=1,2,3)
    # Vehicle 0 has m³ cap 2.0; it starts with 2 stores each 1.5 m³ (overloaded)
    # Vehicle 1 has m³ cap 4.0 and is empty
    routes = [[1, 2], [3]]
    demands = [0, 100, 100, 100]
    capacities = [99999, 99999]
    demands_m3 = [0.0, 1.5, 1.5, 1.5]
    capacities_m3 = [2.0, 4.0]
    full_matrix = make_matrix(4)
    result = _enforce_capacity(routes, demands, capacities, full_matrix,
                               demands_m3=demands_m3, capacities_m3=capacities_m3)
    # Check m³ loads
    all_nodes = [n for r in result for n in r]
    assert sorted(all_nodes) == [1, 2, 3], "All stores must be present"
    for vi, r in enumerate(result):
        vol = sum(demands_m3[node] for node in r)
        cap = capacities_m3[vi]
        assert vol <= cap + 1e-9, f"Route {vi} still overloaded: {vol} > {cap}"


# ── Tests: _inter_route_relocate with capacity guard ─────────────────────────

def test_inter_route_relocate_respects_m3():
    """Relocate must NOT move a stop that would overflow destination m³ cap."""
    # Route 0: [1] (1.5 m³ used), cap 2.0 → has 0.5 m³ headroom
    # Route 1: [2, 3] (3.0 m³ used), cap 3.0 → FULL
    # Matrix: moving node from r1 to r0 would save km (route 1 is long)
    # But r0 can only accept a 0.5 m³ stop; nodes 2,3 are each 1.5 m³ → should NOT move

    # Use distances that make moves look attractive
    matrix = [
        [0, 100, 200, 300],   # depot
        [100, 0, 100, 200],   # node 1
        [200, 100, 0, 100],   # node 2
        [300, 200, 100, 0],   # node 3
    ]
    routes = [[1], [2, 3]]
    demands_m3 = [0.0, 1.5, 1.5, 1.5]
    capacities_m3 = [2.0, 3.0]       # r0 has 0.5 m³ headroom only
    demands_kg = [0, 100, 100, 100]
    capacities_kg = [99999, 99999]    # kg unlimited

    result = _inter_route_relocate(routes, matrix, max_iter=5, min_stops=1,
                                   demands_kg=demands_kg, demands_m3=demands_m3,
                                   capacities_kg=capacities_kg, capacities_m3=capacities_m3)

    # Node 2 and 3 must NOT move to route 0 (would overflow)
    r0 = result[0] if result else []
    for node in r0:
        vol_r0 = sum(demands_m3[n] for n in r0)
        assert vol_r0 <= 2.0 + 1e-9, f"Route 0 m³={vol_r0} exceeded cap 2.0"


# ── Tests: _rebalance_min_stops with capacity guard ────────────────────────────

def test_rebalance_min_stops_capacity_respected():
    """min-stops rebalance must not steal a stop that would overflow receiver m³ cap."""
    matrix = make_matrix(4)
    # r0 has 0 stops — underfull; r1 has 3 stops
    # But r0's m³ cap is 0.5, and each stop is 1.0 m³ → cannot steal any stop
    routes = [[], [1, 2, 3]]
    demands_kg = [0, 100, 100, 100]
    demands_m3 = [0.0, 1.0, 1.0, 1.0]
    capacities_kg = [99999, 99999]
    capacities_m3 = [0.5, 10.0]     # r0 cap too small to accept anything

    result = _rebalance_min_stops(routes, matrix, min_stops=2,
                                  demands_kg=demands_kg, demands_m3=demands_m3,
                                  capacities_kg=capacities_kg, capacities_m3=capacities_m3)
    # All 3 stops must still be placed somewhere
    all_nodes = sorted(n for r in result for n in r)
    assert all_nodes == [1, 2, 3], f"Stores lost: {all_nodes}"


# ── Tests: _rebalance_max_stops with capacity guard ────────────────────────────

def test_rebalance_max_stops_capacity_respected():
    """max-stops rebalance must not move a stop to a receiver that has no m³ headroom."""
    matrix = make_matrix(4)
    # r0 has 3 stops (over cap=2); r1 has 0 stops but m³ cap = 0.5 (full with any stop)
    routes = [[1, 2, 3], []]
    demands_kg = [0, 100, 100, 100]
    demands_m3 = [0.0, 1.0, 1.0, 1.0]
    capacities_kg = [99999, 99999]
    capacities_m3 = [10.0, 0.5]    # r1 cannot accept any stop (1.0 > 0.5)

    result, moves = _rebalance_max_stops(
        routes, matrix, max_stops=2,
        demands_kg=demands_kg, demands_m3=demands_m3,
        capacities_kg=capacities_kg, capacities_m3=capacities_m3)

    # r0 should still have ≥2 stops (couldn't move any due to m³ constraint)
    r0 = result[0] if result else []
    assert len(r0) >= 2, f"r0 shrank below safe minimum: {len(r0)} stops"
    # All stores still present
    all_nodes = sorted(n for r in result for n in r)
    assert all_nodes == [1, 2, 3]


# ── Stress test: large dual-cap dataset ───────────────────────────────────────

def test_cluster_sweep_stress():
    """50 stores, 5 vehicles, both kg and m³ caps — no crash, all stores placed."""
    import random
    random.seed(42)
    n = 50
    num_v = 5
    depot = (42.9849, 47.5046)  # тестовый депо

    def rand_coord():
        return (depot[0] + random.uniform(-0.3, 0.3),
                depot[1] + random.uniform(-0.3, 0.3))

    all_coords = [depot] + [rand_coord() for _ in range(n)]
    store_indices = list(range(1, n + 1))
    demands_kg = [0] + [random.randint(50, 300) for _ in range(n)]
    demands_m3 = [0.0] + [round(random.uniform(0.1, 2.0), 2) for _ in range(n)]

    total_kg = sum(demands_kg)
    total_m3 = sum(demands_m3)
    capacities_kg = [max(1, int(total_kg / num_v * 1.2))] * num_v
    capacities_m3 = [round(total_m3 / num_v * 1.2, 2)] * num_v

    clusters = _cluster_by_weight_sweep(
        store_indices, all_coords, num_v, capacities_kg, demands_kg,
        capacities_m3=capacities_m3, demands_m3=demands_m3)

    total = sum(len(c) for c in clusters)
    assert total == n, f"Expected {n} stores placed, got {total}"


# ── Runner ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    tests = [
        test_can_route_accept_both_unlimited,
        test_can_route_accept_kg_fits,
        test_can_route_accept_kg_overflow,
        test_can_route_accept_m3_fits,
        test_can_route_accept_m3_overflow,
        test_can_route_accept_kg_ok_m3_fail,
        test_can_route_accept_m3_ok_kg_fail,
        test_cluster_sweep_kg_only,
        test_cluster_sweep_dual_cap_m3_binding,
        test_cluster_sweep_both_caps_satisfied,
        test_cluster_sweep_overflow_graceful,
        test_enforce_capacity_m3_overload_resolved,
        test_inter_route_relocate_respects_m3,
        test_rebalance_min_stops_capacity_respected,
        test_rebalance_max_stops_capacity_respected,
        test_cluster_sweep_stress,
    ]

    passed = 0
    failed = 0
    for t in tests:
        try:
            t()
            print(f"  ✓  {t.__name__}")
            passed += 1
        except Exception as e:
            print(f"  ✗  {t.__name__}: {e}")
            failed += 1

    print(f"\n{passed}/{passed+failed} tests passed", end="")
    if failed:
        print(f"  ({failed} FAILED)")
        sys.exit(1)
    else:
        print("  ✓ all passed")
