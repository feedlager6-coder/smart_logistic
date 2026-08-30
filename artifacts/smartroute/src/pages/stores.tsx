import { useState, useCallback, useEffect, useRef } from "react";
import { useListStores, useCreateStore, useDeleteStore, useGeocodeStore, useUpdateStore, getListStoresQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Search, Plus, Upload, Download, Trash2, MapPin, Loader2, Store, ChevronDown, ChevronUp, ExternalLink, Link, Pencil, AlertCircle, FileDown, CheckSquare, Square, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/hooks/use-toast";
import { ImportMappingDialog } from "@/components/ImportMappingDialog";
import { ImportResultDialog, type ImportResult } from "@/components/ImportResultDialog";
import { Link as WouterLink, useSearch } from "wouter";

export function StoresPage() {
  const { data: storesData, isLoading, refetch: refetchStores } = useListStores();
  const stores = Array.isArray(storesData) ? storesData : [];
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [showNoCoords, setShowNoCoords] = useState(false);

  // ── Prefill from URL — called from orders page "Добавить магазин" or bulk-create ──
  // Supported params: prefill (name), address, yandex_url, time_from, time_to, unload_minutes, city
  const search_str = useSearch();
  const addFormRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const params = new URLSearchParams(search_str);
    const prefill = params.get("prefill");
    if (!prefill) return;

    setName(decodeURIComponent(prefill));

    const address   = params.get("address");
    const yandexUrl = params.get("yandex_url");
    const timeFrom  = params.get("time_from");
    const timeTo    = params.get("time_to");
    const unload    = params.get("unload_minutes");
    const cityParam = params.get("city");

    if (address)   setAddress(decodeURIComponent(address));
    if (yandexUrl) setYandexUrl(decodeURIComponent(yandexUrl));
    if (timeFrom)  setTimeFrom(decodeURIComponent(timeFrom));
    if (timeTo)    setTimeTo(decodeURIComponent(timeTo));
    if (unload)    setUnloadMinutes(decodeURIComponent(unload));
    if (cityParam) setCity(decodeURIComponent(cityParam));

    // Show extra settings panel if any optional fields are prefilled
    if (timeFrom || timeTo || unload) setShowSettings(true);

    // Scroll to the add form after a short delay (DOM needs to render)
    setTimeout(() => {
      addFormRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 200);
  // Run once on mount only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [exportLoading, setExportLoading] = useState(false);
  const [geocodePendingLoading, setGeocodePendingLoading] = useState(false);
  const [geocodePendingCount, setGeocodePendingCount] = useState<number | null>(null);

  // Delete confirmation dialog state
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: number; name: string } | null>(null);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Add form state
  const [name, setName] = useState("");
  const [yandexUrl, setYandexUrl] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [client, setClient] = useState("");
  const [timeFrom, setTimeFrom] = useState("09:00");
  const [timeTo, setTimeTo] = useState("18:00");
  const [unloadMinutes, setUnloadMinutes] = useState("15");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  // Import — mapping dialog state
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);

  // Import progress state
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importProgress, setImportProgress] = useState<{ total: number; processed: number; imported: number; failed: number } | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // Single-store duplicate warning state (manual add)
  const [dupWarning, setDupWarning] = useState<{
    message: string;
    existing: { id: number; name: string; address: string; dist_m: number };
    pendingData: any;
  } | null>(null);

  // Edit modal state
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editYandexUrl, setEditYandexUrl] = useState("");
  const [editCity, setEditCity] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editClient, setEditClient] = useState("");
  const [editTimeFrom, setEditTimeFrom] = useState("09:00");
  const [editTimeTo, setEditTimeTo] = useState("18:00");
  const [editUnload, setEditUnload] = useState("15");
  const [editLatitude, setEditLatitude] = useState("");
  const [editLongitude, setEditLongitude] = useState("");

  const createStore = useCreateStore();
  const deleteStore = useDeleteStore();
  const geocodeStore = useGeocodeStore();
  const updateStore = useUpdateStore();

  const validateForm = (): string | null => {
    if (!name.trim()) return "Введите название магазина";
    if (!yandexUrl.trim() && !address.trim() && (!latitude.trim() || !longitude.trim())) return "Укажите ссылку из Яндекс Карт, адрес или обе координаты";
    if ((latitude.trim() && !longitude.trim()) || (!latitude.trim() && longitude.trim())) return "Укажите одновременно широту и долготу";
    if (latitude.trim() && (Number.isNaN(Number(latitude.replace(",", "."))) || Number(latitude.replace(",", ".")) < -90 || Number(latitude.replace(",", ".")) > 90)) return "Широта должна быть от -90 до 90";
    if (longitude.trim() && (Number.isNaN(Number(longitude.replace(",", "."))) || Number(longitude.replace(",", ".")) < -180 || Number(longitude.replace(",", ".")) > 180)) return "Долгота должна быть от -180 до 180";
    return null;
  };

  const resetForm = () => {
    setName("");
    setYandexUrl("");
    setAddress("");
    setCity("");
    setPhone("");
    setClient("");
    setTimeFrom("09:00");
    setTimeTo("18:00");
    setUnloadMinutes("15");
    setLatitude("");
    setLongitude("");
  };

  const handleAddStore = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateForm();
    if (err) {
      toast({ title: "Ошибка валидации", description: err, variant: "destructive" });
      return;
    }
    const storeData = {
      name: name.trim(),
      yandex_url: yandexUrl.trim() || null,
      address: address.trim() || null,
      city: city.trim() || null,
      phone: phone.trim() || null,
      client: client.trim() || null,
      lat: latitude.trim() ? Number(latitude.replace(",", ".")) : null,
      lon: longitude.trim() ? Number(longitude.replace(",", ".")) : null,
      time_window_from: timeFrom,
      time_window_to: timeTo,
      unload_minutes: parseInt(unloadMinutes) || 15,
    };
    doCreateStore(storeData, false);
  };

  const doCreateStore = (data: any, force: boolean) => {
    if (!force) {
      createStore.mutate(
        { data: data as any },
        {
          onSuccess: () => {
            const source = data.lat != null && data.lon != null ? "из указанных координат" : data.yandex_url ? "из ссылки Яндекс Карт" : "геокодированием адреса";
            toast({ title: "Магазин добавлен", description: `Координаты определены ${source}.` });
            queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
            resetForm();
          },
          onError: (err: any) => {
            const detail = err?.response?.data?.detail || err?.detail;
            if (detail?.type === "duplicate_warning") {
              setDupWarning({ message: detail.message, existing: detail.existing, pendingData: data });
              return;
            }
            toast({ title: "Ошибка", description: err?.message || "Не удалось добавить магазин.", variant: "destructive" });
          },
        }
      );
    } else {
      fetch("/api/stores?force=true", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      })
        .then((res) => {
          if (!res.ok) throw new Error("Ошибка создания магазина");
          return res.json();
        })
        .then(() => {
          toast({ title: "Магазин добавлен" });
          queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
          resetForm();
          setDupWarning(null);
        })
        .catch((err) => {
          toast({ title: "Ошибка", description: err.message, variant: "destructive" });
        });
    }
  };

  const handleDelete = (id: number, name: string) => {
    setDeleteConfirm({ id, name });
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    deleteStore.mutate(
      { id: deleteConfirm.id },
      {
        onSuccess: () => {
          toast({ title: "Магазин удалён" });
          queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
          setDeleteConfirm(null);
        },
        onError: () => {
          toast({ title: "Ошибка удаления", variant: "destructive" });
          setDeleteConfirm(null);
        },
      }
    );
  };

  const handleExportStores = async () => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/stores/export");
      if (!res.ok) throw new Error("Ошибка экспорта");
      const json = await res.json();
      const binaryStr = atob(json.data);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = json.filename ?? "smartroute_stores.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({ title: "Экспорт готов", description: `Выгружено ${json.count} магазинов` });
    } catch {
      toast({ title: "Ошибка экспорта", description: "Попробуйте ещё раз", variant: "destructive" });
    } finally {
      setExportLoading(false);
    }
  };

  const handleGeocodePending = async () => {
    const noCoords = stores.filter(s => s.geocode_status === "not_found" || s.geocode_status === "pending" || !s.lat);
    if (noCoords.length === 0) {
      toast({ title: "Все магазины уже геокодированы" });
      return;
    }
    setGeocodePendingLoading(true);
    setGeocodePendingCount(null);
    try {
      const res = await fetch("/api/stores/geocode-pending", { method: "POST" });
      if (!res.ok) throw new Error("Ошибка");
      const json = await res.json();
      setGeocodePendingCount(json.queued);
      toast({
        title: "Геокодирование запущено в фоне",
        description: `${json.queued} магазинов в очереди. Обновите страницу через несколько минут.`,
      });
    } catch {
      toast({ title: "Ошибка запуска геокодирования", variant: "destructive" });
    } finally {
      setGeocodePendingLoading(false);
    }
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

  const pollImportJob = useCallback((job_id: string) => {
    fetch(`/api/stores/import/progress/${job_id}`)
      .then((r) => r.json())
      .then((prog) => {
        if (prog.total > 0) {
          setImportProgress({ total: prog.total, processed: prog.processed, imported: prog.imported, failed: prog.failed });
          setImportStatus(
            `Обработано ${prog.processed} из ${prog.total}: ✓ ${prog.imported}${prog.failed > 0 ? `, ✗ ${prog.failed}` : ""}`
          );
        }
        if (!prog.done) {
          setTimeout(() => pollImportJob(job_id), 800);
        } else {
          fetch(`/api/stores/import/result/${job_id}`)
            .then((r) => r.json())
            .then((result) => {
              setImportLoading(false);
              setImportStatus(null);
              setImportProgress(null);
              queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
              // Show detailed result dialog (geocoding stats + duplicates)
              setImportResult(result as ImportResult);
              // Auto-trigger background geocoding for any stores that landed without coords
              const notFound = (result as ImportResult)?.geocode_stats?.not_found ?? 0;
              if (notFound > 0) {
                fetch("/api/stores/geocode-pending", { method: "POST" }).catch(() => {});
              }
            })
            .catch(() => { setImportLoading(false); setImportStatus(null); setImportProgress(null); });
        }
      })
      .catch(() => setTimeout(() => pollImportJob(job_id), 1500));
  }, [queryClient]);

  const handleDeleteDuplicates = useCallback(async (ids: number[]) => {
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/stores/${id}`, { method: "DELETE" }).catch(() => {})
      )
    );
    queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
    toast({ title: `Удалено ${ids.length} дублирующих точек` });
  }, [queryClient, toast]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredStores.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredStores.map(s => s.id)));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    try {
      const allIds = Array.from(selectedIds);
      const CHUNK = 1000;
      let totalDeleted = 0;
      for (let i = 0; i < allIds.length; i += CHUNK) {
        const chunk = allIds.slice(i, i + CHUNK);
        const res = await fetch("/api/stores/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || "Ошибка удаления");
        }
        const data = await res.json();
        totalDeleted += data.deleted ?? 0;
      }
      queryClient.invalidateQueries({ queryKey: getListStoresQueryKey() });
      setSelectedIds(new Set());
      toast({ title: `Удалено ${totalDeleted} магазин${totalDeleted < 5 ? (totalDeleted === 1 ? "" : "а") : "ов"}` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Ошибка массового удаления";
      toast({ title: msg, variant: "destructive" });
    } finally {
      setBulkDeleting(false);
      setBulkDeleteConfirm(false);
    }
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    // Show mapping dialog — actual import starts from the dialog
    setPendingImportFile(file);
  };

  const handleImportStarted = useCallback((jobId: string) => {
    setPendingImportFile(null);
    setImportLoading(true);
    setImportStatus("Геокодирую адреса...");
    setImportProgress(null);
    pollImportJob(jobId);
  }, [pollImportJob]);

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
    setEditCity((store as any).city ?? "");
    setEditPhone((store as any).phone ?? "");
    setEditClient((store as any).client ?? "");
    setEditTimeFrom(store.time_window_from);
    setEditTimeTo(store.time_window_to);
    setEditUnload(String(store.unload_minutes));
    setEditLatitude(store.lat != null ? String(store.lat) : "");
    setEditLongitude(store.lon != null ? String(store.lon) : "");
    setEditOpen(true);
  };

  const handleSaveEdit = () => {
    if (!editId) return;
    if (!editName.trim()) {
      toast({ title: "Ошибка", description: "Введите название магазина", variant: "destructive" });
      return;
    }
    const editLat = editLatitude.trim() ? Number(editLatitude.replace(",", ".")) : null;
    const editLon = editLongitude.trim() ? Number(editLongitude.replace(",", ".")) : null;
    if ((editLat === null) !== (editLon === null)) {
      toast({ title: "Ошибка", description: "Укажите одновременно широту и долготу", variant: "destructive" });
      return;
    }
    if (editLat !== null && (Number.isNaN(editLat) || editLat < -90 || editLat > 90)) {
      toast({ title: "Ошибка", description: "Широта должна быть от -90 до 90", variant: "destructive" });
      return;
    }
    if (editLon !== null && (Number.isNaN(editLon) || editLon < -180 || editLon > 180)) {
      toast({ title: "Ошибка", description: "Долгота должна быть от -180 до 180", variant: "destructive" });
      return;
    }
    updateStore.mutate(
      {
        id: editId,
        data: {
          name: editName.trim(),
          address: editAddress.trim() || undefined,
          yandex_url: editYandexUrl.trim() || undefined,
          city: editCity.trim(),
          phone: editPhone.trim(),
          client: editClient.trim(),
          lat: editLat,
          lon: editLon,
          time_window_from: editTimeFrom,
          time_window_to: editTimeTo,
          unload_minutes: parseInt(editUnload) || 15,
        } as any,
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

  const noCoordsCount = stores.filter((s) => s.lat == null || s.lon == null).length;

  const filteredStores = stores.filter((s) => {
    const q = search.toLowerCase();
    const matchesSearch =
      s.name.toLowerCase().includes(q) ||
      (s.address ?? "").toLowerCase().includes(q) ||
      ((s as any).phone ?? "").toLowerCase().includes(q) ||
      ((s as any).client ?? "").toLowerCase().includes(q);
    const matchesCoords = !showNoCoords || s.lat == null || s.lon == null;
    return matchesSearch && matchesCoords;
  });

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
            Шаблон Excel
          </Button>
          {stores.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleExportStores} disabled={exportLoading}>
              {exportLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FileDown className="w-4 h-4 mr-2" />}
              Экспорт магазинов
            </Button>
          )}
          {stores.some(s => s.geocode_status === "not_found" || s.geocode_status === "pending" || !s.lat) && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleGeocodePending}
              disabled={geocodePendingLoading}
              className="text-amber-700 border-amber-300 hover:bg-amber-50"
              title="Геокодировать все магазины без координат"
            >
              {geocodePendingLoading
                ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                : <RefreshCw className="w-4 h-4 mr-2" />}
              Геокодировать без координат
              {geocodePendingCount !== null && ` (${geocodePendingCount})`}
            </Button>
          )}
          <Label htmlFor="import-file" className="cursor-pointer">
            <div className={`flex items-center gap-2 h-9 px-3 rounded-md font-medium text-sm transition-colors border ${importLoading ? "opacity-60 pointer-events-none bg-muted text-muted-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"}`}>
              {importLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4" />
              )}
              Импорт Excel / 1С
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

      {/* ── Onboarding block — shown only when there are no stores at all ── */}
      {!isLoading && stores.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 px-6 py-10 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Store className="w-8 h-8 text-primary" />
            </div>
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Добро пожаловать в SmartRoute</h2>
            <p className="text-muted-foreground mt-1 text-sm max-w-md mx-auto">
              Добавьте точки доставки — система автоматически построит оптимальные маршруты для ваших водителей.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 max-w-xl mx-auto">
            <div className="flex-1 rounded-xl border bg-background px-4 py-4 text-left space-y-1">
              <div className="flex items-center gap-2 font-medium text-sm">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">1</span>
                Импортируйте магазины
              </div>
              <p className="text-xs text-muted-foreground pl-8">Загрузите Excel / 1С или добавьте вручную ниже</p>
            </div>
            <div className="flex-1 rounded-xl border bg-background px-4 py-4 text-left space-y-1">
              <div className="flex items-center gap-2 font-medium text-sm">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">2</span>
                Проверьте адреса
              </div>
              <p className="text-xs text-muted-foreground pl-8">Убедитесь что координаты определены верно</p>
            </div>
            <div className="flex-1 rounded-xl border bg-background px-4 py-4 text-left space-y-1">
              <div className="flex items-center gap-2 font-medium text-sm">
                <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs flex items-center justify-center font-bold">3</span>
                Постройте маршрут
              </div>
              <p className="text-xs text-muted-foreground pl-8">Укажите машины и водителей, запустите оптимизацию</p>
            </div>
          </div>
          <div className="flex items-center justify-center gap-3">
            <Label htmlFor="import-file-onboarding" className="cursor-pointer">
              <div className="flex items-center gap-2 h-10 px-5 rounded-lg font-medium text-sm bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <Upload className="w-4 h-4" />
                Импортировать магазины
              </div>
              <input
                id="import-file-onboarding"
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={handleImport}
              />
            </Label>
            <span className="text-sm text-muted-foreground">или добавьте вручную ниже ↓</span>
          </div>
        </div>
      )}

      {/* Mapping dialog — shown after file selection, before import starts */}
      {pendingImportFile && (
        <ImportMappingDialog
          file={pendingImportFile}
          onClose={() => setPendingImportFile(null)}
          onImportStarted={handleImportStarted}
        />
      )}

      {/* Import result dialog — geocoding stats + duplicates resolution */}
      {importResult && (
        <ImportResultDialog
          result={importResult}
          onClose={() => setImportResult(null)}
          onDeleteDuplicates={handleDeleteDuplicates}
        />
      )}

      {/* Import progress banner */}
      {importStatus && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-sm text-primary space-y-2">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
            <span>{importStatus}</span>
          </div>
          {importProgress && importProgress.total > 0 && (
            <div className="w-full bg-primary/20 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-primary h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.round(importProgress.processed / importProgress.total * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Add store form */}
      <Card ref={addFormRef as any}>
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
                    <Label>Телефон</Label>
                    <Input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+7 928 000-00-00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Клиент</Label>
                    <Input
                      value={client}
                      onChange={(e) => setClient(e.target.value)}
                      placeholder="ООО Каспий-Торг"
                    />
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
                  <div className="space-y-2 md:col-span-2">
                    <Label>Координаты <span className="text-xs font-normal text-muted-foreground">(необязательно, имеют приоритет)</span></Label>
                    <div className="flex gap-2">
                      <Input
                        type="number"
                        step="any"
                        min="-90"
                        max="90"
                        value={latitude}
                        onChange={(e) => setLatitude(e.target.value)}
                        placeholder="Широта, например 42.9849"
                      />
                      <Input
                        type="number"
                        step="any"
                        min="-180"
                        max="180"
                        value={longitude}
                        onChange={(e) => setLongitude(e.target.value)}
                        placeholder="Долгота, например 47.5046"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">Если указаны обе координаты, ссылка и геокодирование адреса не используются.</p>
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
        <CardHeader className="pb-2">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <CardTitle>
                Список магазинов{" "}
                <span className="text-muted-foreground font-normal text-base ml-1">({stores.length})</span>
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground"
                title="Обновить список магазинов"
                onClick={() => refetchStores()}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {selectedIds.size > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="gap-2"
                  onClick={() => setBulkDeleteConfirm(true)}
                  disabled={bulkDeleting}
                >
                  {bulkDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Удалить выбранные ({selectedIds.size})
                </Button>
              )}
              {noCoordsCount > 0 && (
                <button
                  type="button"
                  onClick={() => setShowNoCoords((v) => !v)}
                  className={`flex items-center gap-1.5 h-9 px-3 rounded-md text-sm font-medium border transition-colors ${
                    showNoCoords
                      ? "bg-destructive/10 text-destructive border-destructive/30"
                      : "bg-background text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  <AlertCircle className="w-4 h-4" />
                  Без координат{" "}
                  <span className={`ml-0.5 rounded-full px-1.5 py-0 text-xs font-bold ${showNoCoords ? "bg-destructive text-white" : "bg-muted-foreground/20"}`}>
                    {noCoordsCount}
                  </span>
                </button>
              )}
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  placeholder="Поиск..."
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
            </div>
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
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <button
                        type="button"
                        className="flex items-center justify-center"
                        title={selectedIds.size === filteredStores.length ? "Снять всё" : "Выбрать все"}
                        onClick={toggleSelectAll}
                      >
                        {selectedIds.size === filteredStores.length && filteredStores.length > 0
                          ? <CheckSquare className="w-4 h-4 text-primary" />
                          : <Square className="w-4 h-4 text-muted-foreground" />}
                      </button>
                    </TableHead>
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
                    <TableRow
                      key={store.id}
                      data-selected={selectedIds.has(store.id)}
                      className={selectedIds.has(store.id) ? "bg-primary/5" : undefined}
                    >
                      <TableCell>
                        <button
                          type="button"
                          className="flex items-center justify-center"
                          onClick={() => toggleSelect(store.id)}
                        >
                          {selectedIds.has(store.id)
                            ? <CheckSquare className="w-4 h-4 text-primary" />
                            : <Square className="w-4 h-4 text-muted-foreground" />}
                        </button>
                      </TableCell>
                      <TableCell className="font-medium">{store.name}</TableCell>
                      <TableCell className="text-muted-foreground text-sm max-w-[260px]">
                        <span className="block truncate" title={store.address ?? ""}>{store.address}</span>
                      </TableCell>
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

      {/* Bulk delete confirmation dialog */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={(open) => { if (!open) setBulkDeleteConfirm(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить {selectedIds.size} магазин{selectedIds.size < 5 ? (selectedIds.size === 1 ? "" : "а") : "ов"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Выбранные магазины будут удалены безвозвратно. Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
            >
              {bulkDeleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить магазин?</AlertDialogTitle>
            <AlertDialogDescription>
              Магазин <strong>«{deleteConfirm?.name}»</strong> будет удалён безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Duplicate warning dialog */}
      <Dialog open={!!dupWarning} onOpenChange={(open) => { if (!open) setDupWarning(null); }}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader>
            <DialogTitle>Возможный дубликат</DialogTitle>
            <DialogDescription>
              {dupWarning?.message}
            </DialogDescription>
          </DialogHeader>
          {dupWarning?.existing && (
            <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm space-y-1">
              <div className="font-medium">{dupWarning.existing.name}</div>
              <div className="text-muted-foreground">{dupWarning.existing.address}</div>
              <div className="text-xs text-muted-foreground">Расстояние: {dupWarning.existing.dist_m} м</div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDupWarning(null)}>Отмена</Button>
            <Button
              variant="destructive"
              onClick={() => dupWarning && doCreateStore(dupWarning.pendingData, true)}
            >
              Создать всё равно
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                placeholder="https://yandex.ru/maps/?whatshere[point]=..."
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
                placeholder="ул. Пушкина, 10"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Город</Label>
                <Input value={editCity} onChange={(e) => setEditCity(e.target.value)} placeholder="Название города" />
              </div>
              <div className="space-y-2">
                <Label>Телефон</Label>
                <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+7 928 000-00-00" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Координаты <span className="text-xs font-normal text-muted-foreground">(необязательно, имеют приоритет)</span></Label>
              <div className="flex gap-2">
                <Input type="number" step="any" min="-90" max="90" value={editLatitude} onChange={(e) => setEditLatitude(e.target.value)} placeholder="Широта" />
                <Input type="number" step="any" min="-180" max="180" value={editLongitude} onChange={(e) => setEditLongitude(e.target.value)} placeholder="Долгота" />
              </div>
              <p className="text-xs text-muted-foreground">Укажите обе величины, чтобы сохранить ручное положение точки.</p>
            </div>
            <div className="space-y-2">
              <Label>Клиент</Label>
              <Input value={editClient} onChange={(e) => setEditClient(e.target.value)} placeholder="ООО Каспий-Торг" />
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
