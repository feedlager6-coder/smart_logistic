import { useEffect, useRef, useState, useMemo } from "react";
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
  DollarSign,
  Printer,
  ShieldCheck,
  ShieldAlert,
  Info,
  Banknote,
  CreditCard,
  ArrowRightLeft,
  Lock,
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
    id?: number;
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

// Haversine formula to compute great-circle distance in meters between two lat/lon coordinates
function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Radius of Earth in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export type GeofenceZone = "green" | "yellow" | "red" | "unknown";

export type GeofenceInfo = {
  distanceMeters: number | null;
  zone: GeofenceZone;
  label: string;
};

export function getGeofenceInfo(
  userLat: number | null,
  userLon: number | null,
  targetLat?: number | null,
  targetLon?: number | null
): GeofenceInfo {
  if (
    userLat === null ||
    userLon === null ||
    targetLat === null ||
    targetLat === undefined ||
    targetLon === null ||
    targetLon === undefined
  ) {
    return {
      distanceMeters: null,
      zone: "unknown",
      label: "GPS координаты точки не заданы",
    };
  }

  const dist = Math.round(haversineDistanceMeters(userLat, userLon, targetLat, targetLon));

  if (dist <= 300) {
    return {
      distanceMeters: dist,
      zone: "green",
      label: `Вы на точке (${dist} м)`,
    };
  } else if (dist <= 800) {
    return {
      distanceMeters: dist,
      zone: "yellow",
      label: `Рядом с точкой (${dist} м)`,
    };
  } else {
    const formattedDist = dist >= 1000 ? `${(dist / 1000).toFixed(1)} км` : `${dist} м`;
    return {
      distanceMeters: dist,
      zone: "red",
      label: `Далеко от адреса (${formattedDist})`,
    };
  }
}

export function DriverPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [activeTab, setActiveTab] = useState<"route" | "report">("route");
  const [copiedReport, setCopiedReport] = useState(false);
  const [copiedReconciliation, setCopiedReconciliation] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [locationDenied, setLocationDenied] = useState(false);
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lon: number; accuracy?: number } | null>(null);
  const trackingActiveRef = useRef(false);
  const lastLocationSentAtRef = useRef(0);
  const [expandedCompletedCards, setExpandedCompletedCards] = useState<Record<number, boolean>>({});
  const [showAllCompleted, setShowAllCompleted] = useState(false);

  // Shift closing state (persisted per token in localStorage)
  const [shiftClosed, setShiftClosed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(`smartroute_shift_closed_${token}`) === "true";
    } catch {
      return false;
    }
  });

  // Modal / Confirm state for Red Zone remote delivery
  const [pendingConfirmation, setPendingConfirmation] = useState<{
    execution: Execution;
    targetStatus?: Status;
    distanceMeters: number;
  } | null>(null);

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
      setCurrentCoords({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        accuracy: position.coords.accuracy,
      });
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
        setCurrentCoords({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
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

  const executeSave = async (execution: Execution, explicitStatus?: Status) => {
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
      setPendingConfirmation(null);
    }
  };

  // Smart Geofence check before saving delivered/partial statuses
  const saveExecution = (execution: Execution, explicitStatus?: Status) => {
    const draft = draftFor(execution);
    const targetStatus = explicitStatus || draft.status;

    // Only apply geofence check for completion statuses
    if ((targetStatus === "delivered" || targetStatus === "partial") && currentCoords && execution.lat && execution.lon) {
      const geo = getGeofenceInfo(currentCoords.lat, currentCoords.lon, execution.lat, execution.lon);
      if (geo.zone === "red" && geo.distanceMeters !== null) {
        // Trigger soft confirmation modal for driver
        setPendingConfirmation({
          execution,
          targetStatus,
          distanceMeters: geo.distanceMeters,
        });
        return;
      }
    }

    // Direct save for green, yellow, unknown or non-delivery statuses
    executeSave(execution, explicitStatus);
  };

  const handleToggleShiftClose = () => {
    const nextState = !shiftClosed;
    setShiftClosed(nextState);
    try {
      localStorage.setItem(`smartroute_shift_closed_${token}`, nextState ? "true" : "false");
    } catch {
      // Ignored storage error
    }
  };

  const handlePrintReconciliation = () => {
    window.print();
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

  // Key stats for report and reconciliation
  const totalPlanQty = executions.reduce((sum, e) => sum + (e.quantity || 0), 0);
  const totalDeliveredQty = executions.reduce((sum, e) => {
    if (e.status === "delivered") return sum + (e.actual_qty !== undefined && e.actual_qty !== null ? e.actual_qty : e.quantity);
    if (e.status === "partial") return sum + (e.actual_qty || 0);
    return sum;
  }, 0);
  const totalShortfallQty = executions.reduce((sum, e) => {
    if (e.status === "failed") return sum + e.quantity;
    if (e.status === "partial") return sum + Math.max(0, e.quantity - (e.actual_qty || 0));
    return sum;
  }, 0);

  const deliveredCount = executions.filter((e) => e.status === "delivered").length;
  const partialCount = executions.filter((e) => e.status === "partial").length;
  const failedCount = executions.filter((e) => e.status === "failed").length;
  const rescheduledCount = executions.filter((e) => e.status === "rescheduled").length;
  const plannedCount = executions.filter((e) => e.status === "planned").length;

  const cashPaidOrders = executions.filter((e) => e.payment_method === "cash" && e.payment_status === "paid");
  const cardPaidOrders = executions.filter((e) => e.payment_method === "card" && e.payment_status === "paid");
  const transferPaidOrders = executions.filter((e) => e.payment_method === "transfer" && e.payment_status === "paid");
  const notPaidOrders = executions.filter((e) => e.payment_status === "not_paid" && terminalStatuses.has(e.status));
  const noPaymentOrders = executions.filter((e) => e.payment_method === "none" && terminalStatuses.has(e.status));

  const cashPaidCount = cashPaidOrders.length;
  const cardPaidCount = cardPaidOrders.length;
  const transferPaidCount = transferPaidOrders.length;
  const notPaidCount = notPaidOrders.length;

  // Generate detailed cash and reconciliation report text
  const generateReconciliationText = () => {
    const lines = [
      `📋 КАССОВАЯ И ТОВАРНАЯ ВЕДОМОСТЬ (ЗАКРЫТИЕ СМЕНЫ)`,
      `🚚 Рейс / Машина: ${assignment.vehicle_name || "Доставка"}`,
      assignment.driver_name ? `👤 Водитель: ${assignment.driver_name}` : "",
      `📅 Дата: ${new Date().toLocaleDateString("ru-RU")}`,
      `Статус смены: ${shiftClosed ? "✅ СМЕНА ЗАКРЫТА" : "⏳ В ПРОЦЕССЕ"}`,
      `==================================`,
      `📦 ТОВАРНЫЙ БАЛАНС:`,
      `  • Загружено по плану: ${totalPlanQty} ед.`,
      `  • Фактически сдано: ${totalDeliveredQty} ед.`,
      `  • Возврат / недовоз: ${totalShortfallQty} ед.`,
      `==================================`,
      `💰 КАССОВЫЙ ОТЧЁТ (ОПЛАТЫ):`,
      `  💵 Наличные (к сдаче в кассу): ${cashPaidCount} заказов`,
      ...cashPaidOrders.map((e) => `     - Точка №${e.visit_order}: ${e.store_name} (${formatProductsLine(e.products) || "по накладной"})`),
      `  💳 Оплата картой: ${cardPaidCount} заказов`,
      ...cardPaidOrders.map((e) => `     - Точка №${e.visit_order}: ${e.store_name}`),
      `  🔄 Безналичный перевод: ${transferPaidCount} заказов`,
      ...transferPaidOrders.map((e) => `     - Точка №${e.visit_order}: ${e.store_name}`),
      notPaidCount > 0 ? `  ⚠️ Не оплачено / долг: ${notPaidCount} заказов` : "",
      ...notPaidOrders.map((e) => `     - Точка №${e.visit_order}: ${e.store_name} (Не оплачено: ${paymentLabels[e.payment_method]})`),
      `==================================`,
      `🏁 СТАТУС ВЫПОЛНЕНИЯ ТОЧЕК:`,
      `  • Всего точек: ${executions.length}`,
      `  • Доставлено успешно: ${deliveredCount}`,
      `  • Частично: ${partialCount}`,
      `  • Не доставлено / отказов: ${failedCount}`,
      `  • Перенесено: ${rescheduledCount}`,
      `  • В ожидании: ${plannedCount}`,
    ].filter(Boolean);
    return lines.join("\n");
  };

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

  const handleCopyReconciliation = () => {
    const text = generateReconciliationText();
    navigator.clipboard.writeText(text).then(() => {
      setCopiedReconciliation(true);
      window.setTimeout(() => setCopiedReconciliation(false), 2000);
    });
  };

  const handleSendWhatsAppReport = () => {
    const text = generateReconciliationText();
    const url = `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  const handleSendTelegramReport = () => {
    const text = generateReconciliationText();
    const url = `https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-8 print:bg-white print:p-0">
      <header className="bg-primary text-primary-foreground px-4 py-4 shadow-sm print:hidden">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs opacity-75 uppercase tracking-wide">SmartRoute · рейс водителя</p>
            {/* Real-time GPS status indicator in header */}
            <div className="flex items-center gap-1.5 bg-black/20 px-2.5 py-1 rounded-full text-xs font-semibold">
              <span className={`w-2 h-2 rounded-full ${currentCoords ? "bg-emerald-400 animate-pulse" : "bg-amber-400"}`} />
              <span>{currentCoords ? "GPS подключён" : "Определение GPS…"}</span>
            </div>
          </div>
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

      {/* Geofence Red Zone Confirmation Dialog */}
      {pendingConfirmation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <Card className="max-w-md w-full border-amber-300 shadow-2xl bg-card">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2.5 text-amber-600">
                <ShieldAlert className="w-6 h-6 shrink-0" />
                <CardTitle className="text-base font-bold">Вы находитесь далеко от адреса</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-3.5 text-sm pt-2">
              <p className="text-muted-foreground leading-relaxed">
                До точки <strong>«{pendingConfirmation.execution.store_name}»</strong> по GPS примерно{" "}
                <span className="font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                  {pendingConfirmation.distanceMeters >= 1000
                    ? `${(pendingConfirmation.distanceMeters / 1000).toFixed(1)} км`
                    : `${pendingConfirmation.distanceMeters} м`}
                </span>.
              </p>
              <p className="text-xs text-muted-foreground bg-muted/60 p-2.5 rounded-lg border">
                ℹ️ Вы точно хотите отметить доставку дистанционно (например, если клиент встретил вас в другом месте или приёмка без присутствия у адреса)?
              </p>
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setPendingConfirmation(null)}
                >
                  Отмена
                </Button>
                <Button
                  className="flex-1 bg-amber-600 hover:bg-amber-700 font-bold"
                  onClick={() => executeSave(pendingConfirmation.execution, pendingConfirmation.targetStatus)}
                  disabled={savingId === pendingConfirmation.execution.id}
                >
                  {savingId === pendingConfirmation.execution.id ? <Loader2 className="w-4 h-4 animate-spin mr-1.5" /> : null}
                  Подтвердить
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <main className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4 print:p-0 print:space-y-2">
        {/* Navigation Tabs */}
        <div className="flex rounded-xl bg-muted p-1 border shadow-xs print:hidden">
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
            <span>Касса и ведомость смены</span>
          </button>
        </div>

        {activeTab === "report" ? (
          /* Report & Shift Reconciliation View */
          <div className="space-y-4 print:space-y-3">
            {/* Shift Status Banner */}
            <Card className={`border shadow-xs ${shiftClosed ? "bg-emerald-50/80 border-emerald-300" : "bg-card border-border"}`}>
              <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${shiftClosed ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"}`}>
                    {shiftClosed ? <CheckCircle2 className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-foreground">
                      {shiftClosed ? "Смена закрыта водителем" : "Смена в процессе выполнения"}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {shiftClosed
                        ? "Ведомость сформирована. Вы можете распечатать её или отправить в бухгалтерию/диспетчеру."
                        : `Выполнено ${deliveredCount + partialCount + failedCount + rescheduledCount} из ${executions.length} точек маршрута.`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-stretch sm:self-auto shrink-0 print:hidden">
                  <Button
                    size="sm"
                    variant={shiftClosed ? "outline" : "default"}
                    className={`font-bold text-xs h-9 px-4 ${!shiftClosed ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""}`}
                    onClick={handleToggleShiftClose}
                  >
                    {shiftClosed ? (
                      <>
                        <Undo2 className="w-4 h-4 mr-1.5" />
                        Возобновить смену
                      </>
                    ) : (
                      <>
                        <Lock className="w-4 h-4 mr-1.5" />
                        Закрыть смену
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Cash & Inventory Reconciliation Block (Кассовая ведомость) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Cash Summary Card */}
              <Card className="p-4 bg-background border shadow-xs">
                <div className="flex items-center gap-2 text-primary font-bold text-sm border-b pb-2.5 mb-3">
                  <Banknote className="w-4 h-4 text-emerald-600" />
                  <span>Кассовый баланс по оплатам</span>
                </div>
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50/70 border border-emerald-200">
                    <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
                      💵 Наличные к сдаче в кассу:
                    </span>
                    <span className="font-bold text-emerald-700 text-sm">
                      {cashPaidCount} {cashPaidCount === 1 ? "заказ" : cashPaidCount < 5 ? "заказа" : "заказов"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-sky-50/70 border border-sky-200">
                    <span className="font-medium text-sky-900 flex items-center gap-1.5">
                      💳 Оплата терминалом / картой:
                    </span>
                    <span className="font-semibold text-sky-800">
                      {cardPaidCount} {cardPaidCount === 1 ? "заказ" : cardPaidCount < 5 ? "заказа" : "заказов"}
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-violet-50/70 border border-violet-200">
                    <span className="font-medium text-violet-900 flex items-center gap-1.5">
                      🔄 Банковский перевод:
                    </span>
                    <span className="font-semibold text-violet-800">
                      {transferPaidCount} {transferPaidCount === 1 ? "заказ" : transferPaidCount < 5 ? "заказа" : "заказов"}
                    </span>
                  </div>

                  {notPaidCount > 0 && (
                    <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50/70 border border-amber-200">
                      <span className="font-medium text-amber-900 flex items-center gap-1.5">
                        ⚠️ Не оплачено / отсрочка:
                      </span>
                      <span className="font-semibold text-amber-800">
                        {notPaidCount} {notPaidCount === 1 ? "заказ" : notPaidCount < 5 ? "заказа" : "заказов"}
                      </span>
                    </div>
                  )}
                </div>
              </Card>

              {/* Goods & Inventory Summary Card */}
              <Card className="p-4 bg-background border shadow-xs">
                <div className="flex items-center gap-2 text-primary font-bold text-sm border-b pb-2.5 mb-3">
                  <Package className="w-4 h-4 text-primary" />
                  <span>Товарный баланс рейса</span>
                </div>
                <div className="space-y-2.5 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50 border">
                    <span className="text-muted-foreground font-medium">Загружено по накладным:</span>
                    <span className="font-bold text-foreground text-sm">{totalPlanQty} ед.</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-emerald-50/70 border border-emerald-200">
                    <span className="font-semibold text-emerald-900">Фактически сдано клиентам:</span>
                    <span className="font-bold text-emerald-700 text-sm">{totalDeliveredQty} ед.</span>
                  </div>

                  <div className={`flex items-center justify-between p-2 rounded-lg border ${totalShortfallQty > 0 ? "bg-amber-50/80 border-amber-200" : "bg-muted/30"}`}>
                    <span className={`font-medium ${totalShortfallQty > 0 ? "text-amber-900 font-semibold" : "text-muted-foreground"}`}>
                      Возврат на склад / недовоз:
                    </span>
                    <span className={`font-bold ${totalShortfallQty > 0 ? "text-amber-700 text-sm" : "text-muted-foreground"}`}>
                      {totalShortfallQty} ед.
                    </span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-muted/40 border text-[11px] text-muted-foreground">
                    <span>Успешность сдачи товара:</span>
                    <span className="font-bold text-foreground">
                      {totalPlanQty > 0 ? `${Math.round((totalDeliveredQty / totalPlanQty) * 100)}%` : "100%"}
                    </span>
                  </div>
                </div>
              </Card>
            </div>

            {/* KPI Overview Cards */}
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
                <p className="text-xs text-muted-foreground font-medium">Оплачено заказов</p>
                <p className="text-xl font-black text-foreground mt-0.5">{cashPaidCount + cardPaidCount + transferPaidCount} <span className="text-xs text-muted-foreground font-normal">точек</span></p>
                <p className="text-[11px] text-muted-foreground mt-1">Нал: {cashPaidCount} · Карта: {cardPaidCount} · Перевод: {transferPaidCount}</p>
              </Card>
            </div>

            {/* Action Bar for Print & Export */}
            <Card className="p-4 bg-background border shadow-xs print:hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-sm text-foreground">Экспорт и печать ведомости</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Скопируйте текст отчёта или отправьте готовый документ в диспетчерскую / WhatsApp.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 text-xs font-semibold"
                    onClick={handleCopyReconciliation}
                  >
                    {copiedReconciliation ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedReconciliation ? "Скопировано!" : "Скопировать ведомость"}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5 text-xs font-semibold"
                    onClick={handlePrintReconciliation}
                  >
                    <Printer className="w-4 h-4" />
                    <span>Печать</span>
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
                  <span>Поточечная ведомость сдачи и оплат</span>
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
            {/* GPS Tracking Banner */}
            <Card className="bg-background border shadow-xs">
              <CardContent className="p-3 sm:p-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 text-xs text-muted-foreground min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${trackingEnabled ? "bg-emerald-500 animate-pulse" : locationDenied ? "bg-destructive" : "bg-amber-500"}`} />
                  <span className="truncate">{locationMessage || "Определение местоположения…"}</span>
                </div>
                {!trackingEnabled && (
                  <Button size="sm" variant="outline" className="shrink-0 h-8 text-xs font-semibold" onClick={enableTracking}>
                    Включить GPS
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Current Active Stop Hero Card */}
            {(() => {
              const activeStop = executions.find((e) => e.status === "planned");
              if (!activeStop) return null;

              const activeGeofence = currentCoords
                ? getGeofenceInfo(currentCoords.lat, currentCoords.lon, activeStop.lat, activeStop.lon)
                : null;

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
                <Card className="border-2 border-primary/40 shadow-lg bg-card overflow-hidden">
                  <div className="bg-primary px-4 py-2 text-primary-foreground flex items-center justify-between text-xs font-bold uppercase tracking-wider">
                    <div className="flex items-center gap-1.5">
                      <Compass className="w-4 h-4 animate-spin" style={{ animationDuration: "6s" }} />
                      <span>Следующая точка маршрута</span>
                    </div>
                    <span className="bg-white/20 px-2 py-0.5 rounded text-xs font-bold">
                      Точка №{activeStop.visit_order} из {executions.length}
                    </span>
                  </div>

                  <CardContent className="p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-0.5 rounded-full">
                            Точка №{activeStop.visit_order}
                          </span>

                          {/* Geofence Status Badge for Hero */}
                          {activeGeofence && activeGeofence.zone !== "unknown" && (
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold ${
                                activeGeofence.zone === "green"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : activeGeofence.zone === "yellow"
                                    ? "bg-amber-100 text-amber-800"
                                    : "bg-red-100 text-red-800"
                              }`}
                            >
                              {activeGeofence.zone === "green" ? (
                                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                              ) : activeGeofence.zone === "yellow" ? (
                                <Info className="w-3.5 h-3.5 text-amber-600" />
                              ) : (
                                <ShieldAlert className="w-3.5 h-3.5 text-red-600" />
                              )}
                              <span>{activeGeofence.label}</span>
                            </span>
                          )}
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

                // Calculate real-time geofence for this card
                const geofence = currentCoords
                  ? getGeofenceInfo(currentCoords.lat, currentCoords.lon, execution.lat, execution.lon)
                  : null;

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

                          {/* Customer & Phone info & Geofence pill */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
                            {/* Geofence Indicator Pill */}
                            {geofence && geofence.zone !== "unknown" && (
                              <div
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${
                                  geofence.zone === "green"
                                    ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                                    : geofence.zone === "yellow"
                                      ? "bg-amber-50 text-amber-800 border-amber-200"
                                      : "bg-red-50 text-red-800 border-red-200"
                                }`}
                              >
                                {geofence.zone === "green" ? (
                                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                                ) : geofence.zone === "yellow" ? (
                                  <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                                ) : (
                                  <ShieldAlert className="w-3.5 h-3.5 text-red-600 shrink-0" />
                                )}
                                <span>{geofence.label}</span>
                              </div>
                            )}

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

                        {/* Yellow Zone Soft Information Banner */}
                        {geofence && geofence.zone === "yellow" && (draft.status === "delivered" || draft.status === "partial") && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-xs text-amber-900 flex items-start gap-2 animate-in fade-in duration-150">
                            <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                            <div>
                              <span>Вы находитесь в <strong>{geofence.distanceMeters} м</strong> от точки. Отметка будет сохранена с фиксацией фактического адреса.</span>
                            </div>
                          </div>
                        )}

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
                      <p className="text-xs text-emerald-700 mt-1">Отличная работа. Перейдите во вкладку «Касса и ведомость смены», чтобы проверить кассовый отчёт и закрыть смену.</p>
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

