import crypto from "crypto";
import { dbStore, DriverData, RouteAssignmentData, RouteExecutionData, RouteSessionData } from "../store";

export function getBotToken(): string {
  return (process.env.TELEGRAM_BOT_TOKEN || "").trim();
}

let cachedBotUsername: string = (process.env.TELEGRAM_BOT_USERNAME || "").trim().replace(/^@/, "");

export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  return String(phone).replace(/\D/g, "");
}

export function extract10Digits(phone: string | null | undefined): string {
  const digits = normalizePhone(phone);
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits;
}

export function findDriverByPhone(phone: string): DriverData | undefined {
  const norm10 = extract10Digits(phone);
  const rawDigits = normalizePhone(phone);
  if (!norm10 || norm10.length < 7) return undefined;
  return dbStore.drivers.find((d) => {
    if (!d.is_active) return false;
    const dNorm10 = extract10Digits(d.phone);
    const dRaw = normalizePhone(d.phone);
    if (dNorm10 === norm10) return true;
    if (dNorm10 && norm10 && (dNorm10.endsWith(norm10) || norm10.endsWith(dNorm10))) return true;
    if (dRaw && rawDigits && (dRaw === rawDigits || dRaw.endsWith(rawDigits) || rawDigits.endsWith(dRaw))) return true;
    return false;
  });
}

export function findDriverByChatId(chatId: number): DriverData | undefined {
  return dbStore.drivers.find(
    (d) => d.is_active && d.telegram_chat_id === chatId
  );
}

export async function telegramApi(method: string, payload: any): Promise<any> {
  const token = getBotToken();
  if (!token) {
    throw new Error("Telegram Bot API не настроен: укажите TELEGRAM_BOT_TOKEN в переменных окружения");
  }

  const url = `https://api.telegram.org/bot${token}/${method}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const data = (await response.json().catch(() => ({}))) as any;
  if (!response.ok || !data.ok) {
    const errorDesc = data.description || `HTTP ${response.status} ${response.statusText}`;
    console.warn(`[Telegram API Error] ${method}:`, errorDesc);
    throw new Error(`Telegram API: ${errorDesc}`);
  }
  return data;
}

export async function getTelegramBotUsername(): Promise<string> {
  if (cachedBotUsername) return cachedBotUsername;
  const token = getBotToken();
  if (!token) return "Smartroute_Drivers_bot";

  try {
    const res = await telegramApi("getMe", {});
    if (res?.result?.username) {
      cachedBotUsername = String(res.result.username).trim().replace(/^@/, "");
      return cachedBotUsername;
    }
  } catch (err) {
    console.warn("[Telegram] Failed to fetch bot username:", err);
  }
  return "Smartroute_Drivers_bot";
}

export async function generateDriverTelegramLink(driverId: number, baseUrl: string): Promise<{
  telegram_link: string;
  tg_direct_url: string;
  telegram_share_url: string;
  message: string;
  whatsapp_url: string;
  sms_url: string;
}> {
  const driver = dbStore.drivers.find((d) => d.id === driverId);
  if (!driver) {
    throw new Error("Водитель не найден");
  }

  const rawToken = crypto.randomBytes(16).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  
  driver.telegram_connect_token = rawToken;
  driver.telegram_connect_token_hash = tokenHash;
  // Keep token valid for 30 days so drivers can reconnect anytime
  driver.telegram_token_expires_at = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  driver.updated_at = new Date().toISOString();

  const botUsername = await getTelegramBotUsername();
  const link = `https://t.me/${botUsername}?start=${rawToken}`;
  const tgDirect = `tg://resolve?domain=${botUsername}&start=${rawToken}`;
  const shareText = `Здравствуйте, ${driver.name}! Нажмите «Запустить» (Start) в боте, чтобы получать путевые листы SmartRoute:`;
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`;
  const message = `Здравствуйте, ${driver.name}! Откройте ссылку и нажмите «Запустить» (Start), чтобы получать рейсы SmartRoute в Telegram:\n${link}`;
  
  const rawPhone = driver.phone.replace(/\D/g, "");
  return {
    telegram_link: link,
    tg_direct_url: tgDirect,
    telegram_share_url: shareUrl,
    message,
    whatsapp_url: `https://wa.me/${rawPhone}?text=${encodeURIComponent(message)}`,
    sms_url: `sms:${rawPhone}?body=${encodeURIComponent(message)}`,
  };
}

export function isValidHttpUrl(urlStr: string | null | undefined): boolean {
  if (!urlStr) return false;
  try {
    const parsed = new URL(urlStr);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") return false;
    return true;
  } catch {
    return false;
  }
}

export function formatPublicUrl(pathOrUrl: string, baseUrl: string): string {
  if (!pathOrUrl) return "";
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${cleanBase}${cleanPath}`;
}

export function ensureAssignmentExecutions(assignment: RouteAssignmentData, session: RouteSessionData): RouteExecutionData[] {
  if (assignment.executions && assignment.executions.length > 0) {
    return assignment.executions;
  }

  const route = session.routes[assignment.route_index];
  if (!route || !route.stores) {
    assignment.executions = [];
    return [];
  }

  const executions: RouteExecutionData[] = route.stores.map((stop, idx) => {
    const lat = stop.lat ?? 42.9849;
    const lon = stop.lon ?? 47.5046;
    const yandexUrl = `https://yandex.ru/maps/?rtext=~${lat},${lon}&rtt=auto`;
    const qty = stop.weight_kg || 10;
    return {
      id: dbStore.executionNextId++,
      assignment_id: assignment.id,
      store_id: stop.store_id || null,
      visit_order: stop.order || idx + 1,
      store_name: stop.store_name || `Точка #${idx + 1}`,
      store_phone: "+7 (928) 000-00-00",
      store_client: "Менеджер",
      address: stop.address || "Адрес доставки",
      lat,
      lon,
      products: `Товар (${qty} кг)`,
      quantity: qty,
      actual_qty: 0,
      amount_rub: qty * 150,
      actual_amount_rub: 0,
      arrive_by: stop.arrive_by || "12:00",
      status: "planned",
      payment_method: "cash",
      payment_status: "pending",
      driver_comment: "",
      yandex_url: yandexUrl,
      updated_at: new Date().toISOString(),
    };
  });

  assignment.executions = executions;
  return executions;
}

export function buildRouteCard(
  assignment: RouteAssignmentData,
  session: RouteSessionData,
  baseUrl: string
): { text: string; reply_markup?: any } {
  const executions = ensureAssignmentExecutions(assignment, session);
  const route = session.routes[assignment.route_index] || { total_km: 0, vehicle_name: assignment.vehicle_name };
  const totalPoints = executions.length;
  const completedPoints = executions.filter((e) => e.status !== "planned").length;
  const isCompleted = assignment.status === "completed" || (totalPoints > 0 && completedPoints === totalPoints);

  const driverUrl = formatPublicUrl(`/driver/${assignment.access_token}`, baseUrl);
  const dispatcherTg = (dbStore.settings.dispatcher_telegram_username || "").trim().replace(/^@/, "");
  const dispatcherPhone = dbStore.settings.dispatcher_phone || "";

  if (isCompleted) {
    const lines = [
      `🏁 Смена завершена: ${assignment.vehicle_name}`,
      `Водитель: ${assignment.driver_name}`,
      `📦 Доставлено: ${completedPoints} из ${totalPoints} точек`,
      `\nСпасибо за отличную работу! Хорошего отдыха! 🚚✨`,
    ];
    const keyboard: any[] = [];
    if (dispatcherTg) {
      keyboard.push([{ text: "☎️ Диспетчер", url: `https://t.me/${dispatcherTg}` }]);
    }
    return {
      text: lines.join("\n"),
      reply_markup: keyboard.length > 0 ? { inline_keyboard: keyboard } : undefined,
    };
  }

  const lines = [
    `🚚 Рейс на сегодня: ${assignment.vehicle_name}`,
    `👤 Водитель: ${assignment.driver_name}`,
    `📍 Количество точек: ${totalPoints} · Пробег: ~${Math.round(route.total_km || 0)} км`,
    "",
    `💡 Откройте интерактивный лист водителя — там отображаются адреса, товары, суммы и кнопки навигации к каждой точке.`,
  ];

  if (driverUrl) {
    lines.push(`\n📱 Ссылка на лист доставки:\n${driverUrl}`);
  }

  // Build inline keyboard
  const keyboard: any[] = [];
  const inlineDriverButtons: any[] = [];

  if (isValidHttpUrl(driverUrl)) {
    inlineDriverButtons.push({ text: "📦 Открыть лист доставки", url: driverUrl });
  } else {
    inlineDriverButtons.push({ text: "📦 Исполнение рейса", callback_data: `tg:execution:${assignment.id}` });
  }

  keyboard.push(inlineDriverButtons);

  // Yandex Maps overview
  if (route.yandex_url && isValidHttpUrl(route.yandex_url)) {
    keyboard.push([{ text: "🗺 Обзор маршрута (Яндекс)", url: route.yandex_url }]);
  }

  // Dispatcher button
  if (dispatcherTg) {
    keyboard.push([{ text: "☎️ Диспетчер", url: `https://t.me/${dispatcherTg}` }]);
  } else if (dispatcherPhone) {
    keyboard.push([{ text: `☎️ Диспетчер: ${dispatcherPhone}`, callback_data: `tg:dispatcher:${assignment.id}` }]);
  }

  return {
    text: lines.join("\n"),
    reply_markup: { inline_keyboard: keyboard },
  };
}

export async function sendAssignmentToDriver(
  assignment: RouteAssignmentData,
  session: RouteSessionData,
  baseUrl: string
): Promise<{ ok: boolean; message_id?: number; error?: string }> {
  if (!assignment.driver_id && !assignment.driver_phone) {
    return { ok: false, error: "Водитель не назначен" };
  }

  let driver = assignment.driver_id
    ? dbStore.drivers.find((d) => d.id === assignment.driver_id)
    : undefined;

  if (!driver && assignment.driver_phone) {
    driver = findDriverByPhone(assignment.driver_phone);
  }

  if (!driver || !driver.telegram_chat_id) {
    const driverName = driver?.name || assignment.driver_name || "Водитель";
    return {
      ok: false,
      error: `Водитель «${driverName}» (${assignment.vehicle_name}) ещё не подключился к Telegram. Передайте ему ссылку подключения из «Настройки → Водители» или попросите поделиться контактом.`,
    };
  }

  const card = buildRouteCard(assignment, session, baseUrl);
  const chatId = driver.telegram_chat_id;

  try {
    const res = await telegramApi("sendMessage", {
      chat_id: chatId,
      text: card.text,
      reply_markup: card.reply_markup,
    });
    const messageId = res?.result?.message_id;
    if (messageId) {
      assignment.telegram_message_id = messageId;
      assignment.telegram_message_chat_id = chatId;
    }
    return { ok: true, message_id: messageId };
  } catch (err: any) {
    // If inline buttons fail (e.g. url issue), retry with clean plain text
    try {
      const fallbackText = `${card.text}\n\n📱 Открыть рейс:\n${formatPublicUrl(`/driver/${assignment.access_token}`, baseUrl)}`;
      const res = await telegramApi("sendMessage", {
        chat_id: chatId,
        text: fallbackText,
      });
      return { ok: true, message_id: res?.result?.message_id };
    } catch (err2: any) {
      return { ok: false, error: err2?.message || String(err) };
    }
  }
}

export async function broadcastRouteToTelegram(
  sessionId: number,
  baseUrl: string
): Promise<{ sent: number; total: number; skipped: number; errors: string[] }> {
  const session = dbStore.routeSessions.find((s) => s.id === sessionId);
  if (!session) {
    return { sent: 0, total: 0, skipped: 0, errors: ["Маршрут не найден"] };
  }

  const token = getBotToken();
  if (!token) {
    return {
      sent: 0,
      total: session.routes.length,
      skipped: session.routes.length,
      errors: ["Telegram Bot API не настроен: укажите TELEGRAM_BOT_TOKEN в переменных окружения"],
    };
  }

  // Ensure assignments exist for each route
  session.routes.forEach((route, idx) => {
    let assignment = dbStore.assignments.find(
      (a) => a.session_id === session.id && a.route_index === idx
    );
    if (!assignment) {
      // Try to auto-match with active drivers by vehicle or index
      const matchedDriver = dbStore.drivers.find(
        (d) => d.is_active && (
          d.vehicle_name.toLowerCase().includes(route.vehicle_name.toLowerCase()) ||
          route.vehicle_name.toLowerCase().includes(d.name.toLowerCase())
        )
      ) || dbStore.drivers[idx % Math.max(1, dbStore.drivers.length)];

      const rawToken = crypto.randomBytes(16).toString("hex");
      assignment = {
        id: dbStore.assignmentNextId++,
        session_id: session.id,
        route_index: idx,
        driver_id: matchedDriver ? matchedDriver.id : null,
        driver_name: matchedDriver ? matchedDriver.name : route.vehicle_name,
        driver_phone: matchedDriver ? matchedDriver.phone : "",
        vehicle_name: route.vehicle_name,
        access_token: rawToken,
        route_yandex_url: route.yandex_url || "",
        status: "planned",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      dbStore.assignments.push(assignment);
      ensureAssignmentExecutions(assignment, session);
    }
  });

  const assignments = dbStore.assignments.filter((a) => a.session_id === session.id);
  const total = assignments.length;
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const assignment of assignments) {
    const result = await sendAssignmentToDriver(assignment, session, baseUrl);
    if (result.ok) {
      sent++;
    } else {
      skipped++;
      if (result.error) errors.push(result.error);
    }
  }

  return { sent, total, skipped, errors };
}

export async function processTelegramUpdate(payload: any, baseUrl: string = ""): Promise<{ ok: boolean }> {
  if (!payload) return { ok: true };

  // Handle inline callback queries
  if (payload.callback_query) {
    const cb = payload.callback_query;
    const chatId = cb.message?.chat?.id;
    const cbData = String(cb.data || "");
    
    try {
      await telegramApi("answerCallbackQuery", { callback_query_id: cb.id });
    } catch {}

    if (chatId && cbData.startsWith("tg:execution:")) {
      const assignmentId = Number(cbData.split(":")[2]);
      const assignment = dbStore.assignments.find((a) => a.id === assignmentId);
      if (assignment) {
        const link = formatPublicUrl(`/driver/${assignment.access_token}`, baseUrl);
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: `📱 Ваш интерактивный лист доставки:\n${link}`,
        });
      }
    } else if (chatId && cbData.startsWith("tg:dispatcher:")) {
      const phone = dbStore.settings.dispatcher_phone || "не указан";
      const tg = dbStore.settings.dispatcher_telegram_username || "";
      let msg = `☎️ Контакт диспетчера:\nТелефон: ${phone}`;
      if (tg) msg += `\nTelegram: @${tg.replace(/^@/, "")}`;
      await telegramApi("sendMessage", { chat_id: chatId, text: msg });
    }
    return { ok: true };
  }

  const message = payload.message || payload.edited_message;
  if (!message || !message.chat?.id) return { ok: true };

  const chatId = Number(message.chat.id);
  const username = (message.chat.username || message.from?.username || "").trim().replace(/^@/, "");
  const text = String(message.text || "").trim();
  const contact = message.contact;

  // 1. Check if user sent a /start command with a token
  if (text.startsWith("/start")) {
    const rawToken = text.replace(/^\/start(?:@\w+)?\s*/i, "").trim();
    const cleanToken = decodeURIComponent(rawToken);

    if (cleanToken) {
      const tokenHash = crypto.createHash("sha256").update(cleanToken).digest("hex");
      const driver = dbStore.drivers.find(
        (d) =>
          d.is_active &&
          (d.telegram_connect_token === cleanToken ||
            d.telegram_connect_token === rawToken ||
            d.telegram_connect_token_hash === tokenHash ||
            d.telegram_connect_token_hash === cleanToken ||
            d.telegram_chat_id === chatId)
      );

      if (driver) {
        driver.telegram_chat_id = chatId;
        driver.telegram_username = username || driver.telegram_username || null;
        driver.telegram_connected_at = new Date().toISOString();
        driver.updated_at = new Date().toISOString();
        dbStore.save();

        const welcome = `👋 Здравствуйте, ${driver.name}!\n\n🟢 Вы успешно подключены к SmartRoute как водитель!\n\nСюда будут поступать ваши рейсы, путевые листы и точки доставки.`;
        try {
          await telegramApi("sendMessage", {
            chat_id: chatId,
            text: welcome,
            reply_markup: {
              keyboard: [[{ text: "🚚 Мой рейс" }]],
              resize_keyboard: true,
            },
          });
        } catch (msgErr) {
          console.warn("[Telegram] Error sending welcome msg:", msgErr);
        }

        // Check if there is an active assignment for this driver right now
        const activeAssignment = dbStore.assignments
          .filter((a) => a.driver_id === driver.id && a.status !== "completed")
          .sort((a, b) => b.id - a.id)[0];

        if (activeAssignment) {
          const session = dbStore.routeSessions.find((s) => s.id === activeAssignment.session_id);
          if (session) {
            try {
              await sendAssignmentToDriver(activeAssignment, session, baseUrl);
            } catch (assignErr) {
              console.warn("[Telegram] Error sending initial assignment:", assignErr);
            }
          }
        }
        return { ok: true };
      } else {
        // Token not found / expired
        const msg = `⚠️ Ссылка подключения не найдена или срок её действия истёк.\n\nВы можете быстро подключиться по номеру телефона — нажмите кнопку «📱 Поделиться контактом» ниже, отправьте номер сообщением (например, +7 928 000-00-00), либо запросите у диспетчера новую ссылку.`;
        await telegramApi("sendMessage", {
          chat_id: chatId,
          text: msg,
          reply_markup: {
            keyboard: [[{ text: "📱 Поделиться контактом", request_contact: true }]],
            resize_keyboard: true,
            one_time_keyboard: true,
          },
        });
        return { ok: true };
      }
    }

    // /start without token
    let driver = findDriverByChatId(chatId);
    if (!driver && username) {
      driver = dbStore.drivers.find((d) => d.is_active && d.telegram_username && d.telegram_username.toLowerCase() === username.toLowerCase());
      if (driver) {
        driver.telegram_chat_id = chatId;
        driver.telegram_connected_at = new Date().toISOString();
        driver.updated_at = new Date().toISOString();
        dbStore.save();
      }
    }

    if (driver) {
      const msg = `👋 С возвращением в SmartRoute, ${driver.name}!\n\n🟢 Вы подключены к системе как водитель (${driver.phone}).\n\nИспользуйте кнопку «🚚 Мой рейс» или команду /route, чтобы посмотреть текущий путевой лист.`;
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: msg,
        reply_markup: {
          keyboard: [[{ text: "🚚 Мой рейс" }]],
          resize_keyboard: true,
        },
      });
      return { ok: true };
    }

    // Not registered yet
    const promptMsg = `👋 Добро пожаловать в SmartRoute!\n\nДля подключения выберите удобный способ:\n1️⃣ Нажмите кнопку «📱 Поделиться контактом» внизу.\n2️⃣ Или отправьте ваш номер телефона сообщением (например, +7 928 000-00-00).\n3️⃣ Либо перейдите по персональной ссылке от диспетчера из раздела «Настройки → Водители».`;
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: promptMsg,
      reply_markup: {
        keyboard: [[{ text: "📱 Поделиться контактом", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
    return { ok: true };
  }

  // 2. Handle Contact sharing
  if (contact && contact.phone_number) {
    const driver = findDriverByPhone(contact.phone_number);
    if (driver) {
      driver.telegram_chat_id = chatId;
      driver.telegram_username = username || driver.telegram_username || null;
      driver.telegram_connected_at = new Date().toISOString();
      driver.updated_at = new Date().toISOString();
      dbStore.save();

      const welcome = `👋 Добро пожаловать в SmartRoute, ${driver.name}!\n\n🟢 Вы успешно подключены по номеру телефона (${driver.phone})!\nСюда будут приходить ваши рейсы и путевые листы.`;
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: welcome,
        reply_markup: { remove_keyboard: true },
      });

      const activeAssignment = dbStore.assignments
        .filter((a) => a.driver_id === driver.id && a.status !== "completed")
        .sort((a, b) => b.id - a.id)[0];

      if (activeAssignment) {
        const session = dbStore.routeSessions.find((s) => s.id === activeAssignment.session_id);
        if (session) {
          await sendAssignmentToDriver(activeAssignment, session, baseUrl);
        }
      }
    } else {
      const formattedNum = contact.phone_number;
      const msg = `⚠️ Водитель с номером ${formattedNum} не найден в базе SmartRoute.\n\nПожалуйста, убедитесь, что диспетчер указал этот номер в разделе «Настройки → Водители», или перейдите по персональной ссылке от диспетчера.`;
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: msg,
        reply_markup: {
          keyboard: [[{ text: "📱 Поделиться контактом", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
    }
    return { ok: true };
  }

  // 3. Handle phone number entered as plain text (e.g. "+7 928 123 45 67" or "89281234567")
  const cleanedDigits = text.replace(/\D/g, "");
  if (cleanedDigits.length >= 7 && !text.startsWith("/")) {
    const driver = findDriverByPhone(cleanedDigits);
    if (driver) {
      driver.telegram_chat_id = chatId;
      driver.telegram_username = username || driver.telegram_username || null;
      driver.telegram_connected_at = new Date().toISOString();
      driver.updated_at = new Date().toISOString();
      dbStore.save();

      const welcome = `👋 Добро пожаловать в SmartRoute, ${driver.name}!\n\n🟢 Вы успешно подключены по номеру телефона (${driver.phone})!\nСюда будут приходить ваши рейсы и путевые листы.`;
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: welcome,
        reply_markup: { remove_keyboard: true },
      });

      const activeAssignment = dbStore.assignments
        .filter((a) => a.driver_id === driver.id && a.status !== "completed")
        .sort((a, b) => b.id - a.id)[0];

      if (activeAssignment) {
        const session = dbStore.routeSessions.find((s) => s.id === activeAssignment.session_id);
        if (session) {
          await sendAssignmentToDriver(activeAssignment, session, baseUrl);
        }
      }
      return { ok: true };
    } else if (cleanedDigits.length >= 10) {
      const msg = `⚠️ Водитель с номером ${text} не найден в базе SmartRoute.\n\nУбедитесь, что диспетчер внёс вас в список водителей («Настройки → Водители»), либо нажмите кнопку ниже.`;
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: msg,
        reply_markup: {
          keyboard: [[{ text: "📱 Поделиться контактом", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      return { ok: true };
    }
  }

  // 4. Handle /route or /myroute or button '🚚 Мой рейс'
  if (text === "/route" || text === "/myroute" || text === "🚚 Мой рейс" || text.toLowerCase().includes("мой рейс")) {
    const driver = findDriverByChatId(chatId);
    if (!driver) {
      await telegramApi("sendMessage", {
        chat_id: chatId,
        text: "Для просмотра рейсов сначала подключитесь к системе — отправьте контакт по кнопке ниже.",
        reply_markup: {
          keyboard: [[{ text: "📱 Поделиться контактом", request_contact: true }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      return { ok: true };
    }

    const activeAssignment = dbStore.assignments
      .filter((a) => a.driver_id === driver.id)
      .sort((a, b) => b.id - a.id)[0];

    if (activeAssignment) {
      const session = dbStore.routeSessions.find((s) => s.id === activeAssignment.session_id);
      if (session) {
        await sendAssignmentToDriver(activeAssignment, session, baseUrl);
        return { ok: true };
      }
    }

    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: `ℹ️ Для водителя ${driver.name} активных рейсов на сегодня пока нет.`,
    });
    return { ok: true };
  }

  // 5. Default reply for general messages
  const driver = findDriverByChatId(chatId);
  if (driver) {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: `Здравствуйте, ${driver.name}! Чтобы посмотреть текущий рейс, используйте команду /route.`,
    });
  } else {
    await telegramApi("sendMessage", {
      chat_id: chatId,
      text: `👋 Для подключения к SmartRoute нажмите «📱 Поделиться контактом» или отправьте номер телефона.`,
      reply_markup: {
        keyboard: [[{ text: "📱 Поделиться контактом", request_contact: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }

  return { ok: true };
}

// Background long polling manager
let isPollingRunning = false;
let lastUpdateId = 0;

export function startTelegramPolling(baseUrl: string = ""): void {
  const token = getBotToken();
  if (!token || isPollingRunning) return;

  isPollingRunning = true;
  console.log("[Telegram] Starting background polling service...");

  // Remove active webhook if any so getUpdates can receive updates
  telegramApi("deleteWebhook", { drop_pending_updates: false }).catch(() => {});

  async function pollLoop() {
    while (isPollingRunning) {
      try {
        const tokenNow = getBotToken();
        if (!tokenNow) {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }

        const res = await telegramApi("getUpdates", {
          offset: lastUpdateId + 1,
          timeout: 20,
          allowed_updates: ["message", "edited_message", "callback_query"],
        });

        if (res?.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            lastUpdateId = Math.max(lastUpdateId, Number(update.update_id));
            try {
              await processTelegramUpdate(update, baseUrl);
            } catch (updateErr) {
              console.error("[Telegram] Error processing update:", updateErr);
            }
          }
        }
      } catch (err: any) {
        // Wait before retrying on network error
        await new Promise((r) => setTimeout(r, 4000));
      }
    }
  }

  pollLoop().catch((err) => {
    console.error("[Telegram] Fatal polling error:", err);
    isPollingRunning = false;
  });
}
