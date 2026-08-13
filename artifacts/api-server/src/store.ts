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

class MemoryStore {
  stores: StoreData[] = [...initialStores];
  routeSessions: RouteSessionData[] = [];
  dailyOrders: DailyOrderData[] = [];
  importHistory: ImportHistoryRecord[] = [];
  settings: SettingsData = {
    fuel_price: 67,
    fuel_consumption: 13,
    cost_per_km: Math.round((67 * 13) / 100 * 100) / 100, // 8.71
  };
  storeNextId = 9;
  sessionNextId = 1;
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
}

export const dbStore = new MemoryStore();
