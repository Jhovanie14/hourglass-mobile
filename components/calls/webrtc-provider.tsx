// components/calls/webrtc-provider.tsx
"use client"

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react"
import type { Call as TelnyxCall } from "@telnyx/webrtc"
import { useRingtone } from "./hooks/use-ringtone"
import { useDuration } from "./hooks/use-duration"
import { useCallRecords } from "./hooks/use-call-records"
import { useWebRTCClient } from "./hooks/use-webrtc-client"
import { IncomingCallPopup } from "./ui/incoming-call-popup"
import { ActiveCallHud } from "./ui/active-call-hud"
import type { PhoneNumber } from "@/types/calls"

// ─── Context ────────────────────────────────────────────────────────────────

type WebRTCContextType = {
  isReady: boolean
  makeCall: (to: string, phoneNumber: PhoneNumber) => void
}

const WebRTCContext = createContext<WebRTCContextType>({
  isReady: false,
  makeCall: () => {},
})

export function useWebRTC() {
  return useContext(WebRTCContext)
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

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

  // DB tracking refs — not state because we don't need re-renders
  const activeCallIdRef = useRef<string | null>(null)
  const activeCallDirRef = useRef<"inbound" | "outbound" | null>(null)
  const callStartedAtRef = useRef<string | null>(null)
  const insertInboundPromiseRef = useRef<Promise<void> | null>(null)

  // Stable ref to activeCall for use inside notification callback
  const activeCallRef = useRef<TelnyxCall | null>(null)
  activeCallRef.current = activeCall

  const { start: startRing, stop: stopRing } = useRingtone()
  const duration = useDuration(callState === "active")
  const records = useCallRecords()

  // ── Notification handler (passed to useWebRTCClient) ──────────────────────

  const handleNotification = useCallback(
    (notification: { type: string; call?: TelnyxCall }) => {
      if (notification.type !== "callUpdate") return
      const call = notification.call
      if (!call) return
      const state = call.state as string
      const isTerminated = state === "hangup" || state === "destroy" || state === "purge"

      if (isTerminated) {
        // Await any in-flight insertInbound before reading the call ID
        const settle = async () => {
          if (insertInboundPromiseRef.current) {
            await insertInboundPromiseRef.current
            insertInboundPromiseRef.current = null
          }
          const id = activeCallIdRef.current
          const dir = activeCallDirRef.current
          const startedAt = callStartedAtRef.current
          if (id) {
            if (startedAt) {
              records.markCompleted(id, startedAt)
            } else if (dir === "inbound") {
              records.markMissed(id)
            } else {
              records.markFailed(id)
            }
          }
          // Reset all tracking
          activeCallIdRef.current = null
          activeCallDirRef.current = null
          callStartedAtRef.current = null
        }
        settle()
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
        const callerNumber =
          (call.options as any)?.remoteCallerNumber ??
          (call.options as any)?.destinationNumber ??
          "Unknown"
        const destination = (call.options as any)?.destinationNumber ?? ""
        const telnyxId = (call as any).telnyxIDs?.telnyxCallControlId as string | undefined
        insertInboundPromiseRef.current = records.insertInbound(callerNumber, destination, telnyxId).then((record) => {
          if (record) {
            activeCallIdRef.current = record.callId
            activeCallDirRef.current = "inbound"
            setInboundPhoneNumber(record.phoneNumber)
          }
        })
        setIncomingCall(call)
        startRing()
        return
      }

      // Call became active (answered by either side)
      if (state === "active") {
        const now = new Date().toISOString()
        callStartedAtRef.current = now
        if (activeCallIdRef.current) {
          records.markAnswered(activeCallIdRef.current, now)
        }
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
    [startRing, stopRing, records]
  )

  const { isReady, newCall } = useWebRTCClient(remoteAudioRef, handleNotification)

  // ── makeCall ──────────────────────────────────────────────────────────────

  const makeCall = useCallback(
    (to: string, phoneNumber: PhoneNumber) => {
      records.insertOutbound(phoneNumber.id, to).then((callId) => {
        if (callId) {
          activeCallIdRef.current = callId
          activeCallDirRef.current = "outbound"
        }
      })
      const call = newCall(to, phoneNumber.phone_number)
      if (call) {
        setActiveCall(call)
        setCallState("trying")
      }
    },
    [isReady, newCall, records]
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
    // Mark missed now; clear refs so terminated notification doesn't double-write
    const pendingId = activeCallIdRef.current
    if (pendingId) {
      // If insertInbound is still in-flight, wait for it first
      if (insertInboundPromiseRef.current) {
        await insertInboundPromiseRef.current
      }
      records.markMissed(activeCallIdRef.current!)
    }
    activeCallIdRef.current = null
    activeCallDirRef.current = null
    callStartedAtRef.current = null
    insertInboundPromiseRef.current = null
    await incomingCall.hangup()
    setIncomingCall(null)
    setInboundPhoneNumber(null)
    setActionBusy(false)
  }, [incomingCall, actionBusy, stopRing, records])

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

  const callerNumber =
    (incomingCall?.options as any)?.remoteCallerNumber ??
    (incomingCall?.options as any)?.destinationNumber ??
    "Unknown"

  const activeNumber =
    (activeCall?.options as any)?.remoteCallerNumber ??
    (activeCall?.options as any)?.destinationNumber ??
    "Unknown"

  return (
    <WebRTCContext.Provider value={{ isReady, makeCall }}>
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
        />
      )}
    </WebRTCContext.Provider>
  )
}
