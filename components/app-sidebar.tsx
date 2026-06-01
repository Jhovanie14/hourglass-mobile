import {
  Sidebar,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Mail, Zap } from "lucide-react"
import Link from "next/link"
import { createClient } from "@/lib/server"
import { isAdmin } from "@/lib/auth"
import { UserMenu } from "./user-menu"
import { SidebarNav } from "./sidebar-nav"

export async function AppSidebar() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const admin = await isAdmin()

  return (
    <Sidebar className="border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4">
        <Link
          href="/dashboard"
          className="flex cursor-pointer items-center gap-2.5"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-md shadow-primary/20">
            <Mail className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="text-base font-bold tracking-tight text-sidebar-foreground uppercase">
            Hourglass mobile
          </span>
        </Link>
      </SidebarHeader>

      {/* Nav — client component so asChild + Link works without hydration errors */}
      <SidebarNav isAdmin={admin} />

      {/* Footer */}
      <SidebarFooter className="space-y-3 px-3 pb-4">
        <SidebarSeparator className="bg-sidebar-border" />

        {/* <div className="p-3.5 bg-secondary/80 border border-border/60 rounded-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-sidebar-foreground">Credits</span>
            <span className="text-xs font-bold text-primary">{credits.toLocaleString()}</span>
          </div>
          <div className="w-full bg-border rounded-full h-1.5 mb-2.5">
            <div
              className="bg-primary h-1.5 rounded-full transition-all"
              style={{ width: `${creditPct}%` }}
            />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground capitalize">{plan} plan</span>
            <Link
              href="/dashboard/settings"
              className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
            >
              <Zap className="w-3 h-3" />
              Upgrade
            </Link>
          </div>
        </div> */}

        <UserMenu email={user!.email!} />
      </SidebarFooter>
    </Sidebar>
  )
}
