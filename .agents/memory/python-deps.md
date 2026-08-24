---
name: Python dependency installation
description: Environment-specific way to install and run the FastAPI service dependencies.
---

Keep the API dependency list in `artifacts/api-server/requirements.txt`, but install it through the Replit package-management flow rather than assuming `pip3` is available in shell commands.

**Why:** In this environment the shell may not expose a `pip3` executable, while workflow Python can use the managed `.pythonlibs` environment after package installation.

**How to apply:** When API startup reports a missing Python module, use the package manager with the packages from `requirements.txt`, then restart the API workflow.