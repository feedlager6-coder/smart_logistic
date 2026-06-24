import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useListStores, useBuildRoute } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2, MapPin, Truck, Route as RouteIcon, Plus, X, Copy, Save, AlertCircle, Warehouse, ExternalLink, Link, Filter, Package, Weight, AlertTriangle, ChevronDown, ChevronUp, Minus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLocation, useSearch } from "wouter";

interface Vehicle {
  id: string;
  name: string;
  capacity_kg: string;
  capacity_m3: string;
  average_speed: string;
}

const DEPOT_KEY = "smartroute_depot";
const FLEET_KEY = "smartroute_fleet";

function loadDepot(): { address: string; lat: string; lon: string } {
  try {
    const raw = localStorage.getItem(DEPOT_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { address: "", lat: "", lon: "" };
}

function loadFleet(): Vehicle[] | null {
  try {
    const raw = localStorage.getItem(FLEET_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

const DEFAULT_VEHICLE: Vehicle = { id: "1", name: "Газель 1", capacity_kg: "1500", capacity_m3: "", average_speed: "" };

export function RoutePage() {
  const { data: storesData, isLoading } = useListStores();
  const stores = Array.isArray(storesData) ? storesData : [];
  const buildRoute = useBuildRoute();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const urlSearch = useSearch();
  const fromOrders = new URLSearchParams(urlSearch).get("from") === "orders";

  const [search, setSearch] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [selectedStores, setSelectedStores] = useState<Set<number>>(new Set());
  const [showNotFoundConfirm, setShowNotFoundConfirm] = useState(false);

  // Depot state — persisted in localStorage
  const savedDepot = loadDepot() as { address: string; lat: string; lon: string; yandexUrl?: string };
  const [depotAddress, setDepotAddress] = useState(() => savedDepot.address);
  const [depotYandexUrl, setDepotYandexUrl] = useState(() => savedDepot.yandexUrl ?? "");
  const [depotLat, setDepotLat] = useState(() => savedDepot.lat);
  const [depotLon, setDepotLon] = useState(() => savedDepot.lon);
  const [depotGeocoding, setDepotGeocoding] = useState(false);

  // Fleet state — persisted in localStorage
  const [vehicles, setVehicles] = useState<Vehicle[]>(() => loadFleet() ?? [DEFAULT_VEHICLE]);
  const [useTimeWindows, setUseTimeWindows] = useState(true);
  const [useUnloadTime, setUseUnloadTime] = useState(true);
  const [maxStopsPerVehicle, setMaxStopsPerVehicle] = useState<string>(""); // "" = no cap
  const [optimizeBy, setOptimizeBy] = useState<"distance" | "time">("distance");
  const [bulkVehicleCount, setBulkVehicleCount] = useState<string>("5");
  const [showVehicleDetails, setShowVehicleDetails] = useState(false);

  // Today's orders (заявки) — for banner showing weight data, auto-select, per-store weights
  const todayDate = new Date().toISOString().slice(0, 10);
  const { data: todayOrders } = useQuery<{
    total_count: number;
    total_weight_kg: number;
    total_volume_m3: number;
    orders: Array<{ store_id: number | null; store_name_raw: string; weight_kg: number; volume_m3: number }>;
  }>({
    queryKey: ["daily_orders", todayDate],
    queryFn: async () => {
      const res = await fetch(`/api/orders?date=${todayDate}`);
      if (!res.ok) return { total_count: 0, total_weight_kg: 0, total_volume_m3: 0, orders: [] };
      return res.json();
    },
  });

  // Auto-select stores from today's orders when navigating from /orders page.
  // Trigger: URL contains ?from=orders (set by "К маршруту" button in orders.tsx).
  // Waits until both stores and orders data are available, then fires exactly once
  // per browser session (survives SPA remounts via sessionStorage flag).
  const TODAY_KEY = `smartroute_autoselect_${new Date().toISOString().slice(0, 10)}`;
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (!fromOrders) return;
    // Persist across component remounts (SPA navigation back/forward)
    if (autoSelectedRef.current || sessionStorage.getItem(TODAY_KEY)) return;
    if (!todayOrders || !stores || stores.length === 0) return; // wait for both

    // Mark done before any conditional returns — prevents repeated toasts even
    // if data arrives in multiple render cycles.
    autoSelectedRef.current = true;
    sessionStorage.setItem(TODAY_KEY, "1");

    if (todayOrders.total_count === 0) return;

    const orderStoreIds = new Set(
      (todayOrders.orders ?? [])
        .map(o => o.store_id)
        .filter((id): id is number => id !== null)
    );

    if (orderStoreIds.size === 0) {
      // Orders exist but none are matched to stores — show actionable hint.
      const unmatchedNames = (todayOrders.orders ?? [])
        .filter(o => o.store_id === null && o.store_name_raw)
        .map(o => o.store_name_raw)
        .slice(0, 3)
        .join(", ");
      toast({
        title: "Магазины не выбраны автоматически",
        description: `Названия в заявках не совпадают с магазинами базы${unmatchedNames ? ` (${unmatchedNames}…)` : ""}. Перейдите в «Заявки» и добавьте магазины по кнопке «Добавить магазин».`,
        duration: 10000,
      });
      return;
    }

    setSelectedStores(orderStoreIds);
    toast({
      title: `Выбрано ${orderStoreIds.size} магазин${orderStoreIds.size === 1 ? "" : orderStoreIds.size < 5 ? "а" : "ов"} из заявок`,
      description: "Автоматически выбраны магазины с заявками на сегодня.",
      duration: 4000,
    });
  }, [fromOrders, todayOrders, stores, toast, TODAY_KEY]);

  // Per-store weight map: store_id → weight_kg (Problem 3)
  const orderWeightMap = useMemo(() => {
    const map = new Map<number, number>();
    if (!todayOrders?.orders) return map;
    for (const o of todayOrders.orders) {
      if (o.store_id !== null && o.weight_kg > 0) {
        map.set(o.store_id, (map.get(o.store_id) ?? 0) + o.weight_kg);
      }
    }
    return map;
  }, [todayOrders]);

  // Persist depot to localStorage on change
  useEffect(() => {
    localStorage.setItem(DEPOT_KEY, JSON.stringify({ address: depotAddress, yandexUrl: depotYandexUrl, lat: depotLat, lon: depotLon }));
  }, [depotAddress, depotYandexUrl, depotLat, depotLon]);

  // Unique cities from dedicated city field (falls back to first address token for legacy stores)
  const cities = useMemo(() => {
    const citySet = new Set<string>();
    stores.forEach(s => {
      const city = (s as any).city?.trim() || s.address?.split(",")[0].trim() || "";
      if (city) citySet.add(city);
    });
    return Array.from(citySet).sort();
  }, [stores]);

  const filteredStores = stores.filter(s => {
    const q = search.toLowerCase();
    const matchesSearch = s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q);
    const storeCity = (s as any).city?.trim() || s.address?.split(",")[0].trim() || "";
    const matchesCity = cityFilter === "all" || storeCity === cityFilter;
    return matchesSearch && matchesCity;
  });

  const handleToggleStore = (id: number) => {
    const next = new Set(selectedStores);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedStores(next);
  };

  const handleSelectAll = () => {
    setSelectedStores(new Set(filteredStores.map(s => s.id)));
  };

  const handleDeselectAll = () => {
    setSelectedStores(new Set());
  };

  const handleAddVehicle = () => {
    setVehicles([...vehicles, { id: Math.random().toString(), name: `Авто ${vehicles.length + 1}`, capacity_kg: "1500", average_speed: "" }]);
  };

  const handleBulkCreate = () => {
    const count = Math.max(1, Math.min(50, parseInt(bulkVehicleCount) || 1));
    const newVehicles: Vehicle[] = Array.from({ length: count }, (_, i) => ({
      id: Math.random().toString(),
      name: `Газель ${i + 1}`,
      capacity_kg: "1500",
      average_speed: "",
    }));
    setVehicles(newVehicles);
  };

  const handleSetVehicleCount = (count: number) => {
    const newCount = Math.max(1, Math.min(50, count));
    if (newCount > vehicles.length) {
      const toAdd = newCount - vehicles.length;
      setVehicles(prev => [
        ...prev,
        ...Array.from({ length: toAdd }, (_, i) => ({
          id: Math.random().toString(),
          name: `Газель ${prev.length + i + 1}`,
          capacity_kg: prev[0]?.capacity_kg ?? "1500",
          average_speed: prev[0]?.average_speed ?? "",
        }))
      ]);
    } else {
      setVehicles(prev => prev.slice(0, newCount));
    }
  };

  const handleRemoveVehicle = (id: string) => {
    setVehicles(vehicles.filter(v => v.id !== id));
  };

  const handleDuplicateVehicle = (id: string) => {
    const v = vehicles.find(v => v.id === id);
    if (!v) return;
    const newV: Vehicle = { ...v, id: Math.random().toString(), name: `${v.name} (копия)` };
    const idx = vehicles.findIndex(v => v.id === id);
    const next = [...vehicles];
    next.splice(idx + 1, 0, newV);
    setVehicles(next);
  };

  const handleVehicleChange = (id: string, field: keyof Vehicle, value: string) => {
    setVehicles(vehicles.map(v => v.id === id ? { ...v, [field]: value } : v));
  };

  // Auto-save fleet to localStorage whenever vehicles change
  useEffect(() => {
    localStorage.setItem(FLEET_KEY, JSON.stringify(vehicles));
  }, [vehicles]);

  const handleSaveFleet = () => {
    localStorage.setItem(FLEET_KEY, JSON.stringify(vehicles));
    toast({ title: "Автопарк сохранён", description: `${vehicles.length} авт. сохранено как шаблон` });
  };

  const handleGeocodeDepot = async () => {
    const hasYandex = depotYandexUrl.trim();
    const hasAddress = depotAddress.trim();
    if (!hasYandex && !hasAddress) {
      toast({ title: "Введите адрес или ссылку Яндекс Карт", variant: "destructive" });
      return;
    }
    setDepotGeocoding(true);
    try {
      const params = new URLSearchParams();
      if (hasYandex) params.set("yandex_url", hasYandex);
      else params.set("address", hasAddress);

      const res = await fetch(`/api/geocode?${params}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Адрес не найден", description: err.detail ?? "Попробуйте уточнить запрос", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setDepotLat(String(data.lat));
      setDepotLon(String(data.lon));
      toast({ title: "Склад геокодирован", description: `${data.lat.toFixed(5)}, ${data.lon.toFixed(5)}` });
    } catch {
      toast({ title: "Ошибка геокодинга", description: "Проверьте соединение", variant: "destructive" });
    } finally {
      setDepotGeocoding(false);
    }
  };

  const depotYandexNavUrl = depotLat && depotLon
    ? `https://yandex.ru/maps/?pt=${depotLon},${depotLat}&z=16&l=map`
    : null;

  const executeBuild = () => {
    const depotLatNum = depotLat ? parseFloat(depotLat) : undefined;
    const depotLonNum = depotLon ? parseFloat(depotLon) : undefined;
    buildRoute.mutate({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: {
        store_ids: Array.from(selectedStores),
        vehicles: vehicles.map(v => ({
          name: v.name,
          // parseInt("abc") = NaN — guard with || null so backend gets null not NaN
          capacity_kg: v.capacity_kg ? (parseInt(v.capacity_kg) || null) : null,
          capacity_m3: v.capacity_m3 ? (parseFloat(v.capacity_m3) || null) : null,
          average_speed: v.average_speed ? (parseFloat(v.average_speed) || null) : null,
        })),
        depot_lat: depotLatNum ?? null,
        depot_lon: depotLonNum ?? null,
        use_time_windows: useTimeWindows,
        use_unload_time: useUnloadTime,
        max_stops_per_vehicle: maxStopsPerVehicle ? parseInt(maxStopsPerVehicle) : null,
        optimize_by: optimizeBy,
      } as any
    }, {
      onSuccess: (result: any) => {
        if (result.session_id) {
          setLocation(`/result/${result.session_id}`);
        } else {
          localStorage.setItem("smartroute_result", JSON.stringify(result));
          setLocation("/result");
        }
      },
      onError: (err: unknown) => {
        // Extract FastAPI detail message from 422 / other HTTP errors
        let description = "Не удалось построить маршрут";
        if (err && typeof err === "object") {
          const apiErr = err as { data?: { detail?: string }; message?: string; status?: number };
          if (apiErr.data?.detail) {
            description = apiErr.data.detail;
          } else if (apiErr.message && !/^HTTP \d/.test(apiErr.message)) {
            description = apiErr.message;
          }
        }
        toast({ title: "Ошибка построения маршрута", description, variant: "destructive" });
      }
    });
  };

  const handleBuild = () => {
    if (selectedStores.size === 0) {
      toast({ title: "Ошибка", description: "Выберите хотя бы один магазин", variant: "destructive" });
      return;
    }
    if (vehicles.length === 0) {
      toast({ title: "Ошибка", description: "Добавьте хотя бы один автомобиль", variant: "destructive" });
      return;
    }
    if (vehicles.length > selectedStores.size) {
      toast({
        title: "Слишком много машин",
        description: `Выбрано ${selectedStores.size} магазинов, но ${vehicles.length} машин. Уменьшите число машин до ${selectedStores.size} или добавьте магазины.`,
        variant: "destructive",
      });
      return;
    }
    // Warn if any selected stores have no coordinates
    const notFoundCount = Array.from(selectedStores).filter(id => {
      const s = stores.find(st => st.id === id);
      return s?.geocode_status === "not_found";
    }).length;
    if (notFoundCount > 0) {
      setShowNotFoundConfirm(true);
      return;
    }
    executeBuild();
  };

  // Computed totals for display
  const totalCapacityKg = vehicles.reduce((sum, v) => sum + (parseInt(v.capacity_kg) || 0), 0);
  const totalOrderKg = todayOrders?.total_weight_kg ?? 0;
  const isOverCapacity = totalCapacityKg > 0 && totalOrderKg > 0 && totalOrderKg > totalCapacityKg;

  return (
    <div className="flex flex-col flex-1 min-h-0">

      {/* ── Page header ── */}
      <div className="shrink-0 mb-4">
        <h1 className="text-3xl font-bold tracking-tight">Новый маршрут</h1>
        <p className="text-muted-foreground">Выберите магазины, настройте транспорт и запустите оптимизацию</p>
      </div>

      {/* ── Orders / weight banners ── */}
      {todayOrders && todayOrders.total_count > 0 && (
        <div className="shrink-0 flex flex-col gap-2 mb-4">
          <div className={`flex items-center gap-3 rounded-lg border px-4 py-2.5 ${isOverCapacity ? "border-amber-300 bg-amber-50" : "border-blue-200 bg-blue-50"}`}>
            <Package className={`w-4 h-4 shrink-0 ${isOverCapacity ? "text-amber-600" : "text-blue-600"}`} />
            <p className={`text-sm flex-1 ${isOverCapacity ? "text-amber-800" : "text-blue-800"}`}>
              <span className="font-semibold">Заявки на сегодня:</span>{" "}
              {todayOrders.total_count} точек
              {totalOrderKg > 0 && <> · <Weight className="inline w-3.5 h-3.5 mx-0.5" />{totalOrderKg.toLocaleString("ru-RU", {maximumFractionDigits: 0})} кг</>}
              {todayOrders.total_volume_m3 > 0 && ` · ${todayOrders.total_volume_m3} м³`}
            </p>
            <a href="/orders" className={`text-xs underline shrink-0 ${isOverCapacity ? "text-amber-600" : "text-blue-600"}`}>изменить</a>
          </div>
          {isOverCapacity && (
            <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-800">
                <span className="font-semibold">Перегруз:</span>{" "}
                заявки {totalOrderKg.toLocaleString("ru-RU", {maximumFractionDigits: 0})} кг, вместимость парка {totalCapacityKg.toLocaleString("ru-RU")} кг.
                Добавьте машины или увеличьте грузоподъёмность.
              </p>
            </div>
          )}
          {totalOrderKg === 0 && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                <span className="font-semibold">Данные о весе отсутствуют.</span>{" "}
                Контроль грузоподъёмности отключён.{" "}
                <a href="/orders" className="underline">Загрузите файл с весами</a>.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ── Main grid: stores (left, wide) + config panel (right) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 flex-1 min-h-0">

        {/* ═══════════════════════════════════════════
            LEFT: Store picker — takes 7/12 columns
            ═══════════════════════════════════════════ */}
        <Card className="lg:col-span-7 flex flex-col h-[56vh] lg:h-[calc(100vh-230px)]">
          <CardHeader className="pb-3 shrink-0">
            {/* Header row */}
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle className="text-lg">Точки доставки</CardTitle>
                <CardDescription className="text-xs mt-0.5">Выберите магазины для включения в маршрут</CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {selectedStores.size > 0 && (
                  <Badge className="text-sm px-2.5 py-1 bg-primary/10 text-primary border border-primary/20 font-semibold">
                    {selectedStores.size} из {stores.length}
                  </Badge>
                )}
                {selectedStores.size === 0 && stores.length > 0 && (
                  <Badge variant="outline" className="text-sm px-2.5 py-1 text-muted-foreground">
                    0 из {stores.length}
                  </Badge>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="relative mt-2">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Поиск по названию или адресу..."
                className="pl-9 h-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            {/* City filter */}
            {cities.length > 1 && (
              <div className="flex gap-1.5 flex-wrap mt-1.5">
                <span className="flex items-center gap-1 text-xs text-muted-foreground mr-0.5 self-center">
                  <Filter className="w-3 h-3" />
                </span>
                {["all", ...cities].map(c => (
                  <button
                    key={c}
                    onClick={() => setCityFilter(c)}
                    className={`text-xs px-2.5 py-1 rounded-full border transition-colors font-medium ${
                      cityFilter === c
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background border-border hover:bg-muted text-muted-foreground"
                    }`}
                  >
                    {c === "all" ? "Все города" : c}
                  </button>
                ))}
              </div>
            )}

            {/* Select / Deselect */}
            <div className="flex gap-2 mt-1.5">
              <Button variant="outline" size="sm" onClick={handleSelectAll} className="flex-1 h-8 text-xs">
                Выбрать все ({filteredStores.length})
              </Button>
              <Button variant="outline" size="sm" onClick={handleDeselectAll} className="flex-1 h-8 text-xs" disabled={selectedStores.size === 0}>
                Снять выбор
              </Button>
            </div>
          </CardHeader>

          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full px-4 pb-4">
              {isLoading ? (
                <div className="flex justify-center p-10">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredStores.length === 0 ? (
                <div className="text-center p-10 text-muted-foreground text-sm">
                  {stores.length === 0 ? (
                    <>Нет магазинов. <a href="/stores" className="underline text-primary">Добавьте магазины</a>.</>
                  ) : "Ничего не найдено"}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {filteredStores.map(store => {
                    const isSelected = selectedStores.has(store.id);
                    const weight = orderWeightMap.get(store.id);
                    const noCoords = store.geocode_status === 'not_found';
                    return (
                      <label
                        key={store.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-all select-none ${
                          isSelected
                            ? "border-primary/40 bg-primary/5 hover:bg-primary/8"
                            : noCoords
                            ? "border-destructive/30 bg-destructive/5 hover:bg-destructive/8"
                            : "border-transparent hover:border-border hover:bg-muted/50"
                        }`}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleToggleStore(store.id)}
                          className="shrink-0"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`font-medium text-sm truncate ${isSelected ? "text-foreground" : "text-foreground/80"}`}>
                              {store.name}
                            </span>
                            {noCoords && (
                              <span title="Нет координат — будет пропущен">
                                <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 min-w-0">
                            <span className="text-xs text-muted-foreground truncate flex items-center gap-1">
                              <MapPin className="w-3 h-3 shrink-0" />
                              {store.address}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {weight !== undefined && (
                            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                              <Weight className="w-3 h-3" />
                              {weight.toLocaleString("ru-RU", { maximumFractionDigits: 0 })} кг
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground hidden sm:block whitespace-nowrap">
                            {store.time_window_from}–{store.time_window_to}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* ═══════════════════════════════════════════
            RIGHT: Config + Build — 5/12 columns
            ═══════════════════════════════════════════ */}
        <div className="lg:col-span-5 flex flex-col gap-4 lg:h-[calc(100vh-230px)]">

          {/* Scrollable config area */}
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-0.5">

            {/* ── Depot ── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Warehouse className="w-4 h-4 text-primary" />
                  Склад (депо)
                  {depotLat && depotLon && (
                    <span className="ml-auto font-normal text-xs text-muted-foreground font-mono">
                      {parseFloat(depotLat).toFixed(4)}, {parseFloat(depotLon).toFixed(4)}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="flex gap-2">
                  <Input
                    value={depotAddress}
                    onChange={(e) => setDepotAddress(e.target.value)}
                    placeholder="Адрес склада (пусто = центр Махачкалы)"
                    onKeyDown={(e) => e.key === "Enter" && handleGeocodeDepot()}
                    className="flex-1 text-sm h-9"
                  />
                  <Button variant="outline" size="sm" onClick={handleGeocodeDepot} disabled={depotGeocoding} className="shrink-0 h-9 px-3">
                    {depotGeocoding ? <Loader2 className="w-4 h-4 animate-spin" /> : <MapPin className="w-4 h-4" />}
                  </Button>
                  {depotLat && depotLon && depotYandexNavUrl && (
                    <Button variant="ghost" size="sm" className="shrink-0 h-9 px-3" asChild>
                      <a href={depotYandexNavUrl} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </Button>
                  )}
                </div>
                <Input
                  value={depotYandexUrl}
                  onChange={(e) => setDepotYandexUrl(e.target.value)}
                  placeholder="Ссылка Яндекс Карт (необязательно)"
                  className="text-sm h-9 text-muted-foreground"
                />
              </CardContent>
            </Card>

            {/* ── Fleet / Vehicles ── */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Truck className="w-4 h-4 text-primary" />
                    Автомобили
                  </CardTitle>
                  <div className="flex items-center gap-1.5">
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1" onClick={handleSaveFleet}>
                      <Save className="w-3.5 h-3.5" />
                      Шаблон
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Stepper */}
                <div className="flex items-center justify-between gap-4 bg-muted/40 rounded-xl px-4 py-3 border">
                  <button
                    type="button"
                    onClick={() => handleSetVehicleCount(vehicles.length - 1)}
                    disabled={vehicles.length <= 1}
                    className="w-10 h-10 rounded-full border-2 border-border bg-background flex items-center justify-center text-xl font-bold text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  >
                    <Minus className="w-4 h-4" />
                  </button>

                  <div className="text-center flex-1">
                    <div className="text-4xl font-bold tabular-nums text-foreground leading-none">
                      {vehicles.length}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {vehicles.length === 1 ? "автомобиль" : vehicles.length < 5 ? "автомобиля" : "автомобилей"}
                    </div>
                    {totalCapacityKg > 0 && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {totalCapacityKg.toLocaleString("ru-RU")} кг суммарно
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => handleSetVehicleCount(vehicles.length + 1)}
                    disabled={vehicles.length >= 50}
                    className="w-10 h-10 rounded-full border-2 border-border bg-background flex items-center justify-center text-xl font-bold text-muted-foreground hover:border-primary hover:text-primary transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                </div>

                {/* Expand/collapse individual vehicle editing */}
                <button
                  type="button"
                  onClick={() => setShowVehicleDetails(v => !v)}
                  className="w-full flex items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
                >
                  <span className="flex items-center gap-1.5">
                    <Truck className="w-3.5 h-3.5" />
                    Настроить названия и вместимость
                  </span>
                  {showVehicleDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showVehicleDetails && (
                  <div className="space-y-2 border rounded-lg p-2 bg-muted/20 max-h-56 overflow-y-auto">
                    {vehicles.map((vehicle, idx) => (
                      <div key={vehicle.id} className="flex items-center gap-2 bg-background rounded-md p-2 border">
                        <span className="text-xs text-muted-foreground w-5 text-center shrink-0">{idx + 1}</span>
                        <Input
                          value={vehicle.name}
                          onChange={e => handleVehicleChange(vehicle.id, 'name', e.target.value)}
                          className="h-7 text-xs flex-1 min-w-0"
                          placeholder="Название / водитель"
                        />
                        <Input
                          type="number"
                          value={vehicle.capacity_kg}
                          onChange={e => handleVehicleChange(vehicle.id, 'capacity_kg', e.target.value)}
                          className="h-7 text-xs w-20 shrink-0"
                          placeholder="кг"
                          title="Грузоподъёмность (кг)"
                        />
                        <Input
                          type="number"
                          value={vehicle.capacity_m3}
                          onChange={e => handleVehicleChange(vehicle.id, 'capacity_m3', e.target.value)}
                          className="h-7 text-xs w-16 shrink-0"
                          placeholder="м³"
                          title="Объём кузова (м³)"
                          step="0.1"
                        />
                        <div className="flex shrink-0">
                          {vehicles.length > 1 && (
                            <button
                              type="button"
                              className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors"
                              onClick={() => handleRemoveVehicle(vehicle.id)}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddVehicle}
                      className="w-full h-7 text-xs text-primary hover:text-primary/80 border border-dashed border-primary/30 hover:border-primary/60 rounded-md flex items-center justify-center gap-1 transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Добавить автомобиль
                    </button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ── Optimization settings ── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Параметры оптимизации</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Toggles */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Временны́е окна</p>
                      <p className="text-xs text-muted-foreground">Строгий контроль времени прибытия</p>
                    </div>
                    <Switch checked={useTimeWindows} onCheckedChange={setUseTimeWindows} />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">Время разгрузки</p>
                      <p className="text-xs text-muted-foreground">Учитывать время нахождения в точке</p>
                    </div>
                    <Switch checked={useUnloadTime} onCheckedChange={setUseUnloadTime} />
                  </div>
                </div>

                {/* Max stops */}
                <div className="space-y-2 pt-1 border-t">
                  <p className="text-sm font-medium">Макс. точек на машину</p>
                  <div className="flex gap-2 flex-wrap">
                    {["", "30", "26", "24"].map(val => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setMaxStopsPerVehicle(val)}
                        className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                          maxStopsPerVehicle === val
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-border hover:bg-muted"
                        }`}
                      >
                        {val === "" ? "Без лимита" : `≤${val}`}
                      </button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>

          </div>{/* end scrollable config */}

          {/* ── BUILD BUTTON — pinned at bottom, always visible ── */}
          <div className="shrink-0 pt-1">
            {selectedStores.size === 0 && (
              <p className="text-xs text-muted-foreground text-center mb-2">
                Выберите магазины слева для построения маршрута
              </p>
            )}
            <Button
              className="w-full h-14 text-base font-semibold shadow-lg shadow-primary/20 rounded-xl"
              size="lg"
              onClick={handleBuild}
              disabled={buildRoute.isPending || selectedStores.size === 0 || vehicles.length === 0}
            >
              {buildRoute.isPending ? (
                <span className="flex items-center gap-3">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Оптимизирую маршруты...
                </span>
              ) : (
                <span className="flex items-center gap-3">
                  <RouteIcon className="w-5 h-5" />
                  Построить маршруты
                  {selectedStores.size > 0 && (
                    <Badge variant="secondary" className="ml-1 text-xs bg-white/20 text-white border-0">
                      {selectedStores.size} точек · {vehicles.length} авт.
                    </Badge>
                  )}
                </span>
              )}
            </Button>
          </div>

        </div>{/* end right panel */}
      </div>{/* end grid */}

      {/* Confirmation dialog: not_found stores will be skipped */}
      <AlertDialog open={showNotFoundConfirm} onOpenChange={setShowNotFoundConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-destructive" />
              Некоторые точки без координат
            </AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const count = Array.from(selectedStores).filter(id => {
                  const s = stores.find(st => st.id === id);
                  return s?.geocode_status === "not_found";
                }).length;
                return `${count} ${count === 1 ? "точка не имеет" : count < 5 ? "точки не имеют" : "точек не имеют"} координат и будут пропущены при построении маршрута. Остальные точки будут обработаны в штатном режиме.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowNotFoundConfirm(false);
                executeBuild();
              }}
            >
              Всё равно построить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
