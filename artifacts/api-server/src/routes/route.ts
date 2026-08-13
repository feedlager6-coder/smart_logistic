import { Router } from "express";
import { dbStore, RouteSessionData, StoreData } from "../store";
import { solveVrp } from "../vrp";

const router = Router();

// POST /api/route/build
router.post("/route/build", (req, res) => {
  const body = req.body || {};
  const depotLat = Number(body.depot_lat) || 42.9849;
  const depotLon = Number(body.depot_lon) || 47.5046;
  const depotAddress = body.depot_address || "Махачкала, Главный Склад";

  let storesToOptimize: StoreData[] = [];

  if (Array.isArray(body.store_ids) && body.store_ids.length > 0) {
    const ids = new Set(body.store_ids.map(Number));
    storesToOptimize = dbStore.stores.filter((s) => ids.has(s.id));
  } else if (Array.isArray(body.stores) && body.stores.length > 0) {
    storesToOptimize = body.stores;
  } else {
    storesToOptimize = dbStore.stores; // optimize all stores by default
  }

  const vehicles = Array.isArray(body.vehicles) && body.vehicles.length > 0
    ? body.vehicles
    : [
        { name: "Газель 1 (Ахмед)", capacity_kg: 1500 },
        { name: "Газель 2 (Магомед)", capacity_kg: 1500 },
        { name: "Ларгус (Руслан)", capacity_kg: 800 },
      ];

  const result = solveVrp({
    depotLat,
    depotLon,
    depotAddress,
    stores: storesToOptimize,
    vehicles,
    maxStopsPerVehicle: body.max_stops_per_vehicle || 25,
    useUnloadTime: body.use_unload_time !== false,
    settings: dbStore.settings,
  });

  const session: RouteSessionData = {
    id: dbStore.sessionNextId++,
    date: new Date().toISOString().split("T")[0],
    depot_lat: depotLat,
    depot_lon: depotLon,
    depot_address: depotAddress,
    num_points: storesToOptimize.length,
    total_km: result.totalKm,
    savings: result.savings,
    routes: result.routes,
    cost_per_km: dbStore.settings.cost_per_km,
    created_at: new Date().toISOString(),
  };

  dbStore.routeSessions.unshift(session);

  res.json({
    session_id: session.id,
    routes: result.routes,
    savings: result.savings,
    total_km: result.totalKm,
    matrix_source: "haversine_road",
    geocoder_used: "yandex",
  });
});

// GET /api/route/sessions
router.get("/route/sessions", (req, res) => {
  res.json({
    items: dbStore.routeSessions,
    total: dbStore.routeSessions.length,
    page: 1,
    size: 50,
  });
});

// GET /api/route/sessions/:id
router.get("/route/sessions/:id", (req, res) => {
  const id = Number(req.params.id);
  const session = dbStore.routeSessions.find((s) => s.id === id);
  if (!session) {
    return res.status(404).json({ error: "Route session not found" });
  }
  res.json(session);
});

// DELETE /api/route/sessions/:id
router.delete("/route/sessions/:id", (req, res) => {
  const id = Number(req.params.id);
  dbStore.routeSessions = dbStore.routeSessions.filter((s) => s.id !== id);
  res.json({ ok: true, deleted_id: id });
});

// GET /api/route/active-session
router.get("/route/active-session", (req, res) => {
  const active = dbStore.routeSessions[0] || null;
  res.json(active);
});

export default router;
