import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import LoginPage from "@/pages/LoginPage";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import DashboardLayout from "./components/DashboardLayout";
import { ThemeProvider } from "./contexts/ThemeContext";
import ContentStudio from "./pages/ContentStudio";
import AvatarReels from "./pages/AvatarReels";
import EditorialCalendar from "./pages/EditorialCalendar";

// Content Studio (Carousel) + Avatar Reels — dashboard routes
function Router() {
  return (
    <Switch>
      {/* Login page lives outside the DashboardLayout */}
      <Route path="/login" component={LoginPage} />

      {/* All other routes go through the authenticated dashboard */}
      <Route>
        <DashboardLayout>
          <Switch>
            <Route path="/" component={ContentStudio} />
            <Route path="/content-studio" component={ContentStudio} />
            <Route path="/calendar" component={EditorialCalendar} />
            <Route path="/avatar-reels" component={AvatarReels} />
            <Route path="/404" component={NotFound} />
            <Route component={NotFound} />
          </Switch>
        </DashboardLayout>
      </Route>
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
