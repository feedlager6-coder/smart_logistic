#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SmartRoute ↔ МойСклад — Синхронизация заявок
=============================================

БЫСТРЫЙ СТАРТ (10 минут без программиста):
  1. Установите зависимости:   pip install requests
  2. Укажите настройки ниже:   SMARTROUTE_URL, SMARTROUTE_KEY, MOYSKLAD_TOKEN
  3. Проверьте соединение:     python3 sync.py --test
  4. Запустите синхронизацию:  python3 sync.py

Для автозапуска каждый день в 7:30 (Linux/Mac):
  crontab -e
  30 7 * * * python3 /полный/путь/sync.py >> ~/smartroute.log 2>&1

Windows — используйте «Планировщик задач» (Task Scheduler).
"""

import sys
import json
import argparse
from datetime import date

try:
    import requests
except ImportError:
    print("\n❌ Не установлен пакет 'requests'")
    print("   Выполните: pip install requests\n")
    sys.exit(1)

# ╔══════════════════════════════════════════════════════╗
# ║              НАСТРОЙКИ — ЗАПОЛНИТЕ ЗДЕСЬ             ║
# ╚══════════════════════════════════════════════════════╝

SMARTROUTE_URL   = "https://ВАШ_ДОМЕН"          # адрес SmartRoute (без / в конце)
SMARTROUTE_KEY   = "sr_live_XXXX-XXXX"           # API-ключ: SmartRoute → Настройки → API-ключи
MOYSKLAD_TOKEN   = "ВАШ_ТОКЕН_MOYSKLAD"          # МойСклад → Настройки → Безопасность → Токены
DEFAULT_CITY     = "Махачкала"                   # город доставки по умолчанию

# ── Дополнительные настройки (менять при необходимости) ─────────────────────
DATE_FIELD       = "deliveryPlannedMoment"        # поле МойСклад с датой доставки
STAGE_FILTER     = None   # фильтр по этапу воронки, например: "Готов к доставке". None = все

# ╔══════════════════════════════════════════════════════╗
# ║                 КОД (не менять)                      ║
# ╚══════════════════════════════════════════════════════╝

MS_API = "https://api.moysklad.ru/api/remap/1.2"


def _check_settings() -> bool:
    """Проверить, что настройки заполнены."""
    ok = True
    if "ВАШ_ДОМЕН" in SMARTROUTE_URL:
        print("  ⚙️  Укажите SMARTROUTE_URL в начале файла")
        ok = False
    if "XXXX" in SMARTROUTE_KEY:
        print("  ⚙️  Укажите SMARTROUTE_KEY в начале файла")
        ok = False
    if "ВАШ_ТОКЕН" in MOYSKLAD_TOKEN:
        print("  ⚙️  Укажите MOYSKLAD_TOKEN в начале файла")
        print("      МойСклад → имя пользователя → Настройки → Безопасность → Токены")
        ok = False
    if not ok:
        print("\n  Откройте файл sync.py в текстовом редакторе и заполните настройки.\n")
    return ok


def test_connections() -> bool:
    """Проверить оба соединения и вывести понятный результат."""
    print("\n🔌 Проверка соединений...\n")

    if not _check_settings():
        return False

    ok = True

    # SmartRoute
    try:
        r = requests.get(f"{SMARTROUTE_URL}/api/v1/keys/me",
                         headers={"Authorization": f"Bearer {SMARTROUTE_KEY}"}, timeout=10)
        if r.status_code == 200:
            data = r.json()
            print(f"  ✅ SmartRoute: подключено  (ключ: {data.get('name', '?')})")
        elif r.status_code == 401:
            print("  ❌ SmartRoute: неверный API-ключ")
            print("      → Проверьте SMARTROUTE_KEY в начале файла")
            print("        SmartRoute → Настройки → API-ключи")
            ok = False
        elif r.status_code == 403:
            print("  ❌ SmartRoute: недостаточно прав у ключа")
            print("      → Нужные права: orders:write, webhooks:receive")
            ok = False
        else:
            print(f"  ❌ SmartRoute: ошибка {r.status_code}")
            ok = False
    except requests.exceptions.ConnectionError:
        print(f"  ❌ SmartRoute: нет соединения с {SMARTROUTE_URL}")
        print("      → Проверьте адрес сервера (SMARTROUTE_URL)")
        ok = False
    except Exception as e:
        print(f"  ❌ SmartRoute: ошибка — {e}")
        ok = False

    # МойСклад
    try:
        r = requests.get(f"{MS_API}/context/employee",
                         headers={"Authorization": f"Bearer {MOYSKLAD_TOKEN}"}, timeout=10)
        if r.status_code == 200:
            emp = r.json()
            name = emp.get("fullName") or emp.get("name", "?")
            print(f"  ✅ МойСклад: подключено   (пользователь: {name})")
        elif r.status_code == 401:
            print("  ❌ МойСклад: неверный токен")
            print("      → МойСклад → имя пользователя → Настройки → Безопасность → Токены")
            print("        Создайте новый токен и вставьте в MOYSKLAD_TOKEN")
            ok = False
        else:
            print(f"  ❌ МойСклад: ошибка {r.status_code}")
            ok = False
    except Exception as e:
        print(f"  ❌ МойСклад: нет соединения — {e}")
        ok = False

    print()
    if ok:
        print("  ✅ Оба соединения работают. Можно запускать синхронизацию.\n")
    else:
        print("  ❌ Исправьте ошибки выше и запустите снова.\n")
    return ok


def get_orders_from_moysklad(delivery_date: str) -> list[dict]:
    """Загрузить заказы из МойСклад за указанную дату."""
    filters = [
        f"{DATE_FIELD}>={delivery_date} 00:00:00",
        f"{DATE_FIELD}<={delivery_date} 23:59:59",
    ]
    if STAGE_FILTER:
        filters.append(f"state.name={STAGE_FILTER}")

    params = {
        "filter": ";".join(filters),
        "limit":  1000,
        "expand": "agent,state",
    }

    r = requests.get(
        f"{MS_API}/entity/customerorder",
        headers={"Authorization": f"Bearer {MOYSKLAD_TOKEN}"},
        params=params,
        timeout=30,
    )

    if r.status_code != 200:
        raise RuntimeError(
            f"МойСклад вернул ошибку {r.status_code}.\n"
            f"Подробности: {r.text[:300]}\n"
            f"Совет: проверьте токен и права доступа в МойСклад."
        )

    return r.json().get("rows", [])


def convert_to_smartroute(order: dict, delivery_date: str) -> dict | None:
    """Конвертировать заказ МойСклад → формат SmartRoute."""
    # Название магазина из контрагента
    agent = order.get("agent") or {}
    name  = agent.get("name", "").strip() or order.get("name", "").strip()
    if not name:
        return None  # пропустить заказы без контрагента

    # Адрес доставки
    address, city = "", DEFAULT_CITY
    ship = order.get("shippingAddress") or {}
    if ship:
        address  = ship.get("street", "").strip()
        city_raw = ship.get("city", "").strip()
        if city_raw:
            city = city_raw

    # Если адрес в доп. атрибутах — берём оттуда
    if not address:
        for attr in order.get("attributes", []):
            if "адрес" in (attr.get("name") or "").lower():
                address = str(attr.get("value", "")).strip()
                break

    # Дата доставки из поля заказа
    d_raw    = order.get(DATE_FIELD, "")
    delivery = d_raw[:10] if d_raw and len(d_raw) >= 10 else delivery_date

    # Суммарные количество и вес из позиций
    positions = (order.get("positions") or {}).get("rows", [])
    total_qty    = sum(int(p.get("quantity", 0)) for p in positions)
    total_weight = sum(
        float(p.get("quantity", 0)) *
        float((p.get("assortment") or {}).get("weight") or 0)
        for p in positions
    )

    return {
        "store_name":    name,
        "address":       address,
        "city":          city,
        "delivery_date": delivery,
        "quantity":      total_qty or 1,
        "weight_kg":     round(total_weight, 2),
        "external_id":   order.get("id", ""),
    }


def sync(delivery_date: str) -> None:
    """Основная синхронизация: МойСклад → SmartRoute."""
    print(f"\n📦 Синхронизация: МойСклад → SmartRoute")
    print(f"   Дата доставки: {delivery_date}\n")

    # Шаг 1: Получаем заказы
    print("  1/3  Загружаем заказы из МойСклад...")
    try:
        ms_orders = get_orders_from_moysklad(delivery_date)
    except RuntimeError as e:
        print(f"\n  ❌ {e}")
        return

    print(f"       Найдено заказов: {len(ms_orders)}")
    if not ms_orders:
        print("\n  ℹ️  Нет заказов на эту дату.")
        print(f"      Проверьте поле '{DATE_FIELD}' в заказах МойСклад.\n")
        return

    # Шаг 2: Конвертируем
    print("  2/3  Подготавливаем данные...")
    sr_orders = []
    skipped   = 0
    for order in ms_orders:
        converted = convert_to_smartroute(order, delivery_date)
        if converted:
            sr_orders.append(converted)
        else:
            skipped += 1

    print(f"       Готово к отправке: {len(sr_orders)}"
          + (f"  (пропущено {skipped} без имени)" if skipped else ""))

    # Шаг 3: Отправляем в SmartRoute
    print("  3/3  Отправляем в SmartRoute...")
    try:
        r = requests.post(
            f"{SMARTROUTE_URL}/api/v1/orders/batch",
            headers={"Authorization": f"Bearer {SMARTROUTE_KEY}", "Content-Type": "application/json"},
            json={"orders": sr_orders, "delivery_date": delivery_date},
            timeout=30,
        )
    except Exception as e:
        print(f"\n  ❌ Ошибка сети: {e}\n")
        return

    if r.status_code in (200, 201):
        data = r.json().get("data", {})
        print(f"\n  ✅ Успешно!")
        print(f"     Загружено заявок: {data.get('imported', '?')}")
        print(f"     Найдено магазинов: {data.get('matched', '?')}")
        if data.get("unmatched", 0) > 0:
            print(f"\n  ⚠️  Не найдено {data['unmatched']} магазина(-ов)")
            print(f"      Добавьте их: SmartRoute → Магазины → Добавить магазин")
        print()
    elif r.status_code == 401:
        print("\n  ❌ Неверный API-ключ SmartRoute")
        print("      Проверьте SMARTROUTE_KEY в начале файла\n")
    elif r.status_code == 403:
        print("\n  ❌ Недостаточно прав у ключа SmartRoute")
        print("      Нужные права: orders:write\n")
    else:
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        msg  = (body.get("error") or {}).get("message") or body.get("detail") or r.text[:200]
        print(f"\n  ❌ Ошибка SmartRoute {r.status_code}: {msg}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="МойСклад → SmartRoute синхронизация",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Примеры:
  python3 sync.py               — синхронизация за сегодня
  python3 sync.py --test        — проверить соединения
  python3 sync.py --date 2026-07-15  — конкретная дата
        """,
    )
    parser.add_argument("--test",  action="store_true",               help="Проверить соединения")
    parser.add_argument("--date",  default=date.today().isoformat(),  help="Дата (ГГГГ-ММ-ДД)")
    args = parser.parse_args()

    if args.test:
        ok = test_connections()
        sys.exit(0 if ok else 1)
    else:
        if test_connections():
            sync(args.date)
