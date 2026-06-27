# SmartRoute Public API v1 — Примеры интеграции

**Base URL**: `https://your-app.railway.app/api/v1`  
**Swagger UI**: `https://your-app.railway.app/api/v1/docs`  
**OpenAPI JSON**: `https://your-app.railway.app/api/v1/openapi.json`

---

## Аутентификация

Все запросы требуют заголовок:

```
Authorization: Bearer sr_v1_<ваш_ключ>
```

Получить ключ можно в разделе **Настройки → API ключи** (или у администратора SmartRoute).

### Scopes (области доступа)

| Scope | Что разрешает |
|---|---|
| `stores:read` | Просмотр магазинов |
| `stores:write` | Создание/обновление/удаление магазинов |
| `orders:read` | Просмотр заказов на дату |
| `orders:write` | Загрузка/удаление заказов |
| `routes:read` | Просмотр истории маршрутов |
| `routes:build` | Построение новых маршрутов |
| `analytics:read` | Просмотр аналитики |
| `settings:read` | Просмотр настроек |
| `settings:write` | Обновление настроек |
| `webhooks:receive` | Приём заказов через webhook |

---

## Формат ответа (envelope)

Все успешные ответы имеют структуру:

```json
{
  "data": { ... },
  "meta": { "total": 42, "page": 1, "pages": 5, "page_size": 10 },
  "request_id": "req_a3f7c291"
}
```

Ошибки:

```json
{
  "error": {
    "code": "STORE_NOT_FOUND",
    "message": "Store 999 not found"
  },
  "request_id": "req_b4e8d102"
}
```

### Rate limiting

Каждый ответ содержит заголовки:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1735000060
```

Лимит: **60 запросов в минуту** на ключ. При превышении — HTTP 429.

---

## Примеры: cURL

### Получить список магазинов

```bash
curl -H "Authorization: Bearer sr_v1_ваш_ключ" \
  "https://your-app.railway.app/api/v1/stores?page=1&page_size=20"
```

### Создать магазин

```bash
curl -X POST \
  -H "Authorization: Bearer sr_v1_ваш_ключ" \
  -H "Content-Type: application/json" \
  -d '{"name":"Магазин №5","city":"Махачкала","address":"ул. Ленина 10","lat":42.9849,"lon":47.5046}' \
  "https://your-app.railway.app/api/v1/stores"
```

### Пакетная загрузка магазинов (upsert)

```bash
curl -X POST \
  -H "Authorization: Bearer sr_v1_ваш_ключ" \
  -H "Content-Type: application/json" \
  -d '{
    "stores": [
      {"name":"Магазин А","city":"Махачкала","address":"пр. Акушинского 12","lat":42.98,"lon":47.50},
      {"name":"Магазин Б","city":"Махачкала","address":"ул. Гагарина 5","lat":42.97,"lon":47.51},
      {"name":"Магазин В","city":"Дербент","address":"ул. Советская 20"}
    ]
  }' \
  "https://your-app.railway.app/api/v1/stores/batch"
```

Ответ:

```json
{
  "data": {"created": 2, "updated": 1, "errors": 0, "ids": [101, 102, 87]},
  "meta": null,
  "request_id": "req_c5f1a830"
}
```

### Загрузить заказы на дату

```bash
curl -X POST \
  -H "Authorization: Bearer sr_v1_ваш_ключ" \
  -H "Content-Type: application/json" \
  -d '{
    "replace_date": true,
    "orders": [
      {"store_name":"Магазин А","delivery_date":"2026-06-28","weight_kg":120.5},
      {"store_name":"Магазин Б","delivery_date":"2026-06-28","weight_kg":85.0},
      {"store_name":"Магазин В","delivery_date":"2026-06-28","weight_kg":200.0}
    ]
  }' \
  "https://your-app.railway.app/api/v1/orders/batch"
```

### Построить маршрут

```bash
curl -X POST \
  -H "Authorization: Bearer sr_v1_ваш_ключ" \
  -H "Content-Type: application/json" \
  -d '{
    "store_ids": [101, 102, 87],
    "vehicles": [
      {"name":"Газель 001","capacity_kg":1000},
      {"name":"Газель 002","capacity_kg":1000}
    ],
    "depot_lat": 42.9849,
    "depot_lon": 47.5046,
    "use_unload_time": true,
    "unload_minutes": 15
  }' \
  "https://your-app.railway.app/api/v1/routes/build"
```

### Получить аналитику

```bash
# Сводка
curl -H "Authorization: Bearer sr_v1_ваш_ключ" \
  "https://your-app.railway.app/api/v1/analytics/summary"

# Ежедневная статистика за период
curl -H "Authorization: Bearer sr_v1_ваш_ключ" \
  "https://your-app.railway.app/api/v1/analytics/daily?date_from=2026-06-01&date_to=2026-06-30"
```

### Webhook: приём заказов из внешней системы

```bash
curl -X POST \
  -H "Authorization: Bearer sr_v1_ваш_ключ" \
  -H "Content-Type: application/json" \
  -d '{
    "replace_date": false,
    "orders": [
      {"store_name":"Магазин А","delivery_date":"2026-06-28","weight_kg":150.0}
    ]
  }' \
  "https://your-app.railway.app/api/v1/webhooks/ingest"
```

### Информация о текущем ключе

```bash
curl -H "Authorization: Bearer sr_v1_ваш_ключ" \
  "https://your-app.railway.app/api/v1/keys/me"
```

---

## Примеры: Python

```python
import requests

BASE_URL = "https://your-app.railway.app/api/v1"
API_KEY  = "sr_v1_ваш_ключ"

session = requests.Session()
session.headers.update({"Authorization": f"Bearer {API_KEY}"})


def get_stores(page=1, page_size=50, city=None):
    params = {"page": page, "page_size": page_size}
    if city:
        params["city"] = city
    r = session.get(f"{BASE_URL}/stores", params=params)
    r.raise_for_status()
    body = r.json()
    print(f"Магазинов: {body['meta']['total']}")
    return body["data"]


def batch_upsert_stores(stores: list[dict]):
    r = session.post(f"{BASE_URL}/stores/batch", json={"stores": stores})
    r.raise_for_status()
    result = r.json()["data"]
    print(f"Создано: {result['created']}, Обновлено: {result['updated']}, Ошибок: {result['errors']}")
    return result["ids"]


def upload_orders(orders: list[dict], replace_date=True):
    r = session.post(f"{BASE_URL}/orders/batch", json={
        "replace_date": replace_date,
        "orders": orders,
    })
    r.raise_for_status()
    return r.json()["data"]


def build_route(store_ids: list[int], vehicles: list[dict], depot_lat: float, depot_lon: float):
    r = session.post(f"{BASE_URL}/routes/build", json={
        "store_ids": store_ids,
        "vehicles": vehicles,
        "depot_lat": depot_lat,
        "depot_lon": depot_lon,
        "use_unload_time": True,
        "unload_minutes": 15,
    })
    r.raise_for_status()
    data = r.json()["data"]
    print(f"Маршрут построен: {data['total_km']:.1f} км, {len(data['routes'])} машин")
    return data


# Пример: полный рабочий день
if __name__ == "__main__":
    # 1. Загрузить магазины
    ids = batch_upsert_stores([
        {"name": "Магазин А", "city": "Махачкала", "address": "пр. Акушинского 12", "lat": 42.98, "lon": 47.50},
        {"name": "Магазин Б", "city": "Махачкала", "address": "ул. Гагарина 5",     "lat": 42.97, "lon": 47.51},
    ])

    # 2. Загрузить заказы на сегодня
    from datetime import date
    upload_orders([
        {"store_name": "Магазин А", "delivery_date": str(date.today()), "weight_kg": 120.5},
        {"store_name": "Магазин Б", "delivery_date": str(date.today()), "weight_kg": 85.0},
    ])

    # 3. Построить маршрут
    stores = get_stores(city="Махачкала")
    route = build_route(
        store_ids=[s["id"] for s in stores],
        vehicles=[
            {"name": "Газель 001", "capacity_kg": 1500},
            {"name": "Газель 002", "capacity_kg": 1500},
        ],
        depot_lat=42.9849,
        depot_lon=47.5046,
    )

    # 4. Распечатать ссылки Яндекс.Навигатора для водителей
    for r in route["routes"]:
        print(f"\n=== {r['vehicle_name']} ({r['total_km']:.1f} км) ===")
        for url in r.get("yandex_urls", [r.get("yandex_url", "")]):
            print(f"  Яндекс: {url}")
```

### Обработка ошибок в Python

```python
import requests

class SmartRouteAPIError(Exception):
    def __init__(self, code, message, request_id):
        self.code = code
        self.message = message
        self.request_id = request_id
        super().__init__(f"[{code}] {message} (req={request_id})")


def safe_request(session, method, url, **kwargs):
    try:
        r = session.request(method, url, **kwargs)
        body = r.json()
        if not r.ok:
            err = body.get("error", {})
            raise SmartRouteAPIError(
                err.get("code", "UNKNOWN"),
                err.get("message", str(r.status_code)),
                body.get("request_id", "-"),
            )
        # Логировать rate-limit
        remaining = r.headers.get("X-RateLimit-Remaining")
        if remaining and int(remaining) < 5:
            print(f"⚠ Осталось только {remaining} запросов до сброса лимита!")
        return body
    except requests.exceptions.ConnectionError as e:
        raise SmartRouteAPIError("CONNECTION_ERROR", str(e), "-")
```

---

## Примеры: 1С:Предприятие 8

### Подключение к API

```bsl
// Модуль: ОбщийМодуль.SmartRouteAPI

&НаСервере
Функция ПолучитьСессию()
    Сессия = Новый HTTPСоединение(
        "your-app.railway.app",  // хост
        443,                      // порт
        ,                         // пользователь
        ,                         // пароль
        ,                         // прокси
        30,                       // таймаут сек
        Новый ЗащищенноеСоединениеOpenSSL()
    );
    Возврат Сессия;
КонецФункции

&НаСервере
Функция ВыполнитьЗапрос(Метод, Путь, Тело = Неопределено)
    АПИКлюч = КонстантыПроизводства.SmartRouteAPIKey.Получить();
    
    Заголовки = Новый Соответствие();
    Заголовки["Authorization"] = "Bearer " + АПИКлюч;
    Заголовки["Content-Type"]  = "application/json";
    
    ЗапросHTTP = Новый HTTPЗапрос("/api/v1" + Путь, Заголовки);
    
    Если Тело <> Неопределено Тогда
        ЗапросHTTP.УстановитьТелоИзСтроки(Тело, "UTF-8");
    КонецЕсли;
    
    Сессия = ПолучитьСессию();
    
    Если Метод = "GET" Тогда
        Ответ = Сессия.Получить(ЗапросHTTP);
    ИначеЕсли Метод = "POST" Тогда
        Ответ = Сессия.Отправить(ЗапросHTTP);
    ИначеЕсли Метод = "DELETE" Тогда
        Ответ = Сессия.Удалить(ЗапросHTTP);
    КонецЕсли;
    
    ТелоОтвета = Ответ.ПолучитьТелоКакСтроку("UTF-8");
    ДанныеОтвета = ПрочитатьJSON(ТелоОтвета);
    
    Если Ответ.КодСостояния >= 400 Тогда
        Ошибка = ДанныеОтвета["error"];
        ВызватьИсключение "SmartRoute API: [" + Ошибка["code"] + "] " + Ошибка["message"];
    КонецЕсли;
    
    Возврат ДанныеОтвета["data"];
КонецФункции
```

### Загрузка магазинов из 1С

```bsl
// Выгрузить все торговые точки в SmartRoute одним пакетом

&НаСервере
Процедура ВыгрузитьМагазины()
    // Получаем торговые точки из 1С
    Запрос = Новый Запрос();
    Запрос.Текст = "ВЫБРАТЬ
    |   Партнеры.Наименование КАК Наименование,
    |   Партнеры.Город         КАК Город,
    |   Партнеры.Адрес         КАК Адрес,
    |   Партнеры.Телефон       КАК Телефон
    |ИЗ
    |   Справочник.Партнеры КАК Партнеры
    |ГДЕ
    |   Партнеры.ТипПартнера = ЗНАЧЕНИЕ(Перечисление.ТипыПартнеров.Клиент)
    |   И НЕ Партнеры.ПометкаУдаления";
    
    РезультатЗапроса = Запрос.Выполнить().Выбрать();
    
    МассивМагазинов = Новый Массив();
    Пока РезультатЗапроса.Следующий() Цикл
        МагазинJSON = Новый Соответствие();
        МагазинJSON["name"]    = РезультатЗапроса.Наименование;
        МагазинJSON["city"]    = РезультатЗапроса.Город;
        МагазинJSON["address"] = РезультатЗапроса.Адрес;
        МагазинJSON["phone"]   = РезультатЗапроса.Телефон;
        МассивМагазинов.Добавить(МагазинJSON);
    КонецЦикла;
    
    // Отправляем пакетом (upsert)
    ТелоЗапроса = Новый Соответствие();
    ТелоЗапроса["stores"] = МассивМагазинов;
    
    ТелоJSON = ЗаписатьJSON(ТелоЗапроса);
    Результат = ВыполнитьЗапрос("POST", "/stores/batch", ТелоJSON);
    
    Сообщить("SmartRoute: создано=" + Результат["created"]
             + ", обновлено=" + Результат["updated"]
             + ", ошибок=" + Результат["errors"]);
КонецПроцедуры
```

### Загрузка заказов из 1С на сегодня

```bsl
// Отправить заказы текущего дня в SmartRoute

&НаСервере
Процедура ВыгрузитьЗаказыНаСегодня()
    ДатаДоставки = Формат(ТекущаяДата(), "ДФ=yyyy-MM-dd");
    
    Запрос = Новый Запрос();
    Запрос.Текст = "ВЫБРАТЬ
    |   Заказы.Контрагент.Наименование КАК НаименованиеМагазина,
    |   ФОРМАТ(Заказы.ДатаДоставки, ""ДФ=yyyy-MM-dd"") КАК ДатаДоставки,
    |   СУММА(ЗаказыТовары.Количество * ЗаказыТовары.Вес) КАК ВесКг
    |ИЗ
    |   Документ.ЗаказКлиента КАК Заказы
    |   ЛЕВОЕ СОЕДИНЕНИЕ Документ.ЗаказКлиента.Товары КАК ЗаказыТовары
    |       ПО ЗаказыТовары.Ссылка = Заказы.Ссылка
    |ГДЕ
    |   Заказы.ДатаДоставки = &ДатаДоставки
    |   И Заказы.Проведен
    |СГРУППИРОВАТЬ ПО
    |   Заказы.Контрагент.Наименование,
    |   Заказы.ДатаДоставки";
    
    Запрос.УстановитьПараметр("ДатаДоставки", НачалоДня(ТекущаяДата()));
    РезультатЗапроса = Запрос.Выполнить().Выбрать();
    
    МассивЗаказов = Новый Массив();
    Пока РезультатЗапроса.Следующий() Цикл
        ЗаказJSON = Новый Соответствие();
        ЗаказJSON["store_name"]     = РезультатЗапроса.НаименованиеМагазина;
        ЗаказJSON["delivery_date"]  = РезультатЗапроса.ДатаДоставки;
        ЗаказJSON["weight_kg"]      = РезультатЗапроса.ВесКг;
        МассивЗаказов.Добавить(ЗаказJSON);
    КонецЦикла;
    
    Если МассивЗаказов.Количество() = 0 Тогда
        Сообщить("Нет заказов на сегодня");
        Возврат;
    КонецЕсли;
    
    ТелоЗапроса = Новый Соответствие();
    ТелоЗапроса["replace_date"] = Истина;  // заменить все заказы на эту дату
    ТелоЗапроса["orders"]       = МассивЗаказов;
    
    ТелоJSON = ЗаписатьJSON(ТелоЗапроса);
    Результат = ВыполнитьЗапрос("POST", "/orders/batch", ТелоJSON);
    
    Сообщить("SmartRoute: загружено заказов=" + Результат["created"]
             + ", дата=" + ДатаДоставки);
КонецПроцедуры
```

### Регламентное задание: автозагрузка утром

```bsl
// РегламентноеЗадание.SmartRouteУтренняяЗагрузка
// Расписание: каждый рабочий день в 07:00

&НаСервере
Процедура ВыполнитьОбработку()
    Попытка
        ВыгрузитьМагазины();      // актуализировать список торговых точек
        ВыгрузитьЗаказыНаСегодня();  // загрузить заказы текущего дня
        // Далее диспетчер открывает SmartRoute → нажимает "Построить маршрут"
    Исключение
        ЗаписьЖурналаРегистрации(
            "SmartRoute",
            УровеньЖурналаРегистрации.Ошибка,
            ,
            ,
            "Ошибка загрузки: " + ОписаниеОшибки()
        );
    КонецПопытки;
КонецПроцедуры
```

---

## Коды ошибок

| Код | HTTP | Описание |
|---|---|---|
| `UNAUTHORIZED` | 401 | Отсутствует или неверный Bearer token |
| `FORBIDDEN` | 403 | Scope не разрешён для этого ключа |
| `RATE_LIMITED` | 429 | Превышен лимит 60 запросов/мин |
| `STORE_NOT_FOUND` | 404 | Магазин с таким ID не найден |
| `ROUTE_NOT_FOUND` | 404 | Маршрут с таким ID не найден |
| `VALIDATION_ERROR` | 422 | Некорректные параметры запроса |
| `MISSING_DATE` | 400 | Параметр `date` обязателен |
| `COOKIE_AUTH` | 400 | Endpoint требует Bearer-авторизацию, не cookie |
| `INTERNAL_ERROR` | 500 | Внутренняя ошибка сервера |

---

## Changelog

| Версия | Дата | Изменения |
|---|---|---|
| v1.0 | 2026-06-27 | Первый публичный релиз: stores, orders, routes, analytics, settings, webhooks |
