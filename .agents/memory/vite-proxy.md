---
name: Vite proxy for API calls
description: Why vite.config.ts must include server.proxy for /api
---
In Replit, the frontend runs on port 24853 and the API server on port 8080. Browser fetches to relative URLs like `/api/stores` hit the Vite dev server, which returns HTML SPA fallback if no proxy is configured.

**Rule:** `vite.config.ts` must always include:
```
server: { proxy: { "/api": { target: "http://localhost:8080", changeOrigin: true } } }
```

**Why:** Without this proxy, all `/api/*` fetches return `<!DOCTYPE html>` from Vite's SPA fallback, causing JSON parse errors in the frontend.

**How to apply:** Any time a fetch to `/api/*` fails with "Unexpected token '<'" in the browser console, check the proxy config first.
