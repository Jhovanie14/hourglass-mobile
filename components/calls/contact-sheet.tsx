"use client"

import { useEffect, useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { saveContact } from "@/lib/contacts-client"
import type { PhoneNumber } from "@/types/calls"

export function ContactSheet({
  open,
  onOpenChange,
  contactNumber,
  phoneNumbers,
  defaultPhoneNumberId,
  existingName,
  accessToken,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  contactNumber: string
  phoneNumbers: PhoneNumber[]
  defaultPhoneNumberId?: string | null
  existingName?: string | null
  accessToken?: string
  onSaved?: () => void
}) {
  const [name, setName] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName(existingName ?? "")
    setSelectedId(defaultPhoneNumberId ?? phoneNumbers[0]?.id ?? null)
    setError(null)
    setSaving(false)
  }, [open, existingName, defaultPhoneNumberId, phoneNumbers])

  const canSave = Boolean(selectedId && name.trim()) && !saving

  async function handleSave() {
    if (!selectedId || !name.trim() || saving) return
    setSaving(true)
    setError(null)
    const res = await saveContact(
      { phoneNumberId: selectedId, contactNumber, name: name.trim() },
      accessToken
    )
    setSaving(false)
    if (res.ok) {
      onSaved?.()
      onOpenChange(false)
    } else {
      setError(res.error)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-lg gap-0">
        <SheetHeader>
          <SheetTitle>{existingName ? "Edit contact" : "Add contact"}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-2">
          <Input
            placeholder="Contact name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />

          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Save under line
            </p>
            <div className="flex flex-wrap gap-2">
              {phoneNumbers.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
                    selectedId === p.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">Saving {contactNumber}</p>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
