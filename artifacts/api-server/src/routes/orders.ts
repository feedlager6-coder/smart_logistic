import { Router } from "express";
import { dbStore, DailyOrderData, ImportHistoryRecord } from "../store";

const router = Router();

// GET /api/orders/template
router.get("/orders/template", (req, res) => {
  res.json({ ok: true, message: "Template downloaded" });
});

// POST /api/orders/preview
router.post("/orders/preview", (req, res) => {
  res.json({
    total_rows: 15,
    matched_rows: 12,
    unmatched_rows: 3,
    preview_rows: [
      {
        raw_store_name: "Гастроном №1",
        matched_store_id: 1,
        address: "Махачкала, ул. Ирчи Казака, 35",
        weight_kg: 120,
        volume_m3: 1.2,
        amount_rub: 15000,
        status: "matched",
      },
      {
        raw_store_name: "Зеленое Яблоко (Шамиля)",
        matched_store_id: 2,
        address: "Махачкала, пр. Имама Шамиля, 42",
        weight_kg: 250,
        volume_m3: 2.5,
        amount_rub: 32000,
        status: "matched",
      },
    ],
  });
});

// GET /api/orders/active-dates
router.get("/orders/active-dates", (req, res) => {
  const datesSet = new Set<string>();
  for (const o of dbStore.dailyOrders) {
    if (o.delivery_date) datesSet.add(o.delivery_date);
  }
  res.json({ dates: Array.from(datesSet) });
});

// POST /api/orders/import
router.post("/orders/import", (req, res) => {
  const body = req.body || {};
  const deliveryDate = body.delivery_date || new Date().toISOString().split("T")[0];

  const newOrders: DailyOrderData[] = dbStore.stores.map((s, idx) => ({
    id: dbStore.orderNextId++,
    delivery_date: deliveryDate,
    store_id: s.id,
    raw_store_name: s.name,
    address: s.address,
    weight_kg: 0,
    volume_m3: 0,
    amount_rub: 0,
    quantity: 0,
    time_from: s.time_window_from,
    time_to: s.time_window_to,
    unload_minutes: s.unload_minutes,
    city: s.city,
    created_at: new Date().toISOString(),
  }));

  dbStore.dailyOrders.push(...newOrders);

  const importRec: ImportHistoryRecord = {
    id: dbStore.importNextId++,
    delivery_date: deliveryDate,
    filename: body.filename || "Заявки_импорт.xlsx",
    total_orders: newOrders.length,
    matched_orders: newOrders.length,
    unmatched_orders: 0,
    created_at: new Date().toISOString(),
    orders: newOrders,
  };
  dbStore.importHistory.unshift(importRec);

  res.json({
    imported_count: newOrders.length,
    delivery_date: deliveryDate,
    orders: newOrders,
  });
});

// POST /api/orders/manual/bulk
router.post("/orders/manual/bulk", (req, res) => {
  const body = req.body || {};
  const storeIds: number[] = Array.isArray(body.store_ids) ? body.store_ids : [];
  const deliveryDate: string = body.delivery_date || new Date().toISOString().split("T")[0];

  const created: { id: number; store_id: number; store_name_raw: string }[] = [];
  const skipped: { store_id?: number; reason: string }[] = [];

  const storeMap = new Map(dbStore.stores.map((s) => [s.id, s]));

  for (const storeId of storeIds) {
    const store = storeMap.get(storeId);
    if (!store) {
      skipped.push({ store_id: storeId, reason: "not_found" });
      continue;
    }

    const exists = dbStore.dailyOrders.some(
      (o) => o.delivery_date === deliveryDate && o.store_id === storeId
    );
    if (exists) {
      skipped.push({ store_id: storeId, reason: "duplicate" });
      continue;
    }

    const newOrder: DailyOrderData = {
      id: dbStore.orderNextId++,
      delivery_date: deliveryDate,
      store_id: store.id,
      raw_store_name: store.name,
      address: store.address,
      weight_kg: 0,
      volume_m3: 0,
      amount_rub: 0,
      quantity: 0,
      time_from: store.time_window_from,
      time_to: store.time_window_to,
      unload_minutes: store.unload_minutes,
      city: store.city,
      created_at: new Date().toISOString(),
      order_number: `ORD-${dbStore.orderNextId}`,
    };

    dbStore.dailyOrders.push(newOrder);
    created.push({
      id: newOrder.id,
      store_id: newOrder.store_id!,
      store_name_raw: newOrder.raw_store_name,
    });
  }

  res.json({ created, skipped });
});

// GET /api/orders
router.get("/orders", (req, res) => {
  const date = req.query.date as string;
  let orders = dbStore.dailyOrders || [];
  if (date) {
    orders = orders.filter((o) => o.delivery_date === date);
  }

  const storeMap = new Map(dbStore.stores.map((s) => [s.id, s]));

  const mappedOrders = orders.map((o) => {
    const matchedStore = o.store_id ? storeMap.get(o.store_id) : null;
    return {
      id: o.id,
      store_id: o.store_id ?? null,
      store_name_raw: o.raw_store_name || "",
      address_raw: o.address || "",
      store_name_db: matchedStore?.name || o.raw_store_name || null,
      store_address: matchedStore?.address || o.address || null,
      order_number: o.order_number || `ORD-${o.id}`,
      weight_kg: o.weight_kg || 0,
      volume_m3: o.volume_m3 || 0,
      amount_rub: o.amount_rub || 0,
      quantity: o.quantity ?? 0,
      products: o.products || "",
      notes: o.notes || "",
      delivery_date: o.delivery_date,
    };
  });

  res.json({
    delivery_date: date || new Date().toISOString().split("T")[0],
    orders: mappedOrders,
    total_count: mappedOrders.length,
    total_weight_kg: mappedOrders.reduce((acc, o) => acc + (Number(o.weight_kg) || 0), 0),
    total_volume_m3: mappedOrders.reduce((acc, o) => acc + (Number(o.volume_m3) || 0), 0),
    total_amount_rub: mappedOrders.reduce((acc, o) => acc + (Number(o.amount_rub) || 0), 0),
  });
});

// PUT /api/orders/:id
router.put("/orders/:id", (req, res) => {
  const id = Number(req.params.id);
  const order = dbStore.dailyOrders.find((o) => o.id === id);
  if (!order) {
    return res.status(404).json({ detail: "Заявка не найдена" });
  }

  const body = req.body || {};
  if (body.weight_kg !== undefined) order.weight_kg = Number(body.weight_kg) || 0;
  if (body.volume_m3 !== undefined) order.volume_m3 = Number(body.volume_m3) || 0;
  if (body.amount_rub !== undefined) order.amount_rub = Number(body.amount_rub) || 0;
  if (body.quantity !== undefined) order.quantity = Number(body.quantity) || 0;
  if (body.notes !== undefined) order.notes = String(body.notes);
  if (body.products !== undefined) order.products = String(body.products);

  res.json({ ok: true, order });
});

// DELETE /api/orders/:id
router.delete("/orders/:id", (req, res) => {
  const id = Number(req.params.id);
  dbStore.dailyOrders = dbStore.dailyOrders.filter((o) => o.id !== id);
  res.json({ ok: true });
});

// DELETE /api/orders
router.delete("/orders", (req, res) => {
  const date = req.query.date as string;
  if (date) {
    dbStore.dailyOrders = dbStore.dailyOrders.filter((o) => o.delivery_date !== date);
  } else {
    dbStore.dailyOrders = [];
  }
  res.json({ ok: true });
});

// POST /api/orders/rematch
router.post("/orders/rematch", (req, res) => {
  const date = (req.query.date as string) || (req.body?.date as string);
  let count = 0;
  const storeMap = new Map(dbStore.stores.map((s) => [s.name.toLowerCase().trim(), s]));

  for (const o of dbStore.dailyOrders) {
    if (date && o.delivery_date !== date) continue;
    if (!o.store_id) {
      const match = storeMap.get((o.raw_store_name || "").toLowerCase().trim());
      if (match) {
        o.store_id = match.id;
        count++;
      }
    }
  }

  res.json({ rematched_count: count, ok: true });
});

// GET /api/orders/import-history
router.get("/orders/import-history", (req, res) => {
  res.json({ imports: dbStore.importHistory });
});

// GET /api/orders/import-history/:id/details
router.get("/orders/import-history/:id/details", (req, res) => {
  const id = Number(req.params.id);
  const record = dbStore.importHistory.find((r) => r.id === id);
  if (!record) {
    return res.status(404).json({ detail: "Запись не найдена" });
  }

  res.json({
    id: record.id,
    delivery_date: record.delivery_date,
    filename: record.filename,
    created_at: record.created_at,
    total_orders: record.total_orders,
    matched_orders: record.matched_orders,
    unmatched_orders: record.unmatched_orders,
    unmatched_stores: record.unmatched_stores || [],
    orders: record.orders || [],
  });
});

// DELETE /api/orders/import-history/:id
router.delete("/orders/import-history/:id", (req, res) => {
  const id = Number(req.params.id);
  dbStore.importHistory = dbStore.importHistory.filter((r) => r.id !== id);
  res.json({ ok: true });
});

// DELETE /api/orders/import-history
router.delete("/orders/import-history", (req, res) => {
  dbStore.importHistory = [];
  res.json({ ok: true });
});

export default router;
