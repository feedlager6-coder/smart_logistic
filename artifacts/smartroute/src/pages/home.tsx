import { useGetAnalyticsSummary } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { 
  ArrowRight, 
  Map, 
  Clock, 
  TrendingDown, 
  Truck,
  Box,
  MapPin,
  CheckCircle2,
  BarChart3,
  FileSpreadsheet,
  Navigation,
  Users,
  Zap
} from "lucide-react";

export function HomePage() {
  const { data: summary, isLoading } = useGetAnalyticsSummary();

  return (
    <div className="space-y-10 pb-10">
      {/* Hero Section */}
      <section className="flex flex-col items-center justify-center text-center space-y-6 py-12 md:py-20 bg-card rounded-3xl border border-border overflow-hidden relative">
        <div className="absolute inset-0 bg-grid-slate-100/[0.04] bg-[length:32px_32px] dark:bg-grid-slate-800/[0.04]" />
        <div className="absolute inset-0 bg-gradient-to-t from-card to-transparent" />
        
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary relative z-10 mb-2">
          <Truck className="w-8 h-8" />
        </div>
        
        <div className="space-y-4 max-w-3xl relative z-10 px-4">
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight text-foreground">
            SmartRoute — автоматическая<br className="hidden md:inline" />
            <span className="text-primary"> маршрутизация доставки</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Загружайте заявки из Excel или 1С — система мгновенно распределит точки между водителями и отправит маршруты прямо в Яндекс Навигатор.
          </p>
        </div>

        <div className="relative z-10 pt-4 flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 w-full px-4 max-w-md sm:max-w-none">
          <Link href="/route" className="w-full sm:w-auto">
            <Button size="lg" className="w-full sm:w-auto h-12 px-6 sm:px-8 text-base shadow-lg shadow-primary/20 gap-2 font-semibold">
              <Map className="w-5 h-5" />
              Построить маршруты
            </Button>
          </Link>
          <Link href="/stores" className="w-full sm:w-auto">
            <Button size="lg" variant="outline" className="w-full sm:w-auto h-12 px-6 sm:px-8 text-base gap-2 font-semibold">
              <Box className="w-5 h-5" />
              База магазинов
            </Button>
          </Link>
        </div>
      </section>

      {/* Summary Metrics */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-primary" />
          <h2 className="text-2xl font-bold tracking-tight">Эффективность в цифрах</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Построено маршрутов</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-foreground">
                {isLoading ? <span className="animate-pulse bg-muted rounded w-20 h-8 inline-block" /> : (summary?.total_routes ?? 0).toLocaleString('ru-RU')}
              </div>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                За все время
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Сэкономлено км</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-primary">
                {isLoading ? <span className="animate-pulse bg-muted rounded w-24 h-8 inline-block" /> : `${(summary?.saved_km ?? 0).toLocaleString('ru-RU')} км`}
              </div>
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                <TrendingDown className="w-4 h-4 text-primary" />
                Оптимизация пробега
              </p>
            </CardContent>
          </Card>
          
          <Card className="bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Экономия (руб)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-emerald-600 dark:text-emerald-500">
                {isLoading ? <span className="animate-pulse bg-muted rounded w-32 h-8 inline-block" /> : `${(summary?.saved_rub ?? 0).toLocaleString('ru-RU')} ₽`}
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Общая выгода
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Features */}
      <section className="space-y-4">
        <h2 className="text-2xl font-bold tracking-tight">Как это работает</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="p-6 bg-card border border-border rounded-2xl space-y-4">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
              <FileSpreadsheet className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold">Импорт Excel и 1С</h3>
            <p className="text-muted-foreground leading-relaxed">
              Загружайте выгрузку из любой системы — SmartRoute автоматически определит колонки и дедуплицирует заявки. Поддержка форматов 1С, Excel и ссылок Яндекс.Карт.
            </p>
          </div>

          <div className="p-6 bg-card border border-border rounded-2xl space-y-4">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
              <Users className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold">Автораспределение по водителям</h3>
            <p className="text-muted-foreground leading-relaxed">
              Поддержка от 1 до 50 машин. Алгоритм OR-Tools автоматически распределяет точки с учётом временных окон, нагрузки и географии района.
            </p>
          </div>

          <div className="p-6 bg-card border border-border rounded-2xl space-y-4">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
              <Navigation className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold">Яндекс Навигатор + WhatsApp</h3>
            <p className="text-muted-foreground leading-relaxed">
              Готовый маршрут открывается в Яндекс Навигаторе одним нажатием. Отправка водителю через WhatsApp — без ввода адресов вручную.
            </p>
          </div>

          <div className="p-6 bg-card border border-border rounded-2xl space-y-4">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
              <Zap className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold">Быстрый расчёт</h3>
            <p className="text-muted-foreground leading-relaxed">
              Маршруты для 100 точек и 9 машин строятся за 20–30 секунд. Реальные дороги через OSRM, умная пост-оптимизация сокращает пробег на 15–40%.
            </p>
          </div>

          <div className="p-6 bg-card border border-border rounded-2xl space-y-4">
            <div className="w-12 h-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center">
              <Clock className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold">Временные окна</h3>
            <p className="text-muted-foreground leading-relaxed">
              Учёт времени работы магазинов и времени на разгрузку. Ориентировочное время прибытия в каждую точку рассчитывается автоматически.
            </p>
          </div>

          <div className="p-6 bg-card border border-border rounded-2xl space-y-4">
            <div className="w-12 h-12 bg-emerald-500/10 text-emerald-600 rounded-xl flex items-center justify-center">
              <TrendingDown className="w-6 h-6" />
            </div>
            <h3 className="text-xl font-semibold">До 30% экономии топлива</h3>
            <p className="text-muted-foreground leading-relaxed">
              Оптимизация маршрутов минимизирует холостой пробег. Встроенная аналитика показывает сэкономленные километры и рубли за любой период.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
