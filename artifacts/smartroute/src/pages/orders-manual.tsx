import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Search, Plus, Trash2, ArrowRight, Loader2, Weight, Box,
  CheckCircle, PenLine, Store,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface StoreItem {
  id: number;
  name: string;
  address: string;
  city: string;
}

interface OrderRow {
  id: number;
  store_id: number;
  store_name_raw: string;
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
  orders: OrderRow[];
  total_count: number;
  total_weight_kg: number;
  total_volume_m3: number;
  total_amount_rub: number;
}

const TODAY_AUTOSELECT_KEY = `smartroute_autoselect_${new Date().toISOString().slice(0, 10)}`;

function fmt(n: number, digits = 1) {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

function parseNum(s: string): number {
  const v = parseFloat(s.replace(",", ".").replace(/\s/g, ""));
  return isNaN(v) || v < 0 ? 0 : v;
}

// ── Inline editable cell ──────────────────────────────────────────────────────

function NumericCell({
  value, onSave, placeholder = "0",
}: {
  value: number;
  onSave: (v: number) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(value > 0 ? String(value) : "");
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    setEditing(false);
    const v = parseNum(draft);
    if (v !== value) onSave(v);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="w-full h-7 px-1.5 text-right text-sm tabular-nums border rounded focus:outline-none focus:ring-1 focus:ring-primary bg-white"
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      />
    );
  }

  return (
    <button
      className="w-full h-7 px-1.5 text-right text-sm tabular-nums rounded hover:bg-muted/60 transition-colors group"
      onClick={startEdit}
      title="Нажмите для редактирования"
    >
      {value > 0
        ? <span className="text-foreground">{fmt(value)}</span>
        : <span className="text-muted-foreground/40 group-hover:text-muted-foreground">{placeholder}</span>
      }
    </button>
  );
}

function TextCell({
  value, onSave, placeholder = "",
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraft(value);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  const commit = () => {
    setEditing(false);
    if (draft !== value) onSave(draft.trim());
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="w-full h-7 px-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-primary bg-white"
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      />
    );
  }

  return (
    <button
      className="w-full h-7 px-1.5 text-left text-sm rounded hover:bg-muted/60 transition-colors truncate group"
      onClick={startEdit}
      title={value || "Нажмите для редактирования"}
    >
      {value
        ? <span className="text-foreground">{value}</span>
        : <span className="text-muted-foreground/40 group-hover:text-muted-foreground">{placeholder}</span>
      }
    </button>
  );
}

// ── Store search combobox ─────────────────────────────────────────────────────

function StoreSearch({
  stores,
  usedStoreIds,
  onSelect,
  date,
}: {
  stores: StoreItem[];
  usedStoreIds: Set<number>;
  onSelect: (store: StoreItem) => void;
  date: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  const filtered = useMemo(() => {
    if (!query.trim()) return stores.slice(0, 20);
    const q = query.toLowerCase();
    return stores
      .filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.address?.toLowerCase().includes(q) ||
        s.city?.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [stores, query]);

  const handleSelect = async (store: StoreItem) => {
    if (usedStoreIds.has(store.id)) {
      toast({
        title: "Уже добавлен",
        description: `«${store.name}» уже есть в списке на ${date}`,
        variant: "destructive",
      });
      return;
    }
    setAdding(true);
    setQuery("");
    setOpen(false);
    try {
      const res = await fetch("/api/orders/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ store_id: store.id, delivery_date: date }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Ошибка добавления");
      }
      onSelect(store);
    } catch (e) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : "Не удалось добавить магазин",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        listRef.current && !listRef.current.contains(e.target as Node) &&
        inputRef.current && !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary transition-all">
        {adding
          ? <Loader2 className="w-4 h-4 text-muted-foreground shrink-0 animate-spin" />
          : <Search className="w-4 h-4 text-muted-foreground shrink-0" />
        }
        <input
          ref={inputRef}
          className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
          placeholder="Найти магазин — по названию, адресу, городу…"
          value={query}
          disabled={adding}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === "Escape") { setOpen(false); setQuery(""); }
            if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0]);
          }}
        />
        {query && (
          <button
            className="text-muted-foreground hover:text-foreground"
            onClick={() => { setQuery(""); inputRef.current?.focus(); }}
          >
            ×
          </button>
        )}
      </div>

      {open && filtered.length > 0 && (
        <div
          ref={listRef}
          className="absolute z-50 top-full mt-1 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          {filtered.map(s => {
            const used = usedStoreIds.has(s.id);
            return (
              <button
                key={s.id}
                className={`w-full flex items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/60 transition-colors border-b last:border-b-0 ${used ? "opacity-40 cursor-not-allowed" : ""}`}
                onClick={() => !used && handleSelect(s)}
                disabled={used}
              >
                <Store className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.name}</div>
                  {s.address && <div className="text-xs text-muted-foreground truncate">{s.address}</div>}
                </div>
                {used && <Badge variant="outline" className="ml-auto shrink-0 text-xs">Добавлен</Badge>}
              </button>
            );
          })}
        </div>
      )}

      {open && query.trim() && filtered.length === 0 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-white border rounded-lg shadow-lg px-4 py-3 text-sm text-muted-foreground">
          Магазин не найден.{" "}
          <Link
            href={`/stores?prefill=${encodeURIComponent(query)}`}
            className="text-primary underline"
            onClick={() => setOpen(false)}
          >
            Добавить в базу
          </Link>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function OrdersManual({ defaultDate }: { defaultDate?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(defaultDate ?? today);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();

  const queryKey = ["daily_orders_manual", date];

  const { data, isLoading, refetch } = useQuery<OrdersResponse>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/orders?date=${date}`);
      if (!res.ok) throw new Error("Ошибка загрузки заявок");
      return res.json();
    },
  });

  const { data: storesData } = useQuery<StoreItem[]>({
    queryKey: ["stores_list"],
    queryFn: async () => {
      const res = await fetch("/api/stores");
      if (!res.ok) return [];
      const d = await res.json();
      return Array.isArray(d) ? d : [];
    },
    staleTime: 60_000,
  });

  const stores = storesData ?? [];
  const orders = data?.orders ?? [];
  const usedStoreIds = useMemo(() => new Set(orders.map(o => o.store_id).filter(Boolean) as number[]), [orders]);

  const invalidate = useCallback(async () => {
    await qc.invalidateQueries({ queryKey });
    // Also invalidate the import-tab query so stats update
    await qc.invalidateQueries({ queryKey: ["daily_orders", date] });
  }, [qc, queryKey, date]);

  const handleStoreAdded = useCallback(async () => {
    await invalidate();
  }, [invalidate]);

  const handleUpdate = async (id: number, field: string, value: number | string) => {
    setSavingId(id);
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail ?? "Ошибка сохранения");
      }
      await invalidate();
    } catch (e) {
      toast({
        title: "Ошибка сохранения",
        description: e instanceof Error ? e.message : "Неизвестная ошибка",
        variant: "destructive",
      });
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await fetch(`/api/orders/${id}`, { method: "DELETE" });
      await invalidate();
    } catch {
      toast({ title: "Ошибка удаления", variant: "destructive" });
    } finally {
      setDeleteId(null);
    }
  };

  const hasOrders = (data?.total_count ?? 0) > 0;
  const totalWeight = data?.total_weight_kg ?? 0;
  const totalVolume = data?.total_volume_m3 ?? 0;
  const totalAmount = data?.total_amount_rub ?? 0;

  return (
    <div className="space-y-4">

      {/* ── Date selector + stats ── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">Дата доставки:</label>
          <Input
            type="date"
            className="w-40 h-8 text-sm"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>

        {hasOrders && (
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <Badge variant="outline" className="gap-1 text-sm font-normal">
              <Store className="w-3.5 h-3.5" />
              {data?.total_count} маг.
            </Badge>
            {totalWeight > 0 && (
              <Badge variant="outline" className="gap-1 text-sm font-normal">
                <Weight className="w-3.5 h-3.5" />
                {fmt(totalWeight)} кг
              </Badge>
            )}
            {totalVolume > 0 && (
              <Badge variant="outline" className="gap-1 text-sm font-normal">
                <Box className="w-3.5 h-3.5" />
                {fmt(totalVolume, 2)} м³
              </Badge>
            )}
            {totalAmount > 0 && (
              <Badge variant="outline" className="gap-1 text-sm font-normal">
                {fmt(totalAmount, 0)} ₽
              </Badge>
            )}
            <Button asChild size="sm" className="gap-1.5 h-8 ml-1">
              <Link
                href="/route?from=orders"
                onClick={() => sessionStorage.removeItem(TODAY_AUTOSELECT_KEY)}
              >
                <ArrowRight className="w-3.5 h-3.5" />
                К маршруту
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* ── Store search ── */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Plus className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Добавить магазин</span>
          {stores.length === 0 && (
            <span className="text-xs text-muted-foreground">
              (<Link href="/stores" className="text-primary underline">нет магазинов в базе</Link>)
            </span>
          )}
        </div>
        <StoreSearch
          stores={stores}
          usedStoreIds={usedStoreIds}
          onSelect={handleStoreAdded}
          date={date}
        />
      </div>

      {/* ── Loading ── */}
      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* ── Empty state ── */}
      {!isLoading && !hasOrders && (
        <Card className="border-dashed border-2">
          <CardContent className="flex flex-col items-center justify-center py-12 gap-3 text-center">
            <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <PenLine className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Список пуст</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Найдите магазин в строке поиска выше и добавьте его в список доставки на выбранную дату.
              </p>
            </div>
            {stores.length === 0 && (
              <Button asChild variant="outline" size="sm">
                <Link href="/stores">
                  <Plus className="w-4 h-4 mr-1.5" />
                  Добавить магазины в базу
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Orders table ── */}
      {!isLoading && hasOrders && (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b">
                  <th className="text-left px-3 py-2 font-medium text-muted-foreground w-[35%]">Магазин</th>
                  <th className="text-right px-2 py-2 font-medium text-muted-foreground w-[11%]">Вес, кг</th>
                  <th className="text-right px-2 py-2 font-medium text-muted-foreground w-[11%]">Объём, м³</th>
                  <th className="text-right px-2 py-2 font-medium text-muted-foreground w-[13%]">Сумма, ₽</th>
                  <th className="text-left px-2 py-2 font-medium text-muted-foreground">Комментарий</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, idx) => (
                  <tr
                    key={order.id}
                    className={`border-b last:border-b-0 group transition-colors ${idx % 2 === 0 ? "bg-white" : "bg-muted/10"} ${savingId === order.id ? "opacity-60" : ""}`}
                  >
                    <td className="px-3 py-1.5">
                      <div className="font-medium truncate">{order.store_name_raw}</div>
                      {order.store_address && (
                        <div className="text-xs text-muted-foreground truncate">{order.store_address}</div>
                      )}
                    </td>
                    <td className="px-1 py-1">
                      <NumericCell
                        value={order.weight_kg}
                        onSave={v => handleUpdate(order.id, "weight_kg", v)}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <NumericCell
                        value={order.volume_m3}
                        onSave={v => handleUpdate(order.id, "volume_m3", v)}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <NumericCell
                        value={order.amount_rub}
                        onSave={v => handleUpdate(order.id, "amount_rub", v)}
                        placeholder="—"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <TextCell
                        value={order.notes}
                        onSave={v => handleUpdate(order.id, "notes", v)}
                        placeholder="Добавить…"
                      />
                    </td>
                    <td className="px-2 py-1">
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
                        title="Удалить"
                        onClick={() => setDeleteId(order.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}

                {/* Totals row */}
                <tr className="bg-muted/30 border-t-2 font-semibold text-sm">
                  <td className="px-3 py-2 text-muted-foreground">
                    Итого: {data?.total_count} маг.
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {totalWeight > 0 ? fmt(totalWeight) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {totalVolume > 0 ? fmt(totalVolume, 2) : "—"}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {totalAmount > 0 ? fmt(totalAmount, 0) : "—"}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Success hint ── */}
      {hasOrders && (
        <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-2.5">
          <CheckCircle className="w-4 h-4 shrink-0" />
          <span>
            Заявки сохранены. Нажмите{" "}
            <Link
              href="/route?from=orders"
              className="font-semibold underline"
              onClick={() => sessionStorage.removeItem(TODAY_AUTOSELECT_KEY)}
            >
              К маршруту
            </Link>
            {" "}— все {data?.total_count} магазина будут выбраны автоматически.
          </span>
        </div>
      )}

      {/* ── Delete confirm ── */}
      <AlertDialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить заявку?</AlertDialogTitle>
            <AlertDialogDescription>
              Магазин будет убран из списка доставки на {date}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId !== null && handleDelete(deleteId)}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
