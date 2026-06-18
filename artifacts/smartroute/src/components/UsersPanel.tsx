import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { useToast } from "@/hooks/use-toast";
import {
  UserPlus,
  Trash2,
  KeyRound,
  ShieldCheck,
  ShieldOff,
  UserCheck,
  UserX,
  RefreshCw,
} from "lucide-react";

interface AdminUser {
  id: number;
  username: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string | null;
  last_login_at: string | null;
  stores_count: number;
  sessions_count: number;
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UsersPanel() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [creating, setCreating] = useState(false);

  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/users", { credentials: "include" });
      if (!res.ok) throw new Error("Ошибка загрузки");
      setUsers(await res.json());
    } catch {
      toast({ title: "Ошибка", description: "Не удалось загрузить пользователей", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!newUsername.trim()) {
      toast({ title: "Ошибка", description: "Введите логин", variant: "destructive" });
      return;
    }
    if (newPassword.length < 4) {
      toast({ title: "Ошибка", description: "Пароль — минимум 4 символа", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, is_admin: newIsAdmin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Ошибка создания");
      setUsers(prev => [data, ...prev]);
      setCreateOpen(false);
      setNewUsername("");
      setNewPassword("");
      setNewIsAdmin(false);
      toast({ title: "Пользователь создан", description: `Логин: ${data.username}` });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(u: AdminUser) {
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Ошибка");
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: data.is_active } : x));
      toast({ title: u.is_active ? "Аккаунт деактивирован" : "Аккаунт активирован", description: u.username });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  }

  async function handleToggleAdmin(u: AdminUser) {
    try {
      const res = await fetch(`/api/admin/users/${u.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_admin: !u.is_admin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Ошибка");
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_admin: data.is_admin } : x));
      toast({ title: u.is_admin ? "Права администратора сняты" : "Права администратора выданы", description: u.username });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  }

  async function handleResetPassword() {
    if (!resetUser) return;
    if (resetPassword.length < 4) {
      toast({ title: "Ошибка", description: "Пароль — минимум 4 символа", variant: "destructive" });
      return;
    }
    setResetting(true);
    try {
      const res = await fetch(`/api/admin/users/${resetUser.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Ошибка");
      setResetUser(null);
      setResetPassword("");
      toast({ title: "Пароль изменён", description: resetUser.username });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete() {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteUser.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).detail || "Ошибка удаления");
      }
      setUsers(prev => prev.filter(x => x.id !== deleteUser.id));
      toast({ title: "Пользователь удалён", description: deleteUser.username });
      setDeleteUser(null);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Пользователи системы</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Управление аккаунтами — каждый пользователь видит только свои магазины и маршруты
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <UserPlus className="w-4 h-4" />
            Новый пользователь
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Нет пользователей</div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Логин</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Статус</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Магазины / Маршруты</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Последний вход</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.username}</div>
                    <div className="flex gap-1.5 mt-1">
                      {u.is_admin && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">
                          Админ
                        </Badge>
                      )}
                      {!u.is_active && (
                        <Badge variant="destructive" className="text-xs px-1.5 py-0 h-4">
                          Заблокирован
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className={`inline-flex items-center gap-1 text-xs font-medium ${u.is_active ? "text-emerald-600" : "text-red-500"}`}>
                      {u.is_active ? "Активен" : "Деактивирован"}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                    {u.stores_count} / {u.sessions_count}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs">
                    {formatDate(u.last_login_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={u.is_active ? "Деактивировать" : "Активировать"}
                        onClick={() => handleToggleActive(u)}
                      >
                        {u.is_active ? <UserX className="w-3.5 h-3.5 text-amber-500" /> : <UserCheck className="w-3.5 h-3.5 text-emerald-500" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title={u.is_admin ? "Снять права администратора" : "Выдать права администратора"}
                        onClick={() => handleToggleAdmin(u)}
                      >
                        {u.is_admin ? <ShieldOff className="w-3.5 h-3.5 text-muted-foreground" /> : <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Сменить пароль"
                        onClick={() => { setResetUser(u); setResetPassword(""); }}
                      >
                        <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        title="Удалить пользователя"
                        onClick={() => setDeleteUser(u)}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый пользователь</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-username">Логин</Label>
              <Input
                id="new-username"
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
                placeholder="ivanov"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Пароль</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Минимум 4 символа"
                autoComplete="new-password"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={newIsAdmin}
                onChange={e => setNewIsAdmin(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm">Администратор</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Создаю…" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!resetUser} onOpenChange={open => { if (!open) setResetUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Смена пароля — {resetUser?.username}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">Новый пароль</Label>
              <Input
                id="reset-password"
                type="password"
                value={resetPassword}
                onChange={e => setResetPassword(e.target.value)}
                placeholder="Минимум 4 символа"
                autoComplete="new-password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetUser(null)}>Отмена</Button>
            <Button onClick={handleResetPassword} disabled={resetting}>
              {resetting ? "Сохраняю…" : "Сохранить пароль"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteUser} onOpenChange={open => { if (!open) setDeleteUser(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы удалите пользователя <strong>{deleteUser?.username}</strong>.
              Все его магазины ({deleteUser?.stores_count}) и маршруты ({deleteUser?.sessions_count}) будут безвозвратно удалены.
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Удаляю…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
