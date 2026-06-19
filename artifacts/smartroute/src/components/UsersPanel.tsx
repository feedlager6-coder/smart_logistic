import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  UserPlus, Trash2, KeyRound, ShieldCheck, ShieldOff, UserCheck, UserX,
  RefreshCw, Pencil, Check, X, Search, ChevronUp, ChevronDown, ClipboardList,
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

interface AuditEntry {
  id: number;
  admin_username: string;
  target_username: string;
  action: string;
  details: string;
  created_at: string | null;
}

const PLANS = [
  { value: "trial",      label: "Trial",      color: "bg-slate-100 text-slate-700" },
  { value: "basic",      label: "Basic",      color: "bg-blue-100 text-blue-700" },
  { value: "pro",        label: "Pro",        color: "bg-violet-100 text-violet-700" },
  { value: "enterprise", label: "Enterprise", color: "bg-amber-100 text-amber-700" },
];

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  user_created:   { label: "Создан",           color: "bg-emerald-100 text-emerald-700" },
  user_deleted:   { label: "Удалён",           color: "bg-red-100 text-red-700" },
  password_changed: { label: "Пароль",         color: "bg-slate-100 text-slate-600" },
  admin_granted:  { label: "Стал Admin",       color: "bg-blue-100 text-blue-700" },
  admin_removed:  { label: "Снят Admin",       color: "bg-orange-100 text-orange-700" },
  user_blocked:   { label: "Заблокирован",     color: "bg-red-100 text-red-700" },
  user_unblocked: { label: "Разблокирован",    color: "bg-emerald-100 text-emerald-700" },
  plan_changed:   { label: "Тариф изменён",    color: "bg-violet-100 text-violet-700" },
  note_changed:   { label: "Заметка",          color: "bg-slate-100 text-slate-600" },
};

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

type SortField = "created_at" | "last_login_at" | "stores_count" | "sessions_count" | "username";
type SortDir = "asc" | "desc";

export function UsersPanel() {
  const { toast } = useToast();
  const [tab, setTab] = useState<"users" | "audit">("users");

  // ── Users state ─────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortField, setSortField] = useState<SortField>("created_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // ── Audit log state ─────────────────────────────────────────────────────────
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);

  // ── Dialogs ──────────────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newPlan, setNewPlan] = useState("trial");
  const [newNote, setNewNote] = useState("");
  const [creating, setCreating] = useState(false);

  const [resetUser, setResetUser] = useState<AdminUser | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  const [editNoteUser, setEditNoteUser] = useState<number | null>(null);
  const [editNoteValue, setEditNoteValue] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const [editPlanUser, setEditPlanUser] = useState<number | null>(null);
  const [editPlanValue, setEditPlanValue] = useState("trial");
  const [savingPlan, setSavingPlan] = useState(false);

  // ── Load data ─────────────────────────────────────────────────────────────────
  const loadUsers = useCallback(async () => {
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

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const res = await fetch("/api/admin/audit-log?limit=100", { credentials: "include" });
      if (!res.ok) throw new Error();
      setAudit(await res.json());
    } catch {
      toast({ title: "Ошибка", description: "Не удалось загрузить журнал", variant: "destructive" });
    } finally {
      setAuditLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { if (tab === "audit") loadAudit(); }, [tab, loadAudit]);

  // ── Filtered + sorted users ──────────────────────────────────────────────────
  const displayed = useMemo(() => {
    let result = [...users];
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(u => u.username.toLowerCase().includes(q));
    }
    if (filterPlan !== "all") result = result.filter(u => u.plan === filterPlan);
    if (filterStatus === "active") result = result.filter(u => u.is_active);
    if (filterStatus === "blocked") result = result.filter(u => !u.is_active);
    result.sort((a, b) => {
      let av: any = a[sortField as keyof AdminUser];
      let bv: any = b[sortField as keyof AdminUser];
      if (typeof av === "string") av = av.toLowerCase();
      if (typeof bv === "string") bv = bv.toLowerCase();
      if (av === null || av === undefined) av = "";
      if (bv === null || bv === undefined) bv = "";
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return result;
  }, [users, search, filterPlan, filterStatus, sortField, sortDir]);

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronDown className="w-3 h-3 opacity-30" />;
    return sortDir === "asc"
      ? <ChevronUp className="w-3 h-3 text-primary" />
      : <ChevronDown className="w-3 h-3 text-primary" />;
  }

  // ── API helpers ──────────────────────────────────────────────────────────────
  async function patch(userId: number, body: object): Promise<AdminUser> {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Ошибка");
    return data as AdminUser;
  }

  // ── Handlers ─────────────────────────────────────────────────────────────────
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
      toast({ title: "Пользователь создан", description: `${data.username} · ${planMeta(data.plan).label}` });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleActive(u: AdminUser) {
    try {
      const data = await patch(u.id, { is_active: !u.is_active });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, ...data } : x));
      toast({ title: u.is_active ? "Аккаунт заблокирован" : "Аккаунт активирован", description: u.username });
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    }
  }

  async function handleToggleAdmin(u: AdminUser) {
    try {
      const data = await patch(u.id, { is_admin: !u.is_admin });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, ...data } : x));
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
    if (deleteConfirmInput.trim() !== deleteUser.username) {
      toast({ title: "Ошибка", description: "Логин введён неверно", variant: "destructive" }); return;
    }
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/users/${deleteUser.id}`, { method: "DELETE", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((data as any).detail || "Ошибка удаления");
      setUsers(prev => prev.filter(x => x.id !== deleteUser.id));
      toast({ title: "Пользователь удалён", description: deleteUser.username });
      setDeleteUser(null); setDeleteConfirmInput("");
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
      setUsers(prev => prev.map(x => x.id === userId ? { ...x, admin_note: data.admin_note ?? editNoteValue } : x));
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
      setUsers(prev => prev.map(x => x.id === userId ? { ...x, plan: data.plan ?? editPlanValue } : x));
      setEditPlanUser(null);
    } catch (e: any) {
      toast({ title: "Ошибка", description: e.message, variant: "destructive" });
    } finally {
      setSavingPlan(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold">Пользователи системы</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Данные каждого пользователя изолированы — магазины, маршруты, настройки
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={tab === "users" ? loadUsers : loadAudit} title="Обновить">
            <RefreshCw className={`w-4 h-4 ${(loading || auditLoading) ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setCreateOpen(true)} className="gap-2">
            <UserPlus className="w-4 h-4" /> Новый пользователь
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
        <button
          onClick={() => setTab("users")}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors font-medium ${tab === "users" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Пользователи ({users.length})
        </button>
        <button
          onClick={() => setTab("audit")}
          className={`px-4 py-1.5 text-sm rounded-md transition-colors font-medium flex items-center gap-1.5 ${tab === "audit" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          <ClipboardList className="w-3.5 h-3.5" /> Журнал действий
        </button>
      </div>

      {/* ── USERS TAB ─────────────────────────────────────────────────────────── */}
      {tab === "users" && (
        <>
          {/* Filters row */}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Поиск по логину…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-8 h-9 w-48 text-sm"
              />
            </div>
            <select
              value={filterPlan}
              onChange={e => setFilterPlan(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-background h-9"
            >
              <option value="all">Все тарифы</option>
              {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-sm border border-border rounded-md px-3 py-1.5 bg-background h-9"
            >
              <option value="all">Все статусы</option>
              <option value="active">Активные</option>
              <option value="blocked">Заблокированные</option>
            </select>
            {(search || filterPlan !== "all" || filterStatus !== "all") && (
              <button
                onClick={() => { setSearch(""); setFilterPlan("all"); setFilterStatus("all"); }}
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <X className="w-3 h-3" /> Сбросить
              </button>
            )}
            {displayed.length !== users.length && (
              <span className="text-xs text-muted-foreground ml-auto">
                Показано {displayed.length} из {users.length}
              </span>
            )}
          </div>

          {/* Table */}
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              {users.length === 0 ? "Нет пользователей" : "Нет пользователей по выбранным фильтрам"}
            </div>
          ) : (
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">
                      <button onClick={() => toggleSort("username")} className="flex items-center gap-1 hover:text-foreground">
                        Логин / Статус <SortIcon field="username" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Тариф</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">
                      <button onClick={() => toggleSort("stores_count")} className="flex items-center gap-1 hover:text-foreground">
                        Данные <SortIcon field="stores_count" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden lg:table-cell">
                      <button onClick={() => toggleSort("last_login_at")} className="flex items-center gap-1 hover:text-foreground">
                        Последний вход <SortIcon field="last_login_at" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden xl:table-cell">
                      <button onClick={() => toggleSort("created_at")} className="flex items-center gap-1 hover:text-foreground">
                        Зарегистрирован <SortIcon field="created_at" />
                      </button>
                    </th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Заметка</th>
                    <th className="text-right px-4 py-2.5 font-medium text-muted-foreground">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayed.map(u => (
                    <tr key={u.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium">{u.username}</div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {u.is_admin && (
                            <Badge variant="secondary" className="text-xs px-1.5 py-0 h-4">Admin</Badge>
                          )}
                          <Badge className={`text-xs px-1.5 py-0 h-4 border-0 ${u.is_active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"}`}>
                            {u.is_active ? "Активен" : "Заблокирован"}
                          </Badge>
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        {editPlanUser === u.id ? (
                          <div className="flex items-center gap-1">
                            <select
                              value={editPlanValue}
                              onChange={e => setEditPlanValue(e.target.value)}
                              className="text-xs border border-border rounded px-1.5 py-1 bg-background"
                              autoFocus
                            >
                              {PLANS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
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
                            className={`text-xs font-medium px-2 py-0.5 rounded-full cursor-pointer hover:opacity-80 ${planMeta(u.plan).color}`}
                            title="Нажмите для изменения тарифа"
                          >
                            {planMeta(u.plan).label}
                          </button>
                        )}
                      </td>

                      <td className="px-4 py-3 hidden md:table-cell text-muted-foreground text-xs">
                        <div>{u.stores_count} маг.</div>
                        <div>{u.sessions_count} марш.</div>
                      </td>

                      <td className="px-4 py-3 hidden lg:table-cell text-muted-foreground text-xs whitespace-nowrap">
                        {formatDate(u.last_login_at)}
                      </td>

                      <td className="px-4 py-3 hidden xl:table-cell text-muted-foreground text-xs whitespace-nowrap">
                        {formatDate(u.created_at)}
                      </td>

                      <td className="px-4 py-3 max-w-[160px]">
                        {editNoteUser === u.id ? (
                          <div className="flex flex-col gap-1">
                            <Textarea
                              value={editNoteValue}
                              onChange={e => setEditNoteValue(e.target.value)}
                              rows={2}
                              className="text-xs min-h-0 resize-none"
                              autoFocus
                              placeholder="Заметка…"
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
                          >
                            <span className="flex-1 line-clamp-2">
                              {u.admin_note || <span className="italic opacity-40">Добавить…</span>}
                            </span>
                            <Pencil className="w-3 h-3 shrink-0 opacity-0 group-hover/note:opacity-50 mt-0.5" />
                          </button>
                        )}
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" title={u.is_active ? "Заблокировать" : "Разблокировать"} onClick={() => handleToggleActive(u)}>
                            {u.is_active ? <UserX className="w-3.5 h-3.5 text-amber-500" /> : <UserCheck className="w-3.5 h-3.5 text-emerald-500" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title={u.is_admin ? "Снять права Admin" : "Назначить Admin"} onClick={() => handleToggleAdmin(u)}>
                            {u.is_admin ? <ShieldOff className="w-3.5 h-3.5 text-muted-foreground" /> : <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />}
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Сменить пароль" onClick={() => { setResetUser(u); setResetPassword(""); }}>
                            <KeyRound className="w-3.5 h-3.5 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Удалить пользователя" onClick={() => { setDeleteUser(u); setDeleteConfirmInput(""); }}>
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
        </>
      )}

      {/* ── AUDIT LOG TAB ────────────────────────────────────────────────────────── */}
      {tab === "audit" && (
        <>
          {auditLoading ? (
            <div className="flex items-center justify-center h-32">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : audit.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">Журнал пуст</div>
          ) : (
            <div className="rounded-lg border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground whitespace-nowrap">Когда</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Кто (admin)</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Действие</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground">Кого (цель)</th>
                    <th className="text-left px-4 py-2.5 font-medium text-muted-foreground hidden md:table-cell">Детали</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {audit.map(e => {
                    const meta = ACTION_LABELS[e.action] ?? { label: e.action, color: "bg-slate-100 text-slate-600" };
                    return (
                      <tr key={e.id} className="hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(e.created_at)}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-sm">{e.admin_username}</td>
                        <td className="px-4 py-2.5">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${meta.color}`}>
                            {meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-sm">{e.target_username}</td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell">
                          {e.details || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-4 py-2 text-xs text-muted-foreground border-t border-border">
                Последние 100 действий
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Новый пользователь</DialogTitle>
            <DialogDescription>Данные будут полностью изолированы от других пользователей.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="nu">Логин</Label>
                <Input id="nu" value={newUsername} onChange={e => setNewUsername(e.target.value)} placeholder="ivanov" autoComplete="off" />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label htmlFor="np">Пароль</Label>
                <Input id="np" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Минимум 4 символа" autoComplete="new-password" />
              </div>
              <div className="space-y-1.5">
                <Label>Тариф</Label>
                <select value={newPlan} onChange={e => setNewPlan(e.target.value)} className="w-full text-sm border border-border rounded-md px-3 py-2 bg-background">
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
                <Label>Заметка (необязательно)</Label>
                <Input value={newNote} onChange={e => setNewNote(e.target.value)} placeholder='Например: "Пилотный клиент, оплачено до июля"' />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Отмена</Button>
            <Button onClick={handleCreate} disabled={creating}>{creating ? "Создаю…" : "Создать"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resetUser} onOpenChange={open => { if (!open) setResetUser(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Смена пароля</DialogTitle>
            <DialogDescription>Пользователь: <strong>{resetUser?.username}</strong></DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Новый пароль</Label>
              <Input type="password" value={resetPassword} onChange={e => setResetPassword(e.target.value)} placeholder="Минимум 4 символа" autoComplete="new-password" autoFocus />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetUser(null)}>Отмена</Button>
            <Button onClick={handleResetPassword} disabled={resetting}>{resetting ? "Сохраняю…" : "Сохранить"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteUser} onOpenChange={open => { if (!open) { setDeleteUser(null); setDeleteConfirmInput(""); } }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>Вы удаляете <strong>{deleteUser?.username}</strong>. Это <strong>необратимо</strong> — все данные будут стёрты.</p>
                <div className="rounded-lg bg-muted px-4 py-3 text-sm space-y-1">
                  <div>📦 Магазинов: <strong>{deleteUser?.stores_count}</strong></div>
                  <div>🗺️ Маршрутов: <strong>{deleteUser?.sessions_count}</strong></div>
                  <div>📅 Зарег.: <strong>{formatDate(deleteUser?.created_at ?? null)}</strong></div>
                  <div>🔒 Тариф: <strong>{planMeta(deleteUser?.plan ?? "trial").label}</strong></div>
                </div>
                <p className="text-sm font-medium">Введите логин для подтверждения:</p>
                <Input
                  value={deleteConfirmInput}
                  onChange={e => setDeleteConfirmInput(e.target.value)}
                  placeholder={deleteUser?.username}
                  autoFocus
                  autoComplete="off"
                />
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || deleteConfirmInput.trim() !== deleteUser?.username}
            >
              {deleting ? "Удаляю…" : "Удалить навсегда"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
