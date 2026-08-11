"use client"

import { useState } from "react"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/client"
import { saveDisposition, type Disposition } from "@/lib/dispositions"
import {
  OUTCOME_OPTIONS,
  FOLLOW_UP_OPTIONS,
  followUpDate,
  type CallDirection,
  type FollowUpPreset,
  type Outcome,
} from "@/lib/disposition-logic"

export function NotesSheet({
  open,
  onOpenChange,
  call,
  existing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  call: { telnyxCallId: string; contactNumber: string; direction: CallDirection }
  existing?: Disposition | null
  onSaved?: (d: Disposition) => void
}) {
  // The sheet is mounted fresh each time it opens (parents render it
  // conditionally), so state is seeded once from props here — no re-seed effect.
  const [outcome, setOutcome] = useState<Outcome | null>(
    (existing?.outcome as Outcome) ?? null
  )
  const [notes, setNotes] = useState(existing?.notes ?? "")
  // null in edit mode = "leave the saved follow-up untouched"; "none" for new.
  const [preset, setPreset] = useState<FollowUpPreset | null>(
    existing ? null : "none"
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    if (!outcome || saving) return
    setSaving(true)
    setError(null)

    // preset null (edit, untouched) keeps the existing follow-up; else resolve.
    const followUpAt =
      preset === null
        ? (existing?.follow_up_at ?? null)
        : (followUpDate(preset, new Date())?.toISOString() ?? null)

    try {
      const saved = await saveDisposition(createClient(), {
        telnyxCallId: call.telnyxCallId,
        outcome,
        notes,
        followUpAt,
        contactNumber: call.contactNumber,
        direction: call.direction,
      })
      onSaved?.(saved)
      onOpenChange(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save call notes.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-lg gap-0">
        <SheetHeader>
          <SheetTitle>How did the call go?</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-2">
          {/* Outcome */}
          <div className="grid grid-cols-2 gap-2">
            {OUTCOME_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setOutcome(o.value)}
                className={cn(
                  "rounded-lg border px-3 py-2 text-sm font-medium transition",
                  outcome === o.value
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Notes */}
          <Textarea
            placeholder="Add a note (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
          />

          {/* Follow-up */}
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Follow up
            </p>
            <div className="flex flex-wrap gap-2">
              {FOLLOW_UP_OPTIONS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setPreset(f.value)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition",
                    preset === f.value
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-muted"
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {existing && preset === null && (
              <p className="mt-1 text-xs text-muted-foreground">
                Keeping the existing follow-up. Pick an option to change it.
              </p>
            )}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <SheetFooter>
          <Button onClick={handleSave} disabled={!outcome || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
