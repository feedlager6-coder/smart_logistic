# SmartRoute — Документация для интеграторов

## Быстрый старт

1. **Получите API-ключ**: SmartRoute → Настройки → API-ключи → Создать ключ
2. **Выберите нужный метод интеграции** из таблицы ниже
3. **Протестируйте** через Postman Collection или Python/JS SDK

---

## Файлы

| Файл | Описание |
|---|---|
| [`SmartRoute.postman_collection.json`](SmartRoute.postman_collection.json) | Postman Collection — весь API в один клик |
| [`smartroute_client.py`](smartroute_client.py) | Python SDK — полный клиент для интеграций |
| [`smartroute-client.js`](smartroute-client.js) | JavaScript/Node.js SDK |
| [`public-api-examples.md`](public-api-examples.md) | curl-примеры для каждого endpoint |
| [`integration-google-sheets.md`](integration-google-sheets.md) | Google Sheets → SmartRoute через Apps Script |
| [`integration-moysklad.md`](integration-moysklad.md) | МойСклад → SmartRoute (Python sync + webhook адаптер) |
| [`integration-bitrix24.md`](integration-bitrix24.md) | Bitrix24 → SmartRoute (webhook + REST polling) |
| [`integration-1c.md`](integration-1c.md) | 1С:Предприятие → SmartRoute (BSL-код) |

---

## Выбор метода интеграции

| Система | Метод | Сложность |
|---|---|---|
| **Google Sheets** | Apps Script (встроен в Google Таблицы) | ⭐ Простой |
| **МойСклад** | Python скрипт + cron | ⭐ Простой |
| **Bitrix24** | REST API polling + cron | ⭐⭐ Средний |
| **1С:Предприятие** | HTTP-запрос из BSL | ⭐⭐ Средний |
| **Любая система** | Webhook (POST JSON) | ⭐ Простой |
| **Любая система** | REST API + Bearer auth | ⭐⭐ Средний |

---

## Webhook (универсальный метод)

Самый простой способ: любая система отправляет POST-запрос с заявками.

```bash
curl -X POST "https://ВАШ_ДОМЕН/api/v1/orders/batch" \
  -H "Authorization: Bearer sr_live_XXXX-XXXX" \
  -H "Content-Type: application/json" \
  -d '{
    "orders": [
      {
        "store_name": "Магазин Центральный",
        "address": "ул. Пушкина, 10",
        "delivery_date": "2026-07-01",
        "quantity": 48,
        "weight_kg": 120.5
      }
    ]
  }'
```

Ответ:
```json
{
  "data": { "imported": 1, "matched": 1, "unmatched": 0, "delivery_date": "2026-07-01" },
  "request_id": "req_a1b2c3"
}
```

Если `unmatched > 0`, магазин не найден в базе SmartRoute — добавьте его вручную или через `/api/v1/stores/batch`.

---

## Управление API-ключами

| Действие | Описание |
|---|---|
| Отозвать ключ | Деактивирует ключ, запись сохраняется (аудит-трейл) |
| Удалить ключ навсегда | `DELETE /api/auth/api-keys/{id}?permanent=true` — полное удаление из БД |
| Удалить все отозванные | `DELETE /api/auth/api-keys` — пакетная очистка |
| Обновить ключ (rotate) | `POST /api/auth/api-keys/{id}/rotate` — старый деактивируется, создаётся новый |

---

## OpenAPI / Swagger UI

- **OpenAPI JSON**: `/api/v1/openapi.json`
- **Swagger UI**: `/api/v1/docs`
- **ReDoc**: `/api/v1/redoc`

---

## Ошибки

Все ошибки возвращаются в едином формате:

```json
{
  "error": {
    "code": "STORE_NOT_FOUND",
    "message": "Магазин не найден",
    "details": null
  },
  "request_id": "req_a1b2c3"
}
```

| Статус | Код | Описание |
|---|---|---|
| 401 | `UNAUTHORIZED` | Отсутствует или недействителен API-ключ |
| 403 | `FORBIDDEN` | Недостаточно прав (scope) |
| 404 | `NOT_FOUND` | Ресурс не найден |
| 422 | `VALIDATION_ERROR` | Ошибка валидации данных |
| 429 | `RATE_LIMITED` | Превышен лимит запросов |

---

## Поддержка

- Документация: `/api/v1/docs`
- Примеры: [`public-api-examples.md`](public-api-examples.md)
