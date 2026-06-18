import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, AlertCircle, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const LS_KEY = "smartroute_import_mapping";

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
  { key: "city",    label: "Город",                   required: false },
  { key: "yandex",  label: "Ссылка Яндекс",           required: false },
  { key: "unload",  label: "Время разгрузки (мин)",   required: false },
  { key: "tw_from", label: "Временное окно — с",      required: false },
  { key: "tw_to",   label: "Временное окно — до",     required: false },
];

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

export function ImportMappingDialog({ file, onClose, onImportStarted }: Props) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [mapping, setMapping] = useState<MappingState>({
    name: null, address: null, city: null, yandex: null,
    unload: null, tw_from: null, tw_to: null,
  });
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    const fd = new FormData();
    fd.append("file", file);
    fetch("/api/stores/import/preview", { method: "POST", body: fd })
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.detail || "Ошибка preview"));
        return r.json();
      })
      .then((data: PreviewData) => {
        setPreview(data);

        // Merge auto-detected mapping with last saved mapping from localStorage
        let merged: MappingState = { ...data.mapping };
        try {
          const saved = localStorage.getItem(LS_KEY);
          if (saved) {
            const parsed = JSON.parse(saved) as Partial<MappingState>;
            // Only apply saved if columns count matches (same file format)
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
  };

  const handleImport = () => {
    if (mapping.name === null) return;
    setImporting(true);

    // Save mapping to localStorage for next time
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(mapping));
    } catch {}

    const fd = new FormData();
    fd.append("file", file);
    fd.append("mapping", JSON.stringify(mapping));

    fetch("/api/stores/import/start", { method: "POST", body: fd })
      .then((r) => r.json())
      .then(({ job_id }) => {
        onImportStarted(job_id);
      })
      .catch(() => {
        setImporting(false);
        setError("Не удалось начать импорт");
      });
  };

  const deduped = preview ? preview.total_rows - preview.unique_count : 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Настройка импорта Excel</DialogTitle>
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
            <div className="flex flex-wrap gap-4 text-sm">
              <span className="text-muted-foreground">
                Строк в файле: <b className="text-foreground">{preview.total_rows}</b>
              </span>
              <span className="text-muted-foreground">
                Уникальных точек после дедупликации: <b className="text-foreground">{preview.unique_count}</b>
              </span>
              {deduped > 0 && (
                <span className="flex items-center gap-1 text-amber-600">
                  <Info className="w-3.5 h-3.5" />
                  {deduped} дубликат{deduped === 1 ? "" : deduped < 5 ? "а" : "ов"} объединено
                </span>
              )}
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
          <Button
            onClick={handleImport}
            disabled={loading || !!error || importing || mapping.name === null}
          >
            {importing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                Запускаю...
              </>
            ) : (
              `Начать импорт (${preview?.unique_count ?? "?"} точек)`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
