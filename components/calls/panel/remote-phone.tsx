"use client"

import { useEffect, useState } from "react"
import { LogOut, Phone } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  IDLE_STATE,
  isPanelEvent,
  PANEL_SOURCE,
  type PanelCommand,
  type SerializedCallState,
} from "@/lib/panel-bus"
import { IncomingCallPopup } from "@/components/calls/ui/incoming-call-popup"
import { ActiveCallHud } from "@/components/calls/ui/active-call-hud"
import type { PhoneNumber } from "@/types/calls"

type CmdPayload = PanelCommand extends infer U
  ? U extends { source: unknown; type: unknown }
    ? Omit<U, "source" | "type">
    : never
  : never

function send(cmd: CmdPayload) {
  window.parent.postMessage(
    { source: PANEL_SOURCE, type: "cmd", ...cmd },
    "*"
  )
}

function useRemoteDuration(startedAt: number | null): string {
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
 * Remote control for the background phone (one-phone rule: this component
 * never opens a WebRTC connection). State arrives as `state-sync` events
 * relayed by the extension; user actions leave as PanelCommands.
 */
export function RemotePhone({
  phoneNumbers,
  onSignOut,
}: {
  phoneNumbers: PhoneNumber[]
  onSignOut: () => void
}) {
  const [state, setState] = useState<SerializedCallState>(IDLE_STATE)
  const [to, setTo] = useState("")
  const [phoneNumberId, setPhoneNumberId] = useState("")
  const [speakText, setSpeakText] = useState("")

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data
      if (!isPanelEvent(msg)) return
      if (msg.type === "state-sync") setState(msg.state)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  const duration = useRemoteDuration(
    state.status === "active" ? state.startedAt : null
  )

  const selectedId = phoneNumberId || phoneNumbers[0]?.id || ""
  const selectedPhone = phoneNumbers.find((p) => p.id === selectedId)

  function handleCall() {
    if (!to.trim() || !selectedPhone) return
    send({ cmd: "dial", to: to.trim(), callerId: selectedPhone.phone_number })
  }

  const inCall = state.status !== "idle" && state.status !== "incoming"

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-foreground">Call Panel</h1>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onSignOut}
          aria-label="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>

      {/* Presence — mirrors the background phone's online flag */}
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
        <span className="text-sm font-medium">
          {state.online ? "Online — receiving calls" : "Offline"}
        </span>
        <Switch
          checked={state.online}
          onCheckedChange={(next) => send({ cmd: "set-online", online: next })}
          aria-label="Toggle availability"
        />
      </div>

      {state.micBlocked && (
        <button
          type="button"
          onClick={() =>
            navigator.mediaDevices
              .getUserMedia({ audio: true })
              .then((s) => s.getTracks().forEach((t) => t.stop()))
              .catch(() => {})
          }
          className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-left text-sm text-destructive"
        >
          Microphone blocked — click to grant access
        </button>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-from" className="text-sm font-medium">
          From
        </label>
        <select
          id="panel-from"
          value={selectedId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          className="border-input bg-background text-foreground flex h-9 w-full rounded-md border px-3 py-1 text-sm shadow-xs focus:outline-none focus:ring-1 focus:ring-ring"
        >
          {phoneNumbers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.phone_number}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-to" className="text-sm font-medium">
          To
        </label>
        <Input
          id="panel-to"
          placeholder="+1 (555) 000-0000"
          type="tel"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCall()}
        />
      </div>

      <Button
        className="w-full gap-1.5"
        onClick={handleCall}
        disabled={!state.isReady || inCall || !to.trim() || !selectedPhone}
      >
        <Phone className="h-4 w-4" />
        {!state.isReady ? "Connecting…" : "Call"}
      </Button>

      {state.status === "incoming" && (
        <IncomingCallPopup
          callerNumber={state.callerNumber ?? "Unknown"}
          companyLabel={state.companyLabel}
          companyNumber={state.companyNumber}
          busy={false}
          onAnswer={() => send({ cmd: "answer" })}
          onReject={() => send({ cmd: "decline" })}
        />
      )}

      {inCall && (
        <ActiveCallHud
          callState={state.status}
          duration={duration}
          remoteNumber={state.remoteNumber ?? "Unknown"}
          muted={state.muted}
          speakText={speakText}
          speaking={false}
          onHangup={() => send({ cmd: "hangup" })}
          onToggleMute={() => send({ cmd: state.muted ? "unmute" : "mute" })}
          onSpeakTextChange={setSpeakText}
          onSpeak={() => {
            if (speakText.trim()) {
              send({ cmd: "speak", text: speakText.trim() })
              setSpeakText("")
            }
          }}
          onDtmf={(digit) => send({ cmd: "dtmf", digit })}
        />
      )}
    </div>
  )
}
