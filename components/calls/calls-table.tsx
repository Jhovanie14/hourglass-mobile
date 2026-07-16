"use client"

import { Fragment, useMemo, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { format, formatDistanceToNow } from "date-fns"
import {
  ArrowDownLeft,
  ArrowUpRight,
  MessageSquare,
  Mic,
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
import { createClient } from "@/lib/client"
import { useWebRTC } from "@/components/calls/webrtc-provider"
import { TranscriptView } from "@/components/calls/transcript-view"
import type { Call, StatusFilter, Voicemail } from "@/types/calls"

const STATUS_STYLES: Record<string, string> = {
  answered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  missed: "bg-destructive/15 text-destructive",
  voicemail: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
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

function VoicemailPlayer({ callId }: { callId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [voicemail, setVoicemail] = useState<Voicemail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const { data } = await supabase
          .from("voicemails")
          .select("id, call_id, recording_url, duration_seconds, is_heard, created_at")
          .eq("call_id", callId)
          .maybeSingle()
        setVoicemail(data as Voicemail | null)
        if (data && !data.is_heard) {
          supabase.from("voicemails").update({ is_heard: true }).eq("call_id", callId)
        }
      } catch (err) {
        console.error("Failed to fetch voicemail:", err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [callId, supabase])

  if (loading) return <Skeleton className="h-8 w-full max-w-sm" />
  if (!voicemail) return <span className="text-xs text-muted-foreground">No recording found</span>

  return (
    <div className="flex items-center gap-3">
      <Mic className="h-4 w-4 shrink-0 text-purple-500" />
      <audio controls className="h-8 flex-1 max-w-sm" src={`/api/voicemails/${voicemail.id}/audio`} />
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatDuration(voicemail.duration_seconds)}
      </span>
    </div>
  )
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
  const { makeCall, isReady } = useWebRTC()

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
                      <div className="flex items-center gap-1">
                        <DirectionIcon direction={call.direction} />
                        {call.has_voicemail && (
                          <Mic className="h-3 w-3 text-purple-500" />
                        )}
                      </div>
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
                              disabled={!isReady || !call.phone_numbers}
                              onClick={() => call.phone_numbers && makeCall(call.contact_number, call.phone_numbers)}
                              aria-label="Call back"
                            >
                              <Phone className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Call back</TooltipContent>
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
                        <div className="px-2 py-2 space-y-3">
                          {call.has_voicemail && (
                            <div>
                              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Voicemail
                              </p>
                              <VoicemailPlayer callId={call.id} />
                            </div>
                          )}
                          {call.has_transcript && (
                            <div>
                              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Transcript
                              </p>
                              <TranscriptView
                                callId={call.id}
                                contactNumber={call.contact_number}
                              />
                            </div>
                          )}
                          <dl className="grid gap-x-8 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                            <DetailRow label="Telnyx Call ID" value={call.telnyx_call_id?.slice(0, 24) ?? "—"} mono />
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
                        </div>
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
                <div className="flex items-center gap-1.5">
                  {call.has_voicemail && (
                    <Mic className="h-3.5 w-3.5 text-purple-500" />
                  )}
                  <StatusBadge status={call.status} />
                </div>
              </div>

              {call.has_voicemail && (
                <div className="mt-2">
                  <VoicemailPlayer callId={call.id} />
                </div>
              )}
              {call.has_transcript && (
                <div className="mt-2">
                  <TranscriptView callId={call.id} contactNumber={call.contact_number} />
                </div>
              )}

              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{format(new Date(call.created_at), "MMM d · p")}</span>
                <span className="tabular-nums">{durationCell(call)}</span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isReady || !call.phone_numbers}
                  onClick={() => call.phone_numbers && makeCall(call.contact_number, call.phone_numbers)}
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
