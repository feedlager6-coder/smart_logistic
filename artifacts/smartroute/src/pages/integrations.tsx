import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
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
  RefreshCw,
  Trash2,
  Clock,
  Package,
  AlertTriangle,
  ChevronDown,
  ArrowLeft,
  Database,
  BarChart3,
  Copy,
  Check,
  Info,
  Wifi,
  WifiOff,
  Zap,
  Mail,
  RotateCcw,
  ArrowRight,
  Building2,
  Shield,
  ExternalLink,
  FileText,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  pending_stores?: number;
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

interface SetupResult {
  id: number;
  type: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  last_sync_at: string | null;
  created_at: string;
  api_key_id: number;
  key_prefix: string;
  full_key: string;
  base_url: string;
  package_b64: string;
}

interface StatusInfo {
  label: string;
  colorClass: string;
  icon: React.ReactNode;
  description: string;
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
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function downloadZip(b64: string, filename: string) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Derive a granular, human-readable status from integration + logs */
function deriveStatus(integration: Integration, logs: SyncLog[]): StatusInfo {
  const realLogs = logs.filter((l) => l.error_detail !== "Ручная проверка");
  const errorLogs = realLogs.filter((l) => l.status === "error");
  const lastErrorDetail = (errorLogs[0]?.error_detail ?? "").toLowerCase();

  const isAuthError =
    lastErrorDetail.includes("401") ||
    lastErrorDetail.includes("403") ||
    lastErrorDetail.includes("unauthorized") ||
    lastErrorDetail.includes("forbidden") ||
    lastErrorDetail.includes("ключ") ||
    lastErrorDetail.includes("токен");

  const isConnError =
    lastErrorDetail.includes("connect") ||
    lastErrorDetail.includes("timeout") ||
    lastErrorDetail.includes("ssl") ||
    lastErrorDetail.includes("network") ||
    lastErrorDetail.includes("соединени");

  switch (integration.status) {
    case "active": {
      const stats = integration.stats;
      if (stats && stats.total_orders === 0) {
        return {
          label: "Первое соединение",
          colorClass: "text-blue-700 bg-blue-50 border-blue-200",
          icon: <Wifi className="w-3.5 h-3.5" />,
          description: "Подключение установлено. Заказы начнут поступать по расписанию в 07:30.",
        };
      }
      const staleMs = integration.last_sync_at
        ? Date.now() - new Date(integration.last_sync_at).getTime()
        : Infinity;
      if (staleMs > 26 * 3600 * 1000) {
        return {
          label: "Нет новых данных",
          colorClass: "text-amber-700 bg-amber-50 border-amber-200",
          icon: <Clock className="w-3.5 h-3.5" />,
          description: "Последняя синхронизация была более суток назад",
        };
      }
      return {
        label: "Интеграция работает",
        colorClass: "text-emerald-700 bg-emerald-50 border-emerald-200",
        icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        description: `Последняя синхронизация: ${friendlyDate(integration.last_sync_at)}`,
      };
    }
    case "error":
      if (isAuthError) {
        return {
          label: "Ошибка авторизации",
          colorClass: "text-red-700 bg-red-50 border-red-200",
          icon: <XCircle className="w-3.5 h-3.5" />,
          description: "Ключ доступа недействителен или истёк. Пересоздайте подключение.",
        };
      }
      if (isConnError) {
        return {
          label: "Не удалось соединиться",
          colorClass: "text-red-700 bg-red-50 border-red-200",
          icon: <WifiOff className="w-3.5 h-3.5" />,
          description: "Нет связи с 1С. Проверьте интернет-доступ на сервере 1С.",
        };
      }
      return {
        label: "Ошибка синхронизации",
        colorClass: "text-red-700 bg-red-50 border-red-200",
        icon: <XCircle className="w-3.5 h-3.5" />,
        description: "Проверьте журнал ниже для деталей",
      };
    case "disabled":
      return {
        label: "Приостановлена",
        colorClass: "text-gray-600 bg-gray-50 border-gray-200",
        icon: <WifiOff className="w-3.5 h-3.5" />,
        description: "Синхронизация отключена вручную",
      };
    case "setup":
    default:
      if (
        realLogs.length > 0 &&
        realLogs.some((l) => l.status === "error" || (l.status === "partial" && l.errors_count > 0))
      ) {
        return {
          label: "Ошибка при первом подключении",
          colorClass: "text-red-700 bg-red-50 border-red-200",
          icon: <AlertTriangle className="w-3.5 h-3.5" />,
          description: "Файл установлен, но при первом подключении возникла ошибка",
        };
      }
      return {
        label: "Ожидает установки",
        colorClass: "text-amber-700 bg-amber-50 border-amber-200",
        icon: <Clock className="w-3.5 h-3.5" />,
        description: "Ждём первую синхронизацию из 1С",
      };
  }
}

// ─── CopyButton ───────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors shrink-0"
      title="Скопировать"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
      {label ?? (copied ? "Скопировано!" : "Копировать")}
    </button>
  );
}

// ─── Landing ──────────────────────────────────────────────────────────────────

interface LandingProps {
  existingIntegration: Integration | null;
  onConnect: () => void;
  onOpenDashboard: () => void;
}

function IntegrationsLanding({ existingIntegration, onConnect, onOpenDashboard }: LandingProps) {
  return (
    <div className="max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">Интеграции</h1>
        <p className="text-muted-foreground">
          Подключите учётную систему — заказы будут поступать в SmartRoute автоматически
        </p>
      </div>

      {/* 1C Hero Card */}
      <div className="relative rounded-2xl border-2 border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-6 mb-6 overflow-hidden">
        <div className="absolute top-0 right-0 w-48 h-48 opacity-5">
          <Building2 className="w-full h-full text-orange-900" />
        </div>

        <div className="relative">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center font-bold text-orange-700 text-lg">
                1С
              </div>
              <div>
                <h2 className="text-lg font-bold text-gray-900">1С:Предприятие</h2>
                <p className="text-sm text-orange-700">Версия 8.3 и выше · Любая конфигурация</p>
              </div>
            </div>
            {existingIntegration ? (
              <Badge
                className={`text-xs ${
                  existingIntegration.status === "active"
                    ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                    : existingIntegration.status === "error"
                    ? "bg-red-100 text-red-800 border-red-200"
                    : "bg-amber-100 text-amber-800 border-amber-200"
                }`}
              >
                {existingIntegration.status === "active"
                  ? "🟢 Работает"
                  : existingIntegration.status === "error"
                  ? "🔴 Ошибка"
                  : "🟡 Настраивается"}
              </Badge>
            ) : null}
          </div>

          {existingIntegration ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-700">
                {existingIntegration.status === "active"
                  ? `Заказы передаются автоматически. Последняя синхронизация: ${friendlyDate(existingIntegration.last_sync_at)}`
                  : existingIntegration.status === "error"
                  ? "Возникла ошибка при синхронизации. Откройте панель управления для деталей."
                  : "Интеграция настраивается. Ожидаем первое подключение из 1С."}
              </p>
              <Button onClick={onOpenDashboard} className="w-full sm:w-auto">
                Открыть панель управления <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-700 leading-relaxed">
                Заказы из 1С передаются в SmartRoute каждое утро — вы строите маршруты, не вводите данные вручную.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  "Автоматическая передача заказов в 07:30",
                  "Работает с любой конфигурацией 1С 8.3+",
                  "История всех синхронизаций и статистика",
                  "Настройка займёт ~20 минут у специалиста",
                ].map((benefit) => (
                  <div key={benefit} className="flex items-center gap-2 text-sm text-gray-700">
                    <CheckCircle2 className="w-4 h-4 text-orange-500 shrink-0" />
                    <span>{benefit}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Button size="lg" onClick={onConnect} className="bg-orange-600 hover:bg-orange-700 text-white">
                  Подключить 1С:Предприятие <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Coming soon */}
      <div>
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Скоро</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { name: "МойСклад", icon: <Database className="w-5 h-5" />, color: "text-blue-500" },
            { name: "Bitrix24", icon: <Zap className="w-5 h-5" />, color: "text-purple-500" },
            { name: "Google Sheets", icon: <BarChart3 className="w-5 h-5" />, color: "text-green-500" },
          ].map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30 opacity-60"
            >
              <div className={item.color}>{item.icon}</div>
              <span className="text-sm font-medium">{item.name}</span>
              <Badge variant="outline" className="ml-auto text-xs">Скоро</Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Setup Flow ───────────────────────────────────────────────────────────────

type SetupStep = 0 | 1 | 2 | 3;

interface SetupFlowProps {
  onBack: () => void;
  onDone: (integration: Integration) => void;
}

function OneCSetupFlow({ onBack, onDone }: SetupFlowProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<SetupStep>(0);
  const [result, setResult] = useState<SetupResult | null>(null);
  const [fileDownloaded, setFileDownloaded] = useState(false);
  const [showSpecialistGuide, setShowSpecialistGuide] = useState(false);

  const [pollStatus, setPollStatus] = useState<"waiting" | "connected">("waiting");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = useCallback((integrationId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const integration: Integration = await apiFetch(`/api/integrations/${integrationId}`);
        if (integration.status === "active" || integration.status === "error") {
          setPollStatus("connected");
          clearInterval(pollRef.current!);
          return;
        }
        const logs: SyncLog[] = await apiFetch(`/api/integrations/${integrationId}/logs?limit=5`);
        const realLogs = logs.filter((l) => l.error_detail !== "Ручная проверка");
        if (realLogs.length > 0) {
          setPollStatus("connected");
          clearInterval(pollRef.current!);
        }
      } catch {}
    }, 5000);
  }, []);

  useEffect(() => {
    if (step === 3 && result?.id) startPolling(result.id);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, result?.id, startPolling]);

  const handleStart = async () => {
    setStep(1);
    try {
      const data: SetupResult = await apiFetch("/api/integrations/quick-setup", { method: "POST" });
      setResult(data);
      setStep(2);
    } catch (e: unknown) {
      toast({
        title: "Не удалось создать канал подключения",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
      setStep(0);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    downloadZip(result.package_b64, "SmartRoute_Setup.zip");
    setFileDownloaded(true);
    toast({
      title: "Файл скачан",
      description: "Передайте SmartRoute_Setup.zip специалисту по 1С — внутри файл и инструкция.",
    });
  };

  const handleEmailSpecialist = () => {
    if (!result) return;
    const subject = encodeURIComponent("SmartRoute — файл подключения к 1С");
    const body = encodeURIComponent(
      `Привет!\n\n` +
      `Нужно подключить нашу систему SmartRoute к 1С.\n` +
      `Скачай архив SmartRoute_Setup.zip — внутри файл SmartRoute.epf и инструкция.\n\n` +
      `Что нужно сделать:\n` +
      `1. Открой файл SmartRoute.epf в 1С\n` +
      `2. Введи параметры подключения из инструкции\n` +
      `3. Проверь соединение\n` +
      `4. Настрой автоматическую отправку в 07:30\n\n` +
      `Адрес SmartRoute: ${result.base_url}\n\n` +
      `Все детали и ключ доступа — в файле Инструкция.txt внутри архива.\n\n` +
      `Если вопросы — support@smartroute.app\n\nСпасибо!`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
  };

  const handleFinish = async () => {
    if (!result) return;
    try {
      const integration: Integration = await apiFetch(`/api/integrations/${result.id}`);
      onDone(integration);
    } catch {
      onDone({
        id: result.id,
        type: "1c",
        name: "1С:Предприятие",
        status: "setup",
        config: {},
        last_sync_at: null,
        created_at: new Date().toISOString(),
      });
    }
  };

  const STEPS = [
    { n: 0, label: "Запуск", done: step > 0 },
    { n: 1, label: "Файл", done: step > 2 },
    { n: 2, label: "Готово", done: pollStatus === "connected" },
  ];

  return (
    <div className="max-w-3xl">
      <Button variant="ghost" size="sm" className="mb-6" onClick={onBack}>
        <ArrowLeft className="w-4 h-4 mr-1" /> Интеграции
      </Button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Подключение 1С:Предприятие</h1>
        <p className="text-sm text-muted-foreground">
          Около 5 минут с вашей стороны и 20 минут у специалиста по 1С.
        </p>
      </div>

      {/* Progress indicator */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.n}>
            <div className="flex flex-col items-center gap-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                  s.done
                    ? "bg-emerald-500 text-white"
                    : step === s.n || (s.n === 1 && (step === 1 || step === 2))
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {s.done ? <CheckCircle2 className="w-4 h-4" /> : i + 1}
              </div>
              <span className="text-xs text-muted-foreground hidden sm:block">{s.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div
                className={`flex-1 h-0.5 mb-4 transition-colors ${s.done ? "bg-emerald-500" : "bg-muted"}`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">

          {/* ── Step 0: Explanation ── */}
          {step === 0 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-1">Как это работает</h2>
                <p className="text-sm text-muted-foreground">Три простых шага — и заказы поступают автоматически.</p>
              </div>

              <div className="space-y-3">
                {[
                  {
                    time: "~ 2 сек",
                    icon: <Shield className="w-5 h-5 text-primary" />,
                    title: "SmartRoute создаёт защищённый канал",
                    desc: "Уникальный ключ доступа и файл подключения генерируются автоматически.",
                  },
                  {
                    time: "~ 5 мин",
                    icon: <Download className="w-5 h-5 text-primary" />,
                    title: "Скачайте SmartRoute.epf и передайте специалисту",
                    desc: "Один файл с готовыми настройками. Пересылаете по почте или мессенджеру.",
                  },
                  {
                    time: "~ 20 мин",
                    icon: <Building2 className="w-5 h-5 text-primary" />,
                    title: "Специалист устанавливает файл в 1С",
                    desc: "Без вмешательства в конфигурацию. Заказы начинают поступать автоматически в 07:30.",
                  },
                ].map((item) => (
                  <div key={item.title} className="flex gap-4 p-4 rounded-lg border bg-muted/30">
                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                        <p className="text-sm font-semibold">{item.title}</p>
                        <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{item.time}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <Alert className="border-blue-200 bg-blue-50">
                <Info className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800 text-sm ml-2">
                  <strong>Нет специалиста по 1С?</strong> Напишите нам на{" "}
                  <a href="mailto:support@smartroute.app" className="underline font-medium">
                    support@smartroute.app
                  </a>{" "}
                  — поможем организовать установку.
                </AlertDescription>
              </Alert>

              <Button size="lg" className="w-full" onClick={handleStart}>
                Начать подключение <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </div>
          )}

          {/* ── Step 1: Creating ── */}
          {step === 1 && (
            <div className="py-12 flex flex-col items-center gap-4 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
              <div>
                <p className="font-semibold text-lg">Создаём защищённый канал...</p>
                <p className="text-sm text-muted-foreground mt-1">Готовим файл подключения и ключ доступа</p>
              </div>
            </div>
          )}

          {/* ── Step 2: Download EPF ── */}
          {step === 2 && result && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <h2 className="text-lg font-semibold">Канал создан! Передайте файл специалисту</h2>
                </div>
                <p className="text-sm text-muted-foreground">
                  Скачайте архив и отправьте его специалисту по 1С — он сделает остальное.
                </p>
              </div>

              {/* EPF download */}
              <div className="rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 p-5 text-center space-y-3">
                <div className="w-14 h-14 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
                  <Package className="w-7 h-7 text-primary" />
                </div>
                <div>
                  <p className="font-semibold">SmartRoute_Setup.zip</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Содержит файл SmartRoute.epf и инструкцию. Параметры подключения уже встроены.
                  </p>
                </div>
                <Button onClick={handleDownload} className="w-full" size="lg">
                  <Download className="w-4 h-4 mr-2" />
                  Скачать SmartRoute.epf
                </Button>
                {fileDownloaded && (
                  <p className="text-xs text-emerald-600 flex items-center justify-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Файл скачан
                  </p>
                )}
              </div>

              {/* Connection params (for reference) */}
              <div className="rounded-lg border bg-amber-50 border-amber-200 p-4 space-y-3">
                <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide">
                  Параметры (уже в архиве — для справки)
                </p>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-amber-700 mb-1">Адрес SmartRoute:</p>
                    <div className="flex items-center gap-2 bg-white rounded border border-amber-200 px-3 py-2">
                      <code className="text-xs font-mono flex-1 break-all">{result.base_url}</code>
                      <CopyButton text={result.base_url} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 mb-1">
                      Ключ доступа{" "}
                      <span className="font-normal">(в архиве; показывается только сейчас)</span>:
                    </p>
                    <div className="flex items-center gap-2 bg-white rounded border border-amber-200 px-3 py-2">
                      <code className="text-xs font-mono flex-1 break-all">{result.full_key}</code>
                      <CopyButton text={result.full_key} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Email */}
              <Button variant="outline" className="w-full" onClick={handleEmailSpecialist}>
                <Mail className="w-4 h-4 mr-2" /> Написать специалисту по email
              </Button>

              {/* Technical instructions — clearly for specialist only */}
              <div className="rounded-lg border overflow-hidden">
                <button
                  className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
                  onClick={() => setShowSpecialistGuide((v) => !v)}
                >
                  <span className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                    Техническая инструкция для специалиста 1С
                  </span>
                  <ChevronDown
                    className={`w-4 h-4 text-muted-foreground transition-transform ${
                      showSpecialistGuide ? "rotate-180" : ""
                    }`}
                  />
                </button>
                {showSpecialistGuide && (
                  <div className="px-4 pb-4 space-y-3 border-t bg-muted/20">
                    <p className="text-xs text-muted-foreground pt-3">
                      Эти шаги описаны в файле Инструкция.txt внутри архива. Полная страница —{" "}
                      <a href="/integrations/1c/specialist" target="_blank" className="underline text-primary font-medium">
                        открыть для специалиста <ExternalLink className="w-3 h-3 inline" />
                      </a>
                    </p>
                    <ol className="space-y-2.5">
                      {[
                        "Запустите 1С:Предприятие (режим Предприятия, не Конфигуратор).",
                        "Файл → Открыть → выберите SmartRoute.epf из архива.",
                        "Введите адрес SmartRoute и ключ доступа из раздела «Параметры» выше.",
                        "Нажмите «Проверить соединение» — ожидается «✅ Соединение успешно».",
                        "Настройте ежедневный запуск в 07:30 через сервис регламентных заданий.",
                      ].map((text, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 font-semibold mt-0.5">
                            {i + 1}
                          </span>
                          <span className="text-muted-foreground">{text}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="pt-1">
                      <a
                        href="/integrations/1c/specialist"
                        target="_blank"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Открыть полную техническую документацию
                      </a>
                    </div>
                  </div>
                )}
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={() => setStep(3)}
              >
                Специалист установил файл — ждём подключение →
              </Button>
            </div>
          )}

          {/* ── Step 3: Waiting ── */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold mb-1">Ожидаем первое подключение</h2>
                <p className="text-sm text-muted-foreground">
                  Как только специалист установит файл и проверит соединение — здесь появится результат.
                </p>
              </div>

              {pollStatus === "waiting" ? (
                <div className="rounded-xl border-2 border-dashed border-muted p-10 text-center space-y-4">
                  <div className="relative inline-block">
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
                      <Wifi className="w-7 h-7 text-muted-foreground/50" />
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                      <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                    </div>
                  </div>
                  <div>
                    <p className="font-semibold">Ожидаем данные из 1С...</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Проверяем каждые 5 секунд. Страницу закрывать не нужно.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-10 text-center space-y-4">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-emerald-800">🎉 Интеграция работает!</p>
                    <p className="text-sm text-emerald-700 mt-1">
                      Первые данные из 1С получены. Заказы будут поступать автоматически каждое утро.
                    </p>
                  </div>
                </div>
              )}

              {/* Checklist */}
              <div className="rounded-lg bg-muted/40 border p-4 space-y-2">
                {[
                  { done: true, text: "Защищённый канал создан" },
                  { done: fileDownloaded || true, text: "Файл подключения подготовлен" },
                  { done: pollStatus === "connected", text: "Первое соединение установлено" },
                ].map((item) => (
                  <div key={item.text} className="flex items-center gap-2 text-sm">
                    {item.done ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-amber-400 shrink-0" />
                    )}
                    <span className={item.done ? "text-foreground" : "text-muted-foreground"}>
                      {item.text}
                    </span>
                  </div>
                ))}
              </div>

              <Button
                variant={pollStatus === "connected" ? "default" : "outline"}
                className="w-full"
                onClick={handleFinish}
              >
                {pollStatus === "connected" ? "Открыть панель управления →" : "Открыть панель сейчас"}
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
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectResult, setReconnectResult] = useState<SetupResult | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [int_, lgs] = await Promise.all([
        apiFetch(`/api/integrations/${initialIntegration.id}`),
        apiFetch(`/api/integrations/${initialIntegration.id}/logs?limit=30`),
      ]);
      setIntegration(int_);
      setLogs(lgs);
    } catch (e: unknown) {
      if (!silent) {
        toast({ title: "Ошибка", description: `${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }, [initialIntegration.id, toast]);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (integration.status !== "setup") return;
    const timer = setInterval(() => refresh(true), 30000);
    return () => clearInterval(timer);
  }, [integration.status, refresh]);

  const handleToggle = async () => {
    const newStatus = integration.status === "disabled" ? "active" : "disabled";
    try {
      const updated: Integration = await apiFetch(`/api/integrations/${integration.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setIntegration(updated);
      toast({ title: newStatus === "disabled" ? "Синхронизация отключена" : "Синхронизация включена" });
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

  const handleReconnect = async () => {
    setReconnecting(true);
    try {
      const data: SetupResult = await apiFetch("/api/integrations/quick-setup", { method: "POST" });
      setReconnectResult(data);
      await refresh(true);
      toast({ title: "Новый файл готов", description: "Скачайте и передайте специалисту по 1С." });
    } catch (e: unknown) {
      toast({ title: "Ошибка", description: `${e instanceof Error ? e.message : String(e)}`, variant: "destructive" });
    } finally {
      setReconnecting(false);
    }
  };

  const status = deriveStatus(integration, logs);
  const realLogs = logs.filter((l) => l.error_detail !== "Ручная проверка");
  const stats = integration.stats ?? { total_syncs: 0, total_orders: 0, total_matched: 0, total_errors: 0 };
  const baseUrl = (integration.config?.base_url as string) || window.location.origin;

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Header */}
      <div>
        <Button variant="ghost" size="sm" className="-ml-2 mb-3" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Интеграции
        </Button>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <div className="w-7 h-7 rounded bg-orange-100 border border-orange-200 flex items-center justify-center font-bold text-orange-700 text-xs">
                1С
              </div>
              <h1 className="text-xl font-bold">1С:Предприятие</h1>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${status.colorClass}`}
              >
                {status.icon}
                {status.label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">{status.description}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refresh()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* Contextual banners */}
      {integration.status === "setup" && (
        <Alert className="border-amber-200 bg-amber-50">
          <Clock className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-900 ml-2 text-sm">
            <strong>Ожидаем первое подключение.</strong>{" "}
            Попросите специалиста по 1С открыть SmartRoute.epf и проверить соединение. Или{" "}
            <button
              className="underline font-medium hover:no-underline"
              onClick={handleReconnect}
              disabled={reconnecting}
            >
              сгенерируйте новый файл
            </button>
            , если файл был утерян.
          </AlertDescription>
        </Alert>
      )}

      {integration.status === "error" && (
        <Alert className="border-red-200 bg-red-50">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-900 ml-2 text-sm">
            <strong>Ошибка синхронизации.</strong>{" "}
            Проверьте журнал ниже — там указана причина. Распространённые причины: истёкший ключ доступа, нет выхода в интернет с сервера 1С.
          </AlertDescription>
        </Alert>
      )}

      {(integration.pending_stores ?? 0) > 0 && (
        <Alert className="border-amber-200 bg-amber-50">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-900 ml-2 text-sm">
            <strong>{integration.pending_stores} {(integration.pending_stores ?? 0) === 1 ? "новый магазин создан" : "новых магазина создано"} автоматически из 1С</strong> — без координат.{" "}
            Маршруты для них будут неточными.{" "}
            <a href="/stores" className="underline font-medium hover:no-underline">
              Перейти в раздел Магазины → геокодировать
            </a>
          </AlertDescription>
        </Alert>
      )}

      {integration.status === "active" && stats.total_orders === 0 && (
        <Alert className="border-blue-200 bg-blue-50">
          <Info className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-900 ml-2 text-sm">
            Первое соединение установлено — 1С подключена. Заказы начнут поступать по расписанию в 07:30.
          </AlertDescription>
        </Alert>
      )}

      {integration.status === "disabled" && (
        <Alert className="border-gray-200 bg-gray-50">
          <WifiOff className="w-4 h-4 text-gray-500" />
          <AlertDescription className="text-gray-700 ml-2 text-sm">
            Синхронизация приостановлена. Заказы из 1С не поступают.{" "}
            <button className="underline font-medium" onClick={handleToggle}>Включить снова</button>
          </AlertDescription>
        </Alert>
      )}

      {/* New file ready after reconnect */}
      {reconnectResult && (
        <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <p className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" /> Новый файл подключения готов
          </p>
          <p className="text-xs text-emerald-700">
            Скачайте архив и передайте специалисту. Старый ключ доступа деактивирован.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                downloadZip(reconnectResult.package_b64, "SmartRoute_Setup.zip");
                toast({ title: "Файл скачан" });
              }}
            >
              <Download className="w-3.5 h-3.5 mr-1.5" /> Скачать SmartRoute_Setup.zip
            </Button>
            <Button size="sm" variant="outline" onClick={() => setReconnectResult(null)}>
              Закрыть
            </Button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Синхронизаций", value: stats.total_syncs, icon: <RefreshCw className="w-4 h-4" />, color: "text-blue-600" },
          { label: "Заказов загружено", value: stats.total_orders, icon: <Package className="w-4 h-4" />, color: "text-emerald-600" },
          { label: "Точек найдено", value: stats.total_matched, icon: <CheckCircle2 className="w-4 h-4" />, color: "text-emerald-600" },
          {
            label: "Ошибок",
            value: stats.total_errors,
            icon: <XCircle className="w-4 h-4" />,
            color: stats.total_errors > 0 ? "text-red-600" : "text-muted-foreground",
          },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <div className={`flex items-center gap-1.5 mb-2 ${s.color}`}>
                {s.icon}
                <span className="text-xs font-medium">{s.label}</span>
              </div>
              <p className="text-2xl font-bold">{s.value.toLocaleString("ru-RU")}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Sync log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Журнал синхронизаций
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {realLogs.length === 0 ? (
            <div className="px-6 py-10 text-center">
              <Wifi className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm font-medium text-muted-foreground">Синхронизаций ещё не было</p>
              <p className="text-xs text-muted-foreground mt-1">
                Когда специалист запустит файл SmartRoute.epf — здесь появится история.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {realLogs.map((log) => (
                <div key={log.id} className="flex items-start gap-4 px-5 py-3">
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
                        {log.orders_received === 0 && log.status === "success"
                          ? "Подключение проверено"
                          : `${log.orders_received} заказов`}
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
                    {log.error_detail && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{log.error_detail}</p>
                    )}
                    {log.stores_unmatched > 0 && (
                      <p className="text-xs text-amber-700 mt-0.5">
                        ⚠️ Незнакомые точки —{" "}
                        <a href="/stores" className="underline hover:no-underline">добавьте их в справочник</a>
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{friendlyDate(log.started_at)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings & actions */}
      <Card>
        <CardHeader className="pb-2">
          <button
            className="flex items-center justify-between w-full text-left"
            onClick={() => setShowSettings((v) => !v)}
          >
            <CardTitle className="text-base">Управление подключением</CardTitle>
            <ChevronDown
              className={`w-4 h-4 text-muted-foreground transition-transform ${showSettings ? "rotate-180" : ""}`}
            />
          </button>
        </CardHeader>
        {showSettings && (
          <CardContent className="pt-0 space-y-4">
            {/* Reconnect */}
            <div className="rounded-lg border p-4 space-y-2">
              <div className="flex items-start gap-3">
                <RotateCcw className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Пересоздать файл подключения</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Создаст новый ключ доступа и скачает обновлённый файл для специалиста. Старый ключ перестанет работать.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleReconnect}
                disabled={reconnecting}
                className="w-full"
              >
                {reconnecting ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> Создаём...</>
                ) : (
                  <><RotateCcw className="w-3.5 h-3.5 mr-2" /> Пересоздать файл подключения</>
                )}
              </Button>
            </div>

            {/* URL for reference */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Адрес SmartRoute (для справки):</p>
              <div className="flex items-center gap-2 bg-muted rounded border px-3 py-2">
                <code className="text-xs font-mono flex-1 break-all">{baseUrl}</code>
                <CopyButton text={baseUrl} />
              </div>
            </div>

            {/* Specialist page link */}
            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="flex items-start gap-3">
                <FileText className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-sm font-medium mb-0.5">Техническая документация</p>
                  <p className="text-xs text-muted-foreground mb-2">
                    Полная инструкция для специалиста по 1С с техническими деталями.
                  </p>
                  <a
                    href="/integrations/1c/specialist"
                    target="_blank"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Открыть страницу для специалиста
                  </a>
                </div>
              </div>
            </div>

            {/* Toggle / Delete */}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={handleToggle}>
                {integration.status === "disabled" ? (
                  <><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" /> Включить</>
                ) : (
                  <><WifiOff className="w-3.5 h-3.5 mr-1.5" /> Приостановить</>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => setShowDelete(true)}
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Удалить интеграцию
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Error guidance */}
      {integration.status === "error" && (
        <Card className="border-red-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Что делать при ошибке
            </CardTitle>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            {[
              { title: "Истёк ключ доступа", fix: "Пересоздайте файл подключения выше — новый ключ создастся автоматически." },
              { title: "Нет интернета с сервера 1С", fix: "Убедитесь, что с сервера 1С открыт исходящий порт 443." },
              { title: "Точки доставки не найдены", fix: 'Добавьте точки в SmartRoute → раздел «Магазины».' },
              { title: "Ошибка формата данных", fix: "Обратитесь к специалисту по 1С — нужно проверить настройки выгрузки." },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border bg-red-50 p-3">
                <p className="text-xs font-semibold text-red-800">{item.title}</p>
                <p className="text-xs text-red-700 mt-0.5">{item.fix}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Delete dialog */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить интеграцию?</AlertDialogTitle>
            <AlertDialogDescription>
              Настройки и журнал синхронизаций будут удалены. Заказы, уже переданные в SmartRoute, останутся.
              Специалисту понадобится новый файл подключения.
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

// ─── Main Page ────────────────────────────────────────────────────────────────

type PageView = "loading" | "landing" | "setup" | "dashboard";

export function IntegrationsPage() {
  const [view, setView] = useState<PageView>("loading");
  const [integration, setIntegration] = useState<Integration | null>(null);

  const loadIntegrations = useCallback(async () => {
    try {
      const list: Integration[] = await apiFetch("/api/integrations");
      const onec = list.find((i) => i.type === "1c") ?? null;
      setIntegration(onec);
      setView(onec ? "dashboard" : "landing");
    } catch {
      setView("landing");
    }
  }, []);

  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

  if (view === "loading") {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (view === "setup") {
    return (
      <OneCSetupFlow
        onBack={() => setView("landing")}
        onDone={(int_) => {
          setIntegration(int_);
          setView("dashboard");
        }}
      />
    );
  }

  if (view === "dashboard" && integration) {
    return (
      <OneCDashboard
        integration={integration}
        onBack={async () => {
          setView("loading");
          await loadIntegrations();
        }}
        onDeleted={async () => {
          setIntegration(null);
          setView("landing");
        }}
      />
    );
  }

  return (
    <IntegrationsLanding
      existingIntegration={integration}
      onConnect={() => setView("setup")}
      onOpenDashboard={() => {
        if (integration) setView("dashboard");
      }}
    />
  );
}
