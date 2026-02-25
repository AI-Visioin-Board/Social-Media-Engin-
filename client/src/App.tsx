import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import OrderDetail from "./pages/OrderDetail";
import NewOrder from "./pages/NewOrder";
import ClientPortal from "./pages/ClientPortal";
import ClientPortalLogin from "./pages/ClientPortalLogin";

// Admin routes — wrapped in DashboardLayout
function AdminRouter() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/orders/new" component={NewOrder} />
        <Route path="/orders/:id" component={OrderDetail} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

// Client portal routes — standalone, no admin sidebar
function PortalRouter() {
  return (
    <Switch>
      {/* /portal/login — show instructions */}
      <Route path="/portal/login" component={ClientPortalLogin} />
      {/* /portal/:token — validate magic link token */}
      <Route path="/portal/:token" component={ClientPortalLogin} />
      {/* /portal — authenticated client dashboard */}
      <Route path="/portal" component={ClientPortal} />
    </Switch>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/portal/:rest*" component={PortalRouter} />
      <Route component={AdminRouter} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
