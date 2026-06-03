"use client"

import { useState } from "react"
import { Phone } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useWebRTC } from "./webrtc-provider"
import type { PhoneNumber } from "@/types/calls"

export function NewCallDialog({ phoneNumbers }: { phoneNumbers: PhoneNumber[] }) {
  const { isReady, makeCall } = useWebRTC()
  const [open, setOpen] = useState(false)
  const [to, setTo] = useState("")
  const [phoneNumberId, setPhoneNumberId] = useState(phoneNumbers[0]?.id ?? "")

  const selectedPhone = phoneNumbers.find((p) => p.id === phoneNumberId)

  function handleCall() {
    if (!to.trim() || !selectedPhone) return
    makeCall(to.trim(), selectedPhone.phone_number)
    toast.success("Calling " + to.trim())
    setOpen(false)
    setTo("")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5">
          <Phone className="h-4 w-4" />
          New Call
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>New Outbound Call</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label htmlFor="from-number" className="text-sm font-medium">From</label>
            <select
              id="from-number"
              value={phoneNumberId}
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
          <div className="space-y-1.5">
            <label htmlFor="to-number" className="text-sm font-medium">To</label>
            <Input
              id="to-number"
              placeholder="+1 (555) 000-0000"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCall()}
            />
          </div>
          <Button
            className="w-full gap-1.5"
            onClick={handleCall}
            disabled={!isReady || !to.trim() || !phoneNumberId}
          >
            <Phone className="h-4 w-4" />
            {!isReady ? "Connecting…" : "Call"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
