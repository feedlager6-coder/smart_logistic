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
  planned: "Запланировано",
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

  const saveExecution = async (execution: Execution) => {
    const draft = draftFor(execution);
    if (draft.status === "planned") {
      window.alert("Выберите действие по доставке");
      return;
    }
    const requestBody = {
      status: draft.status,
      // Quantity is meaningful only for delivered/partial. Omitting it for
      // failed/rescheduled keeps those actions independent from quantity.
      ...(draft.status === "delivered" || draft.status === "partial"
        ? { actual_qty: draft.actual_qty === "" ? undefined : Number(draft.actual_qty) }
        : {}),
      payment_method: draft.payment_method,
      payment_status: draft.payment_status,
      driver_comment: draft.driver_comment,
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
      if (wasLastOpenPoint && terminalStatuses.has(draft.status)) {
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
        <div className="max-w-2xl mx-auto">
          <p className="text-xs opacity-75 uppercase tracking-wide">SmartRoute · рейс</p>
          <div className="flex items-center justify-between gap-3 mt-1">
            <h1 className="text-xl font-bold truncate">{assignment.vehicle_name || "Маршрут доставки"}</h1>
            <Truck className="w-6 h-6 shrink-0" />
          </div>
          {assignment.driver_name && <p className="text-sm opacity-85 mt-1">Водитель: {assignment.driver_name}</p>}
          <div className="mt-3">
            <div className="flex justify-between text-xs mb-1"><span>Прогресс</span><span>{assignment.completed_points} из {assignment.total_points}</span></div>
            <div className="h-2 rounded-full bg-white/25 overflow-hidden"><div className="h-full bg-white rounded-full transition-all" style={{ width: `${progress}%` }} /></div>
          </div>
          {assignment.next_stop && <p className="text-xs opacity-90 mt-2">Следующая точка: {assignment.next_stop.store_name}</p>}
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-3">
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

        {assignment.route_yandex_url && (
          <Button className="w-full h-11 gap-2" onClick={() => window.open(assignment.route_yandex_url, "_blank")}>
            <Navigation className="w-4 h-4" />
            Открыть полный маршрут в Яндекс Навигаторе
          </Button>
        )}

        {executions.map((execution) => {
          const draft = draftFor(execution);
          const isTerminal = terminalStatuses.has(draft.status);
          const hasPhone = Boolean(execution.store_phone && execution.store_phone.trim());
          const cleanPhone = execution.store_phone ? execution.store_phone.replace(/[^\d+]/g, "") : "";

          return (
            <Card key={execution.id} className={isTerminal ? "border-emerald-200" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isTerminal ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"}`}>
                    {isTerminal ? <CheckCircle2 className="w-4 h-4" /> : <span className="font-bold">{execution.visit_order}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base font-semibold">{execution.store_name}</CardTitle>
                    <p className="text-sm text-muted-foreground flex items-start gap-1 mt-1">
                      <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span className="break-words">{execution.address}</span>
                    </p>
                    {execution.arrive_by && <p className="text-xs text-primary font-medium mt-1">Ориентир / время: {execution.arrive_by}</p>}
                    
                    {/* Customer & Phone info */}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {execution.store_client && (
                        <div className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="w-3.5 h-3.5 text-muted-foreground/70" />
                          <span>Клиент: <strong className="text-foreground font-medium">{execution.store_client}</strong></span>
                        </div>
                      )}
                      {hasPhone ? (
                        <a
                          href={`tel:${cleanPhone}`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-semibold hover:bg-emerald-100 transition-colors"
                        >
                          <PhoneCall className="w-3.5 h-3.5" />
                          <span>{execution.store_phone}</span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-muted-foreground italic flex items-center gap-1">
                          <Phone className="w-3 h-3 opacity-50" />
                          Телефон не указан
                        </span>
                      )}
                    </div>

                    {/* Prominent High-Visibility Cargo / Quantity Block */}
                    <div className="mt-3 p-3 rounded-xl bg-primary/5 border border-primary/15 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">К выгрузке / Заказ</div>
                        {execution.products ? (
                          <div className="text-xs font-medium text-foreground mt-0.5 break-words">
                            {execution.products}
                          </div>
                        ) : (
                          <div className="text-xs text-muted-foreground mt-0.5">Товары по накладной</div>
                        )}
                      </div>
                      <div className="text-right shrink-0 bg-background/90 px-3.5 py-2 rounded-lg border shadow-xs">
                        <div className="text-2xl sm:text-3xl font-black text-primary leading-none">
                          {execution.quantity}
                          <span className="text-xs font-bold text-muted-foreground ml-1.5">ед./шт.</span>
                        </div>
                        {isTerminal && (
                          <div className="text-[11px] font-semibold mt-1 text-muted-foreground">
                            Факт: <span className="text-foreground font-bold">{execution.actual_qty}</span>
                            {execution.shortfall_qty > 0 && (
                              <span className="text-destructive font-bold ml-1">· недовоз {execution.shortfall_qty}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-muted-foreground">Действие по доставке</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(["delivered", "partial", "failed", "rescheduled"] as const).map((status) => (
                      <Button
                        key={status}
                        type="button"
                        variant={draft.status === status ? "default" : "outline"}
                        className="h-12 text-sm font-semibold"
                        onClick={() => setDrafts((current) => ({
                          ...current,
                          [execution.id]: {
                            ...draft,
                            status,
                            actual_qty: status === "delivered"
                              ? execution.quantity
                              : status === "partial"
                                ? ""
                                : "",
                          },
                        }))}
                      >
                        {statusLabels[status]}
                      </Button>
                    ))}
                  </div>
                  {(draft.status === "delivered" || draft.status === "partial") && (
                    <>
                      <label className="block text-xs font-semibold text-muted-foreground">
                        Фактически доставлено (шт / ед)
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
                    </>
                  )}
                  <div className="space-y-2">
                    <span className="text-xs text-muted-foreground">Способ оплаты</span>
                    <div className="grid grid-cols-3 gap-2">
                      {paymentMethods.map((method) => (
                        <Button
                          key={method}
                          type="button"
                          variant={draft.payment_method === method ? "default" : "outline"}
                          className="h-11 text-sm"
                          onClick={() => setDrafts((current) => ({
                            ...current,
                            [execution.id]: { ...draft, payment_method: method },
                          }))}
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
                          className="h-11 text-sm"
                          onClick={() => setDrafts((current) => ({
                            ...current,
                            [execution.id]: { ...draft, payment_status: paymentStatus },
                          }))}
                        >
                          {paymentStatusLabels[paymentStatus]}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                <Textarea
                  value={draft.driver_comment}
                  onChange={(event) => setDrafts((current) => ({ ...current, [execution.id]: { ...draft, driver_comment: event.target.value } }))}
                  placeholder={draft.status === "rescheduled" ? "Причина переноса (обязательно)" : "Комментарий водителя (если есть проблемы)"}
                  className="min-h-[54px]"
                  required={draft.status === "rescheduled"}
                />

                <div className="flex flex-wrap gap-2 pt-1">
                  {hasPhone && (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 min-w-[120px] border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      onClick={() => {
                        window.location.href = `tel:${cleanPhone}`;
                      }}
                    >
                      <Phone className="w-4 h-4 mr-1.5" />
                      Позвонить
                    </Button>
                  )}
                  {execution.yandex_url && (
                    <Button
                      type="button"
                      variant="outline"
                      className="flex-1 min-w-[120px]"
                      onClick={() => window.open(execution.yandex_url, "_blank")}
                    >
                      <MapPin className="w-4 h-4 mr-1.5" />
                      Навигация
                    </Button>
                  )}
                  <Button
                    className="flex-1 min-w-[140px] font-semibold"
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
        })}
      </main>
    </div>
  );
}

