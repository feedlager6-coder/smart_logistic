import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Settings, Save, Fuel, Gauge, Calculator, TrendingDown,
  Users, Key, Plus, Trash2, RotateCcw, Copy, Check, Eye, EyeOff,
} from "lucide-react";
import { useAuth } from "@/context/auth";
import { UsersPanel } from "@/components/UsersPanel";

interface CompanySettings {
  fuel_price: number;
  fuel_consumption: number;
  cost_per_km: number;
}

function calcCostPerKm(fuelPrice: number, consumption: number): number {
  return Math.round((fuelPrice * consumption) / 100 * 100) / 100;
}

type Tab = "fuel" | "users" | "apikeys";

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  scopes: string[];
  is_active: boolean;
  expires_at: string | null;
  last_used_at: string | null;
  created_at: string;
}

const SCOPE_LABELS: Record<string, string> = {
  "stores:read": "Магазины: чтение",
  "stores:write": "Магазины: запись",
  "orders:read": "Заявки: чтение",
  "orders:write": "Заявки: запись",
  "routes:build": "Маршруты: построение",
  "routes:read": "Маршруты: чтение",
  "routes:write": "Маршруты: удаление",
  "analytics:read": "Аналитика",
  "settings:read": "Настройки: чтение",
  "settings:write": "Настройки: запись",
  "webhooks:receive": "Webhook: приём заявок",
};

const ALL_SCOPES = Object.keys(SCOPE_LABELS);

function ApiKeysPanel() {
  const { toast } = useToast();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>(["orders:write", "webhooks:receive"]);
  const [showCreate, setShowCreate] = useState(false);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [revokeId, setRevokeId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [purgeRevokedConfirm, setPurgeRevokedConfirm] = useState(false);
  const [rotateId, setRotateId] = useState<number | null>(null);

  async function loadKeys() {
    try {
      const res = await fetch("/api/auth/api-keys", { credentials: "include" });
      if (res.ok) setKeys(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }

  useEffect(() => { loadKeys(); }, []);

  async function handleCreate() {
    if (!newKeyName.trim()) {
      toast({ title: "Укажите название ключа", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/auth/api-keys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim(), scopes: newKeyScopes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Ошибка");
      setNewlyCreatedKey(data.key);
      setShowCreate(false);
      setNewKeyName("");
      setNewKeyScopes(["orders:write", "webhooks:receive"]);
      await loadKeys();
    } catch (e: any) {
      toast({ title: "Не удалось создать ключ", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: number) {
    try {
      await fetch(`/api/auth/api-keys/${id}`, { method: "DELETE", credentials: "include" });
      setKeys(k => k.map(x => x.id === id ? { ...x, is_active: false } : x));
      toast({ title: "Ключ отозван" });
    } catch {
      toast({ title: "Не удалось отозвать ключ", variant: "destructive" });
    }
    setRevokeId(null);
  }

  async function handleDeleteKey(id: number) {
    try {
      const res = await fetch(`/api/auth/api-keys/${id}?permanent=true`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error();
      setKeys(k => k.filter(x => x.id !== id));
      toast({ title: "Ключ удалён" });
    } catch {
      toast({ title: "Не удалось удалить ключ", variant: "destructive" });
    }
    setDeleteId(null);
  }

  async function handlePurgeRevoked() {
    try {
      const res = await fetch("/api/auth/api-keys", { method: "DELETE", credentials: "include" });
      const data = await res.json();
      setKeys(k => k.filter(x => x.is_active));
      toast({ title: `Удалено отозванных ключей: ${data.deleted ?? 0}` });
    } catch {
      toast({ title: "Не удалось очистить отозванные ключи", variant: "destructive" });
    }
    setPurgeRevokedConfirm(false);
  }

  async function handleRotate(id: number) {
    try {
      const res = await fetch(`/api/auth/api-keys/${id}/rotate`, { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Ошибка");
      setNewlyCreatedKey(data.key);
      await loadKeys();
      toast({ title: "Ключ обновлён", description: "Новый ключ показан ниже. Обновите его в своих системах." });
    } catch (e: any) {
      toast({ title: "Не удалось обновить ключ", description: e.message, variant: "destructive" });
    }
    setRotateId(null);
  }

  function copyKey() {
    if (!newlyCreatedKey) return;
    navigator.clipboard.writeText(newlyCreatedKey).then(() => {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    });
  }

  function toggleScope(scope: string) {
    setNewKeyScopes(prev =>
      prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]
    );
  }

  function fmt(dt: string | null) {
    if (!dt) return "—";
    return new Date(dt).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" });
  }

  return (
    <div className="space-y-6">
      {/* Newly created key — show once */}
      {newlyCreatedKey && (
        <div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 p-5 space-y-3">
          <div className="flex items-center gap-2 font-semibold text-emerald-800 dark:text-emerald-300">
            <Key className="w-4 h-4" />
            Новый API-ключ — сохраните его сейчас
          </div>
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Ключ показывается только один раз. После закрытия этого блока восстановить его невозможно — только создать новый.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 font-mono text-sm bg-white dark:bg-black/30 border border-emerald-300 rounded-lg px-4 py-2.5 break-all select-all">
              {newlyCreatedKey}
            </code>
            <Button size="sm" variant="outline" onClick={copyKey} className="shrink-0 gap-1.5">
              {copiedKey ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              {copiedKey ? "Скопировано" : "Копировать"}
            </Button>
          </div>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => setNewlyCreatedKey(null)}>
            Закрыть
          </Button>
        </div>
      )}

      {/* Header + create button */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Используйте API-ключи для интеграции с 1С, МойСклад, Bitrix24 и другими системами через Webhook.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {keys.some(k => !k.is_active) && (
            <Button size="sm" variant="outline" onClick={() => setPurgeRevokedConfirm(true)} className="gap-2 text-destructive hover:text-destructive">
              <Trash2 className="w-4 h-4" />
              <span className="hidden sm:inline">Удалить отозванные</span>
            </Button>
          )}
          <Button size="sm" onClick={() => setShowCreate(v => !v)} className="gap-2">
            <Plus className="w-4 h-4" />
            Создать ключ
          </Button>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="pt-5 space-y-4">
            <div className="space-y-2">
              <Label>Название ключа</Label>
              <Input
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                placeholder="Например: МойСклад вебхук"
                onKeyDown={e => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Права доступа (scopes)</Label>
              <div className="flex flex-wrap gap-2">
                {ALL_SCOPES.map(scope => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => toggleScope(scope)}
                    className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                      newKeyScopes.includes(scope)
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-border hover:border-primary/50"
                    }`}
                  >
                    {SCOPE_LABELS[scope]}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button onClick={handleCreate} disabled={creating} size="sm" className="gap-2">
                {creating ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Key className="w-4 h-4" />
                )}
                Создать
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); setNewKeyName(""); }}>
                Отмена
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Keys list */}
      {loading ? (
        <div className="flex items-center justify-center h-24">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-border bg-muted/30 py-12 text-center space-y-2">
          <Key className="w-8 h-8 text-muted-foreground mx-auto" />
          <p className="text-sm font-medium">Нет API-ключей</p>
          <p className="text-xs text-muted-foreground">Создайте ключ для интеграции с внешними системами</p>
        </div>
      ) : (
        <div className="space-y-3">
          {keys.map(k => (
            <div key={k.id} className={`rounded-xl border p-4 space-y-3 ${!k.is_active ? "opacity-50 bg-muted/30" : "bg-background"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{k.name}</span>
                    {!k.is_active && <Badge variant="secondary" className="text-xs">Отозван</Badge>}
                  </div>
                  <code className="text-xs text-muted-foreground font-mono">{k.key_prefix}…</code>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {k.is_active ? (
                    <>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 gap-1.5 text-xs"
                        onClick={() => setRotateId(k.id)}
                        title="Обновить ключ"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Обновить</span>
                      </Button>
                      <Button
                        variant="ghost" size="sm"
                        className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                        onClick={() => setRevokeId(k.id)}
                        title="Отозвать ключ"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Отозвать</span>
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost" size="sm"
                      className="h-8 gap-1.5 text-xs text-destructive hover:text-destructive"
                      onClick={() => setDeleteId(k.id)}
                      title="Удалить ключ навсегда"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Удалить</span>
                    </Button>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(k.scopes || []).map(s => (
                  <Badge key={s} variant="outline" className="text-xs font-normal">
                    {SCOPE_LABELS[s] || s}
                  </Badge>
                ))}
                {(!k.scopes || k.scopes.length === 0) && (
                  <span className="text-xs text-muted-foreground">Без ограничений по правам</span>
                )}
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>Создан: {fmt(k.created_at)}</span>
                <span>Последнее использование: {fmt(k.last_used_at)}</span>
                {k.expires_at && <span>Истекает: {fmt(k.expires_at)}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Webhook usage example */}
      <Card className="border-border bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Пример: приём заявок через Webhook</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs text-muted-foreground">
          <p>Создайте ключ со scope <code className="bg-muted px-1 rounded">webhooks:receive</code>, затем отправляйте заявки POST-запросом:</p>
          <pre className="bg-muted rounded-lg p-3 overflow-x-auto text-xs font-mono whitespace-pre-wrap break-all">
{`POST /api/v1/webhooks/ingest/<ваш_ключ>
Content-Type: application/json

{
  "orders": [
    {
      "store_name": "Магазин Центральный",
      "address": "ул. Пушкина, 10",
      "delivery_date": "2026-07-01",
      "weight_kg": 120.5,
      "quantity": 48,
      "products": "Молоко×12, Хлеб×24"
    }
  ]
}`}
          </pre>
        </CardContent>
      </Card>

      {/* Revoke dialog */}
      <AlertDialog open={revokeId !== null} onOpenChange={o => !o && setRevokeId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Отозвать API-ключ?</AlertDialogTitle>
            <AlertDialogDescription>
              Все интеграции, использующие этот ключ, перестанут работать. Ключ останется в истории — его можно будет удалить насовсем позже.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => revokeId && handleRevoke(revokeId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Отозвать
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hard delete revoked key dialog */}
      <AlertDialog open={deleteId !== null} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить ключ навсегда?</AlertDialogTitle>
            <AlertDialogDescription>
              Запись об этом ключе будет удалена из базы данных полностью — без возможности восстановления.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && handleDeleteKey(deleteId)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить навсегда
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Purge all revoked dialog */}
      <AlertDialog open={purgeRevokedConfirm} onOpenChange={o => !o && setPurgeRevokedConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить все отозванные ключи?</AlertDialogTitle>
            <AlertDialogDescription>
              Все ключи со статусом «Отозван» будут удалены из базы данных навсегда. Активные ключи не затронуты.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handlePurgeRevoked} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Удалить отозванные
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rotate dialog */}
      <AlertDialog open={rotateId !== null} onOpenChange={o => !o && setRotateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Обновить API-ключ?</AlertDialogTitle>
            <AlertDialogDescription>
              Старый ключ будет отозван немедленно. Новый ключ будет показан один раз — обновите его во всех своих системах.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => rotateId && handleRotate(rotateId)}>
              Обновить ключ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function SettingsPage() {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("fuel");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fuelPrice, setFuelPrice] = useState<string>("67");
  const [consumption, setConsumption] = useState<string>("13");

  const fuelPriceNum = parseFloat(fuelPrice) || 0;
  const consumptionNum = parseFloat(consumption) || 0;
  const costPerKm = calcCostPerKm(fuelPriceNum, consumptionNum);

  useEffect(() => {
    fetch("/api/settings", { credentials: "include" })
      .then(r => r.json())
      .then((data: CompanySettings) => {
        setFuelPrice(String(data.fuel_price));
        setConsumption(String(data.fuel_consumption));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (fuelPriceNum <= 0 || consumptionNum <= 0) {
      toast({ title: "Ошибка", description: "Все поля должны быть заполнены положительными числами", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fuel_price: fuelPriceNum,
          fuel_consumption: consumptionNum,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).detail || "Ошибка сервера");
      }
      toast({ title: "Настройки сохранены", description: `Стоимость километра: ${costPerKm} ₽/км` });
    } catch (e: any) {
      toast({ title: "Не удалось сохранить", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const fuelComponent = fuelPriceNum > 0 && consumptionNum > 0
    ? Math.round(fuelPriceNum * consumptionNum / 100 * 100) / 100
    : 0;

  return (
    <div className="space-y-8 pb-10 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Settings className="w-5 h-5" />
          </div>
          Настройки компании
        </h1>
        <p className="text-muted-foreground mt-2">
          Параметры топлива, API-ключи и управление пользователями
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        <button
          onClick={() => setActiveTab("fuel")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "fuel"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Fuel className="w-4 h-4" />
          Топливо
        </button>
        <button
          onClick={() => setActiveTab("apikeys")}
          className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "apikeys"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Key className="w-4 h-4" />
          API-ключи
        </button>
        {isAdmin && (
          <button
            onClick={() => setActiveTab("users")}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === "users"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Users className="w-4 h-4" />
            Пользователи
          </button>
        )}
      </div>

      {/* Fuel tab */}
      {activeTab === "fuel" && (
        <div className="space-y-8">
          <Card className="border-border">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Fuel className="w-5 h-5 text-primary" />
                Параметры топлива
              </CardTitle>
              <CardDescription>
                Укажите актуальные данные вашего автопарка — система будет считать экономию точно
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="space-y-2">
                  <Label htmlFor="fuel_price" className="flex items-center gap-1.5">
                    <Fuel className="w-3.5 h-3.5 text-muted-foreground" />
                    Цена топлива, ₽/литр
                  </Label>
                  <Input
                    id="fuel_price"
                    type="number"
                    min="1"
                    step="0.5"
                    value={fuelPrice}
                    onChange={e => setFuelPrice(e.target.value)}
                    placeholder="67"
                    className="text-base"
                  />
                  <p className="text-xs text-muted-foreground">Дизель или бензин по вашей заправке</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="consumption" className="flex items-center gap-1.5">
                    <Gauge className="w-3.5 h-3.5 text-muted-foreground" />
                    Расход топлива, л/100 км
                  </Label>
                  <Input
                    id="consumption"
                    type="number"
                    min="1"
                    step="0.5"
                    value={consumption}
                    onChange={e => setConsumption(e.target.value)}
                    placeholder="13"
                    className="text-base"
                  />
                  <p className="text-xs text-muted-foreground">Для Газели — обычно 11–15 л/100 км</p>
                </div>
              </div>

              <Button onClick={handleSave} disabled={saving} className="gap-2 w-full sm:w-auto">
                <Save className="w-4 h-4" />
                {saving ? "Сохраняю…" : "Сохранить настройки"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border bg-muted/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Calculator className="w-4 h-4 text-primary" />
                Расчёт стоимости километра
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between py-2 border-b border-border">
                  <span className="text-muted-foreground font-mono">
                    {fuelPrice || "—"} ₽/л × {consumption || "—"} л / 100 км
                  </span>
                  <span className="font-semibold tabular-nums">
                    {fuelComponent > 0 ? `${fuelComponent} ₽/км` : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-lg font-bold text-foreground">Итого</span>
                  <span className="text-2xl font-extrabold text-primary tabular-nums">
                    {costPerKm > 0 ? `${costPerKm} ₽/км` : "—"}
                  </span>
                </div>
              </div>

              {costPerKm > 0 && (
                <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingDown className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Пример экономии</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-center">
                    {[
                      { km: 20, label: "−20 км" },
                      { km: 50, label: "−50 км" },
                      { km: 100, label: "−100 км" },
                    ].map(({ km, label }) => {
                      const saved = Math.round(km * 1.4 * costPerKm);
                      return (
                        <div key={km} className="bg-white dark:bg-card rounded-lg px-2 py-2 shadow-sm">
                          <div className="text-xs text-muted-foreground">{label}/день</div>
                          <div className="text-base font-bold text-emerald-600">{saved} ₽/день</div>
                          <div className="text-xs text-muted-foreground">{saved * 22} ₽/мес</div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Расчёт: сэкономленные км × 1.4 (коэф. дорог) × {costPerKm} ₽/км
                  </p>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                Формула: <span className="font-mono">стоимость км = цена топлива × расход / 100</span>.
                Новые настройки применяются к маршрутам, построенным <strong>после сохранения</strong>.
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* API Keys tab */}
      {activeTab === "apikeys" && (
        <div className="space-y-2">
          <div className="mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Key className="w-5 h-5 text-primary" />
              API-ключи
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Безопасный доступ для интеграций: 1С, МойСклад, Bitrix24, собственные скрипты
            </p>
          </div>
          <ApiKeysPanel />
        </div>
      )}

      {/* Users tab (admin only) */}
      {activeTab === "users" && isAdmin && (
        <UsersPanel />
      )}
    </div>
  );
}
