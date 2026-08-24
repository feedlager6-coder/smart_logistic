import { useState, useMemo } from "react";
import {
  useGetAnalyticsSummary,
  useGetAnalyticsDaily,
  useGetAnalyticsMonthly,
  useGetTopStores,
  useGetAnalyticsVehicleLoad,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  YAxisProps, XAxisProps,
} from "recharts";
import { TrendingDown, Route, MapPin, Loader2, DollarSign, Calendar, RotateCcw } from "lucide-react";

type Period = "30d" | "90d" | "6m" | "1y" | "custom";

function toISO(d: Date) {
  return d.toISOString().slice(0, 10);
}

function subtractDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return toISO(d);
}

function subtractMonths(months: number) {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return toISO(d);
}

const today = toISO(new Date());

export function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("30d");
  const [customFrom, setCustomFrom] = useState(subtractDays(30));
  const [customTo, setCustomTo] = useState(today);

  const { dateFrom, dateTo } = useMemo(() => {
    switch (period) {
      case "30d":  return { dateFrom: subtractDays(30),    dateTo: today };
      case "90d":  return { dateFrom: subtractDays(90),    dateTo: today };
      case "6m":   return { dateFrom: subtractMonths(6),   dateTo: today };
      case "1y":   return { dateFrom: subtractMonths(12),  dateTo: today };
      case "custom": return { dateFrom: customFrom, dateTo: customTo };
    }
  }, [period, customFrom, customTo]);

  const dateParams = { date_from: dateFrom, date_to: dateTo };

  const { data: summaryRaw, isLoading: isLoadingSummary } = useGetAnalyticsSummary();
  const { data: dailyRaw, isLoading: isLoadingDaily } = useGetAnalyticsDaily(dateParams);
  const { data: monthlyRaw, isLoading: isLoadingMonthly } = useGetAnalyticsMonthly(dateParams);
  const { data: topStoresRaw, isLoading: isLoadingTop } = useGetTopStores();
  const { data: vehicleLoadRaw, isLoading: isLoadingVehicleLoad } = useGetAnalyticsVehicleLoad(dateParams);

  const summary = summaryRaw && typeof summaryRaw === "object" && !Array.isArray(summaryRaw) ? summaryRaw : undefined;
  const daily = Array.isArray(dailyRaw) ? dailyRaw : [];
  const monthly = Array.isArray(monthlyRaw) ? monthlyRaw : [];
  const topStores = Array.isArray(topStoresRaw) ? topStoresRaw : [];
  const vehicleLoad = Array.isArray(vehicleLoadRaw) ? vehicleLoadRaw : [];

  const xAxisProps: XAxisProps = {
    stroke: "hsl(var(--muted-foreground))",
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    padding: { left: 10, right: 10 },
  };

  const yAxisProps: YAxisProps = {
    stroke: "hsl(var(--muted-foreground))",
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    tickFormatter: (v) => `${v}`,
  };

  const tooltipStyle = {
    contentStyle: {
      backgroundColor: "hsl(var(--card))",
      borderColor: "hsl(var(--border))",
      borderRadius: "8px",
    },
    itemStyle: { color: "hsl(var(--foreground))" },
  };

  const PERIOD_BUTTONS: { label: string; value: Period }[] = [
    { label: "30 дней", value: "30d" },
    { label: "90 дней", value: "90d" },
    { label: "6 мес.", value: "6m" },
    { label: "1 год",  value: "1y" },
    { label: "Период", value: "custom" },
  ];

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Аналитика</h1>
          <p className="text-muted-foreground">Ключевые показатели эффективности логистики</p>
        </div>

        {/* Period selector */}
        <div className="flex flex-col gap-2 items-start sm:items-end">
          <div className="flex items-center gap-1 flex-wrap">
            <Calendar className="w-4 h-4 text-muted-foreground mr-1" />
            {PERIOD_BUTTONS.map(btn => (
              <Button
                key={btn.value}
                variant={period === btn.value ? "default" : "outline"}
                size="sm"
                onClick={() => setPeriod(btn.value)}
                className="h-8 text-xs"
              >
                {btn.label}
              </Button>
            ))}
          </div>
          {period === "custom" && (
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">С</Label>
                <input
                  type="date"
                  value={customFrom}
                  max={customTo}
                  onChange={e => setCustomFrom(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <Label className="text-xs text-muted-foreground">По</Label>
                <input
                  type="date"
                  value={customTo}
                  min={customFrom}
                  max={today}
                  onChange={e => setCustomTo(e.target.value)}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm text-foreground"
                />
              </div>
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => {
                setCustomFrom(subtractDays(30));
                setCustomTo(today);
              }}>
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Построено маршрутов"
          value={summary?.total_routes}
          icon={<Route className="w-4 h-4" />}
          loading={isLoadingSummary}
        />
        <MetricCard
          title="Общий пробег (км)"
          value={summary?.total_km}
          icon={<MapPin className="w-4 h-4" />}
          loading={isLoadingSummary}
        />
        <MetricCard
          title="Сэкономлено км"
          value={summary?.saved_km}
          icon={<TrendingDown className="w-4 h-4" />}
          loading={isLoadingSummary}
          highlight
        />
        <MetricCard
          title="Экономия бюджета (₽)"
          value={summary?.saved_rub}
          icon={<DollarSign className="w-4 h-4" />}
          loading={isLoadingSummary}
          highlight
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily mileage */}
        <Card className="col-span-1 border-border">
          <CardHeader>
            <CardTitle>Пробег по дням</CardTitle>
            <CardDescription>Оптимизированный vs неоптимизированный</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoadingDaily ? (
              <LoadingChart />
            ) : daily.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" {...xAxisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip {...tooltipStyle} />
                  <Line type="monotone" dataKey="total_km" name="Пробег (км)" stroke="hsl(var(--primary))" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="saved_km" name="Сэкономлено (км)" stroke="hsl(150 60% 50%)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </CardContent>
        </Card>

        {/* Monthly savings */}
        <Card className="col-span-1 border-border">
          <CardHeader>
            <CardTitle>Экономия по месяцам (₽)</CardTitle>
            <CardDescription>Финансовая выгода от оптимизации</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoadingMonthly ? (
              <LoadingChart />
            ) : monthly.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" {...xAxisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip cursor={{ fill: "hsl(var(--muted))" }} {...tooltipStyle} />
                  <Bar dataKey="saved_rub" name="Экономия (₽)" fill="hsl(150 60% 50%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </CardContent>
        </Card>

        {/* Vehicle load histogram */}
        <Card className="col-span-1 border-border">
          <CardHeader>
            <CardTitle>Загрузка машин</CardTitle>
            <CardDescription>Среднее количество точек на машину в день</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoadingVehicleLoad ? (
              <LoadingChart />
            ) : vehicleLoad.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={vehicleLoad} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" {...xAxisProps} />
                  <YAxis {...yAxisProps} tickFormatter={(v) => `${v}`} />
                  <Tooltip
                    cursor={{ fill: "hsl(var(--muted))" }}
                    {...tooltipStyle}
                    formatter={(value: number) => [`${value} точек`, "Среднее на машину"]}
                  />
                  <Bar
                    dataKey="avg_points_per_vehicle"
                    name="Точек / машину"
                    fill="hsl(var(--primary))"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </CardContent>
        </Card>

        {/* Top stores */}
        <Card className="col-span-1 border-border">
          <CardHeader>
            <CardTitle>Топ-10 магазинов</CardTitle>
            <CardDescription>По частоте доставок за всё время</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoadingTop ? (
              <LoadingChart />
            ) : topStores.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topStores} layout="vertical" margin={{ top: 5, right: 20, left: 50, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" {...xAxisProps} />
                  <YAxis
                    dataKey="store_name"
                    type="category"
                    {...yAxisProps}
                    width={140}
                    tickFormatter={(val) => val.length > 18 ? val.substring(0, 18) + "…" : val}
                  />
                  <Tooltip cursor={{ fill: "hsl(var(--muted))" }} {...tooltipStyle} />
                  <Bar dataKey="visit_count" name="Визитов" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={18} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  title, value, icon, loading, highlight = false,
}: {
  title: string;
  value?: number;
  icon: React.ReactNode;
  loading: boolean;
  highlight?: boolean;
}) {
  return (
    <Card className="bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${highlight ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-primary/10 text-primary"}`}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${highlight ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
          {loading ? (
            <span className="animate-pulse bg-muted rounded w-24 h-8 inline-block" />
          ) : (
            (value ?? 0).toLocaleString("ru-RU")
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingChart() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="w-full h-full flex items-center justify-center text-muted-foreground text-sm">
      Нет данных за выбранный период
    </div>
  );
}
