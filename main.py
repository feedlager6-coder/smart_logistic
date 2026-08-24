import os
import sys

# Ensure artifacts directory is in sys.path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "artifacts", "api-server"))

try:
    from main import app  # noqa: F401
except ImportError:
    from artifacts.api_server.main import app  # noqa: F401


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port)

