"use client"

import { useCallback, useRef, useState } from "react"
import type { Call as TelnyxCall } from "@telnyx/webrtc"
import { useRingtone } from "./use-ringtone"
import { useDuration } from "./use-duration"
import { useInboundPhoneLookup } from "./use-inbound-phone"
import { useWebRTCClient } from "./use-webrtc-client"
import type { PhoneNumber } from "@/types/calls"

/**
 * The customer's number for an inbound ring-all leg, carried in the
 * X-Caller-Number custom SIP header (dialAgentLeg sets it; the leg's standard
 * caller fields hold the owned DID, not the customer). Returns null when
 * absent (e.g. outbound legs), so callers can fall back.
 */
function callerFromHeader(call: TelnyxCall | null): string | null {
  const headers = (call?.options as any)?.customHeaders as
    | Array<{ name?: string; value?: string }>
    | undefined
  const match = headers?.find((h) => h.name?.toLowerCase() === "x-caller-number")
  return match?.value ?? null
}

/**
 * The whole agent phone as a headless hook: WebRTC registration, inbound
 * ring, outbound dialing, call actions, presence. Owns NO UI. WebRTCProvider
 * renders the dashboard UI on top of it; BackgroundPhone (extension) bridges
 * it over postMessage.
 */
export function usePhone() {
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  // Manual availability. Default Online each session (non-sticky).
  const [online, setOnline] = useState(true)

  const [incomingCall, setIncomingCall] = useState<TelnyxCall | null>(null)
  const [activeCall, setActiveCall] = useState<TelnyxCall | null>(null)
  const [callState, setCallState] = useState("")
  const [muted, setMuted] = useState(false)
  const [speakText, setSpeakText] = useState("")
  const [speaking, setSpeaking] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)

  const [inboundPhoneNumber, setInboundPhoneNumber] = useState<{
    label: string
    phone_number: string
  } | null>(null)

  const activeCallRef = useRef<TelnyxCall | null>(null)
  activeCallRef.current = activeCall
  const startedAtRef = useRef<number | null>(null)

  const { start: startRing, stop: stopRing } = useRingtone("ring")
  const duration = useDuration(callState === "active")
  const lookupInboundPhone = useInboundPhoneLookup()

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
        startedAtRef.current = null
        stopRing()
        if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
        return
      }

      // Skip "new" — direction not yet known
      if (state === "new") return

      // Inbound ringing
      if (state === "ringing" && (call as any).direction !== "outbound") {
        if (activeCallRef.current) return
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
        if (startedAtRef.current === null) startedAtRef.current = Date.now()
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

  const handleSpeak = useCallback(async () => {
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
  }, [activeCall, speakText, speaking])

  // Who is calling — see callerFromHeader above.
  const callerNumber = callerFromHeader(incomingCall) ?? "Unknown"

  const activeNumber =
    callerFromHeader(activeCall) ??
    (activeCall?.options as any)?.remoteCallerNumber ??
    (activeCall?.options as any)?.destinationNumber ??
    "Unknown"

  const direction: "inbound" | "outbound" | null = activeCall
    ? ((activeCall as any).direction === "outbound" ? "outbound" : "inbound")
    : incomingCall
      ? "inbound"
      : null

  return {
    remoteAudioRef,
    isReady,
    online,
    setOnline,
    incomingCall,
    activeCall,
    callState,
    direction,
    muted,
    duration,
    startedAtRef,
    callerNumber,
    activeNumber,
    inboundPhoneNumber,
    speakText,
    setSpeakText,
    speaking,
    actionBusy,
    makeCall,
    handleAnswer,
    handleReject,
    handleHangup,
    toggleMute,
    handleDtmf,
    handleSpeak,
  }
}
