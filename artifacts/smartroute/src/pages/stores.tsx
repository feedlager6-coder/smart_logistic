import { useState } from "react";
import { useListStores, useCreateStore, useDeleteStore, useGeocodeStore, getListStoresQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, Plus, Upload, Trash2, MapPin, Loader2, AlertCircle, Store } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

export function StoresPage() {
  const { data: stores = [], isLoading } = useListStores();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  
  // Form State
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [timeFrom, setTimeFrom] = useState("09:00");
  const [timeTo, setTimeTo] = useState("18:00");
  const [unloadMinutes, setUnloadMinutes] = useState("15");

  const createStore = useCreateStore();
  const deleteStore = useDeleteStore();
  const geocodeStore = useGeocodeStore();

  const handleAddStore = (e: React.FormEvent) => {
    e.preventDefault();
    createStore.mutate({
      data: {
        name,
        address,
        time_window_from: timeFrom,
        time_window_to: timeTo,
        unload_minutes: parseInt(unloadMinutes) || 15
      }
    }, {
      onSuccess: () => {
        toast({ title: "Магазин добавлен", description: "Магазин успешно добавлен в базу." });
        queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
        setName("");
        setAddress("");
      },
      onError: () => {
        toast({ title: "Ошибка", description: "Не удалось добавить магазин.", variant: "destructive" });
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteStore.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Магазин удален" });
        queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
      }
    });
  };

  const handleGeocode = (id: number) => {
    geocodeStore.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Геокодирование запущено" });
        queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
      }
    });
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      toast({ title: "Импорт начался", description: "Подождите, идет загрузка..." });
      const res = await fetch("/api/stores/import", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) throw new Error("Import failed");
      toast({ title: "Импорт завершен", description: "Магазины успешно загружены." });
      queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
    } catch (err) {
      toast({ title: "Ошибка импорта", description: "Не удалось загрузить файл.", variant: "destructive" });
    }
  };

  const filteredStores = stores.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) || 
    s.address.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Магазины</h1>
          <p className="text-muted-foreground">База точек доставки и их настройки</p>
        </div>
        <div>
          <Label htmlFor="import-file" className="cursor-pointer">
            <div className="flex items-center gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 h-10 px-4 rounded-md font-medium text-sm transition-colors">
              <Upload className="w-4 h-4" />
              Импорт из Excel
            </div>
            <input 
              id="import-file" 
              type="file" 
              accept=".xlsx,.xls,.csv" 
              className="hidden" 
              onChange={handleImport}
            />
          </Label>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Добавить магазин</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddStore} className="grid grid-cols-1 md:grid-cols-6 gap-4 items-end">
            <div className="space-y-2 md:col-span-2">
              <Label>Название</Label>
              <Input required value={name} onChange={e => setName(e.target.value)} placeholder="ООО Ромашка" />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>Адрес</Label>
              <Input required value={address} onChange={e => setAddress(e.target.value)} placeholder="г. Москва, ул. Ленина 1" />
            </div>
            <div className="space-y-2">
              <Label>Окно (с - до)</Label>
              <div className="flex gap-2">
                <Input type="time" required value={timeFrom} onChange={e => setTimeFrom(e.target.value)} />
                <Input type="time" required value={timeTo} onChange={e => setTimeTo(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Разгрузка (мин)</Label>
              <Input type="number" required min="1" value={unloadMinutes} onChange={e => setUnloadMinutes(e.target.value)} />
            </div>
            <Button type="submit" disabled={createStore.isPending} className="md:col-span-6 w-full sm:w-auto sm:ml-auto">
              {createStore.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              Добавить
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle>Список магазинов</CardTitle>
          <div className="relative w-64">
            <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
            <Input 
              placeholder="Поиск..." 
              className="pl-8" 
              value={search}
              onChange={e => setSearch(e.target.value)}
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
              <Store className="w-12 h-12 mx-auto mb-4 text-muted/50" />
              <p>Магазины не найдены</p>
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>Адрес</TableHead>
                    <TableHead>Геокодинг</TableHead>
                    <TableHead>Окно</TableHead>
                    <TableHead>Разгрузка</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredStores.map((store) => (
                    <TableRow key={store.id}>
                      <TableCell className="font-medium">{store.name}</TableCell>
                      <TableCell>{store.address}</TableCell>
                      <TableCell>
                        {store.geocode_status === "found" ? (
                          <Badge variant="default" className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20">✅ Found</Badge>
                        ) : store.geocode_status === "pending" ? (
                          <Badge variant="secondary" className="bg-yellow-500/10 text-yellow-600">⏳ Pending</Badge>
                        ) : (
                          <Badge variant="destructive" className="bg-red-500/10 text-red-600">❌ Not Found</Badge>
                        )}
                      </TableCell>
                      <TableCell>{store.time_window_from} - {store.time_window_to}</TableCell>
                      <TableCell>{store.unload_minutes} мин</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon" onClick={() => handleGeocode(store.id)} disabled={geocodeStore.isPending}>
                          <MapPin className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(store.id)} disabled={deleteStore.isPending}>
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
