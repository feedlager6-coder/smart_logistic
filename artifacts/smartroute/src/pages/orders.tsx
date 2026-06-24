import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Upload, Package, CheckCircle, XCircle, Loader2, Trash2, ArrowRight,
  AlertTriangle, Weight, Box, Plus, Wand2, History, Eye,
  Check, ClipboardList, Banknote, CalendarDays, Download,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useListStores } from "@workspace/api-client-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PreviewRow {
  cells: Record<string, string>;
  matched_store_id: number | null;
  matched_store_name: string | null;
}

// One aggregated delivery point (one per name+address). Multi-row 1C files
// collapse into these on the server.
interface PreviewPoint {
  name: string;
  address: string;
  matched_store_id: number | null;
  matched_store_name: string | null;
  weight_kg: number;
  volume_m3: number;
  amount_rub: number;
  quantity: number;
  products: string;
  order_number: string;
  notes: string;
  city: string;
  yandex_url: string;
  time_from: string;
  time_to: string;
  unload_minutes: string;
  order_lines: number;
}

interface PreviewResult {
  headers: string[];
  detected_mapping: Record<string, string | null>;
  rows: PreviewRow[];
  points: PreviewPoint[];
  total_points: number;
  matched_points: number;
  unmatched_points: number;
  total_rows: number;
  matched_stores: number;
  unmatched_stores: number;
  db_stores_count: number;
}

interface ImportHistoryRecord {
  id: number;
  delivery_date: string;
  filename: string;
  total_rows: number;
  matched_rows: number;
  unmatched_rows: number;
  imported_at: string;
  has_weight: boolean;
  total_weight_kg: number;
  total_volume_m3: number;
  total_amount_rub: number;
}

interface ImportDetailOrder {
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
}

interface ImportDetailResponse {
  record: ImportHistoryRecord;
  orders: ImportDetailOrder[];
  unmatched_stores: { store_name_raw: string; cnt: number; weight_kg: number; volume_m3: number }[];
}

interface OrderRecord {
  id: number;
  store_id: number | null;
  store_name_raw: string;
  address_raw: string;
  store_name_db: string | null;
  store_address: string | null;
  order_number: string;
  weight_kg: number;
  volume_m3: number;
  amount_rub: number;
  quantity: number;
  products: string;
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

// Local editable row buffer (string fields for inputs)
interface EditableRow {
  id: number;
  store_id: number | null;
  store_name_raw: string;
  store_name_db: string | null;
  store_address: string | null;
  order_number: string;
  weight_kg: string;
  volume_m3: string;
  amount_rub: string;
  quantity: number;       // display-only: total units delivered to this point
  products: string;       // display-only: "Молоко×4, Сахар×16"
  notes: string;
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
  address:        "Адрес",
  product:        "Товар",
  quantity:       "Количество",
  order_number:   "Номер заявки",
  weight_kg:      "Вес (кг)",
  volume_m3:      "Объём (м³)",
  amount_rub:     "Сумма (₽)",
  zone:           "Зона / Водитель",
  yandex_url:     "Ссылка Яндекс",
  time_from:      "Время с",
  time_to:        "Время до",
  unload_minutes: "Разгрузка (мин)",
  city:           "Город",
  notes:          "Примечание",
};

// Only the store name is required; everything else is used if present.
const REQUIRED_FIELDS = new Set(["store_name"]);

const TODAY = new Date().toISOString().slice(0, 10);

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

  // Selected delivery date — drives view / import / manual add / clear
  const [date, setDate] = useState<string>(TODAY);
  const AUTOSELECT_KEY = `smartroute_autoselect_${date}`;

  // State
  const [phase, setPhase] = useState<"idle" | "loading" | "preview" | "saving">("idle");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // ── Pending unmatched — persisted to localStorage so it survives tab navigation ──
  const PENDING_KEY = `smartroute_pending_unmatched_${date}`;
  const [pendingUnmatched, setPendingUnmatchedRaw] = useState<UnmatchedStoreData[]>(() => {
    try {
      const raw = localStorage.getItem(`smartroute_pending_unmatched_${TODAY}`);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });
  const setPendingUnmatched = useCallback((val: UnmatchedStoreData[] | ((prev: UnmatchedStoreData[]) => UnmatchedStoreData[])) => {
    setPendingUnmatchedRaw(prev => {
      const next = typeof val === "function" ? val(prev) : val;
      try { localStorage.setItem(PENDING_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, [PENDING_KEY]);

  // ── Bulk create server job ──────────────────────────────────────────────────
  const BULK_JOB_KEY = `smartroute_bulk_job_${date}`;
  const [bulkJobId, setBulkJobIdRaw] = useState<string | null>(() => localStorage.getItem(`smartroute_bulk_job_${TODAY}`));
  const setBulkJobId = (id: string | null) => {
    setBulkJobIdRaw(id);
    if (id) localStorage.setItem(BULK_JOB_KEY, id);
    else localStorage.removeItem(BULK_JOB_KEY);
  };
  const [bulkProgress, setBulkProgress] = useState<{ total: number; created: number; failed: number; done: boolean } | null>(null);
  const [bulkResult, setBulkResult] = useState<{ name: string; address?: string; status: "created" | "failed"; reason?: string; geocode_status?: string }[] | null>(null);
  const [showBulkResult, setShowBulkResult] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentFileRef = useRef<File | null>(null);
  const previewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewSeqRef = useRef(0);
  const [recomputing, setRecomputing] = useState(false);
  // True between a mapping change and a successful recompute. While stale, the
  // displayed preview.points may not reflect the chosen columns, so import is
  // blocked to avoid importing data from an outdated mapping.
  const [previewStale, setPreviewStale] = useState(false);

  const startPolling = useCallback((jobId: string) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    const poll = async () => {
      try {
        const res = await fetch(`/api/stores/bulk-create/progress/${jobId}`);
        if (!res.ok) {
          setBulkJobId(null);
          return;
        }
        const prog = await res.json();
        setBulkProgress({ total: prog.total, created: prog.created, failed: prog.failed, done: prog.done });
        if (!prog.done) {
          pollTimerRef.current = setTimeout(poll, 800);
        } else {
          // Fetch full result
          const rRes = await fetch(`/api/stores/bulk-create/result/${jobId}`);
          if (rRes.ok) {
            const result = await rRes.json();
            setBulkResult(result.results ?? []);
            setShowBulkResult(true);
            // Remove completed stores from pending. Key by (name+address) so
            // two points sharing a name but at different addresses are tracked
            // independently (1С files have many same-name/diff-address points).
            const keyOf = (n: string, a: string) =>
              `${(n ?? "").trim().toLowerCase()}||${(a ?? "").trim().toLowerCase()}`;
            const createdKeys = new Set(
              (result.results ?? [])
                .filter((r: any) => r.status === "created")
                .map((r: any) => keyOf(r.name, r.address ?? ""))
            );
            setPendingUnmatched(prev => prev.filter(p => !createdKeys.has(keyOf(p.name, p.address ?? ""))));
          }
          // Re-run rematch after job completes — MUST await before invalidating cache
          // so daily_orders refetch sees the updated store_id values in DB.
          // Pass the selected date so rematch targets the right delivery day.
          try { await fetch(`/api/orders/rematch?date=${date}`, { method: "POST" }); } catch {}
          await qc.invalidateQueries({ queryKey: ["daily_orders", date] });
          qc.invalidateQueries({ queryKey: ["stores"] });
          setBulkJobId(null);
        }
      } catch {
        pollTimerRef.current = setTimeout(poll, 2000);
      }
    };
    poll();
  }, [qc, setPendingUnmatched, date]);

  // Re-load date-scoped persisted state and resume polling whenever the date changes (also runs on mount)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(`smartroute_pending_unmatched_${date}`);
      setPendingUnmatchedRaw(raw ? JSON.parse(raw) : []);
    } catch { setPendingUnmatchedRaw([]); }
    const job = localStorage.getItem(`smartroute_bulk_job_${date}`);
    setBulkJobIdRaw(job);
    setBulkProgress(null);
    setBulkResult(null);
    setShowBulkResult(false);
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    if (job) startPolling(job);
    return () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Weight warning — null = unknown, true = has weight, false = no weight
  const [hasWeightData, setHasWeightData] = useState<boolean | null>(null);

  // Import history
  const { data: importHistory, refetch: refetchHistory } = useQuery<{ imports: ImportHistoryRecord[] }>({
    queryKey: ["import_history"],
    queryFn: async () => {
      const res = await fetch("/api/orders/import-history");
      if (!res.ok) return { imports: [] };
      return res.json();
    },
  });
  const [deletingHistoryId, setDeletingHistoryId] = useState<number | null>(null);
  const [clearHistoryConfirm, setClearHistoryConfirm] = useState(false);
  const [detailRecordId, setDetailRecordId] = useState<number | null>(null);

  const { data: detailData, isLoading: detailLoading } = useQuery<ImportDetailResponse>({
    queryKey: ["import_detail", detailRecordId],
    queryFn: async () => {
      const res = await fetch(`/api/orders/import-history/${detailRecordId}/details`);
      if (!res.ok) throw new Error("Ошибка загрузки деталей");
      return res.json();
    },
    enabled: detailRecordId !== null,
    staleTime: 60_000,
  });

  // Current file name (for history record)
  const [currentFileName, setCurrentFileName] = useState("");

  // Query: saved orders for the selected date
  const { data: savedOrders, isLoading: ordersLoading } = useQuery<OrdersResponse>({
    queryKey: ["daily_orders", date],
    queryFn: async () => {
      const res = await fetch(`/api/orders?date=${date}`);
      if (!res.ok) throw new Error("Ошибка загрузки заявок");
      return res.json();
    },
  });

  const hasOrders = (savedOrders?.total_count ?? 0) > 0;

  // ── Manual orders builder: store combobox + inline editable rows ─────────────
  const { data: storesData } = useListStores();
  const stores = Array.isArray(storesData) ? storesData : [];

  const [rows, setRows] = useState<EditableRow[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [comboOpen, setComboOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<number>>(new Set());

  const saveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pendingSaves = useRef(0);
  const savedHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync server orders → local editable rows when the order id-set changes
  // (add / delete / date switch / Excel import). In-flight local edits are preserved by id.
  const serverIds = (savedOrders?.orders ?? []).map((o) => o.id).join(",");
  useEffect(() => {
    if (!savedOrders) return;
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      return savedOrders.orders.map((o) => {
        const existing = prevById.get(o.id);
        if (existing) return existing;
        return {
          id: o.id,
          store_id: o.store_id,
          store_name_raw: o.store_name_raw,
          store_name_db: o.store_name_db,
          store_address: o.store_address,
          order_number: o.order_number ?? "",
          weight_kg: o.weight_kg ? String(o.weight_kg) : "",
          volume_m3: o.volume_m3 ? String(o.volume_m3) : "",
          amount_rub: o.amount_rub ? String(o.amount_rub) : "",
          quantity: o.quantity ?? 0,
          products: o.products ?? "",
          notes: o.notes ?? "",
        };
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverIds, date]);

  useEffect(() => {
    return () => {
      Object.values(saveTimers.current).forEach((t) => clearTimeout(t));
      if (savedHideTimer.current) clearTimeout(savedHideTimer.current);
    };
  }, []);

  const totals = useMemo(() => {
    let w = 0, v = 0, a = 0;
    for (const r of rows) {
      w += Math.max(0, parseFloat(r.weight_kg) || 0);
      v += Math.max(0, parseFloat(r.volume_m3) || 0);
      a += Math.max(0, parseFloat(r.amount_rub) || 0);
    }
    return { count: rows.length, weight: w, volume: v, amount: a };
  }, [rows]);

  const addedStoreIds = useMemo(
    () => new Set(rows.map((r) => r.store_id).filter((x): x is number => x !== null)),
    [rows]
  );

  const markSaving = () => { pendingSaves.current += 1; setSaveStatus("saving"); };
  const markSaved = () => {
    pendingSaves.current = Math.max(0, pendingSaves.current - 1);
    if (pendingSaves.current === 0) {
      setSaveStatus("saved");
      if (savedHideTimer.current) clearTimeout(savedHideTimer.current);
      savedHideTimer.current = setTimeout(() => setSaveStatus("idle"), 2000);
    }
  };

  const persistRow = useCallback(async (row: EditableRow) => {
    markSaving();
    try {
      const res = await fetch(`/api/orders/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weight_kg: Math.max(0, parseFloat(row.weight_kg) || 0),
          volume_m3: Math.max(0, parseFloat(row.volume_m3) || 0),
          amount_rub: Math.max(0, parseFloat(row.amount_rub) || 0),
          notes: row.notes,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Не удалось сохранить");
      }
      qc.invalidateQueries({ queryKey: ["daily_orders", date] });
    } catch (e: any) {
      toast({ title: "Ошибка сохранения", description: e.message, variant: "destructive" });
    } finally {
      markSaved();
    }
  }, [date, qc, toast]);

  const scheduleSave = useCallback((row: EditableRow) => {
    if (saveTimers.current[row.id]) clearTimeout(saveTimers.current[row.id]);
    saveTimers.current[row.id] = setTimeout(() => {
      persistRow(row);
      delete saveTimers.current[row.id];
    }, 600);
  }, [persistRow]);

  const updateField = (id: number, field: keyof EditableRow, value: string) => {
    if ((field === "weight_kg" || field === "volume_m3" || field === "amount_rub") && parseFloat(value) < 0) {
      toast({
        title: "Отрицательное значение",
        description: "Вес, объём и сумма не могут быть меньше нуля.",
        variant: "destructive",
      });
      return;
    }
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, [field]: value } : r));
      const changed = next.find((r) => r.id === id);
      if (changed) scheduleSave(changed);
      return next;
    });
  };

  const toggleSelectToAdd = (storeId: number) => {
    setSelectedToAdd((prev) => {
      const next = new Set(prev);
      if (next.has(storeId)) next.delete(storeId);
      else next.add(storeId);
      return next;
    });
  };

  const handleAddSelected = async () => {
    const ids = [...selectedToAdd].filter((id) => !addedStoreIds.has(id));
    if (ids.length === 0) return;
    setAdding(true);
    let created = 0;
    let failed = 0;
    try {
      for (const storeId of ids) {
        try {
          const res = await fetch("/api/orders/manual", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ store_id: storeId, delivery_date: date }),
          });
          if (!res.ok) throw new Error();
          created += 1;
        } catch {
          failed += 1;
        }
      }
      await qc.invalidateQueries({ queryKey: ["daily_orders", date] });
      setSelectedToAdd(new Set());
      setComboOpen(false);
      if (created > 0) {
        toast({
          title: failed === 0 ? "Магазины добавлены" : "Добавлено частично",
          description: failed === 0
            ? `Добавлено магазинов: ${created}`
            : `Добавлено: ${created}, не удалось: ${failed}`,
        });
      } else {
        toast({ title: "Ошибка", description: "Не удалось добавить магазины", variant: "destructive" });
      }
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteRow = async (id: number) => {
    if (saveTimers.current[id]) { clearTimeout(saveTimers.current[id]); delete saveTimers.current[id]; }
    setRows((prev) => prev.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/orders/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) throw new Error("Не удалось удалить");
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      qc.invalidateQueries({ queryKey: ["daily_orders", date] });
    }
  };

  // ── File upload & preview ──────────────────────────────────────────────────

  const handleDownloadTemplate = useCallback(async () => {
    try {
      const response = await fetch("/api/orders/template");
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
      a.download = json.filename ?? "smartroute_orders_template.xlsx";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Ошибка скачивания шаблона:", error);
      toast({ title: "Ошибка", description: "Не удалось скачать шаблон", variant: "destructive" });
    }
  }, [toast]);

  const runPreview = useCallback(async (
    file: File,
    mappingOverride: Record<string, string | null> | null,
    silent: boolean,
  ) => {
    const seq = ++previewSeqRef.current;
    if (silent) {
      setRecomputing(true);
    } else {
      // A fresh full parse (new file) supersedes any pending/in-flight silent
      // recompute. Cancel its debounce and clear its flags so they can't stick
      // (the in-flight silent request is already neutralized by the seq gate).
      if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
      setRecomputing(false);
      setPreviewStale(false);
      setPhase("loading");
    }

    const fd = new FormData();
    fd.append("file", file);
    if (mappingOverride) fd.append("mapping", JSON.stringify(mappingOverride));

    try {
      const res = await fetch("/api/orders/preview", { method: "POST", body: fd });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Ошибка обработки файла");
      }
      const data: PreviewResult = await res.json();
      // Ignore out-of-order responses: only the latest request may apply state.
      if (seq !== previewSeqRef.current) return;
      setPreview(data);
      // On the first parse, adopt the server's auto-detected mapping. On a
      // silent re-run the user's mapping is the source of truth (we already
      // sent it as the override), so we must NOT overwrite their choices.
      if (!silent) setMapping({ ...data.detected_mapping });
      setPreviewStale(false);
      setPhase("preview");
    } catch (e: unknown) {
      if (seq !== previewSeqRef.current) return;
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      toast({ title: "Ошибка загрузки", description: msg, variant: "destructive" });
      // On a silent recompute failure leave previewStale=true so import stays
      // blocked until a successful recompute reflects the chosen columns.
      if (!silent) setPhase("idle");
    } finally {
      if (seq === previewSeqRef.current && silent) setRecomputing(false);
    }
  }, [toast]);

  // Re-run preview (debounced) after the dispatcher corrects a column mapping,
  // so aggregation/matching reflects the chosen columns.
  const schedulePreviewRefresh = useCallback((nextMapping: Record<string, string | null>) => {
    if (!currentFileRef.current) return;
    // Mark the displayed preview as stale right away (covers the debounce
    // window too) so import can't fire against an outdated mapping.
    setPreviewStale(true);
    if (previewDebounceRef.current) clearTimeout(previewDebounceRef.current);
    previewDebounceRef.current = setTimeout(() => {
      if (currentFileRef.current) runPreview(currentFileRef.current, nextMapping, true);
    }, 500);
  }, [runPreview]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    setCurrentFileName(file.name);
    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      toast({ title: "Неверный формат", description: "Загрузите файл Excel (.xlsx или .xls)", variant: "destructive" });
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "Файл слишком большой", description: "Максимум 20 МБ", variant: "destructive" });
      return;
    }

    currentFileRef.current = file;
    await runPreview(file, null, false);
  }, [toast, runPreview]);

  // ── Confirm import ─────────────────────────────────────────────────────────

  const handleImport = async () => {
    if (!preview) return;
    // Block import while the preview is being recomputed for a changed mapping
    // (or that recompute failed) — otherwise we'd import points built from an
    // outdated column mapping.
    if (recomputing || previewStale) {
      toast({ title: "Идёт пересчёт", description: "Подождите, пока точки пересчитаются по выбранным колонкам", variant: "destructive" });
      return;
    }
    const nameCol = mapping.store_name;
    if (!nameCol) {
      toast({ title: "Укажите колонку с названием точки", variant: "destructive" });
      return;
    }

    setPhase("saving");

    // The server has already aggregated the file into delivery points
    // (one per name+address). We import those points directly — one
    // daily_order per point, NOT per Excel row.
    const points = preview.points ?? [];

    // Extract unmatched point data BEFORE we clear preview. Keyed by
    // (name+address) so the same name at two addresses stays two entries.
    const unmatchedMap = new Map<string, UnmatchedStoreData>();
    for (const p of points) {
      if (p.matched_store_id !== null) continue;
      const name = (p.name ?? "").trim();
      if (!name) continue;
      const key = `${name.toLowerCase()}||${(p.address ?? "").trim().toLowerCase()}`;
      if (unmatchedMap.has(key)) continue;
      unmatchedMap.set(key, {
        name,
        address:        (p.address ?? "").trim(),
        yandex_url:     (p.yandex_url ?? "").trim(),
        time_from:      (p.time_from ?? "").trim(),
        time_to:        (p.time_to ?? "").trim(),
        unload_minutes: (p.unload_minutes ?? "").trim(),
        city:           (p.city ?? "").trim(),
      });
    }

    const rows = points
      .map((p) => {
        const storeName = (p.name ?? "").trim();
        if (!storeName) return null;
        return {
          store_id: p.matched_store_id ?? null,
          store_name_raw: storeName,
          address_raw: (p.address ?? "").trim(),
          order_number: p.order_number ?? "",
          weight_kg: p.weight_kg ?? 0,
          volume_m3: p.volume_m3 ?? 0,
          amount_rub: p.amount_rub ?? 0,
          quantity: p.quantity ?? 0,
          products: p.products ?? "",
          notes: p.notes ?? "",
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
        body: JSON.stringify({ delivery_date: date, rows, clear_existing: true, filename: currentFileName }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Ошибка сохранения");
      }
      const result = await res.json();

      // Clear autoselect sessionStorage key so next visit to /route?from=orders
      // triggers a fresh autoselect with newly imported orders.
      sessionStorage.removeItem(AUTOSELECT_KEY);

      // Track whether weight data was present in this import
      setHasWeightData(result.has_weight ?? true);

      // Save unmatched data for bulk-create / enhanced prefill in idle view
      setPendingUnmatched(Array.from(unmatchedMap.values()));

      await qc.invalidateQueries({ queryKey: ["daily_orders", date] });
      await qc.invalidateQueries({ queryKey: ["import_history"] });
      toast({
        title: "Заявки загружены",
        description: `${result.saved_count} точек · ${result.matched_count ?? "?"} сопоставлено · ${result.unmatched_count ?? "?"} нет`,
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
      const res = await fetch(`/api/orders?date=${date}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      await qc.invalidateQueries({ queryKey: ["daily_orders", date] });
      // Also clear pending unmatched and any running bulk job
      setPendingUnmatched([]);
      setBulkJobId(null);
      setBulkProgress(null);
      setBulkResult(null);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      toast({ title: "Заявки удалены" });
    } catch {
      toast({ title: "Ошибка при удалении", variant: "destructive" });
    }
  };

  // ── History delete ──────────────────────────────────────────────────────────

  const handleDeleteHistoryRecord = async (id: number) => {
    setDeletingHistoryId(id);
    try {
      await fetch(`/api/orders/import-history/${id}`, { method: "DELETE" });
      refetchHistory();
    } catch {
      toast({ title: "Ошибка удаления записи", variant: "destructive" });
    } finally {
      setDeletingHistoryId(null);
    }
  };

  const handleClearHistory = async () => {
    try {
      await fetch("/api/orders/import-history", { method: "DELETE" });
      refetchHistory();
      setClearHistoryConfirm(false);
      toast({ title: "История очищена" });
    } catch {
      toast({ title: "Ошибка очистки истории", variant: "destructive" });
    }
  };

  // ── Bulk create unmatched stores (server-side background job) ──────────────

  const handleBulkCreateStores = async () => {
    if (pendingUnmatched.length === 0) return;
    setBulkProgress({ total: pendingUnmatched.length, created: 0, failed: 0, done: false });
    setBulkResult(null);
    setShowBulkResult(false);

    try {
      const res = await fetch("/api/stores/bulk-create/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stores: pendingUnmatched.map(s => ({
            name: s.name,
            address: s.address || null,
            yandex_url: s.yandex_url || null,
            city: s.city || null,
            time_window_from: s.time_from || "09:00",
            time_window_to: s.time_to || "18:00",
            unload_minutes: parseInt(s.unload_minutes) || 15,
          })),
          delivery_date: date,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Ошибка запуска задачи");
      }
      const { job_id } = await res.json();
      setBulkJobId(job_id);
      startPolling(job_id);
      sessionStorage.removeItem(AUTOSELECT_KEY);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      toast({ title: "Ошибка запуска", description: msg, variant: "destructive" });
      setBulkProgress(null);
    }
  };

  const handleRetryFailed = async () => {
    if (!bulkResult) return;
    const failed = bulkResult.filter(r => r.status === "failed");
    if (failed.length === 0) return;
    // Keep only failed stores in pending
    const failedNames = new Set(failed.map(r => r.name));
    const retryStores = pendingUnmatched.filter(p => failedNames.has(p.name));
    if (retryStores.length === 0) return;
    setBulkResult(null);
    setShowBulkResult(false);
    await handleBulkCreateStores();
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Заявки на день</h1>
          <p className="text-muted-foreground">
            Создавайте заявки вручную или импортируйте из Excel (1С, Антор, Google Sheets) — используются при построении маршрутов
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <label className="text-sm text-muted-foreground" htmlFor="order-date">Дата</label>
            <Input
              id="order-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || TODAY)}
              className="w-[160px]"
            />
          </div>
          {hasOrders && phase === "idle" && (
            <Button asChild className="gap-2">
              <Link
                href={`/route?from=orders&date=${date}`}
                onClick={() => sessionStorage.removeItem(AUTOSELECT_KEY)}
              >
                <ArrowRight className="w-4 h-4" />
                К маршруту
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* ── No weight data warning ── */}
      {hasWeightData === false && hasOrders && phase === "idle" && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            <span className="font-semibold">В файле отсутствуют данные о весе.</span>{" "}
            Контроль грузоподъёмности отключён — ограничения по тоннажу не будут учитываться при построении маршрутов.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Daily orders builder (idle phase) ── */}
      {phase === "idle" && (
        <>
          {/* Toolbar: manual add + Excel import + clear + save status */}
          <div className="flex flex-wrap items-center gap-2">
            <Popover
              open={comboOpen}
              onOpenChange={(open) => {
                setComboOpen(open);
                if (!open) setSelectedToAdd(new Set());
              }}
            >
              <PopoverTrigger asChild>
                <Button disabled={adding} className="gap-2">
                  {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Добавить магазины
                </Button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-[420px]" align="start">
                <Command
                  filter={(value, search) =>
                    value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
                  }
                >
                  <CommandInput placeholder="Поиск: название, адрес, город, телефон, клиент…" />
                  <CommandList>
                    <CommandEmpty>Магазины не найдены.</CommandEmpty>
                    <CommandGroup>
                      {stores.map((s) => {
                        const sa = s as any;
                        const already = addedStoreIds.has(s.id);
                        const checked = selectedToAdd.has(s.id);
                        const searchValue = [s.name, s.address, sa.city, sa.phone, sa.client]
                          .filter(Boolean)
                          .join(" ");
                        return (
                          <CommandItem
                            key={s.id}
                            value={searchValue}
                            disabled={already}
                            onSelect={() => toggleSelectToAdd(s.id)}
                            className="flex items-start justify-between gap-2"
                          >
                            <div className="flex items-start gap-2 min-w-0">
                              <span
                                className={`mt-0.5 w-4 h-4 shrink-0 rounded border flex items-center justify-center ${
                                  checked ? "bg-primary border-primary text-primary-foreground" : "border-input"
                                }`}
                              >
                                {checked && <Check className="w-3 h-3" />}
                              </span>
                              <div className="min-w-0">
                                <div className="font-medium truncate">{s.name}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {s.address || "—"}
                                  {sa.phone ? ` · ${sa.phone}` : ""}
                                  {sa.client ? ` · ${sa.client}` : ""}
                                </div>
                              </div>
                            </div>
                            {already && (
                              <Badge variant="secondary" className="shrink-0">уже добавлен</Badge>
                            )}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
                <div className="border-t p-2">
                  <Button
                    className="w-full gap-2"
                    disabled={adding || selectedToAdd.size === 0}
                    onClick={handleAddSelected}
                  >
                    {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    {selectedToAdd.size > 0
                      ? `Добавить выбранное (${selectedToAdd.size})`
                      : "Добавить выбранное"}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>

            <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" />
              Загрузить из Excel
            </Button>

            <Button variant="outline" className="gap-2" onClick={handleDownloadTemplate}>
              <Download className="w-4 h-4" />
              Шаблон Excel
            </Button>

            {hasOrders && (
              <Button
                variant="outline"
                className="gap-2 text-destructive hover:text-destructive"
                onClick={() => setShowClearConfirm(true)}
              >
                <Trash2 className="w-4 h-4" />
                Очистить день
              </Button>
            )}

            <div className="flex-1" />

            <div className="min-w-[110px] text-right text-sm">
              {saveStatus === "saving" && (
                <span className="inline-flex items-center gap-1 text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Сохранение…
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <Check className="w-3.5 h-3.5" /> Сохранено
                </span>
              )}
            </div>
          </div>

          {stores.length === 0 && (
            <Alert>
              <AlertTriangle className="w-4 h-4" />
              <AlertDescription>
                Сначала добавьте магазины в разделе «Магазины» — затем их можно выбрать здесь или сопоставить при импорте из Excel.
              </AlertDescription>
            </Alert>
          )}

          {/* Live totals */}
          {rows.length > 0 && (
            <Card className="border-primary/20">
              <CardContent className="py-3">
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary" />
                    <span className="text-sm text-muted-foreground">Точек:</span>
                    <span className="font-semibold tabular-nums">{totals.count}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Weight className="w-4 h-4 text-amber-600" />
                    <span className="text-sm text-muted-foreground">Вес:</span>
                    <span className="font-semibold tabular-nums">{fmt(totals.weight)} кг</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Box className="w-4 h-4 text-sky-600" />
                    <span className="text-sm text-muted-foreground">Объём:</span>
                    <span className="font-semibold tabular-nums">{fmt(totals.volume, 2)} м³</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Banknote className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm text-muted-foreground">Сумма:</span>
                    <span className="font-semibold tabular-nums">{fmt(totals.amount, 0)} ₽</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Editable table OR empty state */}
          {ordersLoading ? (
            <Card>
              <CardContent className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка заявок…
              </CardContent>
            </Card>
          ) : rows.length === 0 ? (
            <Card className="border-dashed border-2">
              <CardContent className="flex flex-col items-center justify-center py-16 gap-5">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
                  <ClipboardList className="w-8 h-8 text-muted-foreground" />
                </div>
                <div className="text-center max-w-md">
                  <h3 className="font-semibold text-lg mb-1">Заявок на {date} пока нет</h3>
                  <p className="text-sm text-muted-foreground">
                    Добавьте магазины вручную кнопкой «Добавить магазин» или загрузите файл Excel из 1С,
                    Антор, Google Sheets — система сама определит колонки и сопоставит с вашими магазинами.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 justify-center">
                  <Button className="gap-2" onClick={() => setComboOpen(true)}>
                    <Plus className="w-4 h-4" /> Добавить магазин
                  </Button>
                  <Button variant="outline" className="gap-2" onClick={() => fileRef.current?.click()}>
                    <Upload className="w-4 h-4" /> Загрузить из Excel
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">Excel: .xlsx и .xls · Макс. 20 МБ</p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[220px]">Магазин</TableHead>
                        <TableHead className="min-w-[180px]">Товары</TableHead>
                        <TableHead className="w-[130px]">Вес, кг</TableHead>
                        <TableHead className="w-[130px]">Объём, м³</TableHead>
                        <TableHead className="w-[140px]">Сумма, ₽</TableHead>
                        <TableHead className="min-w-[180px]">Комментарий</TableHead>
                        <TableHead className="w-[52px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="align-top">
                            <div className="font-medium">{r.store_name_db || r.store_name_raw}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.order_number ? `№ ${r.order_number}` : ""}
                              {r.order_number && r.store_address ? " · " : ""}
                              {r.store_address || (!r.order_number && r.store_id === null ? "не привязан к магазину" : "")}
                            </div>
                            {r.store_id === null && (
                              <Badge variant="outline" className="mt-1 text-amber-600 border-amber-300">
                                нет магазина
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="align-top">
                            {r.products ? (
                              <div className="text-xs text-muted-foreground whitespace-normal max-w-[220px]">
                                {r.products}
                                {r.quantity > 0 && (
                                  <span className="block text-[11px] text-muted-foreground/70 mt-0.5">всего {fmt(r.quantity, 0)} шт.</span>
                                )}
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground/50">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number" min="0" step="0.1" inputMode="decimal"
                              value={r.weight_kg}
                              onChange={(e) => updateField(r.id, "weight_kg", e.target.value)}
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number" min="0" step="0.01" inputMode="decimal"
                              value={r.volume_m3}
                              onChange={(e) => updateField(r.id, "volume_m3", e.target.value)}
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number" min="0" step="1" inputMode="decimal"
                              value={r.amount_rub}
                              onChange={(e) => updateField(r.id, "amount_rub", e.target.value)}
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.notes}
                              onChange={(e) => updateField(r.id, "notes", e.target.value)}
                              placeholder="—"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost" size="icon"
                              onClick={() => handleDeleteRow(r.id)}
                              className="text-muted-foreground hover:text-destructive"
                              title="Удалить заявку"
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* ── Loading state (file analysis) ── */}
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
          {/* Stats — based on aggregated delivery points (one per name+address) */}
          <div className="grid grid-cols-3 gap-3">
            <Card className="text-center">
              <CardContent className="pt-4 pb-3">
                <p className="text-2xl font-bold">{preview.total_points}</p>
                <p className="text-xs text-muted-foreground">точек доставки</p>
                <p className="text-[10px] text-muted-foreground/70">из {preview.total_rows} строк файла</p>
              </CardContent>
            </Card>
            <Card className="text-center border-emerald-200">
              <CardContent className="pt-4 pb-3">
                <p className="text-2xl font-bold text-emerald-600">{preview.matched_points}</p>
                <p className="text-xs text-muted-foreground">сопоставлено</p>
              </CardContent>
            </Card>
            <Card className="text-center border-amber-200">
              <CardContent className="pt-4 pb-3">
                <p className="text-2xl font-bold text-amber-600">{preview.unmatched_points}</p>
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

          {preview.unmatched_points > 0 && preview.db_stores_count > 0 && (
            <Alert className="border-amber-200 bg-amber-50">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                {preview.unmatched_points} точек не найдены в базе магазинов — они будут сохранены без привязки к магазину и не войдут в маршрут. После импорта можно добавить их массово одной кнопкой.
              </AlertDescription>
            </Alert>
          )}

          {/* Column mapping */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Маппинг колонок
                {recomputing && <span className="text-xs font-normal text-muted-foreground">Пересчёт…</span>}
              </CardTitle>
              <CardDescription>Укажите какой столбец вашего файла соответствует каждому полю. Звёздочкой отмечено обязательное поле.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.entries(FIELD_LABELS).map(([field, label]) => (
                  <div key={field} className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{label}</label>
                    <Select
                      value={mapping[field] ?? "__none__"}
                      onValueChange={(v) => setMapping(m => {
                        const next = { ...m, [field]: v === "__none__" ? null : v };
                        schedulePreviewRefresh(next);
                        return next;
                      })}
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

          {/* Preview table — aggregated delivery points (what will be imported) */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Точки доставки ({preview.total_points})</CardTitle>
              <CardDescription>Строки файла объединены в точки по названию + адресу · Зелёные строки сопоставлены с базой · «Товары» и «Кол-во» — справочно, в расчёт маршрута не идут</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-72">
                <div className="overflow-x-auto min-w-full">
                  <table className="text-xs whitespace-nowrap">
                    <thead className="sticky top-0 bg-muted/80 border-b">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground w-8">#</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[130px]">Сопоставление</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[160px]">Точка</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[160px]">Адрес</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground min-w-[200px]">Товары</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Кол-во</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">Вес, кг</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.points.slice(0, 100).map((p, i) => (
                        <tr key={i} className={`border-b ${p.matched_store_id ? "bg-emerald-50/60" : ""}`}>
                          <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                          <td className="px-3 py-1.5">
                            {p.matched_store_id ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700">
                                <CheckCircle className="w-3 h-3 shrink-0" />
                                <span className="truncate max-w-[120px]">{p.matched_store_name}</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground">
                                <XCircle className="w-3 h-3 shrink-0" />
                                не найдено
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 max-w-[220px] truncate font-medium">{p.name}</td>
                          <td className="px-3 py-1.5 max-w-[220px] truncate text-muted-foreground">{p.address || "—"}</td>
                          <td className="px-3 py-1.5 max-w-[280px] truncate text-muted-foreground">
                            {p.products || "—"}
                            {p.order_lines > 1 && (
                              <span className="ml-1 text-[10px] text-muted-foreground/70">({p.order_lines} строк)</span>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{p.quantity > 0 ? fmt(p.quantity, 0) : "—"}</td>
                          <td className="px-3 py-1.5 text-right text-muted-foreground">{p.weight_kg > 0 ? fmt(p.weight_kg) : "—"}</td>
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
            <Button onClick={handleImport} disabled={!mapping.store_name || recomputing || previewStale} className="gap-2">
              <Package className="w-4 h-4" />
              {preview.unmatched_points > 0
                ? `Загрузить ${preview.total_points} точек (${preview.matched_points} сопоставлено, ${preview.unmatched_points} без привязки)`
                : `Загрузить ${preview.total_points} точек`}
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

      {/* ── Unmatched stores card — bulk-create + enhanced prefill ── */}
      {hasOrders && phase === "idle" && savedOrders && (() => {
        // Merge pending data with actual unmatched orders from DB
        const unmatchedOrders = savedOrders.orders.filter(o => !o.store_id);
        if (unmatchedOrders.length === 0) return null;

        // Unique delivery points from DB orders, keyed by name + address
        // (the same name at two addresses stays two separate points).
        const pointKey = (name: string, addr: string) =>
          `${(name ?? "").trim().toLowerCase()}||${(addr ?? "").trim().toLowerCase()}`;
        const uniqueByName = Array.from(
          new Map(unmatchedOrders.map(o => [pointKey(o.store_name_raw, o.address_raw), o])).values()
        );

        // Build a lookup: (name+address) → pending extra data (from Excel, available after fresh import)
        const pendingLookup = new Map(pendingUnmatched.map(p => [pointKey(p.name, p.address), p]));

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

                {/* Bulk create button / progress */}
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  {/* Running job progress */}
                  {bulkJobId && bulkProgress && !bulkProgress.done && (
                    <div className="flex flex-col items-end gap-1">
                      <p className="text-xs font-medium text-amber-800">
                        Создаётся на сервере... {bulkProgress.created + bulkProgress.failed}/{bulkProgress.total}
                      </p>
                      <div className="h-1.5 w-44 bg-amber-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-600 transition-all"
                          style={{ width: `${Math.round((bulkProgress.created + bulkProgress.failed) / Math.max(bulkProgress.total, 1) * 100)}%` }}
                        />
                      </div>
                      <p className="text-xs text-amber-700">
                        ✓ {bulkProgress.created} создано · {bulkProgress.failed > 0 && <span className="text-red-600">✗ {bulkProgress.failed} ошибок</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">Можно перейти на другую вкладку — процесс продолжится</p>
                    </div>
                  )}
                  {/* Start button — shown when no job running and pending stores exist */}
                  {pendingUnmatched.length > 0 && !bulkJobId && (
                    <Button
                      size="sm"
                      className="gap-2 bg-amber-600 hover:bg-amber-700 text-white"
                      onClick={handleBulkCreateStores}
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Добавить все {pendingUnmatched.length} магазин{pendingUnmatched.length === 1 ? "" : pendingUnmatched.length < 5 ? "а" : "ов"}
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {uniqueByName.map(o => {
                  const extra = pendingLookup.get(pointKey(o.store_name_raw, o.address_raw));
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

                  const displayAddress = o.address_raw || extra?.address || "";
                  return (
                    <div key={pointKey(o.store_name_raw, o.address_raw)} className="flex items-center justify-between gap-3 bg-white/70 rounded-md px-3 py-2 border border-amber-100">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{o.store_name_raw}</p>
                        <div className="flex flex-wrap gap-2 mt-0.5">
                          {o.weight_kg > 0 && (
                            <span className="text-xs text-muted-foreground">{fmt(o.weight_kg)} кг</span>
                          )}
                          {o.quantity > 0 && (
                            <span className="text-xs text-muted-foreground">{fmt(o.quantity, 0)} шт.</span>
                          )}
                          {displayAddress && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{displayAddress}</span>
                          )}
                          {extra?.yandex_url && (
                            <span className="text-xs text-blue-600">со ссылкой Яндекс</span>
                          )}
                        </div>
                        {o.products && (
                          <p className="text-xs text-muted-foreground/80 truncate mt-0.5">{o.products}</p>
                        )}
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

              {pendingUnmatched.length === 0 && !bulkJobId && !bulkResult && (
                <p className="text-xs text-amber-700 mt-3">
                  Для автозаполнения формы — загрузите файл заново. Для ручного добавления нажмите «Добавить».
                </p>
              )}

              {/* Full result report after job completes */}
              {showBulkResult && bulkResult && bulkResult.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {/* Summary row */}
                  <div className="flex items-center gap-3 text-xs font-semibold mb-2">
                    <span className="text-emerald-700">✓ Создано: {bulkResult.filter(r => r.status === "created").length}</span>
                    {bulkResult.some(r => r.status === "failed") && (
                      <span className="text-red-600">✗ Ошибок: {bulkResult.filter(r => r.status === "failed").length}</span>
                    )}
                    <button className="ml-auto text-muted-foreground underline font-normal" onClick={() => setShowBulkResult(false)}>Скрыть</button>
                    {bulkResult.some(r => r.status === "failed") && pendingUnmatched.length > 0 && (
                      <button className="text-amber-700 underline font-normal" onClick={handleRetryFailed}>Повторить ошибочные</button>
                    )}
                  </div>
                  {bulkResult.map((r, i) => (
                    <div key={i} className={`flex items-start gap-2 text-xs rounded px-2 py-1 ${r.status === "created" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}`}>
                      <span className="font-medium shrink-0">{r.status === "created" ? "✓" : "✗"}</span>
                      <span className="font-medium truncate max-w-[160px]">{r.name}</span>
                      {r.status === "created" && r.geocode_status === "not_found" && (
                        <span className="text-amber-600 italic">— без координат</span>
                      )}
                      {r.status === "failed" && r.reason && (
                        <span className="text-red-600 truncate">— {r.reason}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })()}

      {/* Import history */}
      {importHistory && importHistory.imports.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <History className="w-4 h-4 text-muted-foreground" />
                История загрузок ({importHistory.imports.length})
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground gap-1.5 h-7 px-2"
                onClick={() => setClearHistoryConfirm(true)}
              >
                <Trash2 className="w-3 h-3" />
                Очистить всё
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Дата заявок</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Файл</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Строк</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Сопост.</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Без магазина</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Загружено</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {importHistory.imports.map((h) => (
                    <tr key={h.id} className="border-b last:border-0 hover:bg-muted/30 group">
                      <td className="px-4 py-2 font-medium">{h.delivery_date}</td>
                      <td className="px-4 py-2 text-muted-foreground max-w-[160px] truncate" title={h.filename}>{h.filename || "—"}</td>
                      <td className="px-4 py-2 text-right">{h.total_rows}</td>
                      <td className="px-4 py-2 text-right text-green-700">{h.matched_rows}</td>
                      <td className="px-4 py-2 text-right text-amber-600">{h.unmatched_rows}</td>
                      <td className="px-4 py-2 text-right text-muted-foreground">
                        <span className="flex items-center justify-end gap-1.5">
                          {h.has_weight === false && (
                            <span title="Данные о весе отсутствуют" className="text-amber-500">
                              <AlertTriangle className="w-3 h-3 inline" />
                            </span>
                          )}
                          {new Date(h.imported_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-1">
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-primary"
                            title="Детали импорта"
                            onClick={() => setDetailRecordId(h.id)}
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                            title="Удалить запись"
                            onClick={() => handleDeleteHistoryRecord(h.id)}
                            disabled={deletingHistoryId === h.id}
                          >
                            {deletingHistoryId === h.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <Trash2 className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

      {/* Import details dialog */}
      <Dialog open={detailRecordId !== null} onOpenChange={(open) => { if (!open) setDetailRecordId(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Детали импорта</DialogTitle>
            <DialogDescription>
              {detailData?.record && (
                <span>
                  {detailData.record.delivery_date} · {detailData.record.filename || "без имени"}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
          ) : detailData ? (
            <div className="overflow-y-auto flex-1 space-y-4 pr-1">
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-2xl font-bold">{detailData.record.total_rows}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">Заявок</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-2xl font-bold">
                    {detailData.record.total_weight_kg > 0 ? `${fmt(detailData.record.total_weight_kg, 1)} кг` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Общий вес</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-2xl font-bold">
                    {detailData.record.total_volume_m3 > 0 ? `${fmt(detailData.record.total_volume_m3, 2)} м³` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Общий объём</div>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3 text-center">
                  <div className="text-2xl font-bold">
                    {detailData.record.total_amount_rub > 0 ? `${fmt(detailData.record.total_amount_rub, 0)} ₽` : "—"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">Сумма</div>
                </div>
              </div>

              {/* Unmatched stores */}
              {detailData.unmatched_stores.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-amber-600 mb-1.5 flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Несопоставленные магазины ({detailData.unmatched_stores.length})
                  </p>
                  <div className="rounded-md border border-amber-200 bg-amber-50 divide-y divide-amber-100 text-xs max-h-36 overflow-y-auto">
                    {detailData.unmatched_stores.map((u) => (
                      <div key={u.store_name_raw} className="flex items-center justify-between px-3 py-1.5 gap-2">
                        <span className="font-medium text-amber-900 truncate">{u.store_name_raw}</span>
                        <span className="text-amber-700 shrink-0">
                          {u.cnt} зак.
                          {u.weight_kg > 0 && ` · ${fmt(u.weight_kg, 1)} кг`}
                          {u.volume_m3 > 0 && ` · ${fmt(u.volume_m3, 2)} м³`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Orders table */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-1.5">
                  Заявки{detailData.orders.length >= 500 ? " (первые 500)" : ""}
                </p>
                <div className="rounded-md border overflow-hidden">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/40 hover:bg-muted/40">
                          <TableHead className="text-xs h-8 px-3">Магазин</TableHead>
                          <TableHead className="text-xs h-8 px-3">Заявка</TableHead>
                          <TableHead className="text-xs h-8 px-3 text-right">Вес кг</TableHead>
                          <TableHead className="text-xs h-8 px-3 text-right">Объём м³</TableHead>
                          <TableHead className="text-xs h-8 px-3 text-right">Сумма ₽</TableHead>
                          <TableHead className="text-xs h-8 px-3">Статус</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {detailData.orders.map((o) => (
                          <TableRow key={o.id} className="text-xs">
                            <TableCell className="px-3 py-1.5 font-medium max-w-[180px] truncate">
                              {o.store_name_db || o.store_name_raw}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-muted-foreground">{o.order_number || "—"}</TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {o.weight_kg > 0 ? fmt(o.weight_kg, 1) : "—"}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {o.volume_m3 > 0 ? fmt(o.volume_m3, 2) : "—"}
                            </TableCell>
                            <TableCell className="px-3 py-1.5 text-right tabular-nums">
                              {o.amount_rub > 0 ? fmt(o.amount_rub, 0) : "—"}
                            </TableCell>
                            <TableCell className="px-3 py-1.5">
                              {o.store_id
                                ? <span className="text-green-700">✓ Сопост.</span>
                                : <span className="text-amber-600">Не найден</span>
                              }
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Clear history confirmation */}
      <AlertDialog open={clearHistoryConfirm} onOpenChange={setClearHistoryConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистить историю загрузок?</AlertDialogTitle>
            <AlertDialogDescription>
              Все записи истории импортов будут удалены. Сами заявки и маршруты не затрагиваются.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleClearHistory}
            >
              Очистить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear orders confirmation */}
      <AlertDialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить заявки?</AlertDialogTitle>
            <AlertDialogDescription>
              Все заявки на {date} будут удалены. Построенные маршруты не затронуты.
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
