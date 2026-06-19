import { useState, useEffect, useMemo } from "react";
import { useListStores, useBuildRoute } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2, MapPin, Truck, Route as RouteIcon, Plus, X, Copy, Save, AlertCircle, Warehouse, ExternalLink, Link, Filter } from "lucide-react";
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
import { useLocation } from "wouter";

interface Vehicle {
  id: string;
  name: string;
  capacity_kg: string;
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

const DEFAULT_VEHICLE: Vehicle = { id: "1", name: "Газель 1", capacity_kg: "1500", average_speed: "" };

export function RoutePage() {
  const { data: storesData, isLoading } = useListStores();
  const stores = Array.isArray(storesData) ? storesData : [];
  const buildRoute = useBuildRoute();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

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

  // Persist depot to localStorage on change
  useEffect(() => {
    localStorage.setItem(DEPOT_KEY, JSON.stringify({ address: depotAddress, yandexUrl: depotYandexUrl, lat: depotLat, lon: depotLon }));
  }, [depotAddress, depotYandexUrl, depotLat, depotLon]);

  // Unique cities extracted from store addresses (first token before comma)
  const cities = useMemo(() => {
    const citySet = new Set<string>();
    stores.forEach(s => {
      if (s.address) {
        const city = s.address.split(",")[0].trim();
        if (city) citySet.add(city);
      }
    });
    return Array.from(citySet).sort();
  }, [stores]);

  const filteredStores = stores.filter(s => {
    const q = search.toLowerCase();
    const matchesSearch = s.name.toLowerCase().includes(q) || s.address.toLowerCase().includes(q);
    const matchesCity = cityFilter === "all" || (s.address ?? "").split(",")[0].trim() === cityFilter;
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
          capacity_kg: v.capacity_kg ? parseInt(v.capacity_kg) : null,
          average_speed: v.average_speed ? parseFloat(v.average_speed) : null,
        })),
        depot_lat: depotLatNum ?? null,
        depot_lon: depotLonNum ?? null,
        use_time_windows: useTimeWindows,
        use_unload_time: useUnloadTime,
        max_stops_per_vehicle: maxStopsPerVehicle ? parseInt(maxStopsPerVehicle) : null,
        optimize_by: optimizeBy,
      } as any
    }, {
      onSuccess: (result) => {
        if (result.session_id) {
          setLocation(`/result/${result.session_id}`);
        } else {
          localStorage.setItem("smartroute_result", JSON.stringify(result));
          setLocation("/result");
        }
      },
      onError: () => {
        toast({ title: "Ошибка", description: "Не удалось построить маршрут", variant: "destructive" });
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Новый маршрут</h1>
        <p className="text-muted-foreground">Настройка параметров и запуск оптимизации</p>
      </div>

      {/* Depot address */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Warehouse className="w-4 h-4 text-primary" />
            Адрес склада (депо)
          </CardTitle>
          <CardDescription>Откуда начинаются и куда возвращаются все машины. Сохраняется автоматически.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-[260px] space-y-1.5">
              <Label className="text-xs">Адрес</Label>
              <Input
                value={depotAddress}
                onChange={(e) => setDepotAddress(e.target.value)}
                placeholder="Махачкала, ул. Ленина 1 (или оставьте пустым для центра Махачкалы)"
                onKeyDown={(e) => e.key === "Enter" && handleGeocodeDepot()}
              />
            </div>
            <div className="flex-1 min-w-[200px] space-y-1.5">
              <Label className="text-xs flex items-center gap-1.5">
                <Link className="w-3 h-3" />
                Ссылка Яндекс Карт (необязательно)
              </Label>
              <Input
                value={depotYandexUrl}
                onChange={(e) => setDepotYandexUrl(e.target.value)}
                placeholder="https://yandex.ru/maps/..."
                onKeyDown={(e) => e.key === "Enter" && handleGeocodeDepot()}
              />
            </div>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <Button variant="outline" onClick={handleGeocodeDepot} disabled={depotGeocoding} className="shrink-0">
              {depotGeocoding ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <MapPin className="w-4 h-4 mr-2" />}
              Геокодировать
            </Button>
            {depotLat && depotLon && (
              <>
                <div className="text-xs text-muted-foreground font-mono bg-muted px-2 py-1.5 rounded border">
                  {parseFloat(depotLat).toFixed(4)}, {parseFloat(depotLon).toFixed(4)}
                </div>
                {depotYandexNavUrl && (
                  <Button variant="ghost" size="sm" className="text-xs h-7 px-2 gap-1" asChild>
                    <a href={depotYandexNavUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3" />
                      Яндекс Карты
                    </a>
                  </Button>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

        {/* Left Panel: Stores */}
        <Card className="lg:col-span-2 flex flex-col h-[60vh] lg:h-[calc(100vh-200px)]">
          <CardHeader className="pb-4 shrink-0">
            <CardTitle className="flex items-center justify-between">
              Магазины
              <Badge variant="secondary">{selectedStores.size} выбрано</Badge>
            </CardTitle>
            <CardDescription>Выберите точки для доставки</CardDescription>
            <div className="relative mt-2">
              <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                placeholder="Поиск..."
                className="pl-8"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {/* City filter — only shown when stores span multiple cities */}
            {cities.length > 1 && (
              <div className="flex gap-1 flex-wrap mt-2">
                <span className="flex items-center gap-1 text-xs text-muted-foreground mr-1">
                  <Filter className="w-3 h-3" /> Город:
                </span>
                <button
                  onClick={() => setCityFilter("all")}
                  className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${cityFilter === "all" ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
                >
                  Все
                </button>
                {cities.map(city => (
                  <button
                    key={city}
                    onClick={() => setCityFilter(city)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${cityFilter === city ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
                  >
                    {city}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" onClick={handleSelectAll} className="flex-1">Выбрать все</Button>
              <Button variant="outline" size="sm" onClick={handleDeselectAll} className="flex-1">Снять все</Button>
            </div>
          </CardHeader>
          <CardContent className="flex-1 overflow-hidden p-0">
            <ScrollArea className="h-full px-6 pb-4">
              {isLoading ? (
                <div className="flex justify-center p-8"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
              ) : (
                <div className="space-y-2">
                  {filteredStores.map(store => (
                    <label key={store.id} className={`flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors ${store.geocode_status === 'not_found' ? 'border-destructive/40 bg-destructive/5' : ''}`}>
                      <Checkbox
                        checked={selectedStores.has(store.id)}
                        onCheckedChange={() => handleToggleStore(store.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <p className="font-medium text-sm leading-none flex items-center gap-1.5">
                          <span className="truncate">{store.name}</span>
                          {store.geocode_status === 'not_found' && (
                            <span title="Координаты не найдены — точка будет пропущена">
                              <AlertCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 min-w-0">
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="truncate">{store.address}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Окно: {store.time_window_from}-{store.time_window_to} | {store.unload_minutes} мин
                        </p>
                      </div>
                    </label>
                  ))}
                  {filteredStores.length === 0 && (
                    <div className="text-center p-8 text-muted-foreground">Ничего не найдено</div>
                  )}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Right Panel: Tabs — Транспорт / Параметры */}
        <div className="lg:col-span-3 flex flex-col h-[70vh] lg:h-[calc(100vh-200px)]">
          <Tabs defaultValue="vehicles" className="flex flex-col h-full">

            {/* Tab bar */}
            <TabsList className="shrink-0 w-full mb-3">
              <TabsTrigger value="vehicles" className="flex-1">
                <Truck className="w-4 h-4 mr-2" />
                Транспорт
                <Badge variant="secondary" className="ml-2">{vehicles.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="settings" className="flex-1">
                Параметры оптимизации
              </TabsTrigger>
            </TabsList>

            {/* ── Vehicles tab ── */}
            <TabsContent value="vehicles" className="flex-1 overflow-hidden flex flex-col mt-0">
              <Card className="flex-1 flex flex-col overflow-hidden">
                <CardHeader className="shrink-0 pb-2">
                  <div className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>Автомобили</CardTitle>
                      <CardDescription>Название, вместимость и скорость</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={handleSaveFleet} title="Сохранить автопарк как шаблон">
                        <Save className="w-4 h-4 mr-2" />
                        Шаблон
                      </Button>
                      <Button variant="outline" size="sm" onClick={handleAddVehicle}>
                        <Plus className="w-4 h-4 mr-2" /> Добавить
                      </Button>
                    </div>
                  </div>
                  {/* Bulk create */}
                  <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-wrap">
                    <Label className="text-xs text-muted-foreground shrink-0">Создать сразу:</Label>
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={bulkVehicleCount}
                      onChange={e => setBulkVehicleCount(e.target.value)}
                      className="h-8 w-20 text-sm"
                    />
                    <span className="text-xs text-muted-foreground">авт.</span>
                    <Button size="sm" variant="secondary" onClick={handleBulkCreate} className="h-8 text-xs">
                      <Truck className="w-3.5 h-3.5 mr-1.5" />
                      Создать список
                    </Button>
                    <span className="text-xs text-muted-foreground hidden sm:inline">(заменит текущий)</span>
                  </div>
                </CardHeader>
                <CardContent className="flex-1 overflow-hidden p-0">
                  <ScrollArea className="h-full px-6 pb-4">
                    <div className="space-y-3 pt-2">
                      {vehicles.map((vehicle) => (
                        <div key={vehicle.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                            <Truck className="w-4 h-4" />
                          </div>
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="space-y-1.5">
                              <Label className="text-xs">Название / Водитель</Label>
                              <Input
                                value={vehicle.name}
                                onChange={e => handleVehicleChange(vehicle.id, 'name', e.target.value)}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Вместимость (кг)</Label>
                              <Input
                                type="number"
                                value={vehicle.capacity_kg}
                                onChange={e => handleVehicleChange(vehicle.id, 'capacity_kg', e.target.value)}
                                className="h-8 text-sm"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-xs">Скорость (км/ч)</Label>
                              <Input
                                type="number"
                                placeholder="авто"
                                value={vehicle.average_speed}
                                onChange={e => handleVehicleChange(vehicle.id, 'average_speed', e.target.value)}
                                className="h-8 text-sm"
                              />
                            </div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-8 h-8 text-muted-foreground hover:text-primary"
                              title="Дублировать"
                              onClick={() => handleDuplicateVehicle(vehicle.id)}
                            >
                              <Copy className="w-4 h-4" />
                            </Button>
                            {vehicles.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-8 h-8 text-muted-foreground hover:text-destructive"
                                onClick={() => handleRemoveVehicle(vehicle.id)}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>
            </TabsContent>

            {/* ── Settings tab ── */}
            <TabsContent value="settings" className="flex-1 overflow-hidden flex flex-col mt-0">
              <Card className="flex-1 flex flex-col overflow-hidden">
                <CardContent className="flex-1 overflow-auto pt-6">
                  <div className="space-y-6">

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-base">Учитывать временные окна</Label>
                        <p className="text-sm text-muted-foreground">Строгий контроль времени прибытия</p>
                      </div>
                      <Switch checked={useTimeWindows} onCheckedChange={setUseTimeWindows} />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label className="text-base">Учитывать время разгрузки</Label>
                        <p className="text-sm text-muted-foreground">Добавление времени нахождения в точке</p>
                      </div>
                      <Switch checked={useUnloadTime} onCheckedChange={setUseUnloadTime} />
                    </div>

                    {/* Max stops */}
                    <div className="space-y-2">
                      <Label className="text-base">Макс. точек на машину</Label>
                      <p className="text-sm text-muted-foreground">
                        Ограничивает нагрузку на водителя. Рекомендуется 24 при дисбалансе.
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {["", "30", "26", "24"].map(val => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => setMaxStopsPerVehicle(val)}
                            className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-colors ${
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

                  </div>
                </CardContent>
              </Card>
            </TabsContent>

          </Tabs>

          {/* Build button — always visible outside tabs */}
          <Button
            className="w-full h-14 text-lg shadow-lg shadow-primary/20 mt-3 shrink-0"
            size="lg"
            onClick={handleBuild}
            disabled={buildRoute.isPending || selectedStores.size === 0 || vehicles.length === 0}
          >
            {buildRoute.isPending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-3" />
                ⏳ Оптимизирую маршруты...
              </>
            ) : (
              <>
                <RouteIcon className="w-5 h-5 mr-3" />
                🚀 Построить маршруты
              </>
            )}
          </Button>
        </div>

      </div>

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
