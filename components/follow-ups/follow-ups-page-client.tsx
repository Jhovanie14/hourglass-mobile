"use client"

import { useMemo, useState } from "react"
import { format, formatDistanceToNow } from "date-fns"
import { CalendarClock, Check } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/client"
import { clearFollowUp, type Disposition } from "@/lib/dispositions"
import { groupFollowUps } from "@/lib/follow-ups"
import { outcomeLabel } from "@/lib/disposition-logic"

export function FollowUpsPageClient({
  dispositions,
  nameMap,
}: {
  dispositions: Disposition[]
  nameMap: Record<string, string>
}) {
  const supabase = useMemo(() => createClient(), [])
  const [rows, setRows] = useState<Disposition[]>(dispositions)
  const [clearing, setClearing] = useState<string | null>(null)

  const groups = useMemo(() => groupFollowUps(rows, new Date()), [rows])
  const total = groups.overdue.length + groups.today.length + groups.upcoming.length

  async function markDone(row: Disposition) {
    setClearing(row.id)
    const previous = rows
    setRows((prev) => prev.filter((r) => r.id !== row.id)) // optimistic
    try {
      await clearFollowUp(supabase, row.id)
      toast("Follow-up done", {
        description: nameMap[row.contact_number ?? ""] ?? row.contact_number ?? undefined,
      })
    } catch (err) {
      setRows(previous) // rollback
      toast.error(err instanceof Error ? err.message : "Failed to clear follow-up")
    } finally {
      setClearing(null)
    }
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Follow-ups
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your scheduled call-backs from notes — only you see your own follow-ups
        </p>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 py-20 text-center">
          <CalendarClock className="mb-1 h-10 w-10 text-muted-foreground/40" />
          <p className="text-base font-medium text-foreground">
            No follow-ups scheduled
          </p>
          <p className="text-sm text-muted-foreground">
            Set one from the Notes button on any call row
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          <FollowUpSection
            title="Overdue"
            accent="overdue"
            rows={groups.overdue}
            nameMap={nameMap}
            clearing={clearing}
            onDone={markDone}
          />
          <FollowUpSection
            title="Today"
            rows={groups.today}
            nameMap={nameMap}
            clearing={clearing}
            onDone={markDone}
          />
          <FollowUpSection
            title="Upcoming"
            rows={groups.upcoming}
            nameMap={nameMap}
            clearing={clearing}
            onDone={markDone}
          />
        </div>
      )}
    </div>
  )
}

function FollowUpSection({
  title,
  accent,
  rows,
  nameMap,
  clearing,
  onDone,
}: {
  title: string
  accent?: "overdue"
  rows: Disposition[]
  nameMap: Record<string, string>
  clearing: string | null
  onDone: (row: Disposition) => void
}) {
  if (rows.length === 0) return null
  return (
    <section>
      <h2
        className={cn(
          "mb-2 text-sm font-semibold tracking-wide uppercase",
          accent === "overdue" ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {title} · {rows.length}
      </h2>
      <div className="space-y-2">
        {rows.map((row) => {
          const name = row.contact_number ? nameMap[row.contact_number] : null
          const due = row.follow_up_at ? new Date(row.follow_up_at) : null
          return (
            <div
              key={row.id}
              className={cn(
                "flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-3 sm:flex-row sm:items-center sm:justify-between",
                accent === "overdue" && "border-destructive/30 bg-destructive/5"
              )}
            >
              <div className="min-w-0">
                <p className="font-medium text-foreground">
                  {name ?? row.contact_number ?? "Unknown number"}
                </p>
                {name && row.contact_number && (
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {row.contact_number}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {outcomeLabel(row.outcome)}
                  </span>
                  {row.notes && <> · {row.notes}</>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {due && (
                  <div className="text-right text-xs">
                    <p className="text-foreground">{format(due, "MMM d · p")}</p>
                    <p className="text-muted-foreground">
                      {formatDistanceToNow(due, { addSuffix: true })}
                    </p>
                  </div>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={clearing === row.id}
                  onClick={() => onDone(row)}
                  className="cursor-pointer"
                >
                  <Check className="h-4 w-4" />
                  {clearing === row.id ? "Saving…" : "Done"}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
