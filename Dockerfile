# ═══════════════════════════════════════════════════════════════════════════════
# SmartRoute — single-service Docker build
#
# Stage 1 (frontend): pnpm monorepo → Vite build → dist/public/
# Stage 2 (runtime):  Python 3.11 + FastAPI serves API + built frontend
#
# The FastAPI process listens on $PORT (Railway injects it at runtime).
# DATABASE_URL must be set to a PostgreSQL connection string.
# ═══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:20-slim AS frontend

# Install pnpm directly (more reliable than corepack when packageManager
# field is absent from package.json; pnpm v10 reads lockfile v9 correctly)
RUN npm install -g pnpm@10 --quiet

WORKDIR /workspace

# ── Layer 1: workspace config (invalidated only when lockfile changes) ────────
# tsconfig.base.json + tsconfig.json are needed because artifacts/smartroute/tsconfig.json
# extends "../../tsconfig.base.json" — Vite resolves it at build time.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json tsconfig.json ./

# ── Layer 2: all package.json files (needed for pnpm workspace graph) ─────────
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json         ./lib/api-spec/
COPY lib/api-zod/package.json          ./lib/api-zod/
COPY lib/db/package.json               ./lib/db/
COPY scripts/package.json              ./scripts/
COPY artifacts/smartroute/package.json ./artifacts/smartroute/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/

# ── Install all workspace deps (cached when package.json unchanged) ───────────
RUN pnpm install --frozen-lockfile

# ── Layer 3: source code ──────────────────────────────────────────────────────
COPY lib/                  ./lib/
COPY artifacts/smartroute/ ./artifacts/smartroute/

# ── Build ─────────────────────────────────────────────────────────────────────
# BASE_PATH=/ → all asset URLs are root-relative (correct for Railway)
# PORT fallback is baked into vite.config.ts (5173), not needed here
RUN BASE_PATH=/ pnpm --filter @workspace/smartroute run build


# ── Stage 2: Python runtime ───────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies
# psycopg2-binary and aiofiles are self-contained; no system libs needed
COPY artifacts/api-server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy FastAPI application
COPY artifacts/api-server/main.py ./

# Copy built frontend — FastAPI serves it from ./static/
COPY --from=frontend /workspace/artifacts/smartroute/dist/public ./static/

# Railway injects $PORT at runtime; default 8080 matches local dev
EXPOSE 8080

# Lightweight health check (Railway also uses healthcheckPath in railway.toml)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-8080}/api/healthz')" || exit 1

CMD ["python3", "main.py"]
