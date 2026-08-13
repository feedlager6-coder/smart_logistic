import { Router } from "express";
import { dbStore, StoreData } from "../store";

const router = Router();

// GET /api/stores
router.get("/stores", (req, res) => {
  res.json(dbStore.stores);
});

// GET /api/stores/:id
router.get("/stores/:id", (req, res) => {
  const id = Number(req.params.id);
  const store = dbStore.stores.find((s) => s.id === id);
  if (!store) {
    return res.status(404).json({ error: "Store not found" });
  }
  res.json(store);
});

// POST /api/stores
router.post("/stores", (req, res) => {
  const body = req.body || {};
  const newStore: StoreData = {
    id: dbStore.storeNextId++,
    name: body.name || "Новая точка",
    address: body.address || "",
    lat: typeof body.lat === "number" ? body.lat : 42.9849,
    lon: typeof body.lon === "number" ? body.lon : 47.5046,
    map_url: body.map_url || null,
    geocode_status: body.lat && body.lon ? "ok" : "pending",
    time_window_from: body.time_window_from || "08:00",
    time_window_to: body.time_window_to || "18:00",
    unload_minutes: Number(body.unload_minutes) || 15,
    city: body.city || "Махачкала",
    created_at: new Date().toISOString(),
  };

  dbStore.stores.push(newStore);

  // Automatically rematch orders with matching raw name
  const nameClean = newStore.name.toLowerCase().trim();
  for (const o of dbStore.dailyOrders) {
    if (!o.store_id && (o.raw_store_name || "").toLowerCase().trim() === nameClean) {
      o.store_id = newStore.id;
    }
  }

  res.status(201).json(newStore);
});

// PUT /api/stores/:id
router.put("/stores/:id", (req, res) => {
  const id = Number(req.params.id);
  const idx = dbStore.stores.findIndex((s) => s.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Store not found" });
  }

  const body = req.body || {};
  const updated: StoreData = {
    ...dbStore.stores[idx],
    name: body.name !== undefined ? body.name : dbStore.stores[idx].name,
    address: body.address !== undefined ? body.address : dbStore.stores[idx].address,
    lat: body.lat !== undefined ? body.lat : dbStore.stores[idx].lat,
    lon: body.lon !== undefined ? body.lon : dbStore.stores[idx].lon,
    map_url: body.map_url !== undefined ? body.map_url : dbStore.stores[idx].map_url,
    geocode_status: body.lat && body.lon ? "ok" : dbStore.stores[idx].geocode_status,
    time_window_from: body.time_window_from !== undefined ? body.time_window_from : dbStore.stores[idx].time_window_from,
    time_window_to: body.time_window_to !== undefined ? body.time_window_to : dbStore.stores[idx].time_window_to,
    unload_minutes: body.unload_minutes !== undefined ? Number(body.unload_minutes) : dbStore.stores[idx].unload_minutes,
  };

  dbStore.stores[idx] = updated;
  res.json(updated);
});

// DELETE /api/stores/:id
router.delete("/stores/:id", (req, res) => {
  const id = Number(req.params.id);
  dbStore.stores = dbStore.stores.filter((s) => s.id !== id);
  res.json({ ok: true, deleted_id: id });
});

// POST /api/stores/bulk-delete
router.post("/stores/bulk-delete", (req, res) => {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length > 0) {
    const idSet = new Set(ids);
    dbStore.stores = dbStore.stores.filter((s) => !idSet.has(s.id));
  }
  res.json({ ok: true, deleted_count: ids.length });
});

// POST /api/stores/geocode-pending
router.post("/stores/geocode-pending", (req, res) => {
  let count = 0;
  for (const s of dbStore.stores) {
    if (s.geocode_status === "pending") {
      s.geocode_status = "ok";
      if (!s.lat || !s.lon) {
        s.lat = 42.9849;
        s.lon = 47.5046;
      }
      count++;
    }
  }
  res.json({ geocoded_count: count, ok: true });
});

// POST /api/stores/bulk-create/start
router.post("/stores/bulk-create/start", (req, res) => {
  const body = req.body || {};
  const storesToCreate = Array.isArray(body.stores) ? body.stores : [];
  const jobId = `job-${Date.now()}`;

  const results: { name: string; status: "created" | "failed" | "skipped"; store_id?: number }[] = [];
  let createdCount = 0;

  for (const item of storesToCreate) {
    const name = item.name || "Новый магазин";
    const nameClean = name.toLowerCase().trim();

    let existing = dbStore.stores.find((s) => s.name.toLowerCase().trim() === nameClean);
    if (!existing) {
      existing = {
        id: dbStore.storeNextId++,
        name,
        address: item.address || "",
        lat: 42.9849,
        lon: 47.5046,
        map_url: item.yandex_url || null,
        geocode_status: "ok",
        time_window_from: item.time_window_from || "09:00",
        time_window_to: item.time_window_to || "18:00",
        unload_minutes: Number(item.unload_minutes) || 15,
        city: item.city || "Махачкала",
        created_at: new Date().toISOString(),
      };
      dbStore.stores.push(existing);
      createdCount++;
    }

    // Rematch daily orders with this store name
    for (const o of dbStore.dailyOrders) {
      if (!o.store_id && (o.raw_store_name || "").toLowerCase().trim() === nameClean) {
        o.store_id = existing.id;
      }
    }

    results.push({ name, status: "created", store_id: existing.id });
  }

  dbStore.bulkJobs.set(jobId, {
    id: jobId,
    total: storesToCreate.length,
    created: createdCount,
    failed: 0,
    done: true,
    result: results,
  });

  res.json({ job_id: jobId });
});

// GET /api/stores/bulk-create/progress/:jobId
// GET /api/stores/bulk-create/progress/:jobId or /api/stores/bulk-create/result/:jobId
const handleBulkJob = (req: any, res: any) => {
  const jobId = req.params.jobId;
  const job = dbStore.bulkJobs.get(jobId);
  if (!job) {
    return res.json({ total: 0, created: 0, failed: 0, done: true, result: [] });
  }
  res.json({
    total: job.total,
    created: job.created,
    failed: job.failed,
    done: job.done,
    result: job.result,
    records: job.result,
  });
};

router.get("/stores/bulk-create/progress/:jobId", handleBulkJob);
router.get("/stores/bulk-create/result/:jobId", handleBulkJob);
router.get("/stores/import/progress/:jobId", handleBulkJob);
router.get("/stores/import/result/:jobId", handleBulkJob);

// POST /api/stores/import
router.post("/stores/import", (req, res) => {
  res.json({
    imported_count: dbStore.stores.length,
    failed_count: 0,
    errors: [],
  });
});

// GET /api/stores/export
router.get("/stores/export", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", "attachment; filename=stores.json");
  res.send(JSON.stringify(dbStore.stores, null, 2));
});

// GET /api/stores/template
router.get("/stores/template", (req, res) => {
  res.json({ ok: true, message: "Template downloaded" });
});

export default router;
