import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Copy,
  Check,
  AlertTriangle,
  CheckCircle2,
  Info,
  ChevronDown,
  ArrowLeft,
  Code2,
  Settings,
  Shield,
  Clock,
  Terminal,
} from "lucide-react";
import { Link } from "wouter";

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
    >
      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
      {label ?? (copied ? "Скопировано!" : "Копировать")}
    </button>
  );
}

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <CardHeader className="pb-2">
        <button
          className="flex items-center justify-between w-full text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <CardTitle className="text-base flex items-center gap-2">
            {icon}
            {title}
          </CardTitle>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </CardHeader>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

export function IntegrationsSpecialistPage() {
  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <Link href="/integrations">
          <Button variant="ghost" size="sm" className="-ml-2 mb-4">
            <ArrowLeft className="w-4 h-4 mr-1" /> Назад к интеграциям
          </Button>
        </Link>
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-orange-100 border border-orange-200 flex items-center justify-center font-bold text-orange-700 text-lg shrink-0">
            1С
          </div>
          <div>
            <h1 className="text-2xl font-bold mb-1">Техническая документация</h1>
            <p className="text-muted-foreground text-sm">
              Для специалиста по 1С:Предприятие. Настройка интеграции SmartRoute.
            </p>
          </div>
        </div>
      </div>

      <Alert className="border-blue-200 bg-blue-50">
        <Info className="w-4 h-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-sm ml-2">
          Эта страница содержит технические детали для специалиста по 1С. Если у вас есть
          архив <strong>SmartRoute_Setup.zip</strong> — начните с Варианта А. Если нет — с Варианта Б.
        </AlertDescription>
      </Alert>

      {/* Variant A: EPF file */}
      <Section title="Вариант А — установка SmartRoute.epf (рекомендуется)" icon={<Settings className="w-4 h-4" />}>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Используйте этот вариант, если у вас есть файл <code className="text-xs bg-muted px-1 py-0.5 rounded">SmartRoute.epf</code> из архива SmartRoute_Setup.zip.
          </p>

          <ol className="space-y-4">
            {[
              {
                title: "Откройте файл в 1С:Предприятие",
                content: (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Запустите 1С в режиме <strong>Предприятия</strong> (не Конфигуратора).</p>
                    <p>Файл → Открыть → выберите <code className="text-xs bg-muted px-1 rounded">SmartRoute.epf</code></p>
                  </div>
                ),
              },
              {
                title: "Введите параметры подключения",
                content: (
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p>В открывшейся форме заполните поля:</p>
                    <div className="rounded-lg border bg-muted/40 p-3 space-y-2 font-mono text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Адрес SmartRoute:</span>
                        <span className="font-medium">[из архива Инструкция.txt]</span>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">API-ключ:</span>
                        <span className="font-medium">[из архива Инструкция.txt]</span>
                      </div>
                    </div>
                    <p className="text-xs text-amber-700">
                      ⚠️ Ключ доступа показывается только один раз при создании интеграции. Он сохранён в файле Инструкция.txt внутри архива SmartRoute_Setup.zip.
                    </p>
                  </div>
                ),
              },
              {
                title: "Проверьте соединение",
                content: (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Нажмите кнопку <strong>«Проверить соединение»</strong>.</p>
                    <p>Ожидаемый результат:</p>
                    <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-2 font-mono text-xs text-emerald-800">
                      ✅ Соединение успешно. SmartRoute подключён.
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Если возникает ошибка SSL — см. раздел «Решение проблем» ниже.
                    </p>
                  </div>
                ),
              },
              {
                title: "Настройте автоматическую отправку",
                content: (
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p>Для автоматической передачи заказов настройте регламентное задание:</p>
                    <ul className="list-disc list-inside space-y-1 text-xs ml-2">
                      <li>Сервис → Регламентные задания → Добавить</li>
                      <li>Метод: <code className="bg-muted px-1 rounded">ОтправитьЗаявкиВSmartRoute</code></li>
                      <li>Расписание: ежедневно в <strong>07:30</strong></li>
                      <li>Флаг «Активно» должен быть установлен</li>
                    </ul>
                    <Alert className="border-blue-200 bg-blue-50 mt-2">
                      <AlertDescription className="text-blue-800 text-xs">
                        Параметр «Дата отправки» в модуле по умолчанию = текущая дата. Для передачи заказов
                        на следующий день установите смещение <code>ТекущаяДата() + 1</code> в методе
                        <code className="ml-1">ИнициализироватьНастройки()</code>.
                      </AlertDescription>
                    </Alert>
                  </div>
                ),
              },
            ].map((step, i) => (
              <li key={i} className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-primary/10 text-primary text-sm flex items-center justify-center shrink-0 font-semibold mt-0.5">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-2">{step.title}</p>
                  {step.content}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Variant B: BSL manual assembly */}
      <Section
        title="Вариант Б — сборка из исходного кода BSL"
        icon={<Code2 className="w-4 h-4" />}
        defaultOpen={false}
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Используйте этот вариант, если SmartRoute.epf не открывается в вашей версии 1С,
            или если вы хотите включить код в существующую конфигурацию.
          </p>

          <Alert className="border-amber-200 bg-amber-50">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-amber-900 text-xs ml-2">
              Этот вариант предполагает работу в режиме Конфигуратора. Убедитесь, что у вас есть
              права на создание внешних обработок.
            </AlertDescription>
          </Alert>

          <ol className="space-y-4">
            {[
              {
                title: "Создайте внешнюю обработку",
                content: (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Откройте 1С в режиме <strong>Конфигуратора</strong>.</p>
                    <p>Файл → Новый → Внешняя обработка</p>
                    <div className="rounded border bg-muted/40 p-2 font-mono text-xs space-y-1">
                      <div>Имя объекта: <strong>SmartRoute</strong></div>
                      <div>Синоним: SmartRoute — передача заявок</div>
                    </div>
                  </div>
                ),
              },
              {
                title: "Добавьте форму с модулем",
                content: (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>В дереве объекта: Формы → Добавить → Произвольная форма → ОК</p>
                    <p>Перейдите на вкладку <strong>«Модуль»</strong>.</p>
                  </div>
                ),
              },
              {
                title: "Вставьте код BSL",
                content: (
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p>Откройте файл <code className="text-xs bg-muted px-1 rounded">SmartRoute.bsl</code> из архива в текстовом редакторе.</p>
                    <p>Скопируйте всё содержимое (Ctrl+A → Ctrl+C) и вставьте в модуль формы (Ctrl+V).</p>
                    <div className="rounded border bg-amber-50 border-amber-200 p-2 text-xs text-amber-800">
                      <strong>Важно:</strong> URL и API-ключ уже встроены в код — изменять их не нужно.
                      Они находятся в методе <code>ИнициализироватьНастройки()</code> в разделе
                      <code className="ml-1">#Область НастройкиИнтеграции</code>.
                    </div>
                  </div>
                ),
              },
              {
                title: "Сохраните как EPF",
                content: (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Файл → Сохранить как... → тип: «Внешняя обработка (*.epf)»</p>
                    <p>Имя файла: <strong>SmartRoute</strong></p>
                  </div>
                ),
              },
              {
                title: "Откройте и проверьте соединение",
                content: (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Запустите 1С в режиме <strong>Предприятия</strong>.</p>
                    <p>Файл → Открыть → SmartRoute.epf</p>
                    <p>Нажмите <strong>«Проверить соединение»</strong>. Ожидаемый результат:</p>
                    <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-2 font-mono text-xs text-emerald-800">
                      ✅ Соединение успешно. SmartRoute подключён.
                    </div>
                  </div>
                ),
              },
              {
                title: "Настройте регламентное задание",
                content: (
                  <div className="text-sm text-muted-foreground space-y-1">
                    <p>Конфигуратор → Регламентные задания → Добавить</p>
                    <div className="rounded border bg-muted/40 p-2 font-mono text-xs space-y-1">
                      <div>Метод: <strong>ОтправитьЗаявкиВSmartRoute</strong></div>
                      <div>Расписание: ежедневно в <strong>07:30</strong></div>
                    </div>
                  </div>
                ),
              },
            ].map((step, i) => (
              <li key={i} className="flex gap-4">
                <div className="w-7 h-7 rounded-full bg-muted text-muted-foreground text-sm flex items-center justify-center shrink-0 font-semibold mt-0.5">
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold mb-2">{step.title}</p>
                  {step.content}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* API reference */}
      <Section
        title="API — формат данных"
        icon={<Terminal className="w-4 h-4" />}
        defaultOpen={false}
      >
        <div className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            SmartRoute принимает заказы на эндпоинт <code className="text-xs bg-muted px-1 rounded">POST /api/v1/orders/batch</code>.
            Аутентификация: Bearer-токен в заголовке Authorization.
          </p>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Запрос</p>
            <pre className="rounded-lg bg-gray-900 text-gray-100 p-4 text-xs overflow-x-auto leading-relaxed">{`POST /api/v1/orders/batch
Authorization: Bearer sr_live_xxxxxxxx...
Content-Type: application/json

{
  "orders": [
    {
      "store_name":    "Магазин №1",
      "address":       "ул. Ленина, 10",
      "delivery_date": "2026-06-28",
      "weight_kg":     150.5,
      "quantity":      12,
      "products":      "Молоко 1л × 10 шт; Кефир × 2 шт",
      "amount_rub":    4500.00,
      "order_number":  "ЗП-000123"
    }
  ],
  "replace_date": true
}`}</pre>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Поля заказа</p>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2 font-semibold">Поле</th>
                    <th className="text-left px-3 py-2 font-semibold">Тип</th>
                    <th className="text-left px-3 py-2 font-semibold">Обязательно</th>
                    <th className="text-left px-3 py-2 font-semibold">Описание</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[
                    ["store_name", "string", "✅", "Название магазина (должно совпадать со справочником)"],
                    ["address", "string", "✅", "Адрес доставки"],
                    ["delivery_date", "string", "✅", "Дата в формате YYYY-MM-DD"],
                    ["weight_kg", "number", "—", "Вес в кг"],
                    ["quantity", "number", "—", "Количество мест/единиц"],
                    ["products", "string", "—", "Список товаров (для маршрутного листа)"],
                    ["amount_rub", "number", "—", "Сумма заказа в рублях"],
                    ["order_number", "string", "—", "Номер документа в 1С"],
                  ].map(([field, type, req, desc]) => (
                    <tr key={field} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-mono">{field}</td>
                      <td className="px-3 py-2 text-muted-foreground">{type}</td>
                      <td className="px-3 py-2">{req}</td>
                      <td className="px-3 py-2 text-muted-foreground">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">replace_date</p>
            <p className="text-muted-foreground text-xs">
              <code className="bg-muted px-1 rounded">true</code> — перезаписывает все заказы за указанную дату (рекомендуется для ежедневных выгрузок).<br />
              <code className="bg-muted px-1 rounded">false</code> — добавляет к существующим.
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Ответы</p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex gap-2 items-start">
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 shrink-0">200</Badge>
                <span>Успешно. Поле <code>sync_log_id</code> — ID записи в журнале синхронизации.</span>
              </div>
              <div className="flex gap-2 items-start">
                <Badge className="bg-red-100 text-red-800 border-red-200 shrink-0">401</Badge>
                <span>Неверный или истёкший API-ключ. Пересоздайте подключение в SmartRoute.</span>
              </div>
              <div className="flex gap-2 items-start">
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 shrink-0">422</Badge>
                <span>Ошибка валидации данных. Проверьте формат полей.</span>
              </div>
            </div>
          </div>
        </div>
      </Section>

      {/* Security */}
      <Section
        title="Безопасность и ключ доступа"
        icon={<Shield className="w-4 h-4" />}
        defaultOpen={false}
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>API-ключ имеет вид <code className="text-xs bg-muted px-1 rounded">sr_live_xxxxxxxx...</code> и передаётся
          в заголовке <code className="text-xs bg-muted px-1 rounded">Authorization: Bearer &lt;ключ&gt;</code>.</p>
          <ul className="list-disc list-inside space-y-1 text-xs ml-2">
            <li>Ключ выдаётся один раз и хранится только в зашифрованном виде на сервере.</li>
            <li>Ключ имеет права только на запись заказов (<code>orders:write</code>).</li>
            <li>Если ключ скомпрометирован — пересоздайте подключение в SmartRoute (старый ключ деактивируется).</li>
            <li>Для тестирования соединения доступен <code>GET /api/healthz</code> без авторизации.</li>
          </ul>
        </div>
      </Section>

      {/* Troubleshooting */}
      <Section
        title="Решение проблем"
        icon={<AlertTriangle className="w-4 h-4" />}
        defaultOpen={false}
      >
        <div className="space-y-3">
          {[
            {
              title: "Ошибка SSL / TLS Handshake",
              content:
                "На сервере 1С нет доверенного корневого сертификата. Решения: (1) установить актуальные корневые сертификаты на сервер 1С; (2) попросить системного администратора открыть исходящий порт 443 и разрешить HTTPS-трафик к домену SmartRoute.",
            },
            {
              title: "HTTP 401 Unauthorized",
              content:
                "API-ключ недействителен или был заменён. Перейдите в SmartRoute → Интеграции → Управление подключением → Пересоздать файл подключения. Скачайте новый архив и обновите настройки в 1С.",
            },
            {
              title: "Магазины не найдены (stores_unmatched > 0)",
              content:
                "Название магазина в поле store_name не совпадает со справочником SmartRoute. Проверьте названия в SmartRoute → Магазины. Алгоритм сравнения нечёткий (Jaccard ≥ 0.85), но порядок слов влияет.",
            },
            {
              title: "Ошибка «Не удалось подключиться к серверу»",
              content:
                "Сервер 1С не имеет доступа к интернету или заблокирован корпоративным прокси. Проверьте: ping smartroute.app с сервера 1С; наличие прокси-сервера; открытость порта 443.",
            },
            {
              title: "Заказы дублируются",
              content:
                "Убедитесь что параметр replace_date = Истина (true) в методе ОтправитьЗаявкиВSmartRoute. С этим флагом повторная отправка за ту же дату заменяет предыдущие заказы.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border p-3 bg-muted/20">
              <p className="text-sm font-semibold mb-1">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.content}</p>
            </div>
          ))}
        </div>
      </Section>

      {/* Timing */}
      <Section
        title="Расписание и тайминги"
        icon={<Clock className="w-4 h-4" />}
        defaultOpen={false}
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>Рекомендуемое расписание ежедневной выгрузки — <strong>07:30</strong> (до начала рабочего дня диспетчера).</p>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-2 font-semibold">Время</th>
                  <th className="text-left px-3 py-2 font-semibold">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                <tr><td className="px-3 py-2">07:30</td><td className="px-3 py-2 text-muted-foreground">1С отправляет заказы в SmartRoute</td></tr>
                <tr><td className="px-3 py-2">08:00</td><td className="px-3 py-2 text-muted-foreground">Диспетчер открывает SmartRoute, строит маршруты</td></tr>
                <tr><td className="px-3 py-2">08:30</td><td className="px-3 py-2 text-muted-foreground">Водители получают маршруты</td></tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs">
            Таймаут HTTP-запроса в BSL-модуле: 30 секунд. При передаче более 500 заказов за раз
            увеличьте таймаут в методе <code className="bg-muted px-1 rounded">ОтправитьНаСервер</code>.
          </p>
        </div>
      </Section>

      {/* Support */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-blue-900 mb-1">Техническая поддержка</p>
              <p className="text-xs text-blue-800">
                Если возникли вопросы по интеграции — пишите на{" "}
                <a href="mailto:support@smartroute.app" className="underline font-medium">
                  support@smartroute.app
                </a>{" "}
                с темой «1С интеграция». Укажите версию 1С, конфигурацию и текст ошибки.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
