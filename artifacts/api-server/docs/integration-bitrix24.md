# Интеграция SmartRoute ↔ Bitrix24

Автоматически передавайте сделки/заказы из Bitrix24 в SmartRoute.

## Архитектура

```
Bitrix24 (Сделка/Заказ создана)
    │  Исходящий webhook
    ▼
SmartRoute Webhook Adapter  ←── или ──→  Bitrix24 REST API polling
    │  POST /api/v1/orders/batch
    ▼
SmartRoute (заявки на доставку)
```

---

## Метод 1: Исходящий Webhook из Bitrix24

### Шаг 1: Создать исходящий webhook в Bitrix24
1. Bitrix24 → Приложения → Webhook → Добавить
2. Тип: Исходящий webhook
3. Событие: `ONCRMDEALADD` (создание сделки) или `ONCRMDEALUPDATE`
4. URL: `https://ВАШ_АДАПТЕР/webhook/bitrix24`

### Шаг 2: Адаптер (Python/Flask)

```python
"""
bitrix24_webhook_adapter.py
Принимает события Bitrix24 и пересылает заказы в SmartRoute.

pip install flask requests
"""
import os, requests
from flask import Flask, request, jsonify
from datetime import date

app = Flask(__name__)

SMARTROUTE_URL = os.environ.get("SMARTROUTE_URL", "https://ВАШ_ДОМЕН")
SMARTROUTE_KEY = os.environ.get("SMARTROUTE_KEY", "sr_live_XXXX-XXXX")
B24_INBOUND_TOKEN = os.environ.get("B24_INBOUND_TOKEN", "")  # опционально

SR_HEADERS = {
    "Authorization": f"Bearer {SMARTROUTE_KEY}",
    "Content-Type": "application/json",
}


def deal_to_smartroute(deal: dict) -> dict | None:
    """Конвертировать сделку Bitrix24 в заказ SmartRoute."""
    title = deal.get("TITLE", "")
    company = deal.get("COMPANY_TITLE") or title or "Без имени"

    # Адрес из UF-полей (настройте под свои поля)
    address = deal.get("UF_CRM_DELIVERY_ADDRESS") or deal.get("COMMENTS", "")
    city    = deal.get("UF_CRM_DELIVERY_CITY") or "Махачкала"

    # Дата доставки
    delivery_date = deal.get("UF_CRM_DELIVERY_DATE", "")
    if not delivery_date:
        delivery_date = date.today().isoformat()
    elif "T" in delivery_date:
        delivery_date = delivery_date[:10]

    # Вес и количество
    weight_kg = float(deal.get("UF_CRM_WEIGHT_KG", 0) or 0)
    quantity  = int(deal.get("UF_CRM_QUANTITY", 1) or 1)

    if not address and not city:
        return None  # нет адреса — пропустить

    return {
        "store_name":    company,
        "address":       address,
        "city":          city,
        "delivery_date": delivery_date,
        "quantity":      quantity,
        "weight_kg":     weight_kg,
        "external_id":   str(deal.get("ID", "")),
    }


@app.route("/webhook/bitrix24", methods=["POST"])
def bitrix24_webhook():
    data = request.form.to_dict() or request.json or {}

    # Проверка токена (если настроен)
    if B24_INBOUND_TOKEN and data.get("auth[application_token]") != B24_INBOUND_TOKEN:
        return jsonify({"error": "forbidden"}), 403

    event = data.get("event", "")
    deal_id = data.get("data[FIELDS][ID]") or data.get("data[ID]", "")

    if not deal_id:
        return jsonify({"ok": True, "skipped": "no deal_id"})

    # Получить детали сделки через REST API
    b24_domain = data.get("auth[domain]", "")
    b24_token  = data.get("auth[access_token]", "")

    deal_resp = requests.get(
        f"https://{b24_domain}/rest/crm.deal.get",
        params={"id": deal_id, "auth": b24_token},
        timeout=10,
    )
    if not deal_resp.ok:
        return jsonify({"error": "bitrix api error"}), 502

    deal = deal_resp.json().get("result", {})
    order = deal_to_smartroute(deal)

    if not order:
        return jsonify({"ok": True, "skipped": "no address"})

    sr_resp = requests.post(
        f"{SMARTROUTE_URL}/api/v1/orders/batch",
        headers=SR_HEADERS,
        json={"orders": [order]},
        timeout=15,
    )

    return jsonify({
        "ok": sr_resp.status_code in (200, 201),
        "smartroute_status": sr_resp.status_code,
        "data": sr_resp.json() if sr_resp.ok else sr_resp.text[:200],
    })


if __name__ == "__main__":
    app.run(port=5001)
```

---

## Метод 2: REST API polling (без дополнительного сервера)

```python
"""
bitrix24_poll.py — опрос Bitrix24 и синхронизация в SmartRoute.
Запускать по cron каждые 30 минут.

pip install requests
"""
import requests, os
from datetime import date, datetime, timedelta

B24_URL   = "https://ВАШ_ПОРТАЛ.bitrix24.ru"
B24_TOKEN = os.environ["B24_INBOUND_TOKEN"]   # токен входящего webhook
SR_URL    = os.environ.get("SMARTROUTE_URL", "https://ВАШ_ДОМЕН")
SR_KEY    = os.environ["SMARTROUTE_KEY"]

def get_deals_for_today() -> list[dict]:
    today = date.today().isoformat()
    resp = requests.post(
        f"{B24_URL}/rest/crm.deal.list",
        json={
            "auth": B24_TOKEN,
            "filter": {
                ">UF_CRM_DELIVERY_DATE": f"{today}T00:00:00",
                "<UF_CRM_DELIVERY_DATE": f"{today}T23:59:59",
                "STAGE_ID": "WON",  # или ваш статус «Готов к доставке»
            },
            "select": ["ID", "TITLE", "COMPANY_TITLE",
                       "UF_CRM_DELIVERY_ADDRESS", "UF_CRM_DELIVERY_CITY",
                       "UF_CRM_DELIVERY_DATE", "UF_CRM_WEIGHT_KG",
                       "UF_CRM_QUANTITY"],
            "limit": 500,
        },
        timeout=30,
    )
    return resp.json().get("result", [])


def sync():
    deals = get_deals_for_today()
    print(f"Сделок из Bitrix24: {len(deals)}")
    orders = [deal_to_smartroute(d) for d in deals]
    orders = [o for o in orders if o]

    if not orders:
        print("Нечего отправлять")
        return

    resp = requests.post(
        f"{SR_URL}/api/v1/orders/batch",
        headers={"Authorization": f"Bearer {SR_KEY}", "Content-Type": "application/json"},
        json={"orders": orders, "delivery_date": date.today().isoformat()},
        timeout=30,
    )
    data = resp.json().get("data", {})
    print(f"SmartRoute: imported={data.get('imported')}, "
          f"matched={data.get('matched')}, unmatched={data.get('unmatched')}")


def deal_to_smartroute(deal: dict) -> dict | None:
    company = deal.get("COMPANY_TITLE") or deal.get("TITLE") or "Без имени"
    address = deal.get("UF_CRM_DELIVERY_ADDRESS", "").strip()
    city    = deal.get("UF_CRM_DELIVERY_CITY", "Махачкала").strip()
    d_date  = (deal.get("UF_CRM_DELIVERY_DATE") or date.today().isoformat())[:10]
    if not address: return None
    return {
        "store_name":    company,
        "address":       address,
        "city":          city,
        "delivery_date": d_date,
        "quantity":      int(deal.get("UF_CRM_QUANTITY") or 1),
        "weight_kg":     float(deal.get("UF_CRM_WEIGHT_KG") or 0),
        "external_id":   str(deal.get("ID", "")),
    }


if __name__ == "__main__":
    sync()
```

---

## Пользовательские поля Bitrix24

Создайте следующие UF-поля в разделе Сделки:

| Код поля | Тип | Название |
|---|---|---|
| `UF_CRM_DELIVERY_ADDRESS` | Строка | Адрес доставки |
| `UF_CRM_DELIVERY_CITY` | Строка | Город доставки |
| `UF_CRM_DELIVERY_DATE` | Дата | Дата доставки |
| `UF_CRM_WEIGHT_KG` | Число | Вес (кг) |
| `UF_CRM_QUANTITY` | Число | Количество |

---

## Troubleshooting

| Ошибка | Решение |
|---|---|
| `forbidden` в адаптере | Проверьте `B24_INBOUND_TOKEN` |
| `no address` | Заполните поле `UF_CRM_DELIVERY_ADDRESS` в сделке |
| 401 от SmartRoute | Проверьте `SMARTROUTE_KEY` |
| Сделки не находятся | Проверьте фильтр `STAGE_ID` — укажите правильный этап воронки |
