# SmartRoute — Roadmap

## ✅ Выполнено (19 Jun 2026 — Pre-Demo Audit)

- [x] Экспорт магазинов в Excel (`GET /api/stores/export`) — совместимо с форматом импорта
- [x] AlertDialog для удаления магазина (заменил `window.confirm`)
- [x] Кнопка «Построить заново» внизу страницы результата
- [x] Авто-сохранение автопарка в localStorage при каждом изменении
- [x] Login rate limiting: 5 попыток / 15 мин → 429 на 15 мин
- [x] Онбординг при 0 магазинов: трёхшаговый блок

## ✅ Выполнено (Jun 2026 — Мультипользовательская изоляция + Админка)

- [x] `owner_id` на таблицах stores, route_sessions, company_settings
- [x] Полная изоляция данных: каждый пользователь видит только свои магазины и маршруты
- [x] Поля `plan`, `admin_note`, `last_login_at` в таблице `users`
- [x] `GET/POST/PATCH/DELETE /api/admin/users` — управление пользователями
- [x] `GET /api/admin/audit-log` — журнал действий администратора
- [x] Self-protection: нельзя деактивировать/снять admin/удалить свой аккаунт
- [x] Last-admin protection: нельзя удалить/деактивировать последнего администратора
- [x] UsersPanel.tsx в /settings — UI администратора
- [x] Планы: trial / basic / pro / enterprise

## ✅ Выполнено (Jun 2026 — Авторизация)

- [x] JWT в HttpOnly cookie (HS256, TTL 24ч)
- [x] bcrypt-хеширование (прямой вызов, без passlib)
- [x] Auth middleware на все `/api/*` кроме `/healthz` и `/auth/login`
- [x] `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`
- [x] `seed_admin_user()` при старте — создаёт admin из `ADMIN_PASSWORD` env
- [x] Страница входа (`/login`) + AuthProvider + ProtectedRouter
- [x] Global 401-handler: QueryCache + MutationCache → auto-logout
- [x] SameSite=none + Secure=true (для iframe в Replit Canvas)

## ✅ Выполнено (Jun 2026 — ETA + Яндекс Навигатор)

- [x] OSRM ETA post-solve: параллельные leg-time запросы после solve_vrp
- [x] `drive_minutes` / `service_minutes` в ETA breakdown
- [x] Сегментация маршрутов Яндекс Навигатора (≤20 точек на сегмент)
- [x] `yandex_urls: list[str]` в ответе + amber-предупреждение в UI

## ✅ Выполнено (Jun 2026 — Балансировка VRP + OR-Tools)

- [x] `max_stops_per_vehicle` через `_rebalance_max_stops()`
- [x] `auto_cap`: `effective_max_stops = ceil(avg × 1.5)` без ручного лимита
- [x] Inter-route Or-opt relocate после TSP (−15–40% км)
- [x] Параллельные OSRM-запросы на матрицы кластеров (ThreadPoolExecutor)
- [x] Адаптивное число итераций Or-opt: ≤80 стор→5, ≤150→3, ≤300→2, >300→1

## ✅ Выполнено (May–Jun 2026 — Stable 1.0)

- [x] История маршрутов с удалением сессий
- [x] Аналитика: пробег, экономия, загрузка машин, топ-10 магазинов
- [x] Настройки компании: цена топлива, расход, live-расчёт стоимости km
- [x] Печать маршрутного листа (каждый водитель на отдельной странице)
- [x] Экспорт маршрута в Excel (base64 JSON)
- [x] Импорт магазинов из Excel (7 колонок)
- [x] Интерактивная карта 2ГИС/Leaflet с автозумом и цветной легендой
- [x] Отправка маршрута в WhatsApp
- [x] Деплой на Railway (один сервис: FastAPI + static frontend)
- [x] Геокодинг: Yandex API (primary) → Nominatim (fallback)
- [x] Матрица расстояний: OSRM (public) → GraphHopper → Haversine

## 🔜 Следующие шаги (Post-Demo)

- [ ] Кастомный домен + SSL (после первого клиента)
- [ ] Push-уведомления водителям при изменении маршрута
- [ ] Экспорт маршрута в PDF с логотипом компании
- [ ] Водительский URL — одноразовая ссылка без логина
- [ ] Тёмная тема
- [ ] Batch-геокодирование магазинов со статусом «not_found»
- [ ] Биллинг планов (Stripe или российский эквайринг)
