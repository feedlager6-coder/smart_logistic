/**
 * SmartRoute JavaScript/TypeScript Client SDK
 * ============================================
 *
 * Официальный JS-клиент для SmartRoute Public API v1.
 * Работает в Node.js и в браузере (fetch API).
 *
 * Установка: нет зависимостей — только встроенный fetch.
 *
 * Использование (Node.js / ESM):
 *   import { SmartRouteClient } from "./smartroute-client.js";
 *
 *   const sr = new SmartRouteClient({
 *     baseUrl: "https://ваш-домен.railway.app",
 *     apiKey:  "sr_live_XXXX-XXXX",
 *   });
 *
 *   const stores = await sr.stores.list();
 *   console.log(stores.data);
 *
 * Использование (CommonJS):
 *   const { SmartRouteClient } = require("./smartroute-client.cjs");
 *
 * @version 1.0.0
 */

// ─────────────────────────────────────────────────────────────────────────────
// Error class
// ─────────────────────────────────────────────────────────────────────────────

export class SmartRouteError extends Error {
  /**
   * @param {number} statusCode  HTTP status
   * @param {string} errorCode   Machine-readable error code (from API envelope)
   * @param {string} message     Human-readable message
   * @param {string} requestId   Request ID for tracing
   */
  constructor(statusCode, errorCode, message, requestId = "") {
    super(`[${statusCode}] ${errorCode}: ${message} (req=${requestId})`);
    this.name       = "SmartRouteError";
    this.statusCode = statusCode;
    this.errorCode  = errorCode;
    this.requestId  = requestId;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Base resource
// ─────────────────────────────────────────────────────────────────────────────

class Resource {
  /** @param {SmartRouteClient} client */
  constructor(client) {
    this._client = client;
  }

  _get(path, params)       { return this._client._request("GET",    path, { params }); }
  _post(path, body)        { return this._client._request("POST",   path, { body   }); }
  _put(path, body)         { return this._client._request("PUT",    path, { body   }); }
  _delete(path, params)    { return this._client._request("DELETE", path, { params }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stores
// ─────────────────────────────────────────────────────────────────────────────

class StoresResource extends Resource {
  /**
   * Список магазинов.
   * @param {{ page?: number, page_size?: number, q?: string, city?: string }} opts
   */
  list({ page = 1, page_size = 50, q, city } = {}) {
    return this._get("/api/v1/stores", { page, page_size, ...(q && { q }), ...(city && { city }) });
  }

  /** @param {number} storeId */
  get(storeId) {
    return this._get(`/api/v1/stores/${storeId}`);
  }

  /**
   * Создать магазин.
   * @param {{ name: string, address: string, city?: string, lat?: number, lon?: number,
   *            time_from?: string, time_to?: string, unload_minutes?: number }} store
   */
  create(store) {
    return this._post("/api/v1/stores", store);
  }

  /**
   * Обновить магазин.
   * @param {number} storeId
   * @param {Partial<{ name, address, city, lat, lon, time_from, time_to, unload_minutes }>} fields
   */
  update(storeId, fields) {
    return this._put(`/api/v1/stores/${storeId}`, fields);
  }

  /** @param {number} storeId */
  delete(storeId) {
    return this._delete(`/api/v1/stores/${storeId}`);
  }

  /**
   * Массовое создание/обновление (upsert по name+city). Limit: 1000.
   * @param {Array<{ name, address, city?, lat?, lon? }>} stores
   */
  batchUpsert(stores) {
    return this._post("/api/v1/stores/batch", { stores });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Orders
// ─────────────────────────────────────────────────────────────────────────────

class OrdersResource extends Resource {
  /**
   * Заявки на дату.
   * @param {string} deliveryDate  YYYY-MM-DD
   */
  list(deliveryDate) {
    return this._get("/api/v1/orders", { date: deliveryDate });
  }

  /**
   * Загрузить заявки.
   * @param {Array<{ store_name, address?, city?, delivery_date?, quantity?, weight_kg?, products? }>} orders
   * @param {string} [deliveryDate]  YYYY-MM-DD — дата по умолчанию
   */
  batch(orders, deliveryDate) {
    return this._post("/api/v1/orders/batch", {
      orders,
      ...(deliveryDate && { delivery_date: deliveryDate }),
    });
  }

  /**
   * Удалить заявки на дату.
   * @param {string} deliveryDate  YYYY-MM-DD
   */
  delete(deliveryDate) {
    return this._delete("/api/v1/orders", { date: deliveryDate });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

class RoutesResource extends Resource {
  /**
   * Построить маршруты (VRP-оптимизация).
   * @param {{
   *   store_ids: number[],
   *   vehicles: Array<{ name: string, capacity_kg?: number }>,
   *   depot_lat?: number,
   *   depot_lon?: number,
   *   delivery_date?: string,
   *   max_stops_per_vehicle?: number,
   *   use_time_windows?: boolean,
   *   use_unload_time?: boolean,
   *   average_speed?: number,
   * }} params
   */
  build({
    store_ids,
    vehicles,
    depot_lat = 42.9849,
    depot_lon = 47.5046,
    delivery_date,
    max_stops_per_vehicle,
    use_time_windows = false,
    use_unload_time  = true,
    average_speed    = 40,
  }) {
    return this._post("/api/v1/routes/build", {
      store_ids,
      vehicles,
      depot_lat,
      depot_lon,
      use_time_windows,
      use_unload_time,
      average_speed,
      optimize_by: "distance",
      ...(delivery_date           && { delivery_date }),
      ...(max_stops_per_vehicle   && { max_stops_per_vehicle }),
    });
  }

  /** @param {{ page?: number, page_size?: number }} opts */
  list({ page = 1, page_size = 20 } = {}) {
    return this._get("/api/v1/routes", { page, page_size });
  }

  /** @param {number} sessionId */
  get(sessionId) {
    return this._get(`/api/v1/routes/${sessionId}`);
  }

  /** @param {number} sessionId */
  delete(sessionId) {
    return this._delete(`/api/v1/routes/${sessionId}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Analytics
// ─────────────────────────────────────────────────────────────────────────────

class AnalyticsResource extends Resource {
  summary()                             { return this._get("/api/v1/analytics/summary"); }
  daily(dateFrom, dateTo)               { return this._get("/api/v1/analytics/daily",        { date_from: dateFrom, date_to: dateTo }); }
  monthly(dateFrom, dateTo)             { return this._get("/api/v1/analytics/monthly",      { date_from: dateFrom, date_to: dateTo }); }
  topStores()                           { return this._get("/api/v1/analytics/top-stores"); }
  vehicleLoad(dateFrom, dateTo)         { return this._get("/api/v1/analytics/vehicle-load", { date_from: dateFrom, date_to: dateTo }); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings
// ─────────────────────────────────────────────────────────────────────────────

class SettingsResource extends Resource {
  get() { return this._get("/api/v1/settings"); }

  /**
   * @param {{ fuel_price?: number, fuel_consumption?: number }} fields
   */
  update(fields) { return this._put("/api/v1/settings", fields); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Keys
// ─────────────────────────────────────────────────────────────────────────────

class KeysResource extends Resource {
  me() { return this._get("/api/v1/keys/me"); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Client
// ─────────────────────────────────────────────────────────────────────────────

export class SmartRouteClient {
  /**
   * @param {{
   *   baseUrl: string,
   *   apiKey:  string,
   *   timeout?: number,
   *   retries?: number,
   *   fetch?:   Function,
   * }} opts
   */
  constructor({ baseUrl, apiKey, timeout = 30_000, retries = 2, fetch: customFetch } = {}) {
    if (!baseUrl) throw new Error("SmartRouteClient: baseUrl is required");
    if (!apiKey)  throw new Error("SmartRouteClient: apiKey is required");

    this.baseUrl  = baseUrl.replace(/\/$/, "");
    this._apiKey  = apiKey;
    this._timeout = timeout;
    this._retries = retries;
    this._fetch   = customFetch || globalThis.fetch.bind(globalThis);

    this.stores    = new StoresResource(this);
    this.orders    = new OrdersResource(this);
    this.routes    = new RoutesResource(this);
    this.analytics = new AnalyticsResource(this);
    this.settings  = new SettingsResource(this);
    this.keys      = new KeysResource(this);
  }

  /**
   * Low-level HTTP helper. Parses v1 error envelope and throws SmartRouteError on non-2xx.
   * @param {"GET"|"POST"|"PUT"|"DELETE"} method
   * @param {string} path
   * @param {{ params?: object, body?: object }} opts
   * @returns {Promise<object>}
   */
  async _request(method, path, { params, body } = {}) {
    let url = this.baseUrl + path;
    if (params) {
      const qs = new URLSearchParams(
        Object.fromEntries(
          Object.entries(params).filter(([, v]) => v !== undefined && v !== null)
        )
      ).toString();
      if (qs) url += "?" + qs;
    }

    const headers = {
      "Authorization": `Bearer ${this._apiKey}`,
      "Content-Type":  "application/json",
      "User-Agent":    "smartroute-js/1.0.0",
    };

    const init = {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(this._timeout),
    };

    let lastError;
    for (let attempt = 0; attempt <= this._retries; attempt++) {
      try {
        const resp = await this._fetch(url, init);

        let json;
        try { json = await resp.json(); } catch { json = {}; }

        if (resp.ok) return json;

        const err = json?.error ?? {};
        throw new SmartRouteError(
          resp.status,
          err.code    ?? "UNKNOWN",
          err.message ?? json?.detail ?? `HTTP ${resp.status}`,
          json?.request_id ?? ""
        );
      } catch (e) {
        if (e instanceof SmartRouteError) throw e;   // API error — don't retry
        lastError = e;
        if (attempt < this._retries) {
          await new Promise(r => setTimeout(r, 1_000 * 1.5 ** attempt));
        }
      }
    }

    throw new SmartRouteError(0, "NETWORK_ERROR", String(lastError));
  }

  toString() {
    return `SmartRouteClient(baseUrl="${this.baseUrl}")`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick test / CLI (Node.js)
// node smartroute-client.js <BASE_URL> <API_KEY>
// ─────────────────────────────────────────────────────────────────────────────

if (
  typeof process !== "undefined" &&
  process.argv[1]?.endsWith("smartroute-client.js")
) {
  const [, , baseUrl, apiKey] = process.argv;
  if (!baseUrl || !apiKey) {
    console.error("Usage: node smartroute-client.js <BASE_URL> <API_KEY>");
    process.exit(1);
  }

  const sr = new SmartRouteClient({ baseUrl, apiKey });

  (async () => {
    try {
      console.log("\n=== API Key Info ===");
      console.log(await sr.keys.me());

      console.log("\n=== Stores (page 1) ===");
      const stores = await sr.stores.list({ page_size: 3 });
      console.log(`Total: ${stores.meta?.total ?? "?"}`);
      (stores.data || []).forEach(s => console.log(`  [${s.id}] ${s.name} — ${s.address}`));

      console.log("\n=== Analytics Summary ===");
      const { data: summary } = await sr.analytics.summary();
      console.log(`  Sessions: ${summary.total_sessions}, km: ${summary.total_km}, saved: ${summary.total_saved_rub} ₽`);
    } catch (e) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  })();
}
