import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { AppLayout } from "@/components/layout";
import { HomePage } from "@/pages/home";
import { StoresPage } from "@/pages/stores";
import { RoutePage } from "@/pages/route";
import { ResultPage } from "@/pages/result";
import { AnalyticsPage } from "@/pages/analytics";
import { HistoryPage } from "@/pages/history";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: false,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={HomePage} />
      <Route path="/stores" component={StoresPage} />
      <Route path="/route" component={RoutePage} />
      <Route path="/result/:id" component={ResultPage} />
      <Route path="/result" component={ResultPage} />
      <Route path="/analytics" component={AnalyticsPage} />
      <Route path="/history" component={HistoryPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AppLayout>
            <Router />
          </AppLayout>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
