import { useState } from "react";
import { Link } from "wouter";
import { useListRouteSessions, getListRouteSessionsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ExternalLink, History, ChevronLeft, ChevronRight, Loader2, RefreshCw, Trash2, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const PAGE_SIZE = 20;

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  } catch { return dateStr; }
}

function formatTime(ts: string | null | undefined) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

export function HistoryPage() {
  const [page, setPage] = useState(1);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteDate, setDeleteDate] = useState<string>("");
  const [deleting, setDeleting] = useState(false);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: sessions, isLoading, isError, refetch } = useListRouteSessions(
    { page, page_size: PAGE_SIZE },
    { query: { staleTime: 30_000 } as any },
  );

  const totalPages = sessions ? Math.ceil(sessions.total / PAGE_SIZE) : 1;

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/route/sessions/${deleteId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).detail || "Ошибка удаления");
      }
      toast({ title: "Маршрут удалён", description: `Сессия от ${deleteDate} удалена.` });
      queryClient.invalidateQueries({ queryKey: getListRouteSessionsQueryKey({ page, page_size: PAGE_SIZE }) });
      refetch();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Неизвестная ошибка";
      toast({ title: "Ошибка", description: msg, variant: "destructive" });
    } finally {
      setDeleting(false);
      setDeleteId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
            <History className="w-7 h-7 text-primary" />
            История маршрутов
          </h1>
          <p className="text-muted-foreground">Все построенные маршруты с результатами оптимизации</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Обновить
        </Button>
      </div>

      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between">
            <span>Не удалось загрузить историю маршрутов. Проверьте соединение.</span>
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-4 shrink-0">
              Повторить
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Сессии маршрутизации</CardTitle>
          <CardDescription>
            {isLoading
              ? "Загружаем данные…"
              : isError
                ? "Ошибка загрузки"
                : sessions
                  ? `Всего: ${sessions.total} маршрутов`
                  : "Нет данных"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : isError ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <AlertCircle className="w-12 h-12 opacity-25" />
              <p className="text-lg font-medium">Не удалось загрузить данные</p>
              <Button variant="outline" onClick={() => refetch()}>Попробовать снова</Button>
            </div>
          ) : sessions?.items.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <History className="w-12 h-12 opacity-25" />
              <p className="text-lg font-medium">История пуста</p>
              <p className="text-sm text-center max-w-xs">
                Постройте первый маршрут — он появится здесь вместе с результатами оптимизации
              </p>
              <Button asChild className="mt-2">
                <Link href="/route">Построить маршрут</Link>
              </Button>
            </div>
          ) : (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-6">Дата</TableHead>
                      <TableHead className="text-center">Машин</TableHead>
                      <TableHead className="text-center">Точек</TableHead>
                      <TableHead className="text-right">Пробег</TableHead>
                      <TableHead className="text-right">Экономия км</TableHead>
                      <TableHead className="text-right">Выгода</TableHead>
                      <TableHead className="pr-6 text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sessions?.items.map((s) => (
                      <TableRow key={s.id} className="group">
                        <TableCell className="pl-6">
                          <div className="font-semibold text-foreground">{formatDate(s.date)}</div>
                          <div className="text-xs text-muted-foreground">{formatTime(s.created_at)}</div>
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="secondary">{s.num_vehicles}</Badge>
                        </TableCell>
                        <TableCell className="text-center font-medium">{s.num_points}</TableCell>
                        <TableCell className="text-right font-mono text-sm">{s.total_km} км</TableCell>
                        <TableCell className="text-right">
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            −{s.saved_km} км
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            {Number(s.saved_rub).toLocaleString("ru-RU")} ₽
                          </span>
                        </TableCell>
                        <TableCell className="pr-6 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              asChild
                              className="h-8 px-3 text-xs font-medium"
                            >
                              <Link href={`/result/${s.id}`}>
                                <ExternalLink className="w-3.5 h-3.5 mr-1" />
                                Открыть
                              </Link>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Удалить маршрут"
                              onClick={() => {
                                setDeleteId(s.id);
                                setDeleteDate(formatDate(s.date));
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card List View */}
              <div className="block md:hidden divide-y divide-border">
                {sessions?.items.map((s) => (
                  <div key={s.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-base text-foreground">{formatDate(s.date)}</div>
                        <div className="text-xs text-muted-foreground">{formatTime(s.created_at)}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="text-xs font-medium">
                          {s.num_vehicles} {s.num_vehicles === 1 ? "машина" : s.num_vehicles < 5 ? "машины" : "машин"}
                        </Badge>
                        <Badge variant="secondary" className="text-xs font-medium">
                          {s.num_points} {s.num_points === 1 ? "точка" : s.num_points < 5 ? "точки" : "точек"}
                        </Badge>
                      </div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 bg-muted/40 p-2.5 rounded-lg text-xs">
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Пробег</span>
                        <span className="font-bold text-foreground">{s.total_km} км</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Экономия</span>
                        <span className="font-bold text-emerald-600">−{s.saved_km} км</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[11px]">Выгода</span>
                        <span className="font-bold text-emerald-600">{Number(s.saved_rub).toLocaleString("ru-RU")} ₽</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        className="flex-1 h-10 font-semibold gap-1.5"
                        asChild
                      >
                        <Link href={`/result/${s.id}`}>
                          <ExternalLink className="w-4 h-4" />
                          Открыть маршрут
                        </Link>
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-10 px-3 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive gap-1.5"
                        onClick={() => {
                          setDeleteId(s.id);
                          setDeleteDate(formatDate(s.date));
                        }}
                      >
                        <Trash2 className="w-4 h-4" />
                        <span>Удалить</span>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {sessions && sessions.total > PAGE_SIZE && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <p className="text-sm text-muted-foreground">
                Страница {page} из {totalPages} · {sessions.total} маршрутов
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page <= 1 || isLoading}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages || isLoading}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation dialog */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить маршрут?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы действительно хотите удалить маршрут от <strong>{deleteDate}</strong>?
              Это действие необратимо — данные маршрута будут удалены навсегда.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
