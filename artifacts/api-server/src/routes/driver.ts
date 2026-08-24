import { Router } from "express";
import { dbStore, RouteAssignmentData, RouteExecutionData } from "../store";
import { ensureAssignmentExecutions } from "../lib/telegram";

const router = Router();

// Find assignment in dbStore or fallback
function findAssignmentByToken(token: string): { assignment: RouteAssignmentData; executions: RouteExecutionData[] } {
  let assignment = dbStore.assignments.find((a) => a.access_token === token);
  
  if (!assignment) {
    // If not found, check if there is an active route session to attach
    const session = dbStore.routeSessions[0];
    if (session) {
      assignment = {
        id: dbStore.assignmentNextId++,
        session_id: session.id,
        route_index: 0,
        driver_id: dbStore.drivers[0]?.id || null,
        driver_name: dbStore.drivers[0]?.name || "Водитель",
        driver_phone: dbStore.drivers[0]?.phone || "",
        vehicle_name: session.routes[0]?.vehicle_name || "Газель 1",
        access_token: token,
        route_yandex_url: session.routes[0]?.yandex_url || "",
        status: "in_progress",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      dbStore.assignments.push(assignment);
      ensureAssignmentExecutions(assignment, session);
    }
  }

  if (assignment) {
    const session = dbStore.routeSessions.find((s) => s.id === assignment!.session_id) || dbStore.routeSessions[0];
    if (session) {
      ensureAssignmentExecutions(assignment, session);
    }
    return { assignment, executions: assignment.executions || [] };
  }

  // Standalone fallback
  const mockExecutions: RouteExecutionData[] = dbStore.stores.slice(0, 5).map((s, idx) => ({
    id: idx + 1,
    assignment_id: 1,
    store_id: s.id,
    visit_order: idx + 1,
    store_name: s.name,
    store_phone: "+7 (928) 000-00-00",
    store_client: "Менеджер",
    address: s.address,
    lat: s.lat,
    lon: s.lon,
    products: `Товар партия #${idx + 1}`,
    quantity: 10,
    actual_qty: 0,
    amount_rub: 1500,
    actual_amount_rub: 0,
    arrive_by: "12:00",
    status: "planned",
    payment_method: "cash",
    payment_status: "pending",
    driver_comment: "",
    yandex_url: `https://yandex.ru/maps/?rtext=~${s.lat},${s.lon}&rtt=auto`,
    updated_at: new Date().toISOString(),
  }));

  const mockAssignment: RouteAssignmentData = {
    id: 1,
    session_id: 1,
    route_index: 0,
    driver_id: 1,
    driver_name: "Ахмед",
    vehicle_name: "Газель 1 (А123АА)",
    access_token: token,
    route_yandex_url: "",
    status: "in_progress",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    executions: mockExecutions,
  };

  return { assignment: mockAssignment, executions: mockExecutions };
}

// GET /api/driver/:token
router.get("/driver/:token", (req, res) => {
  const token = req.params.token;
  const { assignment, executions } = findAssignmentByToken(token);

  const completed = executions.filter((e) => e.status !== "planned").length;
  const nextStop = executions.find((e) => e.status === "planned");

  res.json({
    assignment: {
      id: assignment.id,
      driver_name: assignment.driver_name,
      vehicle_name: assignment.vehicle_name,
      route_yandex_url: assignment.route_yandex_url,
      status: assignment.status,
      driver_shift_closed: assignment.status === "completed",
      total_points: executions.length,
      completed_points: completed,
      next_stop: nextStop ? { store_name: nextStop.store_name, address: nextStop.address } : null,
    },
    executions,
  });
});

// POST /api/driver/:token/location
router.post("/driver/:token/location", (req, res) => {
  res.json({ ok: true });
});

// PATCH /api/driver/:token/execution/:id
router.patch("/driver/:token/execution/:id", (req, res) => {
  const token = req.params.token;
  const id = Number(req.params.id);
  const { executions } = findAssignmentByToken(token);

  const exec = executions.find((e) => e.id === id);
  if (!exec) {
    return res.status(404).json({ error: "Execution not found" });
  }

  const body = req.body || {};
  if (body.status !== undefined) exec.status = body.status;
  if (body.actual_qty !== undefined) exec.actual_qty = Number(body.actual_qty);
  if (body.actual_amount_rub !== undefined) exec.actual_amount_rub = Number(body.actual_amount_rub);
  if (body.payment_method !== undefined) exec.payment_method = body.payment_method;
  if (body.payment_status !== undefined) exec.payment_status = body.payment_status;
  if (body.driver_comment !== undefined) exec.driver_comment = body.driver_comment;
  if (body.is_remote_completion !== undefined) exec.is_remote_completion = Boolean(body.is_remote_completion);
  if (body.completion_distance_meters !== undefined) exec.completion_distance_meters = Number(body.completion_distance_meters);
  exec.updated_at = new Date().toISOString();

  res.json({ ok: true, execution: exec });
});

// POST /api/driver/:token/close-shift
router.post("/driver/:token/close-shift", (req, res) => {
  const token = req.params.token;
  const { assignment } = findAssignmentByToken(token);
  assignment.status = "completed";
  assignment.updated_at = new Date().toISOString();
  res.json({ ok: true, driver_shift_closed: true });
});

export default router;
