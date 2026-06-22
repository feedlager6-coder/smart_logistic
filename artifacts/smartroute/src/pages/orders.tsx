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
  AlertTriangle, FileSpreadsheet, RotateCcw, Weight, Box, Plus,
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

// Fields the user can map columns to
const FIELD_LABELS: Record<string, string> = {
  store_name: "Название точки *",
  order_number: "Номер заявки",
  weight_kg: "Вес (кг)",
  volume_m3: "Объём (м³)",
  amount_rub: "Сумма (₽)",
  zone: "Зона / Водитель",
  address: "Адрес",
  notes: "Примечание",
};

const TODAY = new Date().toISOString().slice(0, 10);

function fmt(n: number, digits = 1) {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: digits });
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
      toast({ title: "Заявки удалены" });
    } catch {
      toast({ title: "Ошибка при удалении", variant: "destructive" });
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
                {preview.unmatched_stores} точек не найдены в базе магазинов — они будут сохранены без привязки к магазину и не войдут в маршрут. Проверьте, что названия в файле совпадают с названиями в базе.
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

          {/* Preview table */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Предпросмотр данных</CardTitle>
              <CardDescription>Первые строки файла · Зелёные строки — точки сопоставлены с базой</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-72">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/80 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-8">#</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">Сопоставление</th>
                        {preview.headers.slice(0, 6).map(h => (
                          <th key={h} className="text-left px-3 py-2 font-medium text-muted-foreground max-w-[140px]">{h}</th>
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
                          {preview.headers.slice(0, 6).map(h => (
                            <td key={h} className="px-3 py-1.5 max-w-[140px] truncate text-muted-foreground">
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

      {/* ── Unmatched stores card ── */}
      {hasOrders && phase === "idle" && savedOrders && (() => {
        const unmatched = savedOrders.orders.filter(o => !o.store_id);
        if (unmatched.length === 0) return null;
        const unique = Array.from(new Map(unmatched.map(o => [o.store_name_raw, o])).values());
        return (
          <Card className="border-amber-200 bg-amber-50/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2 text-amber-800">
                <AlertTriangle className="w-4 h-4" />
                Несопоставленные точки ({unique.length})
              </CardTitle>
              <CardDescription className="text-amber-700">
                Эти названия из заявок не найдены в базе магазинов. Добавьте их вручную, чтобы включить в маршрут.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {unique.map(o => (
                  <div key={o.store_name_raw} className="flex items-center justify-between gap-3 bg-white/70 rounded-md px-3 py-2 border border-amber-100">
                    <div>
                      <p className="font-medium text-sm">{o.store_name_raw}</p>
                      {o.weight_kg > 0 && (
                        <p className="text-xs text-muted-foreground">{fmt(o.weight_kg)} кг · заявок: {unmatched.filter(u => u.store_name_raw === o.store_name_raw).length}</p>
                      )}
                    </div>
                    <Button asChild variant="outline" size="sm" className="shrink-0 border-amber-300 hover:bg-amber-100 text-amber-900">
                      <a href={`/stores?prefill=${encodeURIComponent(o.store_name_raw)}`}>
                        <Plus className="w-3.5 h-3.5 mr-1.5" />
                        Добавить магазин
                      </a>
                    </Button>
                  </div>
                ))}
              </div>
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
