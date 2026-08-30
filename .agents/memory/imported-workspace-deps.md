---
name: Imported workspace dependencies
description: Environment setup for imported pnpm workspaces with a Python API
---

For an imported pnpm workspace, language-package setup alone may not populate each workspace's `node_modules`; a frozen workspace install can still be required before Vite and TypeScript workflows start. The Python API may likewise need its declared requirements installed into the managed `.pythonlibs` environment.

**Why:** Imported projects can have valid lockfiles and package manifests while both frontend and API workflows fail immediately because dependencies were not materialized in the current environment.

**How to apply:** If workflow logs report missing `vite`, `tsc`, or Python modules, install through the package-management flow first, then run a lockfile-frozen workspace install and restart the affected workflows.