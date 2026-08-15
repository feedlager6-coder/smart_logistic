---
name: Orval codegen broken in Replit
description: orval v8.9.1 fails to resolve openapi.yaml in Replit env; wipes generated/ before failing. Workaround and strategy.
---

## The rule
Never run `pnpm --filter @workspace/api-spec run codegen` without a git safety net. It **always** fails in this Replit environment with "Failed to resolve input: Please provide a valid string value or pass a loader to process the input" — and it **wipes** the `generated/` folder before failing, breaking the entire frontend.

**Why:** orval v8.9.1 uses TypeScript config (`orval.config.ts`). The Replit Node.js runtime cannot load the TS config in ESM mode, causing the input YAML path resolution to fail. The `clean: true` option in the orval config wipes the output folder before generation even begins.

**How to apply:**
1. Before running codegen, commit or checkpoint the generated files.
2. If codegen fails and wipes the generated files, restore with:
   ```bash
   git show HEAD:lib/api-client-react/src/generated/api.ts > lib/api-client-react/src/generated/api.ts
   git show HEAD:lib/api-client-react/src/generated/api.schemas.ts > lib/api-client-react/src/generated/api.schemas.ts
   git show HEAD:lib/api-zod/src/generated/api.ts > lib/api-zod/src/generated/api.ts
   # Restore types/ files:
   git ls-tree -r HEAD lib/api-zod/src/generated/types/ | awk '{print $4}' | while read f; do git show HEAD:$f > $f; done
   ```
3. For **new DELETE/PATCH endpoints** added to `openapi.yaml` + `main.py`: use direct `fetch()` calls in the frontend component instead of waiting for a generated hook. This avoids needing codegen for every new endpoint.
4. For **new GET/POST endpoints** that need hooks: add the hook manually to `lib/api-client-react/src/generated/api.ts` following the existing pattern, rather than running codegen.
