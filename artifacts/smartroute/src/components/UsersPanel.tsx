import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  UserPlus, Trash2, KeyRound, ShieldCheck, ShieldOff,
  UserCheck, UserX, RefreshCw, Pencil, Check, X,
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
  plan: string;
  admin_note: string;
}

const PLANS = [
  { value: "trial", label: "Trial", color: "bg-slate-100 text-slate-700" },
  { value: "basic", label: "Basic", color: "bg-blue-100 text-blue-700" },
  { value: "pro", label: "Pro", color: "bg-violet-100 text-violet-700" },
  { value: "enterprise", label: "Enterprise", color: "bg-amber-100 text-amber-700" },
];

function planMeta(plan: string) {
  return PLANS.find(p => p.value === plan) ?? PLANS[0];
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function UsersPanel() {
  const { toast } = useToast();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);

  // Create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newPlan, setNewPlan] = useState("trial");
  const [newNote, setNewNote] = useState("");
  const [creating, setCreating] = useState(false);

  // Reset password dialog
  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  // Delete dialog — username confirmation
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleteConfirmUsername, setDeleteConfirmUsername] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Inline note edit
  const [editNoteUser, setEditNoteUser] = useState<number | null>(null);
  const [editNoteValue, setEditNoteValue] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  // Inline plan edit
  const [editPlanUser, setEditPlanUser] = useState<number | null>(null);
  const [editPlanValue, setEditPlanValue] = useState("trial");
  const [savingPlan, setSavingPlan] = useState(false);

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

  async function patch(userId: number, body: object): Promise<AdminUser | null> {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Ошибка");
    return data as AdminUser;
  }

  async function handleCreate() {
    if (!newUsername.trim()) { toast({ title: "Ошибка", description: "Введите логин", variant: "destructive" }); return; }
    if (newPassword.length < 4) { toast({ title: "Ошибка", description: "Пароль — минимум 4 символа", variant: "destructive" }); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: newUsername.trim(), password: newPassword, is_admin: newIsAdmin, plan: newPlan, admin_note: newNote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Ошибка создания");
      setUsers(prev => [data, ...prev]);
      setCreateOpen(false);
      setNewUsername(""); setNewPassword(""); setNewIsAdmin(false); setNewPlan("trial"); setNewNote("");
      toast({ title: "Пользователь создан", description: `Логин: ${data.username} · Тариф: ${data.plan}` });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(u: AdminUser) {
    try {
      const data = await patch(u.id, { is_active: !u.is_active });
      if (data) setUsers(prev => prev.map(x => x.id === u.id ? { ...x, ...data } : x));
      toast({ title: u.is_active ? "Аккаунт деактивирован" : "Аккаунт активирован", description: u.username });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  }

  async function handleToggleAdmin(u: AdminUser) {
    try {
      const data = await patch(u.id, { is_admin: !u.is_admin });
      if (data) setUsers(prev => prev.map(x => x.id === u.id ? { ...x, ...data } : x));
      toast({ title: u.is_admin ? "Права администратора сняты" : "Права администратора выданы", description: u.username });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  }

  async function handleResetPassword() {
    if (!resetUser) return;
    if (resetPassword.length < 4) { toast({ title: "Ошибка", description: "Пароль — минимум 4 символа", variant: "destructive" }); return; }
    setResetting(true);
    try {
      await patch(resetUser.id, { password: resetPassword });
      setResetUser(null); setResetPassword("");
      toast({ title: "Пароль изменён", description: resetUser.username });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setResetting(false);
    }
  }

  async function handleDelete() {
    if (!deleteUser) return;
    if (deleteConfirmUsername.trim() !== deleteUser.username) {
      toast({ title: "Ошибка", description: "Логин введён неверно", variant: "destructive" }); return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteUser.id}`, { method: "DELETE", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).detail || "Ошибка удаления");
      setUsers(prev => prev.filter(x => x.id !== deleteUser.id));
      toast({ title: "Пользователь удалён", description: deleteUser.username });
      setDeleteUser(null); setDeleteConfirmUsername("");
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveNote(userId: number) {
    setSavingNote(true);
    try {
      const data = await patch(userId, { admin_note: editNoteValue });
      if (data) setUsers(prev => prev.map(x => x.id === userId ? { ...x, admin_note: data.admin_note ?? editNoteValue } : x));
      setEditNoteUser(null);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setSavingNote(false);
    }
  }

  async function handleSavePlan(userId: number) {
    setSavingPlan(true);
    try {
      const data = await patch(userId, { plan: editPlanValue });
      if (data) setUsers(prev => prev.map(x => x.id === userId ? { ...x, plan: data.plan ?? editPlanValue } : x));
      setEditPlanUser(null);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setSavingPlan(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Пользователи системы</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Каждый пользователь видит только свои магазины и маршруты
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={load} disabled={loading} title="Обновить">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <UserPlus className="w-4 h-4" />
            Новый пользователь
          </Button>
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">Нет пользователей</div>
      ) : (
        <div className="rounded-lg border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Логин / Статус</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Тариф</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Данные</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Последний вход</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden lg:table-cell">Зарегистрирован</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Заметка</th>
                <th className="text-right px-4 py-3 font-medium text-muted-foreground">Действия</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-muted/20 transition-colors group">
                  {/* Login / status */}
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.username}</div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {u.is_admin && (
                        <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">Админ</Badge>
                      )}
                      <Badge
                        className={`text-xs px-1.5 py-0 h-4 border-0 ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}
                      >
                        {u.is_active ? "Активен" : "Заблокирован"}
                      </Badge>
                    </div>
                  </td>

                  {/* Plan */}
                  <td className="px-4 py-3">
                    {editPlanUser === u.id ? (
                      <div className="flex items-center gap-1">
                        <select
                          value={editPlanValue}
                          onChange={e => setEditPlanValue(e.target.value)}
                          className="text-xs border border-border rounded px-1.5 py-1 bg-background"
                          autoFocus
                        >
                          {PLANS.map(p => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleSavePlan(u.id)} disabled={savingPlan}>
                          <Check className="w-3 h-3 text-emerald-600" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditPlanUser(null)}>
                          <X className="w-3 h-3 text-muted-foreground" />
                        </Button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditPlanUser(u.id); setEditPlanValue(u.plan || "trial"); }}
                        className={`text-xs font-medium px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 transition-opacity ${planMeta(u.plan).color}`}
                        title="Нажмите для изменения тарифа"
                      >
                        {planMeta(u.plan).label}
                      </button>
                    )}
                  </td>

                  {/* Stores / sessions */}
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                    <div>{u.stores_count} магазинов</div>
                    <div>{u.sessions_count} маршрутов</div>
                  </td>

                  {/* Last login */}
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs whitespace-nowrap">
                    {formatDate(u.last_login_at)}
                  </td>

                  {/* Created at */}
                  <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs whitespace-nowrap">
                    {formatDate(u.created_at)}
                  </td>

                  {/* Admin note */}
                  <td className="px-4 py-3 max-w-[180px]">
                    {editNoteUser === u.id ? (
                      <div className="flex flex-col gap-1">
                        <Textarea
                          value={editNoteValue}
                          onChange={e => setEditNoteValue(e.target.value)}
                          rows={2}
                          className="text-xs min-h-0 resize-none"
                          autoFocus
                          placeholder="Заметка администратора…"
                        />
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleSaveNote(u.id)} disabled={savingNote}>
                            <Check className="w-3 h-3 text-emerald-600" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditNoteUser(null)}>
                            <X className="w-3 h-3 text-muted-foreground" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditNoteUser(u.id); setEditNoteValue(u.admin_note || ""); }}
                        className="text-left w-full text-xs text-muted-foreground hover:text-foreground transition-colors group/note flex items-start gap-1"
                        title="Нажмите для редактирования заметки"
                      >
                        <span className="flex-1 line-clamp-2">
                          {u.admin_note ? u.admin_note : <span className="italic opacity-50">Добавить заметку…</span>}
                        </span>
                        <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover/note:opacity-50 mt-0.5" />
                      </button>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title={u.is_active ? "Деактивировать аккаунт" : "Активировать аккаунт"}
                        onClick={() => handleToggleActive(u)}
                      >
                        {u.is_active
                          ? <UserX className="w-3.5 h-3.5 text-amber-500" />
                          : <UserCheck className="w-3.5 h-3.5 text-emerald-500" />}
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title={u.is_admin ? "Снять права администратора" : "Назначить администратором"}
                        onClick={() => handleToggleAdmin(u)}
                      >
                        {u.is_admin
                          ? <ShieldOff className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />}
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="Сменить пароль"
                        onClick={() => { setResetUser(u); setResetPassword(""); }}
                      >
                        <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title="Удалить пользователя"
                        onClick={() => { setDeleteUser(u); setDeleteConfirmUsername(""); }}
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

      {/* ── Create dialog ──────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый пользователь</DialogTitle>
            <DialogDescription>Создайте аккаунт для клиента. Данные изолированы — он увидит только свои магазины и маршруты.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="new-username">Логин</Label>
                <Input id="new-username" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="ivanov" autoComplete="off" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="new-password">Пароль</Label>
                <Input id="new-password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Минимум 4 символа" autoComplete="new-password" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-plan">Тариф</Label>
                <select
                  id="new-plan"
                  value={newPlan}
                  onChange={e => setNewPlan(e.target.value)}
                  className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background"
                >
                  {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div className="space-y-1.5 flex items-end pb-0.5">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input type="checkbox" checked={newIsAdmin} onChange={e => setNewIsAdmin(e.target.checked)} className="w-4 h-4 rounded" />
                  <span className="text-sm">Администратор</span>
                </label>
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="new-note">Заметка (необязательно)</Label>
                <Input id="new-note" value={newNote} onChange={e => setNewNote(e.target.value)} placeholder='Например: "Пилотный клиент, оплачено до июля"' />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={handleCreate} disabled={creating}>{creating ? "Создаю…" : "Создать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset password dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!resetUser} onOpenChange={open => { if (!open) setResetUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Смена пароля</DialogTitle>
            <DialogDescription>Пользователь: <strong>{resetUser?.username}</strong></DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="reset-password">Новый пароль</Label>
              <Input id="reset-password" type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="Минимум 4 символа" autoComplete="new-password" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetUser(null)}>Отмена</Button>
            <Button onClick={handleResetPassword} disabled={resetting}>{resetting ? "Сохраняю…" : "Сохранить пароль"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete dialog with username confirmation ──────────────────────────── */}
      <AlertDialog open={!!deleteUser} onOpenChange={open => { if (!open) { setDeleteUser(null); setDeleteConfirmUsername(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Вы удаляете <strong>{deleteUser?.username}</strong>. Это необратимо.
                </p>
                <div className="rounded-lg bg-muted px-4 py-3 text-sm space-y-1">
                  <div>📦 Магазинов: <strong>{deleteUser?.stores_count}</strong></div>
                  <div>🗺️ Маршрутов: <strong>{deleteUser?.sessions_count}</strong></div>
                  <div>📅 Зарегистрирован: <strong>{formatDate(deleteUser?.created_at ?? null)}</strong></div>
                  <div>🔒 Тариф: <strong>{planMeta(deleteUser?.plan ?? "trial").label}</strong></div>
                </div>
                <p className="text-sm font-medium">Для подтверждения введите логин пользователя:</p>
                <Input
                  value={deleteConfirmUsername}
                  onChange={e => setDeleteConfirmUsername(e.target.value)}
                  placeholder={deleteUser?.username}
                  autoComplete="off"
                  autoFocus
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteConfirmUsername.trim() !== deleteUser?.username}
            >
              {deleting ? "Удаляю…" : "Удалить навсегда"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
