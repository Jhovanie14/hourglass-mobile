"use client"

import Link from "next/link"
import { useTheme } from "next-themes"
import { ChevronsUpDown, LogOut, Moon, Settings, Sun } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { logout } from "@/app/dashboard/actions"

export function UserMenu({ email }: { email: string }) {
  const initials = email[0].toUpperCase()
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton className="h-10 cursor-pointer gap-3 rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground data-[state=open]:bg-secondary data-[state=open]:text-foreground">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/20">
                <span className="text-[10px] font-bold text-primary">
                  {initials}
                </span>
              </div>
              <span className="flex-1 truncate text-xs">{email}</span>
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            side="top"
            align="center"
            sideOffset={8}
            className="w-56 border-border bg-popover text-popover-foreground"
          >
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {email}
            </DropdownMenuLabel>

            <DropdownMenuSeparator className="bg-border" />

            <DropdownMenuItem
              asChild
              className="cursor-pointer gap-2.5 text-sm text-foreground hover:bg-secondary hover:text-foreground focus:bg-secondary focus:text-foreground"
            >
              <a href="/dashboard/profile">
                <Settings className="h-3.5 w-3.5" />
                Profile
              </a>
            </DropdownMenuItem>

            <DropdownMenuItem
              asChild
              className="cursor-pointer gap-2.5 text-sm text-foreground hover:bg-secondary hover:text-foreground focus:bg-secondary focus:text-foreground"
            >
              <button
                onClick={() =>
                  setTheme(resolvedTheme === "light" ? "dark" : "light")
                }
                className="w-full"
              >
                {resolvedTheme === "light" ? (
                  <>
                    <Sun className="h-3.5 w-3.5" /> Light Mode
                  </>
                ) : (
                  <>
                    <Moon className="h-3.5 w-3.5" /> Dark Mode
                  </>
                )}
              </button>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-border" />

            <DropdownMenuItem
              className="cursor-pointer gap-2.5 text-sm text-destructive hover:bg-destructive/10 hover:text-destructive focus:bg-destructive/10 focus:text-destructive"
              onClick={() => logout()}
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
