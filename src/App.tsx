import { AccessGate } from "@/components/access-gate"
import { DashboardShell } from "@/components/dashboard-shell"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { useDashboard } from "@/hooks/use-dashboard"

export default function App() {
  const dashboard = useDashboard()

  return (
    <TooltipProvider>
      {dashboard.authenticated ? (
        <DashboardShell dashboard={dashboard} />
      ) : (
        <AccessGate dashboard={dashboard} />
      )}
      <Toaster position="top-center" richColors closeButton />
    </TooltipProvider>
  )
}
