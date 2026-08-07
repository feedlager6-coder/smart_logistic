---
name: Workspace typecheck order
description: The required validation order for TypeScript project references in this workspace.
---

Run the workspace library build (`pnpm run typecheck:libs`) before typechecking an individual artifact that references `lib/api-client-react`. Otherwise TypeScript reports cascading TS6305 declaration errors and hides the real artifact diagnostics.

**Why:** The imported workspace uses composite TypeScript project references, and artifact checks depend on generated declaration output from the shared client package.

**How to apply:** After installing dependencies or changing shared client sources, run the library check first, then run the target artifact's `typecheck` and `build`.