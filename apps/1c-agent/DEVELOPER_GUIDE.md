# SmartRoute 1C Agent — руководство разработчика

## Архитектура

Рабочий backend проекта — `artifacts/api-server/main.py` (FastAPI, порт 8080).
Веб-клиент работает через Vite на порту 5000 и обращается к API только по относительным
путям `/api/...`. Нативный Windows-агент использует WinHTTP, а CLI-клиент —
`urllib.request`.

После привязки сервер хранит только хэш токена агента. Сам токен возвращается
единственный раз в ответе `POST /api/integrations/1c/agent/pair` и сохраняется
локально агентом.

## Контракт API

| Метод и путь | Авторизация | Назначение |
|---|---|---|
| `POST /api/integrations/1c/agent/code` | cookie/JWT | Создать одноразовый код на 24 часа |
| `GET /api/integrations/1c/agent/code/active` | cookie/JWT | Получить активный код текущей организации |
| `POST /api/integrations/1c/agent/pair` | публичный | Обменять код на токен агента |
| `GET /api/integrations/1c/agent/agents` | cookie/JWT | Список агентов текущей организации |
| `POST /api/integrations/1c/agent/heartbeat` | `Bearer sr_agent_...` | Обновить состояние и heartbeat |
| `POST /api/integrations/1c/agent/sync-log` | `Bearer sr_agent_...` | Записать результат синхронизации |
| `DELETE /api/integrations/1c/agent/{id}` | cookie/JWT | Отвязать агента |
| `GET /api/integrations/1c/agent/logs` | cookie/JWT | Журнал обменов текущей организации |
| `GET /api/integrations/1c/agent/setup.exe` | cookie/JWT | Скачать Windows-установщик |
| `GET /api/integrations/1c/agent/download` | cookie/JWT | Скачать ZIP-пакет агента |
| `POST /api/v1/orders/batch` | `Bearer sr_agent_...` | Передать заказы из 1С |
| `GET /api/v1/orders` | `Bearer sr_agent_...` | Получить заявки для обратной синхронизации |

Агентские bearer-токены имеют отдельный префикс `sr_agent_` и не принимаются
как обычные API-ключи. Владелец агента определяется сервером по хэшу токена,
поэтому агент не может читать или изменять данные другой организации.

## Локальное тестирование

```text
python3 -m py_compile artifacts/api-server/main.py
python3 -m py_compile apps/1c-agent/smartroute_client.py apps/1c-agent/sync_engine.py
```

Для smoke-проверки без сессии ожидаемым результатом является `404` на pairing с
неизвестным кодом, а не создание нового агента. Реальный сценарий требует
сначала войти в веб-кабинет и создать код.

## Сборка Windows-артефактов

Сборка выполняется на Windows-машине с Visual Studio Build Tools и NSIS:

1. Откройте **x64 Native Tools Command Prompt for VS**.
2. Соберите GUI из каталога `apps/1c-agent` согласно используемому проекту
   Visual Studio/MinGW, чтобы получить `SmartRoute_Agent.exe`.
3. Установите NSIS 3.x и запустите:

```bat
makensis installer.nsi
```

`installer.nsi` упаковывает `SmartRoute_Agent.exe`, `config.json`, инструкцию и
иконку; Python на чистом компьютере Windows не требуется. Проверяйте размер,
дату и цифровую подпись EXE после каждой сборки. Текущий репозиторий содержит
готовые portable/setup EXE, но Linux workflow не может воспроизвести native
Windows-компиляцию или подписать бинарники.

## TLS и секреты

Для HTTPS WinHTTP и встроенный `curl.exe` используют системное хранилище
сертификатов без флагов `-k`/`SECURITY_FLAG_IGNORE_*`. Python-клиент использует
`ssl.create_default_context()` с проверкой hostname. Если корпоративный proxy
перехватывает TLS, его корневой сертификат нужно установить в доверенное
хранилище Windows, а не отключать проверку в коде.