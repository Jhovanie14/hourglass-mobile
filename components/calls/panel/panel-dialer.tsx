"use client"

import { useState } from "react"
import { LogOut, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useWebRTC } from "@/components/calls/webrtc-provider"
import type { PhoneNumber } from "@/types/calls"

export function PanelDialer({
  phoneNumbers,
  onSignOut,
}: {
  phoneNumbers: PhoneNumber[]
  onSignOut: () => void
}) {
  const { isReady, makeCall } = useWebRTC()
  const [to, setTo] = useState("")
  const [phoneNumberId, setPhoneNumberId] = useState("")

  const selectedId = phoneNumberId || phoneNumbers[0]?.id || ""
  const selectedPhone = phoneNumbers.find((p) => p.id === selectedId)

  function handleCall() {
    if (!to.trim() || !selectedPhone) return
    makeCall(to.trim(), selectedPhone)
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-foreground">Call Panel</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onSignOut}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-from" className="text-sm font-medium">
          From
        </label>
        <select
          id="panel-from"
          value={selectedId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          className="border-input bg-background text-foreground flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {phoneNumbers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.phone_number}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-to" className="text-sm font-medium">
          To
        </label>
        <Input
          id="panel-to"
          placeholder="+1 (555) 000-0000"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCall()}
        />
      </div>

      <Button
        className="w-full gap-1.5"
        onClick={handleCall}
        disabled={!isReady || !to.trim() || !selectedPhone}
      >
        <Phone className="h-4 w-4" />
        {!isReady ? "Connecting…" : "Call"}
      </Button>
    </div>
  )
}
