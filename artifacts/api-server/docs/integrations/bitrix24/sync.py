#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SmartRoute ↔ Bitrix24 — Синхронизация сделок
============================================

БЫСТРЫЙ СТАРТ (10 минут без программиста):
  1. pip install requests
  2. Укажите настройки ниже
  3. python3 sync.py --test   — проверить соединение
  4. python3 sync.py          — синхронизация за сегодня

Как получить BITRIX24_HOOK:
  Bitrix24 → Разработчикам → Другое → Входящий webhook
  Дайте доступ к CRM, скопируйте URL.
"""

import sys
import json
import argparse
from datetime import date

try:
    import requests
except ImportError:
    print("\n❌ pip install requests\n")
    sys.exit(1)

# ╔══════════════════════════════════════════════════════╗
# ║              НАСТРОЙКИ — ЗАПОЛНИТЕ ЗДЕСЬ             ║
# ╚══════════════════════════════════════════════════════╝

SMARTROUTE_URL  = "https://ВАШ_ДОМЕН"           # адрес SmartRoute
SMARTROUTE_KEY  = "sr_live_XXXX-XXXX"            # API-ключ SmartRoute
BITRIX24_HOOK   = "https://ВАШ.bitrix24.ru/rest/1/XXXXX/"  # URL входящего webhook
DEFAULT_CITY    = "Махачкала"                    # город по умолчанию

# ── Поля Bitrix24 (измените если у вас другие имена) ────────────────────────
FIELD_ADDRESS   = "UF_CRM_DELIVERY_ADDRESS"  # адрес доставки
FIELD_CITY      = "UF_CRM_DELIVERY_CITY"     # город
FIELD_DATE      = "UF_CRM_DELIVERY_DATE"     # дата доставки
FIELD_QTY       = "UF_CRM_QUANTITY"          # количество
FIELD_WEIGHT    = "UF_CRM_WEIGHT_KG"         # вес кг

# ╔══════════════════════════════════════════════════════╗
# ║                 КОД (не менять)                      ║
# ╚══════════════════════════════════════════════════════╝

SR_HEADERS = lambda: {"Authorization": f"Bearer {SMARTROUTE_KEY}", "Content-Type": "application/json"}
B24_HOOK   = lambda: BITRIX24_HOOK.rstrip("/")


def _check_settings() -> bool:
    ok = True
    if "ВАШ_ДОМЕН" in SMARTROUTE_URL:
        print("  ⚙️  Укажите SMARTROUTE_URL")
        ok = False
    if "XXXX" in SMARTROUTE_KEY:
        print("  ⚙️  Укажите SMARTROUTE_KEY")
        ok = False
    if "ВАШ.bitrix24" in BITRIX24_HOOK or "XXXXX" in BITRIX24_HOOK:
        print("  ⚙️  Укажите BITRIX24_HOOK")
        print("      Bitrix24 → Разработчикам → Входящий webhook")
        ok = False
    if not ok:
        print("\n  Откройте sync.py в текстовом редакторе и заполните настройки.\n")
    return ok


def b24_call(method: str, params: dict = None) -> dict | list:
    """Вызов Bitrix24 REST API."""
    r = requests.post(
        f"{B24_HOOK()}/{method}.json",
        json=params or {},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(
            f"Bitrix24 ошибка: {data['error']} — {data.get('error_description', '')}\n"
            f"Совет: проверьте URL входящего webhook (BITRIX24_HOOK)"
        )
    return data.get("result", data)


def test_connections() -> bool:
    print("\n🔌 Проверка соединений...\n")
    if not _check_settings():
        return False

    ok = True

    # SmartRoute
    try:
        r = requests.get(f"{SMARTROUTE_URL}/api/v1/keys/me", headers=SR_HEADERS(), timeout=10)
        if r.status_code == 200:
            print(f"  ✅ SmartRoute: подключено  (ключ: {r.json().get('name', '?')})")
        elif r.status_code == 401:
            print("  ❌ SmartRoute: неверный API-ключ — проверьте SMARTROUTE_KEY")
            ok = False
        else:
            print(f"  ❌ SmartRoute: ошибка {r.status_code}")
            ok = False
    except Exception as e:
        print(f"  ❌ SmartRoute: нет соединения — {e}")
        ok = False

    # Bitrix24
    try:
        profile = b24_call("profile")
        name = f"{profile.get('NAME', '')} {profile.get('LAST_NAME', '')}".strip() or "?"
        print(f"  ✅ Bitrix24: подключено    (пользователь: {name})")
    except Exception as e:
        print(f"  ❌ Bitrix24: ошибка — {e}")
        ok = False

    print()
    if ok:
        print("  ✅ Всё работает. Запускайте синхронизацию.\n")
    else:
        print("  ❌ Исправьте ошибки выше и запустите снова.\n")
    return ok


def get_deals(delivery_date: str) -> list[dict]:
    """Получить сделки из Bitrix24 за дату."""
    params = {
        "filter": {
            f">={FIELD_DATE}": f"{delivery_date} 00:00:00",
            f"<={FIELD_DATE}": f"{delivery_date} 23:59:59",
        },
        "select": [
            "ID", "TITLE", "COMPANY_TITLE",
            FIELD_ADDRESS, FIELD_CITY, FIELD_DATE, FIELD_QTY, FIELD_WEIGHT,
        ],
        "limit": 500,
    }
    result = b24_call("crm.deal.list", params)
    return result if isinstance(result, list) else []


def convert_deal(deal: dict, delivery_date: str) -> dict | None:
    company = (deal.get("COMPANY_TITLE") or deal.get("TITLE") or "").strip()
    if not company:
        return None
    address  = str(deal.get(FIELD_ADDRESS) or "").strip()
    city_raw = str(deal.get(FIELD_CITY)    or DEFAULT_CITY).strip()
    d_raw    = str(deal.get(FIELD_DATE)    or "").strip()
    d_date   = d_raw[:10] if d_raw else delivery_date
    return {
        "store_name":    company,
        "address":       address,
        "city":          city_raw or DEFAULT_CITY,
        "delivery_date": d_date,
        "quantity":      int(deal.get(FIELD_QTY)    or 1),
        "weight_kg":     float(deal.get(FIELD_WEIGHT) or 0),
        "external_id":   str(deal.get("ID", "")),
    }


def sync(delivery_date: str) -> None:
    print(f"\n📦 Синхронизация: Bitrix24 → SmartRoute")
    print(f"   Дата доставки: {delivery_date}\n")

    print("  1/3  Загружаем сделки из Bitrix24...")
    try:
        deals = get_deals(delivery_date)
    except RuntimeError as e:
        print(f"\n  ❌ {e}\n")
        return
    print(f"       Найдено сделок: {len(deals)}")

    if not deals:
        print(f"\n  ℹ️  Нет сделок на эту дату.")
        print(f"      Проверьте поле '{FIELD_DATE}' в Bitrix24.\n")
        return

    print("  2/3  Конвертируем данные...")
    orders  = [convert_deal(d, delivery_date) for d in deals]
    orders  = [o for o in orders if o]
    skipped = len(deals) - len(orders)
    print(f"       Готово: {len(orders)}" + (f"  (пропущено {skipped} без названия)" if skipped else ""))

    print("  3/3  Отправляем в SmartRoute...")
    try:
        r = requests.post(
            f"{SMARTROUTE_URL}/api/v1/orders/batch",
            headers=SR_HEADERS(),
            json={"orders": orders, "delivery_date": delivery_date},
            timeout=30,
        )
    except Exception as e:
        print(f"\n  ❌ Ошибка сети: {e}\n")
        return

    if r.status_code in (200, 201):
        data = r.json().get("data", {})
        print(f"\n  ✅ Успешно!")
        print(f"     Загружено: {data.get('imported')}  |  "
              f"Найдено: {data.get('matched')}  |  "
              f"Не найдено: {data.get('unmatched')}")
        if data.get("unmatched", 0) > 0:
            print(f"\n  ⚠️  Добавьте ненайденные магазины: SmartRoute → Магазины\n")
        else:
            print()
    elif r.status_code == 401:
        print("\n  ❌ Неверный API-ключ — проверьте SMARTROUTE_KEY\n")
    else:
        body = r.json() if r.ok or "json" in r.headers.get("content-type","") else {}
        msg  = (body.get("error") or {}).get("message") or r.text[:200]
        print(f"\n  ❌ Ошибка SmartRoute {r.status_code}: {msg}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Bitrix24 → SmartRoute синхронизация")
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--date", default=date.today().isoformat())
    args = parser.parse_args()

    if args.test:
        sys.exit(0 if test_connections() else 1)
    else:
        if test_connections():
            sync(args.date)
