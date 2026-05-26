import { useGetAnalyticsSummary, useGetAnalyticsDaily, useGetAnalyticsMonthly, useGetTopStores } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, YAxisProps, XAxisProps } from "recharts";
import { TrendingDown, TrendingUp, Route, MapPin, Loader2, DollarSign } from "lucide-react";

export function AnalyticsPage() {
  const { data: summary, isLoading: isLoadingSummary } = useGetAnalyticsSummary();
  const { data: daily, isLoading: isLoadingDaily } = useGetAnalyticsDaily();
  const { data: monthly, isLoading: isLoadingMonthly } = useGetAnalyticsMonthly();
  const { data: topStores, isLoading: isLoadingTop } = useGetTopStores();

  const xAxisProps: XAxisProps = {
    stroke: "hsl(var(--muted-foreground))",
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    padding: { left: 10, right: 10 }
  };
  
  const yAxisProps: YAxisProps = {
    stroke: "hsl(var(--muted-foreground))",
    fontSize: 12,
    tickLine: false,
    axisLine: false,
    tickFormatter: (value) => `${value}`
  };

  return (
    <div className="space-y-8 pb-10">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Аналитика</h1>
        <p className="text-muted-foreground">Ключевые показатели эффективности логистики</p>
      </div>

      {/* Summary Cards */}
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
        {/* Daily Line Chart */}
        <Card className="col-span-1 border-border">
          <CardHeader>
            <CardTitle>Пробег (последние 30 дней)</CardTitle>
            <CardDescription>Сравнение реального пробега с неоптимизированным</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoadingDaily ? (
              <LoadingChart />
            ) : daily && daily.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={daily} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" {...xAxisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Line type="monotone" dataKey="total_km" name="Наш пробег (км)" stroke="hsl(var(--primary))" strokeWidth={3} dot={false} />
                  <Line type="monotone" dataKey="saved_km" name="Сэкономлено (км)" stroke="hsl(150 60% 50%)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </CardContent>
        </Card>

        {/* Monthly Bar Chart */}
        <Card className="col-span-1 border-border">
          <CardHeader>
            <CardTitle>Экономия по месяцам (₽)</CardTitle>
            <CardDescription>Финансовая выгода от оптимизации</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px]">
            {isLoadingMonthly ? (
              <LoadingChart />
            ) : monthly && monthly.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                  <XAxis dataKey="month" {...xAxisProps} />
                  <YAxis {...yAxisProps} />
                  <Tooltip 
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                  />
                  <Bar dataKey="saved_rub" name="Экономия (₽)" fill="hsl(150 60% 50%)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart />
            )}
          </CardContent>
        </Card>

        {/* Top Stores Bar Chart (Horizontal) */}
        <Card className="col-span-1 lg:col-span-2 border-border">
          <CardHeader>
            <CardTitle>Топ-10 магазинов по частоте доставок</CardTitle>
            <CardDescription>Самые популярные точки</CardDescription>
          </CardHeader>
          <CardContent className="h-[350px]">
            {isLoadingTop ? (
              <LoadingChart />
            ) : topStores && topStores.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topStores} layout="vertical" margin={{ top: 5, right: 20, left: 50, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                  <XAxis type="number" {...xAxisProps} />
                  <YAxis dataKey="store_name" type="category" {...yAxisProps} width={150} tickFormatter={(val) => val.length > 20 ? val.substring(0, 20) + '...' : val} />
                  <Tooltip 
                    cursor={{ fill: 'hsl(var(--muted))' }}
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                  />
                  <Bar dataKey="visit_count" name="Визитов" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} barSize={20} />
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

function MetricCard({ title, value, icon, loading, highlight = false }: { title: string, value?: number, icon: React.ReactNode, loading: boolean, highlight?: boolean }) {
  return (
    <Card className="bg-card">
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${highlight ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'bg-primary/10 text-primary'}`}>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className={`text-3xl font-bold ${highlight ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
          {loading ? (
            <span className="animate-pulse bg-muted rounded w-24 h-8 inline-block" />
          ) : (
            value?.toLocaleString('ru-RU') || "0"
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LoadingChart() {
  return <div className="w-full h-full flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-muted-foreground" /></div>;
}

function EmptyChart() {
  return <div className="w-full h-full flex items-center justify-center text-muted-foreground">Нет данных для отображения</div>;
}
