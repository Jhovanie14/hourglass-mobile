"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react"
import type { Call as TelnyxCall } from "@telnyx/webrtc"

// ─── Context ────────────────────────────────────────────────────────────────

type WebRTCContextType = {
  isReady: boolean
  makeCall: (to: string, callerNumber: string) => void
}

const WebRTCContext = createContext<WebRTCContextType>({
  isReady: false,
  makeCall: () => {},
})

export function useWebRTC() {
  return useContext(WebRTCContext)
}

// ─── Ringtone (Web Audio) ────────────────────────────────────────────────────

function useRingtone() {
  const ctxRef = useRef<AudioContext | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const burst = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 480
    gain.gain.setValueAtTime(0.25, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)
    osc.start(now)
    osc.stop(now + 0.45)
  }, [])

  const start = useCallback(() => {
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    if (ctxRef.current.state === "suspended") ctxRef.current.resume()
    burst()
    setTimeout(burst, 500)
    intervalRef.current = setInterval(() => {
      burst()
      setTimeout(burst, 500)
    }, 3000)
  }, [burst])

  const stop = useCallback(() => {
    clearInterval(intervalRef.current ?? undefined)
    intervalRef.current = null
  }, [])

  useEffect(() => () => stop(), [stop])
  return { start, stop }
}

// ─── Duration timer ──────────────────────────────────────────────────────────

function useDuration(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) {
      setSeconds(0)
      return
    }
    const id = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(id)
  }, [active])
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0")
  const ss = String(seconds % 60).padStart(2, "0")
  return `${mm}:${ss}`
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  const clientRef = useRef<InstanceType<
    typeof import("@telnyx/webrtc").TelnyxRTC
  > | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  const [isReady, setIsReady] = useState(false)
  const [incomingCall, setIncomingCall] = useState<TelnyxCall | null>(null)
  const [activeCall, setActiveCall] = useState<TelnyxCall | null>(null)
  // callState tracks the raw SDK state string so the HUD can show "Calling…" vs "Active"
  const [callState, setCallState] = useState<string>("")
  const [muted, setMuted] = useState(false)
  const [speakText, setSpeakText] = useState("")
  const [speaking, setSpeaking] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const activeCallRef = useRef<TelnyxCall | null>(null)

  const { start: startRing, stop: stopRing } = useRingtone()
  const duration = useDuration(!!activeCall)

  useEffect(() => {
    activeCallRef.current = activeCall
  }, [activeCall])

  useEffect(() => {
    let mounted = true

    async function init() {
      const { TelnyxRTC } = await import("@telnyx/webrtc")

      const res = await fetch("/api/calls/webrtc-token")
      if (!res.ok) {
        console.warn(
          "WebRTC: could not fetch credentials — is TELNYX_CREDENTIAL_CONNECTION_ID set?"
        )
        return
      }
      const { login, password } = await res.json()
      if (!mounted || !login || !password) return

      const client = new TelnyxRTC({ login, password })
      clientRef.current = client

      client.on("telnyx.ready", () => {
        console.log("✅ TelnyxRTC ready — SIP registered")
        if (mounted) setIsReady(true)
      })

      client.on("telnyx.error", (err: unknown) => {
        console.error("❌ TelnyxRTC error:", err)
      })

      client.on(
        "telnyx.notification",
        (notification: { type: string; call?: TelnyxCall }) => {
          console.log(
            "🔔 Telnyx notification:",
            notification.type,
            (notification.call as any)?.state,
            (notification.call as any)?.direction
          )
          if (!mounted || notification.type !== "callUpdate") return
          const call = notification.call
          if (!call) return
          const state = call.state

          const isTerminated =
            state === "hangup" || state === "destroy" || state === "purge"

          if (isTerminated) {
            setActiveCall(null)
            setIncomingCall(null)
            setCallState("")
            setMuted(false)
            setSpeakText("")
            stopRing()
            if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
            return
          }

          // "new" fires before direction is known — skip it to avoid prematurely
          // setting activeCall, which would block the incoming popup at "ringing"
          if (state === "new") return

          // Inbound: show incoming call popup while ringing
          if (state === "ringing" && call.direction !== "outbound") {
            if (activeCallRef.current) return
            setIncomingCall(call)
            startRing()
            return
          }

          // Any non-terminated state — show the HUD (outbound "trying"/"ringing" shows "Calling…")
          setActiveCall(call)
          setCallState(state)
          setIncomingCall(null)

          if (state === "active") {
            stopRing()
            setMuted(false)
            if (remoteAudioRef.current && call.remoteStream) {
              remoteAudioRef.current.srcObject = call.remoteStream
              remoteAudioRef.current.play().catch(() => {})
            }
          }
        }
      )

      client.connect()
    }

    init()
    return () => {
      mounted = false
      clientRef.current?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const makeCall = useCallback(
    (to: string, callerNumber: string) => {
      const client = clientRef.current
      if (!client || !isReady) return
      const call = client.newCall({
        destinationNumber: to,
        callerNumber,
        remoteElement: remoteAudioRef.current ?? undefined,
      })
      // Show HUD immediately — don't wait for the first notification
      setActiveCall(call)
      setCallState("trying")
    },
    [isReady]
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
    await incomingCall.hangup()
    setIncomingCall(null)
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

  async function handleSpeak() {
    if (!activeCall || !speakText.trim() || speaking) return
    const callControlId = activeCall.telnyxIDs?.telnyxCallControlId
    if (!callControlId) return
    setSpeaking(true)
    await fetch("/api/calls/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call_control_id: callControlId,
        text: speakText.trim(),
      }),
    })
    setSpeaking(false)
    setSpeakText("")
  }

  const callerNumber =
    incomingCall?.options?.remoteCallerNumber ??
    incomingCall?.options?.destinationNumber ??
    "Unknown"

  const activeNumber =
    activeCall?.options?.remoteCallerNumber ??
    activeCall?.options?.destinationNumber ??
    "Unknown"

  return (
    <WebRTCContext.Provider value={{ isReady, makeCall }}>
      {children}

      {/* Hidden audio element for remote call audio */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={remoteAudioRef} autoPlay hidden />

      {/* ── Incoming call popup ── */}
      {incomingCall && !activeCall && (
        <div className="fixed right-6 bottom-6 z-50 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          <div className="flex items-center gap-3 bg-green-500/10 px-4 py-3">
            <span className="relative flex h-3 w-3">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
            </span>
            <span className="text-xs font-semibold tracking-widest text-green-600 uppercase dark:text-green-400">
              Incoming Call
            </span>
          </div>
          <div className="px-4 py-3">
            <p className="text-lg font-semibold tracking-tight tabular-nums">
              {callerNumber}
            </p>
          </div>
          <div className="flex gap-2 border-t border-border px-4 py-3">
            <button
              onClick={handleReject}
              disabled={actionBusy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
            >
              <PhoneOff className="h-4 w-4" />
              Decline
            </button>
            <button
              onClick={handleAnswer}
              disabled={actionBusy}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-500 py-2.5 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50"
            >
              <Phone className="h-4 w-4" />
              Answer
            </button>
          </div>
        </div>
      )}

      {/* ── Active call HUD ── */}
      {activeCall && (
        <div className="fixed right-6 top-6 z-50 w-80 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between bg-green-500/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
              </span>
              <span className="text-xs font-semibold tracking-widest text-green-600 uppercase dark:text-green-400">
                {callState === "active"
                  ? "Active Call"
                  : callState === "ringing"
                    ? "Ringing…"
                    : "Calling…"}
              </span>
            </div>
            {callState === "active" && (
              <span className="font-mono text-sm text-muted-foreground tabular-nums">
                {duration}
              </span>
            )}
          </div>

          <div className="px-4 py-3">
            <p className="text-base font-semibold">{activeNumber}</p>
          </div>

          {/* TTS speak — only available once the call is connected */}
          {callState === "active" && (
            <div className="border-t border-border px-4 py-3">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Speak on call (TTS)
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={speakText}
                  onChange={(e) => setSpeakText(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSpeak()}
                  placeholder="Type message…"
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:ring-1 focus:ring-ring focus:outline-none"
                />
                <button
                  onClick={handleSpeak}
                  disabled={!speakText.trim() || speaking}
                  className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                >
                  {speaking ? "…" : "Speak"}
                </button>
              </div>
            </div>
          )}

          {/* Controls */}
          <div className="flex gap-2 border-t border-border px-4 py-3">
            <button
              onClick={toggleMute}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition ${
                muted
                  ? "bg-yellow-500 text-white hover:bg-yellow-600"
                  : "bg-muted text-foreground hover:bg-muted/80"
              }`}
            >
              {muted ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              {muted ? "Unmute" : "Mute"}
            </button>
            <button
              onClick={handleHangup}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
            >
              <PhoneOff className="h-4 w-4" />
              Hang up
            </button>
          </div>
        </div>
      )}
    </WebRTCContext.Provider>
  )
}
