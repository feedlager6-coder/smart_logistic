import { useEffect, useState, Fragment } from "react";
import { Link, useLocation, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { MapPin, Navigation, Share2, Download, RefreshCw, Car, Clock, Copy, Check } from "lucide-react";
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from "react-leaflet";
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { useGetRouteSession } from "@workspace/api-client-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";

// Fix leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

import type { RouteResult } from "@workspace/api-client-react";

const COLORS = ["#0ea5e9", "#f43f5e", "#8b5cf6", "#10b981", "#f59e0b", "#6366f1", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];

// Auto-fits map to all route points
function FitBoundsToRoutes({ routes }: { routes: RouteResult["routes"] }) {
  const map = useMap();
  useEffect(() => {
    const pts: [number, number][] = [];
    routes.forEach(route =>
      route.stores.forEach(stop => {
        if (stop.lat && stop.lon) pts.push([stop.lat, stop.lon]);
      })
    );
    if (pts.length > 0) {
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 14 });
    }
  }, [map, routes]);
  return null;
}

export function ResultPage() {
  const [, setLocation] = useLocation();
  const params = useParams<{ id?: string }>();
  const sessionId = params?.id ? parseInt(params.id) : null;
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [copiedNav, setCopiedNav] = useState<number | null>(null);
  const [localResult, setLocalResult] = useState<RouteResult | null>(null);
  const [activeVehicleIndex, setActiveVehicleIndex] = useState(0);

  const { data: serverResult, isLoading: sessionLoading } = useGetRouteSession(
    sessionId ?? 0,
    { query: { enabled: !!sessionId } as any }
  );

  // Fallback: load from localStorage (legacy, no session_id in URL)
  useEffect(() => {
    if (!sessionId) {
      const data = localStorage.getItem("smartroute_result");
      if (data) {
        try {
          setLocalResult(JSON.parse(data));
        } catch (e) {
          console.error("Failed to parse route result");
          setLocation("/route");
        }
      } else {
        setLocation("/route");
      }
    }
  }, [sessionId, setLocation]);

  const result = (sessionId ? serverResult : localResult) as RouteResult | null | undefined;

  const handleCopyLink = () => {
    if (!sessionId) return;
    const url = `${window.location.origin}${window.location.pathname}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      toast({ title: "Ссылка скопирована", description: "Поделитесь ею с водителем." });
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyNav = (url: string, index: number) => {
    if (!url) return;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedNav(index);
      toast({ title: "Ссылка Яндекс Навигатора скопирована", description: "Отправьте водителю для открытия маршрута." });
      setTimeout(() => setCopiedNav(null), 2000);
    });
  };

  if (sessionId && sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground">Загружаю маршрут...</p>
        </div>
      </div>
    );
  }

  if (!result) return null;

  // ── Driver Mode (mobile) ─────────────────────────────────────────────────
  if (isMobile) {
    const activeRoute = result.routes[activeVehicleIndex];
    return (
      <div className="min-h-screen bg-background flex flex-col">
        {/* Header */}
        <div className="bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs opacity-80">Режим водителя</p>
            <h1 className="font-bold text-lg leading-tight">
              {activeRoute?.vehicle_name ?? "Маршрут"}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-xs opacity-80">Пробег</p>
            <p className="font-bold">{Math.round(activeRoute?.total_km ?? 0)} км</p>
          </div>
        </div>

        {/* Vehicle switcher */}
        {result.routes.length > 1 && (
          <div className="flex gap-2 px-4 py-2 overflow-x-auto bg-muted/30 border-b">
            {result.routes.map((r, i) => (
              <button
                key={r.vehicle_name}
                onClick={() => setActiveVehicleIndex(i)}
                className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  i === activeVehicleIndex
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground"
                }`}
              >
                {r.vehicle_name}
              </button>
            ))}
          </div>
        )}

        {/* Stop list */}
        <div className="flex-1 overflow-y-auto divide-y">
          {activeRoute?.stores.map((stop) => (
            <div key={stop.store_id} className="px-4 py-4 flex gap-4 items-start">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0 mt-0.5"
                style={{ backgroundColor: COLORS[activeVehicleIndex % COLORS.length] }}
              >
                {stop.order}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-base leading-tight truncate">{stop.store_name}</p>
                <p className="text-sm text-muted-foreground mt-0.5 truncate">{stop.address}</p>
                {stop.arrive_by && (
                  <p className="text-sm text-primary font-medium mt-1">⏱ {stop.arrive_by}</p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 border-t bg-background p-4 flex gap-2">
          <Button
            className="flex-1 h-12 gap-2"
            onClick={() => window.open(activeRoute?.yandex_url, "_blank")}
          >
            <Navigation className="w-5 h-5" />
            Я.Навигатор
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-12 w-12 shrink-0"
            title="Скопировать ссылку маршрута"
            onClick={() => handleCopyNav(activeRoute?.yandex_url ?? '', activeVehicleIndex)}
          >
            {copiedNav === activeVehicleIndex
              ? <Check className="w-5 h-5 text-emerald-500" />
              : <Copy className="w-5 h-5" />}
          </Button>
          <Button
            variant="outline"
            className="flex-1 h-12 gap-2 text-emerald-600 border-emerald-200"
            onClick={() => window.open(activeRoute?.whatsapp_url, "_blank")}
          >
            <Share2 className="w-5 h-5" />
            WhatsApp
          </Button>
        </div>
      </div>
    );
  }

  // ── Desktop view ─────────────────────────────────────────────────────────
  const center: [number, number] = [42.9849, 47.5046]; // Махачкала

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Результат оптимизации</h1>
          <p className="text-muted-foreground">Маршруты успешно построены</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {sessionId && (
            <Button variant="outline" onClick={handleCopyLink} className="gap-2">
              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              <span className="hidden sm:inline">Копировать ссылку</span>
            </Button>
          )}
          <Button variant="outline" onClick={() => window.print()} className="gap-2 print:hidden">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Печать / PDF</span>
          </Button>
          <Button className="gap-2 print:hidden" asChild>
            <Link href="/route">
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Новый маршрут</span>
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-primary text-primary-foreground border-transparent">
          <CardContent className="pt-6">
            <div className="text-sm font-medium opacity-90 mb-1">Общий пробег</div>
            <div className="text-3xl font-bold">{Math.round(result.total_km)} км</div>
            <div className="text-sm opacity-90 mt-1">
              Без оптим.: {Math.round((result.savings as any).unoptimized_km ?? result.savings.unoptimized_km)} км
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-500 text-white border-transparent">
          <CardContent className="pt-6">
            <div className="text-sm font-medium opacity-90 mb-1">Экономия маршрута</div>
            <div className="text-3xl font-bold">{Math.round(result.savings.saved_km)} км</div>
            <div className="text-sm opacity-90 mt-1">
              −{(result.savings as any).saved_pct ?? 0}% · ~{(result.savings as any).saved_fuel_l ?? 0} л топлива (~{(result.savings as any).saved_fuel_cost_rub ?? 0} ₽)
            </div>
          </CardContent>
        </Card>
        <Card className="bg-emerald-600 text-white border-transparent">
          <CardContent className="pt-6">
            <div className="text-sm font-medium opacity-90 mb-1">Экономия (день/месяц)</div>
            <div className="text-3xl font-bold">{result.savings.saved_rub_day} ₽</div>
            <div className="text-sm opacity-90 mt-1">{result.savings.saved_rub_month} ₽ в месяц</div>
          </CardContent>
        </Card>
      </div>

      {/* Map + Legend */}
      <Card className="overflow-hidden border-border print:hidden">
        <div className="h-[440px] w-full relative z-0">
          <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://2gis.ru" target="_blank">2ГИС</a>'
              url="https://tile{s}.maps.2gis.com/tiles?x={x}&y={y}&z={z}&v=1"
              subdomains="0123"
              maxZoom={18}
            />
            <FitBoundsToRoutes routes={result.routes} />
            {result.routes.map((route, i) => {
              const color = COLORS[i % COLORS.length];
              const positions = route.stores
                .filter(s => s.lat != null && s.lon != null)
                .map(s => [s.lat, s.lon] as [number, number]);
              return (
                <Fragment key={route.vehicle_name}>
                  {positions.length > 1 && (
                    <Polyline positions={positions} pathOptions={{ color, weight: 4, opacity: 0.8 }} />
                  )}
                  {route.stores.map((stop) => {
                    if (!stop.lat || !stop.lon) return null;
                    return (
                      <Marker key={`${route.vehicle_name}-${stop.order}`} position={[stop.lat, stop.lon]}>
                        <Popup>
                          <strong>{stop.store_name}</strong><br />
                          {stop.address}<br />
                          Порядок: {stop.order}<br />
                          Авто: {route.vehicle_name}
                        </Popup>
                      </Marker>
                    );
                  })}
                </Fragment>
              );
            })}
          </MapContainer>

          {/* Color Legend overlay */}
          {result.routes.length > 1 && (
            <div className="absolute bottom-3 left-3 z-[1000] bg-background/90 backdrop-blur-sm border rounded-lg px-3 py-2 shadow-md">
              <p className="text-xs font-semibold text-muted-foreground mb-1.5 uppercase tracking-wide">Легенда</p>
              <div className="space-y-1">
                {result.routes.map((route, i) => (
                  <div key={route.vehicle_name} className="flex items-center gap-2 text-xs">
                    <span
                      className="w-4 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: COLORS[i % COLORS.length] }}
                    />
                    <span className="font-medium truncate max-w-[140px]">{route.vehicle_name}</span>
                    <span className="text-muted-foreground ml-auto pl-2">{Math.round(route.total_km)} км</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-6">
        <h2 className="text-2xl font-bold tracking-tight mt-8 mb-4">Детализация по машинам</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {result.routes.map((route, i) => (
            <Card key={route.vehicle_name} className="flex flex-col">
              <CardHeader className="pb-3 border-b bg-muted/20">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ backgroundColor: COLORS[i % COLORS.length] }}>
                      <Car className="w-4 h-4" />
                    </div>
                    {route.vehicle_name}
                  </CardTitle>
                  <Badge variant="secondary">{route.stores.length} точек</Badge>
                </div>
                <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
                  <span className="flex items-center gap-1"><MapPin className="w-4 h-4" /> {Math.round(route.total_km)} км</span>
                  <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> ~{Math.floor((route.estimated_minutes ?? 0) / 60)} ч {(route.estimated_minutes ?? 0) % 60} мин</span>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1">
                <ScrollArea className="h-[300px]">
                  <div className="p-4 space-y-4">
                    {route.stores.map((stop, idx) => (
                      <div key={stop.store_id} className="flex gap-4 relative">
                        {idx !== route.stores.length - 1 && (
                          <div className="absolute left-[11px] top-6 bottom-[-16px] w-[2px] bg-border" />
                        )}
                        <div className="w-6 h-6 rounded-full bg-secondary text-secondary-foreground text-xs font-bold flex items-center justify-center shrink-0 z-10 border-2 border-background">
                          {stop.order}
                        </div>
                        <div className="space-y-1 pb-2 min-w-0">
                          <p className="font-medium text-sm leading-none truncate">{stop.store_name}</p>
                          <p className="text-xs text-muted-foreground truncate">{stop.address}</p>
                          {stop.arrive_by && (
                            <p className="text-xs text-emerald-600 font-medium mt-1">
                              Прибытие: {stop.arrive_by}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
              <div className="p-4 border-t bg-muted/10 flex gap-2 print:hidden">
                <Button className="flex-1 gap-2" onClick={() => window.open(route.yandex_url, "_blank")}>
                  <Navigation className="w-4 h-4" />
                  Я.Навигатор
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="shrink-0"
                  title="Скопировать ссылку маршрута в буфер"
                  onClick={() => handleCopyNav(route.yandex_url ?? '', i)}
                >
                  {copiedNav === i
                    ? <Check className="w-4 h-4 text-emerald-500" />
                    : <Copy className="w-4 h-4" />}
                </Button>
                <Button variant="outline" className="flex-1 gap-2 text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => window.open(route.whatsapp_url, "_blank")}>
                  <Share2 className="w-4 h-4" />
                  WhatsApp
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
