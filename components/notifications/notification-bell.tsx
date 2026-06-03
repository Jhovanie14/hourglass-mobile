"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, MessageSquare, Phone } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { createClient } from "@/lib/client"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { Notification } from "@/types/notifications"

export function NotificationBell() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    supabase
      .from("notifications")
      .select("*")
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setNotifications((data as Notification[]) ?? [])
      })
  }, [supabase])

  useEffect(() => {
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  const handleClick = useCallback(
    async (notification: Notification) => {
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id))
      setOpen(false)

      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notification.id)

      if (notification.type === "missed_call") {
        router.push("/dashboard/calls")
      } else {
        router.push(`/dashboard/conversations?id=${notification.reference_id}`)
      }
    },
    [supabase, router]
  )

  const missedCalls = notifications.filter((n) => n.type === "missed_call")
  const unreadMessages = notifications.filter((n) => n.type === "unread_message")
  const totalCount = notifications.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-1.5 text-muted-foreground hover:text-foreground">
          <Bell className="h-5 w-5" />
          {totalCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {totalCount > 9 ? "9+" : totalCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
        </div>

        {notifications.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            All caught up
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {missedCalls.length > 0 && (
              <div>
                <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Missed Calls
                </p>
                {missedCalls.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted"
                  >
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {n.metadata.contact_number}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {n.metadata.phone_label} &middot;{" "}
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {unreadMessages.length > 0 && (
              <div>
                <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Unread Messages
                </p>
                {unreadMessages.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted"
                  >
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {n.metadata.contact_number}
                      </p>
                      {n.metadata.last_message && (
                        <p className="truncate text-xs text-muted-foreground">
                          {n.metadata.last_message}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {n.metadata.phone_label} &middot;{" "}
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
