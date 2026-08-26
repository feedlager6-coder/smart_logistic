import { Router } from "express";
import { dbStore, DailyOrderData, StoreData } from "../store";

const router = Router();

// Helper to normalize store name & address
function findOrCreateStore(rawName: string, address: string, phone?: string): StoreData {
  const cleanName = (rawName || "Точка без названия").trim();
  const cleanAddr = (address || "").trim();

  // Try exact or fuzzy match
  let store = dbStore.stores.find(
    (s) =>
      s.name.toLowerCase() === cleanName.toLowerCase() ||
      (cleanAddr && s.address.toLowerCase() === cleanAddr.toLowerCase())
  );

  if (!store) {
    store = {
      id: dbStore.storeNextId++,
      name: cleanName,
      address: cleanAddr || "Махачкала, адрес уточняется",
      lat: null,
      lon: null,
      geocode_status: "pending",
      time_window_from: "08:00",
      time_window_to: "18:00",
      unload_minutes: 15,
      city: "Махачкала",
      source: "1c",
      created_at: new Date().toISOString(),
    };
    dbStore.stores.push(store);
  }

  return store;
}

// ─── POST /api/v1/orders (Create or Update Single Order from 1C) ─────────────
router.post("/v1/orders", (req, res) => {
  const body = req.body || {};
  const {
    order_number,
    external_id,
    delivery_date = new Date().toISOString().split("T")[0],
    client_name,
    customer_name,
    customer_phone,
    customer_email,
    address,
    time_window_from = "08:00",
    time_window_to = "18:00",
    unload_minutes = 15,
    weight_kg = 0,
    volume_m3 = 0,
    amount_rub = 0,
    quantity = 1,
    products,
    items,
    notes,
  } = body;

  const rawClientName = client_name || customer_name || `Заказ ${order_number || "1C"}`;
  const store = findOrCreateStore(rawClientName, address || "", customer_phone);

  const extId = external_id || (order_number ? `1c_${order_number}` : `order_${Date.now()}`);

  // Idempotency: find existing order with same external_id or (order_number + delivery_date)
  let existing = dbStore.dailyOrders.find(
    (o) => (o.external_id && o.external_id === extId) || (order_number && o.order_number === order_number && o.delivery_date === delivery_date)
  );

  if (existing) {
    // Update existing order
    existing.store_id = store.id;
    existing.raw_store_name = rawClientName;
    existing.address = address || existing.address;
    existing.weight_kg = Number(weight_kg) || existing.weight_kg;
    existing.volume_m3 = Number(volume_m3) || existing.volume_m3;
    existing.amount_rub = Number(amount_rub) || existing.amount_rub;
    existing.quantity = Number(quantity) || existing.quantity;
    existing.time_from = time_window_from || existing.time_from;
    existing.time_to = time_window_to || existing.time_to;
    existing.unload_minutes = Number(unload_minutes) || existing.unload_minutes;
    existing.products = products || (items ? JSON.stringify(items) : existing.products);
    existing.notes = notes || existing.notes;
    existing.customer_name = customer_name || rawClientName;
    existing.customer_phone = customer_phone || existing.customer_phone;
    existing.customer_email = customer_email || existing.customer_email;
    existing.updated_at = new Date().toISOString();

    dbStore.save();

    return res.json({
      ok: true,
      action: "updated",
      order_id: existing.id,
      external_id: existing.external_id,
      order: existing,
    });
  }

  // Create new order
  const newOrder: DailyOrderData = {
    id: dbStore.orderNextId++,
    delivery_date,
    store_id: store.id,
    raw_store_name: rawClientName,
    address: address || store.address,
    weight_kg: Number(weight_kg) || 0,
    volume_m3: Number(volume_m3) || 0,
    amount_rub: Number(amount_rub) || 0,
    quantity: Number(quantity) || 1,
    time_from: time_window_from,
    time_to: time_window_to,
    unload_minutes: Number(unload_minutes) || 15,
    city: store.city || "Махачкала",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: notes || "",
    products: products || (items ? JSON.stringify(items) : ""),
    order_number: order_number || `1C-${Date.now().toString().slice(-6)}`,
    external_id: extId,
    customer_name: customer_name || rawClientName,
    customer_phone: customer_phone || "",
    customer_email: customer_email || "",
    delivery_status: "planned",
    items: Array.isArray(items) ? items : undefined,
  };

  dbStore.dailyOrders.push(newOrder);
  dbStore.save();

  res.status(201).json({
    ok: true,
    action: "created",
    order_id: newOrder.id,
    external_id: newOrder.external_id,
    order: newOrder,
  });
});

// ─── POST /api/v1/orders/batch (Batch Import from 1C) ──────────────────────
router.post("/v1/orders/batch", (req, res) => {
  const body = req.body || {};
  const ordersList: any[] = Array.isArray(body.orders)
    ? body.orders
    : Array.isArray(body)
    ? body
    : [];

  const defaultDate = body.delivery_date || new Date().toISOString().split("T")[0];

  let createdCount = 0;
  let updatedCount = 0;
  let matchedStores = 0;
  let newStores = 0;

  const processedOrders: DailyOrderData[] = [];

  for (const item of ordersList) {
    const rawClientName = item.client_name || item.customer_name || item.raw_store_name || `Заказ ${item.order_number || ""}`;
    const address = item.address || item.delivery_address || "";
    const deliveryDate = item.delivery_date || defaultDate;
    const orderNumber = item.order_number || item.number || "";
    const extId = item.external_id || (orderNumber ? `1c_${orderNumber}` : `batch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`);

    const initialStoreCount = dbStore.stores.length;
    const store = findOrCreateStore(rawClientName, address, item.customer_phone || item.phone);
    if (dbStore.stores.length > initialStoreCount) {
      newStores++;
    } else {
      matchedStores++;
    }

    let existing = dbStore.dailyOrders.find(
      (o) =>
        (o.external_id && o.external_id === extId) ||
        (orderNumber && o.order_number === orderNumber && o.delivery_date === deliveryDate)
    );

    if (existing) {
      existing.store_id = store.id;
      existing.raw_store_name = rawClientName;
      existing.address = address || existing.address;
      existing.weight_kg = Number(item.weight_kg) || existing.weight_kg;
      existing.volume_m3 = Number(item.volume_m3) || existing.volume_m3;
      existing.amount_rub = Number(item.amount_rub) || existing.amount_rub;
      existing.quantity = Number(item.quantity) || existing.quantity;
      existing.time_from = item.time_window_from || item.time_from || existing.time_from;
      existing.time_to = item.time_window_to || item.time_to || existing.time_to;
      existing.products = item.products || (item.items ? JSON.stringify(item.items) : existing.products);
      existing.customer_name = item.customer_name || rawClientName;
      existing.customer_phone = item.customer_phone || item.phone || existing.customer_phone;
      existing.updated_at = new Date().toISOString();
      updatedCount++;
      processedOrders.push(existing);
    } else {
      const newOrder: DailyOrderData = {
        id: dbStore.orderNextId++,
        delivery_date: deliveryDate,
        store_id: store.id,
        raw_store_name: rawClientName,
        address: address || store.address,
        weight_kg: Number(item.weight_kg) || 0,
        volume_m3: Number(item.volume_m3) || 0,
        amount_rub: Number(item.amount_rub) || 0,
        quantity: Number(item.quantity) || 1,
        time_from: item.time_window_from || item.time_from || "08:00",
        time_to: item.time_window_to || item.time_to || "18:00",
        unload_minutes: Number(item.unload_minutes) || 15,
        city: store.city || "Махачкала",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        notes: item.notes || "",
        products: item.products || (item.items ? JSON.stringify(item.items) : ""),
        order_number: orderNumber || `1C-${Date.now().toString().slice(-6)}`,
        external_id: extId,
        customer_name: item.customer_name || rawClientName,
        customer_phone: item.customer_phone || item.phone || "",
        customer_email: item.customer_email || "",
        delivery_status: "planned",
        items: Array.isArray(item.items) ? item.items : undefined,
      };
      dbStore.dailyOrders.push(newOrder);
      createdCount++;
      processedOrders.push(newOrder);
    }
  }

  // Update 1C integration last_sync_at & stats
  const onec = dbStore.integrations.find((i) => i.type === "1c");
  if (onec) {
    onec.last_sync_at = new Date().toISOString();
    if (onec.stats) {
      onec.stats.total_syncs += 1;
      onec.stats.total_orders += createdCount + updatedCount;
      onec.stats.total_matched += matchedStores;
    }
  }

  dbStore.save();

  res.json({
    ok: true,
    total_received: ordersList.length,
    created: createdCount,
    updated: updatedCount,
    stores_matched: matchedStores,
    new_stores_created: newStores,
    orders: processedOrders,
  });
});

// ─── GET /api/v1/orders (Query Orders & Delivery Statuses for 1C Sync) ───────
router.get("/v1/orders", (req, res) => {
  const { date, updated_from, status } = req.query as {
    date?: string;
    updated_from?: string;
    status?: string;
  };

  let orders = dbStore.dailyOrders;

  if (date) {
    orders = orders.filter((o) => o.delivery_date === date);
  }

  if (updated_from) {
    const updatedTimestamp = new Date(updated_from).getTime();
    if (!isNaN(updatedTimestamp)) {
      orders = orders.filter((o) => {
        const orderUpdated = new Date(o.updated_at || o.created_at).getTime();
        return orderUpdated >= updatedTimestamp;
      });
    }
  }

  if (status) {
    orders = orders.filter((o) => o.delivery_status === status);
  }

  // Enrich with execution / POD info if route is built
  const responseList = orders.map((o) => {
    // Find matching route execution if available
    let execFound: any = null;
    for (const a of dbStore.assignments) {
      if (a.executions) {
        const match = a.executions.find(
          (e) => e.store_id === o.store_id || e.store_name === o.raw_store_name
        );
        if (match) {
          execFound = {
            execution: match,
            assignment: a,
          };
          break;
        }
      }
    }

    const deliveryStatus =
      o.delivery_status ||
      (execFound?.execution.status === "delivered"
        ? "delivered"
        : execFound?.execution.status === "failed"
        ? "failed"
        : execFound?.assignment.status === "in_progress"
        ? "in_transit"
        : "planned");

    return {
      id: o.id,
      order_number: o.order_number,
      external_id: o.external_id,
      delivery_date: o.delivery_date,
      client_name: o.raw_store_name,
      address: o.address,
      amount_rub: o.amount_rub,
      weight_kg: o.weight_kg,
      delivery_status: deliveryStatus,
      route_number: execFound?.assignment.id ? `Маршрут #${execFound.assignment.id}` : o.route_number || null,
      driver_name: execFound?.assignment.driver_name || o.driver_name || null,
      actual_delivery_time: execFound?.execution.delivered_at || o.actual_delivery_time || null,
      pod_signature_url: o.pod_signature_url || (deliveryStatus === "delivered" ? "https://smartroute.app/pod/demo_signature.png" : null),
      pod_photo_url: o.pod_photo_url || (deliveryStatus === "delivered" ? "https://smartroute.app/pod/demo_photo.jpg" : null),
      updated_at: o.updated_at || o.created_at,
    };
  });

  res.json({
    ok: true,
    count: responseList.length,
    orders: responseList,
  });
});

// ─── GET /api/v1/routes (Query Routes for 1C) ──────────────────────────────
router.get("/v1/routes", (req, res) => {
  const { date, driver_id } = req.query as { date?: string; driver_id?: string };

  let sessions = dbStore.routeSessions;
  if (date) {
    sessions = sessions.filter((s) => s.date === date);
  }

  const routes = dbStore.assignments
    .filter((a) => !driver_id || String(a.driver_id) === String(driver_id))
    .map((a) => {
      const session = dbStore.routeSessions.find((s) => s.id === a.session_id);
      return {
        id: a.id,
        session_id: a.session_id,
        date: session?.date || new Date().toISOString().split("T")[0],
        driver_id: a.driver_id,
        driver_name: a.driver_name,
        driver_phone: a.driver_phone,
        vehicle_name: a.vehicle_name,
        status: a.status,
        route_yandex_url: a.route_yandex_url,
        stops_count: a.executions?.length || 0,
        stops: (a.executions || []).map((e) => ({
          visit_order: e.visit_order,
          store_name: e.store_name,
          address: e.address,
          status: e.status,
          arrive_by: e.arrive_by,
          delivered_at: e.delivered_at,
        })),
      };
    });

  res.json({
    ok: true,
    date: date || new Date().toISOString().split("T")[0],
    routes,
  });
});

// ─── POST /api/v1/deliveries/status & /api/v1/deliveries/:id/status ─────────
const updateDeliveryStatusHandler = (req: any, res: any) => {
  const orderId = req.params.id ? Number(req.params.id) : Number(req.body.order_id);
  const {
    external_id,
    order_number,
    status, // "planned" | "in_transit" | "delivered" | "failed" | "canceled"
    route_number,
    driver_name,
    actual_delivery_time,
    pod_signature_url,
    pod_photo_url,
    pod_notes,
  } = req.body || {};

  const order = dbStore.dailyOrders.find(
    (o) =>
      (orderId && o.id === orderId) ||
      (external_id && o.external_id === external_id) ||
      (order_number && o.order_number === order_number)
  );

  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }

  if (status) order.delivery_status = status;
  if (route_number) order.route_number = route_number;
  if (driver_name) order.driver_name = driver_name;
  if (actual_delivery_time) order.actual_delivery_time = actual_delivery_time;
  if (pod_signature_url) order.pod_signature_url = pod_signature_url;
  if (pod_photo_url) order.pod_photo_url = pod_photo_url;
  if (pod_notes) order.pod_notes = pod_notes;
  order.updated_at = new Date().toISOString();

  dbStore.save();

  res.json({
    ok: true,
    order_id: order.id,
    external_id: order.external_id,
    delivery_status: order.delivery_status,
    actual_delivery_time: order.actual_delivery_time,
    updated_at: order.updated_at,
  });
};

router.post("/v1/deliveries/:id/status", updateDeliveryStatusHandler);
router.post("/v1/deliveries/status", updateDeliveryStatusHandler);

// ─── GET /api/v1/deliveries/:id/pod (Proof of Delivery for 1C) ──────────────
router.get("/v1/deliveries/:id/pod", (req, res) => {
  const orderId = Number(req.params.id);
  const order = dbStore.dailyOrders.find((o) => o.id === orderId);

  if (!order) {
    return res.status(404).json({ error: "Delivery not found" });
  }

  res.json({
    ok: true,
    order_id: order.id,
    order_number: order.order_number,
    external_id: order.external_id,
    client_name: order.raw_store_name,
    status: order.delivery_status || "delivered",
    delivered_at: order.actual_delivery_time || order.updated_at,
    driver_name: order.driver_name || "Водитель SmartRoute",
    signature_url: order.pod_signature_url || "https://smartroute.app/pod/sample_signature.png",
    photo_url: order.pod_photo_url || "https://smartroute.app/pod/sample_cargo.jpg",
    notes: order.pod_notes || "Товар принят без расхождений",
    coordinates: {
      lat: 42.9734,
      lon: 47.5028,
    },
  });
});

export default router;
