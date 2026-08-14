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

export function DriverPage() {
  const { token = "" } = useParams<{ token: string }>();
  const [savingId, setSavingId] = useState<number | null>(null);
  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [locationMessage, setLocationMessage] = useState("");
  const [locationDenied, setLocationDenied] = useState(false);
  const trackingActiveRef = useRef(false);
  const lastLocationSentAtRef = useRef(0);
  const [expandedProducts, setExpandedProducts] = useState<Record<number, boolean>>({});
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
    // Browser remembers a granted permission, so reopening the page starts GPS
    // immediately and does not make the driver press the button again.
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
    actual_qty: execution.actual_qty ?? execution.quantity,
    payment_method: execution.payment_method,
    payment_status: execution.payment_status === "pending" ? "not_paid" : execution.payment_status,
    driver_comment: execution.driver_comment,
  };

  const saveExecution = async (execution: Execution, explicitStatus?: Status) => {
    const draft = draftFor(execution);
    const targetStatus = explicitStatus || draft.status;

    const requestBody = {
      status: targetStatus,
      // Quantity is meaningful only for delivered/partial. Omitting it for
      // failed/rescheduled/planned keeps those actions independent from quantity.
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
      // The browser remains the single GPS source. Stop its 20-second timer
      // once the driver has just completed the last outstanding point.
      const wasLastOpenPoint = executions.filter((item) => item.status === "planned").length === 1;
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

  return (
    <div className="min-h-screen bg-muted/30 pb-8">
      <header className="bg-primary text-primary-foreground px-4 py-4 shadow-sm">
        <div className="max-w-3xl mx-auto">
          <p className="text-xs opacity-75 uppercase tracking-wide">SmartRoute · рейс</p>
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

        {/* Quick action bar: Direct button to navigate to current active stop with clean explanation */}
        {(() => {
          const getPointNavUrl = (point?: { yandex_url?: string; lat?: number | null; lon?: number | null; address?: string }): string => {
            if (!point) return "";
            if (point.yandex_url && point.yandex_url.trim()) return point.yandex_url.trim();
            if (point.lat && point.lon) return `https://yandex.ru/maps/?rtext=~${point.lat},${point.lon}&rtt=auto`;
            if (point.address && point.address.trim()) return `https://yandex.ru/maps/?text=${encodeURIComponent(point.address.trim())}`;
            return "";
          };

          const activeStop = executions.find((e) => !terminalStatuses.has(draftFor(e).status));
          if (!activeStop) return null;

          const activeNavUrl = getPointNavUrl(activeStop);

          return (
            <Card className="border-2 border-primary/40 bg-primary/5 shadow-sm overflow-hidden">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-md bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wide flex items-center gap-1">
                        <Compass className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: "6s" }} />
                        Следующая точка №{activeStop.visit_order}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground">
                        Заказ: {activeStop.quantity} ед.
                      </span>
                    </div>
                    <div className="font-bold text-base text-foreground mt-1 truncate">
                      {activeStop.store_name}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-start gap-1 mt-0.5">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
                      <span className="break-words">{activeStop.address}</span>
                    </div>
                  </div>

                  <div className="shrink-0 pt-1 sm:pt-0">
                    <Button
                      size="default"
                      className="w-full sm:w-auto h-11 px-5 font-bold shadow-md bg-primary hover:bg-primary/90 text-primary-foreground gap-2 text-sm"
                      onClick={() => {
                        if (activeNavUrl) {
                          window.open(activeNavUrl, "_blank");
                        }
                      }}
                      disabled={!activeNavUrl}
                    >
                      <Navigation className="w-4 h-4" />
                      Поехать к точке №{activeStop.visit_order}
                    </Button>
                  </div>
                </div>
                <div className="mt-3 pt-2.5 border-t border-primary/15 text-[11px] text-muted-foreground flex items-center gap-1">
                  <span>💡 Нажмите кнопку выше — Яндекс Навигатор построит маршрут от вашего текущего положения.</span>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* List of stops */}
        {(() => {
          const getPointNavUrl = (point?: { yandex_url?: string; lat?: number | null; lon?: number | null; address?: string }): string => {
            if (!point) return "";
            if (point.yandex_url && point.yandex_url.trim()) return point.yandex_url.trim();
            if (point.lat && point.lon) return `https://yandex.ru/maps/?rtext=~${point.lat},${point.lon}&rtt=auto`;
            if (point.address && point.address.trim()) return `https://yandex.ru/maps/?text=${encodeURIComponent(point.address.trim())}`;
            return "";
          };

          const parseProductItems = (productsStr?: string, quantity?: number): string[] => {
            if (!productsStr || !productsStr.trim()) return [];
            const trimmed = productsStr.trim();
            // If the product string is just equal to the numeric quantity or single digit, ignore to prevent duplicate "1" / "1" labels
            if (/^\d+(\.\d+)?$/.test(trimmed)) {
              return [];
            }
            const lines = trimmed.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean);
            if (lines.length > 1) return lines;
            const commaItems = trimmed.split(/,\s*(?=[А-ЯA-Z0-9«"№])/).map((s) => s.trim()).filter(Boolean);
            if (commaItems.length > 1) return commaItems;
            return [trimmed];
          };

          // Separate active/pending points from already completed points
          const pendingStops = executions.filter((e) => !terminalStatuses.has(e.status));
          const completedStops = executions.filter((e) => terminalStatuses.has(e.status));
          const activeExecutionId = pendingStops[0]?.id;

          const renderExecutionCard = (execution: Execution, isCompactCompleted = false) => {
            const draft = draftFor(execution);
            const isTerminal = terminalStatuses.has(draft.status);
            const isCurrentActive = execution.id === activeExecutionId;
            const hasPhone = Boolean(execution.store_phone && execution.store_phone.trim());
            const cleanPhone = execution.store_phone ? execution.store_phone.replace(/[^\d+]/g, "") : "";
            const productItems = parseProductItems(execution.products, execution.quantity);
            const hasExplicitProducts = productItems.length > 0;
            const isProductsExpanded = expandedProducts[execution.id] ?? false;
            const navUrl = getPointNavUrl(execution);
            const isCardExpanded = !isCompactCompleted || expandedCompletedCards[execution.id];

            // If it's a completed stop and collapsed, show a clean, compact summary row
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
                          <span>•</span>
                          <span>Сдано: {execution.actual_qty ?? execution.quantity} из {execution.quantity} ед.</span>
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

                      {/* Goods & Order Info - Spacious, Clear, No Overlaps */}
                      <div className="mt-3.5 rounded-xl border bg-muted/20 p-3 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <Package className="w-4 h-4 text-primary shrink-0" />
                            <span className="text-xs font-semibold text-foreground">
                              Заказ к выгрузке:
                            </span>
                            {hasExplicitProducts && productItems.length > 1 && (
                              <span className="text-[11px] font-medium text-muted-foreground bg-background px-2 py-0.5 rounded-full border">
                                {productItems.length} поз.
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 bg-background px-3 py-1 rounded-lg border shadow-2xs">
                            <span className="text-xs text-muted-foreground font-medium">Общее кол-во:</span>
                            <span className="text-base font-black text-primary">{execution.quantity}</span>
                          </div>
                        </div>

                        {hasExplicitProducts ? (
                          <div className="pt-1 space-y-1.5">
                            {productItems.length === 1 ? (
                              <div className="text-xs font-medium text-foreground bg-background p-2.5 rounded-lg border flex items-center gap-2">
                                <span className="text-primary font-bold">📦</span>
                                <span className="flex-1 break-words">{productItems[0]}</span>
                              </div>
                            ) : (
                              <>
                                <div className="flex items-center justify-between pt-0.5">
                                  <span className="text-[11px] text-muted-foreground font-medium">Список позиций:</span>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="h-6 px-2 text-[11px] text-primary font-semibold hover:bg-background"
                                    onClick={() =>
                                      setExpandedProducts((prev) => ({
                                        ...prev,
                                        [execution.id]: !isProductsExpanded,
                                      }))
                                    }
                                  >
                                    {isProductsExpanded ? (
                                      <>Скрыть состав <ChevronUp className="w-3 h-3 ml-1" /></>
                                    ) : (
                                      <>Показать все позиции ({productItems.length}) <ChevronDown className="w-3 h-3 ml-1" /></>
                                    )}
                                  </Button>
                                </div>
                                {isProductsExpanded && (
                                  <div className="space-y-1.5 pt-1">
                                    {productItems.map((item, idx) => (
                                      <div
                                        key={idx}
                                        className="flex items-start gap-2 p-2 rounded-lg bg-background border text-xs font-medium text-foreground"
                                      >
                                        <span className="w-4 h-4 rounded-full bg-primary/10 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                                          {idx + 1}
                                        </span>
                                        <span className="flex-1 break-words leading-relaxed">{item}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground bg-background/70 px-3 py-2 rounded-lg border border-dashed flex items-center gap-2">
                            <span>📋</span>
                            <span>Товары по накладной (согласно сопроводительным документам)</span>
                          </div>
                        )}

                        {isTerminal && (
                          <div className="pt-2 border-t flex items-center justify-between text-xs text-muted-foreground">
                            <span>
                              Фактически сдано: <strong className="text-foreground font-bold">{execution.actual_qty ?? 0}</strong>
                            </span>
                            {execution.shortfall_qty > 0 && (
                              <span className="text-destructive font-bold">
                                Недовоз: {execution.shortfall_qty}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3 pt-2 px-4 sm:px-5 pb-5">
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
                              // If clicking the already selected button, toggle it back to planned
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
                                    actual_qty: status === "delivered" ? execution.quantity : "",
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
                        : "Комментарий водителя (если есть проблемы)"
                    }
                    className="min-h-[54px]"
                    required={draft.status === "rescheduled"}
                  />

                  <div className="flex flex-wrap gap-2 pt-1">
                    {hasPhone && (
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 min-w-[110px] border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        onClick={() => {
                          window.location.href = `tel:${cleanPhone}`;
                        }}
                      >
                        <Phone className="w-4 h-4 mr-1.5" />
                        Позвонить
                      </Button>
                    )}

                    {navUrl && (
                      <Button
                        type="button"
                        variant={isCurrentActive ? "default" : "outline"}
                        className={`flex-1 min-w-[120px] ${
                          isCurrentActive
                            ? "bg-primary text-primary-foreground font-bold shadow-xs hover:bg-primary/90"
                            : ""
                        }`}
                        onClick={() => window.open(navUrl, "_blank")}
                      >
                        <Navigation className="w-4 h-4 mr-1.5" />
                        {isCurrentActive ? "Поехать к точке" : "Маршрут"}
                      </Button>
                    )}

                    <Button
                      className="flex-1 min-w-[130px] font-semibold"
                      onClick={() => saveExecution(execution)}
                      disabled={savingId === execution.id}
                    >
                      {savingId === execution.id ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                      Сохранить
                    </Button>
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
                  <p className="text-xs text-emerald-700 mt-1">Отличная работа. Ниже можно просмотреть завершённые доставки или при необходимости скорректировать их.</p>
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
      </main>
    </div>
  );
}

