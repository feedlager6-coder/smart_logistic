import { Router } from "express";
import { dbStore, DriverData } from "../store";
import { generateDriverTelegramLink } from "../lib/telegram";

const router = Router();

// Helper to format driver for frontend
function formatDriver(driver: DriverData) {
  return {
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    vehicle_name: driver.vehicle_name,
    is_active: driver.is_active,
    telegram_connected: !!driver.telegram_chat_id,
    telegram_chat_id: driver.telegram_chat_id,
    telegram_username: driver.telegram_username,
    telegram_connected_at: driver.telegram_connected_at,
    created_at: driver.created_at,
  };
}

// GET /api/drivers
router.get("/drivers", (req, res) => {
  const activeOnly = req.query.all !== "true";
  const list = dbStore.drivers
    .filter((d) => (activeOnly ? d.is_active : true))
    .map(formatDriver);
  res.json({ drivers: list });
});

// POST /api/drivers
router.post("/drivers", (req, res) => {
  const { name, phone, vehicle_name } = req.body || {};
  if (!name || !String(name).trim() || !phone || !String(phone).trim()) {
    return res.status(400).json({ detail: "Имя и телефон водителя обязательны" });
  }

  const newDriver: DriverData = {
    id: dbStore.driverNextId++,
    name: String(name).trim(),
    phone: String(phone).trim(),
    vehicle_name: vehicle_name ? String(vehicle_name).trim() : "",
    is_active: true,
    telegram_chat_id: null,
    telegram_username: null,
    telegram_connected_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  dbStore.drivers.unshift(newDriver);
  res.status(201).json(formatDriver(newDriver));
});

// PATCH /api/drivers/:id
router.patch("/drivers/:id", (req, res) => {
  const id = Number(req.params.id);
  const driver = dbStore.drivers.find((d) => d.id === id);
  if (!driver) {
    return res.status(404).json({ detail: "Водитель не найден" });
  }

  const { name, phone, vehicle_name, is_active } = req.body || {};
  if (name !== undefined) driver.name = String(name).trim();
  if (phone !== undefined) driver.phone = String(phone).trim();
  if (vehicle_name !== undefined) driver.vehicle_name = String(vehicle_name).trim();
  if (is_active !== undefined) driver.is_active = Boolean(is_active);
  driver.updated_at = new Date().toISOString();

  res.json(formatDriver(driver));
});

// DELETE /api/drivers/:id
router.delete("/drivers/:id", (req, res) => {
  const id = Number(req.params.id);
  const index = dbStore.drivers.findIndex((d) => d.id === id);
  if (index === -1) {
    return res.status(404).json({ detail: "Водитель не найден" });
  }

  // Soft-delete or remove
  dbStore.drivers[index].is_active = false;
  dbStore.drivers[index].updated_at = new Date().toISOString();
  res.json({ ok: true, id });
});

// POST /api/drivers/:id/telegram-link
router.post("/drivers/:id/telegram-link", async (req, res) => {
  const id = Number(req.params.id);
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
  const proto = req.get("x-forwarded-proto") || "http";
  const baseUrl = process.env.PUBLIC_APP_URL || `${proto}://${host}`;

  try {
    const linkData = await generateDriverTelegramLink(id, baseUrl);
    res.json(linkData);
  } catch (err: any) {
    res.status(400).json({ detail: err.message || "Не удалось сгенерировать ссылку Telegram" });
  }
});

// POST /api/drivers/:id/disconnect-telegram
router.post("/drivers/:id/disconnect-telegram", (req, res) => {
  const id = Number(req.params.id);
  const driver = dbStore.drivers.find((d) => d.id === id);
  if (!driver) {
    return res.status(404).json({ detail: "Водитель не найден" });
  }

  driver.telegram_chat_id = null;
  driver.telegram_username = null;
  driver.telegram_connected_at = null;
  driver.updated_at = new Date().toISOString();

  res.json(formatDriver(driver));
});

export default router;
