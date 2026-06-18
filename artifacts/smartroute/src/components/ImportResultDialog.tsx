import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, XCircle, MapPin, Loader2, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export interface ImportResult {
  total: number;
  imported: number;
  failed: number;
  deduped: number;
  geocoded_found: number;
  geocoded_not_found: number;
  duplicates: Array<{
    row: number;
    name: string;
    address: string;
    new_store_id: number;
    existing_id: number;
    existing_name: string;
    existing_address: string;
    dist_m: number;
  }>;
}

interface Props {
  result: ImportResult;
  onClose: () => void;
  onDeleteDuplicates: (ids: number[]) => Promise<void>;
}

export function ImportResultDialog({ result, onClose, onDeleteDuplicates }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const hasDuplicates = result.duplicates.length > 0;
  const dupIds = result.duplicates.map((d) => d.new_store_id).filter(Boolean);

  const handleDeleteDuplicates = async () => {
    setDeleting(true);
    try {
      await onDeleteDuplicates(dupIds);
      setDeleted(true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            Импорт завершён
          </DialogTitle>
          <DialogDescription>
            Обработано {result.total} строк, добавлено {result.imported} точек доставки
            {result.deduped > 0 && ` (${result.deduped} дубликат${result.deduped === 1 ? "" : result.deduped < 5 ? "а" : "ов"} объединено до импорта)`}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">

          {/* Geocoding stats */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Статистика геокодирования
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800 p-3 text-center">
                <CheckCircle2 className="w-5 h-5 text-green-600 mx-auto mb-1" />
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{result.geocoded_found}</div>
                <div className="text-xs text-green-700 dark:text-green-400 mt-0.5">Геокодировано</div>
              </div>
              <div className={`rounded-lg border p-3 text-center ${result.geocoded_not_found > 0 ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800" : "bg-muted/30 border-border"}`}>
                <XCircle className={`w-5 h-5 mx-auto mb-1 ${result.geocoded_not_found > 0 ? "text-amber-500" : "text-muted-foreground"}`} />
                <div className={`text-2xl font-bold ${result.geocoded_not_found > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>{result.geocoded_not_found}</div>
                <div className={`text-xs mt-0.5 ${result.geocoded_not_found > 0 ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>Без координат</div>
              </div>
              <div className={`rounded-lg border p-3 text-center ${result.failed > 0 ? "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800" : "bg-muted/30 border-border"}`}>
                <AlertTriangle className={`w-5 h-5 mx-auto mb-1 ${result.failed > 0 ? "text-red-500" : "text-muted-foreground"}`} />
                <div className={`text-2xl font-bold ${result.failed > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>{result.failed}</div>
                <div className={`text-xs mt-0.5 ${result.failed > 0 ? "text-red-700 dark:text-red-400" : "text-muted-foreground"}`}>Ошибок</div>
              </div>
            </div>
            {result.geocoded_not_found > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                Точки без координат не попадут в маршрут. Отредактируйте их вручную, добавив адрес или ссылку Яндекс Карт.
              </p>
            )}
          </div>

          {/* Duplicates section */}
          {hasDuplicates && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Возможные дубликаты — {result.duplicates.length} шт.
              </p>

              {deleted ? (
                <Alert className="border-green-200 bg-green-50 dark:bg-green-950/30">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <AlertDescription className="text-green-700 dark:text-green-400">
                    {dupIds.length} дублирующих точек удалено.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/30 mb-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600" />
                    <AlertDescription className="text-amber-800 dark:text-amber-300">
                      Импортированные точки находятся очень близко к уже существующим (менее 20 м).
                      Возможно, это одни и те же адреса. Выберите действие ниже.
                    </AlertDescription>
                  </Alert>

                  <div className="rounded-lg border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Новый (импортирован)</th>
                          <th className="text-left px-3 py-2 font-medium text-xs text-muted-foreground">Уже существующий</th>
                          <th className="text-right px-3 py-2 font-medium text-xs text-muted-foreground">Расст.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.duplicates.map((dup, i) => (
                          <tr key={i} className={`border-t ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-foreground">{dup.name}</div>
                              {dup.address && (
                                <div className="text-xs text-muted-foreground truncate max-w-[220px]" title={dup.address}>
                                  {dup.address}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-foreground">{dup.existing_name}</div>
                              {dup.existing_address && (
                                <div className="text-xs text-muted-foreground truncate max-w-[220px]" title={dup.existing_address}>
                                  {dup.existing_address}
                                </div>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <span className="inline-flex items-center gap-1 text-xs font-mono text-amber-700 dark:text-amber-400">
                                <MapPin className="w-3 h-3" />
                                {dup.dist_m < 1 ? "<1" : Math.round(dup.dist_m)} м
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={handleDeleteDuplicates}
                      disabled={deleting}
                      className="flex-1 sm:flex-none"
                    >
                      {deleting ? (
                        <><Loader2 className="w-4 h-4 animate-spin mr-2" />Удаляю...</>
                      ) : (
                        `Удалить импортированные дубликаты (${dupIds.length})`
                      )}
                    </Button>
                    <Button variant="outline" size="sm" onClick={onClose} className="flex-1 sm:flex-none">
                      Оставить как отдельные точки
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button onClick={onClose}>
            {deleted || !hasDuplicates ? "Готово" : "Закрыть"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
