"""
SmartRoute 1C Agent - REST API Client
Provides reliable HTTP/HTTPS communication with SmartRoute server,
including pairing, automatic retries, token auth, batch order sync, status updates and SSL handling.
"""

import json
import time
import socket
import logging
import urllib.request
import urllib.error
import urllib.parse
import ssl
from typing import Dict, Any, List, Optional, Tuple

logger = logging.getLogger("SmartRouteAgent.API")


class _HttpsOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Do not allow an HTTPS request to follow a redirect down to HTTP."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        redirected = super().redirect_request(req, fp, code, msg, headers, newurl)
        if (
            redirected
            and req.full_url.lower().startswith("https://")
            and redirected.full_url.lower().startswith("http://")
        ):
            raise urllib.error.URLError("Отказано: HTTPS перенаправлен на небезопасный HTTP")
        return redirected


class SmartRouteAPIClient:
    """Client for interacting with SmartRoute REST API."""

    def __init__(self, base_url: str = "https://smartroute.app", api_token: str = ""):
        self.base_url = base_url.rstrip("/")
        self.api_token = api_token
        self.agent_id = ""
        self.timeout = 20  # seconds
        # HTTPS always uses the OS trust store and hostname verification.
        # Plain HTTP is allowed only when explicitly configured by the user.
        self._ssl_context = None if self.base_url.startswith("http://") else ssl.create_default_context()
        handlers = [_HttpsOnlyRedirectHandler()]
        if self._ssl_context is not None:
            handlers.append(urllib.request.HTTPSHandler(context=self._ssl_context))
        self._opener = urllib.request.build_opener(*handlers)

    def _make_request(
        self,
        endpoint: str,
        method: str = "GET",
        data: Optional[Dict[str, Any]] = None,
        retries: int = 3,
    ) -> Tuple[bool, int, Any]:
        """
        Executes HTTP request with exponential backoff and comprehensive error diagnostics.
        Returns: (success: bool, status_code: int, response_data: dict/str)
        """
        url = f"{self.base_url}{endpoint}"
        headers = {
            "User-Agent": "SmartRoute-1C-Agent/3.2 (Windows x64)",
            "Accept": "application/json",
        }

        if self.api_token:
            headers["Authorization"] = f"Bearer {self.api_token}"

        encoded_data = None
        if data is not None:
            headers["Content-Type"] = "application/json; charset=utf-8"
            encoded_data = json.dumps(data, ensure_ascii=False).encode("utf-8")

        delay = 1.0
        last_error = ""

        for attempt in range(1, retries + 1):
            try:
                req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)
                
                resp_handle = self._opener.open(
                    req,
                    timeout=self.timeout,
                )

                with resp_handle as resp:
                    resp_body = resp.read().decode("utf-8")
                    try:
                        parsed = json.loads(resp_body)
                    except Exception:
                        parsed = resp_body
                    return True, resp.status, parsed

            except urllib.error.HTTPError as he:
                status_code = he.code
                error_body = ""
                try:
                    raw_body = he.read().decode("utf-8")
                    err_json = json.loads(raw_body)
                    error_body = err_json.get("error") or err_json.get("detail") or err_json.get("message") or raw_body
                except Exception:
                    error_body = f"HTTP Error {status_code}"

                # If 401 or 403, don't retry - token is invalid
                if status_code in (401, 403):
                    logger.error(f"Auth error {status_code} for {endpoint}: {error_body}")
                    return False, status_code, {"error": "Токен авторизации недействителен или срок его действия истек. Выполните привязку заново."}

                # If 404
                if status_code == 404:
                    return False, 404, {"error": f"Серверный эндпоинт не найден: {endpoint}"}

                # 429 Too Many Requests or 5xx Server Error -> retry with backoff
                last_error = f"Сервер вернул ошибку {status_code}: {error_body}"
                logger.warning(f"Request failed (attempt {attempt}/{retries}): {last_error}")

            except (urllib.error.URLError, socket.timeout, ConnectionError) as net_err:
                last_error = f"Ошибка сетевого соединения с {self.base_url}: {net_err}"
                logger.warning(f"Network error (attempt {attempt}/{retries}): {last_error}")

            except Exception as e:
                last_error = f"Непредвиденная ошибка HTTP-запроса: {e}"
                logger.error(last_error)

            if attempt < retries:
                time.sleep(delay)
                delay *= 2

        return False, 0, {"error": last_error or "Превышено время ожидания ответа сервера."}

    @staticmethod
    def _api_data(response: Any) -> Any:
        """Unwrap the v1 response envelope while keeping legacy endpoints compatible."""
        if isinstance(response, dict) and "data" in response:
            return response["data"]
        return response

    def pair(
        self,
        pairing_code: str,
        base_name: str,
        config_type: str,
        v8_version: str = "8.3",
        connection_type: str = "com",
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Pairs this agent with SmartRoute using the pairing code generated in the web app.
        """
        clean_code = str(pairing_code).strip().upper()
        payload = {
            "pairing_code": clean_code,
            "base_name": base_name,
            "config_type": config_type,
            "v8_version": v8_version,
            "connection_type": connection_type,
            "hostname": socket.gethostname(),
        }

        success, status, resp = self._make_request(
            "/api/integrations/1c/agent/pair",
            method="POST",
            data=payload,
            retries=2,
        )

        if not success:
            err = resp.get("error", "Не удалось привязать 1С к SmartRoute") if isinstance(resp, dict) else str(resp)
            return False, err, {}

        # Pairing responses from older deployments are unwrapped, while newer
        # API responses may use the standard {data: ...} envelope.
        result = self._api_data(resp)
        if not isinstance(result, dict) or not result.get("token"):
            logger.error("Pairing response did not contain an agent token")
            return False, "Сервер не вернул токен агента. Повторите привязку.", {}

        self.api_token = result["token"]
        self.agent_id = result.get("agent_id", "")
        return True, "1С успешно привязана к SmartRoute!", result

    def heartbeat(
        self,
        agent_id: str,
        status: str = "active",
        last_error: Optional[str] = None,
        orders_count: int = 0,
        statuses_count: int = 0,
    ) -> bool:
        """Sends periodic heartbeat signal to SmartRoute."""
        payload = {
            "agent_id": agent_id or self.agent_id,
            "status": status,
            "last_error": last_error,
            "orders_count": orders_count,
            "statuses_count": statuses_count,
        }
        success, _, _ = self._make_request(
            "/api/integrations/1c/agent/heartbeat",
            method="POST",
            data=payload,
            retries=1,
        )
        return success

    def sync_orders(
        self,
        orders: List[Dict[str, Any]],
        delivery_date: Optional[str] = None,
        chunk_size: int = 100,
    ) -> Tuple[bool, str, Dict[str, Any]]:
        """
        Pushes batch of orders from 1C to SmartRoute in manageable chunks.
        """
        if not orders:
            return True, "Нет новых заказов для передачи", {"total_received": 0, "created": 0, "updated": 0}

        total_created = 0
        total_updated = 0
        total_matched = 0

        # Chunk orders to prevent huge HTTP payload timeouts
        for i in range(0, len(orders), chunk_size):
            chunk = orders[i : i + chunk_size]
            payload = {
                "delivery_date": delivery_date,
                "orders": chunk,
            }

            success, status, resp = self._make_request(
                "/api/v1/orders/batch",
                method="POST",
                data=payload,
                retries=3,
            )

            if not success:
                err = resp.get("error", "Ошибка передачи заказов в SmartRoute") if isinstance(resp, dict) else str(resp)
                return False, f"Ошибка при передаче пакета #{i // chunk_size + 1}: {err}", {
                    "total_received": len(orders),
                    "created": total_created,
                    "updated": total_updated,
                }

            result = self._api_data(resp)
            if isinstance(result, dict):
                total_created += result.get("created", len(chunk))
                total_updated += result.get("updated", 0)
                total_matched += result.get("stores_matched", 0)

        return True, f"Успешно передано {len(orders)} заказов в SmartRoute ({total_created} новых, {total_updated} обновлено)", {
            "total_received": len(orders),
            "created": total_created,
            "updated": total_updated,
            "stores_matched": total_matched,
        }

    def get_delivery_updates(self, updated_from: Optional[str] = None) -> Tuple[bool, List[Dict[str, Any]]]:
        """
        Fetches updated delivery statuses from SmartRoute to write back into 1C.
        """
        endpoint = "/api/v1/orders"
        if updated_from:
            endpoint += f"?updated_from={urllib.parse.quote(str(updated_from))}"

        success, status, resp = self._make_request(endpoint, method="GET", retries=2)
        if not success or not isinstance(resp, dict):
            return False, []

        result = self._api_data(resp)
        return True, result.get("orders", []) if isinstance(result, dict) else []

    def log_sync_result(
        self,
        agent_id: str,
        status: str,
        orders_received: int,
        stores_matched: int,
        errors_count: int,
        error_detail: str,
        statuses_updated: int = 0,
    ):
        """Sends sync log record to server."""
        payload = {
            "agent_id": agent_id or self.agent_id,
            "status": status,
            "orders_received": orders_received,
            "stores_matched": stores_matched,
            "stores_unmatched": 0,
            "statuses_updated": statuses_updated,
            "errors_count": errors_count,
            "error_detail": error_detail,
        }
        self._make_request("/api/integrations/1c/agent/sync-log", method="POST", data=payload, retries=1)

