import { useState } from "react";
import { useListStores, useCreateStore, useDeleteStore, useGeocodeStore, useImportStores, useUpdateStore, getListStoresQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Search, Plus, Upload, Download, Trash2, MapPin, Loader2, Store, ChevronDown, ChevronUp, ExternalLink, Link, Pencil } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";

export function StoresPage() {
  const { data: storesData, isLoading } = useListStores();
  const stores = Array.isArray(storesData) ? storesData : [];
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  // Add form state
  const [name, setName] = useState("");
  const [yandexUrl, setYandexUrl] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [timeFrom, setTimeFrom] = useState("09:00");
  const [timeTo, setTimeTo] = useState("18:00");
  const [unloadMinutes, setUnloadMinutes] = useState("15");
  const [showSettings, setShowSettings] = useState(false);

  // Import progress state
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editYandexUrl, setEditYandexUrl] = useState("");
  const [editTimeFrom, setEditTimeFrom] = useState("09:00");
  const [editTimeTo, setEditTimeTo] = useState("18:00");
  const [editUnload, setEditUnload] = useState("15");

  const createStore = useCreateStore();
  const deleteStore = useDeleteStore();
  const geocodeStore = useGeocodeStore();
  const importStores = useImportStores();
  const updateStore = useUpdateStore();

  const validateForm = (): string | null => {
    if (!name.trim()) return "Введите название магазина";
    if (!yandexUrl.trim() && !address.trim()) return "Укажите ссылку из Яндекс Карт или адрес";
    return null;
  };

  const resetForm = () => {
    setName("");
    setYandexUrl("");
    setAddress("");
    setCity("");
    setTimeFrom("09:00");
    setTimeTo("18:00");
    setUnloadMinutes("15");
  };

  const handleAddStore = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateForm();
    if (err) {
      toast({ title: "Ошибка валидации", description: err, variant: "destructive" });
      return;
    }

    createStore.mutate(
      {
        data: {
          name: name.trim(),
          yandex_url: yandexUrl.trim() || null,
          address: address.trim() || null,
          city: city.trim() || null,
          time_window_from: timeFrom,
          time_window_to: timeTo,
          unload_minutes: parseInt(unloadMinutes) || 15,
        } as any,
      },
      {
        onSuccess: () => {
          const source = yandexUrl.trim() ? "из ссылки Яндекс Карт" : "геокодированием адреса";
          toast({
            title: "Магазин добавлен",
            description: `Координаты определены ${source}.`,
          });
          queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
          resetForm();
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

  const handleDelete = (id: number, name: string) => {
    if (!window.confirm(`Удалить магазин «${name}»? Это действие нельзя отменить.`)) return;
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

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch("/api/stores/template");
      if (!response.ok) throw new Error("Ошибка загрузки");
      const json = await response.json();
      const binaryStr = atob(json.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = json.filename ?? "smartroute_template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Ошибка скачивания шаблона:", error);
      toast({ title: "Ошибка", description: "Не удалось скачать шаблон", variant: "destructive" });
    }
  };

  const handleOpenEdit = (store: typeof stores[0]) => {
    setEditId(store.id);
    setEditName(store.name);
    setEditAddress(store.address ?? "");
    setEditYandexUrl(store.map_url ?? "");
    setEditTimeFrom(store.time_window_from);
    setEditTimeTo(store.time_window_to);
    setEditUnload(String(store.unload_minutes));
    setEditOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editId) return;
    if (!editName.trim()) {
      toast({ title: "Ошибка", description: "Введите название магазина", variant: "destructive" });
      return;
    }
    updateStore.mutate(
      {
        id: editId,
        data: {
          name: editName.trim(),
          address: editAddress.trim() || undefined,
          yandex_url: editYandexUrl.trim() || undefined,
          time_window_from: editTimeFrom,
          time_window_to: editTimeTo,
          unload_minutes: parseInt(editUnload) || 15,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Магазин обновлён" });
          queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
          setEditOpen(false);
        },
        onError: () => {
          toast({ title: "Ошибка", description: "Не удалось обновить магазин", variant: "destructive" });
        },
      }
    );
  };

  const filteredStores = stores.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      (s.address ?? "").toLowerCase().includes(search.toLowerCase())
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

            {/* Name */}
            <div className="space-y-2">
              <Label>Название <span className="text-destructive">*</span></Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Магазин Пятёрочка"
                className="max-w-sm"
              />
            </div>

            {/* Yandex URL */}
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Link className="w-4 h-4 text-primary" />
                Ссылка из Яндекс Карт
                <span className="text-xs font-normal text-primary bg-primary/10 px-2 py-0.5 rounded-full">рекомендуется</span>
              </Label>
              <Input
                value={yandexUrl}
                onChange={(e) => setYandexUrl(e.target.value)}
                placeholder="https://yandex.ru/maps/?whatshere[point]=37.617,55.755"
                type="url"
              />
              <p className="text-xs text-muted-foreground">
                Откройте Яндекс Карты → зажмите нужное место → нажмите <b>Поделиться</b> → скопируйте ссылку
              </p>
            </div>

            {/* Address */}
            <div className="space-y-2">
              <Label>
                Адрес
                {!yandexUrl.trim() && <span className="text-destructive"> *</span>}
                {yandexUrl.trim() && <span className="text-xs font-normal text-muted-foreground ml-2">(необязательно, если указана ссылка)</span>}
              </Label>
              <Input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="ул. Ленина 5"
                className="max-w-sm"
              />
            </div>

            {/* Collapsible settings */}
            <div>
              <button
                type="button"
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setShowSettings(!showSettings)}
              >
                {showSettings ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {showSettings ? "Скрыть настройки" : "Настройки (город, окно, разгрузка)"}
              </button>

              {showSettings && (
                <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-lg border border-dashed bg-muted/30">
                  <div className="space-y-2">
                    <Label>Город</Label>
                    <Input
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                      placeholder="Москва"
                    />
                    <p className="text-xs text-muted-foreground">Добавляется к адресу при геокодинге</p>
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
                  <div className="space-y-2">
                    <Label>Временное окно (с — до)</Label>
                    <div className="flex gap-2">
                      <Input type="time" value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
                      <Input type="time" value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={createStore.isPending}>
                {createStore.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Добавить магазин
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
                          title="Редактировать"
                          onClick={() => handleOpenEdit(store)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
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
                          onClick={() => handleDelete(store.id, store.name)}
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

      {/* Edit store dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Редактировать магазин</DialogTitle>
            <DialogDescription>
              Измените данные магазина. Ссылка Яндекс Карт или адрес используются для геолокации.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Название <span className="text-destructive">*</span></Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Магазин Пятёрочка"
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Link className="w-4 h-4 text-primary" />
                Ссылка из Яндекс Карт
                <span className="text-xs font-normal text-primary bg-primary/10 px-2 py-0.5 rounded-full">рекомендуется</span>
              </Label>
              <Input
                value={editYandexUrl}
                onChange={(e) => setEditYandexUrl(e.target.value)}
                placeholder="https://yandex.ru/maps/?whatshere[point]=47.5,42.98"
                type="url"
              />
              <p className="text-xs text-muted-foreground">
                Если изменена — координаты обновятся автоматически
              </p>
            </div>
            <div className="space-y-2">
              <Label>Адрес (для геокодинга, если нет ссылки)</Label>
              <Input
                value={editAddress}
                onChange={(e) => setEditAddress(e.target.value)}
                placeholder="Махачкала, ул. Ленина 5"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Временное окно (с)</Label>
                <Input type="time" value={editTimeFrom} onChange={(e) => setEditTimeFrom(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Временное окно (до)</Label>
                <Input type="time" value={editTimeTo} onChange={(e) => setEditTimeTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Разгрузка (мин)</Label>
              <Input
                type="number"
                min="1"
                value={editUnload}
                onChange={(e) => setEditUnload(e.target.value)}
                className="max-w-[120px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Отмена</Button>
            <Button onClick={handleSaveEdit} disabled={updateStore.isPending}>
              {updateStore.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
