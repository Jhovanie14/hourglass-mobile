"use client"

import { useState } from "react"
import { ArrowDownLeft, ArrowUpRight, Phone, StickyNote, UserPlus } from "lucide-react"
import type { SerializedCallState } from "@/lib/panel-bus"
import type { PhoneNumber } from "@/types/calls"
import { NotesSheet } from "@/components/calls/notes-sheet"
import { ContactSheet } from "@/components/calls/contact-sheet"
import { useDispositions } from "@/components/calls/use-dispositions"
import { send } from "../panel-send"
import { formatRecentRow, type RecentCall, type StatusTone } from "../recent-row"
import { useRecentCalls } from "../use-recent-calls"

const TONE_CLASS: Record<StatusTone, string> = {
  good: "bg-green-500/10 text-green-400",
  bad: "bg-red-500/10 text-red-400",
  warn: "bg-amber-500/10 text-amber-400",
  info: "bg-sky-500/10 text-sky-400",
  neutral: "bg-neutral-800 text-neutral-400",
}

export function RecentTab({
  accessToken,
  phoneNumbers,
  state,
  onCallback,
}: {
  accessToken: string | undefined
  phoneNumbers: PhoneNumber[]
  state: SerializedCallState
  onCallback: (to: string) => void
}) {
  const { calls, loading, error, reload } = useRecentCalls(accessToken)
  const [notesFor, setNotesFor] = useState<RecentCall | null>(null)
  const [contactFor, setContactFor] = useState<RecentCall | null>(null)
  const { map: dispoMap, setLocal } = useDispositions(
    calls.map((c) => c.telnyx_call_id)
  )
  const inCall = state.status !== "idle" && state.status !== "incoming"
  const canDial = state.isReady && !inCall
  const defaultCallerId = phoneNumbers[0]?.phone_number

  if (loading) {
    return <div className="p-4 text-sm text-neutral-500">Loading recent calls…</div>
  }

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-sm">
        <span className="text-neutral-400">Couldn&apos;t load recent calls.</span>
        <button
          type="button"
          onClick={reload}
          className="rounded-md border border-neutral-700 px-3 py-1.5 text-neutral-200 hover:bg-neutral-900"
        >
          Retry
        </button>
      </div>
    )
  }

  if (calls.length === 0) {
    return <div className="p-4 text-sm text-neutral-500">No recent calls yet.</div>
  }

  return (
    <>
      <ul className="divide-y divide-neutral-900">
      {calls.map((call) => {
        const row = formatRecentRow(call)
        // Prefer the line the call came in on (multi-brand callback); fall back
        // to the default line for legacy rows without the join.
        const callerId = row.callbackFrom ?? defaultCallerId
        return (
          <li
            key={call.id}
            className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-900"
          >
            <button
              type="button"
              onClick={() => onCallback(row.callbackTo)}
              className="flex min-w-0 flex-1 items-center gap-3 text-left"
            >
              {row.directionIcon === "out" ? (
                <ArrowUpRight className="h-4 w-4 shrink-0 text-neutral-500" />
              ) : (
                <ArrowDownLeft
                  className={`h-4 w-4 shrink-0 ${row.missed ? "text-red-500" : "text-neutral-500"}`}
                />
              )}
              <span className="min-w-0">
                <span
                  className={`block truncate text-sm font-medium ${
                    row.missed ? "text-red-400" : "text-white"
                  }`}
                >
                  {row.title}
                </span>
                <span className="block truncate text-xs text-neutral-500">
                  {row.lineLabel ? `${row.lineLabel} · ` : ""}
                  {row.timeText}
                </span>
              </span>
            </button>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${TONE_CLASS[row.statusTone]}`}
            >
              {row.statusLabel}
            </span>
            <button
              type="button"
              aria-label={`Call ${row.title}`}
              disabled={!canDial || !callerId || !row.callbackTo}
              onClick={() =>
                callerId &&
                send({ cmd: "dial", to: row.callbackTo, callerId })
              }
              className="rounded-full bg-green-500 p-2 text-white transition hover:bg-green-600 disabled:opacity-40"
            >
              <Phone className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Notes"
              disabled={!call.telnyx_call_id}
              onClick={() => setNotesFor(call)}
              className="rounded-full p-2 text-neutral-300 transition hover:bg-neutral-800 disabled:opacity-40"
            >
              <StickyNote className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label="Add contact"
              onClick={() => setContactFor(call)}
              className="rounded-full p-2 text-neutral-300 transition hover:bg-neutral-800"
            >
              <UserPlus className="h-4 w-4" />
            </button>
          </li>
        )
      })}
      </ul>

      {notesFor?.telnyx_call_id && (
        <NotesSheet
          open={!!notesFor}
          onOpenChange={(o) => !o && setNotesFor(null)}
          call={{
            telnyxCallId: notesFor.telnyx_call_id,
            contactNumber: notesFor.contact_number,
            direction: notesFor.direction,
          }}
          existing={dispoMap[notesFor.telnyx_call_id] ?? null}
          onSaved={(d) => setLocal(d)}
        />
      )}
      {contactFor && (
        <ContactSheet
          open={!!contactFor}
          onOpenChange={(o) => !o && setContactFor(null)}
          contactNumber={contactFor.contact_number}
          phoneNumbers={phoneNumbers}
          existingName={contactFor.contact_name ?? null}
          accessToken={accessToken}
          onSaved={() => reload()}
        />
      )}
    </>
  )
}
