export interface StoreData {
  id: number;
  name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  map_url?: string | null;
  geocode_status: "ok" | "pending" | "failed";
  time_window_from: string;
  time_window_to: string;
  unload_minutes: number;
  city?: string;
  created_at: string;
  external_id?: string;
  source?: string;
}

export interface SettingsData {
  fuel_price: number;
  fuel_consumption: number;
  cost_per_km: number;
  dispatcher_telegram_username?: string;
  dispatcher_phone?: string;
}

export interface DriverData {
  id: number;
  name: string;
  phone: string;
  vehicle_name: string;
  is_active: boolean;
  telegram_chat_id: number | null;
  telegram_username: string | null;
  telegram_connected_at: string | null;
  telegram_connect_token?: string | null;
  telegram_connect_token_hash?: string | null;
  telegram_token_expires_at?: string | null;
  telegram_tracking_enabled?: boolean;
  telegram_pending_action?: string | null;
  telegram_pending_execution_id?: number | null;
  telegram_pending_payload?: any;
  created_at: string;
  updated_at: string;
}

export interface RouteExecutionData {
  id: number;
  assignment_id: number;
  store_id: number | null;
  visit_order: number;
  store_name: string;
  store_phone?: string;
  store_client?: string;
  address: string;
  lat: number | null;
  lon: number | null;
  products: string;
  quantity: number;
  actual_qty: number;
  amount_rub: number;
  actual_amount_rub: number;
  arrive_by: string;
  status: "planned" | "delivered" | "partial" | "failed" | "rescheduled";
  payment_method: "cash" | "card" | "transfer" | "none";
  payment_status: "pending" | "paid" | "not_paid";
  driver_comment: string;
  yandex_url: string;
  is_remote_completion?: boolean;
  completion_distance_meters?: number | null;
  rescheduled_date?: string;
  remaining_order_date?: string;
  delivered_at?: string | null;
  updated_at: string;
}

export interface RouteAssignmentData {
  id: number;
  session_id: number;
  route_index: number;
  driver_id: number | null;
  driver_name: string;
  driver_phone?: string;
  vehicle_name: string;
  access_token: string;
  route_yandex_url: string;
  status: "planned" | "in_progress" | "completed";
  telegram_message_id?: number | null;
  telegram_message_chat_id?: number | null;
  created_at: string;
  updated_at: string;
  executions?: RouteExecutionData[];
}

export interface RouteStopData {
  order: number;
  store_id: number;
  store_name: string;
  address: string;
  lat: number | null;
  lon: number | null;
  arrive_by?: string | null;
  weight_kg?: number;
  volume_m3?: number;
}

export interface VehicleRouteData {
  vehicle_name: string;
  stores: RouteStopData[];
  total_km: number;
  estimated_minutes: number;
  drive_minutes?: number;
  service_minutes?: number;
  yandex_url: string;
  yandex_urls: string[];
  whatsapp_url: string;
  capacity_kg?: number;
  total_weight_kg?: number;
  total_volume_m3?: number;
}

export interface SavingsData {
  optimized_km: number;
  unoptimized_km: number;
  saved_km: number;
  saved_pct: number;
  saved_fuel_l: number;
  saved_fuel_cost_rub: number;
  saved_rub_day: number;
  saved_rub_month: number;
}

export interface RouteSessionData {
  id: number;
  date: string;
  depot_lat: number;
  depot_lon: number;
  depot_address: string;
  num_points: number;
  total_km: number;
  savings: SavingsData;
  routes: VehicleRouteData[];
  cost_per_km: number;
  created_at: string;
}

export interface DailyOrderData {
  id: number;
  delivery_date: string;
  store_id: number | null;
  raw_store_name: string;
  address: string;
  weight_kg: number;
  volume_m3: number;
  amount_rub: number;
  time_from?: string;
  time_to?: string;
  unload_minutes?: number;
  city?: string;
  created_at: string;
  notes?: string;
  products?: string;
  order_number?: string;
  quantity?: number;
}

export interface ImportHistoryRecord {
  id: number;
  delivery_date: string;
  filename: string;
  total_orders: number;
  matched_orders: number;
  unmatched_orders: number;
  created_at: string;
  unmatched_stores?: { store_name_raw: string; order_count: number }[];
  orders?: DailyOrderData[];
}

// Initial Makhachkala stores seed
const initialStores: StoreData[] = [
  {
    id: 1,
    name: "Гастроном №1 (Центральный)",
    address: "Махачкала, ул. Ирчи Казака, 35",
    lat: 42.9734,
    lon: 47.5028,
    map_url: "https://yandex.ru/maps/-/CDu~1",
    geocode_status: "ok",
    time_window_from: "08:00",
    time_window_to: "18:00",
    unload_minutes: 15,
    city: "Махачкала",
    created_at: new Date().toISOString(),
  },
  {
    id: 2,
    name: "Супермаркет 'Зеленое Яблоко' (Шамиля)",
    address: "Махачкала, пр. Имама Шамиля, 42",
    lat: 42.9689,
    lon: 47.4912,
    map_url: "https://yandex.ru/maps/-/CDu~2",
    geocode_status: "ok",
    time_window_from: "09:00",
    time_window_to: "20:00",
    unload_minutes: 20,
    city: "Махачкала",
    created_at: new Date().toISOString(),
  },
  {
    id: 3,
    name: "Маркет 'Ярагского'",
    address: "Махачкала, ул. 26 Бакинских Комиссаров (Ярагского), 71",
    lat: 42.9781,
    lon: 47.5105,
    map_url: "https://yandex.ru/maps/-/CDu~3",
    geocode_status: "ok",
    time_window_from: "08:00",
    time_window_to: "19:00",
    unload_minutes: 15,
    city: "Махачкала",
    created_at: new Date().toISOString(),
  },
  {
    id: 4,
    name: "Универсам 'Акушинского'",
    address: "Махачкала, пр. Али-Гаджи Акушинского, 98",
    lat: 42.9982,
    lon: 47.4589,
    map_url: "https://yandex.ru/maps/-/CDu~4",
    geocode_status: "ok",
    time_window_from: "08:30",
    time_window_to: "18:00",
    unload_minutes: 25,
    city: "Махачкала",
    created_at: new Date().toISOString(),
  },
  {
    id: 5,
    name: "Минимаркет 'Нахимова'",
    address: "Махачкала, ул. Нахимова, 12",
    lat: 42.9612,
    lon: 47.5184,
    map_url: "https://yandex.ru/maps/-/CDu~5",
    geocode_status: "ok",
    time_window_from: "09:00",
    time_window_to: "17:00",
    unload_minutes: 10,
    city: "Махачкала",
    created_at: new Date().toISOString(),
  },
  {
    id: 6,
    name: "Супермаркет 'Каспий'",
    address: "Махачкала, ул. Гамидова, 18",
    lat: 42.9631,
    lon: 47.4981,
    map_url: "https://yandex.ru/maps/-/CDu~6",
    geocode_status: "ok",
    time_window_from: "08:00",
    time_window_to: "20:00",
    unload_minutes: 20,
    city: "Махачкала",
    created_at: new Date().toISOString(),
  },
  {
    id: 7,
    name: "Продукты 'Ахмедхан Султана'",
    address: "Махачкала, пр. Амет-Хана Султана, 10А",
    lat: 42.9520,
    lon: 47.4812,
    map_url: "https://yandex.ru/maps/-/CDu~7",
    geocode_status: "ok",
    time_window_from: "09:00",
    time_window_to: "19:00",
    unload_minutes: 15,
    city: "Махачкала",
    created_at: new Date().toISOString(),
  },
  {
    id: 8,
    name: "ТЦ 'Эльдорадо' Маркет",
    address: "Махачкала, ул. Расула Гамзатова, 64",
    lat: 42.9802,
    lon: 47.5140,
    map_url: "https://yandex.ru/maps/-/CDu~8",
    geocode_status: "ok",
    time_window_from: "08:00",
    time_window_to: "21:00",
    unload_minutes: 30,
    city: "Махачкала",
    created_at: new Date().toISOString(),
  },
];

const initialDrivers: DriverData[] = [
  {
    id: 1,
    name: "Ахмед",
    phone: "+7 (928) 555-01-01",
    vehicle_name: "Газель 1 (А123АА)",
    is_active: true,
    telegram_chat_id: null,
    telegram_username: null,
    telegram_connected_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 2,
    name: "Магомед",
    phone: "+7 (928) 555-02-02",
    vehicle_name: "Газель 2 (В456ВВ)",
    is_active: true,
    telegram_chat_id: null,
    telegram_username: null,
    telegram_connected_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 3,
    name: "Руслан",
    phone: "+7 (928) 555-03-03",
    vehicle_name: "Ларгус (С789СС)",
    is_active: true,
    telegram_chat_id: null,
    telegram_username: null,
    telegram_connected_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 4,
    name: "Шамиль",
    phone: "+7 (928) 555-04-04",
    vehicle_name: "Газель 3 (Е012ЕЕ)",
    is_active: true,
    telegram_chat_id: null,
    telegram_username: null,
    telegram_connected_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "smartroute_store.json");

class MemoryStore {
  stores: StoreData[] = [...initialStores];
  drivers: DriverData[] = [...initialDrivers];
  routeSessions: RouteSessionData[] = [];
  assignments: RouteAssignmentData[] = [];
  dailyOrders: DailyOrderData[] = [];
  importHistory: ImportHistoryRecord[] = [];
  settings: SettingsData = {
    fuel_price: 67,
    fuel_consumption: 13,
    cost_per_km: Math.round((67 * 13) / 100 * 100) / 100, // 8.71
    dispatcher_telegram_username: "",
    dispatcher_phone: "+7 (928) 000-00-00",
  };
  storeNextId = 9;
  driverNextId = 5;
  sessionNextId = 1;
  assignmentNextId = 1;
  executionNextId = 1;
  orderNextId = 1;
  importNextId = 1;
  bulkJobs: Map<string, {
    id: string;
    total: number;
    created: number;
    failed: number;
    done: boolean;
    result: { name: string; status: "created" | "failed" | "skipped"; store_id?: number }[];
  }> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        const data = JSON.parse(raw);
        if (Array.isArray(data.stores) && data.stores.length > 0) this.stores = data.stores;
        if (Array.isArray(data.drivers) && data.drivers.length > 0) this.drivers = data.drivers;
        if (Array.isArray(data.routeSessions)) this.routeSessions = data.routeSessions;
        if (Array.isArray(data.assignments)) this.assignments = data.assignments;
        if (Array.isArray(data.dailyOrders)) this.dailyOrders = data.dailyOrders;
        if (Array.isArray(data.importHistory)) this.importHistory = data.importHistory;
        if (data.settings && typeof data.settings === "object") this.settings = { ...this.settings, ...data.settings };
        if (data.storeNextId) this.storeNextId = data.storeNextId;
        if (data.driverNextId) this.driverNextId = data.driverNextId;
        if (data.sessionNextId) this.sessionNextId = data.sessionNextId;
        if (data.assignmentNextId) this.assignmentNextId = data.assignmentNextId;
        if (data.executionNextId) this.executionNextId = data.executionNextId;
        if (data.orderNextId) this.orderNextId = data.orderNextId;
        if (data.importNextId) this.importNextId = data.importNextId;
      }
    } catch (err) {
      console.warn("[MemoryStore] Failed to load data from disk, using defaults:", err);
    }
  }

  save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      const data = {
        stores: this.stores,
        drivers: this.drivers,
        routeSessions: this.routeSessions,
        assignments: this.assignments,
        dailyOrders: this.dailyOrders,
        importHistory: this.importHistory,
        settings: this.settings,
        storeNextId: this.storeNextId,
        driverNextId: this.driverNextId,
        sessionNextId: this.sessionNextId,
        assignmentNextId: this.assignmentNextId,
        executionNextId: this.executionNextId,
        orderNextId: this.orderNextId,
        importNextId: this.importNextId,
      };
      fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), "utf-8");
    } catch (err) {
      console.error("[MemoryStore] Failed to save data to disk:", err);
    }
  }
}

export const dbStore = new MemoryStore();
