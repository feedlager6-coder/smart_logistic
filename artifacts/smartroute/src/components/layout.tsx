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
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { Home, Store, Map, BarChart3, Truck, History } from "lucide-react";
import React from "react";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background overflow-hidden print:block">
        <AppSidebar />
        <main className="flex-1 flex flex-col min-w-0 print:block">
          <header className="h-14 border-b border-border bg-card flex items-center px-4 md:px-6 shrink-0 z-10 sticky top-0 print:hidden">
            <SidebarTrigger className="-ml-2 md:hidden mr-2" />
            <div className="flex-1" />
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Система работает
              </span>
            </div>
          </header>
          <div className="flex-1 overflow-auto bg-background p-4 md:p-6 lg:p-8 print:p-4">
            <div className="max-w-[1400px] mx-auto w-full">
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

  const menuItems = [
    { title: "Главная", url: "/", icon: Home },
    { title: "Магазины", url: "/stores", icon: Store },
    { title: "Новый маршрут", url: "/route", icon: Map },
    { title: "Аналитика", url: "/analytics", icon: BarChart3 },
    { title: "История", url: "/history", icon: History },
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
    </Sidebar>
  );
}
