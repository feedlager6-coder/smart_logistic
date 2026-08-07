import { useEffect, useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { MapPin, Navigation, Share2, Download, RefreshCw, Car, Clock, Copy, Check, AlertTriangle, Printer, Info, Settings, Package, Users, Link2, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useGetRouteSession } from "@workspace/api-client-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";

// Fix leaflet default icon — используем локальные файлы из пакета, не CDN
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

import type { RouteResult } from "@workspace/api-client-react";

type VehicleRouteWithUrls = RouteResult["routes"][number] & {
  yandex_urls?: string[];
};

const COLORS = ["#0ea5e9", "#f43f5e", "#8b5cf6", "#10b981", "#f59e0b", "#6366f1", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

type ExecutionStatus = "planned" | "delivered" | "partial" | "failed" | "rescheduled";
type Assignment = {
  id: number;
  route_index: number;
  driver_name: string;
  vehicle_name: string;
  status: string;
  total_points: number;
  completed_points: number;
  driver_url?: string;
  whatsapp_url?: string;
  expires_at?: string | null;
  executions?: Array<{
    id: number;
    visit_order: number;
    store_name: string;
    status: ExecutionStatus;
    quantity: number;
    actual_qty: number;
    shortfall_qty: number;
    payment_method: string;
    payment_status: string;
    driver_comment: string;
    rescheduled_date: string | null;
    remaining_order_date: string | null;
  }>;
};

const executionStatusLabels: Record<ExecutionStatus, string> = {
  planned: "План",
  delivered: "Доставлено",
  partial: "Частично",
  failed: "Не доставлено",
  rescheduled: "Перенесено",
};

const executionStatusClass: Record<ExecutionStatus, string> = {
  planned: "bg-muted text-muted-foreground",
  delivered: "bg-emerald-100 text-emerald-800",
  partial: "bg-orange-100 text-orange-800",
  failed: "bg-red-100 text-red-800",
  rescheduled: "bg-violet-100 text-violet-800",
};

function ExecutionControlPanel({ sessionId, routes }: { sessionId: number; routes: RouteResult["routes"] }) {
  const [driverNames, setDriverNames] = useState<Record<number, string>>({});
  const [creatingRoute, setCreatingRoute] = useState<number | null>(null);
  const [copiedAssignment, setCopiedAssignment] = useState<number | null>(null);
  const [issuedLinks, setIssuedLinks] = useState<Record<number, { driver_url: string; whatsapp_url: string }>>({});
  const [rescheduleDates, setRescheduleDates] = useState<Record<number, string>>({});
  const [remainingDates, setRemainingDates] = useState<Record<number, string>>({});
  const [creatingRescheduledOrder, setCreatingRescheduledOrder] = useState<number | null>(null);
  const [creatingRemainingOrder, setCreatingRemainingOrder] = useState<number | null>(null);
  const { data, isLoading, refetch } = useQuery<{ assignments: Assignment[] }>({
    queryKey: ["route-assignments", sessionId],
    queryFn: async () => {
      const response = await fetch(`/api/route/sessions/${sessionId}/assignments`, { credentials: "include" });
      if (!response.ok) throw new Error("Не удалось загрузить исполнение маршрута");
      return response.json();
    },
    // MVP uses polling instead of WebSocket; keep dispatcher updates quick.
    refetchInterval: 3_000,
  });

  const createAssignment = async (routeIndex: number) => {
    setCreatingRoute(routeIndex);
    try {
      const response = await fetch(`/api/route/sessions/${sessionId}/assignments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route_index: routeIndex,
          driver_name: driverNames[routeIndex] ?? "",
          vehicle_name: routes[routeIndex].vehicle_name,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.detail || "Не удалось создать рейс");
      }
      const created = await response.json() as Assignment & { driver_url?: string; whatsapp_url?: string };
      if (created.driver_url) {
        const driverUrl = new URL(created.driver_url, window.location.origin).toString();
        setIssuedLinks((current) => ({
          ...current,
          [routeIndex]: {
            driver_url: driverUrl,
            whatsapp_url: created.whatsapp_url
              ? new URL(created.whatsapp_url, window.location.origin).toString()
              : `https://wa.me/?text=${encodeURIComponent(`SmartRoute: исполнение доставок ${driverUrl}`)}`,
          },
        }));
      }
      await refetch();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось создать рейс");
    } finally {
      setCreatingRoute(null);
    }
  };

  const copyDriverLink = async (assignment: Assignment) => {
    const link = assignment.driver_url;
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopiedAssignment(assignment.id);
    window.setTimeout(() => setCopiedAssignment(null), 1800);
  };

  const createRescheduledOrder = async (assignmentId: number, executionId: number) => {
    const rescheduledDate = rescheduleDates[executionId];
    if (!rescheduledDate) return;
    setCreatingRescheduledOrder(executionId);
    try {
      const response = await fetch(`/api/route/assignments/${assignmentId}/executions/${executionId}/rescheduled-order`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery_date: rescheduledDate }),
      });
      const payload = await response.json().catch(() => null) as { detail?: string } | null;
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload?.detail || "Не удалось создать заявку"}`);
      await refetch();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось создать заявку на новую дату");
    } finally {
      setCreatingRescheduledOrder(null);
    }
  };

  const createRemainingOrder = async (assignmentId: number, executionId: number) => {
    const deliveryDate = remainingDates[executionId];
    if (!deliveryDate) return;
    setCreatingRemainingOrder(executionId);
    try {
      const response = await fetch(`/api/route/assignments/${assignmentId}/executions/${executionId}/remaining-order`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delivery_date: deliveryDate }),
      });
      const payload = await response.json().catch(() => null) as { detail?: string } | null;
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload?.detail || "Не удалось создать заявку на остаток"}`);
      await refetch();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось создать заявку на остаток");
    } finally {
      setCreatingRemainingOrder(null);
    }
  };

  return (
    <Card className="print:hidden">
      <CardHeader className="pb-3 border-b bg-muted/20">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg"><Users className="w-5 h-5 text-primary" />Исполнение доставок</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">Назначьте рейс водителю и следите за фактическими статусами точек.</p>
          </div>
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </div>
      </CardHeader>
      <CardContent className="p-0 divide-y">
        {routes.map((route, routeIndex) => {
          const assignment = data?.assignments?.find((item) => item.route_index === routeIndex);
          const issuedLink = issuedLinks[routeIndex];
          const driverUrl = issuedLink?.driver_url;
          const whatsappUrl = issuedLink?.whatsapp_url;
          const completed = assignment?.completed_points ?? 0;
          const total = assignment?.total_points ?? route.stores.length;
          const percent = total ? Math.round(completed / total * 100) : 0;
          return (
            <div key={`${route.vehicle_name}-${routeIndex}`} className="p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0" style={{ backgroundColor: COLORS[routeIndex % COLORS.length] }}><Car className="w-4 h-4" /></div>
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{route.vehicle_name}</p>
                    <p className="text-xs text-muted-foreground">{completed} из {total} точек завершено{assignment ? ` · ${assignment.status === "completed" ? "рейс завершён" : "рейс активен"}` : ""}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {driverUrl ? (
                    <>
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigator.clipboard.writeText(driverUrl).then(() => { setCopiedAssignment(assignment?.id ?? routeIndex); window.setTimeout(() => setCopiedAssignment(null), 1800); })}><Link2 className="w-3.5 h-3.5" />{copiedAssignment === (assignment?.id ?? routeIndex) ? "Скопировано" : "Ссылка водителю"}</Button>
                      <Button size="sm" variant="outline" className="text-emerald-700 border-emerald-200" onClick={() => window.open(whatsappUrl, "_blank")}>WhatsApp</Button>
                    </>
                  ) : null}
                </div>
              </div>
              {assignment?.expires_at && (
                <p className="text-xs text-muted-foreground">
                  Ссылка действует до {new Date(assignment.expires_at).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </p>
              )}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground"><span>Прогресс рейса</span><span>{percent}%</span></div>
                <div className="h-2 rounded-full bg-muted overflow-hidden"><div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${percent}%` }} /></div>
              </div>
              {assignment && (
                <Button size="sm" variant="outline" className="w-full" onClick={() => createAssignment(routeIndex)} disabled={creatingRoute === routeIndex}>
                  {creatingRoute === routeIndex ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                  Выдать новую ссылку (срок 48 часов)
                </Button>
              )}
              {!assignment && (
                <div className="flex gap-2">
                  <input className="h-9 flex-1 rounded-md border bg-background px-3 text-sm" placeholder="Имя водителя (необязательно)" value={driverNames[routeIndex] ?? ""} onChange={(event) => setDriverNames((current) => ({ ...current, [routeIndex]: event.target.value }))} />
                  <Button size="sm" onClick={() => createAssignment(routeIndex)} disabled={creatingRoute === routeIndex}>
                    {creatingRoute === routeIndex ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Link2 className="w-4 h-4 mr-1" />}Назначить
                  </Button>
                </div>
              )}
              {assignment?.executions && assignment.executions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {assignment.executions.map((execution) => (
                    <div key={execution.id} className="flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-xs">
                      <span className="font-semibold text-muted-foreground w-5">{execution.visit_order}</span>
                      <span className="truncate flex-1">{execution.store_name}</span>
                       <span className="whitespace-nowrap text-muted-foreground">
                         План: {execution.quantity ?? 0} · Доставлено: {execution.actual_qty ?? 0} · Остаток: {execution.shortfall_qty ?? 0} шт.
                       </span>
                      <span className={`rounded-full px-2 py-0.5 whitespace-nowrap ${executionStatusClass[execution.status]}`}>{executionStatusLabels[execution.status]}</span>
                      <span className="whitespace-nowrap text-muted-foreground">
                        {execution.payment_method === "cash" ? "Наличные" :
                          execution.payment_method === "card" ? "Карта" :
                            execution.payment_method === "transfer" ? "Перевод" : "Без оплаты"}
                        {" · "}
                        {execution.payment_status === "paid" ? "Оплачено" :
                          execution.payment_status === "not_paid" ? "Не оплачено" : "Ожидает оплаты"}
                      </span>
                      {execution.driver_comment && <span className="text-muted-foreground truncate max-w-[180px]" title={execution.driver_comment}>«{execution.driver_comment}»</span>}
                       {execution.remaining_order_date && (
                         <span className="basis-full text-emerald-700">
                           Создана заявка на: {new Date(`${execution.remaining_order_date}T00:00:00`).toLocaleDateString("ru-RU")}
                         </span>
                       )}
                       {(execution.status === "partial" || execution.status === "failed") && execution.shortfall_qty > 0 && (
                         <div className="basis-full flex flex-wrap items-center gap-2 pt-1">
                           <input
                             type="date"
                             className="h-8 rounded-md border bg-background px-2"
                             value={remainingDates[execution.id] ?? ""}
                             onChange={(event) => setRemainingDates((current) => ({ ...current, [execution.id]: event.target.value }))}
                           />
                           <Button
                             size="sm"
                             variant="outline"
                             disabled={!remainingDates[execution.id] || creatingRemainingOrder === execution.id}
                             onClick={() => createRemainingOrder(assignment.id, execution.id)}
                           >
                             {creatingRemainingOrder === execution.id
                               ? <Loader2 className="w-3 h-3 animate-spin" />
                               : execution.status === "partial" ? "Создать заявку на остаток" : "Создать заявку на новую дату"}
                           </Button>
                         </div>
                       )}
                      {execution.status === "rescheduled" && (
                        <div className="basis-full flex items-center gap-2 pt-1">
                          <input
                            type="date"
                            className="h-8 rounded-md border bg-background px-2"
                            value={rescheduleDates[execution.id] ?? execution.rescheduled_date ?? ""}
                            onChange={(event) => setRescheduleDates((current) => ({ ...current, [execution.id]: event.target.value }))}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!rescheduleDates[execution.id] || creatingRescheduledOrder === execution.id}
                            onClick={() => createRescheduledOrder(assignment.id, execution.id)}
                          >
                            {creatingRescheduledOrder === execution.id ? <Loader2 className="w-3 h-3 animate-spin" /> : "Создать заявку на новую дату"}
                          </Button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// Auto-fits map to all route points
function FitBoundsToRoutes({ routes }: { routes: RouteResult["routes"] }) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [];
    routes.forEach(route =>
      route.stores.forEach(stop => {
        if (stop.lat && stop.lon) pts.push([stop.lat, stop.lon]);
      })
    );
    if (pts.length > 0) {
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
    }
  }, [map, routes]);
  return null;
}

// Returns segments (array of yandex_urls) for a route
function getNavSegments(route: VehicleRouteWithUrls): string[] {
  if (route.yandex_urls && route.yandex_urls.length > 0) return route.yandex_urls;
  if (route.yandex_url) return [route.yandex_url];
  return [];
}

// Per-segment copy state key: `${routeIndex}-${segmentIndex}`
type CopiedSegKey = `${number}-${number}`;

// Strips unnecessary ×1 suffixes from a products string so items that appear
// only once don't show a redundant multiplier.  E.g. "Хлеб×1, Молоко×3" → "Хлеб, Молоко×3".
function formatProductsString(s: string): string {
  if (!s) return s;
  return s
    .split(",")
    .map((p) => p.trim().replace(/^(.+?)×1$/, "$1"))
    .filter(Boolean)
    .join(", ");
}

// Aggregates "Молоко×4, Сахар×16" strings from all stops into one summary string.
// Parses "Item×N" pattern, sums quantities by name, returns compact list.
function aggregateProducts(stops: Array<Record<string, unknown>>): string {
  const totals = new Map<string, number>();
  for (const stop of stops) {
    const p = stop.products as string | undefined;
    if (!p) continue;
    for (const part of p.split(",")) {
      const trimmed = part.trim();
      const m = trimmed.match(/^(.+?)×(\d+(?:\.\d+)?)$/);
      if (m) {
        const name = m[1].trim();
        const qty = parseFloat(m[2]);
        totals.set(name, (totals.get(name) ?? 0) + qty);
      } else if (trimmed) {
        totals.set(trimmed, (totals.get(trimmed) ?? 0) + 1);
      }
    }
  }
  if (totals.size === 0) return "";
  return Array.from(totals.entries())
    .map(([name, qty]) => qty > 1 ? `${name}×${Math.round(qty)}` : name)
    .join(", ");
}

export function ResultPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id?: string }>();
  const sessionId = params?.id ? parseInt(params.id) : null;
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [copiedNav, setCopiedNav] = useState<number | null>(null);
  const [copiedSeg, setCopiedSeg] = useState<CopiedSegKey | null>(null);
  const [localResult, setLocalResult] = useState<RouteResult | null>(null);
  const [activeVehicleIndex, setActiveVehicleIndex] = useState(0);

  const { data: serverResult, isLoading: sessionLoading, isError: sessionError } = useGetRouteSession(
    sessionId ?? 0,
    { query: { enabled: !!sessionId } as any }
  );

  // Fallback: load from localStorage (legacy, no session_id in URL)
  useEffect(() => {
    if (!sessionId) {
      const data = localStorage.getItem("smartroute_result");
      if (data) {
        try {
          setLocalResult(JSON.parse(data));
        } catch (e) {
          console.error("Failed to parse route result");
          setLocation("/route");
        }
      } else {
        setLocation("/route");
      }
    }
  }, [sessionId, setLocation]);

  const result = (sessionId ? serverResult : localResult) as RouteResult | null | undefined;

  const handleCopyLink = () => {
    if (!sessionId) return;
    const url = `${window.location.origin}${window.location.pathname}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast({ title: "Ссылка скопирована", description: "Поделитесь ею с водителем." });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyNav = (url: string, index: number) => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedNav(index);
      toast({ title: "Ссылка Яндекс Навигатора скопирована", description: "Отправьте водителю для открытия маршрута." });
      setTimeout(() => setCopiedNav(null), 2000);
    });
  };

  const handleCopySeg = (url: string, routeIdx: number, segIdx: number) => {
    if (!url) return;
    const key: CopiedSegKey = `${routeIdx}-${segIdx}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedSeg(key);
      toast({ title: "Ссылка скопирована", description: `Часть ${segIdx + 1} маршрута скопирована.` });
      setTimeout(() => setCopiedSeg(null), 2000);
    });
  };

  // Generates a loading sheet (загрузочный лист) in a new window with stops in REVERSE order.
  // Reverse order = last delivery stop loaded first (deepest in truck), first delivery stop last (by door).
  // Products field ("Item×N, Item2×N2") is source-agnostic — works with Excel import and 1C integration alike.
  const handlePrintLoading = () => {
    if (!result) return;
    const date = new Date().toLocaleDateString("ru-RU");

    // Parse "Молоко 1л×24, Масло×12" → [{name, qty}]. Forward-compatible with 1C data.
    const parseProducts = (s: string): Array<{ name: string; qty: number | null }> => {
      if (!s.trim()) return [];
      return s.split(",").map((p) => {
        const m = p.trim().match(/^(.+?)×(\d+(?:\.\d+)?)$/);
        if (m) return { name: m[1].trim(), qty: Math.round(parseFloat(m[2])) };
        return { name: p.trim(), qty: null };
      }).filter((x) => x.name);
    };

    const stopBlock = (
      stop: RouteResult["routes"][number]["stores"][number],
      loadSeq: number,
      totalStops: number
    ) => {
      const products = parseProducts((stop as any).products ?? "");
      const weight = (stop as any).weight_kg as number | undefined;
      const qty = (stop as any).quantity as number | undefined;
      const isFirst = loadSeq === 1;
      const isLast = loadSeq === totalStops;
      const labelText = isFirst ? "← грузится первой (в глубину кузова)" : isLast ? "← грузится последней (у двери)" : "";
      const productRows = products.length > 0
        ? products.map((pr) => `
          <div class="prow">
            <span class="pname">${pr.name}</span>
            <span class="pqty">${pr.qty !== null && pr.qty > 1 ? `× ${pr.qty} шт.` : ""}</span>
          </div>`).join("")
        : `<div class="prow" style="color:#94a3b8;font-style:italic">Нет данных о товарах</div>`;
      return `
        <div class="stop" style="page-break-inside:avoid">
          <div class="stop-head">
            <div class="seq">${loadSeq}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:700;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${stop.store_name}</div>
              <div style="font-size:11px;color:#64748b;margin-top:1px">${stop.address}</div>
            </div>
            ${labelText ? `<div style="font-size:9px;color:#94a3b8;white-space:nowrap;align-self:flex-end">${labelText}</div>` : ""}
            <div class="chk-wrap"><span style="font-size:9px;color:#94a3b8;display:block;text-align:center;margin-bottom:2px">Загружено</span><div class="chk"></div></div>
          </div>
          <div class="stop-body">${productRows}</div>
          ${weight || (qty && qty > 0) ? `
          <div class="stop-foot">
            <span></span>
            <span>${qty && qty > 0 ? `Итого: ${Math.round(qty)} шт.` : ""}${weight && weight > 0 ? `${qty && qty > 0 ? " · " : ""}${weight} кг` : ""}</span>
          </div>` : ""}
        </div>`;
    };

    const pages = result.routes.map((route, i) => {
      const summary = aggregateProducts(route.stores as unknown as Array<Record<string, unknown>>);
      const totalQty = route.stores.reduce((s, st) => s + ((st as any).quantity ?? 0), 0);
      const totalWeight = (route as any).total_weight_kg as number | undefined;
      const reversed = [...route.stores].reverse();
      const blocks = reversed.map((stop, idx) => stopBlock(stop, idx + 1, reversed.length)).join("");
      return `
        <div${i > 0 ? ' style="page-break-before:always;padding-top:16px"' : ""}>
          <div class="hdr">
            <div>
              <div class="lbl">Загрузочный лист</div>
              <div style="font-size:22px;font-weight:700;color:#0f172a">${route.vehicle_name}</div>
              ${summary ? `<div class="sumbox"><strong>Всего в машине:</strong> ${summary}${totalQty > 0 ? ` — ${Math.round(totalQty)} шт.` : ""}</div>` : ""}
            </div>
            <div style="text-align:right;font-size:11px;color:#555">
              <div>Дата: <strong>${date}</strong></div>
              <div style="margin-top:2px">${route.stores.length} точек · ${Math.round(route.total_km)} км</div>
              ${totalWeight && totalWeight > 0 ? `<div style="font-weight:700;margin-top:2px">Вес: ${totalWeight} кг</div>` : ""}
              <div style="margin-top:6px;font-size:10px;color:#94a3b8;border:1px solid #e2e8f0;border-radius:4px;padding:2px 6px">
                № 1 — в кузов (первым) &nbsp;·&nbsp; № ${route.stores.length} — у двери (последним)
              </div>
            </div>
          </div>
          <div class="stops">${blocks}</div>
          <div class="foot">
            <span>Кладовщик: ________________________&nbsp; Подпись: ____________</span>
            <span>Водитель: _________________________&nbsp; Подпись: ____________</span>
          </div>
        </div>`;
    }).join("");

    const css = `
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:16px;background:#fff}
      .lbl{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.6px;margin-bottom:3px}
      .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1e3a5f;padding-bottom:10px;margin-bottom:14px;gap:12px}
      .sumbox{background:#eef4fb;border:1px solid #bfdbfe;border-radius:5px;padding:4px 9px;display:inline-block;margin-top:5px;color:#1e40af;font-size:10px}
      .stops{display:flex;flex-direction:column;gap:8px}
      .stop{border:1.5px solid #cbd5e1;border-radius:7px;overflow:hidden}
      .stop-head{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f1f5f9;border-bottom:1px solid #e2e8f0}
      .seq{width:36px;height:36px;border-radius:50%;background:#1e3a5f;color:#fff;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
      .chk-wrap{margin-left:8px;flex-shrink:0;display:flex;flex-direction:column;align-items:center}
      .chk{width:22px;height:22px;border:2px solid #94a3b8;border-radius:4px}
      .stop-body{padding:8px 12px}
      .prow{display:flex;justify-content:space-between;align-items:baseline;padding:4px 0;border-bottom:1px dotted #e2e8f0;gap:8px}
      .prow:last-child{border-bottom:none}
      .pname{color:#1e293b;font-size:12px}
      .pqty{font-weight:700;color:#1e3a5f;white-space:nowrap;font-size:12px}
      .stop-foot{display:flex;justify-content:space-between;padding:5px 12px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b;font-weight:600}
      .foot{display:flex;gap:48px;margin-top:16px;font-size:11px;color:#333;padding-top:12px;border-top:1px solid #e2e8f0}
      @media print{body{padding:8px}@page{margin:12mm}}
    `;

    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8">
      <title>Загрузочный лист — SmartRoute</title>
      <style>${css}</style></head>
      <body>${pages}</body></html>`;

    const w = window.open("", "_blank", "width=960,height=720");
    if (!w) {
      toast({ title: "Браузер заблокировал окно", description: "Разрешите всплывающие окна для этого сайта." });
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  };

  if (sessionId && sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground">Загружаю маршрут...</p>
        </div>
      </div>
    );
  }

  if (sessionId && (sessionError || (!sessionLoading && !serverResult))) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
        <AlertTriangle className="w-12 h-12 text-amber-500" />
        <div className="text-center space-y-1">
          <h2 className="text-lg font-semibold">Не удалось загрузить маршрут</h2>
          <p className="text-muted-foreground text-sm">
            Маршрут не найден или был удалён.
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/history">← Вернуться в историю</Link>
        </Button>
      </div>
    );
  }

  if (!result) return null;

  // Check if any route needs splitting
  const hasSplitRoutes = result.routes.some(r => {
    const segs = getNavSegments(r as VehicleRouteWithUrls);
    return segs.length > 1;
  });

  // ── Driver Mode (mobile) ─────────────────────────────────────────────────
  if (isMobile) {
    const activeRoute = result.routes[activeVehicleIndex] as VehicleRouteWithUrls;
    const activeSegments = getNavSegments(activeRoute);
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs opacity-80">Режим водителя</p>
            <h1 className="font-bold text-lg leading-tight">
              {activeRoute?.vehicle_name ?? "Маршрут"}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-80">Пробег</p>
            <p className="font-bold">{Math.round(activeRoute?.total_km ?? 0)} км</p>
          </div>
        </div>

        {/* Vehicle switcher */}
        {result.routes.length > 1 && (
          <div className="flex gap-2 px-4 py-2 overflow-x-auto bg-muted/30 border-b">
            {result.routes.map((r, i) => (
              <button
                key={r.vehicle_name}
                onClick={() => setActiveVehicleIndex(i)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  i === activeVehicleIndex
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground"
                }`}
              >
                {r.vehicle_name}
              </button>
            ))}
          </div>
        )}

        {/* Split warning (mobile) */}
        {activeSegments.length > 1 && (
          <div className="mx-4 mt-3 mb-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-800">
              Маршрут разделён на {activeSegments.length} части из-за ограничений Яндекс.Навигатора (макс. 20 точек).
            </p>
          </div>
        )}

        {/* Stop list */}
        <div className="flex-1 overflow-y-auto divide-y">
          {activeRoute?.stores.map((stop) => (
            <div key={stop.store_id} className="px-4 py-4 flex gap-4 items-start">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 mt-0.5"
                style={{ backgroundColor: COLORS[activeVehicleIndex % COLORS.length] }}
              >
                {stop.order}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-base leading-tight truncate">{stop.store_name}</p>
                <p className="text-sm text-muted-foreground mt-0.5 truncate">{stop.address}</p>
                {stop.arrive_by && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <p className="text-sm text-primary font-medium mt-1 cursor-help inline-flex items-center gap-1">
                          ⏱ Ориент. {stop.arrive_by}
                        </p>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs text-xs">
                        Время рассчитано автоматически и является приблизительным. Точное время определяется навигатором водителя с учётом текущей дорожной ситуации.
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                {(stop as any).products && (
                  <p className="text-sm text-muted-foreground mt-1.5 leading-snug">
                    <span className="text-xs">📦</span>{" "}
                    <span>{formatProductsString((stop as any).products)}</span>
                    {(stop as any).weight_kg > 0 && (
                      <span className="text-xs text-muted-foreground/70 ml-1">· {(stop as any).weight_kg} кг</span>
                    )}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 border-t bg-background p-4 space-y-2">
          {activeSegments.length > 1 ? (
            <>
              {activeSegments.map((url, segIdx) => {
                const segKey: CopiedSegKey = `${activeVehicleIndex}-${segIdx}`;
                const stopFrom = segIdx * 20 + 1;
                const stopTo = Math.min((segIdx + 1) * 20, activeRoute?.stores.length ?? 0);
                return (
                  <div key={segIdx} className="flex gap-2">
                    <Button
                      className="flex-1 h-11 gap-2"
                      onClick={() => window.open(url, "_blank")}
                    >
                      <Navigation className="w-4 h-4" />
                      Часть {segIdx + 1} (ост. {stopFrom}–{stopTo})
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      title="Скопировать ссылку"
                      onClick={() => handleCopySeg(url, activeVehicleIndex, segIdx)}
                    >
                      {copiedSeg === segKey
                        ? <Check className="w-4 h-4 text-emerald-500" />
                        : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                );
              })}
              <Button
                variant="outline"
                className="w-full h-11 gap-2 text-emerald-600 border-emerald-200"
                onClick={() => window.open(activeRoute?.whatsapp_url, "_blank")}
              >
                <Share2 className="w-4 h-4" />
                WhatsApp
              </Button>
            </>
          ) : (
            <div className="flex gap-2">
              <Button
                className="flex-1 h-12 gap-2"
                onClick={() => window.open(activeRoute?.yandex_url, "_blank")}
              >
                <Navigation className="w-5 h-5" />
                Я.Навигатор
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-12 w-12 shrink-0"
                title="Скопировать ссылку маршрута"
                onClick={() => handleCopyNav(activeRoute?.yandex_url ?? '', activeVehicleIndex)}
              >
                {copiedNav === activeVehicleIndex
                  ? <Check className="w-5 h-5 text-emerald-500" />
                  : <Copy className="w-5 h-5" />}
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-12 gap-2 text-emerald-600 border-emerald-200"
                onClick={() => window.open(activeRoute?.whatsapp_url, "_blank")}
              >
                <Share2 className="w-5 h-5" />
                WhatsApp
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Desktop view ─────────────────────────────────────────────────────────
  // Compute map center from actual route points (city-agnostic)
  const allRoutePoints = result.routes.flatMap(r =>
    r.stores.filter(s => s.lat && s.lon).map(s => [s.lat!, s.lon!] as [number, number])
  );
  const center: [number, number] = allRoutePoints.length > 0
    ? [
        allRoutePoints.reduce((acc, p) => acc + p[0], 0) / allRoutePoints.length,
        allRoutePoints.reduce((acc, p) => acc + p[1], 0) / allRoutePoints.length,
      ]
    : [55.7558, 37.6173]; // Москва как нейтральный fallback

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Результат оптимизации</h1>
          <p className="text-muted-foreground">Маршруты успешно построены</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {sessionId && (
            <Button variant="outline" onClick={handleCopyLink} className="gap-2">
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              <span className="hidden sm:inline">Копировать ссылку</span>
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()} className="gap-2">
            <Printer className="w-4 h-4" />
            <span className="hidden sm:inline">Маршрутный лист</span>
          </Button>
          <Button variant="outline" onClick={handlePrintLoading} className="gap-2">
            <Package className="w-4 h-4" />
            <span className="hidden sm:inline">Загрузочный лист</span>
          </Button>
          <Button className="gap-2" asChild>
            <Link href="/route">
              <RefreshCw className="w-4 h-4" />
              Построить заново
            </Link>
          </Button>
        </div>
      </div>

      {/* VRP degradation warnings (e.g. TW disabled due to infeasibility) */}
      {((result as any).warnings as string[] | undefined)?.map((w, i) => (
        <Alert key={i} className="border-amber-200 bg-amber-50 print:hidden">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">{w}</AlertDescription>
        </Alert>
      ))}

      {/* Global split-route warning */}
      {hasSplitRoutes && (
        <Alert className="border-amber-200 bg-amber-50 print:hidden">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            Один или несколько маршрутов автоматически разделены на части — Яндекс.Навигатор поддерживает не более 20 точек в одной ссылке (склад + 19 магазинов). Каждая часть имеет отдельную кнопку открытия и копирования.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 print:hidden">
        <Card className="bg-primary text-primary-foreground border-transparent">
          <CardContent className="pt-6">
            <div className="text-sm font-medium opacity-90 mb-1">Общий пробег</div>
            <div className="text-3xl font-bold">{Math.round(result.total_km)} км</div>
            <div className="text-sm opacity-90 mt-1">
              Без оптим.: {Math.round((result.savings as any).unoptimized_km ?? result.savings.unoptimized_km)} км
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500 text-white border-transparent">
          <CardContent className="pt-6">
            <div className="text-sm font-medium opacity-90 mb-1">Экономия маршрута</div>
            <div className="text-3xl font-bold">{Math.round(result.savings.saved_km)} км</div>
            <div className="text-sm opacity-90 mt-1">
              −{(result.savings as any).saved_pct ?? 0}% · ~{(result.savings as any).saved_fuel_l ?? 0} л топлива (~{(result.savings as any).saved_fuel_cost_rub ?? 0} ₽)
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-600 text-white border-transparent">
          <CardContent className="pt-6">
            <div className="text-sm font-medium opacity-90 mb-1">Экономия (день/месяц)</div>
            <div className="text-3xl font-bold">{result.savings.saved_rub_day} ₽</div>
            <div className="text-sm opacity-90 mt-1">{result.savings.saved_rub_month} ₽ в месяц</div>
          </CardContent>
        </Card>
      </div>

      {/* Savings breakdown */}
      {((result.savings as any).cost_per_km != null) && (
        <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 print:hidden">
          <Info className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:block" />
          <div className="text-sm text-muted-foreground flex-1 space-y-0.5">
            <span className="font-medium text-foreground">Как считалась экономия: </span>
            топливо {(result.savings as any).fuel_price ?? "—"} ₽/л × {(result.savings as any).fuel_consumption ?? "—"} л/100 км
            {" "}= <span className="font-semibold text-foreground">{(result.savings as any).cost_per_km} ₽/км</span>
            {" "}× {(result.savings as any).saved_km ?? 0} км × 1.4 (дороги)
          </div>
          <Button variant="outline" size="sm" className="gap-1.5 shrink-0 self-start sm:self-center" asChild>
            <Link href="/settings">
              <Settings className="w-3.5 h-3.5" />
              Изменить
            </Link>
          </Button>
        </div>
      )}

      {/* Map + Legend */}
      <Card className="overflow-hidden border-border print:hidden">
        <div className="h-[440px] w-full relative z-0">
          <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://2gis.ru" target="_blank">2ГИС</a>'
              url="https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1"
              subdomains="0123"
              maxZoom={18}
            />
            <FitBoundsToRoutes routes={result.routes} />
            {result.routes.map((route, i) => {
              const color = COLORS[i % COLORS.length];
              const positions = route.stores
                .filter(s => s.lat != null && s.lon != null)
                .map(s => [s.lat, s.lon] as [number, number]);
              return (
                <Fragment key={route.vehicle_name}>
                  {positions.length > 1 && (
                    <Polyline positions={positions} pathOptions={{ color, weight: 4, opacity: 0.8 }} />
                  )}
                  {route.stores.map((stop) => {
                    if (!stop.lat || !stop.lon) return null;
                    return (
                      <Marker key={`${route.vehicle_name}-${stop.order}`} position={[stop.lat, stop.lon]}>
                        <Popup>
                          <strong>{stop.store_name}</strong><br />
                          {stop.address}<br />
                          Порядок: {stop.order}<br />
                          Авто: {route.vehicle_name}
                          {(stop as any).products && (
                            <><br />📦 {formatProductsString((stop as any).products)}</>
                          )}
                        </Popup>
                      </Marker>
                    );
                  })}
                </Fragment>
              );
            })}
          </MapContainer>

          {/* Color Legend overlay */}
          {result.routes.length > 1 && (
            <div className="absolute bottom-3 left-3 z-[1000] bg-background/90 backdrop-blur-sm border rounded-lg px-3 py-2 shadow-md">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Легенда</p>
              <div className="space-y-1">
                {result.routes.map((route, i) => (
                  <div key={route.vehicle_name} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-4 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span className="font-medium truncate max-w-[140px]">{route.vehicle_name}</span>
                    <span className="text-muted-foreground ml-auto pl-2">{Math.round(route.total_km)} км</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ── PRINT-ONLY: Route sheets per vehicle ─────────────────────────── */}
      <div className="hidden print:block">
        {result.routes.map((route, i) => (
          <div
            key={route.vehicle_name}
            style={{
              pageBreakBefore: i === 0 ? 'auto' : 'always',
              pageBreakInside: 'avoid',
              paddingTop: i === 0 ? 0 : '16px',
            }}
          >
            {/* Шапка страницы каждого водителя */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px', borderBottom: '3px solid #1e3a5f', paddingBottom: '8px' }}>
              <div>
                <div style={{ fontSize: '11px', color: '#666', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Маршрутный лист</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#111' }}>{route.vehicle_name}</div>
                {(() => {
                  const summary = aggregateProducts(route.stores as unknown as Array<Record<string, unknown>>);
                  const totalQty = route.stores.reduce((s, st) => s + ((st as any).quantity ?? 0), 0);
                  if (!summary) return null;
                  return (
                    <div style={{ marginTop: '4px', fontSize: '10px', color: '#1e3a5f', background: '#eef4fb', border: '1px solid #c5d9ee', borderRadius: '4px', padding: '3px 7px', display: 'inline-block' }}>
                      <strong>Загрузка:</strong> {summary}
                      {totalQty > 0 && <span style={{ color: '#555' }}> — итого {Math.round(totalQty)} шт.</span>}
                    </div>
                  );
                })()}
              </div>
              <div style={{ textAlign: 'right', fontSize: '11px', color: '#555' }}>
                <div>Дата: <strong>{new Date().toLocaleDateString('ru-RU')}</strong></div>
                <div style={{ marginTop: '2px' }}>{route.stores.length} точек &nbsp;·&nbsp; {Math.round(route.total_km)} км &nbsp;·&nbsp; ~{Math.floor((route.estimated_minutes ?? 0) / 60)} ч {(route.estimated_minutes ?? 0) % 60} мин</div>
                {(route as any).total_weight_kg > 0 && (
                  <div style={{ marginTop: '2px', fontWeight: 600 }}>Вес: {(route as any).total_weight_kg} кг</div>
                )}
              </div>
            </div>

            {/* Таблица остановок */}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
              <thead>
                <tr style={{ background: '#e8edf2' }}>
                  <th style={{ border: '1px solid #bbb', padding: '5px 6px', textAlign: 'center', width: '30px' }}>№</th>
                  <th style={{ border: '1px solid #bbb', padding: '5px 6px', textAlign: 'left', width: '22%' }}>Магазин</th>
                  <th style={{ border: '1px solid #bbb', padding: '5px 6px', textAlign: 'left', width: '25%' }}>Адрес</th>
                  <th style={{ border: '1px solid #bbb', padding: '5px 6px', textAlign: 'left' }}>Товар / кол-во</th>
                  <th style={{ border: '1px solid #bbb', padding: '5px 6px', textAlign: 'center', width: '55px' }}>Прибытие</th>
                  <th style={{ border: '1px solid #bbb', padding: '5px 6px', textAlign: 'center', width: '50px' }}>Отметка</th>
                </tr>
              </thead>
              <tbody>
                {route.stores.map((stop) => (
                  <tr key={stop.store_id} style={{ background: stop.order % 2 === 0 ? '#f7f9fb' : '#fff' }}>
                    <td style={{ border: '1px solid #bbb', padding: '5px 6px', textAlign: 'center', fontWeight: 'bold', color: '#1e3a5f' }}>{stop.order}</td>
                    <td style={{ border: '1px solid #bbb', padding: '5px 6px', fontWeight: '600' }}>{stop.store_name}</td>
                    <td style={{ border: '1px solid #bbb', padding: '5px 6px', color: '#444' }}>{stop.address}</td>
                    <td style={{ border: '1px solid #bbb', padding: '4px 5px', fontSize: '10px', lineHeight: '1.35', verticalAlign: 'top' }}>
                      {(stop as any).products ? (
                        <>
                          <span style={{ display: 'block', wordBreak: 'break-word' }}>{formatProductsString((stop as any).products)}</span>
                          {((stop as any).quantity ?? 0) > 0 && (
                            <span style={{ display: 'block', color: '#666', marginTop: '1px' }}>
                              итого {Math.round((stop as any).quantity)} шт.
                            </span>
                          )}
                        </>
                      ) : <>&nbsp;</>}
                    </td>
                    <td style={{ border: '1px solid #bbb', padding: '5px 6px', textAlign: 'center' }}>{stop.arrive_by ?? '—'}</td>
                    <td style={{ border: '1px solid #bbb', padding: '5px 6px' }}>&nbsp;</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Подписи */}
            <div style={{ display: 'flex', gap: '48px', marginTop: '14px', fontSize: '11px', color: '#333' }}>
              <span>Водитель: _________________________&nbsp;&nbsp; Подпись: ____________</span>
              <span>Диспетчер: _________________________&nbsp;&nbsp; Подпись: ____________</span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-6 print:hidden">
        {sessionId && <ExecutionControlPanel sessionId={sessionId} routes={result.routes} />}
        <h2 className="text-2xl font-bold tracking-tight mt-8 mb-4">Детализация по машинам</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {result.routes.map((route, i) => {
            const r = route as VehicleRouteWithUrls;
            const segments = getNavSegments(r);
            const isSplit = segments.length > 1;
            return (
              <Card key={route.vehicle_name} className="flex flex-col">
                <CardHeader className="pb-3 border-b bg-muted/20">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: COLORS[i % COLORS.length] }}>
                        <Car className="w-4 h-4" />
                      </div>
                      {route.vehicle_name}
                    </CardTitle>
                    <Badge variant="secondary">{route.stores.length} точек</Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2 flex-wrap">
                    <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {Math.round(route.total_km)} км</span>
                    {(route as any).total_weight_kg > 0 && (
                      <span className={`flex items-center gap-1 font-medium ${
                        (route as any).capacity_kg > 0 && (route as any).total_weight_kg > (route as any).capacity_kg
                          ? "text-red-600"
                          : "text-muted-foreground"
                      }`}>
                        <span className="text-xs">⚖</span> {(route as any).total_weight_kg} кг
                        {(route as any).capacity_kg > 0 && (
                          <span className="font-normal">/ {(route as any).capacity_kg} кг</span>
                        )}
                      </span>
                    )}
                    {(route as any).capacity_m3 > 0 && (
                      <span className={`flex items-center gap-1 font-medium ${
                        (route as any).total_volume_m3 > (route as any).capacity_m3
                          ? "text-red-600"
                          : "text-muted-foreground"
                      }`}>
                        <span className="text-xs">📦</span> {((route as any).total_volume_m3 ?? 0).toFixed(2)} м³
                        <span className="font-normal">/ {(route as any).capacity_m3.toFixed(2)} м³</span>
                      </span>
                    )}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          {(route as any).service_minutes > 0 ? (
                            <span className="flex items-center gap-1 cursor-help">
                              <Clock className="w-4 h-4" />
                              ≈{Math.floor((route.estimated_minutes ?? 0) / 60)} ч {(route.estimated_minutes ?? 0) % 60} мин
                              <span className="text-xs text-muted-foreground/70 ml-1">(езда {(route as any).drive_minutes ?? 0} мин)</span>
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 cursor-help">
                              <Clock className="w-4 h-4" />
                              ≈{Math.floor((route.estimated_minutes ?? 0) / 60)} ч {(route.estimated_minutes ?? 0) % 60} мин
                              <span className="text-[10px] text-muted-foreground/60 ml-0.5">без пробок</span>
                            </span>
                          )}
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs text-xs">
                          Расчётное время маршрута (без учёта пробок и светофоров). Рассчитано автоматически на основе данных дорог.
                          <br /><br />
                          Точное время водитель увидит после открытия маршрута в Яндекс Навигаторе.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  {/* Capacity progress bars — kg and m³ shown independently when set */}
                  {(route as any).capacity_kg > 0 && (() => {
                    const pct = Math.min(100, Math.round((route as any).total_weight_kg / (route as any).capacity_kg * 100));
                    const over = (route as any).total_weight_kg > (route as any).capacity_kg;
                    return (
                      <div className="mt-2 space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className={over ? "text-red-600 font-medium" : "text-muted-foreground"}>
                            {over ? `⚠ Перегруз +${((route as any).total_weight_kg - (route as any).capacity_kg).toFixed(0)} кг` : "Загрузка (кг)"}
                          </span>
                          <span className={over ? "text-red-600 font-bold" : "text-muted-foreground"}>{pct}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${over ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                  {(route as any).capacity_m3 > 0 && (() => {
                    const pct = Math.min(100, Math.round(((route as any).total_volume_m3 ?? 0) / (route as any).capacity_m3 * 100));
                    const over = ((route as any).total_volume_m3 ?? 0) > (route as any).capacity_m3;
                    return (
                      <div className="mt-1 space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className={over ? "text-red-600 font-medium" : "text-muted-foreground"}>
                            {over
                              ? `⚠ Перебор объёма +${((route as any).total_volume_m3 - (route as any).capacity_m3).toFixed(2)} м³`
                              : `Загрузка (м³) ${(route as any).total_volume_m3.toFixed(2)} / ${(route as any).capacity_m3.toFixed(2)} м³`}
                          </span>
                          <span className={over ? "text-red-600 font-bold" : "text-muted-foreground"}>{pct}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${over ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-sky-500"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })()}
                  {/* Cargo loading summary — shown when at least one stop has products */}
                  {(() => {
                    const summary = aggregateProducts(route.stores as unknown as Array<Record<string, unknown>>);
                    const totalQty = route.stores.reduce((s, st) => s + ((st as any).quantity ?? 0), 0);
                    if (!summary) return null;
                    return (
                      <div className="mt-3 rounded-md bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-900">
                        <span className="font-semibold mr-1">Загрузка:</span>
                        <span className="leading-relaxed">{summary}</span>
                        {totalQty > 0 && (
                          <span className="ml-1 text-sky-700/70">— итого {Math.round(totalQty)} шт.</span>
                        )}
                      </div>
                    );
                  })()}
                </CardHeader>
                <CardContent className="p-0 flex-1">
                  <ScrollArea className="h-[300px]">
                    <div className="p-4 space-y-4">
                      {route.stores.map((stop, idx) => (
                        <div key={stop.store_id} className="flex gap-4 relative">
                          {idx !== route.stores.length - 1 && (
                            <div className="absolute left-[11px] top-6 bottom-[-16px] w-[2px] bg-border" />
                          )}
                          <div className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground text-xs font-bold flex items-center justify-center shrink-0 z-10 border-2 border-background">
                            {stop.order}
                          </div>
                          <div className="space-y-1 pb-2 min-w-0">
                            <p className="font-medium text-sm leading-none truncate">{stop.store_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{stop.address}</p>
                            {stop.arrive_by && (
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <p className="text-xs text-emerald-600 font-medium mt-1 cursor-help">
                                      Ориент. прибытие: {stop.arrive_by}
                                    </p>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-xs">
                                    Время рассчитано автоматически и является приблизительным. Точное время определяется навигатором водителя с учётом текущей дорожной ситуации.
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {(stop as any).products && (
                              <p className="text-xs text-sky-700/80 mt-1 leading-snug">
                                <span>📦</span>{" "}
                                <span>{formatProductsString((stop as any).products)}</span>
                                {(stop as any).weight_kg > 0 && (
                                  <span className="text-muted-foreground/60 ml-1">· {(stop as any).weight_kg} кг</span>
                                )}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>

                {/* Footer: split or single */}
                <div className="p-4 border-t bg-muted/10 print:hidden">
                  {isSplit ? (
                    <div className="space-y-2">
                      {/* Per-segment buttons */}
                      {segments.map((url, segIdx) => {
                        const segKey: CopiedSegKey = `${i}-${segIdx}`;
                        const stopFrom = segIdx * 20 + 1;
                        const stopTo = Math.min((segIdx + 1) * 20, route.stores.length);
                        return (
                          <div key={segIdx} className="flex gap-2 items-center">
                            <div className="text-xs font-medium text-muted-foreground w-16 shrink-0">
                              Часть {segIdx + 1}
                              <span className="block text-[10px]">ост. {stopFrom}–{stopTo}</span>
                            </div>
                            <Button
                              className="flex-1 h-9 gap-1.5 text-sm"
                              onClick={() => window.open(url, "_blank")}
                            >
                              <Navigation className="w-3.5 h-3.5" />
                              Открыть
                            </Button>
                            <Button
                              variant="outline"
                              size="icon"
                              className="h-9 w-9 shrink-0"
                              title="Скопировать ссылку"
                              onClick={() => handleCopySeg(url, i, segIdx)}
                            >
                              {copiedSeg === segKey
                                ? <Check className="w-3.5 h-3.5 text-emerald-500" />
                                : <Copy className="w-3.5 h-3.5" />}
                            </Button>
                          </div>
                        );
                      })}
                      {/* WhatsApp below segments */}
                      <Button
                        variant="outline"
                        className="w-full gap-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50 mt-1"
                        onClick={() => window.open(route.whatsapp_url, "_blank")}
                      >
                        <Share2 className="w-4 h-4" />
                        WhatsApp
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button className="flex-1 gap-2" onClick={() => window.open(route.yandex_url, "_blank")}>
                        <Navigation className="w-4 h-4" />
                        Я.Навигатор
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        className="shrink-0"
                        title="Скопировать ссылку маршрута в буфер"
                        onClick={() => handleCopyNav(route.yandex_url ?? '', i)}
                      >
                        {copiedNav === i
                          ? <Check className="w-4 h-4 text-emerald-500" />
                          : <Copy className="w-4 h-4" />}
                      </Button>
                      <Button variant="outline" className="flex-1 gap-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => window.open(route.whatsapp_url, "_blank")}>
                        <Share2 className="w-4 h-4" />
                        WhatsApp
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Bottom CTA — rebuild route */}
      <div className="flex justify-center pt-4 pb-2 print:hidden">
        <Button size="lg" className="gap-2 h-12 px-8 shadow-md shadow-primary/20" asChild>
          <Link href="/route">
            <RefreshCw className="w-5 h-5" />
            Построить заново
          </Link>
        </Button>
      </div>
    </div>
  );
}
