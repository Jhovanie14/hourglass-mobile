"use client"

import { useEffect, useState } from "react"
import { Loader2, Lock } from "lucide-react"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { updatePhoneNumber } from "@/app/dashboard/settings/phone-numbers/actions"
import { ColorPicker } from "./color-swatches"
import type { PhoneNumberRecord } from "@/types/conversations"

export function EditPhoneNumberModal({
  phoneNumber,
  open,
  onOpenChange,
  usedColors,
}: {
  phoneNumber: PhoneNumberRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Colors used by OTHER numbers (excludes this one). */
  usedColors: string[]
}) {
  const [label, setLabel] = useState("")
  const [color, setColor] = useState("")
  const [active, setActive] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  // Hydrate the form when a row is opened for editing.
  useEffect(() => {
    if (open && phoneNumber) {
      setLabel(phoneNumber.label)
      setColor(phoneNumber.color)
      setActive(phoneNumber.is_active)
      setError(null)
    }
  }, [open, phoneNumber])

  const canSubmit = Boolean(label.trim() && color.trim() && !pending)

  async function handleSubmit() {
    if (!phoneNumber) return
    setError(null)
    if (!canSubmit) return
    setPending(true)

    const res = await updatePhoneNumber(phoneNumber.id, {
      label,
      color,
      is_active: active,
    })

    setPending(false)

    if (res.error) {
      setError(res.error)
      return
    }

    toast.success("Phone number updated successfully")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Phone Number</DialogTitle>
          <DialogDescription>
            Update the label, color, or active status.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Label */}
          <div className="space-y-1.5">
            <label htmlFor="edit-label" className="text-sm font-medium text-foreground/80">
              Label
            </label>
            <Input
              id="edit-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={30}
            />
          </div>

          {/* Phone — read only */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor="edit-phone" className="text-sm font-medium text-foreground/80">
                Phone Number
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock className="h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  To change the phone number, delete this entry and add a new one
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="edit-phone"
              value={phoneNumber?.phone_number ?? ""}
              readOnly
              disabled
              className="font-mono"
            />
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
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
