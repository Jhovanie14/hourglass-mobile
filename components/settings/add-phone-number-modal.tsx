"use client"

import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { addPhoneNumber } from "@/app/dashboard/settings/phone-numbers/actions"
import { ColorPicker, firstAvailableColor } from "./color-swatches"

const E164 = /^\+[1-9]\d{7,14}$/

export function AddPhoneNumberModal({
  open,
  onOpenChange,
  usedColors,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  usedColors: string[]
}) {
  const [label, setLabel] = useState("")
  const [phone, setPhone] = useState("")
  const [color, setColor] = useState(() => firstAvailableColor(usedColors))
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Reset to a fresh form each time the modal opens.
  useEffect(() => {
    if (open) {
      setLabel("")
      setPhone("")
      setColor(firstAvailableColor(usedColors))
      setActive(true)
      setError(null)
    }
  }, [open, usedColors])

  const phoneInvalid = phone.length > 0 && !E164.test(phone)
  const canSubmit = label.trim() && E164.test(phone) && color.trim() && !pending

  async function handleSubmit() {
    setError(null)
    if (!canSubmit) return
    setPending(true)

    const res = await addPhoneNumber({
      label,
      phone_number: phone,
      color,
      is_active: active,
    })

    setPending(false)

    if (res.error) {
      setError(res.error)
      return
    }

    toast.success("Phone number added successfully")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Phone Number</DialogTitle>
          <DialogDescription>
            Connect a Telnyx number to a new inbox.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Label */}
          <div className="space-y-1.5">
            <label htmlFor="add-label" className="text-sm font-medium text-foreground/80">
              Label
            </label>
            <Input
              id="add-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={30}
              placeholder="e.g. Hourglass, Launchpad, Support Line"
            />
            <p className="text-xs text-muted-foreground">
              This is the name your team will see in the app
            </p>
          </div>

          {/* Phone */}
          <div className="space-y-1.5">
            <label htmlFor="add-phone" className="text-sm font-medium text-foreground/80">
              Phone Number
            </label>
            <Input
              id="add-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+15551234567"
              className="font-mono"
              aria-invalid={phoneInvalid}
            />
            {phoneInvalid ? (
              <p className="text-xs text-destructive">
                Must be in E.164 format (e.g. +15551234567)
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Enter the exact number as it appears in your Telnyx portal
              </p>
            )}
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground/80">Color</span>
            <ColorPicker value={color} onChange={setColor} usedColors={usedColors} />
          </div>

          {/* Active */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3.5 py-3">
            <div>
              <p className="text-sm font-medium text-foreground/80">Active</p>
              <p className="text-xs text-muted-foreground">
                Inactive numbers won&apos;t appear in conversations or calls
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="cursor-pointer">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Add Number
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
