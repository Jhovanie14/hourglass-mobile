// components/calls/webrtc-provider.tsx
"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import type { Call as TelnyxCall } from "@telnyx/webrtc"
import { useRingtone } from "./hooks/use-ringtone"
import { useDuration } from "./hooks/use-duration"
import { useInboundPhoneLookup } from "./hooks/use-inbound-phone"
import { useWebRTCClient } from "./hooks/use-webrtc-client"
import { IncomingCallPopup } from "./ui/incoming-call-popup"
import { ActiveCallHud } from "./ui/active-call-hud"
import type { PhoneNumber } from "@/types/calls"

// ─── Context ────────────────────────────────────────────────────────────────

type WebRTCContextType = {
  isReady: boolean
  makeCall: (to: string, phoneNumber: PhoneNumber) => Promise<void>
  online: boolean
  setOnline: (next: boolean) => void
}

const WebRTCContext = createContext<WebRTCContextType>({
  isReady: false,
  makeCall: async () => {},
  online: true,
  setOnline: () => {},
})

export function useWebRTC() {
  return useContext(WebRTCContext)
}

/**
 * The customer's number for an inbound ring-all leg, carried in the
 * X-Caller-Number custom SIP header (dialAgentLeg sets it; the leg's standard
 * caller fields hold the owned DID, not the customer). Returns null when absent
 * (e.g. outbound legs), so callers can fall back.
 */
function callerFromHeader(call: TelnyxCall | null): string | null {
  const headers = (call?.options as any)?.customHeaders as
    | Array<{ name?: string; value?: string }>
    | undefined
  const match = headers?.find((h) => h.name?.toLowerCase() === "x-caller-number")
  return match?.value ?? null
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  // Manual availability. Default Online each session (non-sticky).
  const [online, setOnline] = useState(true)

  // Call UI state
  const [incomingCall, setIncomingCall] = useState<TelnyxCall | null>(null)
  const [activeCall, setActiveCall] = useState<TelnyxCall | null>(null)
  const [callState, setCallState] = useState("")
  const [muted, setMuted] = useState(false)
  const [speakText, setSpeakText] = useState("")
  const [speaking, setSpeaking] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  // Company label for the incoming popup (fetched during insertInbound)
  const [inboundPhoneNumber, setInboundPhoneNumber] = useState<{
    label: string
    phone_number: string
  } | null>(null)

  // Stable ref to activeCall for use inside notification callback
  const activeCallRef = useRef<TelnyxCall | null>(null)
  activeCallRef.current = activeCall

  const { start: startRing, stop: stopRing } = useRingtone()
  const duration = useDuration(callState === "active")
  const lookupInboundPhone = useInboundPhoneLookup()

  // ── Notification handler (passed to useWebRTCClient) ──────────────────────

  const handleNotification = useCallback(
    (notification: { type: string; call?: TelnyxCall }) => {
      if (notification.type !== "callUpdate") return
      const call = notification.call
      if (!call) return
      const state = call.state as string
      const isTerminated = state === "hangup" || state === "destroy" || state === "purge"

      if (isTerminated) {
        // Call records are written server-side by the Telnyx voice webhook.
        setInboundPhoneNumber(null)
        setActiveCall(null)
        setIncomingCall(null)
        setCallState("")
        setMuted(false)
        setSpeakText("")
        stopRing()
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
        return
      }

      // Skip "new" — direction not yet known
      if (state === "new") return

      // Inbound ringing
      if (state === "ringing" && (call as any).direction !== "outbound") {
        if (activeCallRef.current) return
        // TEMP DIAGNOSTIC — remove after confirming X-Caller-Number arrives on a live call
        console.log("🔎 inbound call.options:", {
          remoteCallerName: (call.options as any)?.remoteCallerName,
          remoteCallerNumber: (call.options as any)?.remoteCallerNumber,
          destinationNumber: (call.options as any)?.destinationNumber,
          customHeaders: (call.options as any)?.customHeaders,
        })
        // Ring-all dials the agent leg with `from` = the owned DID the customer
        // dialed, so the called number arrives as remoteCallerNumber (the SIP
        // destination is just this agent's credential). Fall back to
        // destinationNumber for any non-ring-all leg.
        const dialedDid =
          (call.options as any)?.remoteCallerNumber ??
          (call.options as any)?.destinationNumber ??
          ""
        lookupInboundPhone(dialedDid).then((phoneNumber) => {
          if (phoneNumber) setInboundPhoneNumber(phoneNumber)
        })
        setIncomingCall(call)
        startRing()
        return
      }

      // Call became active (answered by either side)
      if (state === "active") {
        stopRing()
        setMuted(false)
        if (remoteAudioRef.current && (call as any).remoteStream) {
          remoteAudioRef.current.srcObject = (call as any).remoteStream
          remoteAudioRef.current.play().catch(() => {})
        }
      }

      setActiveCall(call)
      setCallState(state)
      setIncomingCall(null)
    },
    [startRing, stopRing, lookupInboundPhone]
  )

  const { isReady, newCall } = useWebRTCClient(
    remoteAudioRef,
    handleNotification,
    online
  )

  // ── makeCall ──────────────────────────────────────────────────────────────

  const makeCall = useCallback(
    async (to: string, phoneNumber: PhoneNumber) => {
      const call = newCall(to, phoneNumber.phone_number)
      if (call) {
        setActiveCall(call)
        setCallState("trying")
      }
    },
    [newCall]
  )

  // ── Call actions ──────────────────────────────────────────────────────────

  const handleAnswer = useCallback(async () => {
    if (!incomingCall || actionBusy) return
    setActionBusy(true)
    stopRing()
    await incomingCall.answer()
    setActionBusy(false)
  }, [incomingCall, actionBusy, stopRing])

  const handleReject = useCallback(async () => {
    if (!incomingCall || actionBusy) return
    setActionBusy(true)
    stopRing()
    // Rejecting here just drops this agent's leg; the webhook records the call
    // (missed/voicemail) based on what happens to the caller leg.
    await incomingCall.hangup()
    setIncomingCall(null)
    setInboundPhoneNumber(null)
    setActionBusy(false)
  }, [incomingCall, actionBusy, stopRing])

  const handleHangup = useCallback(async () => {
    await activeCall?.hangup()
  }, [activeCall])

  const toggleMute = useCallback(() => {
    if (!activeCall) return
    if (muted) {
      activeCall.unmuteAudio()
    } else {
      activeCall.muteAudio()
    }
    setMuted((m) => !m)
  }, [activeCall, muted])

  const handleDtmf = useCallback((digit: string) => {
    activeCall?.dtmf(digit)
  }, [activeCall])

  async function handleSpeak() {
    if (!activeCall || !speakText.trim() || speaking) return
    const callControlId = (activeCall as any).telnyxIDs?.telnyxCallControlId
    if (!callControlId) return
    setSpeaking(true)
    await fetch("/api/calls/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_control_id: callControlId, text: speakText.trim() }),
    })
    setSpeaking(false)
    setSpeakText("")
  }

  // Who is calling. Ring-all dials the agent leg `from` = the owned DID, so the
  // SIP caller fields (remoteCallerName/Number) all carry the DID — Telnyx does
  // not pass the customer through. The real caller rides in the X-Caller-Number
  // custom SIP header (set in dialAgentLeg). Outbound legs have no such header.
  const callerNumber = callerFromHeader(incomingCall) ?? "Unknown"

  const activeNumber =
    callerFromHeader(activeCall) ??
    (activeCall?.options as any)?.remoteCallerNumber ??
    (activeCall?.options as any)?.destinationNumber ??
    "Unknown"

  // Bridge call events to the extension shell when embedded in the side panel.
  const embedded =
    typeof window !== "undefined" && window.parent !== window

  useEffect(() => {
    if (!embedded) return
    if (incomingCall && !activeCall) {
      window.parent.postMessage(
        {
          source: "hourglass-panel",
          type: "incoming",
          caller: callerNumber,
          label: inboundPhoneNumber?.label ?? null,
        },
        "*"
      )
    }
  }, [embedded, incomingCall, activeCall, callerNumber, inboundPhoneNumber])

  // Only emit call-ended after a call has actually been active (avoids a
  // spurious event on mount). targetOrigin "*" is safe: the payload carries
  // no secrets and the receiver validates event.origin.
  const everActiveRef = useRef(false)
  useEffect(() => {
    if (!embedded) return
    if (activeCall) {
      everActiveRef.current = true
      window.parent.postMessage(
        { source: "hourglass-panel", type: "call-active" },
        "*"
      )
    } else if (everActiveRef.current) {
      everActiveRef.current = false
      window.parent.postMessage(
        { source: "hourglass-panel", type: "call-ended" },
        "*"
      )
    }
  }, [embedded, activeCall])

  return (
    <WebRTCContext.Provider value={{ isReady, makeCall, online, setOnline }}>
      {children}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={remoteAudioRef} autoPlay hidden />

      {incomingCall && !activeCall && (
        <IncomingCallPopup
          callerNumber={callerNumber}
          companyLabel={inboundPhoneNumber?.label ?? null}
          companyNumber={inboundPhoneNumber?.phone_number ?? null}
          busy={actionBusy}
          onAnswer={handleAnswer}
          onReject={handleReject}
        />
      )}

      {activeCall && (
        <ActiveCallHud
          callState={callState}
          duration={duration}
          remoteNumber={activeNumber}
          muted={muted}
          speakText={speakText}
          speaking={speaking}
          onHangup={handleHangup}
          onToggleMute={toggleMute}
          onSpeakTextChange={setSpeakText}
          onSpeak={handleSpeak}
          onDtmf={handleDtmf}
        />
      )}
    </WebRTCContext.Provider>
  )
}
