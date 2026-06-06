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
import { ExternalLink, History, ChevronLeft, ChevronRight, Loader2, RefreshCw, Trash2 } from "lucide-react";
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

  const { data: raw, isLoading, refetch } = useListRouteSessions(
    { page, page_size: PAGE_SIZE },
    { query: { keepPreviousData: true } as any },
  );

  const sessions = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  const totalPages = sessions ? Math.ceil(sessions.total / PAGE_SIZE) : 1;

  const handleDeleteConfirm = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/route/sessions/${deleteId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Ошибка удаления");
      }
      toast({ title: "Маршрут удалён", description: `Сессия от ${deleteDate} удалена.` });
      queryClient.invalidateQueries({ queryKey: getListRouteSessionsQueryKey({ page, page_size: PAGE_SIZE }) });
      refetch();
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
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

      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Сессии маршрутизации</CardTitle>
          <CardDescription>
            {sessions ? `Всего: ${sessions.total} маршрутов` : "Загрузка данных..."}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && !sessions ? (
            <div className="flex justify-center items-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
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
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="pl-6">Дата</TableHead>
                    <TableHead className="text-center">Машин</TableHead>
                    <TableHead className="text-center">Точек</TableHead>
                    <TableHead className="text-right">Пробег</TableHead>
                    <TableHead className="text-right">Экономия км</TableHead>
                    <TableHead className="text-right">Выгода</TableHead>
                    <TableHead className="pr-6 text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions?.items.map((s) => (
                    <TableRow key={s.id} className="group">
                      <TableCell className="pl-6">
                        <div className="font-medium">{formatDate(s.date)}</div>
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
                          {s.saved_rub.toLocaleString("ru-RU")} ₽
                        </span>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="opacity-60 group-hover:opacity-100 transition-opacity"
                          >
                            <Link href={`/result/${s.id}`}>
                              <ExternalLink className="w-4 h-4 mr-1" />
                              Открыть
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
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
