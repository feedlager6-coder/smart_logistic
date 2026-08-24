"""
SmartRoute Python Client SDK
=============================

Официальный Python-клиент для SmartRoute Public API v1.

Установка зависимостей:
    pip install requests

Использование:
    from smartroute_client import SmartRouteClient

    sr = SmartRouteClient(
        base_url="https://ваш-домен.railway.app",
        api_key="sr_live_XXXX-XXXX",
    )

    # Получить список магазинов
    stores = sr.stores.list(page=1, page_size=50)
    print(stores["data"])

    # Отправить заказы
    result = sr.orders.batch(
        orders=[
            {
                "store_name": "Магазин Центральный",
                "address": "ул. Пушкина, 10",
                "delivery_date": "2026-07-01",
                "quantity": 48,
                "weight_kg": 120.5,
            }
        ],
        delivery_date="2026-07-01",
    )
    print(result["data"])
"""

from __future__ import annotations

import time
from datetime import date, datetime
from typing import Any, Optional
import requests

__version__ = "1.0.0"
__all__ = ["SmartRouteClient", "SmartRouteError"]


class SmartRouteError(Exception):
    """Raised when SmartRoute API returns a non-2xx status."""

    def __init__(self, status_code: int, error_code: str, message: str, request_id: str = "") -> None:
        self.status_code = status_code
        self.error_code  = error_code
        self.message     = message
        self.request_id  = request_id
        super().__init__(f"[{status_code}] {error_code}: {message} (req={request_id})")


class _Resource:
    def __init__(self, client: SmartRouteClient) -> None:
        self._client = client

    def _get(self, path: str, params: dict | None = None) -> dict:
        return self._client._request("GET", path, params=params)

    def _post(self, path: str, body: dict | None = None) -> dict:
        return self._client._request("POST", path, json=body)

    def _put(self, path: str, body: dict) -> dict:
        return self._client._request("PUT", path, json=body)

    def _delete(self, path: str, params: dict | None = None) -> dict:
        return self._client._request("DELETE", path, params=params)


# ── Stores ──────────────────────────────────────────────────────────────────

class StoresResource(_Resource):
    """CRUD-операции с магазинами (точками доставки)."""

    def list(
        self,
        page: int = 1,
        page_size: int = 50,
        q: str | None = None,
        city: str | None = None,
    ) -> dict:
        """Получить список магазинов с пагинацией.

        Args:
            page:      Номер страницы (с 1).
            page_size: Размер страницы (1–200).
            q:         Поиск по названию/адресу.
            city:      Фильтр по городу.

        Returns:
            Словарь с ключами ``data`` (list[dict]), ``meta`` (пагинация), ``request_id``.
        """
        params = {"page": page, "page_size": page_size}
        if q:    params["q"]    = q
        if city: params["city"] = city
        return self._get("/api/v1/stores", params)

    def get(self, store_id: int) -> dict:
        """Получить магазин по ID."""
        return self._get(f"/api/v1/stores/{store_id}")

    def create(
        self,
        name: str,
        address: str,
        city: str = "",
        lat: float | None = None,
        lon: float | None = None,
        contact_phone: str = "",
        time_from: str = "",
        time_to: str = "",
        unload_minutes: int = 0,
    ) -> dict:
        """Создать новый магазин.

        Args:
            name:           Название магазина.
            address:        Адрес доставки.
            city:           Город (добавляется перед адресом для геокодинга).
            lat/lon:        Координаты (если известны).
            contact_phone:  Телефон контакта.
            time_from/to:   Временное окно ("09:00").
            unload_minutes: Время разгрузки в минутах.

        Returns:
            Созданный объект магазина (``data``).
        """
        body: dict[str, Any] = {"name": name, "address": address, "city": city}
        if lat is not None: body["lat"] = lat
        if lon is not None: body["lon"] = lon
        if contact_phone:   body["contact_phone"]  = contact_phone
        if time_from:       body["time_from"]       = time_from
        if time_to:         body["time_to"]         = time_to
        if unload_minutes:  body["unload_minutes"]  = unload_minutes
        return self._post("/api/v1/stores", body)

    def update(self, store_id: int, **fields) -> dict:
        """Обновить поля магазина. Передавайте только изменяемые поля."""
        return self._put(f"/api/v1/stores/{store_id}", fields)

    def delete(self, store_id: int) -> dict:
        """Удалить магазин."""
        return self._delete(f"/api/v1/stores/{store_id}")

    def batch_upsert(self, stores: list[dict]) -> dict:
        """Массовое создание/обновление магазинов (upsert по name+city).

        Limit: 1000 магазинов за вызов.
        """
        return self._post("/api/v1/stores/batch", {"stores": stores})


# ── Orders ───────────────────────────────────────────────────────────────────

class OrdersResource(_Resource):
    """Заявки на доставку (daily_orders)."""

    def list(self, delivery_date: str | date) -> dict:
        """Получить заявки на указанную дату.

        Args:
            delivery_date: Дата в формате YYYY-MM-DD или объект date.
        """
        if isinstance(delivery_date, date):
            delivery_date = delivery_date.isoformat()
        return self._get("/api/v1/orders", {"date": delivery_date})

    def batch(self, orders: list[dict], delivery_date: str | date | None = None) -> dict:
        """Массово загрузить заявки на доставку.

        Args:
            orders:        Список заказов. Каждый — dict со следующими полями:
                           - store_name (str, обязательно)
                           - address (str)
                           - city (str)
                           - delivery_date (str, YYYY-MM-DD)
                           - quantity (int)
                           - weight_kg (float)
                           - products (str)
                           - external_id (str)
            delivery_date: Дата по умолчанию для заявок без delivery_date.

        Returns:
            dict с ключами imported, matched, unmatched.
        """
        body: dict[str, Any] = {"orders": orders}
        if delivery_date is not None:
            if isinstance(delivery_date, date):
                delivery_date = delivery_date.isoformat()
            body["delivery_date"] = delivery_date
        return self._post("/api/v1/orders/batch", body)

    def delete(self, delivery_date: str | date) -> dict:
        """Удалить все заявки на указанную дату."""
        if isinstance(delivery_date, date):
            delivery_date = delivery_date.isoformat()
        return self._delete("/api/v1/orders", {"date": delivery_date})


# ── Routes ───────────────────────────────────────────────────────────────────

class RoutesResource(_Resource):
    """Маршруты и сессии оптимизации."""

    def build(
        self,
        store_ids: list[int],
        vehicles: list[dict],
        depot_lat: float = 42.9849,
        depot_lon: float = 47.5046,
        delivery_date: str | date | None = None,
        max_stops_per_vehicle: int | None = None,
        use_time_windows: bool = False,
        use_unload_time: bool = True,
        average_speed: int = 40,
    ) -> dict:
        """Построить оптимальные маршруты (VRP).

        Args:
            store_ids:             Список ID магазинов для включения в маршруты.
            vehicles:              Список машин: [{"name": "Авто 1", "capacity_kg": 1000}, ...]
            depot_lat/lon:         Координаты склада (дефолт — Махачкала).
            delivery_date:         Дата доставки (YYYY-MM-DD).
            max_stops_per_vehicle: Лимит точек на машину.
            use_time_windows:      Учитывать временные окна магазинов.
            use_unload_time:       Учитывать время разгрузки.
            average_speed:         Средняя скорость (км/ч), используется при отсутствии OSRM.

        Returns:
            Объект сессии маршрута с routes, summary, savings.
        """
        body: dict[str, Any] = {
            "store_ids":       store_ids,
            "vehicles":        vehicles,
            "depot_lat":       depot_lat,
            "depot_lon":       depot_lon,
            "use_time_windows": use_time_windows,
            "use_unload_time": use_unload_time,
            "average_speed":   average_speed,
            "optimize_by":     "distance",
        }
        if delivery_date is not None:
            if isinstance(delivery_date, date):
                delivery_date = delivery_date.isoformat()
            body["delivery_date"] = delivery_date
        if max_stops_per_vehicle is not None:
            body["max_stops_per_vehicle"] = max_stops_per_vehicle
        return self._post("/api/v1/routes/build", body)

    def list(self, page: int = 1, page_size: int = 20) -> dict:
        """Список сессий маршрутов (история)."""
        return self._get("/api/v1/routes", {"page": page, "page_size": page_size})

    def get(self, session_id: int) -> dict:
        """Получить детали сессии маршрута."""
        return self._get(f"/api/v1/routes/{session_id}")

    def delete(self, session_id: int) -> dict:
        """Удалить сессию маршрута."""
        return self._delete(f"/api/v1/routes/{session_id}")


# ── Analytics ────────────────────────────────────────────────────────────────

class AnalyticsResource(_Resource):
    """Аналитика маршрутов и экономии."""

    def summary(self) -> dict:
        """Общая сводка аналитики."""
        return self._get("/api/v1/analytics/summary")

    def daily(self, date_from: str, date_to: str) -> dict:
        """Ежедневная статистика в диапазоне дат."""
        return self._get("/api/v1/analytics/daily", {"date_from": date_from, "date_to": date_to})

    def monthly(self, date_from: str, date_to: str) -> dict:
        """Помесячная статистика."""
        return self._get("/api/v1/analytics/monthly", {"date_from": date_from, "date_to": date_to})

    def top_stores(self) -> dict:
        """Топ-10 магазинов по количеству доставок."""
        return self._get("/api/v1/analytics/top-stores")

    def vehicle_load(self, date_from: str, date_to: str) -> dict:
        """Загрузка транспорта по дням."""
        return self._get("/api/v1/analytics/vehicle-load", {"date_from": date_from, "date_to": date_to})


# ── Settings ─────────────────────────────────────────────────────────────────

class SettingsResource(_Resource):
    """Настройки компании (стоимость км)."""

    def get(self) -> dict:
        """Получить текущие настройки."""
        return self._get("/api/v1/settings")

    def update(self, fuel_price: float | None = None, fuel_consumption: float | None = None) -> dict:
        """Обновить настройки.

        Args:
            fuel_price:       Цена топлива (₽/л).
            fuel_consumption: Расход топлива (л/100 км).
        """
        body: dict[str, Any] = {}
        if fuel_price is not None:       body["fuel_price"]       = fuel_price
        if fuel_consumption is not None: body["fuel_consumption"] = fuel_consumption
        return self._put("/api/v1/settings", body)


# ── Keys ─────────────────────────────────────────────────────────────────────

class KeysResource(_Resource):
    """Информация о текущем API-ключе."""

    def me(self) -> dict:
        """Метаданные текущего API-ключа (без секрета)."""
        return self._get("/api/v1/keys/me")


# ── Main Client ──────────────────────────────────────────────────────────────

class SmartRouteClient:
    """SmartRoute API клиент.

    Args:
        base_url: Базовый URL SmartRoute (без слеша в конце).
                  Например: ``https://my-app.railway.app``
        api_key:  API-ключ вида ``sr_live_XXXX-XXXX``.
        timeout:  Таймаут HTTP-запросов в секундах (по умолчанию 30).
        retries:  Количество повторных попыток при сетевых ошибках (по умолчанию 2).

    Example::

        from smartroute_client import SmartRouteClient
        sr = SmartRouteClient("https://my-app.railway.app", "sr_live_…")
        stores = sr.stores.list()
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: int = 30,
        retries: int = 2,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._timeout = timeout
        self._retries = retries

        self._session = requests.Session()
        self._session.headers.update({
            "Authorization": f"Bearer {api_key}",
            "Content-Type":  "application/json",
            "User-Agent":    f"smartroute-python/{__version__}",
        })

        self.stores    = StoresResource(self)
        self.orders    = OrdersResource(self)
        self.routes    = RoutesResource(self)
        self.analytics = AnalyticsResource(self)
        self.settings  = SettingsResource(self)
        self.keys      = KeysResource(self)

    def _request(
        self,
        method: str,
        path: str,
        params: dict | None = None,
        json: dict | None = None,
    ) -> dict:
        url = self.base_url + path
        last_exc: Exception | None = None

        for attempt in range(self._retries + 1):
            try:
                resp = self._session.request(
                    method, url, params=params, json=json, timeout=self._timeout
                )
            except requests.RequestException as exc:
                last_exc = exc
                if attempt < self._retries:
                    time.sleep(1.5 ** attempt)
                continue

            if resp.ok:
                return resp.json()

            # Try to parse v1 error envelope
            try:
                body = resp.json()
                err  = body.get("error", {})
                raise SmartRouteError(
                    status_code=resp.status_code,
                    error_code=err.get("code", "UNKNOWN"),
                    message=err.get("message") or body.get("detail", resp.text[:200]),
                    request_id=body.get("request_id", ""),
                )
            except SmartRouteError:
                raise
            except Exception:
                raise SmartRouteError(
                    status_code=resp.status_code,
                    error_code="PARSE_ERROR",
                    message=resp.text[:200],
                )

        raise SmartRouteError(0, "NETWORK_ERROR", str(last_exc))

    def __repr__(self) -> str:
        return f"SmartRouteClient(base_url={self.base_url!r})"


# ── CLI / Quick test ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 3:
        print("Использование: python3 smartroute_client.py <BASE_URL> <API_KEY>")
        sys.exit(1)

    sr = SmartRouteClient(sys.argv[1], sys.argv[2])

    print("=== API Key Info ===")
    print(sr.keys.me())

    print("\n=== Stores (page 1) ===")
    stores = sr.stores.list()
    print(f"  Всего: {stores.get('meta', {}).get('total', '?')}")
    for s in (stores.get("data") or [])[:3]:
        print(f"  [{s['id']}] {s['name']} — {s.get('address', '')}")

    print("\n=== Analytics Summary ===")
    summary = sr.analytics.summary()
    data = summary.get("data", {})
    print(f"  Сессий: {data.get('total_sessions')}, Км: {data.get('total_km')}, "
          f"Экономия: {data.get('total_saved_rub')} ₽")
