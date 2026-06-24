---
name: duplicate workflows / port 8080 race
description: Why two API servers can race for port 8080 and how to resolve
---

This is an "artifacts monorepo": the artifact system auto-runs one workflow per artifact dir (`artifacts/api-server: API Server` on 8080, `artifacts/smartroute: web` on 24853, `artifacts/mockup-sandbox` on 8081). The `.replit` file ALSO defines canonical workflows `Start API Server` (8080) and `Start Frontend` (5000, webview).

**Symptom:** `Start API Server` and `artifacts/api-server: API Server` both bind port 8080 → they race at startup. Whichever loses ends up "finished", but during the race window API requests are flaky → users see intermittent errors (e.g. "failed to add" on actions that actually work when tested via curl).

**Key constraint:** artifact-managed workflows CANNOT be deleted (`removeWorkflow` returns PROHIBITED_ACTION). Only the `.replit`-defined ones are editable.

**Resolution:** ensure the canonical `.replit` workflows win and hold their ports — restart `Start API Server` so it owns 8080; the duplicate artifact server stays "finished" and does not auto-restart on its own. The webview MUST be on port 5000 (`Start Frontend`); the artifact `artifacts/smartroute: web` on 24853 is harmless (not the preview port).

**How to apply:** when debugging "works in curl but errors in browser", check `ps aux | grep main.py | wc -l` — more than 1 means the port race is back. Restart the canonical workflow to reclaim the port.
