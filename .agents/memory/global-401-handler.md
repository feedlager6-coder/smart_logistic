---
name: Global 401 handler pattern
description: How unauthenticated API responses are handled globally without per-component checks
---

## The rule
All 401 responses from any TanStack Query hook or mutation automatically redirect to the login page.

**Why:** Without a global handler, protected pages show a perpetual "Loading..." or broken UI when the session expires or the cookie is missing. Each component would need its own 401 check, which is error-prone.

**How it works:**
1. `artifacts/smartroute/src/App.tsx` — creates `QueryCache` and `MutationCache` with `onError` callbacks. When error is `ApiError` with `status === 401`, dispatches `new CustomEvent("api:unauthorized")` on `window`.
2. `artifacts/smartroute/src/context/auth.tsx` — listens for `"api:unauthorized"` event → calls `fetchMe()`. If `/api/auth/me` returns 401, sets `isAuthenticated = false` → login page renders.

**Important:** `ApiError` must be exported from `lib/api-client-react/src/index.ts` for the type check in App.tsx to work.

**TanStack Query v5 note:** `keepPreviousData: true` was removed in v5 (v5.100.9). Use `staleTime` or `placeholderData` instead. Use `as any` when generated hook option types are incompatible.
