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

  dbStore.settings = {
    fuel_price: fuelPrice,
    fuel_consumption: fuelConsumption,
    cost_per_km: costPerKm,
  };

  res.json(dbStore.settings);
});

export default router;
