import { redirect } from "next/navigation"
import { createClient } from "@/lib/server"
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/app-sidebar"
import { WebRTCProvider } from "@/components/calls/webrtc-provider"
import { NotificationBell } from "@/components/notifications/notification-bell"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) {
    redirect("/auth/login")
  }
  return (
    <SidebarProvider>
      <WebRTCProvider>
        <div className="flex min-h-screen w-full bg-background">
          <AppSidebar />

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center justify-between border border-b px-4 py-4">
              <SidebarTrigger className="cursor-pointer text-muted-foreground hover:text-foreground" />
              <NotificationBell />
            </div>

            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
      </WebRTCProvider>
    </SidebarProvider>
  )
}
