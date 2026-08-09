import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleAlert, Loader2, MapPin, Truck } from "lucide-react";
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
    if (!trackingEnabled || !token || !navigator.geolocation) return;
    const sendLocation = () => navigator.geolocation.getCurrentPosition(async (position) => {
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
        setLocationMessage("Геолокация обновляется примерно раз в 20 секунд");
      } catch {
        setLocationMessage("Не удалось отправить координаты — проверьте связь");
      }
    }, () => setLocationMessage("Браузер не разрешил доступ к геолокации"), {
      enableHighAccuracy: false,
      maximumAge: 15000,
      timeout: 10000,
    });
    sendLocation();
    const timer = window.setInterval(sendLocation, 20000);
    return () => window.clearInterval(timer);
  }, [trackingEnabled, token]);

  const enableTracking = () => {
    if (!navigator.geolocation) {
      setLocationMessage("Этот браузер не поддерживает геолокацию");
      return;
    }
    setTrackingEnabled(true);
    setLocationMessage("Запрашиваем разрешение на геолокацию…");
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
        <Card>
          <CardContent className="p-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">{locationMessage || "Диспетчер может видеть позицию машины"}</div>
            <Button size="sm" variant={trackingEnabled ? "secondary" : "outline"} onClick={enableTracking} disabled={trackingEnabled}>
              {trackingEnabled ? "Геолокация включена" : "Разрешить геолокацию"}
            </Button>
          </CardContent>
        </Card>
        {assignment.route_yandex_url && (
          <Button className="w-full h-11 gap-2" onClick={() => window.open(assignment.route_yandex_url, "_blank")}>
            <MapPin className="w-4 h-4" />
            Открыть маршрут в Яндекс Навигаторе
          </Button>
        )}
        {executions.map((execution) => {
          const draft = draftFor(execution);
          const isTerminal = terminalStatuses.has(draft.status);
          return (
            <Card key={execution.id} className={isTerminal ? "border-emerald-200" : ""}>
              <CardHeader className="pb-3">
                <div className="flex items-start gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isTerminal ? "bg-emerald-100 text-emerald-700" : "bg-primary/10 text-primary"}`}>
                    {isTerminal ? <CheckCircle2 className="w-4 h-4" /> : <span className="font-bold">{execution.visit_order}</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <CardTitle className="text-base">{execution.store_name}</CardTitle>
                    <p className="text-sm text-muted-foreground flex items-start gap-1 mt-1"><MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />{execution.address}</p>
                    {execution.arrive_by && <p className="text-xs text-primary mt-1">Ориентир: {execution.arrive_by}</p>}
                     {execution.products && <p className="text-xs text-muted-foreground mt-2">Груз: {execution.products}</p>}
                     <div className="mt-2 rounded-md bg-muted/60 px-2.5 py-2 text-xs">
                       <span className="font-medium">План: {execution.quantity}</span>
                       <span className="mx-1.5 text-muted-foreground">·</span>
                       <span className="font-medium">Доставлено: {execution.actual_qty}</span>
                       <span className="mx-1.5 text-muted-foreground">·</span>
                       <span className={execution.shortfall_qty > 0 ? "font-medium text-orange-700" : "font-medium text-emerald-700"}>
                         Остаток: {execution.shortfall_qty}
                       </span>
                     </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  <span className="text-xs text-muted-foreground">Действие по доставке</span>
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
                      <label className="block text-xs text-muted-foreground">Фактически доставлено
                        <input
                          type="number"
                          min={0}
                          max={execution.quantity}
                          step="any"
                          inputMode="decimal"
                          className="mt-1 w-full h-10 rounded-md border bg-background px-2 text-sm"
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
                  placeholder={draft.status === "rescheduled" ? "Причина переноса (обязательно)" : "Комментарий водителя"}
                  className="min-h-[54px]"
                  required={draft.status === "rescheduled"}
                />
                <div className="flex gap-2">
                  {execution.yandex_url && <Button variant="outline" className="flex-1" onClick={() => window.open(execution.yandex_url, "_blank")}>Навигация</Button>}
                  <Button className="flex-1" onClick={() => saveExecution(execution)} disabled={savingId === execution.id}>
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
