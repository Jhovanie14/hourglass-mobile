"use client"

import { formatDuration } from "@/lib/format-duration"
import { cn } from "@/lib/utils"
import type { CallStats } from "@/types/calls"

function StatBox({
  label,
  value,
  accent,
}: {
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3">
      <p
        className={cn(
          "text-2xl font-bold tabular-nums",
          accent ? "text-destructive" : "text-foreground"
        )}
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

export function CallsStats({ stats }: { stats: CallStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatBox label="Total Calls" value={String(stats.total)} />
      <StatBox label="Answered" value={String(stats.answered)} />
      <StatBox label="Missed" value={String(stats.missed)} accent />
      <StatBox
        label="Avg Duration"
        value={
          stats.answered > 0 ? formatDuration(stats.avgDurationSeconds) : "—"
        }
      />
    </div>
  )
}
