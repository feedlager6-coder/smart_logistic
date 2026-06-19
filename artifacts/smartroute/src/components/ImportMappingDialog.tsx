import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, Info, Clock, AlertTriangle, CheckCircle2, PlusCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const LS_KEY = "smartroute_import_mapping";
const LS_CITY_KEY = "smartroute_import_default_city";

type ImportMode = "new_only" | "update" | "all";

interface MappingState {
  name: number | null;
  address: number | null;
  city: number | null;
  yandex: number | null;
  unload: number | null;
  tw_from: number | null;
  tw_to: number | null;
}

interface PreviewData {
  columns: string[];
  rows: string[][];
  total_rows: number;
  unique_count: number;
  existing_count: number;
  new_count: number;
  mapping: MappingState;
}

interface Props {
  file: File;
  onClose: () => void;
  onImportStarted: (jobId: string) => void;
}

const FIELD_LABELS: { key: keyof MappingState; label: string; required: boolean }[] = [
  { key: "name",    label: "Название магазина",       required: true  },
  { key: "address", label: "Адрес",                   required: false },
  { key: "city",    label: "Город (колонка)",          required: false },
  { key: "yandex",  label: "Ссылка Яндекс",           required: false },
  { key: "unload",  label: "Время разгрузки (мин)",   required: false },
  { key: "tw_from", label: "Временное окно — с",      required: false },
  { key: "tw_to",   label: "Временное окно — до",     required: false },
];

function getEtaLabel(count: number): string {
  if (count <= 30) return "менее 30 сек";
  if (count <= 80) return "около 1 мин";
  if (count <= 150) return "1–2 мин";
  if (count <= 250) return "2–4 мин";
  if (count <= 400) return "4–7 мин";
  return "7–12 мин";
}

function ColSelect({
  value,
  columns,
  onChange,
}: {
  value: number | null;
  columns: string[];
  onChange: (v: number | null) => void;
}) {
  const strVal = value === null ? "__none__" : String(value);
  return (
    <Select
      value={strVal}
      onValueChange={(v) => onChange(v === "__none__" ? null : Number(v))}
    >
      <SelectTrigger className="h-8 text-sm">
        <SelectValue placeholder="Не выбрано" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">— Не выбрано —</SelectItem>
        {columns.map((col, i) => (
          <SelectItem key={i} value={String(i)}>
            {col || `Колонка ${i + 1}`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const MODE_OPTIONS: { value: ImportMode; label: string; description: string; icon: React.ReactNode }[] = [
  {
    value: "new_only",
    label: "Только новые",
    description: "Пропустить уже существующие — безопасный режим по умолчанию",
    icon: <PlusCircle className="w-4 h-4 text-green-600" />,
  },
  {
    value: "update",
    label: "Обновить существующие",
    description: "Перезаписать данные уже существующих магазинов из файла",
    icon: <RefreshCw className="w-4 h-4 text-blue-600" />,
  },
  {
    value: "all",
    label: "Импортировать всё",
    description: "Создать новые записи для всех строк, включая дубликаты",
    icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
  },
];

export function ImportMappingDialog({ file, onClose, onImportStarted }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<MappingState>({
    name: null, address: null, city: null, yandex: null,
    unload: null, tw_from: null, tw_to: null,
  });
  const [defaultCity, setDefaultCity] = useState<string>(() => {
    try { return localStorage.getItem(LS_CITY_KEY) ?? ""; } catch { return ""; }
  });
  const [importing, setImporting] = useState(false);
  const [showCityWarning, setShowCityWarning] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("new_only");

  useEffect(() => {
    const fd = new FormData();
    fd.append("file", file);
    fetch("/api/stores/import/preview", { method: "POST", body: fd, credentials: "include" })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.detail || "Ошибка preview"));
        return r.json();
      })
      .then((data: PreviewData) => {
        setPreview(data);

        let merged: MappingState = { ...data.mapping };
        try {
          const saved = localStorage.getItem(LS_KEY);
          if (saved) {
            const parsed = JSON.parse(saved) as Partial<MappingState>;
            merged = { ...merged, ...parsed };
          }
        } catch {}
        setMapping(merged);
        setLoading(false);
      })
      .catch((e) => {
        setError(typeof e === "string" ? e : "Не удалось прочитать файл");
        setLoading(false);
      });
  }, [file]);

  const setField = (key: keyof MappingState, val: number | null) => {
    setMapping((prev) => ({ ...prev, [key]: val }));
    if (key === "city") setShowCityWarning(false);
  };

  const cityColSelected = mapping.city !== null;
  const hasCityInfo = cityColSelected || defaultCity.trim().length > 0;

  const startImport = () => {
    if (mapping.name === null) return;
    setImporting(true);

    try {
      localStorage.setItem(LS_KEY, JSON.stringify(mapping));
      localStorage.setItem(LS_CITY_KEY, defaultCity.trim());
    } catch {}

    const fullMapping = {
      ...mapping,
      default_city: defaultCity.trim() || null,
    };

    const fd = new FormData();
    fd.append("file", file);
    fd.append("mapping", JSON.stringify(fullMapping));
    fd.append("import_mode", importMode);

    fetch("/api/stores/import/start", { method: "POST", body: fd, credentials: "include" })
      .then((r) => r.json())
      .then(({ job_id }) => {
        onImportStarted(job_id);
      })
      .catch(() => {
        setImporting(false);
        setError("Не удалось начать импорт");
      });
  };

  const handleImport = () => {
    if (mapping.name === null) return;
    if (!hasCityInfo && !showCityWarning) {
      setShowCityWarning(true);
      return;
    }
    startImport();
  };

  const deduped = preview ? preview.total_rows - preview.unique_count : 0;
  const eta = preview ? getEtaLabel(preview.unique_count) : null;

  const hasExisting = preview && preview.existing_count > 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Настройка импорта Excel / 1С</DialogTitle>
          <DialogDescription>
            Проверьте, какие колонки файла соответствуют полям SmartRoute.
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <span className="ml-3 text-muted-foreground">Читаю файл...</span>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="w-4 h-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {preview && !loading && (
          <div className="space-y-5">
            {/* Stats row */}
            <div className="flex flex-wrap gap-4 text-sm items-center">
              <span className="text-muted-foreground">
                Строк в файле: <b className="text-foreground">{preview.total_rows}</b>
              </span>
              <span className="text-muted-foreground">
                Уникальных точек: <b className="text-foreground">{preview.unique_count}</b>
              </span>
              {deduped > 0 && (
                <span className="flex items-center gap-1 text-amber-600">
                  <Info className="w-3.5 h-3.5" />
                  {deduped} дубликат{deduped === 1 ? "" : deduped < 5 ? "а" : "ов"} объединено
                </span>
              )}
              {eta && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  Ожидаемое время: <b className="text-foreground ml-1">{eta}</b>
                </span>
              )}
            </div>

            {/* Existing vs new breakdown — shown when there are matches in DB */}
            {hasExisting && (
              <div className="rounded-lg border overflow-hidden">
                <div className="bg-muted/40 px-4 py-2 border-b">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Сравнение с базой данных
                  </p>
                </div>
                <div className="grid grid-cols-2 divide-x">
                  <div className="px-4 py-3 flex items-center gap-3">
                    <PlusCircle className="w-5 h-5 text-green-600 shrink-0" />
                    <div>
                      <div className="text-xl font-bold text-green-700">{preview.new_count}</div>
                      <div className="text-xs text-muted-foreground">новых магазинов</div>
                    </div>
                  </div>
                  <div className="px-4 py-3 flex items-center gap-3">
                    <CheckCircle2 className="w-5 h-5 text-blue-500 shrink-0" />
                    <div>
                      <div className="text-xl font-bold text-blue-700">{preview.existing_count}</div>
                      <div className="text-xs text-muted-foreground">уже существующих</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Import mode selector — only shown when existing stores found */}
            {hasExisting && (
              <div className="space-y-2">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Что делать с уже существующими магазинами?
                </Label>
                <div className="space-y-2">
                  {MODE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setImportMode(opt.value)}
                      className={`w-full flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                        importMode === opt.value
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <div className="mt-0.5 shrink-0">{opt.icon}</div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm font-medium ${importMode === opt.value ? "text-primary" : ""}`}>
                          {opt.label}
                          {opt.value === "new_only" && (
                            <span className="ml-2 text-xs font-normal bg-primary/10 text-primary rounded px-1.5 py-0.5">
                              по умолчанию
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                      </div>
                      <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 ${
                        importMode === opt.value ? "border-primary bg-primary" : "border-muted-foreground/40"
                      }`} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Info hint */}
            <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40 p-3 text-sm text-blue-800 dark:text-blue-200">
              <Info className="w-4 h-4 mt-0.5 shrink-0 text-blue-500" />
              <div className="space-y-1">
                <p className="font-medium">Для максимальной точности геокодинга рекомендуется:</p>
                <ul className="list-disc list-inside space-y-0.5 text-blue-700 dark:text-blue-300">
                  <li>указывать город (колонку или поле ниже);</li>
                  <li>добавить ссылку Яндекс.Карт, если она есть в выгрузке.</li>
                </ul>
              </div>
            </div>

            {/* Mapping selects */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FIELD_LABELS.map(({ key, label, required }) => (
                <div key={key} className="space-y-1">
                  <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {label}
                    {required && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  <ColSelect
                    value={mapping[key]}
                    columns={preview.columns}
                    onChange={(v) => setField(key, v)}
                  />
                </div>
              ))}
            </div>

            {/* Default city input */}
            <div className="space-y-1.5">
              <Label htmlFor="default-city" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Город по умолчанию
                {cityColSelected && (
                  <span className="ml-2 text-[10px] normal-case font-normal text-muted-foreground/60">(колонка выбрана — поле игнорируется)</span>
                )}
              </Label>
              <Input
                id="default-city"
                value={defaultCity}
                onChange={(e) => { setDefaultCity(e.target.value); setShowCityWarning(false); }}
                placeholder="Например: Махачкала"
                disabled={cityColSelected}
                className="h-8 text-sm"
              />
              <p className="text-[11px] text-muted-foreground">
                Используется, если в файле нет колонки с городом. Адрес будет передан как «{defaultCity.trim() || "Город"}, улица дом».
              </p>
            </div>

            {/* City warning */}
            {showCityWarning && !hasCityInfo && (
              <Alert className="border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-800 dark:text-amber-300">
                  <span className="font-semibold">Город не указан.</span> Без города геокодирование может дать неточные результаты — адреса могут найтись в другом городе или вовсе не найтись.
                  <br />
                  <span className="text-sm">Укажите город выше или нажмите «Продолжить без города».</span>
                </AlertDescription>
              </Alert>
            )}

            {mapping.name === null && (
              <Alert variant="destructive" className="py-2">
                <AlertCircle className="w-4 h-4" />
                <AlertDescription className="text-sm">Выберите колонку «Название магазина» — это обязательное поле.</AlertDescription>
              </Alert>
            )}

            {/* Preview table */}
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Первые строки файла
              </p>
              <div className="overflow-x-auto rounded border text-xs">
                <table className="min-w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      {preview.columns.map((col, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                          {col || `Кол. ${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, ri) => (
                      <tr key={ri} className="border-t hover:bg-muted/30">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-1.5 max-w-[200px] truncate" title={cell}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 flex-wrap">
          <Button variant="outline" onClick={onClose} disabled={importing}>
            Отмена
          </Button>
          {showCityWarning && !hasCityInfo ? (
            <Button
              variant="outline"
              onClick={startImport}
              disabled={importing || mapping.name === null}
              className="border-amber-400 text-amber-800 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-950/40"
            >
              Продолжить без города
            </Button>
          ) : null}
          <Button
            onClick={handleImport}
            disabled={loading || !!error || importing || mapping.name === null}
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Запускаю...
              </>
            ) : showCityWarning && !hasCityInfo ? (
              "Указать город"
            ) : (
              `Начать импорт (${
                importMode === "new_only" && preview?.existing_count
                  ? `${preview.new_count} новых`
                  : `${preview?.unique_count ?? "?"} точек`
              })`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
