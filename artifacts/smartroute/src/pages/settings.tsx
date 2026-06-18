import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Settings, Save, Fuel, Gauge, Calculator, TrendingDown, Users } from "lucide-react";
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

type Tab = "fuel" | "users";

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
          Параметры топлива и управление пользователями
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
          Параметры топлива
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

      {/* Users tab (admin only) */}
      {activeTab === "users" && isAdmin && (
        <UsersPanel />
      )}
    </div>
  );
}
