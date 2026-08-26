"""
SmartRoute 1C Agent - Command Line Interface & Windows Service Worker
Can run in headless background daemon mode or execute one-off synchronization tasks.
"""

import sys
import time
import argparse
import logging

from config_manager import ConfigManager
from onec_connector import OneCConnector
from smartroute_client import SmartRouteAPIClient
from sync_engine import SyncEngine

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] (%(name)s) %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("SmartRouteAgent.CLI")


def main():
    parser = argparse.ArgumentParser(description="SmartRoute 1C Integration Agent CLI")
    parser.add_argument("--sync-once", action="store_true", help="Run a single sync cycle and exit")
    parser.add_argument("--daemon", action="store_true", help="Run continuous background sync daemon")
    parser.add_argument("--pair", type=str, help="Pair agent with SmartRoute using code (e.g. SMARTROUTE-XXXX-YYYY)")
    parser.add_argument("--server", type=str, default="", help="SmartRoute server URL")
    parser.add_argument("--base-name", type=str, default="", help="1C base name")
    parser.add_argument("--conn-str", type=str, default="", help="1C connection string (File=... or Srvr=...)")
    parser.add_argument("--user", type=str, default="", help="1C username")
    parser.add_argument("--password", type=str, default="", help="1C password")
    parser.add_argument("--list-bases", action="store_true", help="List detected 1C infobases on this computer")

    args = parser.parse_args()

    config = ConfigManager()
    onec = OneCConnector()

    if args.list_bases:
        bases = onec.get_registered_ibases()
        print(f"\nFound {len(bases)} 1C infobases:")
        for idx, b in enumerate(bases, start=1):
            print(f"  {idx}. {b.get('name')} -> {b.get('connect', '')}")
        sys.exit(0)

    if args.server:
        config.server_url = args.server
    if args.base_name:
        config.data["onec"]["base_name"] = args.base_name
    if args.conn_str:
        config.data["onec"]["connection_string"] = args.conn_str
    if args.user:
        config.data["onec"]["username"] = args.user
    if args.password:
        config.onec_password = args.password
    config.save()

    client = SmartRouteAPIClient(base_url=config.server_url, api_token=config.api_token)
    client.agent_id = config.data.get("agent_id", "")

    if args.pair:
        code = args.pair.strip()
        print(f"Pairing with SmartRoute ({config.server_url}) using code: {code}...")
        ok, msg, resp = client.pair(
            pairing_code=code,
            base_name=config.data["onec"].get("base_name", "1C Infobase"),
            config_type="1С:Предприятие 8.3",
        )
        if ok:
            config.api_token = resp.get("token", "")
            config.data["agent_id"] = resp.get("agent_id", "")
            config.save()
            print(f"SUCCESS: {msg}")
        else:
            print(f"ERROR: {msg}")
            sys.exit(1)

    sync_engine = SyncEngine(config, onec, client)

    if args.sync_once:
        print("Starting single sync cycle...")
        res = sync_engine._execute_sync_cycle()
        print(f"Sync result: {res}")
        sys.exit(0 if res.get("status") in ("ok", "partial") else 1)

    if args.daemon:
        print("Starting continuous SmartRoute sync daemon (Press Ctrl+C to stop)...")
        sync_engine.start()
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\nStopping daemon...")
            sync_engine.stop()
            print("Daemon stopped.")
        sys.exit(0)

    # Default to GUI if no args provided
    import smartroute_agent_gui
    smartroute_agent_gui.main()


if __name__ == "__main__":
    main()
