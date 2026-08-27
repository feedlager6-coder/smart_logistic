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

# Install pnpm directly
RUN npm install -g pnpm@10 --quiet

WORKDIR /workspace

# ── Layer 1: workspace config (wildcards prevent missing file errors) ──────────
COPY package.json tsconfig.base.json tsconfig.json ./
COPY pnpm-workspace.yaml* .npmrc* pnpm-lock.yaml* ./

# ── Layer 2: all package.json files (needed for pnpm workspace graph) ─────────
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json         ./lib/api-spec/
COPY lib/api-zod/package.json          ./lib/api-zod/
COPY lib/db/package.json               ./lib/db/
COPY scripts/package.json              ./scripts/
COPY artifacts/smartroute/package.json ./artifacts/smartroute/
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/

# ── Install workspace deps ────────────────────────────────────────────────────
RUN pnpm install --no-frozen-lockfile

# ── Layer 3: source code ──────────────────────────────────────────────────────
COPY lib/                  ./lib/
COPY artifacts/smartroute/ ./artifacts/smartroute/

# ── Build ─────────────────────────────────────────────────────────────────────
RUN BASE_PATH=/ pnpm --filter @workspace/smartroute run build


# ── Stage 2: Python runtime ───────────────────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# Install Python dependencies
COPY artifacts/api-server/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy FastAPI application
COPY artifacts/api-server/main.py ./

# Copy the Windows 1C agent artifacts used by the authenticated download
# endpoints. Without this, the routes exist in Railway but return 404 because
# the installer and ZIP contents are absent from the runtime image.
COPY apps/1c-agent ./apps/1c-agent

# Copy the 1C external processing package served by the integration endpoints.
COPY artifacts/integrations/1c ./artifacts/integrations/1c

# Copy built frontend — FastAPI serves it from ./static/
COPY --from=frontend /workspace/artifacts/smartroute/dist/public ./static/

# Railway injects $PORT at runtime; default 8080 matches local dev
EXPOSE 8080

# Lightweight health check (Railway also uses healthcheckPath in railway.toml)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:${PORT:-8080}/api/healthz')" || exit 1

CMD ["python3", "main.py"]
