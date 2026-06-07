import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Settings, Save, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CompanySettings {
  fuel_price: number;
  fuel_consumption: number;
  driver_salary: number;
  cost_per_km: number;
}

function calcCostPerKm(fuelPrice: number, consumption: number, salary: number): number {
  const fuelComponent = (fuelPrice * consumption) / 100;
  const salaryComponent = salary / 22 / 200;
  return Math.round((fuelComponent + salaryComponent) * 100) / 100;
}

export function SettingsPage() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fuelPrice, setFuelPrice] = useState<string>("67");
  const [consumption, setConsumption] = useState<string>("13");
  const [salary, setSalary] = useState<string>("55000");

  const fuelPriceNum = parseFloat(fuelPrice) || 0;
  const consumptionNum = parseFloat(consumption) || 0;
  const salaryNum = parseFloat(salary) || 0;
  const fuelComponent = consumptionNum > 0 && fuelPriceNum > 0
    ? Math.round((fuelPriceNum * consumptionNum / 100) * 100) / 100
    : 0;
  const salaryComponent = salaryNum > 0
    ? Math.round((salaryNum / 22 / 200) * 100) / 100
    : 0;
  const costPerKm = calcCostPerKm(fuelPriceNum, consumptionNum, salaryNum);

  useEffect(() => {
    fetch("/api/settings", { credentials: "include" })
      .then(r => r.json())
      .then((data: CompanySettings) => {
        setFuelPrice(String(data.fuel_price));
        setConsumption(String(data.fuel_consumption));
        setSalary(String(data.driver_salary));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleSave() {
    if (fuelPriceNum <= 0 || consumptionNum <= 0 || salaryNum <= 0) {
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
          driver_salary: salaryNum,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Ошибка сервера");
      }
      toast({ title: "Настройки сохранены", description: `Стоимость км: ${costPerKm} ₽/км` });
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <Settings className="w-7 h-7" />
          Настройки компании
        </h1>
        <p className="text-muted-foreground mt-1">
          Параметры расчёта экономии — применяются при каждом построении маршрута
        </p>
      </div>

      <Card className="border-border">
        <CardHeader>
          <CardTitle>Стоимость одного километра</CardTitle>
          <CardDescription>
            Укажите реальные данные вашего автопарка — система будет считать экономию точно
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div className="space-y-2">
              <Label htmlFor="fuel_price">Цена топлива, ₽/литр</Label>
              <Input
                id="fuel_price"
                type="number"
                min="1"
                step="0.5"
                value={fuelPrice}
                onChange={e => setFuelPrice(e.target.value)}
                placeholder="67"
              />
              <p className="text-xs text-muted-foreground">Дизель или бензин по вашей заправке</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="consumption">Расход топлива, л/100 км</Label>
              <Input
                id="consumption"
                type="number"
                min="1"
                step="0.5"
                value={consumption}
                onChange={e => setConsumption(e.target.value)}
                placeholder="13"
              />
              <p className="text-xs text-muted-foreground">Для Газели — обычно 11–15 л/100 км</p>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="salary">Зарплата водителя, ₽/месяц</Label>
              <Input
                id="salary"
                type="number"
                min="1"
                step="1000"
                value={salary}
                onChange={e => setSalary(e.target.value)}
                placeholder="55000"
              />
              <p className="text-xs text-muted-foreground">Итоговая сумма включая налоги и страховые взносы</p>
            </div>
          </div>

          {/* Live calculation */}
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">Расчёт стоимости километра</p>
            <div className="space-y-1.5 text-sm text-muted-foreground font-mono">
              <div className="flex justify-between">
                <span>Топливо: {fuelPrice} ₽/л × {consumption} л / 100 км</span>
                <span className="text-foreground font-medium">{fuelComponent} ₽/км</span>
              </div>
              <div className="flex justify-between">
                <span>Водитель: {salary.replace(/\B(?=(\d{3})+(?!\d))/g, " ")} ₽ / 22 дн / 200 км</span>
                <span className="text-foreground font-medium">{salaryComponent} ₽/км</span>
              </div>
              <div className="flex justify-between border-t border-border pt-2 mt-2">
                <span className="font-semibold text-foreground">Итого:</span>
                <span className="text-primary font-bold text-base">{costPerKm} ₽/км</span>
              </div>
            </div>
          </div>

          <Alert className="border-blue-200 bg-blue-50">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 text-sm">
              Формула: <span className="font-mono">(цена × расход / 100) + (зарплата / 22 / 200)</span>. Учитываются только топливо и водитель. ТО, страховку и другие затраты добавьте к зарплате при необходимости. Новые настройки применяются к маршрутам, построенным <strong>после сохранения</strong>.
            </AlertDescription>
          </Alert>

          <Button onClick={handleSave} disabled={saving} className="gap-2 w-full sm:w-auto">
            <Save className="w-4 h-4" />
            {saving ? "Сохраняю…" : "Сохранить настройки"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
