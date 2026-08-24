import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, XCircle, MapPin, Loader2, Info, Database, Zap, Globe } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

export interface GeoStats {
  explicit?: number;
  yandex_url?: number;
  memory_cache?: number;
  db_cache?: number;
  yandex_api?: number;
  nominatim?: number;
  not_found?: number;
}

export interface ImportResult {
  total: number;
  imported: number;
  failed: number;
  deduped: number;
  skipped_existing?: number;
  geocoded_found: number;
  geocoded_not_found: number;
  geocode_stats?: GeoStats;
  duplicates: Array<{
    row: number;
    name: string;
    address: string;
    new_store_id: number;
    existing_id: number;
    existing_name: string;
    existing_address: string;
    dist_m: number;
    match_reason?: "name_address" | "name_coords" | string;
    is_likely_duplicate?: boolean;
  }>;
}

interface Props {
  result: ImportResult;
  onClose: () => void;
  onDeleteDuplicates: (ids: number[]) => Promise<void>;
}

const REASON_LABEL: Record<string, string> = {
  name_address: "Совпадают название и адрес",
  name_coords: "Совпадают название и координаты",
};

function GeoStatsBadge({ label, value, icon, color }: {
  label: string; value: number; icon: React.ReactNode;
  color: "green" | "blue" | "violet" | "amber";
}) {
  if (!value) return null;
  const cls = {
    green: "bg-green-50 border-green-200 text-green-700 dark:bg-green-950/30 dark:border-green-800 dark:text-green-400",
    blue: "bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400",
    violet: "bg-violet-50 border-violet-200 text-violet-700 dark:bg-violet-950/30 dark:border-violet-800 dark:text-violet-400",
    amber: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400",
  }[color];
  return (
    <div className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${cls}`}>
      {icon}
      <span className="font-bold">{value}</span>
      <span>{label}</span>
    </div>
  );
}

export function ImportResultDialog({ result, onClose, onDeleteDuplicates }: Props) {
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);

  const trueDuplicates = result.duplicates.filter((d) => d.is_likely_duplicate !== false);
  const hasDuplicates = trueDuplicates.length > 0;
  const dupIds = trueDuplicates.map((d) => d.new_store_id).filter(Boolean);

  const gs = result.geocode_stats ?? {};
  const cacheHits = (gs.memory_cache ?? 0) + (gs.db_cache ?? 0);
  const apiHits = (gs.yandex_api ?? 0) + (gs.nominatim ?? 0);
  const explicitCoords = (gs.explicit ?? 0) + (gs.yandex_url ?? 0);
  const hasGeoStats = cacheHits + apiHits + explicitCoords > 0;

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
            {result.deduped > 0 && ` (${result.deduped} дублик${result.deduped === 1 ? "ат" : result.deduped < 5 ? "ата" : "атов"} объединено до импорта)`}
            {(result.skipped_existing ?? 0) > 0 && `, пропущено ${result.skipped_existing} уже существующих`}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">

          {/* Summary counters */}
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

          {/* Geocoder source breakdown */}
          {hasGeoStats && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Источники координат
              </p>
              <div className="flex flex-wrap gap-2">
                {explicitCoords > 0 && (
                  <GeoStatsBadge label="из файла / Яндекс-ссылок" value={explicitCoords} icon={<MapPin className="w-3.5 h-3.5" />} color="green" />
                )}
                {cacheHits > 0 && (
                  <GeoStatsBadge label={`из кэша${gs.db_cache ? ` (DB: ${gs.db_cache})` : ""}`} value={cacheHits} icon={<Database className="w-3.5 h-3.5" />} color="blue" />
                )}
                {(gs.yandex_api ?? 0) > 0 && (
                  <GeoStatsBadge label="Яндекс Геокодер" value={gs.yandex_api!} icon={<Zap className="w-3.5 h-3.5" />} color="violet" />
                )}
                {(gs.nominatim ?? 0) > 0 && (
                  <GeoStatsBadge label="Nominatim (OSM)" value={gs.nominatim!} icon={<Globe className="w-3.5 h-3.5" />} color="amber" />
                )}
              </div>
              {cacheHits > 0 && apiHits === 0 && (
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-2 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Все адреса взяты из кэша — лимит геокодера не израсходован.
                </p>
              )}
              {cacheHits > 0 && apiHits > 0 && (
                <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {cacheHits} адресов взято из кэша, {apiHits} — через геокодер.
                </p>
              )}
            </div>
          )}

          {result.geocoded_not_found > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Точки без координат не попадут в маршрут. Отредактируйте их вручную, добавив адрес или ссылку Яндекс Карт.
            </p>
          )}

          {/* Likely duplicates section */}
          {hasDuplicates && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                Вероятные дубликаты — {trueDuplicates.length} шт.
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
                      Импортированные точки совпадают по названию с уже существующими в базе.
                      Проверьте список и выберите действие.
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
                        {trueDuplicates.map((dup, i) => (
                          <tr key={i} className={`border-t ${i % 2 === 0 ? "" : "bg-muted/20"}`}>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-foreground">{dup.name}</div>
                              {dup.address && (
                                <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={dup.address}>
                                  {dup.address}
                                </div>
                              )}
                              {dup.match_reason && REASON_LABEL[dup.match_reason] && (
                                <Badge variant="outline" className="mt-1 text-[10px] h-4 px-1 border-amber-400 text-amber-700 dark:text-amber-400">
                                  {REASON_LABEL[dup.match_reason]}
                                </Badge>
                              )}
                            </td>
                            <td className="px-3 py-2.5">
                              <div className="font-medium text-foreground">{dup.existing_name}</div>
                              {dup.existing_address && (
                                <div className="text-xs text-muted-foreground truncate max-w-[200px]" title={dup.existing_address}>
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
