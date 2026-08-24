import { Router } from "express";
import crypto from "crypto";
import { dbStore, RouteAssignmentData, RouteSessionData, StoreData } from "../store";
import { solveVrp } from "../vrp";
import { ensureAssignmentExecutions, formatPublicUrl, sendAssignmentToDriver } from "../lib/telegram";

const router = Router();

function getPublicBaseUrl(req: any): string {
  const host = req.get("x-forwarded-host") || req.get("host") || "localhost:3000";
  const proto = req.get("x-forwarded-proto") || (req.secure ? "https" : "http");
  return process.env.PUBLIC_APP_URL || `${proto}://${host}`;
}

function formatAssignment(assignment: RouteAssignmentData, session: RouteSessionData, baseUrl: string) {
  const executions = ensureAssignmentExecutions(assignment, session);
  const totalPoints = executions.length;
  const completedPoints = executions.filter((e) => e.status !== "planned").length;
  const driverUrl = formatPublicUrl(`/driver/${assignment.access_token}`, baseUrl);
  
  const route = session.routes[assignment.route_index];
  const yandexUrl = route?.yandex_url || assignment.route_yandex_url || "";
  const whatsappText = `🚚 SmartRoute: рейс ${assignment.vehicle_name}\n📍 Точек: ${totalPoints}\n📱 Ссылка для водителя:\n${driverUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;

  return {
    id: assignment.id,
    session_id: assignment.session_id,
    route_index: assignment.route_index,
    driver_id: assignment.driver_id,
    driver_name: assignment.driver_name,
    driver_phone: assignment.driver_phone,
    vehicle_name: assignment.vehicle_name,
    route_yandex_url: yandexUrl,
    status: assignment.status,
    total_points: totalPoints,
    completed_points: completedPoints,
    driver_url: driverUrl,
    whatsapp_url: whatsappUrl,
    telegram_message_id: assignment.telegram_message_id,
    telegram_message_chat_id: assignment.telegram_message_chat_id,
    created_at: assignment.created_at,
    updated_at: assignment.updated_at,
    executions: executions.map((e) => ({
      id: e.id,
      assignment_id: e.assignment_id,
      visit_order: e.visit_order,
      store_name: e.store_name,
      store_phone: e.store_phone,
      store_client: e.store_client,
      address: e.address,
      lat: e.lat,
      lon: e.lon,
      products: e.products,
      quantity: e.quantity,
      actual_qty: e.actual_qty,
      amount_rub: e.amount_rub,
      actual_amount_rub: e.actual_amount_rub,
      arrive_by: e.arrive_by,
      status: e.status,
      payment_method: e.payment_method,
      payment_status: e.payment_status,
      driver_comment: e.driver_comment,
      yandex_url: e.yandex_url,
      is_remote_completion: e.is_remote_completion,
      completion_distance_meters: e.completion_distance_meters,
      rescheduled_date: e.rescheduled_date,
      remaining_order_date: e.remaining_order_date,
      delivered_at: e.delivered_at,
    })),
  };
}

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
    storesToOptimize = dbStore.stores;
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

  // Auto-generate assignments with active drivers
  session.routes.forEach((route, idx) => {
    const matchedDriver = dbStore.drivers.find(
      (d) => d.is_active && (
        d.vehicle_name.toLowerCase().includes(route.vehicle_name.toLowerCase()) ||
        route.vehicle_name.toLowerCase().includes(d.name.toLowerCase())
      )
    ) || dbStore.drivers[idx % Math.max(1, dbStore.drivers.length)];

    const rawToken = crypto.randomBytes(16).toString("hex");
    const assignment: RouteAssignmentData = {
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
  });

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
  dbStore.assignments = dbStore.assignments.filter((a) => a.session_id !== id);
  res.json({ ok: true, deleted_id: id });
});

// GET /api/route/active-session
router.get("/route/active-session", (req, res) => {
  const active = dbStore.routeSessions[0] || null;
  res.json(active);
});

// GET /api/route/sessions/:id/assignments
router.get("/route/sessions/:id/assignments", (req, res) => {
  const sessionId = Number(req.params.id);
  const session = dbStore.routeSessions.find((s) => s.id === sessionId);
  if (!session) {
    return res.json({ assignments: [] });
  }

  const baseUrl = getPublicBaseUrl(req);
  const list = dbStore.assignments
    .filter((a) => a.session_id === sessionId)
    .map((a) => formatAssignment(a, session, baseUrl));

  res.json({ assignments: list });
});

// POST /api/route/sessions/:id/assignments
router.post("/route/sessions/:id/assignments", (req, res) => {
  const sessionId = Number(req.params.id);
  const session = dbStore.routeSessions.find((s) => s.id === sessionId);
  if (!session) {
    return res.status(404).json({ detail: "Маршрутная сессия не найдена" });
  }

  const { route_index, driver_id, driver_name, vehicle_name } = req.body || {};
  const routeIdx = Number(route_index) || 0;
  const route = session.routes[routeIdx];

  let assignment = dbStore.assignments.find(
    (a) => a.session_id === sessionId && a.route_index === routeIdx
  );

  let matchedDriver = driver_id
    ? dbStore.drivers.find((d) => d.id === Number(driver_id))
    : undefined;

  if (!matchedDriver && driver_name) {
    matchedDriver = dbStore.drivers.find(
      (d) => d.is_active && d.name.toLowerCase() === String(driver_name).trim().toLowerCase()
    );
  }

  const dName = matchedDriver?.name || driver_name || route?.vehicle_name || "Водитель";
  const dPhone = matchedDriver?.phone || "";
  const vName = vehicle_name || route?.vehicle_name || "Автомобиль";

  if (!assignment) {
    const rawToken = crypto.randomBytes(16).toString("hex");
    assignment = {
      id: dbStore.assignmentNextId++,
      session_id: sessionId,
      route_index: routeIdx,
      driver_id: matchedDriver ? matchedDriver.id : null,
      driver_name: dName,
      driver_phone: dPhone,
      vehicle_name: vName,
      access_token: rawToken,
      route_yandex_url: route?.yandex_url || "",
      status: "planned",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    dbStore.assignments.push(assignment);
  } else {
    assignment.driver_id = matchedDriver ? matchedDriver.id : null;
    assignment.driver_name = dName;
    assignment.driver_phone = dPhone;
    if (vName) assignment.vehicle_name = vName;
    assignment.updated_at = new Date().toISOString();
  }

  ensureAssignmentExecutions(assignment, session);
  const baseUrl = getPublicBaseUrl(req);
  res.json(formatAssignment(assignment, session, baseUrl));
});

// POST /api/route/assignments/:id/share
router.post("/route/assignments/:id/share", (req, res) => {
  const id = Number(req.params.id);
  const assignment = dbStore.assignments.find((a) => a.id === id);
  if (!assignment) {
    return res.status(404).json({ detail: "Рейс не найден" });
  }

  const baseUrl = getPublicBaseUrl(req);
  const driverUrl = formatPublicUrl(`/driver/${assignment.access_token}`, baseUrl);
  const whatsappText = `🚚 SmartRoute: рейс ${assignment.vehicle_name}\n📱 Ссылка для водителя:\n${driverUrl}`;
  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappText)}`;

  res.json({ driver_url: driverUrl, whatsapp_url: whatsappUrl });
});

// POST /api/route/sessions/:id/assign-all
router.post("/route/sessions/:id/assign-all", (req, res) => {
  const sessionId = Number(req.params.id);
  const session = dbStore.routeSessions.find((s) => s.id === sessionId);
  if (!session) {
    return res.status(404).json({ detail: "Маршрутная сессия не найдена" });
  }

  const baseUrl = getPublicBaseUrl(req);
  session.routes.forEach((route, idx) => {
    let assignment = dbStore.assignments.find(
      (a) => a.session_id === sessionId && a.route_index === idx
    );
    const matchedDriver = dbStore.drivers[idx % Math.max(1, dbStore.drivers.length)];
    if (!assignment) {
      const rawToken = crypto.randomBytes(16).toString("hex");
      assignment = {
        id: dbStore.assignmentNextId++,
        session_id: sessionId,
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

  const list = dbStore.assignments
    .filter((a) => a.session_id === sessionId)
    .map((a) => formatAssignment(a, session, baseUrl));

  res.json({ assignments: list });
});

// POST /api/route/sessions/:id/complete
router.post("/route/sessions/:id/complete", async (req, res) => {
  const sessionId = Number(req.params.id);
  const session = dbStore.routeSessions.find((s) => s.id === sessionId);
  if (!session) {
    return res.status(404).json({ detail: "Маршрутная сессия не найдена" });
  }

  const baseUrl = getPublicBaseUrl(req);
  const assignments = dbStore.assignments.filter((a) => a.session_id === sessionId);
  
  for (const a of assignments) {
    a.status = "completed";
    a.updated_at = new Date().toISOString();
    try {
      await sendAssignmentToDriver(a, session, baseUrl);
    } catch {}
  }

  res.json({ ok: true, completed: assignments.length });
});

// POST /api/route/assignments/:id/executions/:executionId/rescheduled-order
router.post("/route/assignments/:id/executions/:executionId/rescheduled-order", (req, res) => {
  const assignmentId = Number(req.params.id);
  const executionId = Number(req.params.executionId);
  const { delivery_date } = req.body || {};

  const assignment = dbStore.assignments.find((a) => a.id === assignmentId);
  const execution = assignment?.executions?.find((e) => e.id === executionId);
  if (execution) {
    execution.rescheduled_date = delivery_date || new Date().toISOString().split("T")[0];
    execution.updated_at = new Date().toISOString();
  }

  res.json({ ok: true });
});

// POST /api/route/assignments/:id/executions/:executionId/remaining-order
router.post("/route/assignments/:id/executions/:executionId/remaining-order", (req, res) => {
  const assignmentId = Number(req.params.id);
  const executionId = Number(req.params.executionId);
  const { delivery_date } = req.body || {};

  const assignment = dbStore.assignments.find((a) => a.id === assignmentId);
  const execution = assignment?.executions?.find((e) => e.id === executionId);
  if (execution) {
    execution.remaining_order_date = delivery_date || new Date().toISOString().split("T")[0];
    execution.updated_at = new Date().toISOString();
  }

  res.json({ ok: true });
});

export default router;
