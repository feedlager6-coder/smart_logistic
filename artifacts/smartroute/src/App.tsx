import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { AuthProvider, useAuth } from "@/context/auth";
import { AppLayout } from "@/components/layout";
import { ErrorBoundary } from "@/components/error-boundary";
import { LoginPage } from "@/pages/login";
import { HomePage } from "@/pages/home";
import { StoresPage } from "@/pages/stores";
import { RoutePage } from "@/pages/route";
import { ResultPage } from "@/pages/result";
import { AnalyticsPage } from "@/pages/analytics";
import { HistoryPage } from "@/pages/history";
import { SettingsPage } from "@/pages/settings";
import { OrdersPage } from "@/pages/orders";
import { ApiError } from "@workspace/api-client-react";

function is401(error: unknown): boolean {
  return (
    error instanceof ApiError && error.status === 401
  );
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (is401(error)) {
        // Notify auth context to re-check session; if truly logged out → login page shown
        window.dispatchEvent(new CustomEvent("api:unauthorized"));
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (is401(error)) {
        window.dispatchEvent(new CustomEvent("api:unauthorized"));
      }
    },
  }),
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function ProtectedRouter() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/stores" component={StoresPage} />
        <Route path="/route" component={RoutePage} />
        <Route path="/result/:id" component={ResultPage} />
        <Route path="/result" component={ResultPage} />
        <Route path="/orders" component={OrdersPage} />
        <Route path="/analytics" component={AnalyticsPage} />
        <Route path="/history" component={HistoryPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <AuthProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <ErrorBoundary>
                <ProtectedRouter />
              </ErrorBoundary>
            </WouterRouter>
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
