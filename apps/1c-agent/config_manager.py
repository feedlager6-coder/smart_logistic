"""
SmartRoute 1C Agent - Configuration Manager
Handles secure local configuration storage, DPAPI encryption on Windows,
and log rotation for the 1C Windows Agent.
"""

import os
import json
import base64
import sys
import logging
from logging.handlers import RotatingFileHandler
from typing import Dict, Any

logger = logging.getLogger("SmartRouteAgent.Config")

CONFIG_DIR_NAME = "SmartRouteAgent"
CONFIG_FILE_NAME = "config.json"


def get_app_data_dir() -> str:
    """Returns the application data directory on Windows / Linux / macOS."""
    if sys.platform == "win32":
        app_data = os.environ.get("APPDATA")
        if not app_data:
            app_data = os.path.expanduser("~")
        path = os.path.join(app_data, CONFIG_DIR_NAME)
    else:
        path = os.path.join(os.path.expanduser("~"), f".{CONFIG_DIR_NAME.lower()}")

    os.makedirs(path, exist_ok=True)
    return path


def get_config_path() -> str:
    """Returns the full path to config.json."""
    return os.path.join(get_app_data_dir(), CONFIG_FILE_NAME)


def get_log_path() -> str:
    """Returns the full path to smartroute_agent.log."""
    return os.path.join(get_app_data_dir(), "smartroute_agent.log")


def setup_agent_logging():
    """Configures global rotating file logger (max 5MB x 3 backups) and console output."""
    log_file = get_log_path()
    root_logger = logging.getLogger("SmartRouteAgent")
    root_logger.setLevel(logging.INFO)

    # Avoid duplicate handlers
    if not root_logger.handlers:
        formatter = logging.Formatter(
            "[%(asctime)s] [%(levelname)s] [%(name)s]: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        # Rotating file handler (5 MB max, 3 backups)
        file_handler = RotatingFileHandler(
            log_file, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
        )
        file_handler.setFormatter(formatter)
        root_logger.addHandler(file_handler)

        # Console handler
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(formatter)
        root_logger.addHandler(console_handler)


class ConfigManager:
    """Manages application settings, 1C connection details and DPAPI encrypted auth tokens."""

    def __init__(self):
        self.config_path = get_config_path()
        self.data: Dict[str, Any] = {
            "server_url": "https://smartroute.app",
            "agent_id": "",
            "api_token": "",
            "is_paired": False,
            "organization": "SmartRoute Logistics",
            "onec": {
                "connection_type": "com",  # "com" or "http"
                "connection_string": "",
                "base_name": "",
                "username": "",
                "password_enc": "",
                "v8_version": "8.3",
                "doc_types": [
                    "ЗаказКлиента",
                    "РеализацияТоваровУслуг",
                    "ЗаказПокупателя",
                    "ЗаказНаПеремещение",
                    "СчетНаОплатуПокупателю",
                ],
                "custom_filter_days": 1,
            },
            "sync": {
                "interval_minutes": 5,
                "sync_period_hours": 24,
                "auto_sync": True,
                "sync_on_startup": True,
                "start_with_windows": False,
                "minimize_to_tray": True,
            },
            "stats": {
                "total_orders_sent": 0,
                "total_statuses_received": 0,
                "last_sync_time": None,
                "last_sync_status": "none",
            },
        }
        setup_agent_logging()
        self.load()

    def _encrypt_data(self, plaintext: str) -> str:
        """Encrypts sensitive data using Windows DPAPI (CryptProtectData) or base64 fallback."""
        if not plaintext:
            return ""
        if sys.platform == "win32":
            try:
                import win32crypt
                raw = plaintext.encode("utf-8")
                encrypted = win32crypt.CryptProtectData(raw, "SmartRoute1CAgent", None, None, None, 0)
                return "dpapi:" + base64.b64encode(encrypted).decode("ascii")
            except Exception as e:
                logger.debug(f"DPAPI encrypt fallback to b64: {e}")
        return "b64:" + base64.b64encode(plaintext.encode("utf-8")).decode("ascii")

    def _decrypt_data(self, cipher_text: str) -> str:
        """Decrypts sensitive data using Windows DPAPI or base64."""
        if not cipher_text:
            return ""
        try:
            if cipher_text.startswith("dpapi:") and sys.platform == "win32":
                import win32crypt
                raw_cipher = base64.b64decode(cipher_text[6:].encode("ascii"))
                _, decrypted = win32crypt.CryptUnprotectData(raw_cipher, None, None, None, 0)
                return decrypted.decode("utf-8")
            elif cipher_text.startswith("b64:"):
                return base64.b64decode(cipher_text[4:].encode("ascii")).decode("utf-8")
            else:
                # Raw legacy base64
                return base64.b64decode(cipher_text.encode("ascii")).decode("utf-8")
        except Exception:
            return cipher_text

    def load(self):
        """Loads config from disk if exists."""
        if not os.path.exists(self.config_path):
            self.save()
            return

        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                saved = json.load(f)
                for k, v in saved.items():
                    if isinstance(v, dict) and k in self.data and isinstance(self.data[k], dict):
                        self.data[k].update(v)
                    else:
                        self.data[k] = v
        except Exception as e:
            logger.error(f"Failed to load config: {e}")

    def save(self):
        """Saves current config to disk."""
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.error(f"Failed to save config: {e}")

    # Helper properties
    @property
    def server_url(self) -> str:
        return self.data.get("server_url", "https://smartroute.app").rstrip("/")

    @server_url.setter
    def server_url(self, val: str):
        self.data["server_url"] = val.rstrip("/")
        self.save()

    @property
    def api_token(self) -> str:
        raw = self.data.get("api_token_enc", "")
        if raw:
            return self._decrypt_data(raw)
        return self.data.get("api_token", "")

    @api_token.setter
    def api_token(self, val: str):
        if val:
            self.data["api_token_enc"] = self._encrypt_data(val)
            self.data["api_token"] = ""  # Clear plain text
        else:
            self.data["api_token_enc"] = ""
            self.data["api_token"] = ""
        self.data["is_paired"] = bool(val)
        self.save()

    @property
    def is_paired(self) -> bool:
        return bool(self.data.get("is_paired") and (self.data.get("api_token_enc") or self.data.get("api_token")))

    @property
    def onec_password(self) -> str:
        return self._decrypt_data(self.data["onec"].get("password_enc", ""))

    @onec_password.setter
    def onec_password(self, val: str):
        self.data["onec"]["password_enc"] = self._encrypt_data(val)
        self.save()

    def update_stats(self, orders_sent: int = 0, statuses_received: int = 0, status: str = "ok"):
        self.data["stats"]["total_orders_sent"] += orders_sent
        self.data["stats"]["total_statuses_received"] += statuses_received
        self.data["stats"]["last_sync_time"] = self._get_now_iso()
        self.data["stats"]["last_sync_status"] = status
        self.save()

    def clear_pairing(self):
        """Disconnects agent from SmartRoute."""
        self.data["api_token"] = ""
        self.data["api_token_enc"] = ""
        self.data["is_paired"] = False
        self.save()

    def _get_now_iso(self) -> str:
        import datetime
        return datetime.datetime.now().isoformat()
