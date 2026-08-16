import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  MapPin,
  Navigation,
  Phone,
  PhoneCall,
  RotateCcw,
  Truck,
  User,
  AlertTriangle,
  Package,
  ChevronDown,
  ChevronUp,
  Compass,
  Undo2,
  ListChecks,
  Clock,
  FileSpreadsheet,
  Copy,
  Check,
  Send,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type Status = "planned" | "delivered" | "partial" | "failed" | "rescheduled";
type Payment = "cash" | "card" | "transfer" | "none";
type PaymentStatus = "pending" | "paid" | "not_paid";

type Execution = {
  id: number;
  visit_order: number;
  store_name: string;
  store_phone?: string;
  store_client?: string;
  address: string;
  lat?: number | null;
  lon?: number | null;
  products: string;
  quantity: number;
  actual_qty: number;
  shortfall_qty: number;
  arrive_by: string;
  status: Status;
  payment_method: Payment;
  payment_status: PaymentStatus;
  driver_comment: string;
  yandex_url: string;
};

type DriverData = {
  assignment: {
    driver_name: string;
    vehicle_name: string;
    route_yandex_url: string;
    status: string;
    total_points: number;
    completed_points: number;
    next_stop?: { store_name: string; address: string } | null;
  };
  executions: Execution[];
};

const statusLabels: Record<Status, string> = {
  planned: "Ожидает доставки",
  delivered: "Доставлено",
  partial: "Частично",
  failed: "Не доставлено",
  rescheduled: "Перенесено",
};

const paymentLabels: Record<Payment, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Перевод",
  none: "Без оплаты",
};

const paymentStatusLabels: Record<PaymentStatus, string> = {
  pending: "Ожидает оплаты",
  paid: "Оплачено",
  not_paid: "Не оплачено",
};

const terminalStatuses = new Set(["delivered", "partial", "failed", "rescheduled"]);
const paymentMethods: Payment[] = ["cash", "card", "transfer"];
const paymentStatuses: PaymentStatus[] = ["paid", "not_paid"];

function formatProductsLine(productsStr?: string): string {
  if (!productsStr) return "";
  const trimmed = productsStr.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return "";
  const items = trimmed
    .split(/[\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return items.join(", ");
}

export function DriverPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [activeTab, setActiveTab] = useState<"route" | "report">("route");
  const [copiedReport, setCopiedReport] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [locationDenied, setLocationDenied] = useState(false);
  const trackingActiveRef = useRef(false);
  const lastLocationSentAtRef = useRef(0);
  const [expandedCompletedCards, setExpandedCompletedCards] = useState<Record<number, boolean>>({});
  const [showAllCompleted, setShowAllCompleted] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, {
    status: Status;
    actual_qty: number | "";
    payment_method: Payment;
    payment_status: PaymentStatus;
    driver_comment: string;
  }>>({});

  const { data, isLoading, isError, refetch } = useQuery<DriverData>({
    queryKey: ["driver-assignment", token],
    queryFn: async () => {
      const response = await fetch(`/api/driver/${encodeURIComponent(token)}`);
      if (!response.ok) throw new Error("Ссылка недействительна");
      return response.json();
    },
    enabled: Boolean(token),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!token || !navigator.geolocation) {
      setLocationMessage("Этот браузер не поддерживает геолокацию");
      return;
    }
    const startAutomatically = () => {
      setLocationDenied(false);
      setTrackingEnabled(true);
      setLocationMessage("Запрашиваем разрешение на геолокацию…");
    };
    if (navigator.permissions?.query) {
      navigator.permissions.query({ name: "geolocation" as PermissionName })
        .then((permission) => {
          if (permission.state === "denied") {
            setLocationDenied(true);
            setTrackingEnabled(false);
            setLocationMessage("Геолокация выключена или заблокирована в настройках браузера");
          } else {
            startAutomatically();
          }
        })
        .catch(startAutomatically);
    } else {
      startAutomatically();
    }
  }, [token]);

  useEffect(() => {
    trackingActiveRef.current = trackingEnabled;
    if (!trackingEnabled || !token || !navigator.geolocation) return;
    const sendLocation = async (position: GeolocationPosition) => {
      if (!trackingActiveRef.current) return;
      const now = Date.now();
      if (now - lastLocationSentAtRef.current < 20_000) return;
      lastLocationSentAtRef.current = now;
      try {
        const response = await fetch(`/api/driver/${encodeURIComponent(token)}/location`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
          }),
        });
        if (!response.ok) throw new Error();
        setLocationDenied(false);
        setLocationMessage("Геолокация активна — передаётся диспетчеру (обновление каждые 20 сек)");
      } catch {
        setLocationMessage("Не удалось отправить координаты — проверьте интернет");
      }
    };
    const watchId = navigator.geolocation.watchPosition(sendLocation, (error) => {
      if (error.code === error.PERMISSION_DENIED) {
        setLocationDenied(true);
        setTrackingEnabled(false);
        setLocationMessage("Геолокация выключена или заблокирована в браузере");
      } else {
        setLocationMessage("Поиск спутников GPS…");
      }
    }, {
      enableHighAccuracy: true,
      maximumAge: 15000,
      timeout: 10000,
    });
    return () => navigator.geolocation.clearWatch(watchId);
  }, [trackingEnabled, token]);

  const enableTracking = () => {
    if (!navigator.geolocation) {
      setLocationMessage("Этот браузер не поддерживает геолокацию");
      return;
    }
    setLocationDenied(false);
    setLocationMessage("Запрашиваем доступ к местоположению…");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocationDenied(false);
        setTrackingEnabled(true);
        setLocationMessage("Геолокация включена и активна");
        lastLocationSentAtRef.current = Date.now();
        try {
          await fetch(`/api/driver/${encodeURIComponent(token)}/location`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lat: pos.coords.latitude,
              lon: pos.coords.longitude,
              accuracy: pos.coords.accuracy,
            }),
          });
        } catch {
          // Ignored initial ping failure
        }
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          setLocationDenied(true);
          setTrackingEnabled(false);
          setLocationMessage("Доступ к геопозиции заблокирован. Разрешите его в настройках браузера и нажмите кнопку снова.");
        } else {
          setLocationMessage("Не удалось определить координаты. Попробуйте ещё раз.");
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const draftFor = (execution: Execution) => drafts[execution.id] ?? {
    status: execution.status,
    actual_qty: execution.status === "delivered" || execution.status === "planned"
      ? (execution.status === "delivered" && execution.actual_qty !== undefined && execution.actual_qty !== null ? execution.actual_qty : execution.quantity)
      : (execution.actual_qty ?? 0),
    payment_method: execution.payment_method,
    payment_status: execution.payment_status === "pending" ? "not_paid" : execution.payment_status,
    driver_comment: execution.driver_comment,
  };

  const saveExecution = async (execution: Execution, explicitStatus?: Status) => {
    const draft = draftFor(execution);
    const targetStatus = explicitStatus || draft.status;

    const requestBody = {
      status: targetStatus,
      ...(targetStatus === "delivered" || targetStatus === "partial"
        ? { actual_qty: draft.actual_qty === "" ? undefined : Number(draft.actual_qty) }
        : targetStatus === "planned"
          ? { actual_qty: 0, driver_comment: "" }
          : {}),
      payment_method: targetStatus === "planned" ? "none" : draft.payment_method,
      payment_status: targetStatus === "planned" ? "pending" : draft.payment_status,
      driver_comment: targetStatus === "planned" ? "" : draft.driver_comment,
    };
    setSavingId(execution.id);
    try {
      const response = await fetch(`/api/driver/${encodeURIComponent(token)}/executions/${execution.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as
          | { detail?: string | Array<{ msg?: string }> }
          | null;
        const detail = Array.isArray(payload?.detail)
          ? payload.detail.map((item) => item.msg).filter(Boolean).join("; ")
          : payload?.detail;
        throw new Error(`HTTP ${response.status}: ${detail || "Не удалось сохранить статус"}`);
      }
      setDrafts((current) => {
        const next = { ...current };
        delete next[execution.id];
        return next;
      });
      const wasLastOpenPoint = (data?.executions || []).filter((item) => item.status === "planned").length === 1;
      if (wasLastOpenPoint && terminalStatuses.has(targetStatus)) {
        setTrackingEnabled(false);
        setLocationMessage("Рейс завершён — отслеживание остановлено");
      }
      await refetch();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось сохранить изменения");
    } finally {
      setSavingId(null);
    }
  };

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>;
  }

  if (isError || !data) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="p-8 text-center space-y-3">
            <CircleAlert className="w-10 h-10 mx-auto text-destructive" />
            <h1 className="text-xl font-semibold">Ссылка недействительна</h1>
            <p className="text-sm text-muted-foreground">Попросите диспетчера выдать новую ссылку на маршрут.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { assignment, executions } = data;
  const progress = assignment.total_points ? Math.round(assignment.completed_points / assignment.total_points * 100) : 0;

  // Key stats for report
  const totalPlanQty = executions.reduce((sum, e) => sum + (e.quantity || 0), 0);
  const totalDeliveredQty = executions.reduce((sum, e) => {
    if (e.status === "delivered") return sum + (e.actual_qty ?? e.quantity);
    if (e.status === "partial") return sum + (e.actual_qty ?? 0);
    return sum;
  }, 0);
  const totalShortfallQty = executions.reduce((sum, e) => {
    if (e.status === "failed") return sum + e.quantity;
    if (e.status === "partial") return sum + Math.max(0, e.quantity - (e.actual_qty ?? 0));
    return sum;
  }, 0);

  const deliveredCount = executions.filter((e) => e.status === "delivered").length;
  const partialCount = executions.filter((e) => e.status === "partial").length;
  const failedCount = executions.filter((e) => e.status === "failed").length;
  const rescheduledCount = executions.filter((e) => e.status === "rescheduled").length;
  const plannedCount = executions.filter((e) => e.status === "planned").length;

  const cashPaidCount = executions.filter((e) => e.payment_method === "cash" && e.payment_status === "paid").length;
  const cardPaidCount = executions.filter((e) => e.payment_method === "card" && e.payment_status === "paid").length;
  const transferPaidCount = executions.filter((e) => e.payment_method === "transfer" && e.payment_status === "paid").length;
  const notPaidCount = executions.filter((e) => e.payment_status === "not_paid" && terminalStatuses.has(e.status)).length;

  const generateReportSummaryText = () => {
    const lines = [
      `📊 ОТЧЁТ ПО РЕЙСУ: ${assignment.vehicle_name || "Доставка"}`,
      assignment.driver_name ? `👤 Водитель: ${assignment.driver_name}` : "",
      `📅 Дата: ${new Date().toLocaleDateString("ru-RU")}`,
      `----------------------------------`,
      `📦 Точек всего: ${executions.length}`,
      `✅ Успешно доставлено: ${deliveredCount}`,
      partialCount > 0 ? `⚠️ Частичная доставка: ${partialCount}` : "",
      failedCount > 0 ? `❌ Не доставлено: ${failedCount}` : "",
      rescheduledCount > 0 ? `🔄 Перенесено: ${rescheduledCount}` : "",
      plannedCount > 0 ? `⏳ В процессе / ожидает: ${plannedCount}` : "",
      `----------------------------------`,
      `💵 Оплаты: Наличные (${cashPaidCount}), Карта (${cardPaidCount}), Перевод (${transferPaidCount})${notPaidCount > 0 ? `, Не оплачено: ${notPaidCount}` : ""}`,
      `----------------------------------`,
      `СПИСОК ТОЧЕК:`,
      ...executions.map((e) => {
        const st = statusLabels[e.status];
        const pay = `${paymentLabels[e.payment_method]} (${paymentStatusLabels[e.payment_status]})`;
        const comment = e.driver_comment ? ` | Примечание: ${e.driver_comment}` : "";
        const productsStr = formatProductsLine(e.products) ? ` | Заказ: ${formatProductsLine(e.products)}` : "";
        return `${e.visit_order}. ${e.store_name}${productsStr} — ${st} | ${pay}${comment}`;
      }),
    ].filter(Boolean);
    return lines.join("\n");
  };

  const handleCopyReport = () => {
    const text = generateReportSummaryText();
    navigator.clipboard.writeText(text).then(() => {
      setCopiedReport(true);
      window.setTimeout(() => setCopiedReport(false), 2000);
    });
  };

  const handleSendWhatsAppReport = () => {
    const text = generateReportSummaryText();
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const handleSendTelegramReport = () => {
    const text = generateReportSummaryText();
    const url = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-8">
      <header className="bg-primary text-primary-foreground px-4 py-4 shadow-sm">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs opacity-75 uppercase tracking-wide">SmartRoute · рейс водителя</p>
          <div className="flex items-center justify-between gap-3 mt-1">
            <h1 className="text-xl sm:text-2xl font-bold truncate">{assignment.vehicle_name || "Маршрут доставки"}</h1>
            <Truck className="w-6 h-6 shrink-0" />
          </div>
          {assignment.driver_name && <p className="text-sm opacity-85 mt-1">Водитель: {assignment.driver_name}</p>}
          <div className="mt-3">
            <div className="flex justify-between text-xs mb-1"><span>Прогресс рейса</span><span>{assignment.completed_points} из {assignment.total_points} точек</span></div>
            <div className="h-2.5 rounded-full bg-white/25 overflow-hidden"><div className="h-full bg-white rounded-full transition-all" style={{ width: `${progress}%` }} /></div>
          </div>
          {assignment.next_stop && <p className="text-xs opacity-90 mt-2 font-medium">Следующая точка: {assignment.next_stop.store_name}</p>}
        </div>
      </header>

      <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
        {/* Navigation Tabs */}
        <div className="flex rounded-xl bg-muted p-1 border shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab("route")}
            className={`flex-1 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === "route"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Navigation className="w-4 h-4" />
            <span>Маршрут и точки ({executions.filter((e) => e.status === "planned").length > 0 ? `${executions.filter((e) => e.status === "planned").length} ост.` : "Все выполнены"})</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("report")}
            className={`flex-1 py-2.5 px-3 rounded-lg text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all ${
              activeTab === "report"
                ? "bg-background text-foreground shadow-xs"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>Отчёт по рейсу</span>
          </button>
        </div>

        {activeTab === "report" ? (
          /* Report View exclusively in Russian */
          <div className="space-y-4">
            {/* KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <Card className="p-3.5 bg-background shadow-xs">
                <p className="text-xs text-muted-foreground font-medium">Всего точек</p>
                <p className="text-2xl font-black text-foreground mt-0.5">{executions.length}</p>
                <p className="text-[11px] text-emerald-600 font-semibold mt-1">Выполнено: {deliveredCount + partialCount + failedCount + rescheduledCount}</p>
              </Card>
              <Card className="p-3.5 bg-background shadow-xs">
                <p className="text-xs text-muted-foreground font-medium">Успешно сдано</p>
                <p className="text-2xl font-black text-emerald-600 mt-0.5">{deliveredCount}</p>
                <p className="text-[11px] text-muted-foreground mt-1">точек без замечаний</p>
              </Card>
              <Card className="p-3.5 bg-background shadow-xs">
                <p className="text-xs text-muted-foreground font-medium">Замечания / недовоз</p>
                <p className="text-2xl font-black text-foreground mt-0.5">{partialCount + failedCount + rescheduledCount}</p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {partialCount > 0 ? `Частично: ${partialCount} ` : ""}{failedCount > 0 ? `Не сдано: ${failedCount} ` : ""}{rescheduledCount > 0 ? `Перенос: ${rescheduledCount}` : ""}
                  {partialCount === 0 && failedCount === 0 && rescheduledCount === 0 ? "Все точки без проблем" : ""}
                </p>
              </Card>
              <Card className="p-3.5 bg-background shadow-xs">
                <p className="text-xs text-muted-foreground font-medium">Оплаты (оплачено)</p>
                <p className="text-xl font-black text-foreground mt-0.5">{cashPaidCount + cardPaidCount + transferPaidCount} <span className="text-xs text-muted-foreground font-normal">точек</span></p>
                <p className="text-[11px] text-muted-foreground mt-1">Нал: {cashPaidCount} · Карта: {cardPaidCount} · Перевод: {transferPaidCount}</p>
              </Card>
            </div>

            {/* Supervisor Action Bar */}
            <Card className="p-4 bg-background border shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-sm text-foreground">Сводный отчёт для руководителя</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Отправьте готовый структурированный отчёт о выполненной доставке в мессенджер.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 text-xs font-semibold"
                    onClick={handleCopyReport}
                  >
                    {copiedReport ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedReport ? "Скопировано в буфер" : "Скопировать текст"}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 text-xs font-semibold text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                    onClick={handleSendWhatsAppReport}
                  >
                    <Share2 className="w-4 h-4" />
                    <span>WhatsApp</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 text-xs font-semibold text-sky-700 border-sky-300 hover:bg-sky-50"
                    onClick={handleSendTelegramReport}
                  >
                    <Send className="w-4 h-4" />
                    <span>Telegram</span>
                  </Button>
                </div>
              </div>
            </Card>

            {/* Clean Russian Report Table */}
            <Card className="overflow-hidden border shadow-xs bg-background">
              <CardHeader className="py-3 px-4 bg-muted/40 border-b">
                <CardTitle className="text-sm font-bold flex items-center justify-between">
                  <span>Ведомость доставки по точкам маршрута</span>
                  <span className="text-xs text-muted-foreground font-normal">Всего: {executions.length} точек</span>
                </CardTitle>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-muted/60 text-muted-foreground border-b uppercase font-semibold text-[11px]">
                    <tr>
                      <th className="px-3 py-2.5 w-10 text-center">№</th>
                      <th className="px-3 py-2.5 min-w-[140px]">Магазин / Контрагент</th>
                      <th className="px-3 py-2.5 min-w-[160px]">Адрес доставки</th>
                      <th className="px-3 py-2.5 min-w-[180px]">Товары в заявке</th>
                      <th className="px-3 py-2.5 min-w-[120px]">Статус доставки</th>
                      <th className="px-3 py-2.5 min-w-[130px]">Оплата</th>
                      <th className="px-3 py-2.5 min-w-[150px]">Примечание водителя</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {executions.map((e) => {
                      const isComplete = e.status === "delivered";
                      const isPartial = e.status === "partial";
                      const isFailed = e.status === "failed";
                      const isRescheduled = e.status === "rescheduled";

                      return (
                        <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2.5 text-center font-bold text-muted-foreground">
                            {e.visit_order}
                          </td>
                          <td className="px-3 py-2.5 font-bold text-foreground">
                            {e.store_name}
                            {e.store_client && <p className="text-[10px] text-muted-foreground font-normal">{e.store_client}</p>}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {e.address}
                          </td>
                          <td className="px-3 py-2.5 text-foreground font-medium">
                            {formatProductsLine(e.products) || <span className="text-muted-foreground/60 italic">По накладной</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                                isComplete
                                  ? "bg-emerald-100 text-emerald-800"
                                  : isPartial
                                    ? "bg-amber-100 text-amber-800"
                                    : isFailed
                                      ? "bg-destructive/15 text-destructive"
                                      : isRescheduled
                                        ? "bg-purple-100 text-purple-800"
                                        : "bg-muted text-muted-foreground"
                              }`}
                            >
                              {statusLabels[e.status]}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="font-medium text-foreground">
                              {paymentLabels[e.payment_method]}
                            </div>
                            <div className={`text-[10px] ${e.payment_status === "paid" ? "text-emerald-700 font-semibold" : "text-muted-foreground"}`}>
                              {paymentStatusLabels[e.payment_status]}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {e.driver_comment ? (
                              <span className="text-foreground italic">«{e.driver_comment}»</span>
                            ) : (
                              <span className="text-muted-foreground/60">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        ) : (
          /* Route & Stops View */
          <>
            {/* Geolocation status / prompt banner */}
            <Card className={locationDenied ? "border-destructive/40 bg-destructive/5" : trackingEnabled ? "border-emerald-200 bg-emerald-50/50" : ""}>
              <CardContent className="p-3.5 space-y-2">
                <div className="flex items-start gap-2.5">
                  {trackingEnabled ? (
                    <span className="relative flex h-3 w-3 mt-0.5 shrink-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                    </span>
                  ) : locationDenied ? (
                    <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  ) : (
                    <MapPin className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-foreground">
                      {trackingEnabled
                        ? "🟢 Передача геопозиции активна"
                        : locationDenied
                          ? "Геолокация отключена или заблокирована"
                          : "Передача геопозиции диспетчеру"}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {locationMessage || (trackingEnabled ? "Диспетчер видит положение машины на карте в реальном времени." : "Включите передачу геопозиции, чтобы диспетчер видел вас на маршруте.")}
                    </div>
                    {locationDenied && (
                      <div className="text-[11px] text-destructive mt-1 font-medium">
                        💡 Подсказка: нажмите значок настроек/замка 🔒 в строке браузера, разрешите «Геопозицию» и нажмите кнопку ниже.
                      </div>
                    )}
                  </div>
                </div>
                {!trackingEnabled && (
                  <Button
                    size="sm"
                    className={`w-full ${locationDenied ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}`}
                    variant={locationDenied ? "default" : "outline"}
                    onClick={enableTracking}
                  >
                    <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                    {locationDenied ? "Запросить доступ к геолокации повторно" : "Включить передачу геолокации"}
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Quick action bar: Direct button to navigate to current active stop */}
            {(() => {
              const activeStop = executions.find((e) => !terminalStatuses.has(draftFor(e).status));
              if (!activeStop) return null;

              const openNavigatorApp = () => {
                const lat = activeStop.lat;
                const lon = activeStop.lon;
                const address = activeStop.address ? activeStop.address.trim() : "";

                if (lat && lon) {
                  const naviAppUrl = `yandexnavi://build_route_on_map?lat_to=${lat}&lon_to=${lon}`;
                  const yandexMapsAppUrl = `yandexmaps://maps.yandex.ru/?rtext=~${lat},${lon}&rtt=auto`;
                  const webUrl = `https://yandex.ru/maps/?rtext=~${lat},${lon}&rtt=auto`;

                  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                  if (isMobile) {
                    window.location.href = naviAppUrl;
                    setTimeout(() => {
                      if (document.hidden) return;
                      window.location.href = yandexMapsAppUrl;
                    }, 1200);
                    return;
                  }
                  window.open(webUrl, "_blank");
                  return;
                }

                if (address) {
                  const encoded = encodeURIComponent(address);
                  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                  if (isMobile) {
                    window.location.href = `yandexnavi://search?text=${encoded}`;
                    return;
                  }
                  window.open(`https://yandex.ru/maps/?text=${encoded}`, "_blank");
                  return;
                }

                if (activeStop.yandex_url) {
                  window.open(activeStop.yandex_url, "_blank");
                }
              };

              return (
                <Card className="border-2 border-primary/50 bg-gradient-to-r from-primary/10 via-primary/5 to-background shadow-md overflow-hidden">
                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="px-2.5 py-1 rounded-md bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-2xs">
                            <Compass className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: "6s" }} />
                            Следующая цель: Точка №{activeStop.visit_order}
                          </span>
                        </div>

                        <div className="font-extrabold text-lg text-foreground truncate">
                          {activeStop.store_name}
                        </div>

                        <div className="text-xs text-muted-foreground flex items-start gap-1.5 leading-relaxed">
                          <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                          <span className="break-words font-medium">{activeStop.address}</span>
                        </div>
                      </div>

                      <div className="shrink-0 pt-1 sm:pt-0">
                        <Button
                          size="lg"
                          className="w-full sm:w-auto min-h-12 px-6 font-bold shadow-md bg-primary hover:bg-primary/90 text-primary-foreground gap-2.5 text-sm sm:text-base rounded-xl transition-transform active:scale-95 whitespace-nowrap"
                          onClick={openNavigatorApp}
                        >
                          <Navigation className="w-5 h-5 fill-current shrink-0" />
                          <span>Поехать в Навигаторе</span>
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3.5 pt-2.5 border-t border-primary/15 flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <span className="text-primary font-bold">📲</span>
                        <span>Открывает приложение <strong>Яндекс Навигатор</strong> сразу с маршрутом от вашей машины</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* List of stops */}
            {(() => {
              const pendingStops = executions.filter((e) => !terminalStatuses.has(e.status));
              const completedStops = executions.filter((e) => terminalStatuses.has(e.status));
              const activeExecutionId = pendingStops[0]?.id;

              const renderExecutionCard = (execution: Execution, isCompactCompleted = false) => {
                const draft = draftFor(execution);
                const isDraftTerminal = terminalStatuses.has(draft.status);
                const isSavedTerminal = terminalStatuses.has(execution.status);
                const isTerminal = isDraftTerminal || isSavedTerminal;
                const isCurrentActive = execution.id === activeExecutionId;
                const hasPhone = Boolean(execution.store_phone && execution.store_phone.trim());
                const cleanPhone = execution.store_phone ? execution.store_phone.replace(/[^\d+]/g, "") : "";
                const isCardExpanded = !isCompactCompleted || expandedCompletedCards[execution.id];
                const productsLine = formatProductsLine(execution.products);

                const effectiveDeliveredQty =
                  draft.status === "delivered"
                    ? (draft.actual_qty === "" ? execution.quantity : Number(draft.actual_qty))
                    : draft.status === "partial"
                      ? (draft.actual_qty === "" ? 0 : Number(draft.actual_qty))
                      : 0;

                const effectiveShortfall =
                  draft.status === "delivered"
                    ? Math.max(0, execution.quantity - effectiveDeliveredQty)
                    : draft.status === "partial"
                      ? Math.max(0, execution.quantity - effectiveDeliveredQty)
                      : draft.status === "failed"
                        ? execution.quantity
                        : 0;

                if (isCompactCompleted && !isCardExpanded) {
                  return (
                    <Card
                      key={execution.id}
                      className="border-emerald-200/80 bg-emerald-50/30 transition-all hover:bg-emerald-50/50 shadow-2xs"
                    >
                      <div className="p-3.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-8 h-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                            <CheckCircle2 className="w-4 h-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-foreground truncate">
                                №{execution.visit_order} · {execution.store_name}
                              </span>
                              <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-100/90 px-2 py-0.5 rounded-full shrink-0">
                                {statusLabels[execution.status]}
                              </span>
                            </div>
                            <div className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-2">
                              <span>{execution.address}</span>
                              {productsLine && (
                                <>
                                  <span>•</span>
                                  <span className="text-foreground font-medium truncate max-w-[200px] sm:max-w-xs">{productsLine}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1"
                            onClick={() =>
                              setExpandedCompletedCards((prev) => ({
                                ...prev,
                                [execution.id]: true,
                              }))
                            }
                          >
                            <span>Детали / Изменить</span>
                            <ChevronDown className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                }

                return (
                  <Card
                    key={execution.id}
                    className={`overflow-hidden transition-all ${
                      isCurrentActive
                        ? "border-2 border-primary shadow-md ring-2 ring-primary/20 bg-card"
                        : isTerminal
                          ? "border-emerald-200 bg-emerald-50/20 opacity-95"
                          : "border-border bg-card"
                    }`}
                  >
                    {isCurrentActive && (
                      <div className="flex items-center justify-between px-4 py-2 bg-primary text-primary-foreground text-xs font-bold tracking-wide">
                        <div className="flex items-center gap-1.5">
                          <Compass className="w-4 h-4 animate-spin" style={{ animationDuration: "6s" }} />
                          <span>ТЕКУЩАЯ ТОЧКА ДОСТАВКИ</span>
                        </div>
                        <span className="text-xs font-semibold bg-white/20 px-2 py-0.5 rounded">
                          Точка №{execution.visit_order}
                        </span>
                      </div>
                    )}

                    <CardHeader className="pb-2 pt-4 px-4 sm:px-5">
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                            isTerminal
                              ? "bg-emerald-100 text-emerald-700"
                              : isCurrentActive
                                ? "bg-primary text-primary-foreground font-bold shadow-xs"
                                : "bg-muted text-muted-foreground font-semibold"
                          }`}
                        >
                          {isTerminal ? <CheckCircle2 className="w-5 h-5" /> : <span className="text-sm">{execution.visit_order}</span>}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <CardTitle className="text-base sm:text-lg font-bold">{execution.store_name}</CardTitle>
                            <div className="flex items-center gap-2 shrink-0">
                              {isTerminal && (
                                <span className="text-xs font-semibold text-emerald-700 bg-emerald-100 px-2.5 py-0.5 rounded-full">
                                  {statusLabels[draft.status]}
                                </span>
                              )}
                              {isCompactCompleted && (
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground"
                                  onClick={() =>
                                    setExpandedCompletedCards((prev) => ({
                                      ...prev,
                                      [execution.id]: false,
                                    }))
                                  }
                                >
                                  Свернуть <ChevronUp className="w-3.5 h-3.5 ml-1" />
                                </Button>
                              )}
                            </div>
                          </div>

                          <p className="text-sm text-muted-foreground flex items-start gap-1.5 mt-1">
                            <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground/80" />
                            <span className="break-words leading-relaxed">{execution.address}</span>
                          </p>
                          {execution.arrive_by && (
                            <p className="text-xs text-primary font-medium mt-1">Ориентир / время: {execution.arrive_by}</p>
                          )}

                          {/* Customer & Phone info */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                            {execution.store_client && (
                              <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-md border">
                                <User className="w-3.5 h-3.5 text-muted-foreground/70" />
                                <span>Клиент: <strong className="text-foreground font-semibold">{execution.store_client}</strong></span>
                              </div>
                            )}
                            {hasPhone ? (
                              <a
                                href={`tel:${cleanPhone}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold hover:bg-emerald-100 transition-colors shadow-2xs"
                              >
                                <PhoneCall className="w-3.5 h-3.5" />
                                <span>{execution.store_phone}</span>
                              </a>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic flex items-center gap-1 px-2 py-0.5">
                                <Phone className="w-3 h-3 opacity-50" />
                                Телефон не указан
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </CardHeader>

                    {/* Goods & Order Info - Clean single line display without awkward numbering */}
                    <div className="border-y border-border/80 bg-muted/20 px-4 sm:px-5 py-3">
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                          <Package className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <span className="text-xs font-bold text-foreground uppercase tracking-wide">
                            Заказ к выгрузке:
                          </span>
                          <p className="text-xs sm:text-sm text-foreground font-medium break-words leading-relaxed">
                            {productsLine || "Товары по товарно-сопроводительной накладной (ТТН / УПД)"}
                          </p>
                        </div>
                      </div>
                    </div>

                    <CardContent className="space-y-3 pt-4 px-4 sm:px-5 pb-5">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-muted-foreground">Действие по доставке</span>
                          {isTerminal && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs text-amber-600 hover:text-amber-700 hover:bg-amber-50 gap-1"
                              onClick={() => {
                                if (window.confirm("Вернуть эту точку в статус «Ожидает доставки»?")) {
                                  saveExecution(execution, "planned");
                                }
                              }}
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                              <span>Сбросить в «Не доставлено»</span>
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {(["delivered", "partial", "failed", "rescheduled"] as const).map((status) => {
                            const isSelected = draft.status === status;
                            return (
                              <Button
                                key={status}
                                type="button"
                                variant={isSelected ? "default" : "outline"}
                                className={`h-11 text-sm font-semibold transition-all ${
                                  isSelected
                                    ? status === "delivered"
                                    ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                                    : status === "failed"
                                      ? "bg-destructive hover:bg-destructive/90 text-white"
                                      : ""
                                    : ""
                                }`}
                                onClick={() => {
                                  if (isSelected) {
                                    setDrafts((current) => ({
                                      ...current,
                                      [execution.id]: {
                                        ...draft,
                                        status: "planned",
                                        actual_qty: execution.quantity,
                                      },
                                    }));
                                  } else {
                                    setDrafts((current) => ({
                                      ...current,
                                      [execution.id]: {
                                        ...draft,
                                        status,
                                        actual_qty:
                                          status === "delivered"
                                            ? execution.quantity
                                            : status === "partial"
                                              ? (draft.actual_qty !== "" && draft.actual_qty !== undefined ? draft.actual_qty : execution.quantity)
                                              : 0,
                                      },
                                    }));
                                  }
                                }}
                              >
                                {statusLabels[status]}
                              </Button>
                            );
                          })}
                        </div>

                        {/* Mixed cargo warning displayed specifically to the driver during partial delivery */}
                        {draft.status === "partial" && (
                          <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2 animate-in fade-in duration-200">
                            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                              <span className="font-bold">Смешанный груз:</span> при частичной доставке обязательно укажите недоставленные товары или причину возврата в комментарии ниже.
                            </div>
                          </div>
                        )}

                        {(draft.status === "delivered" || draft.status === "partial") && (
                          <label className="block text-xs font-semibold text-muted-foreground">
                            Фактически доставлено (кол-во)
                            <input
                              type="number"
                              min={0}
                              max={execution.quantity}
                              step="any"
                              inputMode="decimal"
                              className="mt-1 w-full h-11 rounded-md border bg-background px-3 text-base font-bold"
                              value={draft.actual_qty}
                              onChange={(event) => {
                                const value = event.target.value;
                                setDrafts((current) => ({
                                  ...current,
                                  [execution.id]: {
                                    ...draft,
                                    actual_qty: value === "" ? "" : Number(value),
                                  },
                                }));
                              }}
                            />
                          </label>
                        )}

                        <div className="space-y-2">
                          <span className="text-xs text-muted-foreground">Способ оплаты</span>
                          <div className="grid grid-cols-3 gap-2">
                            {paymentMethods.map((method) => (
                              <Button
                                key={method}
                                type="button"
                                variant={draft.payment_method === method ? "default" : "outline"}
                                className="h-10 text-sm"
                                onClick={() =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [execution.id]: { ...draft, payment_method: method },
                                  }))
                                }
                              >
                                {paymentLabels[method]}
                              </Button>
                            ))}
                          </div>
                        </div>

                        <div className="space-y-2">
                          <span className="text-xs text-muted-foreground">Статус оплаты</span>
                          <div className="grid grid-cols-2 gap-2">
                            {paymentStatuses.map((paymentStatus) => (
                              <Button
                                key={paymentStatus}
                                type="button"
                                variant={draft.payment_status === paymentStatus ? "default" : "outline"}
                                className="h-10 text-sm"
                                onClick={() =>
                                  setDrafts((current) => ({
                                    ...current,
                                    [execution.id]: { ...draft, payment_status: paymentStatus },
                                  }))
                                }
                              >
                                {paymentStatusLabels[paymentStatus]}
                              </Button>
                            ))}
                          </div>
                        </div>
                      </div>

                      <Textarea
                        value={draft.driver_comment}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [execution.id]: { ...draft, driver_comment: event.target.value },
                          }))
                        }
                        placeholder={
                          draft.status === "rescheduled"
                            ? "Причина переноса (обязательно)"
                            : draft.status === "partial"
                              ? "Укажите недоставленные товары и причину (обязательно)"
                              : "Комментарий водителя (если есть проблемы)"
                        }
                        className="min-h-[54px]"
                        required={draft.status === "rescheduled" || draft.status === "partial"}
                      />

                      <div className="space-y-2.5 pt-2">
                        {isCurrentActive ? (
                          <Button
                            type="button"
                            className="w-full h-12 bg-primary text-primary-foreground font-bold shadow-md hover:bg-primary/90 text-sm sm:text-base rounded-xl flex items-center justify-center gap-2 whitespace-nowrap transition-transform active:scale-[0.99]"
                            onClick={() => {
                              const lat = execution.lat;
                              const lon = execution.lon;
                              const address = execution.address ? execution.address.trim() : "";

                              if (lat && lon) {
                                const naviAppUrl = `yandexnavi://build_route_on_map?lat_to=${lat}&lon_to=${lon}`;
                                const yandexMapsAppUrl = `yandexmaps://maps.yandex.ru/?rtext=~${lat},${lon}&rtt=auto`;
                                const webUrl = `https://yandex.ru/maps/?rtext=~${lat},${lon}&rtt=auto`;

                                const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                                if (isMobile) {
                                  window.location.href = naviAppUrl;
                                  setTimeout(() => {
                                    if (document.hidden) return;
                                    window.location.href = yandexMapsAppUrl;
                                  }, 1200);
                                  return;
                                }
                                window.open(webUrl, "_blank");
                                return;
                              }

                              if (address) {
                                const encoded = encodeURIComponent(address);
                                const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                                if (isMobile) {
                                  window.location.href = `yandexnavi://search?text=${encoded}`;
                                  return;
                                }
                                window.open(`https://yandex.ru/maps/?text=${encoded}`, "_blank");
                                return;
                              }

                              if (execution.yandex_url) {
                                window.open(execution.yandex_url, "_blank");
                              }
                            }}
                          >
                            <Navigation className="w-5 h-5 fill-current shrink-0" />
                            <span>Поехать в Навигаторе</span>
                          </Button>
                        ) : !isTerminal ? (
                          <div className="w-full py-2 px-3 flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground bg-muted/40 rounded-lg border border-dashed">
                            <Clock className="w-4 h-4 text-muted-foreground/70 shrink-0" />
                            <span>Точка №{execution.visit_order} (в очереди — навигация станет доступна после текущей точки)</span>
                          </div>
                        ) : null}

                        <div className="flex gap-2.5 items-center">
                          {hasPhone && (
                            <Button
                              type="button"
                              variant="outline"
                              className="flex-1 h-11 border-emerald-300 text-emerald-700 hover:bg-emerald-50 font-semibold text-sm whitespace-nowrap"
                              onClick={() => {
                                window.location.href = `tel:${cleanPhone}`;
                              }}
                            >
                              <Phone className="w-4 h-4 mr-1.5 shrink-0" />
                              <span>Позвонить</span>
                            </Button>
                          )}

                          <Button
                            className="flex-1 h-11 font-bold text-sm whitespace-nowrap shadow-xs"
                            onClick={() => saveExecution(execution)}
                            disabled={savingId === execution.id}
                          >
                            {savingId === execution.id ? <Loader2 className="w-4 h-4 animate-spin mr-2 shrink-0" /> : null}
                            <span>{isTerminal ? "Сохранить изменения" : "Сохранить"}</span>
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              };

              return (
                <div className="space-y-4">
                  {/* Section 1: Active & Remaining Points */}
                  {pendingStops.length > 0 ? (
                    <div className="space-y-4">
                      {pendingStops.map((execution) => renderExecutionCard(execution, false))}
                    </div>
                  ) : (
                    <Card className="border-emerald-300 bg-emerald-50 p-6 text-center shadow-xs">
                      <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto mb-2" />
                      <h3 className="text-lg font-bold text-emerald-900">Все точки рейса выполнены!</h3>
                      <p className="text-xs text-emerald-700 mt-1">Отличная работа. Перейдите во вкладку «Отчёт по рейсу», чтобы просмотреть сводную таблицу или отправить отчёт диспетчеру.</p>
                    </Card>
                  )}

                  {/* Section 2: Collapsible Completed Points Group */}
                  {completedStops.length > 0 && (
                    <div className="pt-2 space-y-3">
                      <div className="flex items-center justify-between px-1">
                        <div className="flex items-center gap-2">
                          <ListChecks className="w-4 h-4 text-emerald-600" />
                          <span className="text-xs font-bold text-foreground uppercase tracking-wide">
                            Выполненные точки ({completedStops.length} из {executions.length})
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-primary font-semibold hover:bg-muted gap-1"
                          onClick={() => setShowAllCompleted((prev) => !prev)}
                        >
                          {showAllCompleted ? (
                            <>Свернуть все <ChevronUp className="w-3.5 h-3.5" /></>
                          ) : (
                            <>Развернуть все <ChevronDown className="w-3.5 h-3.5" /></>
                          )}
                        </Button>
                      </div>

                      <div className="space-y-2.5">
                        {completedStops.map((execution) =>
                          renderExecutionCard(execution, !showAllCompleted)
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </>
        )}
      </main>
    </div>
  );
}
