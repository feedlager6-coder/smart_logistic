import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Plug,
  RefreshCw,
  Settings,
  Trash2,
  Clock,
  Package,
  AlertTriangle,
  ChevronRight,
  ArrowLeft,
  Zap,
  Database,
  FileCode2,
  BarChart3,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
}

interface Integration {
  id: number;
  type: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  last_sync_at: string | null;
  created_at: string;
  stats?: {
    total_syncs: number;
    total_orders: number;
    total_matched: number;
    total_errors: number;
  };
}

interface SyncLog {
  id: number;
  started_at: string;
  status: string;
  orders_received: number;
  stores_matched: number;
  stores_unmatched: number;
  errors_count: number;
  error_detail: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || j.message || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function friendlyDate(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">🟢 Подключено</Badge>;
    case "error":
      return <Badge className="bg-red-100 text-red-800 border-red-200">🔴 Ошибка</Badge>;
    case "setup":
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200">🟡 Настройка</Badge>;
    case "disabled":
      return <Badge className="bg-gray-100 text-gray-600 border-gray-200">⚪ Отключено</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function downloadBase64(data: string, filename: string) {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Integration Cards Landing ────────────────────────────────────────────────

const INTEGRATION_CARDS = [
  {
    type: "1c",
    label: "1С:Предприятие",
    desc: "Автоматическая передача заказов из 1С в SmartRoute",
    icon: <FileCode2 className="w-8 h-8" />,
    color: "from-yellow-50 to-orange-50 border-orange-200",
    active: true,
  },
  {
    type: "moysklad",
    label: "МойСклад",
    desc: "Синхронизация заказов из МойСклад",
    icon: <Database className="w-8 h-8" />,
    color: "from-blue-50 to-blue-100 border-blue-200",
    active: false,
  },
  {
    type: "bitrix24",
    label: "Bitrix24",
    desc: "Интеграция с CRM и задачами Bitrix24",
    icon: <Zap className="w-8 h-8" />,
    color: "from-purple-50 to-purple-100 border-purple-200",
    active: false,
  },
  {
    type: "google_sheets",
    label: "Google Sheets",
    desc: "Загрузка заказов из Google-таблицы",
    icon: <BarChart3 className="w-8 h-8" />,
    color: "from-green-50 to-green-100 border-green-200",
    active: false,
  },
];

interface CardsViewProps {
  existingIntegrations: Integration[];
  onSelect: (type: string) => void;
  onOpenDashboard: (integration: Integration) => void;
}

function CardsView({ existingIntegrations, onSelect, onOpenDashboard }: CardsViewProps) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Интеграции</h1>
        <p className="text-muted-foreground">Подключите внешние системы для автоматической передачи заказов</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {INTEGRATION_CARDS.map((card) => {
          const existing = existingIntegrations.find((i) => i.type === card.type);
          return (
            <Card
              key={card.type}
              className={`relative border bg-gradient-to-br ${card.color} transition-all ${
                card.active ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : "opacity-60"
              }`}
              onClick={() => {
                if (!card.active) return;
                if (existing) onOpenDashboard(existing);
                else onSelect(card.type);
              }}
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="text-muted-foreground">{card.icon}</div>
                  {existing ? (
                    statusBadge(existing.status)
                  ) : !card.active ? (
                    <Badge variant="outline" className="text-xs">Скоро</Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs text-primary border-primary">Подключить</Badge>
                  )}
                </div>
                <CardTitle className="text-base mt-3">{card.label}</CardTitle>
                <CardDescription className="text-xs">{card.desc}</CardDescription>
              </CardHeader>
              {existing && (
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground">
                    Последняя синхр.: {friendlyDate(existing.last_sync_at)}
                  </p>
                </CardContent>
              )}
              {card.active && !existing && (
                <CardContent className="pt-0">
                  <div className="flex items-center gap-1 text-xs text-primary font-medium">
                    Настроить <ChevronRight className="w-3 h-3" />
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── Wizard ───────────────────────────────────────────────────────────────────

const FIELD_MAPPINGS_DEFAULT: Record<string, string> = {
  store_name: "Контрагент",
  address: "Адрес доставки",
  delivery_date: "Дата доставки",
  weight_kg: "Вес (кг)",
  quantity: "Количество мест",
  products: "Комментарий / Товары",
  amount_rub: "Сумма заказа",
  order_number: "Номер заказа",
};

const SMARTROUTE_FIELD_LABELS: Record<string, string> = {
  store_name: "Магазин (обязательно)",
  address: "Адрес доставки",
  delivery_date: "Дата доставки (обязательно)",
  weight_kg: "Вес, кг",
  quantity: "Количество мест",
  products: "Товары/комментарий",
  amount_rub: "Сумма, ₽",
  order_number: "Номер заказа",
};

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface WizardState {
  healthStatus: "idle" | "checking" | "ok" | "error";
  healthMessage: string;
  apiKeys: ApiKey[];
  selectedKeyId: number | null;
  testStatus: "idle" | "testing" | "ok" | "error";
  testMessage: string;
  fieldMappings: Record<string, string>;
  integrationId: number | null;
  saving: boolean;
  downloading: boolean;
}

interface OneCWizardProps {
  onBack: () => void;
  onDone: (integration: Integration) => void;
}

function OneCWizard({ onBack, onDone }: OneCWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<WizardStep>(1);
  const [state, setState] = useState<WizardState>({
    healthStatus: "idle",
    healthMessage: "",
    apiKeys: [],
    selectedKeyId: null,
    testStatus: "idle",
    testMessage: "",
    fieldMappings: { ...FIELD_MAPPINGS_DEFAULT },
    integrationId: null,
    saving: false,
    downloading: false,
  });

  useEffect(() => {
    apiFetch("/api/auth/api-keys")
      .then((keys: ApiKey[]) => {
        const valid = keys.filter((k) => k.is_active && k.scopes?.includes("orders:write"));
        setState((s) => ({ ...s, apiKeys: valid }));
      })
      .catch(() => {});
  }, []);

  const checkHealth = async () => {
    setState((s) => ({ ...s, healthStatus: "checking", healthMessage: "" }));
    try {
      await apiFetch("/api/healthz");
      setState((s) => ({ ...s, healthStatus: "ok", healthMessage: "✅ SmartRoute доступен и работает нормально" }));
    } catch {
      setState((s) => ({
        ...s,
        healthStatus: "error",
        healthMessage: "❌ Сервер SmartRoute недоступен. Попробуйте позже.",
      }));
    }
  };

  const downloadTemplate = async () => {
    setState((s) => ({ ...s, downloading: true }));
    try {
      // Download generic BSL template (without real API key)
      const hostname = window.location.origin;
      const bsl = generateBslTemplate(hostname, "ВАШИ_ДАННЫЕ_ИЗ_НАСТРОЕК");
      const encoder = new TextEncoder();
      const bytes = encoder.encode(bsl);
      const b64 = btoa(String.fromCharCode(...bytes));
      downloadBase64(b64, "SmartRoute_1C_Integration.bsl");
    } finally {
      setState((s) => ({ ...s, downloading: false }));
    }
  };

  const testApiKey = async () => {
    if (!state.selectedKeyId) return;
    setState((s) => ({ ...s, testStatus: "testing", testMessage: "" }));
    try {
      // Create integration first if not exists
      let integrationId = state.integrationId;
      if (!integrationId) {
        const newIntegration: Integration = await apiFetch("/api/integrations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "1c",
            name: "1C Интеграция",
            config: {
              api_key_id: state.selectedKeyId,
              base_url: window.location.origin,
            },
          }),
        });
        integrationId = newIntegration.id;
        setState((s) => ({ ...s, integrationId }));
      } else {
        // Update api_key_id
        await apiFetch(`/api/integrations/${integrationId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: { api_key_id: state.selectedKeyId } }),
        });
      }
      // Test connection
      const result = await apiFetch(`/api/integrations/${integrationId}/test`, { method: "POST" });
      if (result.ok) {
        setState((s) => ({ ...s, testStatus: "ok", testMessage: result.message }));
      } else {
        setState((s) => ({ ...s, testStatus: "error", testMessage: result.message }));
      }
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        testStatus: "error",
        testMessage: `❌ Ошибка: ${e instanceof Error ? e.message : String(e)}`,
      }));
    }
  };

  const saveFieldMappings = async () => {
    if (!state.integrationId) return;
    setState((s) => ({ ...s, saving: true }));
    try {
      await apiFetch(`/api/integrations/${state.integrationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: { field_mappings: state.fieldMappings },
        }),
      });
      setStep(5);
    } catch (e: unknown) {
      toast({ title: "Ошибка", description: `${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
    } finally {
      setState((s) => ({ ...s, saving: false }));
    }
  };

  const downloadPersonalizedModule = async () => {
    if (!state.integrationId) return;
    setState((s) => ({ ...s, downloading: true }));
    try {
      const result = await apiFetch(`/api/integrations/${state.integrationId}/download-module`);
      downloadBase64(result.data, result.filename);
      toast({ title: "Модуль скачан", description: "Файл SmartRoute_1C_Integration.bsl готов к установке" });
    } catch (e: unknown) {
      toast({ title: "Ошибка скачивания", description: `${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
    } finally {
      setState((s) => ({ ...s, downloading: false }));
    }
  };

  const finishWizard = async () => {
    if (!state.integrationId) return;
    try {
      const integration: Integration = await apiFetch(`/api/integrations/${state.integrationId}`);
      onDone(integration);
    } catch {
      onDone({ id: state.integrationId!, type: "1c", name: "1C Интеграция", status: "setup", config: {}, last_sync_at: null, created_at: new Date().toISOString() });
    }
  };

  const STEPS = [
    { n: 1, label: "Проверка" },
    { n: 2, label: "Модуль" },
    { n: 3, label: "API-ключ" },
    { n: 4, label: "Поля" },
    { n: 5, label: "Готово" },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-6" onClick={onBack}>
        <ArrowLeft className="w-4 h-4 mr-1" /> Назад к интеграциям
      </Button>

      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Подключение 1С:Предприятие</h1>
        <p className="text-muted-foreground text-sm">Мастер настройки — около 5 минут</p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.n}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  step === s.n
                    ? "bg-primary text-primary-foreground"
                    : step > s.n
                    ? "bg-emerald-500 text-white"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step > s.n ? <CheckCircle2 className="w-4 h-4" /> : s.n}
              </div>
              <span className="text-xs text-muted-foreground hidden sm:block">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mb-4 ${step > s.n ? "bg-emerald-500" : "bg-muted"}`} />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <Card>
        <CardContent className="p-6">
          {/* ── Step 1: Health check ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">Шаг 1: Проверка SmartRoute</h2>
                <p className="text-sm text-muted-foreground">Убедимся, что SmartRoute доступен и готов к интеграции</p>
              </div>
              <Button
                onClick={checkHealth}
                disabled={state.healthStatus === "checking"}
                className="w-full"
              >
                {state.healthStatus === "checking" ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Проверяем...</>
                ) : (
                  <><Zap className="w-4 h-4 mr-2" /> Проверить соединение</>
                )}
              </Button>
              {state.healthMessage && (
                <Alert className={state.healthStatus === "ok" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}>
                  <AlertDescription className={state.healthStatus === "ok" ? "text-emerald-800" : "text-red-800"}>
                    {state.healthMessage}
                  </AlertDescription>
                </Alert>
              )}
              <Button
                className="w-full"
                disabled={state.healthStatus !== "ok"}
                onClick={() => setStep(2)}
              >
                Далее <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}

          {/* ── Step 2: Download module ── */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">Шаг 2: Модуль для 1С</h2>
                <p className="text-sm text-muted-foreground">
                  Скачайте готовый BSL-модуль и установите в вашу 1С
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={downloadTemplate}
                disabled={state.downloading}
              >
                {state.downloading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Скачивание...</>
                ) : (
                  <><Download className="w-4 h-4 mr-2" /> Скачать модуль SmartRoute.bsl</>
                )}
              </Button>
              <div className="bg-muted/50 rounded-lg p-4 space-y-2 text-sm">
                <p className="font-medium text-foreground">Установка за 3 шага:</p>
                <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
                  <li>Откройте 1С в режиме <strong>Конфигуратора</strong></li>
                  <li>Меню <strong>Файл → Открыть</strong> → выберите скачанный файл <code className="text-xs bg-background px-1 py-0.5 rounded">.bsl</code></li>
                  <li>Заполните поля URL и API-ключ (настроим на следующих шагах)</li>
                </ol>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(1)} className="flex-1">Назад</Button>
                <Button onClick={() => setStep(3)} className="flex-1">
                  Далее <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 3: API Key ── */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">Шаг 3: API-ключ</h2>
                <p className="text-sm text-muted-foreground">
                  Выберите ключ с правом <code className="text-xs bg-muted px-1 rounded">orders:write</code> — он будет использован для передачи заказов из 1С
                </p>
              </div>
              {state.apiKeys.length === 0 ? (
                <Alert className="border-amber-200 bg-amber-50">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <AlertDescription className="text-amber-800 text-sm ml-2">
                    Нет подходящих ключей. Перейдите в{" "}
                    <a href="/settings" className="underline font-medium">Настройки → API-ключи</a>{" "}
                    и создайте ключ с правом <strong>orders:write</strong>.
                  </AlertDescription>
                </Alert>
              ) : (
                <Select
                  value={state.selectedKeyId ? String(state.selectedKeyId) : ""}
                  onValueChange={(v) =>
                    setState((s) => ({
                      ...s,
                      selectedKeyId: Number(v),
                      testStatus: "idle",
                      testMessage: "",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Выберите API-ключ..." />
                  </SelectTrigger>
                  <SelectContent>
                    {state.apiKeys.map((k) => (
                      <SelectItem key={k.id} value={String(k.id)}>
                        {k.name} — {k.key_prefix}…
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {state.selectedKeyId && (
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={testApiKey}
                  disabled={state.testStatus === "testing"}
                >
                  {state.testStatus === "testing" ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Проверяем...</>
                  ) : (
                    <><Plug className="w-4 h-4 mr-2" /> Проверить соединение</>
                  )}
                </Button>
              )}
              {state.testMessage && (
                <Alert className={state.testStatus === "ok" ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}>
                  <AlertDescription className={state.testStatus === "ok" ? "text-emerald-800" : "text-red-800"}>
                    {state.testMessage}
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(2)} className="flex-1">Назад</Button>
                <Button
                  className="flex-1"
                  disabled={state.testStatus !== "ok"}
                  onClick={() => setStep(4)}
                >
                  Далее <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 4: Field mapping ── */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold mb-1">Шаг 4: Сопоставление полей</h2>
                <p className="text-sm text-muted-foreground">
                  Укажите, как называются соответствующие поля в вашей 1С
                </p>
              </div>
              <div className="space-y-3">
                {Object.entries(SMARTROUTE_FIELD_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-center gap-3">
                    <div className="w-44 shrink-0">
                      <p className="text-sm font-medium text-foreground">{label}</p>
                      <p className="text-xs text-muted-foreground">SmartRoute</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    <input
                      className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={state.fieldMappings[key] ?? ""}
                      onChange={(e) =>
                        setState((s) => ({
                          ...s,
                          fieldMappings: { ...s.fieldMappings, [key]: e.target.value },
                        }))
                      }
                      placeholder="Поле в 1С..."
                    />
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground bg-muted/40 rounded p-3">
                💡 Эти названия используются в BSL-модуле для маппинга полей из 1С. Отредактируйте при необходимости.
              </p>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setStep(3)} className="flex-1">Назад</Button>
                <Button
                  className="flex-1"
                  onClick={saveFieldMappings}
                  disabled={state.saving}
                >
                  {state.saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                  Далее <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}

          {/* ── Step 5: Done ── */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="text-center py-2">
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                </div>
                <h2 className="text-lg font-semibold mb-1">Интеграция настроена!</h2>
                <p className="text-sm text-muted-foreground">
                  Осталось установить персональный модуль в 1С и начать отправку заказов
                </p>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={downloadPersonalizedModule}
                disabled={state.downloading}
              >
                {state.downloading ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Генерируем модуль...</>
                ) : (
                  <><Download className="w-4 h-4 mr-2" /> Скачать настроенный модуль 1С</>
                )}
              </Button>
              <div className="bg-muted/50 rounded-lg p-4 text-sm space-y-2">
                <p className="font-medium">Что дальше:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Скачайте и откройте модуль в 1С Конфигураторе</li>
                  <li>Вставьте ваш API-ключ из SmartRoute в поле <code className="text-xs bg-background px-1 rounded">APIКлюч</code></li>
                  <li>Запустите функцию <code className="text-xs bg-background px-1 rounded">ОтправитьЗаявкиВSmartRoute()</code></li>
                  <li>Настройте регламентное задание для автозапуска</li>
                </ol>
              </div>
              <Button className="w-full" onClick={finishWizard}>
                Открыть панель интеграции →
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

interface DashboardProps {
  integration: Integration;
  onBack: () => void;
  onDeleted: () => void;
}

function OneCDashboard({ integration: initialIntegration, onBack, onDeleted }: DashboardProps) {
  const { toast } = useToast();
  const [integration, setIntegration] = useState<Integration>(initialIntegration);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showDelete, setShowDelete] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [int_, lgs] = await Promise.all([
        apiFetch(`/api/integrations/${integration.id}`),
        apiFetch(`/api/integrations/${integration.id}/logs`),
      ]);
      setIntegration(int_);
      setLogs(lgs);
    } catch (e: unknown) {
      toast({ title: "Ошибка", description: `${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [integration.id, toast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await apiFetch(`/api/integrations/${integration.id}/sync`, { method: "POST" });
      toast({ title: "Проверка выполнена", description: "Статус обновлён" });
      await refresh();
    } catch (e: unknown) {
      toast({ title: "Ошибка", description: `${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const handleToggle = async () => {
    const newStatus = integration.status === "disabled" ? "active" : "disabled";
    try {
      const updated: Integration = await apiFetch(`/api/integrations/${integration.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setIntegration(updated);
      toast({ title: newStatus === "disabled" ? "Интеграция отключена" : "Интеграция включена" });
    } catch (e: unknown) {
      toast({ title: "Ошибка", description: `${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    try {
      await fetch(`/api/integrations/${integration.id}`, { method: "DELETE" });
      toast({ title: "Интеграция удалена" });
      onDeleted();
    } catch (e: unknown) {
      toast({ title: "Ошибка", description: `${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
    }
  };

  const downloadModule = async () => {
    try {
      const result = await apiFetch(`/api/integrations/${integration.id}/download-module`);
      downloadBase64(result.data, result.filename);
    } catch (e: unknown) {
      toast({ title: "Ошибка", description: `${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
    }
  };

  const stats = integration.stats ?? { total_syncs: 0, total_orders: 0, total_matched: 0, total_errors: 0 };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="mb-2 -ml-2" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Интеграции
          </Button>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <FileCode2 className="w-6 h-6 text-orange-500" />
            1С:Предприятие
            {statusBadge(integration.status)}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Последняя синхронизация: {friendlyDate(integration.last_sync_at)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button
            size="sm"
            onClick={handleSync}
            disabled={syncing || integration.status === "disabled"}
          >
            {syncing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Zap className="w-4 h-4 mr-2" />}
            Проверить сейчас
          </Button>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Синхронизаций", value: stats.total_syncs, icon: <RefreshCw className="w-4 h-4" />, color: "text-blue-600" },
          { label: "Заказов получено", value: stats.total_orders, icon: <Package className="w-4 h-4" />, color: "text-emerald-600" },
          { label: "Магазинов найдено", value: stats.total_matched, icon: <CheckCircle2 className="w-4 h-4" />, color: "text-emerald-600" },
          { label: "Ошибок", value: stats.total_errors, icon: <XCircle className="w-4 h-4" />, color: stats.total_errors > 0 ? "text-red-600" : "text-muted-foreground" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className={`flex items-center gap-2 mb-2 ${s.color}`}>
                {s.icon}
                <span className="text-xs font-medium">{s.label}</span>
              </div>
              <p className="text-2xl font-bold">{s.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Logs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Журнал синхронизаций
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {logs.length === 0 ? (
            <div className="px-6 py-8 text-center text-muted-foreground text-sm">
              Синхронизаций ещё не было. Отправьте первую партию заказов из 1С.
            </div>
          ) : (
            <div className="divide-y">
              {logs.map((log) => (
                <div key={log.id} className="flex items-start gap-4 px-6 py-3">
                  <div className="shrink-0 mt-0.5">
                    {log.status === "success" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    ) : log.status === "partial" ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">
                        {log.orders_received} заказов
                      </span>
                      {log.stores_matched > 0 && (
                        <span className="text-xs text-emerald-600">• найдено {log.stores_matched}</span>
                      )}
                      {log.stores_unmatched > 0 && (
                        <span className="text-xs text-amber-600">• не найдено {log.stores_unmatched}</span>
                      )}
                      {log.errors_count > 0 && (
                        <span className="text-xs text-red-600">• ошибок {log.errors_count}</span>
                      )}
                    </div>
                    {log.error_detail && log.error_detail !== "Ручная проверка" && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.error_detail}</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{friendlyDate(log.started_at)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Settings className="w-4 h-4" /> Управление
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button variant="outline" size="sm" onClick={downloadModule}>
            <Download className="w-4 h-4 mr-2" /> Скачать модуль 1С
          </Button>
          <Button variant="outline" size="sm" onClick={handleToggle}>
            {integration.status === "disabled" ? (
              <><CheckCircle2 className="w-4 h-4 mr-2" /> Включить</>
            ) : (
              <><XCircle className="w-4 h-4 mr-2" /> Отключить</>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-red-600 border-red-200 hover:bg-red-50"
            onClick={() => setShowDelete(true)}
          >
            <Trash2 className="w-4 h-4 mr-2" /> Удалить интеграцию
          </Button>
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить интеграцию?</AlertDialogTitle>
            <AlertDialogDescription>
              Все настройки и журнал синхронизаций будут удалены. Заказы, уже переданные в SmartRoute, останутся.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground" onClick={handleDelete}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}

// ─── BSL template generator (client-side, no API key embedded) ───────────────

function generateBslTemplate(baseUrl: string, apiKeyPlaceholder: string): string {
  return `// SmartRoute — Модуль интеграции для 1С:Предприятие 8.3+
// Версия: 2.0
// 
// УСТАНОВКА:
// 1. Откройте 1С в режиме Конфигуратора
// 2. Файл → Открыть → выберите этот файл
// 3. Укажите URL SmartRoute и ваш API-ключ ниже
// 4. Вызовите ОтправитьЗаявкиВSmartRoute() или настройте регламентное задание

#Область НастройкиИнтеграции

Перем НастройкиSmartRoute;

Процедура ИнициализироватьНастройки()
    НастройкиSmartRoute = Новый Структура;
    НастройкиSmartRoute.Вставить("URL",          "${baseUrl}");
    НастройкиSmartRoute.Вставить("APIКлюч",      "${apiKeyPlaceholder}");
    НастройкиSmartRoute.Вставить("ЗаменитьДату", Истина);
КонецПроцедуры

#КонецОбласти

// ... (полный модуль доступен в SmartRoute → Интеграции → 1С → Скачать настроенный модуль)
`;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type View = "cards" | "wizard" | "dashboard";

export function IntegrationsPage() {
  const [view, setView] = useState<View>("cards");
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [selectedIntegration, setSelectedIntegration] = useState<Integration | null>(null);
  const [loadingList, setLoadingList] = useState(true);

  const loadIntegrations = useCallback(async () => {
    setLoadingList(true);
    try {
      const list: Integration[] = await apiFetch("/api/integrations");
      setIntegrations(list);
    } catch {}
    finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  if (loadingList && view === "cards") {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (view === "wizard") {
    return (
      <OneCWizard
        onBack={() => setView("cards")}
        onDone={(integration) => {
          setSelectedIntegration(integration);
          loadIntegrations();
          setView("dashboard");
        }}
      />
    );
  }

  if (view === "dashboard" && selectedIntegration) {
    return (
      <OneCDashboard
        integration={selectedIntegration}
        onBack={() => {
          loadIntegrations();
          setView("cards");
        }}
        onDeleted={() => {
          loadIntegrations();
          setView("cards");
        }}
      />
    );
  }

  return (
    <CardsView
      existingIntegrations={integrations}
      onSelect={() => setView("wizard")}
      onOpenDashboard={(integration) => {
        setSelectedIntegration(integration);
        setView("dashboard");
      }}
    />
  );
}
