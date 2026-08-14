import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { Home, Store, BarChart3, Truck, History, LogOut, User, Settings, ClipboardList, Puzzle } from "lucide-react";
import React from "react";
import { useAuth } from "@/context/auth";
import { Button } from "@/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [activeRoute, setActiveRoute] = useState<{ id: number; date: string; num_points: number; total_km: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/route/active-session", { credentials: "include" });
        if (!response.ok) return;
        const payload = await response.json();
        if (!cancelled) setActiveRoute(payload.session ?? null);
      } catch {}
    };
    load();
    const timer = window.setInterval(load, 30_000);
    const refresh = () => load();
    window.addEventListener("route:changed", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("route:changed", refresh);
    };
  }, []);

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background overflow-hidden print:block">
        <AppSidebar />
        <main className="flex-1 flex flex-col min-w-0 print:block">
          <header className="h-14 border-b border-border bg-card flex items-center px-4 md:px-6 shrink-0 z-10 sticky top-0 print:hidden">
            <SidebarTrigger className="-ml-2 md:hidden mr-2" />
            <div className="flex-1" />
            <div className="flex items-center gap-3">
              {activeRoute && (
                <Link
                  href={`/result/${activeRoute.id}`}
                  className="inline-flex items-center gap-2 rounded-full border border-emerald-200/80 bg-emerald-50/90 px-3 py-1 text-xs font-medium text-emerald-900 shadow-xs transition-all hover:bg-emerald-100 hover:border-emerald-300 active:scale-[0.98]"
                  title="Перейти к текущему активному рейсу"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
                  </span>
                  <span className="font-semibold text-emerald-950">Активный рейс:</span>
                  <span>{activeRoute.date}</span>
                  <span className="text-emerald-700/80">·</span>
                  <span>{activeRoute.num_points} точек</span>
                  <span className="ml-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow-2xs">
                    Открыть
                  </span>
                </Link>
              )}
              <div className="hidden md:flex items-center gap-2 text-xs text-muted-foreground pl-2 border-l border-border/60">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Система онлайн</span>
              </div>
            </div>
          </header>
          <div className="flex-1 overflow-auto bg-background p-4 md:p-6 lg:p-8 print:p-4 flex flex-col">
            <div className="max-w-[1400px] mx-auto w-full flex-1 min-h-0 flex flex-col">
              {children}
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

function AppSidebar() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  const menuItems = [
    { title: "Главная", url: "/", icon: Home },
    { title: "Магазины", url: "/stores", icon: Store },
    { title: "Заявки на день", url: "/orders", icon: ClipboardList },
    { title: "Аналитика", url: "/analytics", icon: BarChart3 },
    { title: "История", url: "/history", icon: History },
    { title: "Интеграции", url: "/integrations", icon: Puzzle },
    { title: "Настройки", url: "/settings", icon: Settings },
  ];

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar text-sidebar-foreground print:hidden">
      <SidebarHeader className="h-14 px-4 flex items-center shrink-0 flex-row gap-2 font-semibold text-lg">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-primary-foreground">
          <Truck className="w-5 h-5" />
        </div>
        <span className="tracking-tight">SmartRoute</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {menuItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}
                    tooltip={item.title}
                  >
                    <Link href={item.url} className="flex items-center gap-3">
                      <item.icon className="w-4 h-4 shrink-0" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3">
        <div className="flex items-center gap-2 px-1 py-1 rounded-md text-sidebar-foreground">
          <User className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span className="text-sm flex-1 truncate text-muted-foreground">{user?.username}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            onClick={logout}
            title="Выйти"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
