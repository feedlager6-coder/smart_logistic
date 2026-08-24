#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
╔══════════════════════════════════════════════════════╗
║        SmartRoute — Мастер настройки интеграции      ║
╚══════════════════════════════════════════════════════╝

Запустите этот файл и следуйте инструкциям на экране.
Мастер поможет:
  1. Проверить соединение с SmartRoute
  2. Выбрать нужную систему (1С, МойСклад, Bitrix24, Google Sheets)
  3. Создать готовый к использованию конфигурационный файл

Требования: Python 3.8+ (без дополнительных пакетов)

Запуск:
  python3 setup_wizard.py
"""

import json
import sys
import os
import urllib.request
import urllib.error
from getpass import getpass

# ── Цвета терминала ────────────────────────────────────────────────────────────
GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
DIM    = "\033[2m"
RESET  = "\033[0m"

def title(text):
    width = 56
    print(f"\n{CYAN}{'═' * width}{RESET}")
    print(f"{CYAN}{BOLD}  {text}{RESET}")
    print(f"{CYAN}{'═' * width}{RESET}")

def step(n, text):
    print(f"\n{BOLD}{CYAN}Шаг {n}.{RESET} {text}")

def ok(text):
    print(f"  {GREEN}✅  {text}{RESET}")

def err(text):
    print(f"  {RED}❌  {text}{RESET}")

def warn(text):
    print(f"  {YELLOW}⚠️   {text}{RESET}")

def info(text):
    print(f"  {DIM}ℹ️   {text}{RESET}")

def ask(prompt, default=""):
    if default:
        val = input(f"\n  {BOLD}{prompt}{RESET} [{DIM}{default}{RESET}]: ").strip()
        return val or default
    else:
        val = input(f"\n  {BOLD}{prompt}{RESET}: ").strip()
        return val

def choose(prompt, options):
    print(f"\n  {BOLD}{prompt}{RESET}")
    for i, (key, label) in enumerate(options, 1):
        print(f"    {CYAN}{i}{RESET}. {label}")
    while True:
        raw = input(f"\n  Введите номер (1–{len(options)}): ").strip()
        if raw.isdigit() and 1 <= int(raw) <= len(options):
            return options[int(raw) - 1][0]
        print(f"  {RED}Неверный ввод — введите число от 1 до {len(options)}{RESET}")

def http_get(url, api_key):
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("User-Agent", "SmartRoute-SetupWizard/1.0")
    resp = urllib.request.urlopen(req, timeout=10)
    return json.loads(resp.read().decode())

def http_post(url, api_key, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Bearer {api_key}")
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "SmartRoute-SetupWizard/1.0")
    resp = urllib.request.urlopen(req, timeout=15)
    return json.loads(resp.read().decode())

# ══════════════════════════════════════════════════════
# БЛОК 1: Приветствие
# ══════════════════════════════════════════════════════

def main():
    os.system("cls" if sys.platform == "win32" else "clear")
    print(f"""
{CYAN}{BOLD}╔══════════════════════════════════════════════════════╗
║        SmartRoute — Мастер настройки интеграции      ║
╚══════════════════════════════════════════════════════╝{RESET}

Этот мастер поможет подключить SmartRoute к вашей системе
за 5–15 минут без помощи программиста.

Поддерживаемые системы:
  • Google Таблицы (Google Sheets)
  • МойСклад
  • Bitrix24
  • 1С:Предприятие
""")

    input(f"  {DIM}Нажмите Enter, чтобы начать...{RESET}")

    # ══════════════════════════════════════════════════════
    # БЛОК 2: Ввод данных подключения
    # ══════════════════════════════════════════════════════
    title("Данные для подключения к SmartRoute")

    print(f"""
  Вам потребуются:
    1. {BOLD}Адрес SmartRoute{RESET} — URL вашего сервера
       Пример: https://my-company.railway.app
    2. {BOLD}API-ключ{RESET} — создайте его в SmartRoute:
       Настройки → API-ключи → Создать ключ
       Права ключа: orders:write, webhooks:receive
""")

    base_url = ask("Адрес SmartRoute (без / в конце)", "https://").rstrip("/")
    api_key  = ask("API-ключ (sr_live_...)")

    if not api_key.startswith("sr_"):
        warn("API-ключ обычно начинается с 'sr_live_' или 'sr_test_'")

    # ══════════════════════════════════════════════════════
    # БЛОК 3: Проверка соединения
    # ══════════════════════════════════════════════════════
    title("Проверка соединения")

    step(1, "Проверяем доступность сервера SmartRoute...")

    try:
        data = http_get(f"{base_url}/api/v1/keys/me", api_key)
        ok(f"Соединение установлено!")
        info(f"Ключ: {data.get('name', '?')} | Права: {', '.join(data.get('scopes', []))}")
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if e.code == 401:
            err("Неверный API-ключ")
            print(f"""
  {RED}Что делать:{RESET}
    1. Откройте SmartRoute → Настройки → API-ключи
    2. Убедитесь, что ключ активен (не отозван)
    3. Скопируйте ключ ещё раз — он чувствителен к регистру
""")
        elif e.code == 403:
            err(f"Ключ не имеет нужных прав. Добавьте: orders:write, webhooks:receive")
        else:
            err(f"Сервер вернул ошибку {e.code}: {body[:200]}")
        sys.exit(1)
    except urllib.error.URLError as e:
        err(f"Не удалось подключиться к {base_url}")
        print(f"""
  {RED}Возможные причины:{RESET}
    • Неверный адрес сервера (проверьте протокол https://)
    • SmartRoute не запущен или недоступен
    • Нет доступа в интернет
    • Адрес содержит опечатку: '{base_url}'
""")
        sys.exit(1)

    step(2, "Проверяем данные в SmartRoute...")
    try:
        stores_data = http_get(f"{base_url}/api/v1/stores?page_size=5", api_key)
        stores_meta = stores_data.get("meta", {})
        total_stores = stores_meta.get("total", "?")
        ok(f"Магазины: {total_stores} шт.")
    except Exception:
        warn("Не удалось получить список магазинов (возможно, нет прав stores:read)")

    # ══════════════════════════════════════════════════════
    # БЛОК 4: Выбор системы интеграции
    # ══════════════════════════════════════════════════════
    title("Выбор системы для интеграции")

    system = choose("Какую систему подключаем?", [
        ("sheets",   "Google Таблицы (Google Sheets)"),
        ("moysklad", "МойСклад"),
        ("bitrix24", "Bitrix24"),
        ("1c",       "1С:Предприятие"),
        ("webhook",  "Другая система (универсальный Webhook)"),
    ])

    # ══════════════════════════════════════════════════════
    # БЛОК 5: Настройка выбранной системы
    # ══════════════════════════════════════════════════════

    if system == "sheets":
        setup_google_sheets(base_url, api_key)
    elif system == "moysklad":
        setup_moysklad(base_url, api_key)
    elif system == "bitrix24":
        setup_bitrix24(base_url, api_key)
    elif system == "1c":
        setup_1c(base_url, api_key)
    elif system == "webhook":
        setup_webhook(base_url, api_key)

    # ══════════════════════════════════════════════════════
    # ФИНАЛ
    # ══════════════════════════════════════════════════════
    title("Готово!")
    print(f"""
  {GREEN}{BOLD}Настройка завершена успешно.{RESET}

  Если возникнут проблемы:
    • Проверьте адрес сервера и API-ключ
    • Убедитесь, что у ключа есть нужные права
    • Запустите тест соединения ещё раз:
      python3 setup_wizard.py

  Документация: {base_url}/api/v1/docs
""")


# ══════════════════════════════════════════════════════
# GOOGLE SHEETS
# ══════════════════════════════════════════════════════

def setup_google_sheets(base_url, api_key):
    title("Настройка: Google Таблицы")

    print(f"""
  Google Таблицы позволяют отправлять заявки в SmartRoute
  прямо из ячеек таблицы — кнопкой или по расписанию.

  {BOLD}Что вам понадобится:{RESET}
    • Аккаунт Google
    • Google Таблица с данными о заказах
""")

    delivery_date = ask("Дата доставки по умолчанию (ГГГГ-ММ-ДД)", _today())
    sheet_name = ask("Название листа в таблице", "Заявки")

    script = _google_sheets_script(base_url, api_key, delivery_date, sheet_name)

    out_file = "SmartRoute_GoogleSheets.gs"
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(script)

    print(f"""
  {GREEN}✅ Файл создан: {BOLD}{out_file}{RESET}

  {BOLD}Как установить (5 минут):{RESET}

  1. Откройте вашу Google Таблицу
     🔗 https://sheets.google.com

  2. В меню выберите: {BOLD}Расширения → Apps Script{RESET}

  3. Удалите весь код в редакторе (Ctrl+A → Delete)

  4. Откройте файл {BOLD}{out_file}{RESET} любым текстовым редактором,
     скопируйте весь текст и вставьте в Apps Script

  5. Нажмите {BOLD}💾 Сохранить{RESET} (Ctrl+S)

  6. Обновите страницу Google Таблицы —
     появится новое меню: {BOLD}SmartRoute{RESET}

  7. Нажмите {BOLD}SmartRoute → 🔌 Проверить соединение{RESET}
     Вы увидите: "✅ Соединение работает! Магазинов: N"

  8. Нажмите {BOLD}SmartRoute → 📦 Отправить заявки{RESET}

  {YELLOW}Структура таблицы:{RESET}
  | A: Магазин | B: Адрес | C: Дата доставки | D: Количество | E: Комментарий |
""")


def _google_sheets_script(base_url, api_key, delivery_date, sheet_name):
    return f'''/**
 * SmartRoute — интеграция с Google Таблицами
 * ==========================================
 * Автоматически создан мастером настройки SmartRoute
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 * Меню SmartRoute → "📦 Отправить заявки" — отправить заявки в SmartRoute
 * Меню SmartRoute → "🔌 Проверить соединение" — проверить, что всё работает
 * Меню SmartRoute → "📅 Настроить авто-отправку" — отправлять каждый день автоматически
 */

// ─── НАСТРОЙКИ (менять только эти значения) ────────────────────────────────
var SMARTROUTE_URL    = "{base_url}";
var SMARTROUTE_KEY    = "{api_key}";
var SHEET_NAME        = "{sheet_name}";       // название листа в таблице
var DEFAULT_DATE      = "{delivery_date}";    // дата по умолчанию (ГГГГ-ММ-ДД)
var DEFAULT_CITY      = "Махачкала";          // город по умолчанию
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Добавляет меню SmartRoute при открытии таблицы
 */
function onOpen() {{
  SpreadsheetApp.getUi()
    .createMenu("SmartRoute")
    .addItem("📦 Отправить заявки", "sendOrdersToSmartRoute")
    .addSeparator()
    .addItem("🔌 Проверить соединение", "checkConnection")
    .addItem("📅 Настроить авто-отправку", "setupDailyTrigger")
    .addItem("🗑 Отключить авто-отправку", "removeDailyTrigger")
    .addToUi();
}}

/**
 * ПРОВЕРКА СОЕДИНЕНИЯ
 * Проверяет, что ключ и адрес сервера работают
 */
function checkConnection() {{
  try {{
    var response = UrlFetchApp.fetch(SMARTROUTE_URL + "/api/v1/keys/me", {{
      method: "GET",
      headers: {{ "Authorization": "Bearer " + SMARTROUTE_KEY }},
      muteHttpExceptions: true,
    }});

    var code = response.getResponseCode();
    var body = JSON.parse(response.getContentText());

    if (code === 200) {{
      // Получить количество магазинов
      var storesResp = UrlFetchApp.fetch(SMARTROUTE_URL + "/api/v1/stores?page_size=1", {{
        method: "GET",
        headers: {{ "Authorization": "Bearer " + SMARTROUTE_KEY }},
        muteHttpExceptions: true,
      }});
      var storesData = JSON.parse(storesResp.getContentText());
      var storeCount = (storesData.meta || {{}}).total || "?";

      SpreadsheetApp.getUi().alert(
        "✅ Соединение работает!\\n\\n" +
        "Ключ: " + (body.name || body.key_prefix || "OK") + "\\n" +
        "Магазинов в базе: " + storeCount + "\\n\\n" +
        "Можно отправлять заявки."
      );
    }} else if (code === 401) {{
      SpreadsheetApp.getUi().alert(
        "❌ Ошибка: Неверный API-ключ\\n\\n" +
        "Что делать:\\n" +
        "1. Откройте SmartRoute → Настройки → API-ключи\\n" +
        "2. Убедитесь, что ключ активен\\n" +
        "3. Скопируйте ключ заново и замените значение SMARTROUTE_KEY в коде"
      );
    }} else if (code === 403) {{
      SpreadsheetApp.getUi().alert(
        "❌ Ошибка: Недостаточно прав\\n\\n" +
        "Что делать:\\n" +
        "1. Откройте SmartRoute → Настройки → API-ключи\\n" +
        "2. Нажмите 'Обновить' рядом с ключом\\n" +
        "3. Добавьте права: orders:write, webhooks:receive"
      );
    }} else {{
      SpreadsheetApp.getUi().alert("❌ Ошибка " + code + ":\\n" + response.getContentText().substring(0, 200));
    }}
  }} catch (e) {{
    SpreadsheetApp.getUi().alert(
      "❌ Не удалось подключиться к серверу\\n\\n" +
      "Адрес сервера: " + SMARTROUTE_URL + "\\n\\n" +
      "Что делать:\\n" +
      "1. Проверьте адрес сервера (SMARTROUTE_URL)\\n" +
      "2. Убедитесь, что у вас есть доступ в интернет\\n\\n" +
      "Ошибка: " + e.message
    );
  }}
}}

/**
 * ОТПРАВКА ЗАЯВОК
 * Читает данные из таблицы и отправляет в SmartRoute
 */
function sendOrdersToSmartRoute() {{
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {{
    ui.alert(
      "❌ Лист не найден\\n\\n" +
      "Лист с именем \\"" + SHEET_NAME + "\\" не найден в таблице.\\n\\n" +
      "Что делать:\\n" +
      "1. Переименуйте нужный лист в \\"" + SHEET_NAME + "\\"\\n" +
      "   (двойной клик на вкладку листа → введите название)\\n" +
      "2. Или измените SHEET_NAME в коде на имя вашего листа"
    );
    return;
  }}

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {{
    ui.alert("⚠️ Таблица пуста\\n\\nДобавьте данные начиная со строки 2.\\nСтрока 1 — это заголовки.");
    return;
  }}

  // Определяем колонки автоматически по заголовкам
  var headers = data[0].map(function(h) {{ return String(h).toLowerCase().trim(); }});
  var cols = {{
    name:    findCol(headers, ["магазин", "store", "название", "наименование", "name"]),
    address: findCol(headers, ["адрес", "address"]),
    city:    findCol(headers, ["город", "city"]),
    date:    findCol(headers, ["дата", "date", "дата доставки"]),
    qty:     findCol(headers, ["количество", "qty", "кол-во", "кол", "quantity"]),
    weight:  findCol(headers, ["вес", "weight", "кг"]),
    comment: findCol(headers, ["комментарий", "примечание", "products", "товары", "notes"]),
  }};

  if (cols.name === -1) {{
    ui.alert(
      "❌ Колонка 'Магазин' не найдена\\n\\n" +
      "Первая строка должна содержать заголовки.\\n" +
      "Обязательная колонка: Магазин (или Store, Название)\\n\\n" +
      "Найденные заголовки: " + headers.join(", ")
    );
    return;
  }}

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var orders = [];
  var skipped = 0;

  for (var i = 1; i < data.length; i++) {{
    var row = data[i];
    var name = String(row[cols.name] || "").trim();
    if (!name) {{ skipped++; continue; }}

    var deliveryDate = DEFAULT_DATE || today;
    if (cols.date !== -1) {{
      var rawDate = row[cols.date];
      if (rawDate instanceof Date) {{
        deliveryDate = Utilities.formatDate(rawDate, Session.getScriptTimeZone(), "yyyy-MM-dd");
      }} else if (rawDate) {{
        var ds = String(rawDate).trim();
        // ДД.ММ.ГГГГ → ГГГГ-ММ-ДД
        if (/^\\d{{2}}\\.\\d{{2}}\\.\\d{{4}}$/.test(ds)) {{
          var parts = ds.split(".");
          deliveryDate = parts[2] + "-" + parts[1] + "-" + parts[0];
        }} else if (ds) {{
          deliveryDate = ds;
        }}
      }}
    }}

    orders.push({{
      store_name:    name,
      address:       cols.address !== -1 ? String(row[cols.address] || "").trim() : "",
      city:          cols.city    !== -1 ? String(row[cols.city]    || DEFAULT_CITY).trim() : DEFAULT_CITY,
      delivery_date: deliveryDate,
      quantity:      cols.qty     !== -1 ? (parseInt(row[cols.qty])    || 1) : 1,
      weight_kg:     cols.weight  !== -1 ? (parseFloat(row[cols.weight]) || 0) : 0,
      products:      cols.comment !== -1 ? String(row[cols.comment] || "").trim() : "",
    }});
  }}

  if (orders.length === 0) {{
    ui.alert("⚠️ Нет данных для отправки\\n\\nВсе строки пустые или пропущены (" + skipped + " пустых строк).");
    return;
  }}

  // Подтверждение перед отправкой
  var confirm = ui.alert(
    "Подтверждение отправки",
    "Готово к отправке: " + orders.length + " заявок\\n" +
    (skipped > 0 ? "Пропущено пустых строк: " + skipped + "\\n" : "") +
    "\\nОтправить в SmartRoute?",
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  // Отправляем
  try {{
    var response = UrlFetchApp.fetch(SMARTROUTE_URL + "/api/v1/orders/batch", {{
      method: "POST",
      headers: {{
        "Authorization": "Bearer " + SMARTROUTE_KEY,
        "Content-Type":  "application/json",
      }},
      payload: JSON.stringify({{
        orders: orders,
        delivery_date: today,
      }}),
      muteHttpExceptions: true,
    }});

    var code = response.getResponseCode();
    var body = JSON.parse(response.getContentText());

    if (code === 200 || code === 201) {{
      var d = body.data || body;
      var msg = "✅ Заявки отправлены успешно!\\n\\n";
      msg += "Загружено заявок: " + (d.imported || orders.length) + "\\n";
      msg += "Найдено магазинов: " + (d.matched || "—") + "\\n";
      if (d.unmatched > 0) {{
        msg += "\\n⚠️ Не найдено магазинов: " + d.unmatched + "\\n";
        msg += "Добавьте их в SmartRoute → Магазины";
      }}
      ui.alert(msg);
    }} else if (code === 401) {{
      ui.alert("❌ Ошибка авторизации\\n\\nПроверьте API-ключ (SMARTROUTE_KEY)");
    }} else if (code === 403) {{
      ui.alert("❌ Недостаточно прав\\n\\nДобавьте к ключу права: orders:write");
    }} else if (code === 422) {{
      var detail = (body.error || {{}}).message || JSON.stringify(body).substring(0, 300);
      ui.alert("❌ Ошибка в данных\\n\\n" + detail + "\\n\\nПроверьте формат дат (ГГГГ-ММ-ДД)");
    }} else {{
      ui.alert("❌ Ошибка сервера " + code + "\\n\\n" + response.getContentText().substring(0, 300));
    }}
  }} catch (e) {{
    ui.alert("❌ Ошибка сети\\n\\nНе удалось отправить данные.\\n\\n" + e.message);
  }}
}}

/**
 * АВТО-ОТПРАВКА: настройка ежедневного триггера
 */
function setupDailyTrigger() {{
  var ui = SpreadsheetApp.getUi();

  // Удалить старые триггеры этой функции
  ScriptApp.getProjectTriggers().forEach(function(t) {{
    if (t.getHandlerFunction() === "sendOrdersToSmartRoute") {{
      ScriptApp.deleteTrigger(t);
    }}
  }});

  // Создать новый триггер в 8:00
  ScriptApp.newTrigger("sendOrdersToSmartRoute")
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .create();

  ui.alert(
    "✅ Авто-отправка настроена!\\n\\n" +
    "Заявки будут отправляться каждый день в 8:00 утра автоматически.\\n\\n" +
    "Для отключения: SmartRoute → 🗑 Отключить авто-отправку"
  );
}}

function removeDailyTrigger() {{
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {{
    if (t.getHandlerFunction() === "sendOrdersToSmartRoute") {{
      ScriptApp.deleteTrigger(t);
      removed++;
    }}
  }});
  SpreadsheetApp.getUi().alert(removed > 0
    ? "✅ Авто-отправка отключена"
    : "ℹ️ Авто-отправка не была настроена"
  );
}}

// Вспомогательная функция: найти колонку по заголовку
function findCol(headers, variants) {{
  for (var i = 0; i < variants.length; i++) {{
    var idx = headers.indexOf(variants[i]);
    if (idx !== -1) return idx;
  }}
  return -1;
}}
'''


# ══════════════════════════════════════════════════════
# МОЙСКЛАД
# ══════════════════════════════════════════════════════

def setup_moysklad(base_url, api_key):
    title("Настройка: МойСклад")
    print(f"""
  Синхронизация заказов из МойСклад в SmartRoute.
  Скрипт запускается на вашем компьютере или сервере.

  {BOLD}Что вам понадобится:{RESET}
    • API-токен МойСклад (Настройки → Безопасность → Токен)
    • Python 3.8+ на компьютере или сервере
""")

    ms_token   = ask("API-токен МойСклад")
    city       = ask("Город доставки по умолчанию", "Махачкала")
    date_field = ask("Поле МойСклад для даты доставки", "deliveryPlannedMoment")

    out_file = "moysklad_sync.py"
    script = _moysklad_script(base_url, api_key, ms_token, city, date_field)
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(script)

    print(f"""
  {GREEN}✅ Файл создан: {BOLD}{out_file}{RESET}

  {BOLD}Как запустить:{RESET}

  1. Убедитесь, что Python установлен:
     python3 --version

  2. Установите зависимость (один раз):
     pip install requests

  3. Проверьте соединение с МойСклад:
     python3 {out_file} --test

  4. Запустите синхронизацию:
     python3 {out_file}

  {BOLD}Автоматический запуск (каждый день в 7:30):{RESET}
  На Linux/Mac — выполните в терминале:
     crontab -e
  Добавьте строку:
     30 7 * * * python3 {os.path.abspath(out_file)} >> ~/smartroute_sync.log 2>&1
""")


def _moysklad_script(base_url, api_key, ms_token, city, date_field):
    return f'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SmartRoute ↔ МойСклад — Синхронизация заказов
==============================================
Создан мастером настройки SmartRoute

Запуск:
  python3 moysklad_sync.py          # синхронизация за сегодня
  python3 moysklad_sync.py --test   # проверка соединения
  python3 moysklad_sync.py --date 2026-07-15  # конкретная дата
"""

import sys
import json
from datetime import date

try:
    import requests
except ImportError:
    print("❌ Не установлен пакет 'requests'")
    print("   Установите: pip install requests")
    sys.exit(1)

# ─── НАСТРОЙКИ (не менять без необходимости) ──────────────────────────────────
SMARTROUTE_URL   = "{base_url}"
SMARTROUTE_KEY   = "{api_key}"
MOYSKLAD_TOKEN   = "{ms_token}"
DEFAULT_CITY     = "{city}"
DATE_FIELD       = "{date_field}"   # поле МойСклад с датой доставки
STAGE_FILTER     = None  # фильтр по этапу, например: "WON". None = все этапы
# ─────────────────────────────────────────────────────────────────────────────

MS_API = "https://api.moysklad.ru/api/remap/1.2"

SR_HEADERS = {{
    "Authorization": f"Bearer {{SMARTROUTE_KEY}}",
    "Content-Type":  "application/json",
}}
MS_HEADERS = {{
    "Authorization": f"Bearer {{MOYSKLAD_TOKEN}}",
}}


def test_connections():
    """Проверка соединений с обеими системами."""
    print("\\n🔌 Проверка соединений...\\n")
    ok = True

    # SmartRoute
    try:
        r = requests.get(f"{{SMARTROUTE_URL}}/api/v1/keys/me", headers=SR_HEADERS, timeout=10)
        if r.status_code == 200:
            data = r.json()
            print(f"  ✅ SmartRoute: подключено (ключ: {{data.get('name', '?')}})")
        elif r.status_code == 401:
            print("  ❌ SmartRoute: неверный API-ключ")
            print("     → Проверьте SMARTROUTE_KEY в этом файле")
            ok = False
        else:
            print(f"  ❌ SmartRoute: ошибка {{r.status_code}}")
            ok = False
    except Exception as e:
        print(f"  ❌ SmartRoute: нет соединения ({{e}})")
        print(f"     → Проверьте SMARTROUTE_URL: {{SMARTROUTE_URL}}")
        ok = False

    # МойСклад
    try:
        r = requests.get(f"{{MS_API}}/context/employee", headers=MS_HEADERS, timeout=10)
        if r.status_code == 200:
            data = r.json()
            name = data.get("fullName") or data.get("name", "?")
            print(f"  ✅ МойСклад: подключено (пользователь: {{name}})")
        elif r.status_code == 401:
            print("  ❌ МойСклад: неверный токен")
            print("     → Проверьте MOYSKLAD_TOKEN в этом файле")
            print("     → Токен: МойСклад → Настройки → Безопасность → Токен")
            ok = False
        else:
            print(f"  ❌ МойСклад: ошибка {{r.status_code}}")
            ok = False
    except Exception as e:
        print(f"  ❌ МойСклад: нет соединения ({{e}})")
        ok = False

    if ok:
        print("\\n  ✅ Оба соединения работают. Можно запускать синхронизацию.")
    else:
        print("\\n  ❌ Исправьте ошибки выше и запустите снова.")
    return ok


def get_ms_orders(delivery_date: str) -> list:
    """Получить заказы из МойСклад за указанную дату."""
    filters = [
        f"{{DATE_FIELD}}>={{delivery_date}} 00:00:00",
        f"{{DATE_FIELD}}<={{delivery_date}} 23:59:59",
    ]
    if STAGE_FILTER:
        filters.append(f"state.name={{STAGE_FILTER}}")

    params = {{
        "filter":  ";".join(filters),
        "limit":   1000,
        "expand":  "agent,state",
    }}

    r = requests.get(f"{{MS_API}}/entity/customerorder", headers=MS_HEADERS, params=params, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"МойСклад API ошибка {{r.status_code}}: {{r.text[:300]}}")

    return r.json().get("rows", [])


def convert_order(order: dict, delivery_date: str) -> dict | None:
    """Конвертировать заказ МойСклад в формат SmartRoute."""
    # Имя магазина / контрагента
    agent = order.get("agent") or {{}}
    name = agent.get("name") or order.get("name", "").strip()
    if not name:
        return None

    # Адрес доставки (из атрибутов или адреса контрагента)
    address  = ""
    city     = DEFAULT_CITY

    ship = order.get("shippingAddress") or {{}}
    if ship:
        street   = ship.get("street", "")
        city_raw = ship.get("city", "")
        address  = street
        if city_raw:
            city = city_raw

    # Если адрес пустой — берём из атрибутов
    if not address:
        for attr in order.get("attributes", []):
            aname = (attr.get("name") or "").lower()
            if "адрес" in aname:
                address = str(attr.get("value", "")).strip()
                break

    # Дата доставки
    d_raw = order.get(DATE_FIELD, "")
    if d_raw and len(d_raw) >= 10:
        delivery = d_raw[:10]
    else:
        delivery = delivery_date

    # Вес и количество
    positions = (order.get("positions") or {{}}).get("rows", [])
    total_qty    = sum(int(p.get("quantity", 0)) for p in positions)
    total_weight = sum(
        float(p.get("quantity", 0)) * float((p.get("assortment") or {{}}).get("weight") or 0)
        for p in positions
    )

    return {{
        "store_name":    name,
        "address":       address,
        "city":          city,
        "delivery_date": delivery,
        "quantity":      total_qty or 1,
        "weight_kg":     round(total_weight, 2),
        "external_id":   order.get("id", ""),
    }}


def sync(delivery_date: str):
    """Основная функция синхронизации."""
    print(f"\\n📦 Синхронизация МойСклад → SmartRoute")
    print(f"   Дата доставки: {{delivery_date}}\\n")

    # 1. Получаем заказы
    print("  1. Загружаем заказы из МойСклад...")
    try:
        ms_orders = get_ms_orders(delivery_date)
    except RuntimeError as e:
        print(f"  ❌ Ошибка: {{e}}")
        print("     Проверьте токен МойСклад (MOYSKLAD_TOKEN) и подключение к интернету")
        return

    print(f"     Найдено заказов: {{len(ms_orders)}}")

    # 2. Конвертируем
    print("  2. Подготавливаем данные...")
    sr_orders = []
    skipped = 0
    for order in ms_orders:
        converted = convert_order(order, delivery_date)
        if converted:
            sr_orders.append(converted)
        else:
            skipped += 1

    print(f"     Готово к отправке: {{len(sr_orders)}} (пропущено {{skipped}} без имени)")

    if not sr_orders:
        print("\\n  ℹ️  Нет заявок для отправки за эту дату.")
        return

    # 3. Отправляем в SmartRoute
    print("  3. Отправляем в SmartRoute...")
    r = requests.post(
        f"{{SMARTROUTE_URL}}/api/v1/orders/batch",
        headers=SR_HEADERS,
        json={{"orders": sr_orders, "delivery_date": delivery_date}},
        timeout=30,
    )

    if r.status_code in (200, 201):
        data = r.json().get("data", {{}})
        print(f"\\n  ✅ Успешно!")
        print(f"     Загружено заявок: {{data.get('imported', '?')}}")
        print(f"     Найдено магазинов: {{data.get('matched', '?')}}")
        if data.get("unmatched", 0) > 0:
            print(f"\\n  ⚠️  Не найдено магазинов: {{data['unmatched']}}")
            print(f"     Добавьте их в SmartRoute: Настройки → Магазины")
    elif r.status_code == 401:
        print("\\n  ❌ Ошибка: неверный API-ключ SmartRoute")
        print("     Проверьте SMARTROUTE_KEY в этом файле")
    else:
        print(f"\\n  ❌ Ошибка SmartRoute {{r.status_code}}: {{r.text[:300]}}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="МойСклад → SmartRoute синхронизация")
    parser.add_argument("--test",         action="store_true",  help="Проверить соединения")
    parser.add_argument("--date", "-d",   default=date.today().isoformat(), help="Дата (ГГГГ-ММ-ДД)")
    args = parser.parse_args()

    if args.test:
        test_connections()
    else:
        if test_connections():
            sync(args.date)
'''


# ══════════════════════════════════════════════════════
# BITRIX24
# ══════════════════════════════════════════════════════

def setup_bitrix24(base_url, api_key):
    title("Настройка: Bitrix24")
    print(f"""
  Синхронизация сделок Bitrix24 → SmartRoute.

  {BOLD}Что вам понадобится:{RESET}
    • Входящий webhook Bitrix24
    • Python 3.8+ и pip install requests
""")

    print(f"""
  {BOLD}Как получить URL входящего webhook Bitrix24:{RESET}
  1. Зайдите в Bitrix24
  2. Откройте: Разработчикам → Другое → Входящий webhook
  3. Дайте доступ к разделу CRM
  4. Скопируйте URL (вида: https://ВАШ.bitrix24.ru/rest/1/XXXXX/)
""")

    b24_url = ask("URL входящего webhook Bitrix24")
    city = ask("Город доставки по умолчанию", "Махачкала")

    out_file = "bitrix24_sync.py"
    script = _bitrix24_script(base_url, api_key, b24_url, city)
    with open(out_file, "w", encoding="utf-8") as f:
        f.write(script)

    print(f"""
  {GREEN}✅ Файл создан: {BOLD}{out_file}{RESET}

  {BOLD}Как запустить:{RESET}
  1. pip install requests
  2. python3 {out_file} --test    # проверить соединение
  3. python3 {out_file}           # синхронизация за сегодня
  4. python3 {out_file} --date 2026-07-15  # конкретная дата
""")


def _bitrix24_script(base_url, api_key, b24_url, city):
    return f'''#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SmartRoute ↔ Bitrix24 — Синхронизация сделок
=============================================
Создан мастером настройки SmartRoute

Запуск:
  python3 bitrix24_sync.py           # синхронизация за сегодня
  python3 bitrix24_sync.py --test    # проверка соединений
  python3 bitrix24_sync.py --date 2026-07-15
"""

import sys, json, argparse
from datetime import date

try:
    import requests
except ImportError:
    print("❌ pip install requests")
    sys.exit(1)

# ─── НАСТРОЙКИ ────────────────────────────────────────────────────────────────
SMARTROUTE_URL  = "{base_url}"
SMARTROUTE_KEY  = "{api_key}"
BITRIX24_HOOK   = "{b24_url}".rstrip("/")   # URL входящего webhook
DEFAULT_CITY    = "{city}"

# Поля Bitrix24 для адреса/даты (настройте под свои UF-поля)
FIELD_ADDRESS   = "UF_CRM_DELIVERY_ADDRESS"   # адрес доставки
FIELD_CITY      = "UF_CRM_DELIVERY_CITY"      # город
FIELD_DATE      = "UF_CRM_DELIVERY_DATE"      # дата доставки (или "CLOSEDATE")
FIELD_QTY       = "UF_CRM_QUANTITY"           # количество
FIELD_WEIGHT    = "UF_CRM_WEIGHT_KG"          # вес кг
# ─────────────────────────────────────────────────────────────────────────────

SR_HEADERS = {{"Authorization": f"Bearer {{SMARTROUTE_KEY}}", "Content-Type": "application/json"}}


def b24_call(method, params=None):
    r = requests.post(f"{{BITRIX24_HOOK}}/{{method}}.json", json=params or {{}}, timeout=30)
    r.raise_for_status()
    data = r.json()
    if "error" in data:
        raise RuntimeError(f"Bitrix24 API ошибка: {{data['error']}} — {{data.get('error_description', '')}}")
    return data.get("result", data)


def test_connections():
    print("\\n🔌 Проверка соединений...\\n")
    ok = True

    # SmartRoute
    try:
        r = requests.get(f"{{SMARTROUTE_URL}}/api/v1/keys/me", headers=SR_HEADERS, timeout=10)
        if r.status_code == 200:
            print(f"  ✅ SmartRoute: OK (ключ: {{r.json().get('name', '?')}})")
        elif r.status_code == 401:
            print("  ❌ SmartRoute: неверный API-ключ — проверьте SMARTROUTE_KEY")
            ok = False
        else:
            print(f"  ❌ SmartRoute: ошибка {{r.status_code}}")
            ok = False
    except Exception as e:
        print(f"  ❌ SmartRoute недоступен: {{e}}")
        ok = False

    # Bitrix24
    try:
        profile = b24_call("profile")
        print(f"  ✅ Bitrix24: OK (пользователь: {{profile.get('NAME', '?')}} {{profile.get('LAST_NAME', '')}})")
    except Exception as e:
        print(f"  ❌ Bitrix24: ошибка — {{e}}")
        print(f"     Проверьте BITRIX24_HOOK: {{BITRIX24_HOOK}}")
        ok = False

    if ok:
        print("\\n  ✅ Всё работает. Запускайте синхронизацию.")
    return ok


def get_deals(delivery_date: str) -> list:
    """Получить сделки Bitrix24 за дату."""
    params = {{
        "filter": {{
            f">={{FIELD_DATE}}": f"{{delivery_date}} 00:00:00",
            f"<={{FIELD_DATE}}": f"{{delivery_date}} 23:59:59",
        }},
        "select": ["ID", "TITLE", "COMPANY_TITLE", FIELD_ADDRESS, FIELD_CITY,
                   FIELD_DATE, FIELD_QTY, FIELD_WEIGHT],
        "limit":  500,
    }}
    return b24_call("crm.deal.list", params) or []


def convert_deal(deal: dict, delivery_date: str) -> dict | None:
    company  = deal.get("COMPANY_TITLE") or deal.get("TITLE") or ""
    if not company.strip():
        return None
    address  = str(deal.get(FIELD_ADDRESS) or "").strip()
    city_raw = str(deal.get(FIELD_CITY)    or DEFAULT_CITY).strip()
    d_raw    = str(deal.get(FIELD_DATE)    or "").strip()
    d_date   = d_raw[:10] if d_raw else delivery_date
    return {{
        "store_name":    company,
        "address":       address,
        "city":          city_raw or DEFAULT_CITY,
        "delivery_date": d_date,
        "quantity":      int(deal.get(FIELD_QTY)    or 1),
        "weight_kg":     float(deal.get(FIELD_WEIGHT) or 0),
        "external_id":   str(deal.get("ID", "")),
    }}


def sync(delivery_date: str):
    print(f"\\n📦 Bitrix24 → SmartRoute | дата: {{delivery_date}}\\n")

    print("  1. Загружаем сделки из Bitrix24...")
    try:
        deals = get_deals(delivery_date)
    except Exception as e:
        print(f"  ❌ Ошибка Bitrix24: {{e}}")
        return
    print(f"     Найдено сделок: {{len(deals)}}")

    print("  2. Конвертируем данные...")
    orders = [convert_deal(d, delivery_date) for d in deals]
    orders = [o for o in orders if o]
    skipped = len(deals) - len(orders)
    print(f"     Готово: {{len(orders)}} (пропущено {{skipped}} без имени)")

    if not orders:
        print("\\n  ℹ️  Нет данных для отправки.")
        return

    print("  3. Отправляем в SmartRoute...")
    r = requests.post(f"{{SMARTROUTE_URL}}/api/v1/orders/batch",
        headers=SR_HEADERS, json={{"orders": orders, "delivery_date": delivery_date}}, timeout=30)

    if r.status_code in (200, 201):
        data = r.json().get("data", {{}})
        print(f"\\n  ✅ Успешно! Загружено: {{data.get('imported')}} | "
              f"Найдено: {{data.get('matched')}} | Не найдено: {{data.get('unmatched')}}")
        if data.get("unmatched", 0) > 0:
            print("  ⚠️  Добавьте ненайденные магазины: SmartRoute → Магазины")
    elif r.status_code == 401:
        print("  ❌ Ошибка: неверный API-ключ SmartRoute")
    else:
        print(f"  ❌ Ошибка {{r.status_code}}: {{r.text[:200]}}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--test", action="store_true")
    parser.add_argument("--date", "-d", default=date.today().isoformat())
    args = parser.parse_args()
    if args.test:
        test_connections()
    else:
        if test_connections():
            sync(args.date)
'''


# ══════════════════════════════════════════════════════
# 1С
# ══════════════════════════════════════════════════════

def setup_1c(base_url, api_key):
    title("Настройка: 1С:Предприятие")
    print(f"""
  Для 1С нужен программист на 1–2 часа.
  Всё что он должен сделать — скопировать готовый код.

  {BOLD}Что будет сделано:{RESET}
    1. Создаётся внешняя обработка SmartRoute (.epf файл)
    2. В ней — форма с кнопками и готовый BSL-код
    3. Вся логика уже написана — только вставить ключ
""")

    city = ask("Город доставки по умолчанию", "Махачкала")
    order_doc = ask("Имя документа в 1С (обычно)", "ЗаказКлиента")
    date_req = ask("Реквизит даты доставки в документе", "ДатаДоставки")
    address_req = ask("Реквизит адреса доставки", "АдресДоставки")

    out_file = "SmartRouteModule.bsl"
    bsl = _1c_bsl(base_url, api_key, city, order_doc, date_req, address_req)
    with open(out_file, "w", encoding="utf-8-sig") as f:
        f.write(bsl)

    print(f"""
  {GREEN}✅ Файл создан: {BOLD}{out_file}{RESET}

  {BOLD}Инструкция для программиста-1С (45 минут):{RESET}

  1. Откройте Конфигуратор 1С → Файл → Новый →
     Внешняя обработка → Имя: "SmartRoute"

  2. Вкладка «Формы» → Добавить форму
     На форме разместите 3 кнопки:
       - "Проверить соединение"   → вызов ПроверитьСоединение()
       - "Отправить заявки"       → вызов ОтправитьЗаявки()
       - "Дата доставки" (поле ввода типа Дата)

  3. Откройте модуль формы, скопируйте весь текст из
     файла {out_file} и вставьте

  4. В начале модуля задайте константы:
     URLSmartRoute = "{base_url}"
     APIКлюч       = "{api_key}"

  5. Сохраните, запустите 1С в режиме предприятия,
     откройте обработку → нажмите "Проверить соединение"
     Должно появиться: "✅ Соединение установлено"

  6. Настройте регламентное задание:
     Метаданные → Регламентные задания → Добавить
     Имя метода: ВнешниеОбработки.SmartRoute.ОтправитьЗаявки
     Расписание: ежедневно 07:30
""")


def _1c_bsl(base_url, api_key, city, order_doc, date_req, address_req):
    return f"""// ╔═══════════════════════════════════════════════════════╗
// ║   SmartRoute — Модуль интеграции для 1С:Предприятие  ║
// ╚═══════════════════════════════════════════════════════╝
// Создан мастером настройки SmartRoute
//
// УСТАНОВКА:
//   1. Скопируйте этот текст в модуль формы внешней обработки
//   2. Убедитесь, что URLSmartRoute и APIКлюч заданы верно
//   3. Нажмите "Проверить соединение" для теста
//
// Кнопки формы:
//   КнопкаПроверить  → Команда: СмартРоутПроверить
//   КнопкаОтправить  → Команда: СмартРоутОтправить
//   ПолеДатаДоставки → Тип: Дата

// ─── НАСТРОЙКИ ──────────────────────────────────────────────────────────────
Перем URLSmartRoute;   // Адрес сервера SmartRoute
Перем APIКлюч;         // API-ключ SmartRoute
Перем ГородПоУмолчанию;
// ────────────────────────────────────────────────────────────────────────────

Процедура ПриСозданииНаСервере(Отказ, СтандартнаяОбработка)
    URLSmartRoute    = "{base_url}";
    APIКлюч          = "{api_key}";
    ГородПоУмолчанию = "{city}";

    Элементы.ПолеДатаДоставки.Значение = НачалоДня(ТекущаяДата());
КонецПроцедуры


// ══════════════════════════════════════════════════════════
// ПРОВЕРКА СОЕДИНЕНИЯ
// ══════════════════════════════════════════════════════════

&НаКлиенте
Процедура СмартРоутПроверить(Команда)
    Результат = ПроверитьСоединениеНаСервере();
    Сообщить(Результат);
КонецПроцедуры

&НаСервере
Функция ПроверитьСоединениеНаСервере()
    // Проверить API-ключ
    СоединениеHTTP = _ПолучитьСоединение();
    ЗапросHTTP     = Новый HTTPЗапрос("/api/v1/keys/me", _ПолучитьЗаголовки());

    Попытка
        Ответ = СоединениеHTTP.Получить(ЗапросHTTP);
    Исключение
        Возврат "❌ Не удалось подключиться к " + URLSmartRoute + Символы.ПС
            + "Ошибка: " + ОписаниеОшибки() + Символы.ПС
            + Символы.ПС
            + "Проверьте адрес сервера (URLSmartRoute) в коде.";
    КонецПопытки;

    Если Ответ.КодСостояния = 200 Тогда
        ДанныеКлюча = _РазобратьJSON(Ответ.ПолучитьТелоКакСтроку());

        // Получить количество магазинов
        ЗапросМаг = Новый HTTPЗапрос("/api/v1/stores?page_size=1", _ПолучитьЗаголовки());
        Попытка
            ОтветМаг  = СоединениеHTTP.Получить(ЗапросМаг);
            ДанныеМаг = _РазобратьJSON(ОтветМаг.ПолучитьТелоКакСтроку());
            КолМаг = ДанныеМаг["meta"]["total"];
        Исключение
            КолМаг = "?";
        КонецПопытки;

        Возврат "✅ Соединение установлено!" + Символы.ПС
            + "Ключ: " + (ДанныеКлюча["name"] + "") + Символы.ПС
            + "Магазинов в базе SmartRoute: " + КолМаг;

    ИначеЕсли Ответ.КодСостояния = 401 Тогда
        Возврат "❌ Неверный API-ключ!" + Символы.ПС
            + Символы.ПС
            + "Что сделать:" + Символы.ПС
            + "1. Откройте SmartRoute → Настройки → API-ключи" + Символы.ПС
            + "2. Убедитесь, что ключ активен (не отозван)" + Символы.ПС
            + "3. Скопируйте ключ заново и обновите APIКлюч в коде";

    ИначеЕсли Ответ.КодСостояния = 403 Тогда
        Возврат "❌ Ключ найден, но нет нужных прав." + Символы.ПС
            + "Необходимые права: orders:write, webhooks:receive" + Символы.ПС
            + "SmartRoute → Настройки → API-ключи → Обновить ключ";

    Иначе
        Возврат "❌ Сервер вернул код: " + Ответ.КодСостояния + Символы.ПС
            + Лев(Ответ.ПолучитьТелоКакСтроку(), 300);
    КонецЕсли;
КонецФункции


// ══════════════════════════════════════════════════════════
// ОТПРАВКА ЗАЯВОК
// ══════════════════════════════════════════════════════════

&НаКлиенте
Процедура СмартРоутОтправить(Команда)
    ДатаДоставки = Элементы.ПолеДатаДоставки.Значение;
    Если НЕ ЗначениеЗаполнено(ДатаДоставки) Тогда
        Предупреждение("Укажите дату доставки");
        Возврат;
    КонецЕсли;

    Результат = ОтправитьЗаявкиНаСервере(ДатаДоставки);
    Сообщить(Результат);
КонецПроцедуры

// Вызов из регламентного задания
Процедура ОтправитьЗаявки() Экспорт
    ДатаДоставки = НачалоДня(ТекущаяДата());
    ОтправитьЗаявкиНаСервере(ДатаДоставки);
КонецПроцедуры

&НаСервере
Функция ОтправитьЗаявкиНаСервере(ДатаДоставки)
    // 1. Получить заказы из 1С
    Запрос = Новый Запрос;
    Запрос.Текст =
        "ВЫБРАТЬ
        |   З.Контрагент.Наименование КАК Магазин,
        |   З.{address_req}           КАК Адрес,
        |   З.КоличествоМест          КАК Количество,
        |   З.ВесКГ                   КАК ВесКГ,
        |   З.Комментарий             КАК Комментарий,
        |   З.Номер                   КАК Номер
        |ИЗ
        |   Документ.{order_doc} КАК З
        |ГДЕ
        |   З.{date_req} = &ДатаДоставки
        |   И НЕ З.ПометкаУдаления
        |   И З.Проведён";

    Запрос.УстановитьПараметр("ДатаДоставки", НачалоДня(ДатаДоставки));

    РезультатЗапроса = Запрос.Выполнить().Выгрузить();

    Если РезультатЗапроса.Количество() = 0 Тогда
        Возврат "ℹ️ Нет заказов на " + Формат(ДатаДоставки, "ДФ=дд.ММ.гггг");
    КонецЕсли;

    // 2. Сформировать JSON
    ДатаСтрокой = Формат(ДатаДоставки, "ДФ=yyyy-MM-dd");
    МассивЗаказов = Новый Массив;

    Для Каждого Строка Из РезультатЗапроса Цикл
        Если ПустаяСтрока(Строка.Магазин) Тогда
            Продолжить;
        КонецЕсли;

        Заказ = Новый Структура;
        Заказ.Вставить("store_name",    СокрЛП(Строка.Магазин));
        Заказ.Вставить("address",       СокрЛП(Строка.Адрес));
        Заказ.Вставить("city",          ГородПоУмолчанию);
        Заказ.Вставить("delivery_date", ДатаСтрокой);
        Заказ.Вставить("quantity",      ?(Строка.Количество > 0, Строка.Количество, 1));
        Заказ.Вставить("weight_kg",     Строка.ВесКГ);
        Заказ.Вставить("products",      СокрЛП(Строка.Комментарий));
        Заказ.Вставить("external_id",   СокрЛП(Строка.Номер));
        МассивЗаказов.Добавить(Заказ);
    КонецЦикла;

    Тело = Новый Структура;
    Тело.Вставить("orders", МассивЗаказов);
    Тело.Вставить("delivery_date", ДатаСтрокой);

    // 3. Отправить HTTP-запрос
    СоединениеHTTP = _ПолучитьСоединение();
    ЗапросHTTP     = Новый HTTPЗапрос("/api/v1/orders/batch", _ПолучитьЗаголовки());
    ЗапросHTTP.УстановитьТелоИзСтроки(_СформироватьJSON(Тело), КодировкаТекста.UTF8);

    Попытка
        Ответ = СоединениеHTTP.ОтправитьДляОбработки(ЗапросHTTP);
    Исключение
        Возврат "❌ Ошибка сети: " + ОписаниеОшибки() + Символы.ПС
            + "Проверьте доступ к интернету с сервера 1С";
    КонецПопытки;

    Если Ответ.КодСостояния = 200 Или Ответ.КодСостояния = 201 Тогда
        Данные = _РазобратьJSON(Ответ.ПолучитьТелоКакСтроку());
        ДанныеЗаказов = ?(Данные.Свойство("data"), Данные["data"], Данные);

        Результат = "✅ Заявки отправлены!" + Символы.ПС
            + "Загружено: "       + ДанныеЗаказов["imported"]  + Символы.ПС
            + "Найдено магазинов: " + ДанныеЗаказов["matched"]    + Символы.ПС
            + "Не найдено: "      + ДанныеЗаказов["unmatched"];

        Если ДанныеЗаказов["unmatched"] > 0 Тогда
            Результат = Результат + Символы.ПС
                + Символы.ПС
                + "⚠️ Добавьте ненайденные магазины в SmartRoute → Магазины";
        КонецЕсли;

        Возврат Результат;

    ИначеЕсли Ответ.КодСостояния = 401 Тогда
        Возврат "❌ Неверный API-ключ SmartRoute" + Символы.ПС + "Проверьте APIКлюч в коде";
    ИначеЕсли Ответ.КодСостояния = 422 Тогда
        Возврат "❌ Ошибка в данных: " + Лев(Ответ.ПолучитьТелоКакСтроку(), 300);
    Иначе
        Возврат "❌ Ошибка " + Ответ.КодСостояния + ": " + Лев(Ответ.ПолучитьТелоКакСтроку(), 200);
    КонецЕсли;
КонецФункции


// ══════════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ══════════════════════════════════════════════════════════

&НаСервереБезКонтекста
Функция _ПолучитьСоединение()
    // Парсим URL
    URL = URLSmartRoute;
    ЭтоHTTPS = НачинаетсяС(URL, "https://");
    URL = СтрЗаменить(СтрЗаменить(URL, "https://", ""), "http://", "");
    Хост = URL;
    Порт = ?(ЭтоHTTPS, 443, 80);

    Если ЭтоHTTPS Тогда
        СоединениеSSL = Новый ЗащищённоеСоединениеOpenSSL(,,, Ложь); // Ложь = не проверять самоподписанный
        Возврат Новый HTTPСоединение(Хост, Порт, ,, , 30, СоединениеSSL);
    Иначе
        Возврат Новый HTTPСоединение(Хост, Порт, ,, , 30);
    КонецЕсли;
КонецФункции

&НаСервереБезКонтекста
Функция _ПолучитьЗаголовки()
    Заголовки = Новый Соответствие;
    Заголовки.Вставить("Authorization", "Bearer " + APIКлюч);
    Заголовки.Вставить("Content-Type",  "application/json; charset=utf-8");
    Возврат Заголовки;
КонецФункции

&НаСервереБезКонтекста
Функция _СформироватьJSON(Объект)
    ЗаписьJSON = Новый ЗаписьJSON;
    НастройкиJSON = Новый НастройкиСериализацииJSON;
    НастройкиJSON.ВариантЗаписиДаты = ВариантЗаписиДатыJSON.ЛокальнаяДата;
    Сериализатор = Новый СериализаторXDTO;
    Возврат Сериализатор.ЗаписатьJSON(ЗаписьJSON, Объект, НастройкиJSON);
КонецФункции

&НаСервереБезКонтекста
Функция _РазобратьJSON(Строка)
    ЧтениеJSON = Новый ЧтениеJSON;
    ЧтениеJSON.УстановитьСтроку(Строка);
    Возврат ПрочитатьJSON(ЧтениеJSON, Истина);
КонецФункции
"""


# ══════════════════════════════════════════════════════
# УНИВЕРСАЛЬНЫЙ WEBHOOK
# ══════════════════════════════════════════════════════

def setup_webhook(base_url, api_key):
    title("Универсальный Webhook")
    print(f"""
  Подходит для любой системы, которая умеет делать HTTP-запросы.

  {BOLD}Данные для настройки в вашей системе:{RESET}

  URL:     {CYAN}{base_url}/api/v1/orders/batch{RESET}
  Метод:   POST
  Заголовок Authorization:  Bearer {api_key}
  Content-Type:              application/json

  {BOLD}Тело запроса (пример):{RESET}
  {{
    "orders": [
      {{
        "store_name":    "Магазин Центральный",
        "address":       "ул. Пушкина, 10",
        "city":          "Махачкала",
        "delivery_date": "2026-07-01",
        "quantity":      48,
        "weight_kg":     120.5,
        "products":      "Молоко, Хлеб"
      }}
    ]
  }}

  {BOLD}Тест через curl (скопируйте и запустите):{RESET}
  curl -X POST "{base_url}/api/v1/orders/batch" \\
    -H "Authorization: Bearer {api_key}" \\
    -H "Content-Type: application/json" \\
    -d '{{"orders":[{{"store_name":"Тест","address":"ул. Пушкина 1","delivery_date":"{_today()}","quantity":1}}]}}'

  {BOLD}Успешный ответ:{RESET}
  {{"data": {{"imported": 1, "matched": 0, "unmatched": 1}}}}
  (unmatched = магазин не найден в базе — добавьте его в SmartRoute → Магазины)
""")


# ══════════════════════════════════════════════════════
# УТИЛИТЫ
# ══════════════════════════════════════════════════════

def _today():
    from datetime import date
    return date.today().isoformat()

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n\n{YELLOW}Отменено.{RESET}")
        sys.exit(0)
