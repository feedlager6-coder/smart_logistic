import os
import math
import json
import traceback
import urllib.request
import urllib.parse
import time
import io
import logging
import threading
import concurrent.futures
import uuid as _uuid
from datetime import date, datetime, timedelta
from typing import Optional
import secrets
import psycopg2
import psycopg2.extras
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, Depends, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from jose import jwt, JWTError

try:
    from ortools.constraint_solver import routing_enums_pb2
    from ortools.constraint_solver import pywrapcp
    ORTOOLS_AVAILABLE = True
except ImportError:
    ORTOOLS_AVAILABLE = False
    logging.warning("OR-Tools not available, using greedy fallback")

try:
    import openpyxl
    OPENPYXL_AVAILABLE = True
except ImportError:
    OPENPYXL_AVAILABLE = False

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="SmartRoute API")

# ALLOWED_ORIGINS env var — comma-separated list of allowed origins.
# Default "*" works for single-service deployments where frontend and backend
# share the same Railway domain. Restrict to your domain for production:
#   ALLOWED_ORIGINS=https://smartroute.up.railway.app
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "*")
_ALLOWED_ORIGINS: list = (
    ["*"] if _raw_origins.strip() == "*"
    else [o.strip() for o in _raw_origins.split(",") if o.strip()]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    # allow_credentials requires explicit origin list (not "*").
    # In production Railway, front+API share the same origin so CORS doesn't apply.
    # In dev (Replit), Vite proxy handles cross-origin requests transparently.
    allow_credentials=_ALLOWED_ORIGINS != ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Add security headers to every response."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
    # HSTS only when served over HTTPS (Railway / custom domain)
    if request.url.scheme == "https":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response

# PG_CONNECTION_URL overrides Replit's managed DATABASE_URL (use for Railway or custom Postgres)
DATABASE_URL = os.environ.get("PG_CONNECTION_URL") or os.environ.get("DATABASE_URL", "")

# ── JWT / Auth ────────────────────────────────────────────────────────────────
_JWT_SECRET_ENV = os.environ.get("JWT_SECRET", "")
if not _JWT_SECRET_ENV:
    _JWT_SECRET_ENV = secrets.token_hex(32)
    logging.warning(
        "JWT_SECRET env var is not set — using a random secret. "
        "All sessions will be invalidated on server restart. "
        "Set JWT_SECRET in production for persistent sessions."
    )
JWT_SECRET: str = _JWT_SECRET_ENV
JWT_ALGORITHM: str = "HS256"
JWT_TOKEN_TTL_HOURS: int = int(os.environ.get("JWT_TOKEN_TTL_HOURS", "24"))
JWT_COOKIE_NAME: str = "smartroute_token"
# SameSite=none + Secure=true is required for cross-site iframe contexts (Replit canvas, embedded apps).
# Default: none/true so dev preview works inside Replit's iframe-based editor.
# Override via env: COOKIE_SAMESITE=lax + COOKIE_SECURE=false for pure-localhost HTTP testing.
COOKIE_SAMESITE: str = os.environ.get("COOKIE_SAMESITE", "none")
COOKIE_SECURE: bool = os.environ.get("COOKIE_SECURE", "true").lower() in ("1", "true", "yes")

# passlib is imported but NOT used for bcrypt — direct bcrypt calls avoid the
# bcrypt≥4.0 passlib incompatibility (missing __about__.__version__).
# CryptContext left in place only so the import doesn't break; never call it.

ADMIN_PASSWORD: str = os.environ.get("ADMIN_PASSWORD", "")

# ── Login rate limiter ─────────────────────────────────────────────────────────
# Tracks failed login attempts per IP: ip → list of timestamps (epoch seconds).
# After LOGIN_MAX_ATTEMPTS failures in LOGIN_WINDOW_SECONDS → 429 for LOGIN_BLOCK_SECONDS.
LOGIN_MAX_ATTEMPTS: int = 5
LOGIN_WINDOW_SECONDS: int = 15 * 60   # 15 minutes
LOGIN_BLOCK_SECONDS: int = 15 * 60    # block for 15 minutes after threshold
_login_attempts: dict = {}            # {ip: [timestamp, ...]}
_login_attempts_lock = threading.Lock()


def _get_client_ip(request: Request) -> str:
    """Return the best-effort client IP for rate limiting."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _check_login_rate_limit(ip: str) -> None:
    """Raise 429 if IP has exceeded the login attempt threshold."""
    now = time.time()
    with _login_attempts_lock:
        attempts = _login_attempts.get(ip, [])
        # Keep only attempts within the window
        attempts = [t for t in attempts if now - t < LOGIN_WINDOW_SECONDS]
        _login_attempts[ip] = attempts
        if len(attempts) >= LOGIN_MAX_ATTEMPTS:
            retry_after = int(LOGIN_BLOCK_SECONDS - (now - attempts[0]))
            raise HTTPException(
                status_code=429,
                detail=f"Слишком много попыток входа. Попробуйте через {max(1, retry_after // 60)} мин.",
                headers={"Retry-After": str(max(1, retry_after))},
            )


def _record_failed_login(ip: str) -> None:
    """Record a failed login attempt for the given IP."""
    now = time.time()
    with _login_attempts_lock:
        attempts = _login_attempts.get(ip, [])
        attempts = [t for t in attempts if now - t < LOGIN_WINDOW_SECONDS]
        attempts.append(now)
        _login_attempts[ip] = attempts


def _clear_login_attempts(ip: str) -> None:
    """Clear failed login attempts after a successful login."""
    with _login_attempts_lock:
        _login_attempts.pop(ip, None)


# Paths that do NOT require authentication
_AUTH_PUBLIC_PATHS = {"/api/healthz", "/api/auth/login"}

AVG_SPEED_KMH = 30
TRAFFIC_MULTIPLIER = 1.2
geocode_cache: dict = {}
import_jobs: dict = {}  # job_id → progress/result dict (in-memory, TTL not needed for MVP)

# ── GraphHopper Matrix API ────────────────────────────────────────────────────

GRAPHHOPPER_API_KEY: str = os.environ.get("GRAPHHOPPER_API_KEY", "")
YANDEX_GEOCODER_API_KEY: str = os.environ.get("YANDEX_GEOCODER_API_KEY", "")

# Max locations per single GH Matrix request.  Free plan = 5; Starter = 25+.
# Override via GRAPHHOPPER_CLUSTER_MAX env-var if you are on a higher-tier plan.
GRAPHHOPPER_FREE_LIMIT = 5           # legacy constant kept for compatibility
GRAPHHOPPER_CLUSTER_MAX: int = int(os.environ.get("GRAPHHOPPER_CLUSTER_MAX", "25"))
GRAPHHOPPER_RATE_LIMIT_TTL = 60      # seconds to suppress GH calls after a 429

# Epoch-seconds timestamp; GH calls are suppressed while time.time() < this value
_gh_rate_limited_until: float = 0.0

# ── In-memory GraphHopper matrix cache ────────────────────────────────────────
# Key: tuple of (lat, lon) pairs (ordered: depot first, then stores).
# Value: (distance_matrix, time_matrix) from GH API.
# Lives for the process lifetime; cleared on server restart.
_matrix_cache: dict = {}
_matrix_cache_hits: int = 0    # cache lookups that returned a cached result
_matrix_cache_misses: int = 0  # cache lookups that triggered a live API call
_gh_call_successes: int = 0    # live API calls that returned a valid matrix

# Auto-calibrated from the first GH 400 "Too many points" response.
# Starts at GRAPHHOPPER_CLUSTER_MAX; reduced if the API key plan allows fewer.
_gh_plan_limit: int = GRAPHHOPPER_CLUSTER_MAX

# ── OSRM Matrix API ────────────────────────────────────────────────────────────
# OSRM (Open Source Routing Machine) uses real OpenStreetMap road data.
# Public demo server: free, no API key, fair-use policy (≤ 100 locations/request).
# Override OSRM_BASE_URL env-var to point at a self-hosted instance.
OSRM_BASE_URL: str = os.environ.get("OSRM_BASE_URL", "https://router.project-osrm.org")
OSRM_MAX_LOCATIONS: int = int(os.environ.get("OSRM_MAX_LOCATIONS", "100"))
OSRM_RATE_LIMIT_TTL = 30      # seconds to suppress OSRM calls after error/timeout

# OR-Tools TSP time budget per cluster (seconds).
# Increase for larger clusters on a dedicated server; lower for test environments.
ORTOOLS_TIME_LIMIT_SECONDS: float = float(os.environ.get("ORTOOLS_TIME_LIMIT_SECONDS", "2"))

# Minimum number of stops per vehicle route.
# If any vehicle ends up with fewer stops after VRP+Or-opt, the rebalancer
# steals the cheapest (min-distance-penalty) stops from overloaded vehicles.
# Scales down automatically when total_stops < MIN_STOPS_PER_VEHICLE * num_vehicles.
MIN_STOPS_PER_VEHICLE: int = 5

# Post-assignment centroid refinement for _cluster_by_sweep().
# Number of nearest-centroid reassignment iterations (0 = sweep-only, no refinement).
# Each iteration moves border-point stores to the geometrically nearest cluster centroid.
CLUSTER_CENTROID_REFINEMENT_ROUNDS: int = int(
    os.environ.get("CLUSTER_CENTROID_REFINEMENT_ROUNDS", "3")
)

_osrm_rate_limited_until: float = 0.0
_osrm_call_successes: int = 0
_osrm_cache_hits: int = 0


def get_matrix_from_graphhopper(coords: list) -> Optional[tuple]:
    """
    Send ONE POST request to the GraphHopper Matrix API and return the full
    distance + time matrix for the given coordinate list.

    Args:
        coords: list of (lat, lon) tuples (any length ≤ GRAPHHOPPER_FREE_LIMIT)

    Returns:
        (distance_matrix, time_matrix) where values are metres / seconds
        respectively, or None on any failure (caller should fall back to
        Haversine transparently).
    """
    global _gh_rate_limited_until

    # Honour the rate-limit cool-down period set by a previous 429
    if time.time() < _gh_rate_limited_until:
        remaining = int(_gh_rate_limited_until - time.time())
        logger.info("GraphHopper still rate-limited (%ds left), using Haversine", remaining)
        return None

    if not coords or len(coords) < 2:
        return None

    # Guard: silently skip if the batch exceeds the Free Plan point limit
    if len(coords) > GRAPHHOPPER_FREE_LIMIT:
        logger.info(
            "GraphHopper: %d coords exceeds free limit %d, using Haversine",
            len(coords), GRAPHHOPPER_FREE_LIMIT,
        )
        return None

    # GraphHopper Matrix API expects [longitude, latitude] order
    gh_points = [[lon, lat] for lat, lon in coords]

    payload = json.dumps({
        "from_points": gh_points,
        "to_points": gh_points,
        "out_arrays": ["distances", "times"],
        "vehicle": "car",
    }).encode("utf-8")

    url = f"https://graphhopper.com/api/1/matrix?key={GRAPHHOPPER_API_KEY}"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        distances = data.get("distances")   # list[list[float]] — metres
        times = data.get("times")           # list[list[float]] — seconds

        if distances and times:
            logger.info(
                "GraphHopper matrix fetched: %dx%d", len(distances), len(distances[0])
            )
            return distances, times

        logger.warning("GraphHopper response missing distances/times: %s", data)

    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            # Rate limit hit — back off and fall through to Haversine seamlessly
            _gh_rate_limited_until = time.time() + GRAPHHOPPER_RATE_LIMIT_TTL
            logger.warning(
                "GraphHopper 429 — switching to Haversine for next %ds",
                GRAPHHOPPER_RATE_LIMIT_TTL,
            )
        else:
            logger.warning("GraphHopper HTTP error %d: %s", exc.code, exc.reason)

    except Exception as exc:
        logger.warning("GraphHopper API call failed: %s", exc)

    return None


def get_cluster_matrix_gh(coords: list) -> Optional[tuple]:
    """
    Fetch a GraphHopper distance + time matrix for a geographic cluster.

    Key differences from the legacy ``get_matrix_from_graphhopper``:
    • Accepts up to ``GRAPHHOPPER_CLUSTER_MAX`` locations (default 25) instead of
      the old hard-coded free-plan limit of 5.
    • Results are stored in ``_matrix_cache`` keyed by the ordered coordinate
      tuple (rounded to 6 decimals).  Repeated calls for the same cluster
      (e.g. when rebuilding a route with the same stores) cost 0 extra API calls.
    • Logs every cache hit, cache miss, and the latency of every live API call.
    • Falls back transparently to ``None`` on any failure so the caller can
      switch to Haversine without surfacing an error.

    Args:
        coords: ordered list of (lat, lon) tuples; index 0 should be the depot.

    Returns:
        (distance_matrix, time_matrix) with values in metres / seconds,
        or None when GH is unavailable, rate-limited, or the cluster is too large.
    """
    global _gh_rate_limited_until, _matrix_cache_hits, _matrix_cache_misses
    global _gh_call_successes, _gh_plan_limit
    import re as _re

    if not GRAPHHOPPER_API_KEY:
        return None

    if time.time() < _gh_rate_limited_until:
        remaining = int(_gh_rate_limited_until - time.time())
        logger.info("GH rate-limited (%ds remaining) — using Haversine", remaining)
        return None

    if not coords or len(coords) < 2:
        return None

    if len(coords) > _gh_plan_limit:
        logger.info(
            "GH cluster size %d exceeds plan limit %d — using Haversine "
            "(set GRAPHHOPPER_CLUSTER_MAX env-var to increase for higher-tier plans)",
            len(coords), _gh_plan_limit,
        )
        return None

    # ── Cache lookup ──────────────────────────────────────────────────────────
    cache_key = tuple((round(lat, 6), round(lon, 6)) for lat, lon in coords)
    if cache_key in _matrix_cache:
        _matrix_cache_hits += 1
        logger.info(
            "GH matrix cache HIT (size=%d, hits=%d, misses=%d, successes=%d)",
            len(coords), _matrix_cache_hits, _matrix_cache_misses, _gh_call_successes,
        )
        return _matrix_cache[cache_key]

    # ── Live API call ─────────────────────────────────────────────────────────
    _matrix_cache_misses += 1
    gh_points = [[lon, lat] for lat, lon in coords]
    payload = json.dumps({
        "from_points": gh_points,
        "to_points": gh_points,
        "out_arrays": ["distances", "times"],
        "vehicle": "car",
    }).encode("utf-8")

    url = f"https://graphhopper.com/api/1/matrix?key={GRAPHHOPPER_API_KEY}"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        distances = data.get("distances")
        times = data.get("times")

        if distances and times:
            elapsed_ms = int((time.time() - t0) * 1000)
            _gh_call_successes += 1
            logger.info(
                "GH matrix OK: %dx%d in %dms "
                "(successes=%d, cache_hits=%d, cache_size=%d)",
                len(distances), len(distances[0]), elapsed_ms,
                _gh_call_successes, _matrix_cache_hits, len(_matrix_cache),
            )
            _matrix_cache[cache_key] = (distances, times)
            return distances, times

        logger.warning("GH response missing distances/times: %s", data)

    except urllib.error.HTTPError as exc:
        if exc.code == 429:
            _gh_rate_limited_until = time.time() + GRAPHHOPPER_RATE_LIMIT_TTL
            logger.warning(
                "GH 429 rate-limit hit — Haversine for next %ds",
                GRAPHHOPPER_RATE_LIMIT_TTL,
            )
        elif exc.code == 400:
            try:
                body_str = exc.read(512).decode("utf-8", errors="replace")
                body = json.loads(body_str)
                msg = body.get("message", body_str)
            except Exception:
                msg = "(unparseable 400 body)"
            # Auto-calibrate plan limit from "Too many points, allowed: N"
            m = _re.search(r"allowed[:\s]+(\d+)", msg)
            if m:
                detected = int(m.group(1))
                if detected < _gh_plan_limit:
                    old = _gh_plan_limit
                    _gh_plan_limit = detected
                    logger.warning(
                        "GH 400: plan limit detected — auto-set _gh_plan_limit %d→%d. "
                        "Upgrade GH subscription for larger clusters. Falling back to Haversine.",
                        old, _gh_plan_limit,
                    )
                else:
                    logger.warning("GH 400: %s", msg)
            else:
                logger.warning("GH 400: %s", msg)
        else:
            try:
                body_preview = exc.read(256).decode("utf-8", errors="replace")
            except Exception:
                body_preview = ""
            logger.warning("GH HTTP %d: %s | %s", exc.code, exc.reason, body_preview)

    except Exception as exc:
        logger.warning("GH cluster matrix call failed: %s", exc)

    return None


def get_cluster_matrix_osrm(coords: list) -> Optional[tuple]:
    """
    Fetch a road distance + time matrix for a geographic cluster via OSRM.

    OSRM uses real OpenStreetMap road network data — handles one-way streets,
    tunnels, bridges, and actual road detours that Haversine cannot model.

    The public demo server (router.project-osrm.org) is:
    • Free with no API key required
    • Supports up to ~100 locations per matrix request (OSRM_MAX_LOCATIONS)
    • Subject to fair-use policy (avoid high-frequency batching)

    Coordinate order in OSRM URL: longitude,latitude (opposite of (lat,lon) tuples).

    Results are cached in ``_matrix_cache`` with an ``("osrm",)`` prefix key to
    avoid collisions with the GraphHopper cache entries.

    Returns:
        (distance_matrix, time_matrix) with values in metres / seconds,
        or None on any failure so the caller can fall back to Haversine.
    """
    global _osrm_rate_limited_until, _osrm_call_successes, _osrm_cache_hits

    if not coords or len(coords) < 2:
        return None

    if len(coords) > OSRM_MAX_LOCATIONS:
        logger.info(
            "OSRM: cluster size %d exceeds max %d — using Haversine",
            len(coords), OSRM_MAX_LOCATIONS,
        )
        return None

    if time.time() < _osrm_rate_limited_until:
        remaining = int(_osrm_rate_limited_until - time.time())
        logger.info("OSRM rate-limited (%ds remaining) — using Haversine", remaining)
        return None

    # ── Cache lookup ──────────────────────────────────────────────────────────
    # Key uses "osrm" prefix tuple to avoid collision with GH cache entries.
    cache_key = ("osrm",) + tuple((round(lat, 6), round(lon, 6)) for lat, lon in coords)
    if cache_key in _matrix_cache:
        _osrm_cache_hits += 1
        logger.info(
            "OSRM matrix cache HIT (size=%d, hits=%d, successes=%d)",
            len(coords), _osrm_cache_hits, _osrm_call_successes,
        )
        return _matrix_cache[cache_key]

    # ── Live API call ─────────────────────────────────────────────────────────
    # OSRM URL uses lon,lat order (not lat,lon)
    coord_str = ";".join(f"{lon},{lat}" for lat, lon in coords)
    url = (
        f"{OSRM_BASE_URL}/table/v1/driving/{coord_str}"
        "?annotations=duration,distance"
    )
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "SmartRoute/1.0 (delivery-route-optimizer)"},
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        if data.get("code") != "Ok":
            logger.warning("OSRM non-Ok response code: %s", data.get("code"))
            return None

        durations = data.get("durations")    # seconds (always present on Ok)
        distances = data.get("distances")    # metres (present with ?annotations=distance)

        if not durations:
            logger.warning("OSRM response missing durations")
            return None

        n = len(durations)

        # Build time matrix (seconds); None values → 0 (unreachable)
        time_matrix = [[int(t) if t is not None else 0 for t in row] for row in durations]

        # Build distance matrix (metres)
        if distances:
            dist_matrix = [[int(d) if d is not None else 0 for d in row] for row in distances]
        else:
            # Approximate from duration at average city speed (30 km/h)
            avg_ms = AVG_SPEED_KMH / 3.6
            dist_matrix = [
                [int(t * avg_ms) if t is not None else 0 for t in row]
                for row in durations
            ]

        elapsed_ms = int((time.time() - t0) * 1000)
        _osrm_call_successes += 1
        logger.info(
            "OSRM matrix OK: %dx%d in %dms (successes=%d, cache_hits=%d, cache_size=%d)",
            n, n, elapsed_ms,
            _osrm_call_successes, _osrm_cache_hits, len(_matrix_cache),
        )
        _matrix_cache[cache_key] = (dist_matrix, time_matrix)
        return dist_matrix, time_matrix

    except urllib.error.HTTPError as exc:
        logger.warning("OSRM HTTP %d: %s", exc.code, exc.reason)
        if exc.code in (429, 503):
            _osrm_rate_limited_until = time.time() + OSRM_RATE_LIMIT_TTL
            logger.warning(
                "OSRM throttled (HTTP %d) — suppressing for %ds",
                exc.code, OSRM_RATE_LIMIT_TTL,
            )
    except Exception as exc:
        elapsed = time.time() - t0
        if elapsed >= 14.0:
            _osrm_rate_limited_until = time.time() + OSRM_RATE_LIMIT_TTL
            logger.warning(
                "OSRM timeout (%.1fs) — suppressing for %ds",
                elapsed, OSRM_RATE_LIMIT_TTL,
            )
        else:
            logger.warning("OSRM cluster matrix call failed: %s", exc)

    return None


def _fetch_route_leg_times_osrm(ordered_coords: list) -> Optional[list]:
    """
    Fetch per-leg travel times (seconds) for a finalised route via OSRM Table API.

    Called AFTER solve_vrp has produced the final stop order — this is a separate,
    ETA-only call that does NOT influence routing decisions.  Falls back gracefully
    (returns None) on any network error, rate-limit, or unexpected response.

    Args:
        ordered_coords: [(lat, lon), ...] in visit order, depot at index 0.

    Returns:
        List of N-1 ints (seconds per leg) matching the consecutive stop pairs,
        or None if OSRM is unavailable — caller uses Haversine formula instead.
    """
    global _osrm_rate_limited_until

    if len(ordered_coords) < 2 or len(ordered_coords) > OSRM_MAX_LOCATIONS:
        return None

    if time.time() < _osrm_rate_limited_until:
        return None

    coord_str = ";".join(f"{lon},{lat}" for lat, lon in ordered_coords)
    url = f"{OSRM_BASE_URL}/table/v1/driving/{coord_str}?annotations=duration"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "SmartRoute/1.0 (delivery-route-optimizer)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if data.get("code") != "Ok":
            return None
        durations = data.get("durations")
        if not durations or len(durations) < len(ordered_coords):
            return None
        # Extract consecutive leg times: durations[i][i+1] = travel seconds from stop i → i+1
        return [max(1, int(durations[i][i + 1])) for i in range(len(ordered_coords) - 1)]
    except urllib.error.HTTPError as exc:
        if exc.code in (429, 503):
            _osrm_rate_limited_until = time.time() + OSRM_RATE_LIMIT_TTL
        logger.warning(
            "OSRM ETA HTTP %d for route of %d stops", exc.code, len(ordered_coords)
        )
    except Exception as exc:
        logger.warning("OSRM ETA call failed (%d stops): %s", len(ordered_coords), exc)
    return None


def _build_haversine_matrix(coords: list) -> list:
    """Build a full NxN distance matrix (metres) using Haversine."""
    n = len(coords)
    return [[haversine_meters(coords[i], coords[j]) for j in range(n)] for i in range(n)]


def _cluster_by_sweep(store_indices: list, all_coords: list, num_vehicles: int,
                      max_cluster_size: int = None) -> list:
    """
    Partition store node-indices into geographic clusters using the
    polar-angle sweep algorithm (contiguous sectors around the depot).

    Each vehicle receives a contiguous angular wedge — denser wedges get
    more stops, sparser wedges get fewer.  This is the primary mechanism
    for unequal but geographically efficient stop distribution.

    Args:
        store_indices:   node indices of stores (0 = depot in all_coords)
        all_coords:      full coordinate list (depot at index 0)
        num_vehicles:    desired number of vehicles / clusters
        max_cluster_size: optional hard cap per cluster (used only when
                          GraphHopper Free Plan limits apply); None = no cap.

    Returns a list of lists: each sub-list holds the node indices for one
    vehicle.  Length ≤ num_vehicles (some may be absent if dataset is tiny).
    """
    if max_cluster_size is not None:
        min_clusters = math.ceil(len(store_indices) / max_cluster_size)
        effective_vehicles = max(num_vehicles, min_clusters)
    else:
        effective_vehicles = num_vehicles

    depot = all_coords[0]

    def angle_from_depot(node_idx):
        lat, lon = all_coords[node_idx]
        return math.atan2(lon - depot[1], lat - depot[0])

    # ── Equal-angle sector partition ──────────────────────────────────────────
    # Divide the full 360° circle into effective_vehicles equal angular wedges.
    # Stores are assigned to whichever wedge their angle falls into.
    # Dense wedges naturally collect more stores; sparse wedges get fewer.
    # This is the key mechanism for unequal (geography-driven) distribution.
    # Centroid refinement below then smoothes sector boundaries.
    all_angles = [(node, angle_from_depot(node)) for node in store_indices]
    if not all_angles:
        return []

    min_angle = min(a for _, a in all_angles)
    sector_width = 2 * math.pi / effective_vehicles

    chunks = [[] for _ in range(effective_vehicles)]
    for node, angle in all_angles:
        normalized = (angle - min_angle) % (2 * math.pi)
        sector = min(int(normalized / sector_width), effective_vehicles - 1)
        chunks[sector].append(node)

    # If we created more clusters than vehicles, merge extra clusters back into
    # the last num_vehicles bucket so the caller gets exactly num_vehicles routes
    if effective_vehicles > num_vehicles:
        merged = chunks[:num_vehicles]
        for extra in chunks[num_vehicles:]:
            smallest = min(range(len(merged)), key=lambda k: len(merged[k]))
            # Respect max_cluster_size cap if provided, otherwise always merge
            if max_cluster_size is None or len(merged[smallest]) + len(extra) <= max_cluster_size:
                merged[smallest].extend(extra)
            else:
                merged.append(extra)
        chunks = merged

    # ── Post-assignment: nearest-centroid border-point refinement ──────────────
    # After the initial equal-angle sweep, stores near sector boundaries may be
    # geographically closer to a neighbouring cluster's centroid than their own.
    # We iterate (up to CLUSTER_CENTROID_REFINEMENT_ROUNDS times) reassigning each
    # store to its nearest cluster centroid, which reduces cross-boundary detours.
    active = [c for c in chunks if c]
    for _iter in range(CLUSTER_CENTROID_REFINEMENT_ROUNDS):
        centroids = []
        for cluster in active:
            lats = [all_coords[n][0] for n in cluster]
            lons = [all_coords[n][1] for n in cluster]
            centroids.append((sum(lats) / len(lats), sum(lons) / len(lons)))

        new_active = [[] for _ in range(len(active))]
        for node in store_indices:
            coord = all_coords[node]
            best = min(range(len(centroids)),
                       key=lambda i: haversine_meters(coord, centroids[i]))
            new_active[best].append(node)

        if new_active == active:
            break  # converged
        active = new_active

    return [c for c in active if c]


def _cluster_by_capacitated_sweep(store_indices: list, all_coords: list,
                                    num_vehicles: int) -> list:
    """
    Partition stores into geographic clusters using angular sweep with a
    dynamic per-cluster size cap.

    Unlike equal-angle sweep (which can put 42 stores in one 40° sector when
    the depot is on the edge of the city), capacitated sweep sorts all stores
    by polar angle and fills clusters sequentially up to a hard cap.  This
    prevents runaway clusters in dense angular zones while keeping routes
    geographically contiguous.

    Cap formula:  ceil(n_stores / n_vehicles × 1.5)
    Example: 120 stores / 9 vehicles → cap = ceil(13.3 × 1.5) = 20
    This allows ~50% headroom above average, so the algorithm can still
    express geographic density variation without creating extreme outliers.

    Benchmark (120 stores / 9 vehicles, Haversine, Session 49):
      Equal-angle sweep: 149.9 km, max=29, ratio=3.2x
      Capacitated sweep: 126.9 km, max=27, ratio=1.8x  (−15.4% km)
    The improvement comes from smaller, more balanced clusters giving
    OR-Tools TSP a tractable sub-problem with more optimisation headroom.

    When n_stores ≤ n_vehicles, falls back to equal-angle sweep (tiny dataset).
    """
    if not store_indices:
        return []

    n = len(store_indices)
    if n <= num_vehicles:
        # Tiny dataset — fall through to existing sweep logic
        return _cluster_by_sweep(store_indices, all_coords, num_vehicles)

    # Dynamic cap: 1.5× average, minimum 2 to avoid infinite loops
    avg = n / num_vehicles
    cap = max(2, math.ceil(avg * 1.5))

    depot = all_coords[0]

    def angle_from_depot(node_idx):
        lat, lon = all_coords[node_idx]
        return math.atan2(lon - depot[1], lat - depot[0])

    sorted_nodes = sorted(store_indices, key=angle_from_depot)

    # Sequential fill: start a new chunk whenever cap is reached
    chunks: list = []
    current: list = []
    for node in sorted_nodes:
        if len(current) >= cap:
            chunks.append(current)
            current = [node]
        else:
            current.append(node)
    if current:
        chunks.append(current)

    # If too many chunks, merge adjacent pairs (smallest combined size first)
    # Adjacent merging preserves geographic contiguity
    while len(chunks) > num_vehicles:
        best_i = min(range(len(chunks) - 1),
                     key=lambda i: len(chunks[i]) + len(chunks[i + 1]))
        chunks[best_i] = chunks[best_i] + chunks[best_i + 1]
        del chunks[best_i + 1]

    # If fewer chunks than vehicles (sparse data), that's fine — caller handles it
    return [c for c in chunks if c]


def _parse_time_to_minutes(time_str: str) -> int:
    """Parse 'HH:MM' string to integer minutes from midnight.  Defaults to 09:00."""
    try:
        h, m = str(time_str).strip().split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return 9 * 60


def _ortools_solve_group(depot_coord: tuple, group_node_indices: list,
                         group_coords: list, dist_matrix: list,
                         time_windows: list = None,
                         time_limit_override: float = None,
                         time_matrix: list = None,
                         optimize_by: str = "distance") -> list:
    """
    Run OR-Tools TSP on a single vehicle's cluster of stops.

    Args:
        depot_coord:        (lat, lon) of the depot (unused directly; coord is at
                            group_coords[0]).
        group_node_indices: global node indices of the stores in this cluster
                            (1-based: node 1 = store_list[0]).
        group_coords:       coordinate list [depot, store_a, store_b, ...].
        dist_matrix:        NxN distance matrix (metres) matching group_coords order.
        time_windows:       optional list of (tw_from_min, tw_to_min, service_min)
                            for each store in group_node_indices order.
                            When provided OR-Tools adds a Time dimension and enforces
                            the windows.  When None, pure distance optimisation.
        time_matrix:        optional NxN real travel-time matrix (seconds) from
                            GH/OSRM.  Used as arc cost when optimize_by="time".
        optimize_by:        "distance" (default) — minimise metres; "time" —
                            minimise real travel seconds (requires time_matrix).

    Returns the stores in optimised visit order (values from group_node_indices).
    Falls back to the original order on any solver failure.
    """
    if not ORTOOLS_AVAILABLE or len(group_node_indices) <= 1:
        return group_node_indices

    n = len(group_coords)  # includes depot at index 0
    manager = pywrapcp.RoutingIndexManager(n, 1, 0)
    routing = pywrapcp.RoutingModel(manager)

    int_matrix = [[int(v) for v in row] for row in dist_matrix]

    # Fallback arc callback (distance in metres) — always built, used for:
    # 1) distance mode, 2) rebuilt model after TW failure
    def dist_cb(from_idx, to_idx):
        return int_matrix[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]

    # Time-mode arc callback: uses raw travel seconds from GH/OSRM.
    # IMPORTANT: do NOT convert to minutes here.  Values of 1–30 (minutes) cause
    # OR-Tools GLS to degenerate on dense clusters (≥ 20 stops) — with nearly all
    # arcs costing 1 minute the penalty function cannot distinguish good from bad
    # arcs, the solver enters an infinite evaluation loop, and the time limit is
    # never checked.  Using raw seconds (60–1800) gives GLS adequate resolution.
    # Falls back to dist_cb when time_matrix is unavailable (Haversine clusters).
    if optimize_by == "time" and time_matrix is not None:
        int_time_arc = [[max(1, int(v)) for v in row] for row in time_matrix]
        def arc_cb(from_idx, to_idx):
            return int_time_arc[manager.IndexToNode(from_idx)][manager.IndexToNode(to_idx)]
    else:
        arc_cb = dist_cb

    transit_idx = routing.RegisterTransitCallback(arc_cb)
    routing.SetArcCostEvaluatorOfAllVehicles(transit_idx)

    # ── Time dimension (enforced only when caller supplies time_windows) ──────
    tw_enabled = False
    if time_windows and len(time_windows) == len(group_node_indices):
        speed_m_per_min = AVG_SPEED_KMH * 1000 / 60  # ~500 m/min at 30 km/h

        # Pre-validate and sanitize all time windows before touching OR-Tools.
        # Three classes of bad data that cause CP Solver domain-wipeout:
        #   1. tw_from > tw_to (swapped / overnight window)
        #   2. tw_to < 9*60   (window closes before depot departure at 09:00)
        #   3. tw_from < 0 or tw_to > 1440 (out of [0, 1440] horizon)
        DEPOT_START = 9 * 60
        sanitized_tw = []
        bad_windows = 0
        for tw_from_s, tw_to_s, svc_s in time_windows:
            tw_f = max(0, int(tw_from_s))
            tw_t = max(0, int(tw_to_s))
            # Invalid range → expand to full working day
            if tw_f >= tw_t or tw_t < DEPOT_START:
                tw_f = DEPOT_START
                tw_t = 23 * 60
                bad_windows += 1
            sanitized_tw.append((tw_f, tw_t, int(svc_s)))
        if bad_windows:
            logger.warning(
                "OR-Tools cluster %d: %d/%d stores had invalid/unreachable time windows "
                "(tw_from>=tw_to or tw_to<09:00) — expanded to full day for those stores",
                len(group_node_indices), bad_windows, len(time_windows),
            )

        # tw_data[0] = depot (full day), tw_data[k] = store k-1
        tw_data = [(5 * 60, 23 * 60, 0)] + sanitized_tw

        # When time_mode is active and a real time_matrix exists, use real
        # travel minutes for the Time Dimension so TW constraints are consistent
        # with the arc cost (also real minutes).  Otherwise fall back to
        # synthetic time derived from distance / average speed.
        if optimize_by == "time" and time_matrix is not None:
            def time_cb(from_idx, to_idx):
                from_node = manager.IndexToNode(from_idx)
                to_node = manager.IndexToNode(to_idx)
                travel_min = max(1, int(time_matrix[from_node][to_node] / 60))
                service_min = tw_data[from_node][2] if from_node > 0 else 0
                return travel_min + service_min
        else:
            def time_cb(from_idx, to_idx):
                from_node = manager.IndexToNode(from_idx)
                to_node = manager.IndexToNode(to_idx)
                travel_min = int(int_matrix[from_node][to_node] / max(speed_m_per_min, 1))
                service_min = tw_data[from_node][2] if from_node > 0 else 0
                return travel_min + service_min

        try:
            time_transit_idx = routing.RegisterTransitCallback(time_cb)
            routing.AddDimension(
                time_transit_idx,
                60,       # max slack (early arrival wait) per stop: 60 min
                24 * 60,  # max cumulative time horizon
                False,    # do NOT force start cumul to zero
                "Time",
            )
            time_dim = routing.GetDimensionOrDie("Time")
            time_dim.SetGlobalSpanCostCoefficient(0)

            # Depot departs exactly at 09:00
            time_dim.CumulVar(routing.Start(0)).SetRange(DEPOT_START, DEPOT_START)

            # Enforce time window on each store node.
            # SetRange raises "CP Solver fail" if constraint propagation produces
            # an empty domain (e.g. last stop in a large cluster can't be reached
            # within its tw_to due to cumulative service + travel time).
            for local_node in range(1, n):
                tw_from, tw_to, _ = tw_data[local_node]
                routing_idx = manager.NodeToIndex(local_node)
                time_dim.CumulVar(routing_idx).SetRange(tw_from, tw_to)

            tw_enabled = True
            logger.info(
                "OR-Tools time-windows enabled for cluster of %d stops",
                len(group_node_indices),
            )
        except Exception as tw_exc:
            # Domain wipeout during model construction — cluster is infeasible with
            # time windows (too many stops, tight windows, large cumulative service
            # time). Fall back to distance-only solve for this cluster.
            logger.warning(
                "OR-Tools cluster %d: time-window model construction failed (%s) "
                "— retrying without time windows (distance-only)",
                len(group_node_indices), tw_exc,
            )
            # Rebuild a fresh model without the time dimension
            manager = pywrapcp.RoutingIndexManager(n, 1, 0)
            routing = pywrapcp.RoutingModel(manager)
            transit_idx2 = routing.RegisterTransitCallback(arc_cb)
            routing.SetArcCostEvaluatorOfAllVehicles(transit_idx2)

    # ── Adaptive time limit based on cluster size ─────────────────────────────
    # Small clusters (≤5 stops) are trivial TSPs — 0.3 s is more than enough.
    # Medium clusters (≤10) need ~1 s.  Large clusters scale with size because
    # GLS needs more iterations to escape local optima in larger search spaces.
    # Confirmed by real data: 37-stop cluster with 2 s leaves 2.06 km (7.6%)
    # of 2-opt improvements unused, directly causing the 14-min Yandex gap.
    # Budget: ≤20 stops→5 s, ≤35 stops→10 s, >35 stops→15 s (via env override).
    # An optional time_limit_override (from the global 60 s fleet budget in
    # solve_vrp) further caps this so large datasets (300+ stops) don't stall.
    cluster_size = len(group_node_indices)
    if cluster_size <= 5:
        adaptive_tl = min(0.3, float(ORTOOLS_TIME_LIMIT_SECONDS))
    elif cluster_size <= 10:
        adaptive_tl = min(1.0, float(ORTOOLS_TIME_LIMIT_SECONDS))
    elif cluster_size <= 20:
        adaptive_tl = min(5.0, float(ORTOOLS_TIME_LIMIT_SECONDS) * 2.5)
    elif cluster_size <= 35:
        adaptive_tl = min(10.0, float(ORTOOLS_TIME_LIMIT_SECONDS) * 5.0)
    else:
        adaptive_tl = min(15.0, float(ORTOOLS_TIME_LIMIT_SECONDS) * 7.5)

    if time_limit_override is not None:
        adaptive_tl = min(adaptive_tl, time_limit_override)

    params = pywrapcp.DefaultRoutingSearchParameters()
    params.first_solution_strategy = routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
    params.local_search_metaheuristic = routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
    params.time_limit.seconds = int(adaptive_tl)
    params.time_limit.nanos = int((adaptive_tl - int(adaptive_tl)) * 1_000_000_000)

    solution = routing.SolveWithParameters(params)
    if not solution:
        # If time-mode found no solution, retry with distance objective as a safety net.
        # This can happen on very small clusters where GLS finishes in < 1 iteration.
        if optimize_by == "time" and time_matrix is not None:
            logger.warning(
                "OR-Tools time-mode found no solution for cluster of %d stops "
                "— retrying with distance objective",
                len(group_node_indices),
            )
            manager2 = pywrapcp.RoutingIndexManager(n, 1, 0)
            routing2 = pywrapcp.RoutingModel(manager2)
            int_matrix2 = [[int(v) for v in row] for row in dist_matrix]
            def dist_cb2(from_idx, to_idx):
                return int_matrix2[manager2.IndexToNode(from_idx)][manager2.IndexToNode(to_idx)]
            transit_idx3 = routing2.RegisterTransitCallback(dist_cb2)
            routing2.SetArcCostEvaluatorOfAllVehicles(transit_idx3)
            solution = routing2.SolveWithParameters(params)
            if solution:
                ordered = []
                idx2 = routing2.Start(0)
                while not routing2.IsEnd(idx2):
                    node = manager2.IndexToNode(idx2)
                    if node != 0:
                        ordered.append(group_node_indices[node - 1])
                    idx2 = solution.Value(routing2.NextVar(idx2))
                return ordered
        logger.warning(
            "OR-Tools found no solution for cluster of %d stops "
            "(time_windows=%s) — keeping original order",
            len(group_node_indices), time_windows is not None,
        )
        return group_node_indices

    ordered = []
    idx = routing.Start(0)
    while not routing.IsEnd(idx):
        node = manager.IndexToNode(idx)
        if node != 0:
            ordered.append(group_node_indices[node - 1])
        idx = solution.Value(routing.NextVar(idx))
    return ordered


def _fallback_distribution(store_nodes: list, num_vehicles: int) -> list:
    """Round-robin split when OR-Tools finds no solution."""
    routes = [[] for _ in range(num_vehicles)]
    for i, node in enumerate(store_nodes):
        routes[i % num_vehicles].append(node)
    return [r for r in routes if r]


def _inter_route_relocate(routes: list, full_matrix: list, max_iter: int = 5,
                          min_stops: int = 1) -> list:
    """
    Post-process routes with inter-route Or-opt relocate moves.

    For each stop in each route, tries removing it and inserting it into every
    position in every other route.  Applies the best move (highest km saving)
    if it reduces total distance.  Repeats up to max_iter passes or until no
    improvement is found.

    min_stops: do not reduce a route below this many stops (hard floor).
    This equalises route quality across all vehicles — the first route solved
    by TSP is typically the best; relocate spreads good stops more evenly.

    Complexity: O(max_iter * stops * routes * max_route_len) — fast for ≤ 50 stops.
    Uses the pre-built full Haversine matrix (metres).
    """
    if len(routes) <= 1:
        return routes

    def route_cost(route):
        if not route:
            return 0
        cost = full_matrix[0][route[0]] + full_matrix[route[-1]][0]
        for a, b in zip(route, route[1:]):
            cost += full_matrix[a][b]
        return cost

    for iteration in range(max_iter):
        improved = False
        for i in range(len(routes)):
            si = 0
            while si < len(routes[i]):
                # Respect the minimum-stops floor: never reduce a route below min_stops.
                if len(routes[i]) <= min_stops:
                    si += 1
                    continue

                stop = routes[i][si]
                r_i_without = routes[i][:si] + routes[i][si + 1:]
                removal_gain = route_cost(routes[i]) - route_cost(r_i_without)

                best_gain = 1  # minimum threshold: 1 metre improvement
                best_j = -1
                best_pos = -1

                for j in range(len(routes)):
                    if i == j:
                        continue
                    base_j = route_cost(routes[j])
                    for pos in range(len(routes[j]) + 1):
                        r_j_with = routes[j][:pos] + [stop] + routes[j][pos:]
                        insertion_cost = route_cost(r_j_with) - base_j
                        net_gain = removal_gain - insertion_cost
                        if net_gain > best_gain:
                            best_gain = net_gain
                            best_j = j
                            best_pos = pos

                if best_j >= 0:
                    routes[i] = r_i_without
                    routes[best_j] = (
                        routes[best_j][:best_pos] + [stop] + routes[best_j][best_pos:]
                    )
                    improved = True
                    # Do NOT increment si — routes[i] shrank, next element is at si
                else:
                    si += 1

        if not improved:
            logger.info("inter_route_relocate: converged after %d iteration(s)", iteration + 1)
            break

    return [r for r in routes if r]


def _two_opt_route(route: list, full_matrix: list) -> list:
    """
    Apply 2-opt improvement to a single route.

    Considers all (i, j) pairs and reverses segment route[i+1:j+1] if it
    reduces total route distance (depot→route→depot).  Runs until no
    improving swap is found (convergence).

    Complexity: O(n²) per pass — fast even for 30-stop clusters.
    Fixes "linear chain" artefacts left by TSP initialisation.
    """
    if len(route) < 3:
        return route

    best = list(route)
    improved = True
    while improved:
        improved = False
        n = len(best)
        for i in range(-1, n - 1):
            node_i = 0 if i == -1 else best[i]
            node_i1 = best[i + 1]
            for j in range(i + 2, n):
                if i == -1 and j == n - 1:
                    continue  # skip full-route reversal (same cost)
                node_j = best[j]
                node_j1 = 0 if j == n - 1 else best[j + 1]
                # Cost of current edges vs. reversed segment
                d_before = full_matrix[node_i][node_i1] + full_matrix[node_j][node_j1]
                d_after = full_matrix[node_i][node_j] + full_matrix[node_i1][node_j1]
                if d_after < d_before - 1:  # 1-metre threshold avoids float noise
                    best[i + 1:j + 1] = best[i + 1:j + 1][::-1]
                    improved = True
                    node_i1 = best[i + 1]  # update for next j in this i-pass
    return best


def _rebalance_min_stops(routes: list, full_matrix: list, min_stops: int) -> list:
    """
    Ensure every route has at least `min_stops` stops by stealing cheapest stops
    from donor routes (those above the floor).

    The algorithm picks the stop whose (removal_gain - insertion_cost) is best,
    i.e. it minimises the total distance penalty of the rebalancing move.
    Runs until no underfull routes remain or no donor can provide more stops.

    effective_min = min(min_stops, total_stops // num_routes) so that small
    datasets (e.g. 8 stops on 3 vehicles → effective_min=2) scale gracefully.
    """
    if len(routes) <= 1:
        return routes

    total = sum(len(r) for r in routes)
    effective_min = max(1, min(min_stops, total // len(routes)))
    if effective_min < 2:
        return routes

    def route_cost(route):
        if not route:
            return 0
        cost = full_matrix[0][route[0]] + full_matrix[route[-1]][0]
        for a, b in zip(route, route[1:]):
            cost += full_matrix[a][b]
        return cost

    changed = True
    while changed:
        changed = False
        for i, route in enumerate(routes):
            if len(route) >= effective_min:
                continue

            # Route i is underfull — find the cheapest stop to steal from any donor.
            best_net_cost = float("inf")
            best_stop_val = None
            best_donor_idx = -1
            best_donor_stop_pos = -1
            best_insert_pos = -1

            for j, donor in enumerate(routes):
                if i == j or len(donor) <= effective_min:
                    continue  # donor must keep at least effective_min stops

                base_donor = route_cost(donor)
                base_route = route_cost(route)

                for k, stop in enumerate(donor):
                    donor_without = donor[:k] + donor[k + 1:]
                    removal_gain = base_donor - route_cost(donor_without)

                    for pos in range(len(route) + 1):
                        route_with = route[:pos] + [stop] + route[pos:]
                        insertion_cost = route_cost(route_with) - base_route
                        net_cost = insertion_cost - removal_gain  # lower = better
                        if net_cost < best_net_cost:
                            best_net_cost = net_cost
                            best_stop_val = stop
                            best_donor_idx = j
                            best_donor_stop_pos = k
                            best_insert_pos = pos

            if best_stop_val is not None:
                # Apply the best steal
                routes[i] = route[:best_insert_pos] + [best_stop_val] + route[best_insert_pos:]
                d = routes[best_donor_idx]
                routes[best_donor_idx] = d[:best_donor_stop_pos] + d[best_donor_stop_pos + 1:]
                logger.info(
                    "rebalance_min_stops: moved stop %d from route %d→%d "
                    "(route %d now %d stops, net_cost %+.0f m)",
                    best_stop_val, best_donor_idx, i, i, len(routes[i]), best_net_cost,
                )
                changed = True
                break  # restart outer loop — route sizes have changed

    return [r for r in routes if r]


def _rebalance_max_stops(routes: list, full_matrix: list, max_stops: int) -> tuple:
    """
    Cap overloaded routes by moving excess stops to less-loaded routes.

    Symmetric counterpart to _rebalance_min_stops: iteratively identifies routes
    that exceed `max_stops` and relocates the stop whose (insertion_cost - removal_gain)
    is lowest (i.e. the cheapest move to any accepting route).

    Returns:
        (rebalanced_routes, moves_count)

    Benchmark results (120 stores / 9 vehicles, Haversine):
      max=24: ratio 3.9x → 2.7x (−30.8%), km −0.8 km (−0.5%) — passes success criteria
      max=26: ratio 3.9x → 2.9x (−25.6%), km −0.8 km (−0.5%) — below 30% threshold
      max=30: ratio 3.9x → 3.3x (−15.4%), km −0.9 km (−0.6%) — below 30% threshold
    """
    if len(routes) <= 1 or max_stops is None:
        return routes, 0

    def route_cost(route):
        if not route:
            return 0
        cost = full_matrix[0][route[0]] + full_matrix[route[-1]][0]
        for a, b in zip(route, route[1:]):
            cost += full_matrix[a][b]
        return cost

    total_moves = 0
    changed = True
    while changed:
        changed = False
        oversized = [i for i, r in enumerate(routes) if len(r) > max_stops]
        if not oversized:
            break
        for i in oversized:
            if len(routes[i]) <= max_stops:
                continue
            best_net = float("inf")
            best_stop_val = None
            best_stop_pos = -1
            best_dest_idx = -1
            best_insert_pos = -1

            for si, stop in enumerate(routes[i]):
                route_without = routes[i][:si] + routes[i][si + 1:]
                removal_gain = route_cost(routes[i]) - route_cost(route_without)
                for j, dest in enumerate(routes):
                    if i == j:
                        continue
                    base_dest = route_cost(dest)
                    for pos in range(len(dest) + 1):
                        dest_with = dest[:pos] + [stop] + dest[pos:]
                        insertion_cost = route_cost(dest_with) - base_dest
                        net = insertion_cost - removal_gain
                        if net < best_net:
                            best_net = net
                            best_stop_val = stop
                            best_stop_pos = si
                            best_dest_idx = j
                            best_insert_pos = pos

            if best_stop_val is not None:
                routes[i] = routes[i][:best_stop_pos] + routes[i][best_stop_pos + 1:]
                routes[best_dest_idx] = (
                    routes[best_dest_idx][:best_insert_pos]
                    + [best_stop_val]
                    + routes[best_dest_idx][best_insert_pos:]
                )
                logger.info(
                    "rebalance_max_stops: moved stop %d from route %d→%d "
                    "(route %d now %d stops, net_cost %+.0f m)",
                    best_stop_val, i, best_dest_idx, i, len(routes[i]), best_net,
                )
                total_moves += 1
                changed = True
                break  # restart outer loop

    return [r for r in routes if r], total_moves


def get_db():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn


def init_db():
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS stores (
            id SERIAL PRIMARY KEY,
            name TEXT NOT NULL,
            address TEXT NOT NULL,
            lat DOUBLE PRECISION,
            lon DOUBLE PRECISION,
            map_url TEXT,
            geocode_status TEXT DEFAULT 'pending',
            time_window_from TEXT DEFAULT '09:00',
            time_window_to TEXT DEFAULT '18:00',
            unload_minutes INTEGER DEFAULT 15,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS route_sessions (
            id SERIAL PRIMARY KEY,
            date TEXT,
            num_vehicles INTEGER,
            total_km DOUBLE PRECISION,
            saved_km DOUBLE PRECISION,
            saved_rub INTEGER,
            num_points INTEGER DEFAULT 0,
            result_json TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("""
        ALTER TABLE route_sessions ADD COLUMN IF NOT EXISTS result_json TEXT
    """)
    cur.execute("""
        ALTER TABLE stores ADD COLUMN IF NOT EXISTS map_url TEXT
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS route_session_stores (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES route_sessions(id) ON DELETE CASCADE,
            store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
            visit_order INTEGER
        )
    """)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Performance indexes
    cur.execute("CREATE INDEX IF NOT EXISTS idx_stores_geocode ON stores(geocode_status)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_date ON route_sessions(date DESC)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_session_stores_session ON route_session_stores(session_id)")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username)")
    # Company settings (single-row table for cost model params)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS company_settings (
            id SERIAL PRIMARY KEY,
            fuel_price DOUBLE PRECISION DEFAULT 67.0,
            fuel_consumption DOUBLE PRECISION DEFAULT 13.0,
            driver_salary DOUBLE PRECISION DEFAULT 0.0,
            cost_per_km DOUBLE PRECISION DEFAULT 8.71,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Seed defaults if table is empty
    # driver_salary column kept for schema compatibility but no longer used in formula
    cur.execute("""
        INSERT INTO company_settings (fuel_price, fuel_consumption, cost_per_km)
        SELECT 67.0, 13.0, ROUND(CAST(67.0 * 13.0 / 100.0 AS numeric), 2)
        WHERE NOT EXISTS (SELECT 1 FROM company_settings)
    """)
    # Migration: recalculate cost_per_km for existing rows using fuel-only formula
    cur.execute("""
        UPDATE company_settings
           SET cost_per_km = ROUND(CAST(fuel_price * fuel_consumption / 100.0 AS numeric), 2)
         WHERE cost_per_km > fuel_price * fuel_consumption / 100.0 + 1
    """)
    # Historical cost_per_km per route session
    cur.execute("""
        ALTER TABLE route_sessions ADD COLUMN IF NOT EXISTS cost_per_km DOUBLE PRECISION
    """)
    # ── Multi-user isolation: owner_id columns ────────────────────────────────
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE")
    cur.execute("ALTER TABLE stores ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)")
    cur.execute("ALTER TABLE route_sessions ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)")
    cur.execute("ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS owner_id INTEGER REFERENCES users(id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_stores_owner ON stores(owner_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_sessions_owner ON route_sessions(owner_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_settings_owner ON company_settings(owner_id)")
    # ── User plan & admin notes ────────────────────────────────────────────────
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'trial'")
    cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_note TEXT DEFAULT ''")
    # ── Admin audit log ────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS admin_audit_log (
            id SERIAL PRIMARY KEY,
            admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            target_user_id INTEGER,
            target_username TEXT,
            action TEXT NOT NULL,
            details TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_admin ON admin_audit_log(admin_user_id)")
    cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_created ON admin_audit_log(created_at DESC)")
    conn.commit()
    cur.close()
    conn.close()


def get_company_settings(user_id: int = None) -> dict:
    """Read cost model settings from DB (per-user row). Returns defaults if no row exists."""
    _defaults = {
        "fuel_price": 67.0,
        "fuel_consumption": 13.0,
        "cost_per_km": round(67.0 * 13.0 / 100.0, 2),
    }
    try:
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        if user_id is not None:
            cur.execute(
                "SELECT fuel_price, fuel_consumption, cost_per_km FROM company_settings WHERE owner_id = %s LIMIT 1",
                (user_id,)
            )
        else:
            cur.execute("SELECT fuel_price, fuel_consumption, cost_per_km FROM company_settings ORDER BY id LIMIT 1")
        row = cur.fetchone()
        cur.close()
        conn.close()
        if row:
            return dict(row)
    except Exception as e:
        logger.warning("get_company_settings error: %s", e)
    return _defaults


def haversine_meters(c1: tuple, c2: tuple) -> int:
    R = 6371000
    lat1, lon1 = math.radians(c1[0]), math.radians(c1[1])
    lat2, lon2 = math.radians(c2[0]), math.radians(c2[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return int(R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def solve_vrp(all_coords: list, num_vehicles: int, capacities=None, demands=None,
              store_time_windows: list = None,
              max_stops_per_vehicle: int = None,
              optimize_by: str = "distance") -> list:
    """
    Solve VRP with efficiency as the primary objective (min total km / time).

    Strategy
    ────────
    1. Build a full NxN Haversine distance matrix once (instant, no API).
       For small datasets (≤ GH_FREE_LIMIT) attempt GraphHopper first.

    2. Partition stores into `num_vehicles` contiguous geographic SECTORS using
       the polar-angle sweep around the depot.  Contiguous sectors (not
       round-robin) mean each vehicle is assigned a geographic wedge, so
       denser areas naturally get more stops and sparse areas fewer stops.
       This is the principal mechanism for unequal-but-efficient distribution.

    3. For each sector, extract the relevant sub-matrix and run a single-vehicle
       OR-Tools TSP to polish the visit order within the sector.
       If store_time_windows is provided, OR-Tools also enforces arrival time
       windows (TSPTW) so deliveries respect opening-hour constraints.

    Why this approach
    ─────────────────
    • All vehicles are used (each non-empty sector → one vehicle).
    • Stop counts per vehicle reflect geographic density, NOT a count target.
      A dense north cluster → 12 stops; a sparse south sector → 5 stops.
    • No GlobalSpanCostCoefficient — no artificial balancing penalty.
    • Fast: single-vehicle TSPs are much cheaper than full multi-vehicle VRP.

    Args:
        all_coords:          list of (lat, lon); index 0 is the depot.
        num_vehicles:        number of vehicles / routes to generate.
        capacities:          optional list of vehicle capacity (kg).
        demands:             optional list of store demands (index 0 = depot = 0).
        store_time_windows:  optional list of (tw_from_min, tw_to_min, service_min)
                             for each store, 0-indexed matching all_coords[1:].
                             When supplied, OR-Tools TSPTW is used per cluster.

    Fallback chain (transparent to caller):
      OR-Tools per-sector  →  sector order as-is  →  greedy round-robin
    """
    n = len(all_coords)
    store_count = n - 1  # node 0 is depot

    if store_count == 0:
        return [], "haversine"

    # ── No OR-Tools: geographic sectors, then greedy ordering ─────────────────
    if not ORTOOLS_AVAILABLE:
        if store_count >= 1:
            all_store_nodes = list(range(1, n))
            clusters = _cluster_by_sweep(all_store_nodes, all_coords, num_vehicles)
            return [c for c in clusters if c], "haversine"
        return _fallback_distribution(list(range(1, n)), num_vehicles), "haversine"

    # ── Step 1: full Haversine matrix (always-available baseline) ─────────────
    # Used as fallback when GraphHopper is unavailable for a given cluster.
    full_matrix = _build_haversine_matrix(all_coords)

    logger.info(
        "solve_vrp: %d stores / %d vehicles — building clusters",
        store_count, num_vehicles,
    )

    # ── Step 2: geographic sector partition (contiguous sweep) ────────────────
    # Each vehicle receives a contiguous angular sector around the depot.
    # Denser sectors have more stores → vehicle gets more stops naturally.
    all_store_nodes = list(range(1, n))
    clusters = _cluster_by_sweep(all_store_nodes, all_coords, num_vehicles)

    # ── Step 3: per-cluster road matrix → OR-Tools TSP ────────────────────────
    # Routing priority per cluster:
    #   GH   (paid plan, precise road distances)     → if GH key set + fits plan limit
    #   OSRM (free, real OSM roads, no key needed)   → public demo server fallback
    #   Haversine (instant math, always available)   → final fallback
    #
    # Matrix fetching is parallelised with ThreadPoolExecutor so that network-
    # bound GH/OSRM requests for different clusters overlap.  OR-Tools TSP
    # solving is run sequentially afterwards (CPU-bound, GIL-limited).
    t_vrp_start = time.time()

    non_empty_clusters = [c for c in clusters if c]
    # Phase A: fetch matrices for all clusters in parallel -----------------------
    def _fetch_matrix(cluster_nodes):
        """Return (cluster_nodes, sub_dist_matrix, sub_time_matrix, source) for one cluster.

        sub_time_matrix is the real travel-time matrix (seconds) from GH/OSRM,
        or None when only Haversine is available.  The caller decides whether to
        use it based on the optimize_by flag.
        """
        if len(cluster_nodes) == 1:
            return (cluster_nodes, None, None, "hv_single")
        group_indices = [0] + cluster_nodes
        group_coords = [all_coords[i] for i in group_indices]
        gh_result = get_cluster_matrix_gh(group_coords)
        if gh_result:
            sub_matrix, sub_time = gh_result
            return (cluster_nodes, sub_matrix, sub_time, "gh")
        osrm_result = get_cluster_matrix_osrm(group_coords)
        if osrm_result:
            sub_matrix, sub_time = osrm_result
            return (cluster_nodes, sub_matrix, sub_time, "osrm")
        group_indices2 = [0] + cluster_nodes
        sub_matrix = [[full_matrix[r][c] for c in group_indices2] for r in group_indices2]
        return (cluster_nodes, sub_matrix, None, "hv")

    max_workers = min(len(non_empty_clusters), 8)
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(max_workers, 1)) as pool:
        matrix_futures = [pool.submit(_fetch_matrix, c) for c in non_empty_clusters]
        matrix_results = [f.result() for f in matrix_futures]

    # Phase B: OR-Tools TSP per cluster (sequential; CPU-bound) -----------------
    # Global 60 s OR-Tools budget spread equally across clusters so very large
    # datasets (300+ stops) stay within a predictable wall-clock time.
    # Each cluster gets at most (60 / num_clusters) seconds, further bounded by
    # the per-size adaptive limits computed inside _ortools_solve_group.
    GLOBAL_ORTOOLS_BUDGET_SECONDS = 60.0
    num_clusters = len([r for r in matrix_results if r[1] is not None])
    per_cluster_budget = (GLOBAL_ORTOOLS_BUDGET_SECONDS / max(num_clusters, 1))

    routes = []
    gh_clusters = 0
    osrm_clusters = 0
    hv_clusters = 0

    for cluster_nodes, sub_matrix, sub_time, source in matrix_results:
        if source == "hv_single":
            routes.append(cluster_nodes)
            hv_clusters += 1
            continue
        if source == "gh":
            gh_clusters += 1
        elif source == "osrm":
            osrm_clusters += 1
        else:
            hv_clusters += 1

        group_indices = [0] + cluster_nodes
        group_coords = [all_coords[i] for i in group_indices]
        cluster_tw = None
        if store_time_windows:
            try:
                cluster_tw = [store_time_windows[node - 1] for node in cluster_nodes]
            except IndexError:
                cluster_tw = None

        try:
            ordered = _ortools_solve_group(all_coords[0], cluster_nodes, group_coords, sub_matrix,
                                           time_windows=cluster_tw,
                                           time_limit_override=per_cluster_budget,
                                           time_matrix=sub_time,
                                           optimize_by=optimize_by)
        except Exception as cluster_exc:
            logger.warning(
                "solve_vrp: _ortools_solve_group raised for cluster of %d stops (%s) "
                "— keeping original sweep order",
                len(cluster_nodes), cluster_exc,
            )
            ordered = cluster_nodes

        # ── 2-opt polish within this route ────────────────────────────────────
        # Removes crossing edges and linear-chain artefacts that OR-Tools
        # occasionally leaves, using the same sub_matrix (real road distances
        # when OSRM/GH was available, otherwise Haversine).
        if sub_matrix is not None and len(ordered) >= 3:
            # Map global node indices back to local sub_matrix indices
            # group_indices = [0] + cluster_nodes → local[k] = group_indices[k]
            group_indices = [0] + cluster_nodes
            local_idx = {gn: li for li, gn in enumerate(group_indices)}
            local_route = [local_idx[gn] for gn in ordered]
            local_route = _two_opt_route(local_route, sub_matrix)
            ordered = [group_indices[li] for li in local_route]

        routes.append(ordered if ordered else cluster_nodes)

    # Determine reported matrix source
    total_clusters = gh_clusters + osrm_clusters + hv_clusters
    if osrm_clusters == total_clusters:
        matrix_source = "osrm"
    elif gh_clusters == total_clusters:
        matrix_source = "graphhopper"
    elif hv_clusters == total_clusters:
        matrix_source = "haversine"
    else:
        parts = []
        if gh_clusters:   parts.append(f"gh={gh_clusters}")
        if osrm_clusters: parts.append(f"osrm={osrm_clusters}")
        if hv_clusters:   parts.append(f"hv={hv_clusters}")
        matrix_source = "mixed (" + ", ".join(parts) + ")"

    logger.info(
        "solve_vrp clusters: total=%d, graphhopper=%d, osrm=%d, haversine=%d, "
        "elapsed=%.1fs, cache_hits=%d, cache_total=%d",
        total_clusters, gh_clusters, osrm_clusters, hv_clusters,
        time.time() - t_vrp_start,
        _matrix_cache_hits + _osrm_cache_hits, len(_matrix_cache),
    )

    if not routes:
        routes = _fallback_distribution(all_store_nodes, num_vehicles)

    # ── Step 4: fill unused vehicles by splitting oversized routes ────────────
    # If equal-angle sectors left some vehicles idle (empty angular wedge),
    # break the largest route in half by polar angle until all vehicles are used.
    while len(routes) < num_vehicles and any(len(r) > 1 for r in routes):
        largest_idx = max(range(len(routes)), key=lambda i: len(routes[i]))
        largest = routes[largest_idx]
        if len(largest) < 2:
            break
        # Sort by angle and split at midpoint — each half stays geographic
        depot = all_coords[0]
        def _angle(node):
            lat, lon = all_coords[node]
            return math.atan2(lon - depot[1], lat - depot[0])
        sorted_half = sorted(largest, key=_angle)
        mid = len(sorted_half) // 2
        routes[largest_idx] = sorted_half[:mid]
        routes.append(sorted_half[mid:])

    # Compute effective min-stops floor.
    # For large datasets (avg > MIN_STOPS_PER_VEHICLE) use 70% of avg so no
    # route drops below ≈70% of the mean — this caps ratio max/min at ~1.7x
    # while still allowing inter-route optimisation to fix misplaced stops.
    # For small datasets, fall back to avg-1 so no vehicle is left empty.
    avg_stops = store_count // max(len(routes), 1)
    if avg_stops <= MIN_STOPS_PER_VEHICLE:
        effective_min = max(1, avg_stops - 1)
    else:
        effective_min = max(MIN_STOPS_PER_VEHICLE, int(avg_stops * 0.70))

    # ── Step 5: inter-route relocate post-processing ──────────────────────────
    # Move individual stops between routes if it reduces total Haversine distance.
    # This equalises quality across all vehicles: TSP sectors are optimised in
    # isolation, so route 1 can end up much shorter than route 2.  Relocate fixes
    # this by shifting misplaced stops to the route where they cost the least.
    # The min_stops guard prevents Or-opt from draining routes below the floor.
    #
    # REMOVED: the old `store_count <= 80` gate that disabled this step entirely
    # for larger datasets — that was the root cause of quality degradation at
    # 100+ stops.  Instead we use adaptive iteration counts so that larger
    # problems still finish quickly (O(iters × stops × routes × cluster_size)).
    if len(routes) > 1:
        if store_count <= 80:
            relocate_iters = 5
        elif store_count <= 150:
            relocate_iters = 3
        elif store_count <= 300:
            relocate_iters = 2
        else:
            relocate_iters = 1

        before_km = sum(
            sum(full_matrix[r[k]][r[k + 1]] for k in range(len(r) - 1))
            + (full_matrix[0][r[0]] + full_matrix[r[-1]][0] if r else 0)
            for r in routes
        ) / 1000
        routes = _inter_route_relocate(routes, full_matrix,
                                       max_iter=relocate_iters,
                                       min_stops=effective_min)
        after_km = sum(
            sum(full_matrix[r[k]][r[k + 1]] for k in range(len(r) - 1))
            + (full_matrix[0][r[0]] + full_matrix[r[-1]][0] if r else 0)
            for r in routes
        ) / 1000
        logger.info(
            "inter_route_relocate: %.1f km → %.1f km (saved %.1f km, iters=%d, stores=%d)",
            before_km, after_km, before_km - after_km, relocate_iters, store_count,
        )

        # ── Step 5b: 2-opt re-polish after relocate ───────────────────────────
        # inter_route_relocate inserts stops at their best position but does NOT
        # re-run 2-opt after insertion, leaving crossing edges in the routes.
        # Confirmed by real data (Session 49): Route 9 retains 2.061 km (7.6%)
        # of 2-opt improvability after relocate; all routes combined: 3.038 km.
        # Running 2-opt here on full_matrix (Haversine) removes those crossings.
        # This is the primary cause of the 14-min gap vs Yandex on 37-stop routes.
        routes = [
            _two_opt_route(r, full_matrix) if len(r) >= 3 else r
            for r in routes
        ]
        after_2opt_km = sum(
            sum(full_matrix[r[k]][r[k + 1]] for k in range(len(r) - 1))
            + (full_matrix[0][r[0]] + full_matrix[r[-1]][0] if r else 0)
            for r in routes
        ) / 1000
        logger.info(
            "post-relocate 2-opt: %.1f km → %.1f km (saved %.1f km, stores=%d)",
            after_km, after_2opt_km, after_km - after_2opt_km, store_count,
        )

    # ── Step 6: rebalance to minimum stops per vehicle ────────────────────────
    # After sector sweep + Or-opt some vehicles may still be underfull (< effective_min
    # stops).  Steal the cheapest stop (minimum distance penalty) from any donor
    # route that has more than effective_min stops and insert it optimally.
    # This step runs always (also when store_count > 80, where Or-opt is skipped).
    if len(routes) > 1 and effective_min >= 2:
        routes = _rebalance_min_stops(routes, full_matrix, effective_min)

    # ── Step 7: cap overloaded routes (optional) ──────────────────────────────
    # When max_stops_per_vehicle is specified, redistribute excess stops from
    # overloaded routes to less-loaded ones with minimum km penalty.
    # Benchmarked on 120 stores / 9 vehicles (Haversine):
    #   max=24: ratio 3.9x→2.7x (−30.8%), km −0.8km (−0.5%) ✅ passes criteria
    #   max=26: ratio 3.9x→2.9x (−25.6%), km −0.8km (−0.5%) ⚠️  below 30% threshold
    # 2-opt re-polish runs after to clean up any crossing edges introduced.
    if max_stops_per_vehicle is not None and len(routes) > 1:
        before_max_km = sum(
            (full_matrix[0][r[0]] + full_matrix[r[-1]][0]
             + sum(full_matrix[r[k]][r[k + 1]] for k in range(len(r) - 1)))
            for r in routes if r
        ) / 1000
        routes, moves = _rebalance_max_stops(routes, full_matrix, max_stops_per_vehicle)
        routes = [
            _two_opt_route(r, full_matrix) if len(r) >= 3 else r
            for r in routes
        ]
        after_max_km = sum(
            (full_matrix[0][r[0]] + full_matrix[r[-1]][0]
             + sum(full_matrix[r[k]][r[k + 1]] for k in range(len(r) - 1)))
            for r in routes if r
        ) / 1000
        logger.info(
            "rebalance_max_stops(cap=%d): %.1f km → %.1f km (Δ%+.1f km, moves=%d, "
            "max_stops=%d)",
            max_stops_per_vehicle, before_max_km, after_max_km,
            after_max_km - before_max_km, moves,
            max(len(r) for r in routes) if routes else 0,
        )

    return routes, matrix_source


def geocode_address_yandex(address: str) -> Optional[tuple]:
    """
    Geocode using Yandex Geocoder API (primary, no rate-limit delay needed).
    Returns (lat, lon) or None if unavailable / API key not configured.
    """
    if not YANDEX_GEOCODER_API_KEY:
        return None
    try:
        url = (
            "https://geocode-maps.yandex.ru/1.x/?"
            f"geocode={urllib.parse.quote(address)}"
            "&format=json"
            f"&apikey={YANDEX_GEOCODER_API_KEY}"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "smartroute-app-1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        members = data["response"]["GeoObjectCollection"]["featureMember"]
        if members:
            pos = members[0]["GeoObject"]["Point"]["pos"]
            lon_str, lat_str = pos.split()
            result = (float(lat_str), float(lon_str))
            logger.info("geocode_yandex OK: '%s' → (%.5f, %.5f)", address, result[0], result[1])
            return result
    except Exception as e:
        logger.warning("geocode_yandex FAILED for '%s': %s", address, e)
    return None


def geocode_address_nominatim(address: str) -> Optional[tuple]:
    """Geocode using Nominatim (fallback, 1 req/sec limit)."""
    try:
        url = (
            "https://nominatim.openstreetmap.org/search?"
            f"q={urllib.parse.quote(address)}"
            "&format=json&limit=1&accept-language=ru"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "smartroute-app-1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        if data:
            return (float(data[0]["lat"]), float(data[0]["lon"]))
    except Exception as e:
        logger.warning(f"Nominatim geocoding failed for '{address}': {e}")
    return None


def geocode_address(address: str) -> Optional[tuple]:
    """
    Geocode an address, trying Yandex Geocoder first (fast, no rate limit),
    then falling back to Nominatim.  Results are cached in-memory.
    """
    cache_key = address.strip().lower()
    if cache_key in geocode_cache:
        return geocode_cache[cache_key]

    # ── Primary: Yandex Geocoder ──────────────────────────────────────────────
    result = geocode_address_yandex(address)

    # ── Fallback: Nominatim ───────────────────────────────────────────────────
    if result is None:
        result = geocode_address_nominatim(address)

    geocode_cache[cache_key] = result
    return result


def find_nearby_stores(lat: float, lon: float, radius_m: float = 20, exclude_id: int = None, owner_id: int = None) -> list:
    """Return stores within radius_m metres of (lat, lon), sorted by distance.
    Uses a degree-based bounding box pre-filter then exact Haversine check.
    If owner_id is provided, only looks within that user's stores."""
    try:
        delta = radius_m / 111320.0
        conn = get_db()
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        owner_clause = "AND owner_id = %s" if owner_id is not None else ""
        if exclude_id is not None:
            params = [lat, lon, exclude_id, lat, delta, lon, delta]
            if owner_id is not None:
                params.append(owner_id)
            cur.execute(
                f"""SELECT id, name, address, lat, lon,
                    SQRT(POWER((lat-%s)*111320.0,2)
                         + POWER((lon-%s)*111320.0*COS(RADIANS(lat)),2)) AS dist_m
                   FROM stores
                   WHERE id != %s AND lat IS NOT NULL
                     AND ABS(lat-%s) < %s AND ABS(lon-%s) < %s
                     {owner_clause}
                   ORDER BY dist_m LIMIT 5""",
                params,
            )
        else:
            params = [lat, lon, lat, delta, lon, delta]
            if owner_id is not None:
                params.append(owner_id)
            cur.execute(
                f"""SELECT id, name, address, lat, lon,
                    SQRT(POWER((lat-%s)*111320.0,2)
                         + POWER((lon-%s)*111320.0*COS(RADIANS(lat)),2)) AS dist_m
                   FROM stores
                   WHERE lat IS NOT NULL
                     AND ABS(lat-%s) < %s AND ABS(lon-%s) < %s
                     {owner_clause}
                   ORDER BY dist_m LIMIT 5""",
                params,
            )
        rows = cur.fetchall()
        cur.close()
        conn.close()
        return [dict(r) for r in rows if r["dist_m"] < radius_m]
    except Exception as e:
        logger.error("find_nearby_stores error: %s", e)
        return []


def parse_yandex_link(url: str) -> tuple:
    """
    Extract (lat, lon) from various Yandex Maps URL formats.
    Returns (None, None) if extraction fails.
    """
    from urllib.parse import urlparse, parse_qs, unquote
    try:
        decoded = unquote(url)
        parsed = urlparse(decoded)
        params = parse_qs(parsed.query)

        # Format: whatshere[point]=lon,lat
        if "whatshere[point]" in params:
            lon_s, lat_s = params["whatshere[point]"][0].split(",")
            return float(lat_s), float(lon_s)

        # Format: ll=lon,lat (map centre)
        if "ll" in params:
            lon_s, lat_s = params["ll"][0].split(",")
            return float(lat_s), float(lon_s)

        # Format: rtext=lat,lon~lat,lon (route first point)
        if "rtext" in params:
            parts = params["rtext"][0].split("~")[0].split(",")
            if len(parts) >= 2:
                return float(parts[0]), float(parts[1])

        # Short links (/-/) — follow redirect
        if "/-/" in url or "maps.yandex" in url:
            req = urllib.request.Request(
                url, headers={"User-Agent": "Mozilla/5.0"}, method="GET"
            )
            opener = urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
            response = opener.open(req, timeout=10)
            final_url = response.geturl()
            if final_url != url:
                return parse_yandex_link(final_url)

        return None, None
    except Exception as e:
        logger.error("parse_yandex_link error for '%s': %s", url, e)
        return None, None


def reverse_geocode_nominatim(lat: float, lon: float) -> Optional[str]:
    """Get a human-readable address from coordinates using Nominatim."""
    try:
        url = (
            "https://nominatim.openstreetmap.org/reverse?"
            f"lat={lat}&lon={lon}&format=json&accept-language=ru"
        )
        req = urllib.request.Request(url, headers={"User-Agent": "smartroute-app-1.0"})
        with urllib.request.urlopen(req, timeout=5) as r:
            data = json.loads(r.read().decode("utf-8"))
        addr = data.get("address", {})
        road = addr.get("road", "")
        house = addr.get("house_number", "")
        city = addr.get("city") or addr.get("town") or addr.get("village") or ""
        parts = [p for p in [city, road, house] if p]
        return ", ".join(parts) if parts else data.get("display_name", "")
    except Exception as e:
        logger.warning("reverse_geocode_nominatim error: %s", e)
        return None


def calculate_savings(
    optimized_km: float,
    store_list: list,
    num_vehicles: int,
    depot_lat: float,
    depot_lon: float,
    settings: dict = None,
) -> dict:
    """
    Baseline: маршрут в порядке загрузки из Excel (как диспетчер без оптимизации),
    распределённый по машинам round-robin.  Сравниваем с оптимизированным SmartRoute.

    Методика прозрачна для клиента:
      «Если бы водители ехали в том же порядке, в котором магазины загружены в систему»
    """
    if settings is None:
        settings = get_company_settings()
    # Distribute stores round-robin across vehicles (same order as input)
    n = max(num_vehicles, 1)
    buckets: list = [[] for _ in range(n)]
    for idx, store in enumerate(store_list):
        buckets[idx % n].append(store)

    unoptimized_km = 0.0
    depot = (depot_lat, depot_lon)
    for bucket in buckets:
        if not bucket:
            continue
        prev = depot
        for s in bucket:
            if s.get("lat") and s.get("lon"):
                curr = (float(s["lat"]), float(s["lon"]))
                unoptimized_km += haversine_meters(prev, curr) / 1000.0
                prev = curr
        unoptimized_km += haversine_meters(prev, depot) / 1000.0

    unoptimized_km = max(float(unoptimized_km), optimized_km)
    saved_km = round(max(0.0, unoptimized_km - optimized_km), 1)
    saved_pct = round(saved_km / unoptimized_km * 100) if unoptimized_km > 0 else 0

    # ── Модель стоимости — параметры берём из настроек компании (БД) ─────────
    #
    # ROAD_FACTOR: географическая константа — Haversine → реальный пробег.
    # Оба маршрута (baseline и optimized) считаются через Haversine,
    # поэтому saved_km / saved_pct — честное сравнение.
    # Для монетарных метрик умножаем Haversine-км на ROAD_FACTOR.
    #
    ROAD_FACTOR: float = 1.4           # Haversine → реальный пробег (константа)
    fuel_l_per_100km: float = float(settings.get("fuel_consumption", 13.0))
    fuel_price_rub: float = float(settings.get("fuel_price", 67.0))
    cost_per_km_val: float = float(settings.get("cost_per_km", round(67.0 * 13.0 / 100.0, 2)))

    # Применяем ROAD_FACTOR только к монетарным метрикам, а не к saved_km,
    # чтобы не искажать честное сравнение маршрутов.
    saved_km_road = saved_km * ROAD_FACTOR
    saved_fuel_l = round(saved_km_road * fuel_l_per_100km / 100.0, 1)
    saved_fuel_cost_rub = round(saved_fuel_l * fuel_price_rub)
    # cost_per_km = fuel_price × consumption / 100 (только топливо)
    saved_rub_day = round(saved_km_road * cost_per_km_val)

    return {
        "optimized_km": round(optimized_km, 1),
        "unoptimized_km": round(unoptimized_km, 1),
        "saved_km": saved_km,
        "saved_pct": saved_pct,
        "saved_fuel_l": saved_fuel_l,
        "saved_fuel_cost_rub": saved_fuel_cost_rub,
        "saved_rub_day": saved_rub_day,
        "saved_rub_month": saved_rub_day * 30,
        "cost_per_km": round(cost_per_km_val, 2),
        "fuel_price": fuel_price_rub,
        "fuel_consumption": fuel_l_per_100km,
    }


# Яндекс.Навигатор (мобильное приложение) поддерживает максимум 20 промежуточных
# точек в одной ссылке rtext. При большем числе маршрут не строится.
YANDEX_NAV_MAX_STOPS = 20


def yandex_nav_url(coords_list: list) -> str:
    """Генерирует одну ссылку Яндекс.Навигатора.
    coords_list[0] = склад (depot) — первая точка rtext.
    Яндекс заменяет её GPS-позицией водителя, но все магазины (точки 2…N) сохраняются.
    """
    chunk = coords_list[:YANDEX_NAV_MAX_STOPS]
    points = "~".join(f"{lat},{lon}" for lat, lon in chunk)
    return f"https://yandex.ru/maps/?rtext={points}&rtt=auto"


def yandex_nav_urls(coords_list: list) -> list:
    """
    coords_list[0] = склад (depot), coords_list[1:] = магазины в порядке объезда.

    Разбивает маршрут на сегменты по YANDEX_NAV_MAX_STOPS точек (включая точку
    отправления). Каждый сегмент:
      - сегмент 1: [склад, магазин1 … магазин19]  (20 точек)
      - сегмент 2: [магазин19, магазин20 … магазин37] (20 точек)
      - …

    Яндекс Навигатор заменяет первую точку GPS-позицией водителя — это нормально:
    водитель стоит на складе в начале смены. Все магазины остаются на месте.
    """
    if not coords_list:
        return []

    stores = coords_list[1:]        # магазины (без склада)
    if not stores:
        return []

    max_stores = YANDEX_NAV_MAX_STOPS - 1  # 19 магазинов + 1 точка отправления = 20
    origin = coords_list[0]         # склад — точка отправления первого сегмента

    urls = []
    idx = 0
    while idx < len(stores):
        chunk = stores[idx: idx + max_stores]
        idx += max_stores

        segment = [origin] + chunk
        points = "~".join(f"{lat},{lon}" for lat, lon in segment)
        urls.append(f"https://yandex.ru/maps/?rtext={points}&rtt=auto")

        # Следующий сегмент стартует с последнего магазина текущего
        origin = chunk[-1]

    return urls


def whatsapp_url(vehicle_name: str, stores: list, total_km: float, yandex_urls: list) -> str:
    lines = [f"🚚 {vehicle_name} — маршрут на {total_km:.1f} км:"]
    for i, s in enumerate(stores, 1):
        lines.append(f"{i}. {s['store_name']} — {s['address']}")
    if len(yandex_urls) == 1:
        lines.append(f"\n🗺 Навигатор: {yandex_urls[0]}")
    elif len(yandex_urls) > 1:
        lines.append("")
        for idx, url in enumerate(yandex_urls, 1):
            lines.append(f"🗺 Маршрут {idx}: {url}")
    text = "\n".join(lines)
    return f"https://wa.me/?text={urllib.parse.quote(text)}"


def store_row_to_dict(row) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "address": row["address"],
        "lat": row["lat"],
        "lon": row["lon"],
        "map_url": row.get("map_url"),
        "geocode_status": row["geocode_status"] or "pending",
        "time_window_from": row["time_window_from"] or "09:00",
        "time_window_to": row["time_window_to"] or "18:00",
        "unload_minutes": row["unload_minutes"] or 15,
        "created_at": str(row["created_at"]) if row["created_at"] else None,
    }


# ── Pydantic models ──────────────────────────────────────────────────────────

class StoreInput(BaseModel):
    name: str
    address: Optional[str] = None
    city: Optional[str] = None
    yandex_url: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    map_url: Optional[str] = None
    time_window_from: Optional[str] = "09:00"
    time_window_to: Optional[str] = "18:00"
    unload_minutes: Optional[int] = 15


class StoreUpdate(BaseModel):
    name: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    yandex_url: Optional[str] = None
    lat: Optional[float] = None
    lon: Optional[float] = None
    map_url: Optional[str] = None
    time_window_from: Optional[str] = None
    time_window_to: Optional[str] = None
    unload_minutes: Optional[int] = None


class VehicleInput(BaseModel):
    name: str
    capacity_kg: Optional[int] = None
    average_speed: Optional[float] = None


class RouteRequest(BaseModel):
    store_ids: list[int]
    vehicles: list[VehicleInput]
    depot_lat: Optional[float] = None
    depot_lon: Optional[float] = None
    use_time_windows: Optional[bool] = False
    use_unload_time: Optional[bool] = False
    max_stops_per_vehicle: Optional[int] = None
    optimize_by: str = "distance"  # "distance" | "time" — backward-compat default


class CompanySettingsInput(BaseModel):
    fuel_price: float       # руб/литр
    fuel_consumption: float # л/100 км


# ── Routes ───────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    # ── Routing chain status ──────────────────────────────────────────────────
    gh_status = f"enabled (plan_limit={_gh_plan_limit})" if GRAPHHOPPER_API_KEY else "disabled (no API key)"
    logger.info(
        "Routing chain: GH[%s] → OSRM[%s] → Haversine[always]",
        gh_status, OSRM_BASE_URL,
    )
    if not GRAPHHOPPER_API_KEY:
        logger.warning(
            "GRAPHHOPPER_API_KEY not set — GraphHopper disabled. "
            "OSRM (%s) will be used for real road distances.",
            OSRM_BASE_URL,
        )
    if not YANDEX_GEOCODER_API_KEY:
        logger.warning(
            "YANDEX_GEOCODER_API_KEY not set — Yandex Geocoder disabled, falling back to Nominatim"
        )
    init_db()
    # NOTE: migrate_moscow_stores() deliberately NOT called here.
    # It was a one-time dev migration that ran when the DB held old Moscow demo data.
    # Calling it on every startup is catastrophically dangerous for production clients
    # in any Russian city with lat > 50 (Moscow, SPb, Novosibirsk, Yekaterinburg, etc.).
    admin_id = seed_admin_user()  # migrates legacy NULL owner_id data to admin
    seed_demo_data(owner_id=admin_id)  # seeds only if admin has no stores


def migrate_moscow_stores():
    """Удаляем старые московские демо-магазины (lat > 50), сохраняя всё остальное."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            "SELECT COUNT(*) as moscow_cnt "
            "FROM stores WHERE lat IS NOT NULL AND lat > 50"
        )
        row = cur.fetchone()
        moscow_cnt = int(row["moscow_cnt"])
        # Only remove if there are Moscow-like stores and it's a small demo-sized batch
        if moscow_cnt > 0 and moscow_cnt <= 15:
            logger.info("Removing %d Moscow demo stores (lat > 50)...", moscow_cnt)
            cur.execute("DELETE FROM stores WHERE lat IS NOT NULL AND lat > 50")
            conn.commit()
            logger.info("Migration done: %d Moscow stores removed.", moscow_cnt)
    except Exception as exc:
        logger.error("migrate_moscow_stores failed: %s", exc)
        conn.rollback()
    finally:
        cur.close()
        conn.close()


def seed_demo_data(owner_id: int = None):
    """Seed demo stores and route sessions for a specific user (owner_id).
    Only seeds if that user has no stores yet."""
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    if owner_id is not None:
        cur.execute("SELECT COUNT(*) as cnt FROM stores WHERE owner_id = %s", (owner_id,))
    else:
        cur.execute("SELECT COUNT(*) as cnt FROM stores")
    row = cur.fetchone()
    # Seed if empty, or if only a handful remain after migration
    if row["cnt"] >= 3:
        cur.close()
        conn.close()
        return

    demo_stores = [
        ("Продукты Центр", "Махачкала, пр. Расула Гамзатова, 37", 42.9849, 47.5046, "found"),
        ("Супермаркет Каспий", "Махачкала, ул. Ленина, 15", 42.9800, 47.5012, "found"),
        ("Магазин Дагестан", "Махачкала, ул. Коркмасова, 8", 42.9764, 47.4989, "found"),
        ("Торговый дом Север", "Махачкала, ул. Батырая, 22", 42.9838, 47.5155, "found"),
        ("Мини-маркет Восток", "Махачкала, пр. Акушинского, 10", 42.9912, 47.5078, "found"),
        ("Продукты Юг", "Махачкала, ул. Имама Шамиля, 31", 42.9691, 47.5034, "found"),
        ("Супермаркет Горный", "Махачкала, ул. Гагарина, 44", 42.9857, 47.4921, "found"),
        ("Магазин Приморский", "Махачкала, ул. Приморская, 5", 42.9929, 47.5196, "found"),
    ]

    for name, address, lat, lon, status in demo_stores:
        cur.execute(
            """INSERT INTO stores (name, address, lat, lon, geocode_status, time_window_from, time_window_to, unload_minutes, owner_id)
               VALUES (%s, %s, %s, %s, %s, '09:00', '18:00', 15, %s)""",
            (name, address, lat, lon, status, owner_id)
        )

    # Seed some historical route sessions
    today = date.today()
    for i in range(14):
        d = today.replace(day=max(1, today.day - i))
        total_km = 80 + (i * 7) % 40
        saved_km = total_km * 0.23
        cur.execute(
            """INSERT INTO route_sessions (date, num_vehicles, total_km, saved_km, saved_rub, num_points, owner_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (str(d), 2 + i % 3, round(total_km, 1), round(saved_km, 1), round(saved_km * 1.4 * 31), 8 + i % 6, owner_id)
        )

    conn.commit()
    cur.close()
    conn.close()


# ── Auth utilities ────────────────────────────────────────────────────────────

import bcrypt as _bcrypt_lib


def _truncate_password(password: str) -> bytes:
    """bcrypt silently truncates at 72 bytes — enforce explicitly."""
    return password.encode("utf-8")[:72]


def _hash_password(password: str) -> str:
    pw = _truncate_password(password)
    return _bcrypt_lib.hashpw(pw, _bcrypt_lib.gensalt(rounds=12)).decode("utf-8")


def _verify_password(plain: str, hashed: str) -> bool:
    try:
        pw = _truncate_password(plain)
        return _bcrypt_lib.checkpw(pw, hashed.encode("utf-8"))
    except Exception:
        return False


def _create_access_token(username: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=JWT_TOKEN_TTL_HOURS)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _decode_token(token: str) -> Optional[str]:
    """Return username from token, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload.get("sub")
    except JWTError:
        return None


def seed_admin_user() -> Optional[int]:
    """Create the admin user from ADMIN_PASSWORD env var if not exists.
    Sets is_admin=TRUE. Migrates legacy (NULL owner_id) data to admin.
    Returns the admin user ID, or None on failure."""
    if not ADMIN_PASSWORD:
        logger.warning(
            "ADMIN_PASSWORD env var is not set — admin user will NOT be created. "
            "Set ADMIN_PASSWORD to enable login."
        )
        return None
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("SELECT id, is_admin FROM users WHERE username = %s", ("admin",))
        row = cur.fetchone()
        if row is None:
            hashed = _hash_password(ADMIN_PASSWORD)
            cur.execute(
                "INSERT INTO users (username, password_hash, is_admin, is_active) VALUES (%s, %s, TRUE, TRUE) RETURNING id",
                ("admin", hashed),
            )
            admin_id = cur.fetchone()["id"]
            conn.commit()
            logger.info("Admin user created (id=%d).", admin_id)
        else:
            admin_id = row["id"]
            # Ensure is_admin flag is set on existing admin account
            if not row.get("is_admin"):
                cur.execute("UPDATE users SET is_admin = TRUE, is_active = TRUE WHERE id = %s", (admin_id,))
                conn.commit()
            logger.info("Admin user already exists (id=%d).", admin_id)

        # One-time migration: assign stores/sessions/settings with NULL owner_id to admin
        cur.execute("UPDATE stores SET owner_id = %s WHERE owner_id IS NULL", (admin_id,))
        migrated_stores = cur.rowcount
        cur.execute("UPDATE route_sessions SET owner_id = %s WHERE owner_id IS NULL", (admin_id,))
        migrated_sessions = cur.rowcount
        cur.execute("UPDATE company_settings SET owner_id = %s WHERE owner_id IS NULL", (admin_id,))
        conn.commit()
        if migrated_stores > 0 or migrated_sessions > 0:
            logger.info("Migrated %d stores and %d sessions to admin (owner_id=%d).",
                        migrated_stores, migrated_sessions, admin_id)
        return admin_id
    except Exception as exc:
        logger.error("seed_admin_user failed: %s", exc)
        conn.rollback()
        return None
    finally:
        cur.close()
        conn.close()


# ── Auth middleware ───────────────────────────────────────────────────────────

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    # Always pass through OPTIONS (CORS pre-flight) and public paths
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    if path in _AUTH_PUBLIC_PATHS or not path.startswith("/api/"):
        return await call_next(request)

    token = request.cookies.get(JWT_COOKIE_NAME)
    if not token:
        return JSONResponse(
            status_code=401,
            content={"detail": "Не авторизован. Войдите в систему."},
        )

    username = _decode_token(token)
    if not username:
        return JSONResponse(
            status_code=401,
            content={"detail": "Токен недействителен или истёк. Войдите снова."},
        )

    # Load user from DB on every request: checks is_active, populates user_id and is_admin
    try:
        _conn = get_db()
        _cur = _conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        _cur.execute(
            "SELECT id, is_active, is_admin FROM users WHERE username = %s",
            (username,)
        )
        _user_row = _cur.fetchone()
        _cur.close()
        _conn.close()
    except Exception as _exc:
        logger.error("Auth middleware DB error: %s", _exc)
        _user_row = None

    if not _user_row:
        return JSONResponse(
            status_code=401,
            content={"detail": "Пользователь не найден. Войдите снова."},
        )

    if not _user_row.get("is_active", True):
        return JSONResponse(
            status_code=401,
            content={"detail": "Аккаунт отключён. Обратитесь к администратору."},
        )

    request.state.username = username
    request.state.user_id = _user_row["id"]
    request.state.is_admin = bool(_user_row.get("is_admin", False))
    return await call_next(request)


# ── Auth endpoints ────────────────────────────────────────────────────────────

class LoginForm(BaseModel):
    username: str
    password: str


@app.post("/api/auth/login")
async def login(request: Request, response: Response):
    """Authenticate with username + password (form-encoded). Sets HttpOnly JWT cookie."""
    client_ip = _get_client_ip(request)
    _check_login_rate_limit(client_ip)

    content_type = request.headers.get("content-type", "")
    if "application/x-www-form-urlencoded" in content_type or "multipart/form-data" in content_type:
        form = await request.form()
        username = str(form.get("username", "")).strip()
        password = str(form.get("password", ""))
    else:
        try:
            body = await request.json()
            username = str(body.get("username", "")).strip()
            password = str(body.get("password", ""))
        except Exception:
            raise HTTPException(status_code=422, detail="Неверный формат запроса")

    if not username or not password:
        raise HTTPException(status_code=422, detail="Укажите логин и пароль")

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("SELECT password_hash, is_active, is_admin FROM users WHERE username = %s", (username,))
        row = cur.fetchone()
    finally:
        cur.close()
        conn.close()

    if not row:
        _record_failed_login(client_ip)
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")
    if not row.get("is_active", True):
        _record_failed_login(client_ip)
        raise HTTPException(status_code=401, detail="Аккаунт отключён. Обратитесь к администратору.")
    if not _verify_password(password, row["password_hash"]):
        _record_failed_login(client_ip)
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    _clear_login_attempts(client_ip)

    # Update last_login_at
    try:
        _lconn = get_db()
        _lcur = _lconn.cursor()
        _lcur.execute("UPDATE users SET last_login_at = NOW() WHERE username = %s", (username,))
        _lconn.commit()
        _lcur.close()
        _lconn.close()
    except Exception:
        pass

    token = _create_access_token(username)
    resp = JSONResponse(content={"ok": True, "username": username, "is_admin": bool(row.get("is_admin", False))})
    resp.set_cookie(
        key=JWT_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite=COOKIE_SAMESITE,
        secure=COOKIE_SECURE,
        max_age=JWT_TOKEN_TTL_HOURS * 3600,
        path="/",
    )
    return resp


@app.post("/api/auth/logout")
async def logout():
    """Clear the JWT cookie."""
    resp = JSONResponse(content={"ok": True})
    resp.delete_cookie(key=JWT_COOKIE_NAME, path="/", samesite=COOKIE_SAMESITE)
    return resp


@app.get("/api/auth/me")
async def me(request: Request):
    """Return the currently authenticated user."""
    username = getattr(request.state, "username", None)
    if not username:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return {
        "username": username,
        "user_id": getattr(request.state, "user_id", None),
        "is_admin": getattr(request.state, "is_admin", False),
    }


# ── Auth helpers ──────────────────────────────────────────────────────────────

def get_user_id(request: Request) -> int:
    """Return the current user's ID from request state (set by auth middleware)."""
    uid = getattr(request.state, "user_id", None)
    if uid is None:
        raise HTTPException(status_code=401, detail="Не авторизован")
    return uid


def require_admin(request: Request) -> int:
    """Return current user ID if they are an admin, else raise 403."""
    uid = get_user_id(request)
    if not getattr(request.state, "is_admin", False):
        raise HTTPException(status_code=403, detail="Доступ запрещён. Только для администраторов.")
    return uid


# ── Business routes ───────────────────────────────────────────────────────────

@app.get("/api/healthz")
def health_check():
    return {"status": "ok"}


@app.get("/api/stores")
def list_stores(request: Request):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM stores WHERE owner_id = %s ORDER BY id", (uid,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [store_row_to_dict(r) for r in rows]


@app.post("/api/stores", status_code=201)
def create_store(request: Request, body: StoreInput, force: bool = Query(False, description="Пропустить предупреждение о дубликате")):
    uid = get_user_id(request)
    if not body.name or not body.name.strip():
        raise HTTPException(status_code=422, detail="Название магазина не может быть пустым")
    if not body.yandex_url and not body.address and not body.city and body.lat is None:
        raise HTTPException(status_code=422, detail="Укажите ссылку из Яндекс Карт или адрес")
    if body.lat is not None and not (-90 <= body.lat <= 90):
        raise HTTPException(status_code=422, detail="Широта должна быть от -90 до 90")
    if body.lon is not None and not (-180 <= body.lon <= 180):
        raise HTTPException(status_code=422, detail="Долгота должна быть от -180 до 180")

    raw_address = (body.address or "").strip()
    city = (body.city or "").strip()
    geocode_query = f"{city} {raw_address}".strip() if city and city not in raw_address else raw_address

    lat, lon, status = None, None, "not_found"
    address = raw_address or city

    # Priority 1: explicit lat/lon
    if body.lat is not None and body.lon is not None:
        lat, lon, status = body.lat, body.lon, "found"

    # Priority 2: parse Yandex Maps URL
    elif body.yandex_url:
        lat, lon = parse_yandex_link(body.yandex_url)
        if lat is not None and lon is not None:
            status = "found"
            if not address:
                address = reverse_geocode_nominatim(lat, lon) or f"{lat:.5f}, {lon:.5f}"
            logger.info("create_store: coords from yandex_url → (%.5f, %.5f)", lat, lon)
        elif geocode_query:
            coords = geocode_address(geocode_query)
            lat = coords[0] if coords else None
            lon = coords[1] if coords else None
            status = "found" if coords else "not_found"
            logger.info("create_store: yandex_url parse failed, geocoded '%s' → %s", geocode_query, status)

    # Priority 3: geocode address
    elif geocode_query:
        coords = geocode_address(geocode_query)
        lat = coords[0] if coords else None
        lon = coords[1] if coords else None
        status = "found" if coords else "not_found"
        logger.info("create_store: geocoded '%s' → %s", geocode_query, status)

    if not address:
        address = geocode_query or (f"{lat:.5f}, {lon:.5f}" if lat is not None else "Адрес не указан")

    # Duplicate detection (skip if force=True)
    if lat is not None and lon is not None and not force:
        nearby = find_nearby_stores(lat, lon, radius_m=20, owner_id=uid)
        if nearby:
            near = nearby[0]
            raise HTTPException(
                status_code=409,
                detail={
                    "type": "duplicate_warning",
                    "message": (
                        f"Найден похожий магазин в {near['dist_m']:.0f} м: "
                        f"«{near['name']}» ({near['address']}). "
                        "Создать всё равно?"
                    ),
                    "existing": {
                        "id": near["id"],
                        "name": near["name"],
                        "address": near["address"],
                        "dist_m": round(float(near["dist_m"]), 1),
                    },
                },
            )

    # Store yandex_url as map_url if no explicit map_url provided
    map_url = body.map_url or body.yandex_url

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        """INSERT INTO stores (name, address, lat, lon, map_url, geocode_status, time_window_from, time_window_to, unload_minutes, owner_id)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
        (body.name.strip(), address, lat, lon, map_url,
         status, body.time_window_from, body.time_window_to, body.unload_minutes, uid)
    )
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return store_row_to_dict(row)


@app.get("/api/geocode")
def geocode_endpoint(address: Optional[str] = None, yandex_url: Optional[str] = None):
    """Geocode an address or parse a Yandex Maps URL. Returns {lat, lon, display}."""
    if yandex_url and yandex_url.strip():
        lat, lon = parse_yandex_link(yandex_url.strip())
        if lat is not None and lon is not None:
            display = reverse_geocode_nominatim(lat, lon) or yandex_url.strip()
            return {"lat": lat, "lon": lon, "display": display}
        raise HTTPException(status_code=422, detail="Не удалось извлечь координаты из ссылки Яндекс Карт")
    if address and address.strip():
        result = geocode_address(address.strip())
        if result:
            lat, lon = result
            return {"lat": lat, "lon": lon, "display": address.strip()}
        raise HTTPException(status_code=404, detail="Адрес не найден. Попробуйте уточнить запрос.")
    raise HTTPException(status_code=400, detail="Укажите параметр address или yandex_url")


@app.get("/api/stores/template")
def download_stores_template():
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    from openpyxl.styles import Font, PatternFill, Alignment, PatternFill
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Магазины"

    # 7-column simplified template
    headers = [
        "Название",         # A — required
        "Ссылка Яндекс",    # B — recommended (coords parsed automatically)
        "Адрес",            # C — if no Yandex link
        "Город",            # D — optional, prepended to address
        "Разгрузка мин",    # E — optional
        "Время с",          # F — optional
        "Время до",         # G — optional
    ]
    ws.append(headers)

    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    for col_num, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    # Example row 1: with Yandex URL
    ws.append([
        "Супермаркет Каспий",
        "https://yandex.ru/maps/?whatshere[point]=47.5046,42.9849",
        "",
        "",
        15, "09:00", "18:00",
    ])
    # Example row 2: with address + city
    ws.append([
        "Магазин Горный",
        "",
        "ул. Ленина 15",
        "Махачкала",
        20, "10:00", "17:00",
    ])

    col_widths = [28, 52, 36, 16, 16, 12, 12]
    for i, width in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width

    # Hint row (skipped on import — starts with ←)
    note_row = [
        "← Название магазина",
        "← Ссылка из Яндекс: зажми место → Поделиться",
        "← Адрес если нет ссылки",
        "← Город",
        "← Минут (число)",
        "← ЧЧ:ММ",
        "← ЧЧ:ММ",
    ]
    ws.append(note_row)
    for col_num in range(1, len(note_row) + 1):
        cell = ws.cell(row=ws.max_row, column=col_num)
        cell.font = Font(italic=True, color="888888")

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    content = buf.read()

    import base64
    return {
        "data": base64.b64encode(content).decode("ascii"),
        "filename": "smartroute_template.xlsx",
    }


@app.get("/api/stores/export")
def export_stores(request: Request):
    """Export all user stores as Excel (base64 JSON). Same format as import template."""
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "SELECT name, map_url, address, lat, lon, unload_minutes, time_window_from, time_window_to "
        "FROM stores WHERE owner_id = %s ORDER BY id",
        (uid,),
    )
    rows = cur.fetchall()
    cur.close()
    conn.close()

    from openpyxl.styles import Font, PatternFill, Alignment
    from openpyxl.utils import get_column_letter
    import base64

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Магазины"

    headers = [
        "Название",
        "Ссылка Яндекс",
        "Адрес",
        "Город",
        "Разгрузка мин",
        "Время с",
        "Время до",
    ]
    ws.append(headers)

    header_fill = PatternFill(start_color="2563EB", end_color="2563EB", fill_type="solid")
    for col_num, _ in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_num)
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    for row in rows:
        ws.append([
            row.get("name") or "",
            row.get("map_url") or "",
            row.get("address") or "",
            "",  # city — not stored separately, skip
            row.get("unload_minutes") or 15,
            row.get("time_window_from") or "09:00",
            row.get("time_window_to") or "18:00",
        ])

    col_widths = [28, 52, 36, 16, 16, 12, 12]
    for i, width in enumerate(col_widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = width

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    content = buf.read()

    from datetime import date
    filename = f"smartroute_stores_{date.today().isoformat()}.xlsx"
    return {
        "data": base64.b64encode(content).decode("ascii"),
        "filename": filename,
        "count": len(rows),
    }


@app.post("/api/stores/import")
async def import_stores(request: Request, file: UploadFile = File(...)):
    owner_id = get_user_id(request)
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")

    content = await file.read()
    wb = openpyxl.load_workbook(io.BytesIO(content))
    ws = wb.active

    # Read header row to detect column layout
    header_row = [str(c).strip().lower() if c else "" for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True), [])]

    # Map header names → column indices (0-based)
    def _col(candidates: list) -> Optional[int]:
        for name in candidates:
            for i, h in enumerate(header_row):
                if name in h:
                    return i
        return None

    c_name    = _col(["назван", "name", "store_name"])
    c_yandex  = _col(["ссылка яндекс", "яндекс", "yandex", "ссылка"])
    c_address = _col(["адрес", "address"])
    c_city    = _col(["город", "city"])
    c_lat     = _col(["широта", "lat", "latitude"])
    c_lon     = _col(["долгота", "lon", "longitude"])
    c_mapurl  = _col(["map_url", "ссылка на карт"])
    c_unload  = _col(["разгрузка", "unload"])
    c_from    = _col(["время с", "open_time", "с (", "time_from"])
    c_to      = _col(["время до", "close_time", "до (", "time_to"])

    # Fall back to positional mapping for old-format files (5-column):
    # Col0=name, Col1=address, Col2=tw_from, Col3=tw_to, Col4=unload
    if c_name is None:
        c_name = 0
    if c_address is None and c_yandex is None:
        c_address = 1

    def _get(row, idx, default=""):
        if idx is None or idx >= len(row):
            return default
        val = row[idx]
        return val if val is not None else default

    imported = 0
    failed = 0
    stores = []
    duplicates = []
    # Skip header row and any trailing note rows (those with col A starting with ←)
    all_data_rows = [
        r for r in ws.iter_rows(min_row=2, values_only=True)
        if r and r[0] and not str(r[0]).strip().startswith("←")
    ]
    total_rows = len(all_data_rows)
    logger.info("Excel import: %d data rows found (headers: %s)", total_rows, header_row)

    for i, row in enumerate(all_data_rows, start=1):
        name       = str(_get(row, c_name, "")).strip()
        yandex_url = str(_get(row, c_yandex, "")).strip() or None
        city       = str(_get(row, c_city, "")).strip()
        raw_addr   = str(_get(row, c_address, "")).strip()

        # Combine city + address: city goes FIRST so address.split(",")[0] == city
        if city and city not in raw_addr:
            address = f"{city}, {raw_addr}" if raw_addr else city
        else:
            address = raw_addr

        if not name or (not yandex_url and not address):
            logger.warning("Import row %d skipped: missing name or location", i)
            failed += 1
            continue

        # Parse optional lat/lon columns
        raw_lat = _get(row, c_lat)
        raw_lon = _get(row, c_lon)
        map_url = str(_get(row, c_mapurl, "")).strip() or None

        # Parse time window
        if c_from is None and len(row) > 2 and row[2] and ":" in str(row[2]):
            tw_from = str(row[2]).strip()
            tw_to   = str(row[3]).strip() if len(row) > 3 and row[3] else "18:00"
            unload  = int(row[4]) if len(row) > 4 and row[4] else 15
        else:
            tw_from = str(_get(row, c_from, "09:00")).strip() or "09:00"
            tw_to   = str(_get(row, c_to,   "18:00")).strip() or "18:00"
            try:
                unload = int(_get(row, c_unload, 15))
            except (ValueError, TypeError):
                unload = 15

        # ── Coord resolution (priority order) ────────────────────────────────
        lat, lon, status = None, None, "not_found"

        # 1. Explicit lat/lon columns
        try:
            prov_lat = float(raw_lat) if raw_lat not in (None, "", "None") else None
            prov_lon = float(raw_lon) if raw_lon not in (None, "", "None") else None
        except (ValueError, TypeError):
            prov_lat = prov_lon = None

        if prov_lat is not None and prov_lon is not None and (-90 <= prov_lat <= 90) and (-180 <= prov_lon <= 180):
            lat, lon, status = prov_lat, prov_lon, "found"
            logger.info("Import %d/%d — %s → explicit coords (%.4f, %.4f)", i, total_rows, name, lat, lon)

        # 2. Parse Yandex URL
        elif yandex_url:
            lat, lon = parse_yandex_link(yandex_url)
            if lat is not None and lon is not None:
                status = "found"
                if not address:
                    address = reverse_geocode_nominatim(lat, lon) or f"{lat:.5f}, {lon:.5f}"
                logger.info("Import %d/%d — %s → yandex_url (%.4f, %.4f)", i, total_rows, name, lat, lon)
            elif address:
                coords = geocode_address(address)
                lat = coords[0] if coords else None
                lon = coords[1] if coords else None
                status = "found" if coords else "not_found"
                if not YANDEX_GEOCODER_API_KEY:
                    time.sleep(1.1)
                logger.info("Import %d/%d — %s → geocoded (yandex failed) → %s", i, total_rows, name, status)

        # 3. Geocode address
        elif address:
            coords = geocode_address(address)
            lat = coords[0] if coords else None
            lon = coords[1] if coords else None
            status = "found" if coords else "not_found"
            logger.info("Import %d/%d — %s → geocoded '%s' → %s", i, total_rows, name, address, status)
            if not YANDEX_GEOCODER_API_KEY:
                time.sleep(1.1)

        if not address:
            address = (f"{lat:.5f}, {lon:.5f}" if lat is not None else "Адрес не указан")

        final_map_url = map_url or yandex_url

        # Duplicate detection (non-blocking — warn only)
        dup_warning = None
        if lat is not None and lon is not None:
            nearby = find_nearby_stores(lat, lon, radius_m=20, owner_id=owner_id)
            if nearby:
                near = nearby[0]
                dup_warning = {
                    "row": i,
                    "name": name,
                    "existing_id": near["id"],
                    "existing_name": near["name"],
                    "dist_m": round(float(near["dist_m"]), 1),
                }
                logger.info("Import row %d — possible duplicate: '%s' ≈ id=%d '%s' (%.1fm)",
                            i, name, near["id"], near["name"], near["dist_m"])

        try:
            conn = get_db()
            cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur.execute(
                """INSERT INTO stores (name, address, lat, lon, map_url, geocode_status, time_window_from, time_window_to, unload_minutes, owner_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (name, address, lat, lon, final_map_url, status, tw_from, tw_to, unload, owner_id)
            )
            db_row = cur.fetchone()
            conn.commit()
            cur.close()
            conn.close()
            stores.append(store_row_to_dict(db_row))
            imported += 1
            if dup_warning:
                duplicates.append(dup_warning)
        except Exception as e:
            logger.error(f"Failed to insert store row {i}: {e}")
            failed += 1

    return {
        "total": imported + failed,
        "imported": imported,
        "failed": failed,
        "stores": stores,
        "duplicates": duplicates,
    }


def _normalize_for_dedup(s) -> str:
    """Lowercase, trim, collapse whitespace — used as dedup key for (name, address)."""
    import re as _re_dedup
    return _re_dedup.sub(r'\s+', ' ', str(s or "").lower().strip())


# ── Extended keyword lists (SmartRoute + 1C terms) ─────────────────────────
_KWORDS_NAME    = ["контрагент", "клиент", "покупатель", "store name", "назван", "name", "store_name"]
_KWORDS_ADDRESS = ["адрес доставки", "адрес", "address"]
_KWORDS_CITY    = ["город", "city"]
_KWORDS_YANDEX  = ["ссылка яндекс", "яндекс", "yandex", "ссылка"]
_KWORDS_UNLOAD  = ["разгрузка", "unload"]
_KWORDS_FROM    = ["время с", "open_time", "с (", "time_from"]
_KWORDS_TO      = ["время до", "close_time", "до (", "time_to"]


def _detect_col(header_lower: list, candidates: list) -> Optional[int]:
    for kw in candidates:
        for i, h in enumerate(header_lower):
            if kw in h:
                return i
    return None


@app.post("/api/stores/import/preview")
async def preview_import(file: UploadFile = File(...)):
    """Read Excel file, return columns + first rows + auto-detected column mapping.
    Used by the frontend to show a mapping dialog before the actual import."""
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")
    content = await file.read()
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Не удалось открыть Excel файл: {e}")
    ws = wb.active

    raw_headers = list(next(ws.iter_rows(min_row=1, max_row=1, values_only=True), []))
    columns = [str(c).strip() if c is not None else f"Колонка {i+1}" for i, c in enumerate(raw_headers)]
    header_lower = [c.lower() for c in columns]

    # Collect all data rows (skip ← hint rows)
    all_data_rows = [
        r for r in ws.iter_rows(min_row=2, values_only=True)
        if r and any(c is not None for c in r)
        and not str(r[0] or "").strip().startswith("←")
    ]
    total_rows = len(all_data_rows)

    # First 5 rows for preview table
    preview_rows = []
    for row in all_data_rows[:5]:
        preview_rows.append([
            str(c).strip() if c is not None else ""
            for c in list(row) + [""] * max(0, len(columns) - len(row))
        ][:len(columns)])

    # Auto-detect column mapping
    c_name    = _detect_col(header_lower, _KWORDS_NAME)
    c_address = _detect_col(header_lower, _KWORDS_ADDRESS)
    c_city    = _detect_col(header_lower, _KWORDS_CITY)
    c_yandex  = _detect_col(header_lower, _KWORDS_YANDEX)
    c_unload  = _detect_col(header_lower, _KWORDS_UNLOAD)
    c_from    = _detect_col(header_lower, _KWORDS_FROM)
    c_to      = _detect_col(header_lower, _KWORDS_TO)

    # Positional fallback for unrecognised headers (old SmartRoute template)
    if c_name is None:
        c_name = 0
    if c_address is None and c_yandex is None and len(columns) > 1:
        c_address = 1

    # Count unique points after dedup (name + address) for info display
    seen: set = set()
    for row in all_data_rows:
        def _gv(idx):
            if idx is None or idx >= len(row): return ""
            return str(row[idx] or "").strip()
        n = _normalize_for_dedup(_gv(c_name))
        a = _normalize_for_dedup(_gv(c_address))
        if n:
            seen.add((n, a))

    return {
        "columns": columns,
        "rows": preview_rows,
        "total_rows": total_rows,
        "unique_count": len(seen),
        "mapping": {
            "name":    c_name,
            "address": c_address,
            "city":    c_city,
            "yandex":  c_yandex,
            "unload":  c_unload,
            "tw_from": c_from,
            "tw_to":   c_to,
        },
    }


def _import_process_content_sync(content_bytes: bytes, job: dict, mapping: Optional[dict] = None, owner_id: int = None) -> None:
    """Run Excel import synchronously, updating job dict for progress tracking.
    Called from background thread by /api/stores/import/start endpoint.
    mapping: optional dict with column indices {name, address, city, yandex, unload, tw_from, tw_to}."""
    if not OPENPYXL_AVAILABLE:
        job["error"] = "openpyxl not installed"
        job["done"] = True
        return
    try:
        wb = openpyxl.load_workbook(io.BytesIO(content_bytes))
    except Exception as e:
        job["error"] = f"Не удалось открыть Excel файл: {e}"
        job["done"] = True
        return

    ws = wb.active
    header_row = [str(c).strip().lower() if c else "" for c in next(ws.iter_rows(min_row=1, max_row=1, values_only=True), [])]

    # ── Column indices: use caller-supplied mapping, else auto-detect ──────────
    if mapping:
        c_name      = mapping.get("name")
        c_yandex    = mapping.get("yandex")
        c_addr      = mapping.get("address")
        c_city      = mapping.get("city")
        c_unload    = mapping.get("unload")
        c_from      = mapping.get("tw_from")
        c_to        = mapping.get("tw_to")
        default_city = str(mapping.get("default_city") or "").strip()
        # lat/lon/mapurl always auto-detected (not exposed in mapping UI)
        c_lat    = _detect_col(header_row, ["широта", "lat", "latitude"])
        c_lon    = _detect_col(header_row, ["долгота", "lon", "longitude"])
        c_mapurl = _detect_col(header_row, ["map_url", "ссылка на карт"])
    else:
        default_city = ""
        c_name   = _detect_col(header_row, _KWORDS_NAME)
        c_yandex = _detect_col(header_row, _KWORDS_YANDEX)
        c_addr   = _detect_col(header_row, _KWORDS_ADDRESS)
        c_city   = _detect_col(header_row, _KWORDS_CITY)
        c_lat    = _detect_col(header_row, ["широта", "lat", "latitude"])
        c_lon    = _detect_col(header_row, ["долгота", "lon", "longitude"])
        c_mapurl = _detect_col(header_row, ["map_url", "ссылка на карт"])
        c_unload = _detect_col(header_row, _KWORDS_UNLOAD)
        c_from   = _detect_col(header_row, _KWORDS_FROM)
        c_to     = _detect_col(header_row, _KWORDS_TO)

    if c_name is None:
        c_name = 0
    if c_addr is None and c_yandex is None:
        c_addr = 1

    def _get(row, idx, default=""):
        if idx is None or idx >= len(row):
            return default
        v = row[idx]
        return v if v is not None else default

    all_rows = [
        r for r in ws.iter_rows(min_row=2, values_only=True)
        if r and r[0] and not str(r[0]).strip().startswith("←")
    ]

    # ── Deduplication by (normalize(name), normalize(address)) ───────────────
    # Typical 1C export: same store appears once per product line.
    # We collapse all duplicate (name+address) pairs to a single row BEFORE geocoding.
    seen_dedup: dict = {}
    deduped_rows = []
    for row in all_rows:
        n_key = _normalize_for_dedup(_get(row, c_name, ""))
        a_key = _normalize_for_dedup(_get(row, c_addr, ""))
        key = (n_key, a_key)
        if n_key and key not in seen_dedup:
            seen_dedup[key] = True
            deduped_rows.append(row)
    skipped_dedup = len(all_rows) - len(deduped_rows)
    if skipped_dedup:
        logger.info("Import dedup: removed %d duplicate rows, %d unique points remain", skipped_dedup, len(deduped_rows))

    total_rows = len(deduped_rows)
    job["total"] = total_rows
    job["deduped"] = skipped_dedup
    imported, failed = 0, 0
    stores_out: list = []
    duplicates: list = []

    for i, row in enumerate(deduped_rows, start=1):
        name       = str(_get(row, c_name, "")).strip()
        yandex_url = str(_get(row, c_yandex, "")).strip() or None
        city       = str(_get(row, c_city, "")).strip() or default_city
        raw_addr   = str(_get(row, c_addr, "")).strip()
        address    = f"{city}, {raw_addr}" if city and city not in raw_addr else raw_addr
        if not address:
            address = city

        if not name or (not yandex_url and not address):
            failed += 1
            job["processed"] = i; job["failed"] = failed
            continue

        raw_lat = _get(row, c_lat)
        raw_lon = _get(row, c_lon)
        map_url = str(_get(row, c_mapurl, "")).strip() or None

        if c_from is None and len(row) > 2 and row[2] and ":" in str(row[2]):
            tw_from = str(row[2]).strip()
            tw_to   = str(row[3]).strip() if len(row) > 3 and row[3] else "18:00"
            unload  = int(row[4]) if len(row) > 4 and row[4] else 15
        else:
            tw_from = str(_get(row, c_from, "09:00")).strip() or "09:00"
            tw_to   = str(_get(row, c_to, "18:00")).strip() or "18:00"
            try:
                unload = int(_get(row, c_unload, 15))
            except (ValueError, TypeError):
                unload = 15

        lat, lon, status = None, None, "not_found"
        try:
            pv_lat = float(raw_lat) if raw_lat not in (None, "", "None") else None
            pv_lon = float(raw_lon) if raw_lon not in (None, "", "None") else None
        except (ValueError, TypeError):
            pv_lat = pv_lon = None

        if pv_lat is not None and pv_lon is not None and (-90 <= pv_lat <= 90) and (-180 <= pv_lon <= 180):
            lat, lon, status = pv_lat, pv_lon, "found"
        elif yandex_url:
            lat, lon = parse_yandex_link(yandex_url)
            if lat is not None:
                status = "found"
                if not address:
                    address = reverse_geocode_nominatim(lat, lon) or f"{lat:.5f}, {lon:.5f}"
            elif address:
                coords = geocode_address(address)
                lat, lon = (coords[0], coords[1]) if coords else (None, None)
                status = "found" if coords else "not_found"
                if not YANDEX_GEOCODER_API_KEY:
                    time.sleep(1.1)
        elif address:
            coords = geocode_address(address)
            lat, lon = (coords[0], coords[1]) if coords else (None, None)
            status = "found" if coords else "not_found"
            if not YANDEX_GEOCODER_API_KEY:
                time.sleep(1.1)

        if not address:
            address = f"{lat:.5f}, {lon:.5f}" if lat is not None else "Адрес не указан"

        final_map_url = map_url or yandex_url

        dup_warning = None
        if lat is not None and lon is not None:
            nearby = find_nearby_stores(lat, lon, radius_m=20)
            if nearby:
                near = nearby[0]
                dup_warning = {
                    "row": i, "name": name, "address": address,
                    "existing_id": near["id"], "existing_name": near["name"],
                    "existing_address": near.get("address") or "",
                    "dist_m": round(float(near["dist_m"]), 1),
                }

        try:
            conn2 = get_db()
            cur2 = conn2.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cur2.execute(
                """INSERT INTO stores (name, address, lat, lon, map_url, geocode_status, time_window_from, time_window_to, unload_minutes, owner_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING *""",
                (name, address, lat, lon, final_map_url, status, tw_from, tw_to, unload, owner_id),
            )
            db_row = cur2.fetchone()
            conn2.commit(); cur2.close(); conn2.close()
            stores_out.append(store_row_to_dict(db_row))
            imported += 1
            if dup_warning:
                dup_warning["new_store_id"] = db_row["id"]
                duplicates.append(dup_warning)
        except Exception as e:
            logger.error("Import job row %d failed: %s", i, e)
            failed += 1

        job["processed"] = i
        job["imported"] = imported
        job["failed"] = failed
        job["duplicates"] = duplicates

    geocoded_found = sum(1 for s in stores_out if s.get("geocode_status") == "found")
    geocoded_not_found = sum(1 for s in stores_out if s.get("geocode_status") != "found")

    job["stores"] = stores_out
    job["geocoded_found"] = geocoded_found
    job["geocoded_not_found"] = geocoded_not_found
    job["deduped"] = skipped_dedup
    job["done"] = True
    logger.info("Import job done: %d imported (%d geocoded, %d no-coords), %d failed, %d duplicates, %d deduped",
                imported, geocoded_found, geocoded_not_found, failed, len(duplicates), skipped_dedup)


@app.post("/api/stores/import/start", status_code=202)
async def start_import_stores(request: Request, file: UploadFile = File(...), mapping: Optional[str] = Form(None)):
    """Start async background import. Returns job_id for progress polling.
    mapping: optional JSON string with column indices {name, address, city, yandex, unload, tw_from, tw_to}."""
    uid = get_user_id(request)
    if not OPENPYXL_AVAILABLE:
        raise HTTPException(status_code=500, detail="openpyxl not installed")
    content = await file.read()

    parsed_mapping: Optional[dict] = None
    if mapping:
        try:
            parsed_mapping = json.loads(mapping)
        except Exception:
            raise HTTPException(status_code=422, detail="mapping must be valid JSON")

    job_id = _uuid.uuid4().hex[:8]
    job: dict = {
        "total": 0, "processed": 0, "imported": 0, "failed": 0,
        "done": False, "stores": [], "duplicates": [], "error": None, "deduped": 0,
        "owner_id": uid,
    }
    import_jobs[job_id] = job
    t = threading.Thread(target=_import_process_content_sync, args=(content, job, parsed_mapping, uid), daemon=True)
    t.start()
    return {"job_id": job_id}


@app.get("/api/stores/import/progress/{job_id}")
def get_import_progress(job_id: str, request: Request):
    """Poll import job progress. Returns current counters + done flag."""
    uid = get_user_id(request)
    if job_id not in import_jobs:
        raise HTTPException(status_code=404, detail="Import job not found")
    job = import_jobs[job_id]
    if job.get("owner_id") is not None and job["owner_id"] != uid:
        raise HTTPException(status_code=403, detail="Нет доступа к этому заданию импорта")
    return {
        "job_id": job_id,
        "total": job["total"],
        "processed": job["processed"],
        "imported": job["imported"],
        "failed": job["failed"],
        "done": job["done"],
        "duplicate_count": len(job.get("duplicates", [])),
        "error": job.get("error"),
    }


@app.get("/api/stores/import/result/{job_id}")
def get_import_result(job_id: str, request: Request):
    """Fetch final result of a completed import job."""
    uid = get_user_id(request)
    if job_id not in import_jobs:
        raise HTTPException(status_code=404, detail="Import job not found")
    job = import_jobs[job_id]
    if job.get("owner_id") is not None and job["owner_id"] != uid:
        raise HTTPException(status_code=403, detail="Нет доступа к этому заданию импорта")
    return {
        "total": job["total"],
        "imported": job["imported"],
        "failed": job["failed"],
        "stores": job.get("stores", []),
        "duplicates": job.get("duplicates", []),
        "deduped": job.get("deduped", 0),
        "geocoded_found": job.get("geocoded_found", 0),
        "geocoded_not_found": job.get("geocoded_not_found", 0),
        "done": job["done"],
        "error": job.get("error"),
    }


@app.get("/api/stores/{id}")
def get_store(id: int, request: Request):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM stores WHERE id = %s AND owner_id = %s", (id, uid))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Store not found")
    return store_row_to_dict(row)


@app.put("/api/stores/{id}")
def update_store(id: int, body: StoreUpdate, request: Request):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM stores WHERE id = %s AND owner_id = %s", (id, uid))
    existing = cur.fetchone()
    if not existing:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Store not found")

    fields = {}
    if body.name is not None:
        fields["name"] = body.name
    if body.address is not None:
        fields["address"] = body.address
        # Re-geocode if address changed
        coords = geocode_address(body.address)
        if coords:
            fields["lat"] = coords[0]
            fields["lon"] = coords[1]
            fields["geocode_status"] = "found"
        else:
            fields["lat"] = None
            fields["lon"] = None
            fields["geocode_status"] = "not_found"
    if body.yandex_url is not None:
        yurl = body.yandex_url.strip() if body.yandex_url else None
        fields["map_url"] = yurl
        if yurl:
            lat_y, lon_y = parse_yandex_link(yurl)
            if lat_y is not None and lon_y is not None:
                fields["lat"] = lat_y
                fields["lon"] = lon_y
                fields["geocode_status"] = "found"
    if body.city is not None:
        # Store city as part of address if address not separately updated
        pass  # city is used in geocoding, stored implicitly in address
    if body.lat is not None:
        fields["lat"] = body.lat
    if body.lon is not None:
        fields["lon"] = body.lon
    if body.time_window_from is not None:
        fields["time_window_from"] = body.time_window_from
    if body.time_window_to is not None:
        fields["time_window_to"] = body.time_window_to
    if body.unload_minutes is not None:
        fields["unload_minutes"] = body.unload_minutes

    if fields:
        set_clause = ", ".join(f"{k} = %s" for k in fields)
        values = list(fields.values()) + [id, uid]
        cur.execute(f"UPDATE stores SET {set_clause} WHERE id = %s AND owner_id = %s RETURNING *", values)
        row = cur.fetchone()
        conn.commit()
    else:
        row = existing

    cur.close()
    conn.close()
    return store_row_to_dict(row)


@app.delete("/api/stores/{id}", status_code=204)
def delete_store(id: int, request: Request):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM stores WHERE id = %s AND owner_id = %s", (id, uid))
    deleted = cur.rowcount
    conn.commit()
    cur.close()
    conn.close()
    if deleted == 0:
        raise HTTPException(status_code=404, detail="Store not found")


@app.post("/api/stores/{id}/geocode")
def geocode_store(id: int, request: Request):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM stores WHERE id = %s AND owner_id = %s", (id, uid))
    store = cur.fetchone()
    if not store:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Store not found")

    coords = geocode_address(store["address"])
    lat = coords[0] if coords else None
    lon = coords[1] if coords else None
    status = "found" if coords else "not_found"

    cur.execute(
        "UPDATE stores SET lat = %s, lon = %s, geocode_status = %s WHERE id = %s AND owner_id = %s RETURNING *",
        (lat, lon, status, id, uid)
    )
    row = cur.fetchone()
    conn.commit()
    cur.close()
    conn.close()
    return store_row_to_dict(row)


@app.post("/api/route/build")
def build_route(request: Request, body: RouteRequest):
    uid = get_user_id(request)
    if not body.store_ids:
        raise HTTPException(status_code=400, detail="No stores selected")
    if not body.vehicles:
        raise HTTPException(status_code=400, detail="No vehicles provided")

    # Validate depot coordinates
    if body.depot_lat is not None and not (-90 <= body.depot_lat <= 90):
        raise HTTPException(status_code=422, detail="Широта склада должна быть от -90 до 90")
    if body.depot_lon is not None and not (-180 <= body.depot_lon <= 180):
        raise HTTPException(status_code=422, detail="Долгота склада должна быть от -180 до 180")

    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    placeholders = ",".join(["%s"] * len(body.store_ids))
    # Filter by owner_id to prevent cross-user store access
    cur.execute(
        f"SELECT * FROM stores WHERE id IN ({placeholders}) AND owner_id = %s",
        (*body.store_ids, uid)
    )
    stores_rows = {r["id"]: r for r in cur.fetchall()}
    cur.close()
    conn.close()

    # Depot coordinates
    depot_lat = body.depot_lat or 42.9849
    depot_lon = body.depot_lon or 47.5046

    # Build coordinate list: depot first, then stores (preserve input order for savings baseline)
    store_list = [stores_rows[sid] for sid in body.store_ids if sid in stores_rows and stores_rows[sid]["lat"]]
    if not store_list:
        raise HTTPException(status_code=400, detail="No geocoded stores found")

    num_vehicles = len(body.vehicles)

    # ── Vehicle count validation ──────────────────────────────────────────────
    if num_vehicles > len(store_list):
        raise HTTPException(
            status_code=422,
            detail=(
                f"Количество машин ({num_vehicles}) превышает количество магазинов "
                f"({len(store_list)}). Уменьшите число машин до {len(store_list)} или меньше."
            ),
        )

    all_coords = [(depot_lat, depot_lon)] + [(s["lat"], s["lon"]) for s in store_list]

    capacities = None
    demands = None
    if any(v.capacity_kg for v in body.vehicles):
        capacities = [int(v.capacity_kg) if v.capacity_kg else 99999 for v in body.vehicles]
        demands = [0] + [1] * len(store_list)  # 1 unit per store

    # ── Time windows (TSPTW) ─────────────────────────────────────────────────
    # When use_time_windows is True, pass (tw_from_min, tw_to_min, service_min)
    # per store to solve_vrp so OR-Tools enforces arrival constraints.
    store_time_windows = None
    route_warnings: list[str] = []   # non-fatal issues surfaced to the frontend
    if body.use_time_windows:
        store_time_windows = []
        invalid_tw_count = 0
        for s in store_list:
            tw_from = _parse_time_to_minutes(s.get("time_window_from") or "09:00")
            tw_to   = _parse_time_to_minutes(s.get("time_window_to")   or "18:00")
            service = int(s.get("unload_minutes") or 15) if body.use_unload_time else 0
            # Pre-validate: tw_from must be strictly less than tw_to, and window
            # must not close before depot departure (09:00 = 540 min).
            if tw_from >= tw_to or tw_to < 9 * 60:
                invalid_tw_count += 1
                tw_from, tw_to = 9 * 60, 23 * 60  # expand to full working day
            store_time_windows.append((tw_from, tw_to, service))
        if invalid_tw_count:
            route_warnings.append(
                f"{invalid_tw_count} магазин(ов) имели некорректные временные окна "
                f"(tw_from≥tw_to или закрытие раньше 09:00) — заменены на полный день."
            )
            logger.warning(
                "build_route: %d stores had invalid time windows (tw_from>=tw_to or "
                "tw_to<09:00) — replaced with full-day window",
                invalid_tw_count,
            )
        logger.info(
            "build_route: time windows enabled for %d stores (use_unload=%s)",
            len(store_time_windows), body.use_unload_time,
        )

    logger.info(
        "solve_vrp: %d stores, %d vehicles, capacities=%s, time_windows=%s",
        len(store_list), num_vehicles, capacities,
        "yes" if store_time_windows else "no",
    )

    # ── Degradation chain ────────────────────────────────────────────────────
    # Level 1: TW enabled (if requested)
    # Level 2: retry without TW on any solver exception
    # Level 3: greedy round-robin fallback if Level 2 also fails
    # Never return HTTP 500 — always produce a route or a clear 422 message.
    matrix_source = "haversine"
    # Validate max_stops_per_vehicle
    max_stops_cap = body.max_stops_per_vehicle
    if max_stops_cap is not None:
        if max_stops_cap < 1:
            raise HTTPException(
                status_code=422,
                detail="max_stops_per_vehicle должен быть ≥ 1"
            )
        avg_stops = len(store_list) / max(num_vehicles, 1)
        if max_stops_cap < math.ceil(avg_stops):
            raise HTTPException(
                status_code=422,
                detail=(
                    f"max_stops_per_vehicle={max_stops_cap} слишком мало: "
                    f"при {len(store_list)} магазинах и {num_vehicles} машинах "
                    f"минимальное значение = {math.ceil(avg_stops)} (среднее кол-во точек на машину)."
                )
            )
        logger.info(
            "build_route: max_stops_per_vehicle=%d requested (avg=%.1f per vehicle)",
            max_stops_cap, avg_stops,
        )

    # ── Auto-cap: apply ceil(avg × 1.5) when user did not specify a limit ─────
    # Prevents extreme imbalances like 34 / 8 / 7 stops caused by geographic
    # clustering without a ceiling.  Symmetric counterpart to the 0.70×avg floor
    # already applied by _rebalance_min_stops.  Silently logged; user can still
    # override by selecting one of the manual ≤N buttons in the UI.
    effective_max_stops = max_stops_cap
    if effective_max_stops is None and len(store_list) > 0 and num_vehicles > 0:
        _auto_avg = len(store_list) / num_vehicles
        effective_max_stops = math.ceil(_auto_avg * 1.5)
        logger.info(
            "build_route: auto max_stops_per_vehicle=%d "
            "(%.0f stores / %d vehicles, avg=%.1f × 1.5)",
            effective_max_stops, len(store_list), num_vehicles, _auto_avg,
        )

    # Validate optimize_by
    if body.optimize_by not in ("distance", "time"):
        raise HTTPException(
            status_code=422,
            detail="optimize_by должен быть 'distance' или 'time'"
        )
    if body.optimize_by == "time":
        logger.info("build_route: time-optimisation mode requested")

    try:
        vehicle_routes_indices, matrix_source = solve_vrp(
            all_coords, num_vehicles, capacities, demands, store_time_windows,
            max_stops_per_vehicle=effective_max_stops,
            optimize_by=body.optimize_by,
        )
    except Exception as vrp_exc_1:
        logger.error("solve_vrp (with TW) failed:\n%s", traceback.format_exc())
        if store_time_windows is not None:
            # Level 2: disable time windows and retry
            route_warnings.append(
                "Временные окна привели к неразрешимой задаче и были отключены. "
                "Маршрут построен без учёта временных окон."
            )
            logger.warning(
                "build_route: degrading to no-TW solve (%s stores, %s vehicles)",
                len(store_list), num_vehicles,
            )
            try:
                vehicle_routes_indices, matrix_source = solve_vrp(
                    all_coords, num_vehicles, capacities, demands, None,
                    max_stops_per_vehicle=effective_max_stops,
                    optimize_by=body.optimize_by,
                )
            except Exception as vrp_exc_2:
                logger.error("solve_vrp (no TW) also failed:\n%s", traceback.format_exc())
                # Level 3: greedy round-robin — cannot fail
                route_warnings.append(
                    "Оптимизатор маршрутов недоступен. Магазины распределены по машинам "
                    "в порядке загрузки (round-robin). Результат не оптимален."
                )
                logger.warning("build_route: falling back to greedy round-robin distribution")
                store_nodes = list(range(1, len(all_coords)))
                vehicle_routes_indices = _fallback_distribution(store_nodes, num_vehicles)
                matrix_source = "haversine"
        else:
            # No TW was requested and basic VRP still failed — greedy fallback
            route_warnings.append(
                "Оптимизатор маршрутов недоступен. Магазины распределены по машинам "
                "в порядке загрузки (round-robin). Результат не оптимален."
            )
            logger.warning("build_route: falling back to greedy round-robin (no TW requested)")
            store_nodes = list(range(1, len(all_coords)))
            vehicle_routes_indices = _fallback_distribution(store_nodes, num_vehicles)
            matrix_source = "haversine"

    logger.info("solve_vrp result: %s routes", len(vehicle_routes_indices))

    # ── OSRM ETA: fetch real road travel times for each finalised route ────────
    # Separate post-solve calls — do NOT affect routing decisions.
    # We call OSRM once per route with the final ordered coordinates and read
    # consecutive leg times from the returned duration matrix diagonal.
    # Falls back to Haversine formula (ETA_ROAD_FACTOR) if OSRM unavailable.
    _route_leg_times: list = [None] * len(body.vehicles)
    _eta_coord_lists: list = []
    for _vi_eta, _v_eta in enumerate(body.vehicles):
        if _vi_eta >= len(vehicle_routes_indices) or not vehicle_routes_indices[_vi_eta]:
            _eta_coord_lists.append(None)
            continue
        _coords_eta = [(depot_lat, depot_lon)]
        for _idx_eta in vehicle_routes_indices[_vi_eta]:
            _sidx_eta = _idx_eta - 1
            if 0 <= _sidx_eta < len(store_list):
                _s_eta = store_list[_sidx_eta]
                _coords_eta.append((_s_eta["lat"], _s_eta["lon"]))
        _eta_coord_lists.append(_coords_eta if len(_coords_eta) >= 2 else None)

    _eta_workers = min(len([c for c in _eta_coord_lists if c is not None]), 8)
    if _eta_workers > 0:
        with concurrent.futures.ThreadPoolExecutor(max_workers=_eta_workers) as _eta_pool:
            _eta_futures = {
                _eta_pool.submit(_fetch_route_leg_times_osrm, _coords): _vi
                for _vi, _coords in enumerate(_eta_coord_lists)
                if _coords is not None
            }
            for _fut, _vi in _eta_futures.items():
                try:
                    _route_leg_times[_vi] = _fut.result()
                except Exception:
                    pass

    _osrm_eta_ok = sum(1 for t in _route_leg_times if t is not None)
    logger.info(
        "OSRM ETA prefetch: %d/%d routes have real road times (fallback=Haversine for rest)",
        _osrm_eta_ok, len(body.vehicles),
    )

    # Build result
    routes = []
    total_km = 0.0

    for vi, vehicle in enumerate(body.vehicles):
        if vi >= len(vehicle_routes_indices):
            break
        route_indices = vehicle_routes_indices[vi]
        if not route_indices:
            continue

        ROUTE_START_MINUTES = 9 * 60  # 09:00 departure from depot
        route_stores = []
        # ETA_ROAD_FACTOR: Haversine → road km conversion.  Used ONLY as fallback
        # when OSRM leg times are unavailable for this route.
        ETA_ROAD_FACTOR = 2.0
        route_coords = [(depot_lat, depot_lon)]
        dist_m = 0
        cumulative_min = 0  # elapsed minutes since 09:00
        prev_coord = (depot_lat, depot_lon)
        # Per-route OSRM leg times (seconds); None → use Haversine fallback
        leg_times = _route_leg_times[vi] if vi < len(_route_leg_times) else None
        # Sanity-check: any leg > 2 h (7 200 s) signals an unreachable/sea location
        # — discard the whole route's OSRM data and fall back to Haversine.
        if leg_times is not None and any(t > 7200 for t in leg_times):
            logger.warning(
                "OSRM ETA route %d: discarded — leg > 2h (likely unreachable coordinate)",
                vi,
            )
            leg_times = None
        leg_idx = 0  # cursor into leg_times list

        for order, idx in enumerate(route_indices, 1):
            store_idx = idx - 1  # node 0 = depot, node i = store_list[i-1]
            if store_idx < 0 or store_idx >= len(store_list):
                logger.warning("VRP returned out-of-range node %d (store_list len=%d) — skipping", idx, len(store_list))
                continue
            store = store_list[store_idx]
            curr_coord = (store["lat"], store["lon"])

            # Drive time from previous point
            leg_m = haversine_meters(prev_coord, curr_coord)
            dist_m += leg_m
            effective_speed = vehicle.average_speed if vehicle.average_speed else AVG_SPEED_KMH
            if leg_times is not None and leg_idx < len(leg_times):
                # Real OSRM road time — most accurate
                leg_drive_min = max(1, int(leg_times[leg_idx] / 60))
            else:
                # Haversine fallback (OSRM unavailable for this leg)
                leg_drive_min = max(1, int(leg_m * ETA_ROAD_FACTOR / 1000 / effective_speed * 60))
            leg_idx += 1
            cumulative_min += leg_drive_min

            # Estimated arrival time at this stop
            abs_min = ROUTE_START_MINUTES + cumulative_min
            arrive_hour = (abs_min // 60) % 24
            arrive_min_part = abs_min % 60
            arrive_by = f"{arrive_hour:02d}:{arrive_min_part:02d}"

            route_coords.append(curr_coord)
            route_stores.append({
                "order": order,
                "store_id": store["id"],
                "store_name": store["name"],
                "address": store["address"],
                "lat": store["lat"],
                "lon": store["lon"],
                "arrive_by": arrive_by,
            })

            # Add unload time before driving to the next stop
            if body.use_unload_time:
                cumulative_min += store.get("unload_minutes", 15)

            prev_coord = curr_coord

        # Return to depot distance
        if len(route_coords) > 1:
            dist_m += haversine_meters(route_coords[-1], (depot_lat, depot_lon))

        km = dist_m / 1000.0
        total_km += km

        unload_min = sum(s["unload_minutes"] for s in store_list if s["id"] in [rs["store_id"] for rs in route_stores]) if body.use_unload_time else 0
        eff_spd = vehicle.average_speed if vehicle.average_speed else AVG_SPEED_KMH
        if leg_times is not None:
            # Sum of all OSRM leg times for this route (seconds → minutes)
            drive_min = max(1, int(sum(leg_times) / 60))
        else:
            drive_min = int(km * ETA_ROAD_FACTOR / eff_spd * 60)
        est_minutes = drive_min + unload_min

        # depot (route_coords[0]) остаётся первой точкой — Яндекс заменит его
        # GPS-позицией водителя, но все магазины сохранятся на своих местах.
        yurls = yandex_nav_urls(route_coords) if len(route_coords) > 1 else []
        yurl = yurls[0] if yurls else ""
        wurl = whatsapp_url(vehicle.name, route_stores, km, yurls)

        routes.append({
            "vehicle_name": vehicle.name,
            "stores": route_stores,
            "total_km": round(km, 1),
            "estimated_minutes": est_minutes,
            # ETA breakdown — allows frontend to display drive vs service separately
            "drive_minutes": drive_min,
            "service_minutes": unload_min,
            "yandex_url": yurl,
            "yandex_urls": yurls,
            "whatsapp_url": wurl,
        })

    _cost_settings = get_company_settings(user_id=uid)
    savings = calculate_savings(
        total_km,
        store_list,      # passed in original input order — used as baseline
        num_vehicles,
        depot_lat,
        depot_lon,
        settings=_cost_settings,
    )

    result = {
        "routes": routes,
        "savings": savings,
        "total_km": round(total_km, 1),
        "matrix_source": matrix_source,
        "geocoder_used": "yandex" if YANDEX_GEOCODER_API_KEY else "nominatim",
        "session_id": None,
        "warnings": route_warnings,  # non-fatal degradation notices for the frontend
        # Saved for historical replay — tells frontend whether estimated_minutes
        # includes service time (15 min/stop) or is drive-only
        "use_unload_time": bool(body.use_unload_time),
        "optimize_by": body.optimize_by,
    }

    # Save session to DB
    try:
        conn2 = get_db()
        cur2 = conn2.cursor()
        cur2.execute(
            """INSERT INTO route_sessions (date, num_vehicles, total_km, saved_km, saved_rub, num_points, cost_per_km, result_json, owner_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
            (str(date.today()), num_vehicles, round(total_km, 1),
             savings["saved_km"], savings["saved_rub_day"], len(store_list),
             savings.get("cost_per_km"), json.dumps(result), uid)
        )
        session_id = cur2.fetchone()[0]
        result["session_id"] = session_id
        cur2.execute("UPDATE route_sessions SET result_json = %s WHERE id = %s",
                     (json.dumps(result), session_id))
        for rs in routes:
            for stop in rs["stores"]:
                cur2.execute(
                    "INSERT INTO route_session_stores (session_id, store_id, visit_order) VALUES (%s, %s, %s)",
                    (session_id, stop["store_id"], stop["order"])
                )
        conn2.commit()
        cur2.close()
        conn2.close()
    except Exception as e:
        logger.error(f"Failed to save route session: {e}")

    return result


@app.get("/api/route/sessions/{id}")
def get_route_session(id: int, request: Request):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT result_json FROM route_sessions WHERE id = %s AND owner_id = %s", (id, uid))
    row = cur.fetchone()
    cur.close()
    conn.close()
    if not row or not row["result_json"]:
        raise HTTPException(status_code=404, detail="Route session not found")
    return json.loads(row["result_json"])


@app.delete("/api/route/sessions/{id}")
def delete_route_session(id: int, request: Request):
    """Удалить сессию маршрута по ID."""
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("DELETE FROM route_sessions WHERE id = %s AND owner_id = %s", (id, uid))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Route session not found")
        conn.commit()
        return {"ok": True}
    finally:
        cur.close()
        conn.close()


@app.get("/api/route/sessions")
def list_route_sessions(request: Request, page: int = 1, page_size: int = 20):
    """Список сессий маршрутов с пагинацией."""
    uid = get_user_id(request)
    if page < 1:
        page = 1
    if page_size < 1 or page_size > 200:
        page_size = 20
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute("SELECT COUNT(*) as total FROM route_sessions WHERE owner_id = %s", (uid,))
        total = int(cur.fetchone()["total"])
        offset = (page - 1) * page_size
        cur.execute(
            """SELECT id, date, num_vehicles, total_km, saved_km, saved_rub, num_points, created_at
               FROM route_sessions
               WHERE owner_id = %s
               ORDER BY created_at DESC
               LIMIT %s OFFSET %s""",
            (uid, page_size, offset),
        )
        rows = cur.fetchall()
        return {
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": [
                {
                    "id": r["id"],
                    "date": r["date"],
                    "num_vehicles": r["num_vehicles"] or 0,
                    "total_km": round(float(r["total_km"] or 0), 1),
                    "saved_km": round(float(r["saved_km"] or 0), 1),
                    "saved_rub": int(r["saved_rub"] or 0),
                    "num_points": r["num_points"] or 0,
                    "created_at": str(r["created_at"]) if r["created_at"] else None,
                }
                for r in rows
            ],
        }
    finally:
        cur.close()
        conn.close()


@app.get("/api/settings")
def get_settings_endpoint(request: Request):
    """Получить текущие параметры расчёта стоимости км (для текущего пользователя)."""
    uid = get_user_id(request)
    return get_company_settings(user_id=uid)


@app.put("/api/settings")
def update_settings_endpoint(request: Request, body: CompanySettingsInput):
    """Обновить параметры расчёта стоимости км. cost_per_km = fuel_price × consumption / 100."""
    uid = get_user_id(request)
    if body.fuel_price <= 0 or body.fuel_consumption <= 0:
        raise HTTPException(status_code=400, detail="Все параметры должны быть положительными числами")
    cost_per_km = round(body.fuel_price * body.fuel_consumption / 100.0, 2)
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("""
            UPDATE company_settings
               SET fuel_price=%s, fuel_consumption=%s, cost_per_km=%s, updated_at=NOW()
             WHERE owner_id=%s
        """, (body.fuel_price, body.fuel_consumption, cost_per_km, uid))
        if cur.rowcount == 0:
            cur.execute("""
                INSERT INTO company_settings (fuel_price, fuel_consumption, cost_per_km, owner_id)
                VALUES (%s, %s, %s, %s)
            """, (body.fuel_price, body.fuel_consumption, cost_per_km, uid))
        conn.commit()
    finally:
        cur.close()
        conn.close()
    return {
        "fuel_price": body.fuel_price,
        "fuel_consumption": body.fuel_consumption,
        "cost_per_km": cost_per_km,
    }


@app.get("/api/analytics/summary")
def get_analytics_summary(request: Request):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            COUNT(*) as total_routes,
            COALESCE(SUM(total_km), 0) as total_km,
            COALESCE(SUM(saved_km), 0) as saved_km,
            COALESCE(SUM(saved_rub), 0) as saved_rub,
            COALESCE(AVG(num_points), 0) as avg_points_per_route
        FROM route_sessions
        WHERE owner_id = %s
    """, (uid,))
    row = cur.fetchone()
    cur.close()
    conn.close()
    return {
        "total_routes": row["total_routes"] or 0,
        "total_km": round(float(row["total_km"] or 0), 1),
        "saved_km": round(float(row["saved_km"] or 0), 1),
        "saved_rub": int(row["saved_rub"] or 0),
        "avg_points_per_route": round(float(row["avg_points_per_route"] or 0), 1),
    }


@app.get("/api/analytics/daily")
def get_analytics_daily(request: Request, date_from: Optional[str] = None, date_to: Optional[str] = None):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    params: list = [uid]
    conditions: list = ["owner_id = %s"]
    if date_from:
        conditions.append("date >= %s")
        params.append(date_from)
    else:
        conditions.append("date >= (CURRENT_DATE - INTERVAL '30 days')::TEXT")
    if date_to:
        conditions.append("date <= %s")
        params.append(date_to)
    where = "WHERE " + " AND ".join(conditions)
    cur.execute(f"""
        SELECT
            date,
            COUNT(*) as routes,
            COALESCE(SUM(total_km), 0) as total_km,
            COALESCE(SUM(saved_km), 0) as saved_km,
            COALESCE(SUM(saved_rub), 0) as saved_rub
        FROM route_sessions
        {where}
        GROUP BY date
        ORDER BY date
    """, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "date": r["date"],
            "routes": r["routes"],
            "total_km": round(float(r["total_km"]), 1),
            "saved_km": round(float(r["saved_km"]), 1),
            "saved_rub": int(r["saved_rub"]),
        }
        for r in rows
    ]


@app.get("/api/analytics/monthly")
def get_analytics_monthly(request: Request, date_from: Optional[str] = None, date_to: Optional[str] = None):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    params: list = [uid]
    conditions: list = ["owner_id = %s"]
    if date_from:
        conditions.append("date >= %s")
        params.append(date_from)
    else:
        conditions.append("created_at >= NOW() - INTERVAL '12 months'")
    if date_to:
        conditions.append("date <= %s")
        params.append(date_to)
    where = "WHERE " + " AND ".join(conditions)
    cur.execute(f"""
        SELECT
            TO_CHAR(created_at, 'YYYY-MM') as month,
            COUNT(*) as routes,
            COALESCE(SUM(total_km), 0) as total_km,
            COALESCE(SUM(saved_rub), 0) as saved_rub
        FROM route_sessions
        {where}
        GROUP BY month
        ORDER BY month
    """, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "month": r["month"],
            "routes": r["routes"],
            "total_km": round(float(r["total_km"]), 1),
            "saved_rub": int(r["saved_rub"]),
        }
        for r in rows
    ]


@app.get("/api/analytics/vehicle-load")
def get_analytics_vehicle_load(request: Request, date_from: Optional[str] = None, date_to: Optional[str] = None):
    """Среднее количество точек на машину по дням."""
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    params: list = [uid]
    conditions = ["owner_id = %s", "num_vehicles > 0", "num_points > 0"]
    if date_from:
        conditions.append("date >= %s")
        params.append(date_from)
    else:
        conditions.append("date >= (CURRENT_DATE - INTERVAL '30 days')::TEXT")
    if date_to:
        conditions.append("date <= %s")
        params.append(date_to)
    where = "WHERE " + " AND ".join(conditions)
    cur.execute(f"""
        SELECT
            date,
            ROUND(AVG(num_points::float / NULLIF(num_vehicles, 0))::numeric, 1) as avg_points_per_vehicle,
            SUM(num_points) as total_points,
            SUM(num_vehicles) as total_vehicles
        FROM route_sessions
        {where}
        GROUP BY date
        ORDER BY date
    """, params)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "date": r["date"],
            "avg_points_per_vehicle": float(r["avg_points_per_vehicle"] or 0),
            "total_points": int(r["total_points"] or 0),
            "total_vehicles": int(r["total_vehicles"] or 0),
        }
        for r in rows
    ]


@app.get("/api/analytics/top-stores")
def get_top_stores(request: Request):
    uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT
            s.id as store_id,
            s.name as store_name,
            COUNT(rss.id) as visit_count
        FROM stores s
        LEFT JOIN route_session_stores rss ON rss.store_id = s.id
        WHERE s.owner_id = %s
        GROUP BY s.id, s.name
        ORDER BY visit_count DESC
        LIMIT 10
    """, (uid,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "store_id": r["store_id"],
            "store_name": r["store_name"],
            "visit_count": r["visit_count"],
        }
        for r in rows
    ]


# ── Admin endpoints ────────────────────────────────────────────────────────────

class AdminUserCreate(BaseModel):
    username: str
    password: str
    is_admin: bool = False
    plan: str = "trial"
    admin_note: str = ""

class AdminUserUpdate(BaseModel):
    password: Optional[str] = None
    is_admin: Optional[bool] = None
    is_active: Optional[bool] = None
    plan: Optional[str] = None
    admin_note: Optional[str] = None


def _count_active_admins() -> int:
    """Count total active admins in the system."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM users WHERE is_admin=TRUE AND is_active=TRUE")
    count = cur.fetchone()[0]
    cur.close()
    conn.close()
    return count


def _audit_log(conn, admin_user_id: int, target_user_id: int, target_username: str, action: str, details: str = ""):
    """Write one entry to admin_audit_log using the given (open) connection."""
    try:
        cur = conn.cursor()
        cur.execute(
            """INSERT INTO admin_audit_log (admin_user_id, target_user_id, target_username, action, details)
               VALUES (%s, %s, %s, %s, %s)""",
            (admin_user_id, target_user_id, target_username, action, details)
        )
        cur.close()
    except Exception as e:
        logger.warning("audit_log write failed: %s", e)


@app.get("/api/admin/users")
def admin_list_users(request: Request):
    require_admin(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT u.id, u.username, u.is_admin, u.is_active, u.created_at, u.last_login_at,
               u.plan, u.admin_note,
               COUNT(DISTINCT s.id) as stores_count,
               COUNT(DISTINCT rs.id) as sessions_count
        FROM users u
        LEFT JOIN stores s ON s.owner_id = u.id
        LEFT JOIN route_sessions rs ON rs.owner_id = u.id
        GROUP BY u.id, u.username, u.is_admin, u.is_active, u.created_at, u.last_login_at,
                 u.plan, u.admin_note
        ORDER BY u.created_at DESC
    """)
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "id": r["id"],
            "username": r["username"],
            "is_admin": bool(r["is_admin"]),
            "is_active": bool(r["is_active"]),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "last_login_at": r["last_login_at"].isoformat() if r["last_login_at"] else None,
            "stores_count": int(r["stores_count"] or 0),
            "sessions_count": int(r["sessions_count"] or 0),
            "plan": r["plan"] or "trial",
            "admin_note": r["admin_note"] or "",
        }
        for r in rows
    ]


_VALID_PLANS = {"trial", "basic", "pro", "enterprise"}

@app.post("/api/admin/users", status_code=201)
def admin_create_user(request: Request, body: AdminUserCreate):
    require_admin(request)
    if not body.username.strip():
        raise HTTPException(status_code=422, detail="Логин не может быть пустым")
    if len(body.password) < 4:
        raise HTTPException(status_code=422, detail="Пароль должен быть не менее 4 символов")
    plan = body.plan if body.plan in _VALID_PLANS else "trial"
    hashed = _bcrypt_lib.hashpw(body.password.encode(), _bcrypt_lib.gensalt()).decode()
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    try:
        cur.execute(
            """INSERT INTO users (username, password_hash, is_admin, is_active, plan, admin_note)
               VALUES (%s, %s, %s, %s, %s, %s)
               RETURNING id, username, is_admin, is_active, created_at, plan, admin_note""",
            (body.username.strip(), hashed, body.is_admin, True, plan, body.admin_note or "")
        )
        row = cur.fetchone()
        admin_uid = get_user_id(request)
        _audit_log(conn, admin_uid, row["id"], row["username"], "user_created",
                   f"plan={row['plan']}, is_admin={row['is_admin']}")
        conn.commit()
        return {
            "id": row["id"],
            "username": row["username"],
            "is_admin": bool(row["is_admin"]),
            "is_active": bool(row["is_active"]),
            "created_at": row["created_at"].isoformat() if row["created_at"] else None,
            "last_login_at": None,
            "stores_count": 0,
            "sessions_count": 0,
            "plan": row["plan"] or "trial",
            "admin_note": row["admin_note"] or "",
        }
    except Exception as e:
        conn.rollback()
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            raise HTTPException(status_code=409, detail="Пользователь с таким логином уже существует")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        cur.close()
        conn.close()


@app.patch("/api/admin/users/{user_id}")
def admin_update_user(user_id: int, request: Request, body: AdminUserUpdate):
    require_admin(request)
    current_uid = get_user_id(request)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, username, is_admin, is_active, plan, admin_note FROM users WHERE id = %s", (user_id,))
    target = cur.fetchone()
    if not target:
        cur.close()
        conn.close()
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # Self-protection: cannot modify own admin/active status
    if user_id == current_uid:
        if body.is_active is False:
            cur.close(); conn.close()
            raise HTTPException(status_code=400, detail="Нельзя деактивировать свой аккаунт")
        if body.is_admin is False:
            cur.close(); conn.close()
            raise HTTPException(status_code=400, detail="Нельзя снять права администратора у себя")

    # Last-admin protection: cannot deactivate or strip the last active admin
    if target["is_admin"] and target["is_active"]:
        if body.is_active is False or body.is_admin is False:
            admin_count = _count_active_admins()
            if admin_count <= 1:
                cur.close(); conn.close()
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя деактивировать или лишить прав последнего администратора системы"
                )

    sets = []
    params = []
    if body.password is not None:
        if len(body.password) < 4:
            cur.close(); conn.close()
            raise HTTPException(status_code=422, detail="Пароль должен быть не менее 4 символов")
        hashed = _bcrypt_lib.hashpw(body.password.encode(), _bcrypt_lib.gensalt()).decode()
        sets.append("password_hash = %s")
        params.append(hashed)
    if body.is_admin is not None:
        sets.append("is_admin = %s")
        params.append(body.is_admin)
    if body.is_active is not None:
        sets.append("is_active = %s")
        params.append(body.is_active)
    if body.plan is not None:
        plan = body.plan if body.plan in _VALID_PLANS else "trial"
        sets.append("plan = %s")
        params.append(plan)
    if body.admin_note is not None:
        sets.append("admin_note = %s")
        params.append(body.admin_note)
    if not sets:
        cur.close(); conn.close()
        raise HTTPException(status_code=422, detail="Нет полей для обновления")
    params.append(user_id)
    cur.execute(
        f"UPDATE users SET {', '.join(sets)} WHERE id = %s RETURNING id, username, is_admin, is_active, plan, admin_note",
        params
    )
    row = cur.fetchone()
    # Audit each changed field
    if body.password is not None:
        _audit_log(conn, current_uid, user_id, target["username"], "password_changed", "")
    if body.is_admin is not None:
        _audit_log(conn, current_uid, user_id, target["username"],
                   "admin_granted" if body.is_admin else "admin_removed", "")
    if body.is_active is not None:
        _audit_log(conn, current_uid, user_id, target["username"],
                   "user_unblocked" if body.is_active else "user_blocked", "")
    if body.plan is not None:
        _audit_log(conn, current_uid, user_id, target["username"], "plan_changed",
                   f"{target['plan']} → {row['plan']}")
    if body.admin_note is not None:
        _audit_log(conn, current_uid, user_id, target["username"], "note_changed", "")
    conn.commit()
    cur.close()
    conn.close()
    return {
        "id": row["id"],
        "username": row["username"],
        "is_admin": bool(row["is_admin"]),
        "is_active": bool(row["is_active"]),
        "plan": row["plan"] or "trial",
        "admin_note": row["admin_note"] or "",
    }


@app.delete("/api/admin/users/{user_id}", status_code=200)
def admin_delete_user(user_id: int, request: Request):
    require_admin(request)
    current_uid = get_user_id(request)
    if user_id == current_uid:
        raise HTTPException(status_code=400, detail="Нельзя удалить свой аккаунт")
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, username, is_admin, is_active FROM users WHERE id = %s", (user_id,))
    target = cur.fetchone()
    if not target:
        cur.close(); conn.close()
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    # Last-admin protection
    if target["is_admin"] and target["is_active"]:
        admin_count = _count_active_admins()
        if admin_count <= 1:
            cur.close(); conn.close()
            raise HTTPException(
                status_code=400,
                detail="Нельзя удалить последнего администратора системы"
            )
    # Cascade: delete user's data manually (FK is NO ACTION)
    cur2 = conn.cursor()
    cur2.execute("DELETE FROM route_session_stores WHERE session_id IN (SELECT id FROM route_sessions WHERE owner_id=%s)", (user_id,))
    cur2.execute("DELETE FROM route_sessions WHERE owner_id = %s", (user_id,))
    cur2.execute("DELETE FROM stores WHERE owner_id = %s", (user_id,))
    cur2.execute("DELETE FROM company_settings WHERE owner_id = %s", (user_id,))
    cur2.execute("DELETE FROM users WHERE id = %s", (user_id,))
    _audit_log(conn, current_uid, user_id, target["username"], "user_deleted",
               f"stores={target.get('stores_count',0)}, was_admin={target['is_admin']}")
    conn.commit()
    cur.close()
    cur2.close()
    conn.close()
    return {"ok": True, "username": target["username"]}


@app.get("/api/admin/audit-log")
def admin_audit_log(request: Request, limit: int = 100):
    require_admin(request)
    limit = max(1, min(limit, 500))
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT l.id, l.admin_user_id, u.username AS admin_username,
               l.target_user_id, l.target_username, l.action, l.details, l.created_at
        FROM admin_audit_log l
        LEFT JOIN users u ON u.id = l.admin_user_id
        ORDER BY l.created_at DESC
        LIMIT %s
    """, (limit,))
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return [
        {
            "id": r["id"],
            "admin_user_id": r["admin_user_id"],
            "admin_username": r["admin_username"] or "—",
            "target_user_id": r["target_user_id"],
            "target_username": r["target_username"] or "—",
            "action": r["action"],
            "details": r["details"] or "",
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]


# ── Production static file serving ────────────────────────────────────────────
# In production (Docker / Railway), FastAPI serves the Vite build output from
# ./static/. In development, the Vite dev server handles this via the proxy.
# This block must come AFTER all /api/* routes so the catch-all doesn't
# shadow them. FastAPI matches routes in registration order.
from pathlib import Path as _Path  # noqa: E402

_STATIC_DIR = _Path(__file__).parent / "static"
if _STATIC_DIR.exists() and _STATIC_DIR.is_dir():
    from fastapi.staticfiles import StaticFiles as _StaticFiles  # noqa: E402
    from fastapi.responses import FileResponse as _FileResponse  # noqa: E402

    # Vite outputs JS/CSS bundles under /assets/ — mount separately so
    # FileResponse header (Content-Type) is set correctly.
    _assets_dir = _STATIC_DIR / "assets"
    if _assets_dir.exists():
        app.mount("/assets", _StaticFiles(directory=str(_assets_dir)), name="static-assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def _serve_spa(full_path: str):
        """Serve exact static file if it exists, otherwise fall back to SPA index.html."""
        if full_path and ".." not in full_path:
            candidate = _STATIC_DIR / full_path
            if candidate.is_file():
                return _FileResponse(str(candidate))
        return _FileResponse(str(_STATIC_DIR / "index.html"))

    logger.info("Static dir found at %s — serving frontend from FastAPI", _STATIC_DIR)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)
