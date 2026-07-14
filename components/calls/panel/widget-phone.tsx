"use client"

import { useEffect, useState } from "react"
import {
  IDLE_STATE,
  isPanelEvent,
  PANEL_SOURCE,
  type SerializedCallState,
} from "@/lib/panel-bus"
import { IncomingCallPopup } from "@/components/calls/ui/incoming-call-popup"
import { InCallCard } from "@/components/calls/ui/in-call-card"
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
    <InCallCard
      remoteNumber={state.remoteNumber ?? "Unknown"}
      duration={duration}
      muted={state.muted}
      onToggleMute={() => send({ cmd: state.muted ? "unmute" : "mute" })}
      onHangup={() => send({ cmd: "hangup" })}
    />
  )
}
