/**
 * SmartRoute — интеграция с Google Таблицами
 * ==========================================
 *
 * КАК УСТАНОВИТЬ (5 минут, без программирования):
 * ─────────────────────────────────────────────
 * 1. Откройте вашу Google Таблицу
 * 2. Меню: Расширения → Apps Script
 * 3. Удалите весь текст (Ctrl+A → Delete)
 * 4. Вставьте этот файл целиком (Ctrl+V)
 * 5. Укажите SMARTROUTE_URL и SMARTROUTE_KEY ниже
 * 6. Сохраните (Ctrl+S)
 * 7. Обновите таблицу (F5) — появится меню SmartRoute
 * 8. Нажмите SmartRoute → 🔌 Проверить соединение
 *
 * КАК ПОЛЬЗОВАТЬСЯ:
 * ─────────────────
 * SmartRoute → 📦 Отправить заявки      — отправить данные таблицы
 * SmartRoute → 🔌 Проверить соединение  — убедиться что всё работает
 * SmartRoute → 📅 Авто-отправка         — каждый день в 8:00 автоматически
 */

// ╔══════════════════════════════════════════════════════╗
// ║              НАСТРОЙКИ — ЗАПОЛНИТЕ ЗДЕСЬ             ║
// ╚══════════════════════════════════════════════════════╝

var SMARTROUTE_URL = "https://ВАШ_ДОМЕН";        // ← адрес SmartRoute (без / в конце)
var SMARTROUTE_KEY = "sr_live_XXXX-XXXX";         // ← API-ключ из SmartRoute → Настройки
var SHEET_NAME     = "Заявки";                    // ← название листа в таблице
var DEFAULT_CITY   = "Махачкала";                 // ← город доставки по умолчанию

// ╔══════════════════════════════════════════════════════╗
// ║         СТРУКТУРА ТАБЛИЦЫ (минимальная)              ║
// ╠══════════════════════════════════════════════════════╣
// ║ A: Магазин  B: Адрес  C: Дата доставки  D: Кол-во  ║
// ║ Строка 1 — заголовки, строки 2+ — данные            ║
// ╚══════════════════════════════════════════════════════╝

// Добавляет меню SmartRoute при открытии таблицы
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("SmartRoute")
    .addItem("📦 Отправить заявки",            "sendOrdersToSmartRoute")
    .addSeparator()
    .addItem("🔌 Проверить соединение",         "checkConnection")
    .addItem("📅 Настроить авто-отправку",      "setupDailyTrigger")
    .addItem("🗑  Отключить авто-отправку",     "removeDailyTrigger")
    .addToUi();
}

// ═══════════════════════════════════════════════════════
// ПРОВЕРКА СОЕДИНЕНИЯ
// ═══════════════════════════════════════════════════════
function checkConnection() {
  if (!_checkSettings()) return;

  try {
    var keyResp = _fetch("GET", "/api/v1/keys/me");
    var storesResp = _fetch("GET", "/api/v1/stores?page_size=1");
    var count = ((storesResp.meta) || {}).total || "?";
    _alert(
      "✅ Соединение работает!\n\n" +
      "Ключ: " + (keyResp.name || keyResp.key_prefix || "OK") + "\n" +
      "Магазинов в базе: " + count + "\n\n" +
      "Можно отправлять заявки."
    );
  } catch (e) {
    _handleError(e, "Проверка соединения");
  }
}

// ═══════════════════════════════════════════════════════
// ОТПРАВКА ЗАЯВОК
// ═══════════════════════════════════════════════════════
function sendOrdersToSmartRoute() {
  if (!_checkSettings()) return;

  var ui    = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);

  if (!sheet) {
    _alert(
      '❌ Лист "' + SHEET_NAME + '" не найден\n\n' +
      "Что сделать:\n" +
      '1. Переименуйте нужный лист в "' + SHEET_NAME + '"\n' +
      "   (двойной клик на вкладку листа)\n" +
      "2. Или в коде измените SHEET_NAME на имя вашего листа"
    );
    return;
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    _alert("⚠️ Таблица пуста\n\nДобавьте данные начиная со строки 2.\nСтрока 1 — заголовки колонок.");
    return;
  }

  // Автоматическое определение колонок по заголовкам
  var headers = data[0].map(function(h) { return String(h).toLowerCase().trim(); });
  var C = {
    name:    _col(headers, ["магазин", "store", "название", "наименование", "name"]),
    address: _col(headers, ["адрес", "address"]),
    city:    _col(headers, ["город", "city"]),
    date:    _col(headers, ["дата", "date", "дата доставки", "delivery_date"]),
    qty:     _col(headers, ["количество", "qty", "кол-во", "кол", "quantity"]),
    weight:  _col(headers, ["вес", "weight", "кг", "kg"]),
    comment: _col(headers, ["комментарий", "примечание", "товары", "products", "notes"]),
  };

  if (C.name === -1) {
    _alert(
      "❌ Не найдена колонка «Магазин»\n\n" +
      "Первая строка таблицы должна содержать заголовки.\n" +
      "Обязательная колонка: Магазин (или Store, Название)\n\n" +
      "Найденные заголовки: " + headers.join(", ")
    );
    return;
  }

  var tz      = Session.getScriptTimeZone();
  var today   = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var orders  = [];
  var skipped = 0;

  for (var i = 1; i < data.length; i++) {
    var row  = data[i];
    var name = String(row[C.name] || "").trim();
    if (!name) { skipped++; continue; }

    orders.push({
      store_name:    name,
      address:       C.address !== -1 ? String(row[C.address] || "").trim()  : "",
      city:          C.city    !== -1 ? String(row[C.city]    || DEFAULT_CITY).trim() : DEFAULT_CITY,
      delivery_date: _parseDate(C.date !== -1 ? row[C.date] : null, tz, today),
      quantity:      C.qty     !== -1 ? (parseInt(row[C.qty])    || 1) : 1,
      weight_kg:     C.weight  !== -1 ? (parseFloat(row[C.weight]) || 0) : 0,
      products:      C.comment !== -1 ? String(row[C.comment] || "").trim() : "",
    });
  }

  if (orders.length === 0) {
    _alert("⚠️ Нет данных\n\nВсе строки пустые (" + skipped + " пропущено).");
    return;
  }

  var btn = ui.alert(
    "Подтверждение",
    "Готово к отправке: " + orders.length + " заявок" +
    (skipped > 0 ? "\nПропущено пустых строк: " + skipped : "") +
    "\n\nОтправить в SmartRoute?",
    ui.ButtonSet.YES_NO
  );
  if (btn !== ui.Button.YES) return;

  try {
    var result = _fetch("POST", "/api/v1/orders/batch", {
      orders:        orders,
      delivery_date: today,
    });

    var d   = result.data || result;
    var msg = "✅ Заявки отправлены!\n\n" +
              "Загружено:         " + (d.imported || orders.length) + " шт.\n" +
              "Найдено магазинов: " + (d.matched  || 0) + "\n";

    if ((d.unmatched || 0) > 0) {
      msg += "\n⚠️ Не найдено в базе: " + d.unmatched + " магазина(-ов)\n" +
             "Добавьте их: SmartRoute → Магазины → Добавить";
    }
    _alert(msg);

  } catch (e) {
    _handleError(e, "Отправка заявок");
  }
}

// ═══════════════════════════════════════════════════════
// АВТО-ОТПРАВКА
// ═══════════════════════════════════════════════════════
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "sendOrdersToSmartRoute") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("sendOrdersToSmartRoute").timeBased().everyDays(1).atHour(8).create();
  _alert("✅ Авто-отправка настроена!\n\nКаждый день в 8:00 данные будут отправляться автоматически.\n\nДля отключения: SmartRoute → 🗑 Отключить авто-отправку");
}

function removeDailyTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "sendOrdersToSmartRoute") { ScriptApp.deleteTrigger(t); n++; }
  });
  _alert(n > 0 ? "✅ Авто-отправка отключена" : "ℹ️ Авто-отправка не была настроена");
}

// ═══════════════════════════════════════════════════════
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (не трогать)
// ═══════════════════════════════════════════════════════
function _checkSettings() {
  if (!SMARTROUTE_URL || SMARTROUTE_URL === "https://ВАШ_ДОМЕН") {
    _alert("⚙️ Не настроен адрес сервера\n\nОткройте Apps Script и укажите SMARTROUTE_URL.");
    return false;
  }
  if (!SMARTROUTE_KEY || SMARTROUTE_KEY === "sr_live_XXXX-XXXX") {
    _alert("⚙️ Не указан API-ключ\n\nОткройте Apps Script и укажите SMARTROUTE_KEY.\n\nКлюч создаётся в SmartRoute → Настройки → API-ключи.");
    return false;
  }
  return true;
}

function _fetch(method, path, body) {
  var opts = {
    method:           method,
    headers:          { "Authorization": "Bearer " + SMARTROUTE_KEY },
    muteHttpExceptions: true,
  };
  if (body) {
    opts.contentType = "application/json";
    opts.payload     = JSON.stringify(body);
  }
  var resp = UrlFetchApp.fetch(SMARTROUTE_URL + path, opts);
  var code = resp.getResponseCode();
  var json = JSON.parse(resp.getContentText());

  if (code >= 200 && code < 300) return json;

  // Сформировать понятное сообщение об ошибке
  var err = (json.error || {}).message || json.detail || ("HTTP " + code);
  throw { code: code, message: err };
}

function _handleError(e, ctx) {
  var code = e.code || 0;
  var msg  = e.message || String(e);

  if (code === 401) {
    _alert("❌ Неверный API-ключ\n\nПроверьте SMARTROUTE_KEY в коде Apps Script.\nКлюч: SmartRoute → Настройки → API-ключи");
  } else if (code === 403) {
    _alert("❌ Недостаточно прав\n\nДобавьте права к ключу: orders:write\nSmartRoute → Настройки → API-ключи → Обновить");
  } else if (code === 422) {
    _alert("❌ Ошибка в данных\n\n" + msg + "\n\nПроверьте формат даты (ДД.ММ.ГГГГ) и названия магазинов");
  } else {
    _alert("❌ Ошибка (" + ctx + ")\n\n" + msg);
  }
}

function _col(headers, variants) {
  for (var i = 0; i < variants.length; i++) {
    var idx = headers.indexOf(variants[i]);
    if (idx !== -1) return idx;
  }
  return -1;
}

function _parseDate(val, tz, fallback) {
  if (!val) return fallback;
  if (val instanceof Date) return Utilities.formatDate(val, tz, "yyyy-MM-dd");
  var s = String(val).trim();
  // ДД.ММ.ГГГГ → ГГГГ-ММ-ДД
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(s)) {
    var p = s.split("."); return p[2] + "-" + p[1] + "-" + p[0];
  }
  return s || fallback;
}

function _alert(msg) {
  SpreadsheetApp.getUi().alert(msg);
}
