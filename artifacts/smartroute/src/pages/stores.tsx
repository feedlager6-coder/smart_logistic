import { useState } from "react";
import { useListStores, useCreateStore, useDeleteStore, useGeocodeStore, getListStoresQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Upload, Download, Trash2, MapPin, Loader2, Store } from "lucide-react";
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

  // Import progress state
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);

  const createStore = useCreateStore();
  const deleteStore = useDeleteStore();
  const geocodeStore = useGeocodeStore();

  const handleAddStore = (e: React.FormEvent) => {
    e.preventDefault();
    createStore.mutate(
      {
        data: {
          name,
          address,
          time_window_from: timeFrom,
          time_window_to: timeTo,
          unload_minutes: parseInt(unloadMinutes) || 15,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Магазин добавлен", description: "Магазин успешно добавлен в базу." });
          queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
          setName("");
          setAddress("");
        },
        onError: () => {
          toast({ title: "Ошибка", description: "Не удалось добавить магазин.", variant: "destructive" });
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

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be picked again
    e.target.value = "";

    const formData = new FormData();
    formData.append("file", file);

    setImportLoading(true);
    setImportStatus("Загружаю файл...");

    try {
      setImportStatus("Геокодирую адреса (это займёт ~1 сек на строку)...");
      const res = await fetch("/api/stores/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Import failed");
      }
      const data = await res.json();
      const { imported, failed, total } = data;
      setImportStatus(null);
      toast({
        title: "Импорт завершён",
        description: `Загружено ${imported} из ${total} строк${failed > 0 ? `, ошибок: ${failed}` : ""}.`,
      });
      queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
    } catch (err: any) {
      setImportStatus(null);
      toast({
        title: "Ошибка импорта",
        description: err.message || "Не удалось загрузить файл.",
        variant: "destructive",
      });
    } finally {
      setImportLoading(false);
    }
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
          <form onSubmit={handleAddStore} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
            <div className="space-y-2 md:col-span-2">
              <Label>Название</Label>
              <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="ООО Ромашка" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Адрес</Label>
              <Input required value={address} onChange={(e) => setAddress(e.target.value)} placeholder="г. Москва, ул. Ленина 1" />
            </div>
            <div className="space-y-2">
              <Label>Окно (с — до)</Label>
              <div className="flex gap-2">
                <Input type="time" required value={timeFrom} onChange={(e) => setTimeFrom(e.target.value)} />
                <Input type="time" required value={timeTo} onChange={(e) => setTimeTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Разгрузка (мин)</Label>
              <Input type="number" required min="1" value={unloadMinutes} onChange={(e) => setUnloadMinutes(e.target.value)} />
            </div>
            <Button type="submit" disabled={createStore.isPending} className="md:col-span-6 w-full sm:w-auto sm:ml-auto">
              {createStore.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Добавить
            </Button>
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
                        {store.geocode_status === "found" ? (
                          <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-200">
                            ✅ Найден
                          </Badge>
                        ) : store.geocode_status === "pending" ? (
                          <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600 border-yellow-200">
                            ⏳ Ожидает
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-red-500/10 text-red-600 border-red-200">
                            ❌ Не найден
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {store.time_window_from} — {store.time_window_to}
                      </TableCell>
                      <TableCell className="text-sm">{store.unload_minutes} мин</TableCell>
                      <TableCell className="text-right space-x-1">
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
