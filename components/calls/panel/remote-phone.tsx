"use client"

import { useEffect, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
  IDLE_STATE,
  isPanelEvent,
  type SerializedCallState,
} from "@/lib/panel-bus"
import { IncomingCallPopup } from "@/components/calls/ui/incoming-call-popup"
import { ActiveCallHud } from "@/components/calls/ui/active-call-hud"
import type { PhoneNumber } from "@/types/calls"
import { send } from "./panel-send"
import { PanelTabs, type PanelTab } from "./panel-tabs"
import { DialpadTab } from "./tabs/dialpad-tab"
import { MessagesTab } from "./tabs/messages-tab"
import { RecentTab } from "./tabs/recent-tab"
import { SettingsTab } from "./tabs/settings-tab"

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
 * Dark, tabbed remote control for the background phone (one-phone rule: never
 * opens WebRTC). Owns the state-sync subscription, the active tab, the dial
 * inputs, and the call overlays; tabs render inside.
 */
export function RemotePhone({
  supabase,
  phoneNumbers,
  accessToken,
  onSignOut,
}: {
  /** The panel's authenticated client — reused so Messages shares one session
   *  and one Realtime connection rather than opening a second. */
  supabase: SupabaseClient
  phoneNumbers: PhoneNumber[]
  accessToken: string | undefined
  onSignOut: () => void
}) {
  const [state, setState] = useState<SerializedCallState>(IDLE_STATE)
  const [tab, setTab] = useState<PanelTab>("dialpad")
  const [to, setTo] = useState("")
  const [phoneNumberId, setPhoneNumberId] = useState("")
  const [speakText, setSpeakText] = useState("")
  const [messagesUnread, setMessagesUnread] = useState(0)

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

  const duration = useRemoteDuration(
    state.status === "active" ? state.startedAt : null
  )
  const inCall = state.status !== "idle" && state.status !== "incoming"

  function handleCallback(number: string) {
    setTo(number)
    setTab("dialpad")
  }

  return (
    <div className="flex h-full min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <div className="flex items-center justify-between px-4 py-3">
        <h1 className="text-sm font-semibold">Call Panel</h1>
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            state.online ? "bg-green-500" : "bg-neutral-600"
          }`}
          aria-label={state.online ? "Online" : "Offline"}
        />
      </div>

      <PanelTabs
        active={tab}
        onChange={setTab}
        badges={{ messages: messagesUnread }}
      />

      <div className="flex-1 overflow-y-auto">
        {tab === "dialpad" && (
          <DialpadTab
            phoneNumbers={phoneNumbers}
            state={state}
            to={to}
            setTo={setTo}
            phoneNumberId={phoneNumberId}
            setPhoneNumberId={setPhoneNumberId}
          />
        )}
        {tab === "recent" && (
          <RecentTab
            accessToken={accessToken}
            phoneNumbers={phoneNumbers}
            state={state}
            onCallback={handleCallback}
          />
        )}
        {tab === "messages" && (
          <MessagesTab
            supabase={supabase}
            phoneNumbers={phoneNumbers}
            accessToken={accessToken}
            onUnreadChange={setMessagesUnread}
          />
        )}
        {tab === "settings" && (
          <SettingsTab state={state} onSignOut={onSignOut} />
        )}
      </div>

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
