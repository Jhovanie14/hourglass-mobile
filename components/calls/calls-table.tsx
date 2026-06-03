"use client"

import { Fragment, useState } from "react"
import { useRouter } from "next/navigation"
import { format, formatDistanceToNow } from "date-fns"
import {
  ArrowDownLeft,
  ArrowUpRight,
  MessageSquare,
  Phone,
  PhoneMissed,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatDuration } from "@/lib/format-duration"
import type { Call, StatusFilter } from "@/types/calls"

const STATUS_STYLES: Record<string, string> = {
  answered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  missed: "bg-destructive/15 text-destructive",
  initiated: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  declined: "bg-muted text-muted-foreground",
  failed: "bg-muted text-muted-foreground",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {status}
    </span>
  )
}

function DirectionIcon({ direction }: { direction: string }) {
  return direction === "inbound" ? (
    <ArrowDownLeft className="h-4 w-4 text-emerald-500" aria-label="Inbound" />
  ) : (
    <ArrowUpRight className="h-4 w-4 text-blue-500" aria-label="Outbound" />
  )
}

function isMissed(call: Call) {
  return call.status === "missed"
}

function durationCell(call: Call) {
  if (call.status === "missed" || call.status === "failed") return "—"
  return formatDuration(call.duration_seconds)
}

export function CallsTable({
  calls,
  loading,
  statusFilter,
  dateFilter,
}: {
  calls: Call[]
  loading?: boolean
  statusFilter: StatusFilter
  dateFilter: string
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<string | null>(null)

  function goToSms(call: Call) {
    router.push(
      `/dashboard/conversations?contact=${encodeURIComponent(
        call.contact_number
      )}&inbox=${call.phone_number_id}`
    )
  }

  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Contact</TableHead>
              <TableHead className="hidden md:table-cell">Inbox</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Duration</TableHead>
              <TableHead className="hidden lg:table-cell">Date &amp; Time</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-12" /></TableCell>
                <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (calls.length === 0) {
    let subtext = "Try adjusting your filters"
    if (statusFilter === "missed") subtext = "No missed calls. You're all caught up!"
    else if (dateFilter === "today") subtext = "No calls today yet"

    return (
      <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 py-20 text-center">
        <PhoneMissed className="mb-1 h-10 w-10 text-muted-foreground/40" />
        <p className="text-base font-medium text-foreground">No calls found</p>
        <p className="text-sm text-muted-foreground">{subtext}</p>
      </div>
    )
  }

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-hidden rounded-xl border border-border/60 sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Contact</TableHead>
              <TableHead className="hidden md:table-cell">Inbox</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Duration</TableHead>
              <TableHead className="hidden lg:table-cell">Date &amp; Time</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((call) => {
              const open = expanded === call.id
              const missed = isMissed(call)
              return (
                <Fragment key={call.id}>
                  <TableRow
                    onClick={() => setExpanded(open ? null : call.id)}
                    className={cn(
                      "cursor-pointer",
                      missed && "bg-destructive/5 hover:bg-destructive/10"
                    )}
                  >
                    <TableCell>
                      <DirectionIcon direction={call.direction} />
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {call.contact_number}
                      </div>
                      {call.phone_numbers && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: call.phone_numbers.color }}
                          />
                          {call.phone_numbers.label}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {call.phone_numbers && (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                          style={{ backgroundColor: call.phone_numbers.color }}
                        >
                          {call.phone_numbers.label}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={call.status} />
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {durationCell(call)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="text-sm text-foreground">
                        {format(new Date(call.created_at), "MMM d, yyyy · p")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(call.created_at), {
                          addSuffix: true,
                        })}
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled
                              aria-label="Call back"
                            >
                              <Phone className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Voice calling coming soon</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => goToSms(call)}
                              aria-label="Send SMS"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Send SMS</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>

                  {open && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={7}>
                        <dl className="grid gap-x-8 gap-y-1.5 px-2 py-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
                          <DetailRow label="Telnyx Call ID" value={call.telnyx_call_id ?? "—"} mono />
                          <DetailRow
                            label="Started"
                            value={
                              call.started_at
                                ? format(new Date(call.started_at), "PPpp")
                                : "—"
                            }
                          />
                          <DetailRow
                            label="Ended"
                            value={
                              call.ended_at
                                ? format(new Date(call.ended_at), "PPpp")
                                : "—"
                            }
                          />
                          <DetailRow label="Agent" value="—" />
                        </dl>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="space-y-3 sm:hidden">
        {calls.map((call) => {
          const missed = isMissed(call)
          return (
            <div
              key={call.id}
              className={cn(
                "rounded-xl border border-border/60 bg-card p-3",
                missed && "border-destructive/30 bg-destructive/5"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <DirectionIcon direction={call.direction} />
                  <div>
                    <p className="font-medium text-foreground">
                      {call.contact_number}
                    </p>
                    {call.phone_numbers && (
                      <span
                        className="mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                        style={{ backgroundColor: call.phone_numbers.color }}
                      >
                        {call.phone_numbers.label}
                      </span>
                    )}
                  </div>
                </div>
                <StatusBadge status={call.status} />
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{format(new Date(call.created_at), "MMM d · p")}</span>
                <span className="tabular-nums">{durationCell(call)}</span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  className="flex-1"
                >
                  <Phone className="h-4 w-4" /> Call back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToSms(call)}
                  className="flex-1 cursor-pointer"
                >
                  <MessageSquare className="h-4 w-4" /> SMS
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-foreground", mono && "font-mono break-all")}>
        {value}
      </dd>
    </div>
  )
}
