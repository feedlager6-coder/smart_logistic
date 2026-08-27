"""
SmartRoute 1C Agent - Synchronization Engine
Coordinates background threads for periodic bi-directional sync (1C -> SmartRoute, SmartRoute -> 1C),
error handling, logging and status callbacks.
"""

import time
import threading
import datetime
import logging
from typing import Callable, Optional, Dict, Any, List

from config_manager import ConfigManager
from onec_connector import OneCConnector
from smartroute_client import SmartRouteAPIClient

logger = logging.getLogger("SmartRouteAgent.Sync")


class SyncEngine:
    """Orchestrates bi-directional data exchange between 1C and SmartRoute."""

    def __init__(self, config: ConfigManager, onec: OneCConnector, client: SmartRouteAPIClient):
        self.config = config
        self.onec = onec
        self.client = client

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._is_syncing = False
        self._last_status_check = datetime.datetime.now() - datetime.timedelta(days=1)

        # Callbacks for UI updates
        self.on_sync_started: Optional[Callable[[], None]] = None
        self.on_sync_finished: Optional[Callable[[Dict[str, Any]], None]] = None
        self.on_log_message: Optional[Callable[[str, str], None]] = None  # (message, level)

    def log(self, message: str, level: str = "INFO"):
        """Logs message to logger, file and UI callback."""
        timestamp = datetime.datetime.now().strftime("%H:%M:%S")
        formatted = f"[{timestamp}] [{level}] {message}"
        if level == "ERROR":
            logger.error(message)
        elif level == "WARNING":
            logger.warning(message)
        else:
            logger.info(message)

        if self.on_log_message:
            try:
                self.on_log_message(formatted, level)
            except Exception:
                pass

    def start(self):
        """Starts the background sync scheduler thread."""
        if self._running:
            return

        self._running = True
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._worker_loop, daemon=True, name="SyncWorker")
        self._thread.start()
        self.log("Служба синхронизации SmartRoute запущена в фоновом режиме", "INFO")

    def stop(self):
        """Stops the background scheduler thread."""
        if not self._running:
            return

        self._running = False
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self.log("Служба синхронизации остановлена", "INFO")

    def run_sync_now(self) -> Dict[str, Any]:
        """Triggers an immediate sync cycle in a separate thread."""
        if self._is_syncing:
            self.log("Синхронизация уже выполняется, подождите...", "WARNING")
            return {"ok": False, "message": "Синхронизация уже выполняется"}

        thread = threading.Thread(target=self._execute_sync_cycle, daemon=True)
        thread.start()
        return {"ok": True, "message": "Синхронизация запущена"}

    def _worker_loop(self):
        """Background periodic loop."""
        # Initial sync on startup if enabled
        if self.config.data["sync"].get("sync_on_startup", True) and self.config.is_paired:
            time.sleep(2)  # brief pause after startup
            self._execute_sync_cycle()

        while self._running and not self._stop_event.is_set():
            interval_min = max(1, self.config.data["sync"].get("interval_minutes", 5))
            interval_sec = interval_min * 60

            # Heartbeat every 60 seconds
            for _ in range(int(interval_sec / 5)):
                if self._stop_event.is_set():
                    break
                time.sleep(5)

            if not self._stop_event.is_set() and self.config.is_paired:
                self._execute_sync_cycle()

    def _execute_sync_cycle(self) -> Dict[str, Any]:
        """Performs one complete sync cycle (1C -> SmartRoute and SmartRoute -> 1C)."""
        if self._is_syncing:
            return {"status": "skipped", "message": "Already running"}

        self._is_syncing = True
        if self.on_sync_started:
            try:
                self.on_sync_started()
            except Exception:
                pass

        self.log("━━━ Начало цикла синхронизации 1С ↔ SmartRoute ━━━", "INFO")
        sync_result = {
            "orders_sent": 0,
            "statuses_updated": 0,
            "errors_count": 0,
            "status": "ok",
            "error_detail": "",
        }

        try:
            # 1. Connect / verify 1C connection
            onec_cfg = self.config.data.get("onec", {})
            conn_str = onec_cfg.get("connection_string", "")
            username = onec_cfg.get("username", "")
            password = self.config.onec_password

            if not self.onec.is_connected and conn_str:
                self.log(f"Подключение к базе 1С: {onec_cfg.get('base_name', '1C')}...", "INFO")
                ok, msg, meta = self.onec.connect(conn_str, username, password)
                if not ok:
                    self.log(f"Ошибка подключения к 1С: {msg}", "ERROR")
                    sync_result["errors_count"] += 1
                    sync_result["status"] = "error"
                    sync_result["error_detail"] = msg
                    self._finalize_sync(sync_result)
                    return sync_result
                self.log(f"1С подключена: {meta.get('config_name', 'База')}", "SUCCESS")

            # 2. Extract orders from 1C
            period_hours = self.config.data["sync"].get("sync_period_hours", 24)
            doc_types = onec_cfg.get("doc_types", ["ЗаказКлиента", "РеализацияТоваровУслуг"])
            self.log(f"Выборка заказов из 1С за последние {period_hours} ч...", "INFO")

            orders = self.onec.fetch_orders(period_hours=period_hours, doc_types=doc_types)
            self.log(f"Найдено {len(orders)} заказов в 1С", "INFO")

            # 3. Push orders to SmartRoute API
            if orders:
                self.log(f"Отправка {len(orders)} заказов в SmartRoute...", "INFO")
                today_iso = datetime.datetime.now().strftime("%Y-%m-%d")
                ok, msg, api_resp = self.client.sync_orders(orders, delivery_date=today_iso)
                if ok:
                    created = api_resp.get("created", len(orders))
                    updated = api_resp.get("updated", 0)
                    sync_result["orders_sent"] = created + updated
                    self.log(f"✅ Успешно передано в SmartRoute: {created} новых, {updated} обновлено", "SUCCESS")
                else:
                    self.log(f"❌ Ошибка отправки заказов в SmartRoute: {msg}", "ERROR")
                    sync_result["errors_count"] += 1
                    sync_result["status"] = "partial" if sync_result["orders_sent"] > 0 else "error"
                    sync_result["error_detail"] = msg
            else:
                self.log("Новых заказов в 1С за указанный период не обнаружено", "INFO")

            # 4. Fetch delivery updates from SmartRoute -> 1C
            self.log("Проверка обновлений статусов доставки из SmartRoute...", "INFO")
            ok_stat, updated_orders = self.client.get_delivery_updates()
            if ok_stat and updated_orders:
                delivered_count = 0
                for ord_info in updated_orders:
                    st = ord_info.get("delivery_status")
                    if st in ("delivered", "in_transit", "failed"):
                        num = ord_info.get("order_number", "")
                        route_num = ord_info.get("route_number")
                        pod_link = ord_info.get("pod_photo_url") or ord_info.get("pod_signature_url")
                        time_del = ord_info.get("actual_delivery_time")

                        if num:
                            up_ok = self.onec.update_delivery_status(
                                order_number=num,
                                status=st,
                                route_number=route_num,
                                actual_time=time_del,
                                pod_url=pod_link,
                            )
                            if up_ok:
                                delivered_count += 1

                sync_result["statuses_updated"] = delivered_count
                if delivered_count > 0:
                    self.log(f"✅ Обновлено {delivered_count} статусов доставки в 1С", "SUCCESS")
                else:
                    self.log("Статусы в 1С актуальны", "INFO")
            else:
                self.log("Нет новых статусов доставки для записи в 1С", "INFO")

        except Exception as e:
            err_str = f"Непредвиденная ошибка синхронизации: {e}"
            self.log(err_str, "ERROR")
            sync_result["errors_count"] += 1
            sync_result["status"] = "error"
            sync_result["error_detail"] = str(e)

        self._finalize_sync(sync_result)
        return sync_result

    def _finalize_sync(self, sync_result: Dict[str, Any]):
        """Saves metrics, updates config and sends remote logs."""
        self._is_syncing = False
        self.config.update_stats(
            orders_sent=sync_result["orders_sent"],
            statuses_received=sync_result["statuses_updated"],
            status=sync_result["status"],
        )

        # Send log to server
        if self.config.is_paired:
            self.client.log_sync_result(
                agent_id=self.config.data.get("agent_id", ""),
                status=sync_result["status"],
                orders_received=sync_result["orders_sent"],
                stores_matched=sync_result["orders_sent"],
                errors_count=sync_result["errors_count"],
                error_detail=sync_result["error_detail"] or "Синхронизация завершена успешно",
                statuses_updated=sync_result["statuses_updated"],
            )
            # Send heartbeat
            self.client.heartbeat(
                agent_id=self.config.data.get("agent_id", ""),
                status="active" if sync_result["status"] == "ok" else "error",
                last_error=sync_result["error_detail"] or None,
                orders_count=sync_result["orders_sent"],
                statuses_count=sync_result["statuses_updated"],
            )

        self.log(
            f"━━━ Синхронизация завершена (Отправлено: {sync_result['orders_sent']}, "
            f"Получено статусов: {sync_result['statuses_updated']}, Ошибок: {sync_result['errors_count']}) ━━━",
            "INFO",
        )

        if self.on_sync_finished:
            try:
                self.on_sync_finished(sync_result)
            except Exception:
                pass
