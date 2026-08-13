"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import {
  CalendarClock,
  LayoutDashboard,
  MessageSquare,
  Phone,
  PhoneIncoming,
  UserPlus,
  Users,
} from "lucide-react"
import { PresenceToggle } from "@/components/calls/ui/presence-toggle"

const NAV_ITEMS = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  {
    label: "Conversations",
    href: "/dashboard/conversations",
    icon: MessageSquare,
  },
  { label: "Calls", href: "/dashboard/calls", icon: PhoneIncoming },
  { label: "Contacts", href: "/dashboard/contacts", icon: Users },
  { label: "Follow-ups", href: "/dashboard/follow-ups", icon: CalendarClock },
]

const ADMIN_NAV_ITEMS = [
  { label: "Invite user", href: "/dashboard/invite", icon: UserPlus },
  {
    label: "Phone numbers",
    href: "/dashboard/settings/phone-numbers",
    icon: Phone,
  },
]

export function SidebarNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const pathname = usePathname()

  return (
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Availability</SidebarGroupLabel>
        <SidebarGroupContent>
          <PresenceToggle className="px-2 py-1.5" />
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Agent</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu>
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== "/dashboard" && pathname.startsWith(item.href))
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={isActive}
                    tooltip={item.label}
                    className="h-9 gap-3 rounded-lg text-muted-foreground hover:text-foreground data-active:text-sidebar-accent-foreground"
                  >
                    <Link href={item.href}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className="text-sm">{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>

      {isAdmin && (
        <SidebarGroup>
          <SidebarGroupLabel>Admin</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ADMIN_NAV_ITEMS.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/dashboard" && pathname.startsWith(item.href))
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.label}
                      className="h-9 gap-3 rounded-lg text-muted-foreground hover:text-foreground data-active:text-sidebar-accent-foreground"
                    >
                      <Link href={item.href}>
                        <item.icon className="h-4 w-4 shrink-0" />
                        <span className="text-sm">{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
    </SidebarContent>
  )
}
