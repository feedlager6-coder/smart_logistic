import { Router } from "express";
import { dbStore } from "../store";

const router = Router();

// GET /api/settings
router.get("/settings", (req, res) => {
  res.json(dbStore.settings);
});

// PUT /api/settings
router.put("/settings", (req, res) => {
  const body = req.body || {};
  const fuelPrice = Number(body.fuel_price) || dbStore.settings.fuel_price;
  const fuelConsumption = Number(body.fuel_consumption) || dbStore.settings.fuel_consumption;
  const costPerKm = Math.round(((fuelPrice * fuelConsumption) / 100) * 100) / 100;
  const dispatcherTelegram = body.dispatcher_telegram_username !== undefined
    ? String(body.dispatcher_telegram_username).trim().replace(/^@/, "")
    : dbStore.settings.dispatcher_telegram_username || "";
  const dispatcherPhone = body.dispatcher_phone !== undefined
    ? String(body.dispatcher_phone).trim()
    : dbStore.settings.dispatcher_phone || "";

  dbStore.settings = {
    fuel_price: fuelPrice,
    fuel_consumption: fuelConsumption,
    cost_per_km: costPerKm,
    dispatcher_telegram_username: dispatcherTelegram,
    dispatcher_phone: dispatcherPhone,
  };

  res.json(dbStore.settings);
});

export default router;
