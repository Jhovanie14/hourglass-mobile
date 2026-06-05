import {
  Sidebar,
  SidebarContent,
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
    <Sidebar
      className="border-r border-sidebar-border bg-sidebar"
      collapsible="icon"
    >
      {/* Logo */}
      <SidebarHeader className="border-b border-sidebar-border px-4 py-4 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:py-4">
        <Link
          href="/dashboard"
          className="flex cursor-pointer items-center gap-2.5 group-data-[collapsible=icon]:justify-center"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary shadow-md shadow-primary/20">
            <Mail className="h-4 w-4 text-primary-foreground" />
          </div>
          <span className="overflow-hidden text-base font-bold tracking-tight text-sidebar-foreground uppercase transition-[width,opacity] duration-200 ease-linear group-data-[collapsible=icon]:w-0 group-data-[collapsible=icon]:opacity-0">
            Hourglass mobile
          </span>
        </Link>
      </SidebarHeader>

      {/* Nav — client component so asChild + Link works without hydration errors */}
      <SidebarContent>
        <SidebarNav isAdmin={admin} />
      </SidebarContent>

      <SidebarSeparator className="mx-0 bg-sidebar-border group-data-[collapsible=icon]:hidden" />
      {/* Footer */}
      <SidebarFooter>
        <UserMenu email={user!.email!} />
      </SidebarFooter>
    </Sidebar>
  )
}
