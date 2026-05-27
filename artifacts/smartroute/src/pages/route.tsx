import { useState } from "react";
import { useListStores, useBuildRoute } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Loader2, MapPin, Truck, Route as RouteIcon, Plus, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

interface Vehicle {
  id: string;
  name: string;
  capacity_kg: string;
  average_speed: string;
}

export function RoutePage() {
  const { data: storesData, isLoading } = useListStores();
  const stores = Array.isArray(storesData) ? storesData : [];
  const buildRoute = useBuildRoute();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [search, setSearch] = useState("");
  const [selectedStores, setSelectedStores] = useState<Set<number>>(new Set());
  
  const [vehicles, setVehicles] = useState<Vehicle[]>([{ id: "1", name: "Газель 1", capacity_kg: "1500", average_speed: "" }]);
  const [useTimeWindows, setUseTimeWindows] = useState(true);
  const [useUnloadTime, setUseUnloadTime] = useState(true);

  const filteredStores = stores.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) || 
    s.address.toLowerCase().includes(search.toLowerCase())
  );

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

  const handleRemoveVehicle = (id: string) => {
    setVehicles(vehicles.filter(v => v.id !== id));
  };

  const handleVehicleChange = (id: string, field: keyof Vehicle, value: string) => {
    setVehicles(vehicles.map(v => v.id === id ? { ...v, [field]: value } : v));
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

    buildRoute.mutate({
      data: {
        store_ids: Array.from(selectedStores),
        vehicles: vehicles.map(v => ({
          name: v.name,
          capacity_kg: v.capacity_kg ? parseInt(v.capacity_kg) : null,
          average_speed: v.average_speed ? parseFloat(v.average_speed) : null,
        })),
        use_time_windows: useTimeWindows,
        use_unload_time: useUnloadTime,
      }
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Новый маршрут</h1>
        <p className="text-muted-foreground">Настройка параметров и запуск оптимизации</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        
        {/* Left Panel: Stores */}
        <Card className="lg:col-span-2 flex flex-col h-[calc(100vh-200px)]">
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
            <div className="flex gap-2 mt-4">
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
                    <label key={store.id} className="flex items-start gap-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors">
                      <Checkbox 
                        checked={selectedStores.has(store.id)} 
                        onCheckedChange={() => handleToggleStore(store.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 space-y-1">
                        <p className="font-medium text-sm leading-none">{store.name}</p>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {store.address}
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

        {/* Right Panel: Vehicles & Settings */}
        <div className="lg:col-span-3 space-y-6 flex flex-col h-[calc(100vh-200px)]">
          <Card className="flex-1 flex flex-col overflow-hidden">
            <CardHeader className="shrink-0 flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle>Транспорт</CardTitle>
                <CardDescription>Укажите автомобили для распределения</CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={handleAddVehicle}>
                <Plus className="w-4 h-4 mr-2" /> Добавить
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-hidden p-0">
              <ScrollArea className="h-full px-6 pb-4">
                <div className="space-y-3 pt-2">
                  {vehicles.map((vehicle, i) => (
                    <div key={vehicle.id} className="flex items-center gap-3 p-3 rounded-lg border bg-card relative group">
                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                        <Truck className="w-4 h-4" />
                      </div>
                      <div className="flex-1 grid grid-cols-3 gap-3">
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
                      {vehicles.length > 1 && (
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="w-8 h-8 text-muted-foreground hover:text-destructive shrink-0"
                          onClick={() => handleRemoveVehicle(vehicle.id)}
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          <Card className="shrink-0">
            <CardHeader className="pb-4">
              <CardTitle>Параметры оптимизации</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
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

              <Button 
                className="w-full h-14 text-lg shadow-lg shadow-primary/20" 
                size="lg" 
                onClick={handleBuild}
                disabled={buildRoute.isPending}
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
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}

