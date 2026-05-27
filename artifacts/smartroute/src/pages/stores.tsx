import { useState } from "react";
import { useListStores, useCreateStore, useDeleteStore, useGeocodeStore, useImportStores, getListStoresQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, Upload, Download, Trash2, MapPin, Loader2, Store, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";

export function StoresPage() {
  const { data: storesData, isLoading } = useListStores();
  const stores = Array.isArray(storesData) ? storesData : [];
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timeFrom, setTimeFrom] = useState("09:00");
  const [timeTo, setTimeTo] = useState("18:00");
  const [unloadMinutes, setUnloadMinutes] = useState("15");
  const [lat, setLat] = useState("");
  const [lon, setLon] = useState("");
  const [mapUrl, setMapUrl] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Import progress state
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  const createStore = useCreateStore();
  const deleteStore = useDeleteStore();
  const geocodeStore = useGeocodeStore();
  const importStores = useImportStores();

  const validateForm = (): string | null => {
    if (!name.trim()) return "Введите название магазина";
    if (!address.trim()) return "Введите адрес магазина";
    if (lat && (isNaN(Number(lat)) || Number(lat) < -90 || Number(lat) > 90))
      return "Широта должна быть числом от -90 до 90";
    if (lon && (isNaN(Number(lon)) || Number(lon) < -180 || Number(lon) > 180))
      return "Долгота должна быть числом от -180 до 180";
    if (lat && !lon) return "Укажите долготу вместе с широтой";
    if (!lat && lon) return "Укажите широту вместе с долготой";
    const unload = parseInt(unloadMinutes);
    if (isNaN(unload) || unload < 1) return "Время разгрузки должно быть положительным числом";
    return null;
  };

  const handleAddStore = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateForm();
    if (err) {
      toast({ title: "Ошибка валидации", description: err, variant: "destructive" });
      return;
    }

    const parsedLat = lat ? Number(lat) : undefined;
    const parsedLon = lon ? Number(lon) : undefined;

    createStore.mutate(
      {
        data: {
          name: name.trim(),
          address: address.trim(),
          lat: parsedLat ?? null,
          lon: parsedLon ?? null,
          map_url: mapUrl.trim() || null,
          time_window_from: timeFrom,
          time_window_to: timeTo,
          unload_minutes: parseInt(unloadMinutes) || 15,
        },
      },
      {
        onSuccess: () => {
          const usedCoords = parsedLat && parsedLon;
          toast({
            title: "Магазин добавлен",
            description: usedCoords
              ? "Магазин добавлен с указанными координатами."
              : "Магазин добавлен. Геокодирование выполнено автоматически.",
          });
          queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
          setName("");
          setAddress("");
          setLat("");
          setLon("");
          setMapUrl("");
        },
        onError: (err: any) => {
          toast({
            title: "Ошибка",
            description: err?.message || "Не удалось добавить магазин.",
            variant: "destructive",
          });
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    deleteStore.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Магазин удален" });
          queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
        },
      }
    );
  };

  const handleGeocode = (id: number) => {
    geocodeStore.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Геокодирование выполнено" });
          queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
        },
        onError: () => {
          toast({ title: "Ошибка геокодинга", variant: "destructive" });
        },
      }
    );
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setImportLoading(true);
    setImportStatus("Геокодирую адреса (это займёт ~1 сек на строку без API-ключа)...");

    importStores.mutate(
      { data: { file } },
      {
        onSuccess: (data) => {
          const { imported, failed, total } = data;
          setImportStatus(null);
          toast({
            title: "Импорт завершён",
            description: `Загружено ${imported} из ${total} строк${failed > 0 ? `, ошибок: ${failed}` : ""}.`,
          });
          queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
        },
        onError: (err: any) => {
          setImportStatus(null);
          toast({
            title: "Ошибка импорта",
            description: err?.message || "Не удалось загрузить файл.",
            variant: "destructive",
          });
        },
        onSettled: () => {
          setImportLoading(false);
        },
      }
    );
  };

  const handleDownloadTemplate = () => {
    window.open("/api/stores/template", "_blank");
  };

  const filteredStores = stores.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.address.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Магазины</h1>
          <p className="text-muted-foreground">База точек доставки и их настройки</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
            <Download className="w-4 h-4 mr-2" />
            Скачать шаблон
          </Button>
          <Label htmlFor="import-file" className="cursor-pointer">
            <div className={`flex items-center gap-2 h-9 px-3 rounded-md font-medium text-sm transition-colors border ${importLoading ? "opacity-60 pointer-events-none bg-muted text-muted-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
              {importLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Импорт из Excel
            </div>
            <input
              id="import-file"
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleImport}
              disabled={importLoading}
            />
          </Label>
        </div>
      </div>

      {/* Import progress banner */}
      {importStatus && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          {importStatus}
        </div>
      )}

      {/* Add store form */}
      <Card>
        <CardHeader>
          <CardTitle>Добавить магазин</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddStore} className="space-y-4">
            {/* Main fields */}
            <div className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
              <div className="space-y-2 md:col-span-2">
                <Label>Название <span className="text-destructive">*</span></Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ООО Ромашка"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label>Адрес <span className="text-destructive">*</span></Label>
                <Input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="г. Москва, ул. Ленина 1"
                />
              </div>
              <div className="space-y-2">
                <Label>Окно (с — до)</Label>
                <div className="flex gap-2">
                  <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
                  <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Разгрузка (мин)</Label>
                <Input
                  type="number"
                  min="1"
                  value={unloadMinutes}
                  onChange={(e) => setUnloadMinutes(e.target.value)}
                />
              </div>
            </div>

            {/* Advanced: lat/lon/map_url */}
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {showAdvanced ? "Скрыть" : "Точные координаты и ссылка на карту (необязательно)"}
              </button>

              {showAdvanced && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg border border-dashed bg-muted/30">
                  <div className="space-y-2">
                    <Label>Широта</Label>
                    <Input
                      type="number"
                      step="any"
                      min="-90"
                      max="90"
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                      placeholder="55.7558"
                    />
                    <p className="text-xs text-muted-foreground">Если указана — геокодинг не нужен</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Долгота</Label>
                    <Input
                      type="number"
                      step="any"
                      min="-180"
                      max="180"
                      value={lon}
                      onChange={(e) => setLon(e.target.value)}
                      placeholder="37.6173"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Ссылка на карту</Label>
                    <Input
                      type="url"
                      value={mapUrl}
                      onChange={(e) => setMapUrl(e.target.value)}
                      placeholder="https://yandex.ru/maps/..."
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={createStore.isPending}>
                {createStore.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Добавить
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Stores table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>
            Список магазинов{" "}
            <span className="text-muted-foreground font-normal text-base ml-1">({stores.length})</span>
          </CardTitle>
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Поиск..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
          ) : filteredStores.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
              <Store className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="font-medium">Магазины не найдены</p>
              <p className="text-sm mt-1">Добавьте магазин вручную или импортируйте из Excel</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Адрес</TableHead>
                    <TableHead>Геокодинг</TableHead>
                    <TableHead>Координаты</TableHead>
                    <TableHead>Временное окно</TableHead>
                    <TableHead>Разгрузка</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStores.map((store) => (
                    <TableRow key={store.id}>
                      <TableCell className="font-medium">{store.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{store.address}</TableCell>
                      <TableCell>
                        <StatusBadge status={store.geocode_status as "found" | "pending" | "not_found"} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                        {store.lat != null && store.lon != null
                          ? `${store.lat.toFixed(4)}, ${store.lon.toFixed(4)}`
                          : <span className="italic">нет</span>
                        }
                      </TableCell>
                      <TableCell className="text-sm">
                        {store.time_window_from} — {store.time_window_to}
                      </TableCell>
                      <TableCell className="text-sm">{store.unload_minutes} мин</TableCell>
                      <TableCell className="text-right space-x-1">
                        {store.map_url && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Открыть на карте"
                            asChild
                          >
                            <a href={store.map_url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Геокодировать адрес"
                          onClick={() => handleGeocode(store.id)}
                          disabled={geocodeStore.isPending}
                        >
                          <MapPin className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Удалить"
                          className="text-destructive hover:text-destructive"
                          onClick={() => handleDelete(store.id)}
                          disabled={deleteStore.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
