# Интеграция SmartRoute ↔ Google Sheets

Автоматически создавайте задания на доставку из Google Таблицы через Apps Script.

## Подготовка

### 1. Получите API-ключ SmartRoute
1. Откройте SmartRoute → Настройки → API-ключи
2. Создайте ключ с правами: `orders:write`, `webhooks:receive`
3. Сохраните ключ — он показывается только один раз

### 2. Структура таблицы

| A: Магазин | B: Адрес | C: Город | D: Дата доставки | E: Кол-во | F: Комментарий |
|---|---|---|---|---|---|
| Магазин Центр | ул. Пушкина 10 | Махачкала | 2026-07-01 | 48 | Молоко×12, Хлеб×36 |

Дата в формате `YYYY-MM-DD` или `DD.MM.YYYY` (скрипт конвертирует автоматически).

---

## Apps Script

Откройте таблицу → **Расширения → Apps Script** → вставьте код:

```javascript
const SMARTROUTE_API_URL = "https://ВАШ_ДОМЕН/api/v1/orders/batch";
const SMARTROUTE_API_KEY = "sr_live_XXXX-XXXX";   // ← замените
const SHEET_NAME = "Заявки";                        // ← имя листа

function sendOrdersToSmartRoute() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert("Лист '" + SHEET_NAME + "' не найден");
    return;
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h).toLowerCase().trim());

  const nameIdx    = headers.indexOf("магазин")   !== -1 ? headers.indexOf("магазин")   : 0;
  const addrIdx    = headers.indexOf("адрес")      !== -1 ? headers.indexOf("адрес")     : 1;
  const cityIdx    = headers.indexOf("город")      !== -1 ? headers.indexOf("город")     : 2;
  const dateIdx    = headers.indexOf("дата")       !== -1 ? headers.indexOf("дата")      : 3;
  const qtyIdx     = headers.indexOf("кол-во")     !== -1 ? headers.indexOf("кол-во")    : 4;
  const commentIdx = headers.indexOf("комментарий")!== -1 ? headers.indexOf("комментарий"): 5;

  const today = Utilities.formatDate(new Date(), "Europe/Moscow", "yyyy-MM-dd");
  const orders = [];

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const name = String(row[nameIdx] || "").trim();
    if (!name) continue; // пропустить пустые строки

    // Нормализуем дату
    let deliveryDate = String(row[dateIdx] || "").trim();
    if (!deliveryDate) {
      deliveryDate = today;
    } else if (deliveryDate.includes(".")) {
      // DD.MM.YYYY → YYYY-MM-DD
      const parts = deliveryDate.split(".");
      if (parts.length === 3) deliveryDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
    } else if (row[dateIdx] instanceof Date) {
      deliveryDate = Utilities.formatDate(row[dateIdx], "Europe/Moscow", "yyyy-MM-dd");
    }

    orders.push({
      store_name:    name,
      address:       String(row[addrIdx]    || "").trim(),
      city:          String(row[cityIdx]    || "").trim(),
      delivery_date: deliveryDate,
      quantity:      parseInt(row[qtyIdx])  || 1,
      products:      String(row[commentIdx] || "").trim(),
    });
  }

  if (orders.length === 0) {
    SpreadsheetApp.getUi().alert("Нет строк для отправки");
    return;
  }

  const payload = JSON.stringify({ orders: orders, delivery_date: today });

  const response = UrlFetchApp.fetch(SMARTROUTE_API_URL, {
    method: "POST",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + SMARTROUTE_API_KEY },
    payload: payload,
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  const body = JSON.parse(response.getContentText());

  if (code === 200 || code === 201) {
    const d = body.data || body;
    SpreadsheetApp.getUi().alert(
      `✅ Успешно!\nЗаявок: ${d.imported || orders.length}\nМагазинов найдено: ${d.matched || "—"}`
    );
  } else {
    SpreadsheetApp.getUi().alert(
      `❌ Ошибка ${code}\n${(body.error || body).message || JSON.stringify(body)}`
    );
  }
}

// Добавить кнопку в меню
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("SmartRoute")
    .addItem("📦 Отправить заявки", "sendOrdersToSmartRoute")
    .addToUi();
}
```

### Добавить триггер (автоматически каждый день)
1. Apps Script → Триггеры (будильник) → Добавить триггер
2. Функция: `sendOrdersToSmartRoute`
3. Событие: По времени → День (напр., 08:00)

---

## Пример ответа SmartRoute

```json
{
  "data": {
    "imported": 12,
    "matched": 10,
    "unmatched": 2,
    "delivery_date": "2026-07-01"
  },
  "request_id": "req_a1b2c3d4"
}
```

`unmatched` — магазины, которые не нашлись в базе SmartRoute. Их нужно добавить через интерфейс или импорт.

---

## Troubleshooting

| Ошибка | Причина | Решение |
|---|---|---|
| 401 UNAUTHORIZED | Неверный ключ | Проверьте `SMARTROUTE_API_KEY` |
| 403 FORBIDDEN | Недостаточно прав | Добавьте `orders:write` к ключу |
| 422 VALIDATION_ERROR | Неверный формат даты | Используйте `YYYY-MM-DD` |
| Пустой ответ | Нет строк данных | Проверьте, что строка 2+ содержит данные |
