"use client"

import { useEffect, useState } from "react"
import { Mic, MicOff, PhoneOff } from "lucide-react"
import {
  IDLE_STATE,
  isPanelEvent,
  PANEL_SOURCE,
  type SerializedCallState,
} from "@/lib/panel-bus"
import { IncomingCallPopup } from "@/components/calls/ui/incoming-call-popup"
import type { PhoneNumber } from "@/types/calls"

function send(cmd: Record<string, unknown>) {
  window.parent.postMessage({ source: PANEL_SOURCE, type: "cmd", ...cmd }, "*")
}

function useDuration(startedAt: number | null): string {
  const [, tick] = useState(0)
  useEffect(() => {
    if (startedAt === null) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  if (startedAt === null) return "0:00"
  const s = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

/**
 * Compact "answer from any tab" widget. One-phone rule: never opens WebRTC —
 * renders state-sync from the offscreen engine and sends commands back.
 * phoneNumbers is unused today but kept for parity with the other panel modes
 * and future click-to-dial from the widget.
 */
export function WidgetPhone(_props: { phoneNumbers: PhoneNumber[] }) {
  const [state, setState] = useState<SerializedCallState>(IDLE_STATE)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin && !event.origin.startsWith("chrome-extension://")) return
      const msg = event.data
      if (!isPanelEvent(msg)) return
      if (msg.type === "state-sync") setState(msg.state)
    }
    window.addEventListener("message", onMessage)
    send({ cmd: "request-state" })
    return () => window.removeEventListener("message", onMessage)
  }, [])

  const duration = useDuration(state.status === "active" ? state.startedAt : null)
  const inCall = state.status !== "idle" && state.status !== "incoming"

  if (state.status === "idle") return null

  if (state.status === "incoming") {
    return (
      <IncomingCallPopup
        callerNumber={state.callerNumber ?? "Unknown"}
        companyLabel={state.companyLabel}
        companyNumber={state.companyNumber}
        busy={false}
        onAnswer={() => send({ cmd: "answer" })}
        onReject={() => send({ cmd: "decline" })}
      />
    )
  }

  if (!inCall) return null

  return (
    <div className="fixed right-6 bottom-6 z-50 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tabular-nums">
          {state.remoteNumber ?? "Unknown"}
        </span>
        <span className="text-xs font-medium text-green-600 tabular-nums dark:text-green-400">
          {duration}
        </span>
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button
          onClick={() => send({ cmd: state.muted ? "unmute" : "mute" })}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium transition hover:bg-muted"
        >
          {state.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {state.muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={() => send({ cmd: "hangup" })}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
        >
          <PhoneOff className="h-4 w-4" />
          Hang Up
        </button>
      </div>
    </div>
  )
}
