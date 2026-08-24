import { Router } from "express";
import { dbStore } from "../store";
import {
  broadcastRouteToTelegram,
  getBotToken,
  getTelegramBotUsername,
  processTelegramUpdate,
  sendAssignmentToDriver,
} from "../lib/telegram";

const router = Router();

function getPublicBaseUrl(req: any): string {
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
  const proto = req.get("x-forwarded-proto") || (req.secure ? "https" : "http");
  return process.env.PUBLIC_APP_URL || `${proto}://${host}`;
}

// POST /api/telegram/webhook
router.post("/telegram/webhook", async (req, res) => {
  const baseUrl = getPublicBaseUrl(req);
  try {
    await processTelegramUpdate(req.body, baseUrl);
    res.json({ ok: true });
  } catch (err: any) {
    console.error("[Telegram Webhook Error]", err);
    res.json({ ok: false, error: err.message });
  }
});

// POST /api/telegram/route-sessions/:sessionId/send
router.post("/telegram/route-sessions/:sessionId/send", async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const baseUrl = getPublicBaseUrl(req);

  try {
    const result = await broadcastRouteToTelegram(sessionId, baseUrl);
    res.json(result);
  } catch (err: any) {
    console.error("[Telegram Broadcast Error]", err);
    res.status(500).json({ detail: err.message || "Ошибка при отправке в Telegram" });
  }
});

// POST /api/route/assignments/:id/send-telegram
router.post("/route/assignments/:id/send-telegram", async (req, res) => {
  const assignmentId = Number(req.params.id);
  const assignment = dbStore.assignments.find((a) => a.id === assignmentId);
  if (!assignment) {
    return res.status(404).json({ detail: "Рейс не найден" });
  }

  const session = dbStore.routeSessions.find((s) => s.id === assignment.session_id);
  if (!session) {
    return res.status(404).json({ detail: "Маршрутная сессия не найдена" });
  }

  const baseUrl = getPublicBaseUrl(req);
  const result = await sendAssignmentToDriver(assignment, session, baseUrl);
  if (!result.ok) {
    return res.status(400).json({ detail: result.error || "Не удалось отправить рейс" });
  }

  res.json({ ok: true, message_id: result.message_id });
});

// GET /api/telegram/status
router.get("/telegram/status", async (req, res) => {
  const token = getBotToken();
  const username = await getTelegramBotUsername();
  const connectedDrivers = dbStore.drivers.filter((d) => d.is_active && !!d.telegram_chat_id).length;
  const totalDrivers = dbStore.drivers.filter((d) => d.is_active).length;

  res.json({
    configured: !!token,
    bot_username: username,
    connected_drivers_count: connectedDrivers,
    total_drivers_count: totalDrivers,
  });
});

export default router;
