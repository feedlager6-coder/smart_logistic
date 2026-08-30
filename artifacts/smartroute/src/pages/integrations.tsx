import React, { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
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
  Monitor,
  Laptop,
  Terminal,
  Layers,
  Sparkles,
  KeyRound,
  PlayCircle,
  CheckCheck,
  Server,
  HelpCircle,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConnectedAgent {
  id: string;
  name: string;
  base_name: string;
  config_type: string;
  v8_version: string;
  hostname?: string;
  ip_address?: string;
  connection_type: "com" | "http";
  status: "active" | "syncing" | "error" | "idle";
  last_heartbeat_at: string;
  last_sync_at: string | null;
  sync_interval_min: number;
  total_orders_synced: number;
  total_statuses_updated: number;
  last_error?: string | null;
  created_at: string;
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
  pending_stores?: number;
}

interface SyncLog {
  id: number;
  integration_id?: number;
  agent_id?: string;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function apiFetch(path: string, opts?: RequestInit) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.detail || j.message || j.error || msg;
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
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-all shrink-0 cursor-pointer shadow-xs border border-border"
      title="Скопировать"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
      {label ?? (copied ? "Скопировано!" : "Копировать")}
    </button>
  );
}

// ─── TAB 1: Windows 1C Agent Component ───────────────────────────────────────

interface AgentTabProps {
  onSwitchToManual: () => void;
}

function OneCAgentTab({ onSwitchToManual }: AgentTabProps) {
  const { toast } = useToast();
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [agents, setAgents] = useState<ConnectedAgent[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(true);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [agentToDelete, setAgentToDelete] = useState<string | null>(null);
  const [isSyncingNow, setIsSyncingNow] = useState(false);

  // Load connected agents
  const loadAgents = useCallback(async () => {
    try {
      const data: ConnectedAgent[] = await apiFetch("/api/integrations/1c/agent/agents");
      setAgents(data);
    } catch {
      // Fallback
    } finally {
      setIsLoadingAgents(false);
    }
  }, []);

  // Load sync logs
  const loadLogs = useCallback(async () => {
    try {
      const data: SyncLog[] = await apiFetch("/api/integrations/1c/agent/logs");
      setSyncLogs(data);
    } catch {}
  }, []);

  // Load active pairing code
  const loadPairingCode = useCallback(async () => {
    try {
      const data = await apiFetch("/api/integrations/1c/agent/code/active");
      if (data?.code) {
        setPairingCode(data.code);
      }
    } catch {}
  }, []);

  useEffect(() => {
    loadAgents();
    loadLogs();
    loadPairingCode();
    const interval = setInterval(loadAgents, 8000);
    return () => clearInterval(interval);
  }, [loadAgents, loadLogs, loadPairingCode]);

  // Generate pairing code
  const handleGenerateCode = async () => {
    setIsGeneratingCode(true);
    try {
      const data = await apiFetch("/api/integrations/1c/agent/code", { method: "POST" });
      setPairingCode(data.code);
      toast({
        title: "Код привязки сгенерирован",
        description: "Введите этот код в приложении-агенте на компьютере с 1С.",
      });
    } catch (e: any) {
      toast({
        title: "Ошибка генерации кода",
        description: e.message || "Не удалось создать код",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingCode(false);
    }
  };

  // Trigger manual sync
  const handleTriggerSync = async () => {
    setIsSyncingNow(true);
    try {
      await apiFetch("/api/integrations/1c/agent/sync", { method: "POST" });
      await loadAgents();
      await loadLogs();
      toast({
        title: "Синхронизация выполнена",
        description: "Данные из 1С успешно обновлены в SmartRoute.",
      });
    } catch (e: any) {
      toast({
        title: "Ошибка синхронизации",
        description: e.message || "Не удалось выполнить синхронизацию",
        variant: "destructive",
      });
    } finally {
      setIsSyncingNow(false);
    }
  };

  // Disconnect agent
  const handleDisconnectAgent = async () => {
    if (!agentToDelete) return;
    try {
      await apiFetch(`/api/integrations/1c/agent/${agentToDelete}`, { method: "DELETE" });
      setAgentToDelete(null);
      await loadAgents();
      toast({
        title: "База 1С отвязана",
        description: "Агент успешно отключен от SmartRoute.",
      });
    } catch (e: any) {
      toast({
        title: "Ошибка отключения",
        description: e.message || "Не удалось отключить агента",
        variant: "destructive",
      });
    }
  };

  // Download Windows Setup .exe installer
  const handleDownloadSetupExe = async () => {
    try {
      toast({
        title: "Загрузка установщика .exe",
        description: "Формирование и скачивание SmartRoute_1C_Agent_Setup.exe...",
      });

      const serverUrl = window.location.origin;
      // Use the extensionless endpoint because some production proxies treat
      // .exe paths as static files before forwarding them to the API.
      const response = await fetch(`/api/integrations/1c/agent/setup?server_url=${encodeURIComponent(serverUrl)}`);
      if (!response.ok) {
        let detail = "";
        try {
          const body = await response.json();
          detail = typeof body?.detail === "string" ? `: ${body.detail}` : "";
        } catch {
          // Keep the HTTP status when the proxy returns a non-JSON error page.
        }
        throw new Error(`Ошибка сервера: ${response.status} ${response.statusText}${detail}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "SmartRoute_1C_Agent_Setup.exe";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Установщик скачан",
        description: "Запустите SmartRoute_1C_Agent_Setup.exe на компьютере с 1С.",
      });
    } catch (err: any) {
      toast({
        title: "Ошибка загрузки",
        description: err.message || "Не удалось скачать файл установщика",
        variant: "destructive",
      });
    }
  };

  // Download agent package (ZIP)
  const handleDownloadAgent = async () => {
    try {
      toast({
        title: "Подготовка архива",
        description: "Формирование пакета SmartRoute_1C_Agent.zip...",
      });

      const response = await fetch("/api/integrations/1c/agent/download");
      if (!response.ok) {
        let detail = "";
        try {
          const body = await response.json();
          detail = typeof body?.detail === "string" ? `: ${body.detail}` : "";
        } catch {
          // Keep the HTTP status when the proxy returns a non-JSON error page.
        }
        throw new Error(`Ошибка сервера: ${response.status} ${response.statusText}${detail}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "SmartRoute_1C_Agent.zip";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast({
        title: "Архив скачан",
        description: "Файл SmartRoute_1C_Agent.zip успешно загружен.",
      });
    } catch (err: any) {
      toast({
        title: "Ошибка загрузки",
        description: err.message || "Не удалось скачать архив агента",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* 1. Hero Card */}
      <div className="relative rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 p-6 md:p-8 overflow-hidden shadow-xs">
        <div className="absolute top-0 right-0 w-80 h-80 opacity-5 pointer-events-none">
          <Monitor className="w-full h-full text-sky-900" />
        </div>

        <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-3 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-sky-100 border border-sky-200 text-sky-800 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-sky-600" />
              Новый способ • Быстрый старт за 2 минуты
            </div>
            <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
              Windows-приложение SmartRoute Agent для 1С
            </h2>
            <p className="text-sm md:text-base text-gray-700 leading-relaxed">
              Скачайте приложение‑агент для Windows. Запустите его на компьютере, где установлена 1С.
              Приложение автоматически подключит вашу 1С к SmartRoute и будет синхронизировать заказы и статусы доставки.
            </p>
          </div>

          <div className="flex flex-col gap-2.5 shrink-0">
            <Button
              size="lg"
              onClick={handleDownloadSetupExe}
              className="bg-sky-600 hover:bg-sky-700 text-white shadow-md font-bold gap-2 cursor-pointer h-12 px-6 text-base"
            >
              <Download className="w-5 h-5" />
              Скачать установщик (.exe)
            </Button>
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs text-sky-800 font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-sky-600" /> 100% Native 64-bit EXE
              </span>
              <button
                onClick={handleDownloadAgent}
                className="text-xs text-sky-700 hover:underline cursor-pointer font-medium"
              >
                или .ZIP архив
              </button>
            </div>
            <span className="text-[11px] text-sky-700 leading-tight max-w-[260px]">
              ZIP-пакет получает адрес текущего сервера автоматически.
            </span>
          </div>
        </div>
      </div>

      {/* 2. Pairing Code & Connection Settings Card */}
      <Card className="border-border shadow-xs overflow-hidden">
        <CardHeader className="bg-muted/30 border-b border-border pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center font-bold">
                <KeyRound className="w-5 h-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold">Параметры подключения для агента 1С</CardTitle>
                <p className="text-xs text-muted-foreground">Используйте эти данные в окне установленного агента на компьютере с 1С</p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateCode}
              disabled={isGeneratingCode}
              className="gap-2 cursor-pointer font-medium"
            >
              {isGeneratingCode ? (
                <Loader2 className="w-4 h-4 animate-spin text-sky-600" />
              ) : (
                <RotateCcw className="w-4 h-4 text-sky-600" />
              )}
              {pairingCode ? "Сгенерировать новый код" : "Сгенерировать код привязки"}
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-4">
          {/* Server URL field */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                1. Адрес сервера SmartRoute (URL)
              </div>
              <div className="font-mono text-sm font-bold text-slate-800 break-all">
                {typeof window !== "undefined" ? window.location.origin : "https://smartroute.app"}
              </div>
            </div>
            <CopyButton
              text={typeof window !== "undefined" ? window.location.origin : "https://smartroute.app"}
              label="Скопировать URL"
            />
          </div>

          {/* Pairing Code field */}
          {pairingCode ? (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row items-center gap-4 p-4 rounded-xl bg-sky-50/80 border border-sky-200">
                <div className="flex-1 text-center sm:text-left">
                  <div className="text-xs font-semibold text-sky-800 uppercase tracking-wider mb-1">
                    2. Ваш активный код привязки:
                  </div>
                  <div className="font-mono text-2xl sm:text-3xl font-extrabold text-sky-950 tracking-wider">
                    {pairingCode}
                  </div>
                  <div className="text-xs text-sky-700 mt-1 flex items-center gap-1.5 justify-center sm:justify-start">
                    <Clock className="w-3.5 h-3.5" /> Действителен 24 часа • Ожидает ввода в Windows-агенте
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <CopyButton text={pairingCode} label="Скопировать код" />
                </div>
              </div>
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 flex items-start gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Как привязать:</strong> В окне приложения SmartRoute 1C Agent на компьютере проверьте, что в поле «Адрес сервера» указан URL выше, вставьте код привязки <strong>{pairingCode}</strong> и нажмите <strong>«Привязать к SmartRoute»</strong>.
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl border border-dashed border-border bg-muted/20">
              <div className="flex items-center gap-3">
                <Info className="w-5 h-5 text-sky-600 shrink-0" />
                <div>
                  <div className="text-sm font-semibold text-foreground">Код привязки ещё не сгенерирован</div>
                  <div className="text-xs text-muted-foreground">
                    Нажмите кнопку «Сгенерировать код привязки», чтобы получить одноразовый ключ подключения.
                  </div>
                </div>
              </div>
              <Button
                onClick={handleGenerateCode}
                disabled={isGeneratingCode}
                className="bg-sky-600 hover:bg-sky-700 text-white shrink-0 font-medium cursor-pointer"
              >
                {isGeneratingCode ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
                Получить код привязки
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. 3-Step Instruction Roadmap */}
      <Card className="border-border shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-sky-600" /> Простая настройка за 3 шага
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 relative">
            {[
              {
                step: "Шаг 1",
                title: "1. Скачайте и запустите .exe",
                desc: "Укажите адрес опубликованного сервера, вставьте код SMARTROUTE-... и нажмите «Привязать». Не используйте dev-preview или старый Google Run адрес.",
                icon: <KeyRound className="w-5 h-5 text-sky-600" />,
              },
              {
                step: "Шаг 2",
                title: "2. Подключите 1С",
                desc: "Выберите базу 1С из выпадающего списка, введите логин/пароль и нажмите «Проверить и сохранить».",
                icon: <Database className="w-5 h-5 text-sky-600" />,
              },
              {
                step: "Шаг 3",
                title: "3. Готово к работе",
                desc: "Синхронизация работает автоматически в фоне каждые 5 минут, отправляя заказы и обновляя статусы.",
                icon: <CheckCircle2 className="w-5 h-5 text-emerald-600" />,
              },
            ].map((s, idx) => (
              <div
                key={idx}
                className="flex flex-col p-5 rounded-xl border border-border bg-card hover:border-sky-300 transition-colors relative"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="px-2.5 py-1 rounded-md bg-sky-100 text-sky-700 font-bold text-xs flex items-center justify-center">
                    {s.step}
                  </div>
                  {s.icon}
                </div>
                <h4 className="text-sm font-bold text-foreground mb-1.5">{s.title}</h4>
                <p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 4. Connected 1C Bases & Live Status */}
      <Card className="border-border shadow-xs">
        <CardHeader className="bg-muted/20 border-b border-border pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Server className="w-5 h-5 text-sky-600" /> Подключённые базы 1С
              </CardTitle>
              <p className="text-xs text-muted-foreground">
                Список активных баз данных 1С:Предприятие, подключенных к SmartRoute
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadAgents}
                disabled={isLoadingAgents}
                className="cursor-pointer gap-1.5"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAgents ? "animate-spin" : ""}`} />
                Обновить статус
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowLogsModal(true)}
                className="cursor-pointer gap-1.5"
              >
                <FileText className="w-3.5 h-3.5" />
                Журнал синхронизации
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-6">
          {isLoadingAgents ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 className="w-5 h-5 animate-spin" />
              Загрузка списка подключённых агентов...
            </div>
          ) : agents.length > 0 ? (
            <div className="space-y-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="rounded-xl border border-border bg-card p-5 shadow-2xs hover:border-sky-200 transition-all"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <h3 className="text-base font-bold text-foreground">{agent.name}</h3>
                        <Badge
                          className={`text-xs ${
                            agent.status === "active"
                              ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                              : agent.status === "syncing"
                              ? "bg-sky-100 text-sky-800 border-sky-200"
                              : "bg-amber-100 text-amber-800 border-amber-200"
                          }`}
                        >
                          {agent.status === "active"
                            ? "🟢 Подключено (в сети)"
                            : agent.status === "syncing"
                            ? "🟡 Выполняется синхронизация…"
                            : "⚪ Ожидание (в сети)"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          Хост: <span className="font-mono">{agent.hostname || "127.0.0.1"}</span>
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                        <span>Платформа: <strong className="text-foreground">{agent.v8_version}</strong></span>
                        <span>Конфигурация: <strong className="text-foreground">{agent.config_type}</strong></span>
                        <span>Интервал: <strong className="text-foreground">{agent.sync_interval_min || 5} мин</strong></span>
                        <span>Последняя синхронизация: <strong className="text-foreground">{friendlyDate(agent.last_sync_at)}</strong></span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleTriggerSync}
                        disabled={isSyncingNow}
                        className="cursor-pointer gap-1.5"
                      >
                        {isSyncingNow ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-600" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5 text-sky-600" />
                        )}
                        Синхронизировать сейчас
                      </Button>

                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setAgentToDelete(agent.id)}
                        className="text-destructive hover:text-destructive hover:bg-destructive/10 cursor-pointer"
                        title="Отвязать базу"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Counters bar */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4 pt-4 border-t border-border/60">
                    <div className="bg-muted/30 rounded-lg p-2.5">
                      <div className="text-xs text-muted-foreground">Передано заказов в SmartRoute</div>
                      <div className="text-lg font-bold text-sky-700">{agent.total_orders_synced}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2.5">
                      <div className="text-xs text-muted-foreground">Обновлено статусов в 1С</div>
                      <div className="text-lg font-bold text-emerald-700">{agent.total_statuses_updated}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2.5 col-span-2 sm:col-span-1">
                      <div className="text-xs text-muted-foreground">Режим подключения</div>
                      <div className="text-sm font-semibold text-foreground mt-1">COM (V83.COMConnector)</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 px-4 rounded-xl border border-dashed border-border bg-muted/20">
              <Laptop className="w-10 h-10 text-muted-foreground mx-auto mb-2 opacity-50" />
              <h4 className="text-sm font-semibold text-foreground">Нет подключённых баз 1С</h4>
              <p className="text-xs text-muted-foreground max-w-md mx-auto mt-1 mb-4">
                Скачайте Windows-агент, введите код привязки и укажите базу 1С — она сразу отобразится здесь.
              </p>
              <Button
                size="sm"
                onClick={handleGenerateCode}
                className="bg-sky-600 hover:bg-sky-700 text-white cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 mr-1.5" />
                Сгенерировать код для подключения
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 5. FAQ & Capabilities */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Shield className="w-4 h-4 text-sky-600" /> Безопасность и архитектура
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>• <strong>Локальное соединение:</strong> Агент подключается к 1С на самом компьютере через официальный COMConnector или локальные HTTP-сервисы.</p>
            <p>• <strong>Защита паролей:</strong> Ваши учётные данные 1С никогда не отправляются на сервер SmartRoute и хранятся локально на вашем ПК в зашифрованном виде.</p>
            <p>• <strong>Безопасный канал HTTPS:</strong> Передача заказов осуществляется по зашифрованному протоколу TLS/HTTPS с Bearer-авторизацией.</p>
          </CardContent>
        </Card>

        <Card className="border-border shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Database className="w-4 h-4 text-sky-600" /> Поддерживаемые конфигурации 1С
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>• <strong>Торговые системы:</strong> 1С:Управление торговлей (УТ 11, УТ 10.3), 1С:Розница (2.x, 3.x).</p>
            <p>• <strong>Корпоративные решения:</strong> 1С:Комплексная автоматизация (КА 2), 1С:ERP Управление предприятием.</p>
            <p>• <strong>Малый бизнес и учет:</strong> 1С:УНФ (1.6 / 3.0), 1С:Бухгалтерия предприятия 3.0, отраслевые и самописные базы.</p>
          </CardContent>
        </Card>
      </div>

      {/* Logs Dialog */}
      <AlertDialog open={showLogsModal} onOpenChange={setShowLogsModal}>
        <AlertDialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-sky-600" /> Журнал синхронизации 1С
            </AlertDialogTitle>
            <AlertDialogDescription>
              Последние сеансы передачи заказов и обновления статусов доставки
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="flex-1 overflow-y-auto space-y-2 my-2 pr-1">
            {syncLogs.length > 0 ? (
              syncLogs.map((l) => (
                <div key={l.id} className="p-3 rounded-lg border border-border bg-muted/30 text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">
                      {new Date(l.started_at).toLocaleString("ru-RU")}
                    </span>
                    <Badge
                      className={`text-[10px] ${
                        l.status === "ok" || l.status === "success"
                          ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                          : l.status === "partial"
                          ? "bg-amber-100 text-amber-800 border-amber-200"
                          : "bg-red-100 text-red-800 border-red-200"
                      }`}
                    >
                      {l.status === "ok" || l.status === "success" ? "Успешно" : l.status === "partial" ? "Частично" : "Ошибка"}
                    </Badge>
                  </div>
                  <div className="text-muted-foreground flex items-center gap-4">
                    <span>Получено заказов: <strong>{l.orders_received}</strong></span>
                    <span>Сопоставлено точек: <strong>{l.stores_matched}</strong></span>
                    <span>Ошибок: <strong>{l.errors_count}</strong></span>
                  </div>
                  {l.error_detail && (
                    <div className="text-sky-800 font-mono text-[11px] bg-sky-50 p-1.5 rounded border border-sky-200">
                      {l.error_detail}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-xs text-muted-foreground">
                Журнал пуст. Запустите синхронизацию, чтобы увидеть записи.
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Закрыть</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!agentToDelete} onOpenChange={(open) => !open && setAgentToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отвязать базу 1С от SmartRoute?</AlertDialogTitle>
            <AlertDialogDescription>
              Синхронизация заказов для этой базы будет остановлена. Ранее переданные заказы и построенные маршруты сохранятся в системе.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDisconnectAgent}
            >
              Отвязать базу
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── TAB 2: Manual BSL + API Integration Flow ────────────────────────────────

interface ManualTabProps {
  existingIntegration: Integration | null;
  onRefresh: () => void;
}

function ManualSetupTab({ existingIntegration, onRefresh }: ManualTabProps) {
  const { toast } = useToast();
  const [setupResult, setSetupResult] = useState<SetupResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [subTab, setSubTab] = useState<"quick" | "api_docs" | "specialist">("quick");

  const handleQuickSetup = async () => {
    setIsGenerating(true);
    try {
      const data: SetupResult = await apiFetch("/api/integrations/quick-setup", { method: "POST" });
      setSetupResult(data);
      onRefresh();
      toast({
        title: "Канал интеграции создан",
        description: "Файл SmartRoute.epf и ключ доступа готовы к скачиванию.",
      });
    } catch (e: any) {
      toast({
        title: "Ошибка",
        description: e.message || "Не удалось создать интеграцию",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadEPF = () => {
    if (!setupResult) return;
    downloadZip(setupResult.package_b64, "SmartRoute_1C_Setup.zip");
    toast({
      title: "Архив скачан",
      description: "Передайте SmartRoute_1C_Setup.zip 1С-специалисту.",
    });
  };

  return (
    <div className="space-y-6">
      {/* Intro Header */}
      <div className="rounded-2xl border border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center font-bold text-orange-700 text-lg shrink-0">
              BSL
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Ручная настройка через BSL-модуль / Внешнюю обработку (EPF)</h2>
              <p className="text-xs sm:text-sm text-orange-800">
                Классический вариант интеграции для штатных 1С-разработчиков и системных администраторов
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSubTab("specialist")}
              className="bg-white/80 text-xs font-semibold cursor-pointer"
            >
              Инструкция 1С-нику
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSubTab("api_docs")}
              className="bg-white/80 text-xs font-semibold cursor-pointer"
            >
              Справочник API
            </Button>
          </div>
        </div>
      </div>

      {/* Sub Tabs */}
      <Tabs value={subTab} onValueChange={(v: any) => setSubTab(v)}>
        <TabsList className="grid grid-cols-3 max-w-md">
          <TabsTrigger value="quick">Быстрый запуск</TabsTrigger>
          <TabsTrigger value="specialist">Специалисту 1С</TabsTrigger>
          <TabsTrigger value="api_docs">REST API</TabsTrigger>
        </TabsList>

        {/* 1. Quick Setup */}
        <TabsContent value="quick" className="space-y-4 mt-4">
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Package className="w-5 h-5 text-orange-600" />
                Генерация пакета подключения (SmartRoute.epf + API Key)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Создайте канал прямого доступа через REST API. Вы получите сгенерированный API-ключ и архив с готовой внешней обработкой для 1С 8.3.
              </p>

              {setupResult ? (
                <div className="space-y-4 p-4 rounded-xl bg-orange-50/70 border border-orange-200">
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-orange-900 uppercase">Адрес сервера SmartRoute:</div>
                    <div className="flex items-center gap-2">
                      <code className="px-3 py-1.5 rounded-lg bg-white border border-orange-200 text-sm font-mono text-foreground font-bold flex-1">
                        {setupResult.base_url}
                      </code>
                      <CopyButton text={setupResult.base_url} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-orange-900 uppercase">API-ключ (Bearer Token):</div>
                    <div className="flex items-center gap-2">
                      <code className="px-3 py-1.5 rounded-lg bg-white border border-orange-200 text-sm font-mono text-foreground font-bold flex-1">
                        {setupResult.full_key}
                      </code>
                      <CopyButton text={setupResult.full_key} />
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row gap-3">
                    <Button onClick={handleDownloadEPF} className="bg-orange-600 hover:bg-orange-700 text-white font-semibold cursor-pointer">
                      <Download className="w-4 h-4 mr-2" /> Скачать SmartRoute_1C_Setup.zip
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={handleQuickSetup}
                  disabled={isGenerating}
                  className="bg-orange-600 hover:bg-orange-700 text-white font-semibold cursor-pointer"
                >
                  {isGenerating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <KeyRound className="w-4 h-4 mr-2" />}
                  Сгенерировать API-ключ и скачать обработку
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* 2. Specialist Guide */}
        <TabsContent value="specialist" className="space-y-4 mt-4">
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <FileText className="w-5 h-5 text-orange-600" /> Инструкция по подключению для 1С-программиста
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground leading-relaxed">
              <div className="p-4 rounded-xl bg-muted/40 border border-border space-y-2 text-foreground">
                <h4 className="font-bold text-sm">1. Установка внешней обработки</h4>
                <p className="text-xs text-muted-foreground">
                  Откройте 1С:Предприятие в режиме предприятия → «Файл» → «Открыть» → выберите файл <code>SmartRoute.epf</code> (или подключите в справочник «Дополнительные отчеты и обработки»).
                </p>

                <h4 className="font-bold text-sm pt-2">2. Ввод реквизитов</h4>
                <p className="text-xs text-muted-foreground">
                  В поле «Адрес сервера» вставьте URL инстанса SmartRoute, в поле «API-ключ» укажите сгенерированный Bearer токен.
                </p>

                <h4 className="font-bold text-sm pt-2">3. Настройка регламентного задания</h4>
                <p className="text-xs text-muted-foreground">
                  Для автоматической ежедневной выгрузки настройте регламентное задание в 1С на 07:30 утра с вызовом метода <code>ВыгрузитьЗаказыВСмартРут()</code>.
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* 3. REST API Docs */}
        <TabsContent value="api_docs" className="space-y-4 mt-4">
          <Card className="border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Terminal className="w-5 h-5 text-orange-600" /> Справочник REST API SmartRoute
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-xs font-mono">
              <div className="p-3 rounded-lg bg-slate-950 text-slate-100 space-y-2">
                <div className="text-emerald-400 font-bold">POST /api/v1/orders/batch</div>
                <div className="text-slate-400">Передача списка заказов из 1С в SmartRoute:</div>
                <pre className="text-[11px] text-sky-300 overflow-x-auto">
{`{
  "delivery_date": "2026-08-26",
  "orders": [
    {
      "order_number": "1C-00451",
      "external_id": "1c_doc_00451",
      "client_name": "ООО 'Продукты 24'",
      "address": "Махачкала, ул. Ленина, 14",
      "amount_rub": 14500,
      "weight_kg": 120,
      "volume_m3": 0.8,
      "time_window_from": "09:00",
      "time_window_to": "18:00"
    }
  ]
}`}
                </pre>
              </div>

              <div className="p-3 rounded-lg bg-slate-950 text-slate-100 space-y-2">
                <div className="text-sky-400 font-bold">GET /api/v1/orders?updated_from=...</div>
                <div className="text-slate-400">Получение статусов доставки и POD (фото/подпись) для записи в 1С:</div>
                <pre className="text-[11px] text-emerald-300 overflow-x-auto">
{`{
  "ok": true,
  "orders": [
    {
      "order_number": "1C-00451",
      "delivery_status": "delivered",
      "route_number": "Маршрут #4",
      "actual_delivery_time": "2026-08-26T14:35:00Z",
      "pod_photo_url": "https://smartroute.app/pod/photo.jpg"
    }
  ]
}`}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Main Page with Top-Level Tab Switcher ────────────────────────────────────

export function IntegrationsPage() {
  const [activeTab, setActiveTab] = useState<string>("agent");
  const [integration, setIntegration] = useState<Integration | null>(null);

  const loadIntegrations = useCallback(async () => {
    try {
      const list: Integration[] = await apiFetch("/api/integrations");
      const onec = list.find((i) => i.type === "1c") ?? null;
      setIntegration(onec);
    } catch {}
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Page Title & Subtitle */}
      <div className="space-y-1">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground tracking-tight flex items-center gap-3">
          <Building2 className="w-8 h-8 text-sky-600" />
          Интеграция с 1С:Предприятие
        </h1>
        <p className="text-sm text-muted-foreground">
          Автоматическая синхронизация заказов, контрагентов, маршрутов и статусов доставки
        </p>
      </div>

      {/* Main Tabs Navigation */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-2 max-w-xl h-11 p-1 bg-muted/80 rounded-xl border border-border">
          <TabsTrigger
            value="agent"
            className="flex items-center justify-center gap-2 font-bold text-xs sm:text-sm rounded-lg data-[state=active]:bg-background data-[state=active]:text-sky-700 data-[state=active]:shadow-xs transition-all"
          >
            <Monitor className="w-4 h-4 text-sky-600" />
            Приложение-агент (Windows)
          </TabsTrigger>
          <TabsTrigger
            value="manual"
            className="flex items-center justify-center gap-2 font-bold text-xs sm:text-sm rounded-lg data-[state=active]:bg-background data-[state=active]:text-orange-700 data-[state=active]:shadow-xs transition-all"
          >
            <FileText className="w-4 h-4 text-orange-600" />
            Ручная настройка (BSL + API)
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Windows Agent */}
        <TabsContent value="agent" className="focus-visible:outline-none">
          <OneCAgentTab onSwitchToManual={() => setActiveTab("manual")} />
        </TabsContent>

        {/* Tab 2: Manual BSL + API */}
        <TabsContent value="manual" className="focus-visible:outline-none">
          <ManualSetupTab existingIntegration={integration} onRefresh={loadIntegrations} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
export default IntegrationsPage;
