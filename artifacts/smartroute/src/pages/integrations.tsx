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
  ChevronRight,
  ArrowLeft,
  Zap,
  Database,
  FileCode2,
  BarChart3,
  Copy,
  Check,
  ExternalLink,
  Info,
  Wifi,
  WifiOff,
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
  return d.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">🟢 Работает</Badge>;
    case "error":
      return <Badge className="bg-red-100 text-red-800 border-red-200">🔴 Ошибка</Badge>;
    case "setup":
      return <Badge className="bg-amber-100 text-amber-800 border-amber-200">🟡 Ожидание</Badge>;
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

/** Generate personalized BSL module with real URL and API key embedded */
function generatePersonalizedBsl(baseUrl: string, apiKey: string): string {
  return `// ╔══════════════════════════════════════════════════════════════════╗
// ║   SmartRoute — Модуль интеграции для 1С:Предприятие 8.3+        ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║  Версия: 2.1  |  Автоматически настроен ${new Date().toLocaleDateString("ru-RU")}            ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║  КАК УСТАНОВИТЬ (для программиста 1С):                          ║
// ║  1. Конфигуратор → Файл → Новый → Внешняя обработка             ║
// ║  2. Имя: SmartRoute, Синоним: SmartRoute — отправка заявок      ║
// ║  3. Формы → Добавить → скопируйте этот код в Модуль формы       ║
// ║  4. Откройте в режиме Предприятия → нажмите "Проверить"         ║
// ╚══════════════════════════════════════════════════════════════════╝

#Область НастройкиИнтеграции

Перем НастройкиSmartRoute;

Процедура ИнициализироватьНастройки()
    НастройкиSmartRoute = Новый Структура;
    НастройкиSmartRoute.Вставить("URL",          "${baseUrl}");   // ← адрес SmartRoute (не менять)
    НастройкиSmartRoute.Вставить("APIКлюч",      "${apiKey}");  // ← ваш ключ (не менять)
    НастройкиSmartRoute.Вставить("ЗаменитьДату", Истина);
    НастройкиSmartRoute.Вставить("ДатаОтправки", ТекущаяДата());
    НастройкиSmartRoute.Вставить("ТипДокумента", "ЗаказПокупателя"); // ← адаптируйте при необходимости
КонецПроцедуры

#КонецОбласти

#Область ПолучениеДанных

Функция ПолучитьЗаявки(ДатаДоставки)
    МассивЗаявок = Новый Массив;
    Запрос = Новый Запрос;
    Запрос.Текст =
        "ВЫБРАТЬ
        |    Документ.Контрагент.НаименованиеПолное КАК НазваниеМагазина,
        |    Документ.АдресДоставки КАК Адрес,
        |    СУММА(СтрокаТовары.Количество * СтрокаТовары.Цена) КАК Сумма,
        |    СУММА(СтрокаТовары.Количество * СтрокаТовары.Номенклатура.Вес) КАК ВесКг,
        |    СУММА(СтрокаТовары.Количество) КАК КоличествоМест,
        |    Документ.НомерДокументаПолный КАК НомерЗаказа
        |ИЗ
        |    Документ.ЗаказПокупателя КАК Документ
        |        ВНУТРЕННЕЕ СОЕДИНЕНИЕ Документ.ЗаказПокупателя.Товары КАК СтрокаТовары
        |        ПО Документ.Ссылка = СтрокаТовары.Ссылка
        |ГДЕ
        |    Документ.Дата >= &ДатаНачало
        |    И Документ.Дата < &ДатаКонец
        |    И Документ.Проведен = ИСТИНА
        |    И НЕ Документ.ПометкаУдаления
        |СГРУППИРОВАТЬ ПО
        |    Документ.Контрагент.НаименованиеПолное,
        |    Документ.АдресДоставки,
        |    Документ.НомерДокументаПолный";

    Запрос.УстановитьПараметр("ДатаНачало", НачалоДня(ДатаДоставки));
    Запрос.УстановитьПараметр("ДатаКонец",  НачалоДня(ДатаДоставки) + 86400);

    Попытка
        Выборка = Запрос.Выполнить().Выбрать();
        Пока Выборка.Следующий() Цикл
            Заявка = Новый Структура;
            Заявка.Вставить("store_name",    СокрЛП(Выборка.НазваниеМагазина));
            Заявка.Вставить("address",       СокрЛП(Выборка.Адрес));
            Заявка.Вставить("delivery_date", Формат(ДатаДоставки, "ДФ=гггг-ММ-дд"));
            Заявка.Вставить("weight_kg",     ?(Выборка.ВесКг = NULL, 0, Выборка.ВесКг));
            Заявка.Вставить("quantity",      ?(Выборка.КоличествоМест = NULL, 0, Выборка.КоличествоМест));
            Заявка.Вставить("amount_rub",    ?(Выборка.Сумма = NULL, 0, Выборка.Сумма));
            Заявка.Вставить("order_number",  СокрЛП(Выборка.НомерЗаказа));
            МассивЗаявок.Добавить(Заявка);
        КонецЦикла;
    Исключение
        Сообщить("SmartRoute: Ошибка получения данных: " + ОписаниеОшибки());
    КонецПопытки;
    Возврат МассивЗаявок;
КонецФункции

#КонецОбласти

#Область ОтправкаДанных

Функция СформироватьJSON(МассивЗаявок)
    ЗаписьJSON = Новый ЗаписьJSON;
    ЗаписьJSON.УстановитьСтроку(Новый ПараметрыЗаписиJSON(ПереносСтрокJSON.Авто));
    ЗаписьJSON.ЗаписатьНачалоОбъекта();
    ЗаписьJSON.ЗаписатьИмяСвойства("orders");
    ЗаписьJSON.ЗаписатьНачалоМассива();
    Для Каждого Заявка Из МассивЗаявок Цикл
        ЗаписьJSON.ЗаписатьНачалоОбъекта();
        Для Каждого КЗ Из Заявка Цикл
            ЗаписьJSON.ЗаписатьИмяСвойства(КЗ.Ключ);
            ЗаписьJSON.ЗаписатьЗначение(КЗ.Значение);
        КонецЦикла;
        ЗаписьJSON.ЗаписатьКонецОбъекта();
    КонецЦикла;
    ЗаписьJSON.ЗаписатьКонецМассива();
    ЗаписьJSON.ЗаписатьИмяСвойства("replace_date");
    ЗаписьJSON.ЗаписатьЗначение(Истина);
    ЗаписьJSON.ЗаписатьКонецОбъекта();
    Возврат ЗаписьJSON.Закрыть();
КонецФункции

Функция ОтправитьЗаявкиВSmartRoute(ДатаДоставки = Неопределено) Экспорт
    ИнициализироватьНастройки();
    Если ДатаДоставки = Неопределено Тогда
        ДатаДоставки = НастройкиSmartRoute["ДатаОтправки"];
    КонецЕсли;

    МассивЗаявок = ПолучитьЗаявки(ДатаДоставки);
    Если МассивЗаявок.Количество() = 0 Тогда
        Возврат "⚠️ Нет проведённых заказов за " + Формат(ДатаДоставки, "ДЛФ=D");
    КонецЕсли;

    URLСервера = НастройкиSmartRoute["URL"];
    Если Прав(URLСервера, 1) = "/" Тогда
        URLСервера = Лев(URLСервера, СтрДлина(URLСервера) - 1);
    КонецЕсли;

    ЗащитаSSL = ?(НРег(Лев(URLСервера, 5)) = "https", Новый ЗащищённоеСоединениеOpenSSL(), Неопределено);
    ЧастиURL = СтрРазделить(СтрЗаменить(СтрЗаменить(URLСервера, "https://", ""), "http://", ""), "/");
    Хост = ЧастиURL[0];

    HTTPСоединение = Новый HTTPСоединение(Хост, , , , , 30, ЗащитаSSL);
    Запрос = Новый HTTPЗапрос("/api/v1/orders/batch");
    Запрос.Заголовки.Вставить("Content-Type",  "application/json; charset=utf-8");
    Запрос.Заголовки.Вставить("Authorization", "Bearer " + НастройкиSmartRoute["APIКлюч"]);
    Запрос.УстановитьТелоИзСтроки(СформироватьJSON(МассивЗаявок), "UTF-8");

    Попытка
        Ответ = HTTPСоединение.ВызватьHTTPМетод("POST", Запрос);
    Исключение
        Возврат "❌ Нет связи с SmartRoute (" + Хост + "). Проверьте интернет на сервере 1С. " + ОписаниеОшибки();
    КонецПопытки;

    ТелоОтвета = Ответ.ПолучитьТелоКакСтроку("UTF-8");

    Если Ответ.КодСостояния = 200 Тогда
        ЧтениеJSON = Новый ЧтениеJSON;
        ЧтениеJSON.УстановитьСтроку(ТелоОтвета);
        Данные = ПрочитатьJSON(ЧтениеJSON, Истина);
        Рез = Данные["data"];
        Возврат СтрШаблон(
            "✅ Отправлено %1 заявок. Найдено магазинов: %2. Дата: %3",
            Рез["created"], Рез["matched"], Формат(ДатаДоставки, "ДЛФ=D")
        );
    ИначеЕсли Ответ.КодСостояния = 401 Тогда
        Возврат "❌ Неверный API-ключ. Проверьте APIКлюч в настройках модуля.";
    ИначеЕсли Ответ.КодСостояния = 403 Тогда
        Возврат "❌ Ключ не имеет нужных прав (orders:write). Пересоздайте ключ в SmartRoute.";
    ИначеЕсли Ответ.КодСостояния = 422 Тогда
        Возврат "❌ Ошибка данных: " + Лев(ТелоОтвета, 300);
    ИначеЕсли Ответ.КодСостояния = 429 Тогда
        Возврат "⚠️ Слишком много запросов. Подождите минуту.";
    Иначе
        Возврат "❌ Ошибка сервера (HTTP " + Ответ.КодСостояния + "): " + Лев(ТелоОтвета, 200);
    КонецЕсли;
КонецФункции

Функция ПроверитьСоединение() Экспорт
    ИнициализироватьНастройки();
    URLСервера = НастройкиSmartRoute["URL"];
    Если Прав(URLСервера, 1) = "/" Тогда
        URLСервера = Лев(URLСервера, СтрДлина(URLСервера) - 1);
    КонецЕсли;
    ЗащитаSSL = ?(НРег(Лев(URLСервера, 5)) = "https", Новый ЗащищённоеСоединениеOpenSSL(), Неопределено);
    ЧастиURL = СтрРазделить(СтрЗаменить(СтрЗаменить(URLСервера, "https://", ""), "http://", ""), "/");
    Хост = ЧастиURL[0];
    Попытка
        Соед = Новый HTTPСоединение(Хост, , , , , 10, ЗащитаSSL);
        Запрос = Новый HTTPЗапрос("/api/v1/keys/me");
        Запрос.Заголовки.Вставить("Authorization", "Bearer " + НастройкиSmartRoute["APIКлюч"]);
        Ответ = Соед.Получить(Запрос);
        Если Ответ.КодСостояния = 200 Тогда
            Возврат "✅ Соединение успешно! SmartRoute подключён.";
        ИначеЕсли Ответ.КодСостояния = 401 Тогда
            Возврат "❌ Неверный API-ключ. Проверьте значение APIКлюч в модуле.";
        Иначе
            Возврат "❌ Сервер ответил кодом " + Ответ.КодСостояния;
        КонецЕсли;
    Исключение
        Возврат "❌ Нет связи: " + ОписаниеОшибки();
    КонецПопытки;
КонецФункции

#КонецОбласти

// ── Регламентное задание (раскомментировать для автозапуска) ──
// Процедура ВыполнитьРегламентноеЗадание() Экспорт
//     Результат = ОтправитьЗаявкиВSmartRoute();
//     ЗаписьЖурналаРегистрации("SmartRoute", УровеньЖурналаРегистрации.Информация, , , Результат);
// КонецПроцедуры
`;
}

// ─── Copy Button ──────────────────────────────────────────────────────────────

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
      title="Скопировать"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
      {label ?? (copied ? "Скопировано!" : "Копировать")}
    </button>
  );
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
                <p className="text-xs text-muted-foreground">{card.desc}</p>
              </CardHeader>
              {existing && (
                <CardContent className="pt-0">
                  <p className="text-xs text-muted-foreground">
                    {existing.status === "setup"
                      ? "Ожидаем первую синхронизацию"
                      : `Последняя синхр.: ${friendlyDate(existing.last_sync_at)}`}
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

type WizardStep = 1 | 2 | 3;

interface WizardData {
  integrationId: number | null;
  fullKey: string;        // shown once — used for BSL generation
  keyPrefix: string;
  baseUrl: string;
  bslDownloaded: boolean;
}

interface OneCWizardProps {
  onBack: () => void;
  onDone: (integration: Integration) => void;
}

function OneCWizard({ onBack, onDone }: OneCWizardProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<WizardStep>(1);
  const [settingUp, setSettingUp] = useState(false);
  const [data, setData] = useState<WizardData>({
    integrationId: null,
    fullKey: "",
    keyPrefix: "",
    baseUrl: window.location.origin,
    bslDownloaded: false,
  });

  // Step 3: poll for first sync
  const [pollStatus, setPollStatus] = useState<"waiting" | "connected" | "skipped">("waiting");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = useCallback((integrationId: number) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        // Check integration status first — any transition away from "setup" means 1C connected
        const integration: Integration = await apiFetch(`/api/integrations/${integrationId}`);
        if (integration.status === "active" || integration.status === "error") {
          setPollStatus("connected");
          if (pollRef.current) clearInterval(pollRef.current);
          return;
        }
        // Also accept: any non-manual sync log entry (even with 0 orders — means 1C reached us)
        const logs: SyncLog[] = await apiFetch(`/api/integrations/${integrationId}/logs?limit=5`);
        const realLogs = logs.filter((l) => l.error_detail !== "Ручная проверка");
        if (realLogs.length > 0) {
          setPollStatus("connected");
          if (pollRef.current) clearInterval(pollRef.current);
        }
      } catch {}
    }, 5000);
  }, []);

  useEffect(() => {
    if (step === 3 && data.integrationId) {
      startPolling(data.integrationId);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [step, data.integrationId, startPolling]);

  const handleAutoSetup = async () => {
    setSettingUp(true);
    try {
      const result = await apiFetch("/api/integrations/quick-setup", { method: "POST" });
      setData({
        integrationId: result.id,
        fullKey: result.full_key,
        keyPrefix: result.key_prefix,
        baseUrl: result.base_url || window.location.origin,
        bslDownloaded: false,
      });
      setStep(2);
    } catch (e: unknown) {
      toast({
        title: "Ошибка",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setSettingUp(false);
    }
  };

  const downloadBsl = () => {
    const bsl = generatePersonalizedBsl(data.baseUrl, data.fullKey);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(bsl);
    // Convert to latin1-compatible base64
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    const b64 = btoa(binary);
    downloadBase64(b64, "SmartRoute_1C.bsl");
    setData((d) => ({ ...d, bslDownloaded: true }));
    toast({ title: "Файл скачан", description: "SmartRoute_1C.bsl готов. Передайте его программисту 1С." });
  };

  const goToDone = async () => {
    if (!data.integrationId) return;
    try {
      const integration: Integration = await apiFetch(`/api/integrations/${data.integrationId}`);
      onDone(integration);
    } catch {
      onDone({
        id: data.integrationId!,
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
    { n: 1, label: "Настройка" },
    { n: 2, label: "Установка" },
    { n: 3, label: "Проверка" },
  ];

  return (
    <div className="max-w-2xl mx-auto">
      <Button variant="ghost" size="sm" className="mb-6" onClick={onBack}>
        <ArrowLeft className="w-4 h-4 mr-1" /> Назад к интеграциям
      </Button>

      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-1">Подключение 1С:Предприятие</h1>
        <p className="text-muted-foreground text-sm">Займёт 5–10 минут. Нужен программист 1С для последнего шага.</p>
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

      <Card>
        <CardContent className="p-6">

          {/* ── Step 1: Auto-setup ── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold mb-1">Шаг 1: Автоматическая настройка</h2>
                <p className="text-sm text-muted-foreground">
                  SmartRoute создаст ключ доступа и подготовит файл для 1С. Никаких технических знаний не нужно.
                </p>
              </div>

              <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
                <p className="text-sm font-medium">Что произойдёт автоматически:</p>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    Создание уникального ключа доступа для 1С
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    Подготовка настроенного файла модуля
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                    Создание канала передачи заказов
                  </li>
                </ul>
              </div>

              <Alert className="border-blue-200 bg-blue-50">
                <Info className="w-4 h-4 text-blue-600" />
                <AlertDescription className="text-blue-800 text-sm ml-2">
                  Для последнего шага потребуется ваш <strong>программист 1С</strong> — ему нужно будет установить
                  готовый файл. Это займёт около 15 минут.
                </AlertDescription>
              </Alert>

              <Button
                className="w-full"
                size="lg"
                onClick={handleAutoSetup}
                disabled={settingUp}
              >
                {settingUp ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Настраиваем...</>
                ) : (
                  <>Начать подключение <ChevronRight className="w-4 h-4 ml-1" /></>
                )}
              </Button>
            </div>
          )}

          {/* ── Step 2: Hand off to 1C programmer ── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold mb-1">Шаг 2: Установка в 1С</h2>
                <p className="text-sm text-muted-foreground">
                  Скачайте файл и передайте его программисту 1С вместе с двумя параметрами ниже.
                </p>
              </div>

              {/* Download BSL */}
              <div className="rounded-lg border-2 border-dashed border-primary/30 bg-primary/5 p-4 text-center space-y-3">
                <FileCode2 className="w-10 h-10 text-primary/60 mx-auto" />
                <div>
                  <p className="font-medium text-sm">Файл модуля для 1С</p>
                  <p className="text-xs text-muted-foreground">SmartRoute_1C.bsl — уже настроен с вашим ключом</p>
                </div>
                <Button onClick={downloadBsl} className="w-full">
                  <Download className="w-4 h-4 mr-2" />
                  Скачать файл модуля
                </Button>
                {data.bslDownloaded && (
                  <p className="text-xs text-emerald-600 flex items-center justify-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Файл скачан
                  </p>
                )}
              </div>

              {/* Params to share */}
              <div className="rounded-lg border bg-amber-50 border-amber-200 p-4 space-y-3">
                <p className="text-sm font-medium text-amber-900">
                  Передайте программисту эти данные:
                </p>
                <div className="space-y-2">
                  <div>
                    <p className="text-xs text-amber-700 mb-1">Адрес SmartRoute:</p>
                    <div className="flex items-center gap-2 bg-white rounded border border-amber-200 px-3 py-2">
                      <code className="text-xs flex-1 font-mono break-all">{data.baseUrl}</code>
                      <CopyButton text={data.baseUrl} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-amber-700 mb-1">API-ключ (показывается только сейчас — скопируйте!):</p>
                    <div className="flex items-center gap-2 bg-white rounded border border-amber-200 px-3 py-2">
                      <code className="text-xs flex-1 font-mono break-all">{data.fullKey}</code>
                      <CopyButton text={data.fullKey} />
                    </div>
                    <p className="text-xs text-amber-600 mt-1">
                      ⚠️ Ключ уже встроен в скачанный файл. Сохраните его на случай переустановки.
                    </p>
                  </div>
                </div>
              </div>

              {/* Instructions for programmer */}
              <div className="rounded-lg border bg-muted/40 p-4 space-y-3">
                <p className="text-sm font-medium">Инструкция для программиста 1С:</p>
                <ol className="space-y-2 text-sm text-muted-foreground list-none">
                  {[
                    { n: 1, text: 'Откройте 1С в режиме Конфигуратора → Файл → Новый → Внешняя обработка. Имя: SmartRoute' },
                    { n: 2, text: 'Добавьте форму (Формы → Добавить). Откройте вкладку «Модуль» и вставьте содержимое скачанного файла SmartRoute_1C.bsl' },
                    { n: 3, text: 'В разделе «Настройки» убедитесь, что URL и APIКлюч заполнены. Сохраните и откройте в режиме Предприятия.' },
                    { n: 4, text: 'Нажмите кнопку «Проверить соединение» — должно появиться «✅ Соединение успешно». Затем настройте регламентное задание на 07:30.' },
                  ].map((item) => (
                    <li key={item.n} className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 font-medium mt-0.5">
                        {item.n}
                      </span>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <Button
                className="w-full"
                onClick={() => setStep(3)}
              >
                Готово — жду первую синхронизацию <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}

          {/* ── Step 3: Wait for first sync ── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold mb-1">Шаг 3: Ожидаем первую синхронизацию</h2>
                <p className="text-sm text-muted-foreground">
                  Когда программист установит модуль и нажмёт «Отправить заявки», здесь появится результат.
                </p>
              </div>

              {pollStatus === "waiting" && (
                <div className="rounded-lg border-2 border-dashed border-muted p-8 text-center space-y-3">
                  <div className="relative inline-block">
                    <Wifi className="w-12 h-12 text-muted-foreground/40" />
                    <Loader2 className="w-5 h-5 animate-spin text-primary absolute -bottom-1 -right-1" />
                  </div>
                  <p className="text-sm font-medium">Ожидаем данные из 1С...</p>
                  <p className="text-xs text-muted-foreground">
                    Проверяем каждые 5 секунд. Страницу закрывать не нужно.
                  </p>
                </div>
              )}

              {pollStatus === "connected" && (
                <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-8 text-center space-y-3">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-8 h-8 text-emerald-600" />
                  </div>
                  <p className="text-lg font-semibold text-emerald-800">Интеграция работает!</p>
                  <p className="text-sm text-emerald-700">Первые данные из 1С получены. Теперь заказы будут поступать автоматически.</p>
                </div>
              )}

              <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Что происходит прямо сейчас:</p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Ключ доступа создан и активен
                  </li>
                  <li className="flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500" /> Файл модуля скачан
                  </li>
                  <li className="flex items-center gap-2">
                    {pollStatus === "connected" ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <Clock className="w-3 h-3 text-amber-500" />
                    )}
                    {pollStatus === "connected" ? "Первая синхронизация выполнена" : "Ожидаем первую синхронизацию из 1С"}
                  </li>
                </ul>
              </div>

              <div className="flex gap-2">
                {pollStatus !== "connected" && (
                  <Button
                    variant="ghost"
                    className="flex-1 text-muted-foreground"
                    onClick={() => { setPollStatus("skipped"); goToDone(); }}
                  >
                    Открыть панель сейчас
                  </Button>
                )}
                {pollStatus === "connected" && (
                  <Button className="w-full" onClick={goToDone}>
                    Открыть панель интеграции →
                  </Button>
                )}
              </div>
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
  const [showDelete, setShowDelete] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

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

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-refresh every 30s when status=setup (waiting for first sync)
  useEffect(() => {
    if (integration.status !== "setup") return;
    const timer = setInterval(refresh, 30000);
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

  const stats = integration.stats ?? { total_syncs: 0, total_orders: 0, total_matched: 0, total_errors: 0 };
  const baseUrl = (integration.config?.base_url as string) || window.location.origin;

  return (
    <div className="space-y-5">
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
            {integration.status === "setup"
              ? "Ожидаем первую синхронизацию из 1С"
              : `Последняя синхронизация: ${friendlyDate(integration.last_sync_at)}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Status banners */}
      {integration.status === "setup" && (
        <Alert className="border-amber-200 bg-amber-50">
          <Clock className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-800 ml-2">
            <strong>Ожидаем первую синхронизацию.</strong> Попросите программиста 1С нажать кнопку
            «Отправить заявки» в установленном модуле. После этого здесь появятся данные.
          </AlertDescription>
        </Alert>
      )}

      {integration.status === "error" && (
        <Alert className="border-red-200 bg-red-50">
          <WifiOff className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800 ml-2">
            <strong>Ошибка синхронизации.</strong> Проверьте журнал ниже — там указана причина.
            Возможные решения: убедитесь, что ключ доступа не отозван, и у 1С есть доступ в интернет.
          </AlertDescription>
        </Alert>
      )}

      {integration.status === "active" && stats.total_orders === 0 && (
        <Alert className="border-blue-200 bg-blue-50">
          <Info className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-800 ml-2">
            Соединение установлено, но заказов ещё не поступало. 1С начнёт отправлять их по расписанию (07:30).
          </AlertDescription>
        </Alert>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Синхронизаций", value: stats.total_syncs, icon: <RefreshCw className="w-4 h-4" />, color: "text-blue-600" },
          { label: "Заказов загружено", value: stats.total_orders, icon: <Package className="w-4 h-4" />, color: "text-emerald-600" },
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

      {/* Sync log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" /> Журнал синхронизаций
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {logs.filter((l) => l.error_detail !== "Ручная проверка").length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-muted-foreground">
              <p className="font-medium mb-1">Синхронизаций ещё не было</p>
              <p className="text-xs">Когда 1С отправит первые заказы — здесь появится история.</p>
            </div>
          ) : (
            <div className="divide-y">
              {logs
                .filter((l) => l.error_detail !== "Ручная проверка")
                .map((log) => (
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
                        <span className="text-sm font-medium">{log.orders_received} заказов</span>
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
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">{log.error_detail}</p>
                      )}
                      {log.stores_unmatched > 0 && (
                        <p className="text-xs text-amber-700 mt-0.5">
                          ⚠️ Незнакомые магазины —{" "}
                          <a href="/stores" className="underline">добавьте их в справочник</a>
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

      {/* Programmer instructions panel */}
      <Card>
        <CardHeader className="pb-3">
          <button
            className="flex items-center justify-between w-full text-left"
            onClick={() => setShowInstructions((v) => !v)}
          >
            <CardTitle className="text-base flex items-center gap-2">
              <FileCode2 className="w-4 h-4" /> Инструкция для программиста 1С
            </CardTitle>
            <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${showInstructions ? "rotate-90" : ""}`} />
          </button>
        </CardHeader>
        {showInstructions && (
          <CardContent className="pt-0 space-y-4">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground mb-3">
                Передайте эту информацию программисту, который устанавливает модуль.
              </p>
              <div>
                <p className="text-xs font-medium mb-1">Адрес SmartRoute:</p>
                <div className="flex items-center gap-2 bg-muted rounded border px-3 py-2">
                  <code className="text-xs flex-1 font-mono break-all">{baseUrl}</code>
                  <CopyButton text={baseUrl} />
                </div>
              </div>
            </div>
            <div className="rounded-lg border bg-muted/40 p-4 space-y-2">
              <p className="text-sm font-medium">Шаги для программиста:</p>
              <ol className="space-y-2 text-sm text-muted-foreground list-none">
                {[
                  'Конфигуратор → Файл → Новый → Внешняя обработка. Имя: SmartRoute.',
                  'Формы → Добавить. Скопируйте содержимое файла SmartRoute_1C.bsl в Модуль формы.',
                  'URL и APIКлюч в коде уже заполнены. Проверьте раздел «НастройкиИнтеграции».',
                  'Откройте обработку в режиме Предприятия → нажмите «Проверить соединение». Должно быть ✅.',
                  'Настройте регламентное задание: метод ОтправитьЗаявкиВSmartRoute() — запуск ежедневно в 07:30.',
                ].map((text, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs flex items-center justify-center shrink-0 font-medium mt-0.5">
                      {i + 1}
                    </span>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </div>
            <Alert className="border-blue-200 bg-blue-50">
              <AlertDescription className="text-blue-800 text-xs">
                Если возникла ошибка «SSL Handshake» — это проблема сертификата на сервере 1С.
                Попросите системного администратора открыть доступ на порт 443 или установить сертификат Let's Encrypt.
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      {/* Actions */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Управление</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(`${baseUrl}/integrations`, "_blank")}
          >
            <ExternalLink className="w-4 h-4 mr-2" /> Открыть SmartRoute
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

      {/* Error guidance */}
      {integration.status === "error" && (
        <Card className="border-red-200">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-red-700 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> Что делать при ошибке
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { title: "Неверный API-ключ", fix: "Пересоздайте интеграцию — ключ создастся автоматически." },
              { title: "Нет доступа в интернет", fix: "Убедитесь, что с сервера 1С есть выход в интернет (порт 443)." },
              { title: "Магазины не найдены", fix: 'Добавьте магазины в SmartRoute → раздел "Магазины".' },
              { title: "Ошибка формата данных", fix: "Проверьте имена реквизитов в модуле 1С — они должны совпадать с вашей конфигурацией." },
            ].map((item) => (
              <div key={item.title} className="rounded-lg border bg-red-50 p-3">
                <p className="text-sm font-medium text-red-800">{item.title}</p>
                <p className="text-xs text-red-700 mt-0.5">{item.fix}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Delete confirmation */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить интеграцию?</AlertDialogTitle>
            <AlertDialogDescription>
              Все настройки и журнал синхронизаций будут удалены. Заказы, уже переданные в SmartRoute,
              останутся. Ключ доступа потребуется обновить в модуле 1С.
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
    finally { setLoadingList(false); }
  }, []);

  useEffect(() => { loadIntegrations(); }, [loadIntegrations]);

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
        onBack={() => { loadIntegrations(); setView("cards"); }}
        onDeleted={() => { loadIntegrations(); setView("cards"); }}
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
