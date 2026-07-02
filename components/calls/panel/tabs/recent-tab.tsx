"use client"

import { ArrowDownLeft, ArrowUpRight, Phone } from "lucide-react"
import type { SerializedCallState } from "@/lib/panel-bus"
import type { PhoneNumber } from "@/types/calls"
import { send } from "../panel-send"
import { formatRecentRow } from "../recent-row"
import { useRecentCalls } from "../use-recent-calls"

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
    <ul className="divide-y divide-neutral-900">
      {calls.map((call) => {
        const row = formatRecentRow(call)
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
            <button
              type="button"
              aria-label={`Call ${row.title}`}
              disabled={!canDial || !defaultCallerId || !row.callbackTo}
              onClick={() =>
                defaultCallerId &&
                send({ cmd: "dial", to: row.callbackTo, callerId: defaultCallerId })
              }
              className="rounded-full bg-green-500 p-2 text-white transition hover:bg-green-600 disabled:opacity-40"
            >
              <Phone className="h-4 w-4" />
            </button>
          </li>
        )
      })}
    </ul>
  )
}
