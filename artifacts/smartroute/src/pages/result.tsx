import { useEffect, useState, Fragment } from "react";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MapPin, Navigation, Share2, Download, RefreshCw, Car, ArrowRight, Clock } from "lucide-react";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

import type { RouteResult } from "@workspace/api-client-react";

const COLORS = ["#0ea5e9", "#f43f5e", "#8b5cf6", "#10b981", "#f59e0b"];

export function ResultPage() {
  const [, setLocation] = useLocation();
  const [result, setResult] = useState<RouteResult | null>(null);

  useEffect(() => {
    const data = localStorage.getItem("smartroute_result");
    if (data) {
      try {
        setResult(JSON.parse(data));
      } catch (e) {
        console.error("Failed to parse route result");
      }
    } else {
      setLocation("/route");
    }
  }, [setLocation]);

  if (!result) return null;

  // Calculate center of map from all stops
  let allLats = 0;
  let allLons = 0;
  let pointCount = 0;
  
  result.routes.forEach(route => {
    route.stores.forEach(stop => {
      if (stop.lat && stop.lon) {
        allLats += stop.lat;
        allLons += stop.lon;
        pointCount++;
      }
    });
  });

  const center: [number, number] = pointCount > 0 
    ? [allLats / pointCount, allLons / pointCount]
    : [55.7558, 37.6173]; // Moscow default

  return (
    <div className="space-y-6 pb-20">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Результат оптимизации</h1>
          <p className="text-muted-foreground">Маршруты успешно построены</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()} className="gap-2">
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Скачать PDF</span>
          </Button>
          <Link href="/route">
            <Button className="gap-2">
              <RefreshCw className="w-4 h-4" />
              <span className="hidden sm:inline">Новый маршрут</span>
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-primary text-primary-foreground border-transparent">
          <CardContent className="pt-6">
            <div className="text-sm font-medium opacity-90 mb-1">Общий пробег</div>
            <div className="text-3xl font-bold">{Math.round(result.total_km)} км</div>
          </CardContent>
        </Card>
        
        <Card className="bg-emerald-500 text-white border-transparent">
          <CardContent className="pt-6">
            <div className="text-sm font-medium opacity-90 mb-1">Сэкономлено (км)</div>
            <div className="text-3xl font-bold">{Math.round(result.savings.saved_km)} км</div>
            <div className="text-sm opacity-90 mt-1">Было {Math.round(result.savings.unoptimized_km)} км</div>
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

      <Card className="overflow-hidden border-border print:hidden">
        <div className="h-[400px] w-full relative z-0">
          <MapContainer center={center} zoom={11} style={{ height: '100%', width: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
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
                          <strong>{stop.store_name}</strong><br/>
                          {stop.address}<br/>
                          Порядок: {stop.order}<br/>
                          Авто: {route.vehicle_name}
                        </Popup>
                      </Marker>
                    );
                  })}
                </Fragment>
              );
            })}
          </MapContainer>
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
                  <span className="flex items-center gap-1"><Clock className="w-4 h-4" /> ~{Math.round(route.estimated_minutes / 60)} ч {route.estimated_minutes % 60} мин</span>
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
                        <div className="space-y-1 pb-2">
                          <p className="font-medium text-sm leading-none">{stop.store_name}</p>
                          <p className="text-xs text-muted-foreground">{stop.address}</p>
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

function Badge({ children, variant = "default", className = "" }: { children: React.ReactNode, variant?: "default" | "secondary" | "destructive", className?: string }) {
  const base = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2";
  const variants = {
    default: "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
    secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
    destructive: "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
  };
  return <div className={`${base} ${variants[variant]} ${className}`}>{children}</div>;
}
