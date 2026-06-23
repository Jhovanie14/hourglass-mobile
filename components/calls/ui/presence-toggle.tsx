"use client"

import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { useWebRTC } from "@/components/calls/webrtc-provider"
import { cn } from "@/lib/utils"

export function PresenceToggle({ className }: { className?: string }) {
  const { isReady, online, setOnline } = useWebRTC()

  function handleChange(next: boolean) {
    setOnline(next)
    toast(
      next
        ? "You're online — you'll receive calls."
        : "You're offline — you won't receive calls."
    )
  }

  const label = !isReady ? "Connecting…" : online ? "Online" : "Offline"

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span
        className={cn(
          "inline-block size-2 shrink-0 rounded-full",
          isReady && online ? "bg-green-500" : "bg-muted-foreground"
        )}
        aria-hidden
      />
      <span className="text-sm text-muted-foreground">{label}</span>
      <Switch
        checked={online}
        onCheckedChange={handleChange}
        disabled={!isReady}
        aria-label="Toggle availability for inbound calls"
        className="ml-auto"
      />
    </div>
  )
}
