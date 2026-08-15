# Интеграция SmartRoute ↔ МойСклад

Автоматически передавайте заказы из МойСклад в SmartRoute через Webhook или скрипт.

## Метод 1: Webhook (рекомендуется)

МойСклад поддерживает отправку событий при изменении заказов. SmartRoute принимает их через универсальный Webhook.

### Шаг 1: Получите API-ключ SmartRoute
1. SmartRoute → Настройки → API-ключи → Создать ключ
2. Права: `orders:write`, `webhooks:receive`
3. Запишите ключ (показывается один раз)

### Шаг 2: Создайте Webhook в МойСклад
1. МойСклад → Настройки → Webhooks → Добавить webhook
2. URL: `https://ВАШ_ДОМЕН/api/v1/orders/batch`
3. Метод: POST
4. Тип: Заказ покупателя → Создан / Изменён

> **Внимание:** МойСклад шлёт свой формат JSON. Используйте скрипт-адаптер ниже, запущенный как посредник (middleware), или метод 2 (прямой скрипт).

---

## Метод 2: Python-скрипт (рекомендуется для MVP)

```python
"""
moysklad_sync.py — синхронизация заказов МойСклад → SmartRoute
Запуск: python3 moysklad_sync.py
Зависимости: pip install requests
"""

import requests
from datetime import date

# ── Настройки ─────────────────────────────────────────────────────────────
MOYSKLAD_TOKEN  = "ВАШ_MOYSKLAD_BEARER_TOKEN"   # МойСклад → Настройки → Приложения → Токен
SMARTROUTE_URL  = "https://ВАШ_ДОМЕН"
SMARTROUTE_KEY  = "sr_live_XXXX-XXXX"
DELIVERY_DATE   = date.today().isoformat()       # можно задать явно: "2026-07-01"

MS_API = "https://api.moysklad.ru/api/remap/1.2"
SR_HEADERS = {
    "Authorization": f"Bearer {SMARTROUTE_KEY}",
    "Content-Type":  "application/json",
}

def get_moysklad_orders(delivery_date: str) -> list[dict]:
    """Получить CustomerOrders из МойСклад за указанную дату."""
    resp = requests.get(
        f"{MS_API}/entity/customerorder",
        headers={"Authorization": f"Bearer {MOYSKLAD_TOKEN}"},
        params={
            "filter": f"deliveryPlannedMoment>={delivery_date} 00:00:00;"
                      f"deliveryPlannedMoment<={delivery_date} 23:59:59",
            "limit": 1000,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json().get("rows", [])


def ms_order_to_smartroute(order: dict) -> dict | None:
    """Конвертировать заказ МойСклад в формат SmartRoute."""
    # Адрес доставки
    shipping = order.get("shippingAddress") or {}
    address = shipping.get("postalAddress", {}).get("region", "")
    street = shipping.get("postalAddress", {}).get("street", "")
    city   = shipping.get("city", "")
    if not street and not city:
        return None  # пропустить заказы без адреса

    # Имя контрагента (=магазин)
    agent_href = (order.get("agent") or {}).get("meta", {}).get("href", "")
    agent_name = order.get("name", "Без имени")

    # Дата доставки
    delivery_ts = order.get("deliveryPlannedMoment", "")
    delivery_date = delivery_ts[:10] if delivery_ts else DELIVERY_DATE

    # Вес и количество из позиций
    positions = order.get("positions", {}).get("rows", [])
    total_weight = sum(
        (p.get("quantity", 0)) * (p.get("assortment", {}).get("weight", 0) or 0)
        for p in positions
    )
    total_qty = sum(int(p.get("quantity", 0)) for p in positions)

    return {
        "store_name":    agent_name,
        "address":       f"{street}".strip() or address,
        "city":          city or "Махачкала",
        "delivery_date": delivery_date,
        "quantity":      total_qty or 1,
        "weight_kg":     round(total_weight, 2),
        "external_id":   order.get("id", ""),
    }


def sync():
    print(f"[МойСклад→SmartRoute] Дата: {DELIVERY_DATE}")

    ms_orders = get_moysklad_orders(DELIVERY_DATE)
    print(f"  Получено из МойСклад: {len(ms_orders)} заказов")

    sr_orders = []
    for order in ms_orders:
        converted = ms_order_to_smartroute(order)
        if converted:
            sr_orders.append(converted)

    print(f"  Конвертировано: {len(sr_orders)}")

    if not sr_orders:
        print("  Нечего отправлять.")
        return

    resp = requests.post(
        f"{SMARTROUTE_URL}/api/v1/orders/batch",
        headers=SR_HEADERS,
        json={"orders": sr_orders, "delivery_date": DELIVERY_DATE},
        timeout=30,
    )

    if resp.status_code in (200, 201):
        data = resp.json().get("data", {})
        print(f"  ✅ SmartRoute: imported={data.get('imported')}, "
              f"matched={data.get('matched')}, unmatched={data.get('unmatched')}")
    else:
        print(f"  ❌ Ошибка {resp.status_code}: {resp.text[:200]}")


if __name__ == "__main__":
    sync()
```

### Запуск по расписанию (cron)
```bash
# Каждый день в 7:30 утра
30 7 * * * /usr/bin/python3 /opt/scripts/moysklad_sync.py >> /var/log/smartroute_sync.log 2>&1
```

---

## Метод 3: Webhook-адаптер (для продвинутых)

Если хотите real-time синхронизацию, запустите Flask-адаптер:

```python
"""
moysklad_webhook_adapter.py
Принимает webhook от МойСклад и пересылает в SmartRoute.
"""
from flask import Flask, request, jsonify
import requests, hmac, hashlib, os

app = Flask(__name__)
SMARTROUTE_URL = os.environ["SMARTROUTE_URL"]
SMARTROUTE_KEY = os.environ["SMARTROUTE_KEY"]
MS_SECRET      = os.environ.get("MS_WEBHOOK_SECRET", "")

@app.route("/webhook/moysklad", methods=["POST"])
def moysklad_webhook():
    # Опциональная проверка подписи МойСклад
    if MS_SECRET:
        sig = request.headers.get("X-Lognex-Signature", "")
        expected = hmac.new(MS_SECRET.encode(), request.data, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return jsonify({"error": "bad signature"}), 403

    events = request.json.get("events", [])
    orders = []
    for event in events:
        if event.get("entityType") != "customerorder":
            continue
        meta = event.get("meta", {})
        # Получить детали заказа (МойСклад шлёт только href)
        detail_resp = requests.get(meta["href"],
            headers={"Authorization": f"Bearer {os.environ['MS_TOKEN']}"}, timeout=10)
        if not detail_resp.ok:
            continue
        order = detail_resp.json()
        converted = ms_order_to_smartroute(order)  # функция из скрипта выше
        if converted:
            orders.append(converted)

    if orders:
        requests.post(f"{SMARTROUTE_URL}/api/v1/orders/batch",
            headers={"Authorization": f"Bearer {SMARTROUTE_KEY}"},
            json={"orders": orders}, timeout=15)

    return jsonify({"ok": True})
```

---

## Troubleshooting

| Ошибка | Причина | Решение |
|---|---|---|
| `KeyError: shippingAddress` | Заказ без адреса доставки | Проверьте поле «Адрес доставки» в МойСклад |
| 401 МойСклад | Истёк токен | Обновите `MOYSKLAD_TOKEN` в настройках приложения |
| unmatched > 0 | Магазин не найден в SmartRoute | Добавьте магазин в SmartRoute или проверьте написание |
