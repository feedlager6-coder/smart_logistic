import { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload, Package, CheckCircle, XCircle, Loader2, Trash2, ArrowRight,
  AlertTriangle, FileSpreadsheet, RotateCcw, Weight, Box, Plus, Wand2,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PreviewRow {
  cells: Record<string, string>;
  matched_store_id: number | null;
  matched_store_name: string | null;
}

interface PreviewResult {
  headers: string[];
  detected_mapping: Record<string, string | null>;
  rows: PreviewRow[];
  total_rows: number;
  matched_stores: number;
  unmatched_stores: number;
  db_stores_count: number;
}

interface OrderRecord {
  id: number;
  store_id: number | null;
  store_name_raw: string;
  store_name_db: string | null;
  store_address: string | null;
  order_number: string;
  weight_kg: number;
  volume_m3: number;
  amount_rub: number;
  notes: string;
  delivery_date: string;
}

interface OrdersResponse {
  delivery_date: string;
  orders: OrderRecord[];
  total_count: number;
  total_weight_kg: number;
  total_volume_m3: number;
  total_amount_rub: number;
}

// Unmatched store data extracted from preview (for bulk create + enhanced prefill)
interface UnmatchedStoreData {
  name: string;
  address: string;
  yandex_url: string;
  time_from: string;
  time_to: string;
  unload_minutes: string;
  city: string;
}

// Fields the user can map columns to
const FIELD_LABELS: Record<string, string> = {
  store_name:     "Название точки *",
  order_number:   "Номер заявки",
  weight_kg:      "Вес (кг)",
  volume_m3:      "Объём (м³)",
  amount_rub:     "Сумма (₽)",
  zone:           "Зона / Водитель",
  address:        "Адрес",
  yandex_url:     "Ссылка Яндекс",
  time_from:      "Время с",
  time_to:        "Время до",
  unload_minutes: "Разгрузка (мин)",
  city:           "Город",
  notes:          "Примечание",
};

const TODAY = new Date().toISOString().slice(0, 10);
const TODAY_AUTOSELECT_KEY = `smartroute_autoselect_${TODAY}`;

function fmt(n: number, digits = 1) {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

// Build an extended prefill URL for stores page (passes as much data as possible)
function buildPrefillUrl(store: UnmatchedStoreData): string {
  const p = new URLSearchParams();
  p.set("prefill", store.name);
  if (store.address)        p.set("address", store.address);
  if (store.yandex_url)     p.set("yandex_url", store.yandex_url);
  if (store.time_from)      p.set("time_from", store.time_from);
  if (store.time_to)        p.set("time_to", store.time_to);
  if (store.unload_minutes) p.set("unload_minutes", store.unload_minutes);
  if (store.city)           p.set("city", store.city);
  return `/stores?${p.toString()}`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function OrdersPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  // State
  const [phase, setPhase] = useState<"idle" | "loading" | "preview" | "saving">("idle");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Unmatched store data extracted at import time (name → extra data from Excel)
  const [pendingUnmatched, setPendingUnmatched] = useState<UnmatchedStoreData[]>([]);
  const [bulkCreating, setBulkCreating] = useState(false);

  // Query: today's saved orders
  const { data: savedOrders, isLoading: ordersLoading } = useQuery<OrdersResponse>({
    queryKey: ["daily_orders", TODAY],
    queryFn: async () => {
      const res = await fetch(`/api/orders?date=${TODAY}`);
      if (!res.ok) throw new Error("Ошибка загрузки заявок");
      return res.json();
    },
  });

  const hasOrders = (savedOrders?.total_count ?? 0) > 0;

  // ── File upload & preview ──────────────────────────────────────────────────

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast({ title: "Неверный формат", description: "Загрузите файл Excel (.xlsx или .xls)", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "Файл слишком большой", description: "Максимум 20 МБ", variant: "destructive" });
      return;
    }

    setPhase("loading");
    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/orders/preview", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Ошибка обработки файла");
      }
      const data: PreviewResult = await res.json();
      setPreview(data);
      setMapping({ ...data.detected_mapping });
      setPhase("preview");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      toast({ title: "Ошибка загрузки", description: msg, variant: "destructive" });
      setPhase("idle");
    }
  }, [toast]);

  // ── Confirm import ─────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!preview) return;
    const nameCol = mapping.store_name;
    if (!nameCol) {
      toast({ title: "Укажите колонку с названием точки", variant: "destructive" });
      return;
    }

    setPhase("saving");

    // Extract unmatched store data BEFORE we clear preview
    // This lets us offer bulk-create and enhanced prefill after import
    const addrCol     = mapping.address;
    const yandexCol   = mapping.yandex_url;
    const timeFromCol = mapping.time_from;
    const timeToCol   = mapping.time_to;
    const unloadCol   = mapping.unload_minutes;
    const cityCol     = mapping.city;

    const unmatchedMap = new Map<string, UnmatchedStoreData>();
    for (const row of preview.rows) {
      if (row.matched_store_id !== null) continue;
      const name = nameCol ? (row.cells[nameCol] ?? "").trim() : "";
      if (!name || unmatchedMap.has(name)) continue;
      unmatchedMap.set(name, {
        name,
        address:        addrCol     ? (row.cells[addrCol] ?? "").trim()     : "",
        yandex_url:     yandexCol   ? (row.cells[yandexCol] ?? "").trim()   : "",
        time_from:      timeFromCol ? (row.cells[timeFromCol] ?? "").trim()  : "",
        time_to:        timeToCol   ? (row.cells[timeToCol] ?? "").trim()    : "",
        unload_minutes: unloadCol   ? (row.cells[unloadCol] ?? "").trim()    : "",
        city:           cityCol     ? (row.cells[cityCol] ?? "").trim()      : "",
      });
    }

    const rows = preview.rows
      .map((row) => {
        const storeName = nameCol ? (row.cells[nameCol] ?? "").trim() : "";
        if (!storeName) return null;
        const getCell = (field: string) => {
          const col = mapping[field];
          return col ? (row.cells[col] ?? "") : "";
        };
        const parseNum = (s: string) =>
          parseFloat(s.replace(",", ".").replace(/\s/g, "").replace(/\u00a0/g, "")) || 0;

        return {
          store_id: row.matched_store_id ?? null,
          store_name_raw: storeName,
          order_number: getCell("order_number"),
          weight_kg: parseNum(getCell("weight_kg")),
          volume_m3: parseNum(getCell("volume_m3")),
          amount_rub: parseNum(getCell("amount_rub")),
          notes: getCell("notes"),
        };
      })
      .filter(Boolean);

    if (rows.length === 0) {
      toast({ title: "Нет данных для импорта", description: "Проверьте маппинг колонок", variant: "destructive" });
      setPhase("preview");
      return;
    }

    try {
      const res = await fetch("/api/orders/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery_date: TODAY, rows, clear_existing: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Ошибка сохранения");
      }
      const result = await res.json();

      // FIX #4: Clear autoselect sessionStorage key so next visit to /route?from=orders
      // triggers a fresh autoselect with newly imported orders.
      sessionStorage.removeItem(TODAY_AUTOSELECT_KEY);

      // Save unmatched data for bulk-create / enhanced prefill in idle view
      setPendingUnmatched(Array.from(unmatchedMap.values()));

      await qc.invalidateQueries({ queryKey: ["daily_orders", TODAY] });
      toast({
        title: "Заявки загружены",
        description: `${result.saved_count} точек · ${fmt(result.total_weight_kg)} кг · ${fmt(result.total_volume_m3, 2)} м³`,
      });
      setPhase("idle");
      setPreview(null);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      toast({ title: "Ошибка импорта", description: msg, variant: "destructive" });
      setPhase("preview");
    }
  };

  // ── Clear orders ───────────────────────────────────────────────────────────

  const handleClear = async () => {
    try {
      const res = await fetch(`/api/orders?date=${TODAY}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await qc.invalidateQueries({ queryKey: ["daily_orders", TODAY] });
      setPendingUnmatched([]);
      toast({ title: "Заявки удалены" });
    } catch {
      toast({ title: "Ошибка при удалении", variant: "destructive" });
    }
  };

  // ── Bulk create unmatched stores ───────────────────────────────────────────

  const handleBulkCreateStores = async () => {
    if (pendingUnmatched.length === 0) return;
    setBulkCreating(true);

    let created = 0;
    let failed = 0;

    for (const store of pendingUnmatched) {
      try {
        const body: Record<string, unknown> = { name: store.name };
        if (store.yandex_url) body.yandex_url = store.yandex_url;
        if (store.address)    body.address    = store.address;
        if (store.city)       body.city       = store.city;
        if (store.time_from)  body.time_window_from = store.time_from;
        if (store.time_to)    body.time_window_to   = store.time_to;
        const unloadInt = parseInt(store.unload_minutes);
        if (!isNaN(unloadInt) && unloadInt > 0) body.unload_minutes = unloadInt;

        const res = await fetch("/api/stores", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          created++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    // Re-match orders with newly created stores
    try {
      await fetch("/api/orders/rematch", { method: "POST" });
    } catch {
      // Non-fatal — orders will show updated on next refresh
    }

    // Invalidate queries so stores list and orders list both refresh
    await qc.invalidateQueries({ queryKey: ["daily_orders", TODAY] });
    await qc.invalidateQueries({ queryKey: ["stores"] });

    // Clear pending unmatched — new stores are now in DB
    setPendingUnmatched([]);
    setBulkCreating(false);

    // Also clear sessionStorage so autoselect fires fresh when user goes to /route
    sessionStorage.removeItem(TODAY_AUTOSELECT_KEY);

    if (failed === 0) {
      toast({
        title: `Создано ${created} магазин${created === 1 ? "" : created < 5 ? "а" : "ов"}`,
        description: "Заявки автоматически сопоставлены с новыми магазинами.",
      });
    } else {
      toast({
        title: `Создано ${created}, ошибок: ${failed}`,
        description: "Часть магазинов не удалось создать. Добавьте их вручную.",
        variant: "destructive",
      });
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Заявки на день</h1>
          <p className="text-muted-foreground">
            Импорт весов и объёмов из Excel (1С, Антор или любой системы) — используется при построении маршрутов
          </p>
        </div>
        {hasOrders && phase === "idle" && (
          <Button asChild className="gap-2 shrink-0">
            <Link href="/route?from=orders">
              <ArrowRight className="w-4 h-4" />
              К маршруту
            </Link>
          </Button>
        )}
      </div>

      {/* ── Summary banner (when orders loaded) ── */}
      {hasOrders && phase === "idle" && savedOrders && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="pt-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-emerald-900">
                    Заявки загружены на {savedOrders.delivery_date}
                  </p>
                  <p className="text-sm text-emerald-700">
                    {savedOrders.total_count} точек ·{" "}
                    {savedOrders.total_weight_kg > 0 && <><Weight className="inline w-3.5 h-3.5 mx-0.5" />{fmt(savedOrders.total_weight_kg)} кг · </>}
                    {savedOrders.total_volume_m3 > 0 && <><Box className="inline w-3.5 h-3.5 mx-0.5" />{fmt(savedOrders.total_volume_m3, 2)} м³ · </>}
                    {savedOrders.total_amount_rub > 0 && <>{fmt(savedOrders.total_amount_rub, 0)} ₽</>}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  Перезагрузить
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-destructive hover:text-destructive"
                  onClick={() => setShowClearConfirm(true)}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Очистить
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Empty state / Upload area ── */}
      {!hasOrders && phase === "idle" && (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-5">
            <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
              <FileSpreadsheet className="w-8 h-8 text-muted-foreground" />
            </div>
            <div className="text-center max-w-sm">
              <h3 className="font-semibold text-lg mb-1">Загрузите файл заявок</h3>
              <p className="text-sm text-muted-foreground">
                Excel-файл из 1С, Антор, Google Sheets или любой другой системы.
                Система автоматически определит колонки и сопоставит с вашими магазинами.
              </p>
            </div>
            <Button size="lg" className="gap-2" onClick={() => fileRef.current?.click()}>
              <Upload className="w-5 h-5" />
              Выбрать файл Excel
            </Button>
            <p className="text-xs text-muted-foreground">Поддерживаются .xlsx и .xls · Макс. 20 МБ</p>
          </CardContent>
        </Card>
      )}

      {/* ── Loading state ── */}
      {phase === "loading" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Анализируем файл...</p>
          </CardContent>
        </Card>
      )}

      {/* ── Preview / Column mapping ── */}
      {phase === "preview" && preview && (
        <div className="space-y-4">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="text-center">
              <CardContent className="pt-4 pb-3">
                <p className="text-2xl font-bold">{preview.total_rows}</p>
                <p className="text-xs text-muted-foreground">строк в файле</p>
              </CardContent>
            </Card>
            <Card className="text-center border-emerald-200">
              <CardContent className="pt-4 pb-3">
                <p className="text-2xl font-bold text-emerald-600">{preview.matched_stores}</p>
                <p className="text-xs text-muted-foreground">точек найдено</p>
              </CardContent>
            </Card>
            <Card className="text-center border-amber-200">
              <CardContent className="pt-4 pb-3">
                <p className="text-2xl font-bold text-amber-600">{preview.unmatched_stores}</p>
                <p className="text-xs text-muted-foreground">не сопоставлено</p>
              </CardContent>
            </Card>
          </div>

          {preview.db_stores_count === 0 && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                В базе нет магазинов — сопоставление невозможно.{" "}
                <Link href="/stores" className="underline font-medium">Добавьте магазины</Link> сначала.
              </AlertDescription>
            </Alert>
          )}

          {preview.unmatched_stores > 0 && preview.db_stores_count > 0 && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                {preview.unmatched_stores} точек не найдены в базе магазинов — они будут сохранены без привязки к магазину и не войдут в маршрут. После импорта можно добавить их массово одной кнопкой.
              </AlertDescription>
            </Alert>
          )}

          {/* Column mapping */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Маппинг колонок</CardTitle>
              <CardDescription>Укажите какой столбец вашего файла соответствует каждому полю. Звёздочкой отмечено обязательное поле.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(FIELD_LABELS).map(([field, label]) => (
                  <div key={field} className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{label}</label>
                    <Select
                      value={mapping[field] ?? "__none__"}
                      onValueChange={(v) => setMapping(m => ({ ...m, [field]: v === "__none__" ? null : v }))}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Не указано" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— не указано —</SelectItem>
                        {preview.headers.map(h => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Preview table — ALL columns with horizontal scroll (FIX #3) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Предпросмотр данных</CardTitle>
              <CardDescription>Первые строки файла · Зелёные строки — точки сопоставлены с базой · Прокрутите вправо для всех колонок</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-72">
                <div className="overflow-x-auto min-w-full">
                  <table className="text-xs whitespace-nowrap">
                    <thead className="sticky top-0 bg-muted/80 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-8">#</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[130px]">Сопоставление</th>
                        {preview.headers.map(h => (
                          <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[110px] max-w-[200px]">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 50).map((row, i) => (
                        <tr key={i} className={`border-b ${row.matched_store_id ? "bg-emerald-50/60" : ""}`}>
                          <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-1.5">
                            {row.matched_store_id ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700">
                                <CheckCircle className="w-3 h-3 shrink-0" />
                                <span className="truncate max-w-[120px]">{row.matched_store_name}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <XCircle className="w-3 h-3 shrink-0" />
                                не найдено
                              </span>
                            )}
                          </td>
                          {preview.headers.map(h => (
                            <td key={h} className="px-3 py-1.5 max-w-[200px] truncate text-muted-foreground">
                              {row.cells[h] ?? ""}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <Button variant="outline" onClick={() => { setPhase("idle"); setPreview(null); }}>
              Отмена
            </Button>
            <Button onClick={handleImport} disabled={!mapping.store_name} className="gap-2">
              <Package className="w-4 h-4" />
              {preview.unmatched_stores > 0
                ? `Загрузить ${preview.total_rows} строк (${preview.matched_stores} сопоставлено, ${preview.unmatched_stores} без привязки)`
                : `Загрузить ${preview.total_rows} заявок`}
            </Button>
          </div>
        </div>
      )}

      {/* ── Saving state ── */}
      {phase === "saving" && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-muted-foreground">Сохраняем заявки...</p>
          </CardContent>
        </Card>
      )}

      {/* ── Saved orders table ── */}
      {hasOrders && phase === "idle" && savedOrders && savedOrders.orders.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Заявки на {savedOrders.delivery_date}</CardTitle>
            <CardDescription>{savedOrders.total_count} точек · Используются автоматически при построении маршрутов на сегодня</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-80">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-muted/80 border-b">
                    <tr>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Точка</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Заявка №</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Вес, кг</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Объём, м³</th>
                      <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Сумма, ₽</th>
                      <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {savedOrders.orders.map(o => (
                      <tr key={o.id} className="border-b hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{o.store_name_db ?? o.store_name_raw}</p>
                          {o.store_name_db && o.store_name_db !== o.store_name_raw && (
                            <p className="text-xs text-muted-foreground">{o.store_name_raw}</p>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">{o.order_number || "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{o.weight_kg > 0 ? fmt(o.weight_kg) : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{o.volume_m3 > 0 ? fmt(o.volume_m3, 2) : "—"}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{o.amount_rub > 0 ? fmt(o.amount_rub, 0) : "—"}</td>
                        <td className="px-4 py-2.5">
                          {o.store_id ? (
                            <Badge variant="outline" className="text-emerald-700 border-emerald-200 bg-emerald-50 text-xs">
                              <CheckCircle className="w-3 h-3 mr-1" />Сопоставлено
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-amber-700 border-amber-200 bg-amber-50 text-xs">
                              <AlertTriangle className="w-3 h-3 mr-1" />Без магазина
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t bg-muted/40">
                    <tr>
                      <td colSpan={2} className="px-4 py-2.5 font-medium text-sm">Итого</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {savedOrders.total_weight_kg > 0 ? fmt(savedOrders.total_weight_kg) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {savedOrders.total_volume_m3 > 0 ? fmt(savedOrders.total_volume_m3, 2) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                        {savedOrders.total_amount_rub > 0 ? fmt(savedOrders.total_amount_rub, 0) : "—"}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* ── Unmatched stores card — with bulk-create + enhanced prefill (FIX #1, #2) ── */}
      {hasOrders && phase === "idle" && savedOrders && (() => {
        // Merge pending data with actual unmatched orders from DB
        const unmatchedOrders = savedOrders.orders.filter(o => !o.store_id);
        if (unmatchedOrders.length === 0) return null;

        // Unique names from DB orders
        const uniqueByName = Array.from(
          new Map(unmatchedOrders.map(o => [o.store_name_raw, o])).values()
        );

        // Build a lookup: name → pending extra data (from Excel, available after fresh import)
        const pendingLookup = new Map(pendingUnmatched.map(p => [p.name, p]));

        return (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardHeader className="pb-2">
              <div className="flex flex-col sm:flex-row sm:items-start gap-3 justify-between">
                <div>
                  <CardTitle className="text-base flex items-center gap-2 text-amber-800">
                    <AlertTriangle className="w-4 h-4" />
                    Несопоставленные точки ({uniqueByName.length})
                  </CardTitle>
                  <CardDescription className="text-amber-700">
                    Эти названия из заявок не найдены в базе магазинов. Добавьте их, чтобы включить в маршрут.
                  </CardDescription>
                </div>

                {/* Bulk create button (FIX #1) — only shown when we have Excel data from this session */}
                {pendingUnmatched.length > 0 && (
                  <Button
                    size="sm"
                    className="gap-2 shrink-0 bg-amber-600 hover:bg-amber-700 text-white"
                    onClick={handleBulkCreateStores}
                    disabled={bulkCreating}
                  >
                    {bulkCreating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Wand2 className="w-3.5 h-3.5" />
                    )}
                    {bulkCreating
                      ? "Создаём магазины..."
                      : `Добавить все ${pendingUnmatched.length} магазин${pendingUnmatched.length === 1 ? "" : pendingUnmatched.length < 5 ? "а" : "ов"}`}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {uniqueByName.map(o => {
                  const extra = pendingLookup.get(o.store_name_raw);
                  // Build enriched store object for prefill (use pending data if available)
                  const storeForPrefill: UnmatchedStoreData = extra ?? {
                    name: o.store_name_raw,
                    address: o.store_address ?? "",
                    yandex_url: "",
                    time_from: "",
                    time_to: "",
                    unload_minutes: "",
                    city: "",
                  };
                  const prefillUrl = buildPrefillUrl(storeForPrefill);

                  return (
                    <div key={o.store_name_raw} className="flex items-center justify-between gap-3 bg-white/70 rounded-md px-3 py-2 border border-amber-100">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{o.store_name_raw}</p>
                        <div className="flex flex-wrap gap-2 mt-0.5">
                          {o.weight_kg > 0 && (
                            <span className="text-xs text-muted-foreground">{fmt(o.weight_kg)} кг · {unmatchedOrders.filter(u => u.store_name_raw === o.store_name_raw).length} заявок</span>
                          )}
                          {extra?.address && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{extra.address}</span>
                          )}
                          {extra?.yandex_url && (
                            <span className="text-xs text-blue-600">со ссылкой Яндекс</span>
                          )}
                        </div>
                      </div>
                      <Button asChild variant="outline" size="sm" className="shrink-0 border-amber-300 hover:bg-amber-100 text-amber-900">
                        <a href={prefillUrl}>
                          <Plus className="w-3.5 h-3.5 mr-1.5" />
                          Добавить
                        </a>
                      </Button>
                    </div>
                  );
                })}
              </div>

              {pendingUnmatched.length === 0 && (
                <p className="text-xs text-amber-700 mt-3">
                  Для автозаполнения формы — загрузите файл заново. Для ручного добавления нажмите «Добавить».
                </p>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Loading saved orders */}
      {ordersLoading && (
        <Card>
          <CardContent className="flex justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Clear confirmation */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить заявки?</AlertDialogTitle>
            <AlertDialogDescription>
              Все заявки на {TODAY} будут удалены. Построенные маршруты не затронуты.
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { setShowClearConfirm(false); handleClear(); }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
