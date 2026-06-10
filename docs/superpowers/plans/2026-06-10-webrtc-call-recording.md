# WebRTC Call Recording & Provider Restructure

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record inbound and outbound WebRTC calls in the `calls` table, show the called company label in the incoming popup, and split the monolithic `webrtc-provider.tsx` into focused, single-responsibility files.

**Architecture:** The `WebRTCProvider` becomes a thin orchestrator that wires together four extracted hooks (`use-webrtc-client`, `use-call-records`, `use-ringtone`, `use-duration`) and two extracted UI components (`IncomingCallPopup`, `ActiveCallHud`). All Supabase CRUD for calls lives exclusively in `use-call-records`. The SDK lifecycle lives exclusively in `use-webrtc-client`. `incoming-call-provider.tsx` is deleted — it was unreachable (never imported).

**Tech Stack:** Next.js 15, React, `@telnyx/webrtc`, Supabase JS client, TypeScript, Tailwind CSS

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `components/calls/hooks/use-ringtone.ts` | Web Audio API ring pattern |
| Create | `components/calls/hooks/use-duration.ts` | MM:SS timer while call active |
| Create | `components/calls/hooks/use-call-records.ts` | All Supabase CRUD for WebRTC calls |
| Create | `components/calls/hooks/use-webrtc-client.ts` | TelnyxRTC init, SIP registration, `newCall` |
| Create | `components/calls/ui/incoming-call-popup.tsx` | Incoming call popup (pure UI, no logic) |
| Create | `components/calls/ui/active-call-hud.tsx` | Active call HUD (pure UI, no logic) |
| Modify | `components/calls/webrtc-provider.tsx` | Thin orchestrator only (~100 lines) |
| Modify | `components/calls/new-call-dialog.tsx` | Pass full `PhoneNumber` object to `makeCall` |
| Delete | `components/calls/incoming-call-provider.tsx` | Dead file — never imported anywhere |

---

## Task 1: Extract `use-ringtone.ts` and `use-duration.ts`

**Files:**
- Create: `components/calls/hooks/use-ringtone.ts`
- Create: `components/calls/hooks/use-duration.ts`

These are verbatim extractions from `webrtc-provider.tsx`. No logic changes.

- [ ] **Step 1: Create `use-ringtone.ts`**

```ts
// components/calls/hooks/use-ringtone.ts
import { useCallback, useEffect, useRef } from "react"

export function useRingtone() {
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
```

- [ ] **Step 2: Create `use-duration.ts`**

```ts
// components/calls/hooks/use-duration.ts
import { useEffect, useState } from "react"

export function useDuration(active: boolean): string {
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
```

- [ ] **Step 3: Commit**

```bash
git add components/calls/hooks/use-ringtone.ts components/calls/hooks/use-duration.ts
git commit -m "refactor: extract useRingtone and useDuration hooks from webrtc-provider"
```

---

## Task 2: Create `use-call-records.ts`

**Files:**
- Create: `components/calls/hooks/use-call-records.ts`

This hook owns all Supabase call record writes for WebRTC calls. Outbound webhook-based calls (via `/api/calls/outbound`) are unaffected — they have their own path.

- [ ] **Step 1: Create the hook**

```ts
// components/calls/hooks/use-call-records.ts
"use client"

import { useMemo } from "react"
import { createClient } from "@/lib/client"

type InboundRecord = {
  callId: string
  phoneNumber: { label: string; phone_number: string } | null
}

export function useCallRecords() {
  const supabase = useMemo(() => createClient(), [])

  async function insertInbound(
    callerNumber: string,
    rawDestination: string,
    telnyxCallControlId?: string
  ): Promise<InboundRecord | null> {
    // Normalize to E.164: strip non-digits, prepend "+"
    const digits = rawDestination.replace(/\D/g, "")
    const normalized = digits ? `+${digits}` : rawDestination

    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("id, label, phone_number")
      .eq("phone_number", normalized)
      .eq("is_active", true)
      .maybeSingle()

    if (!phoneNumber) {
      console.warn("⚠️ [call-records] No active phone number for destination:", normalized)
      return null
    }

    const { data: call, error } = await supabase
      .from("calls")
      .insert({
        phone_number_id: phoneNumber.id,
        contact_number: callerNumber,
        direction: "inbound",
        status: "initiated",
        ...(telnyxCallControlId && { telnyx_call_id: telnyxCallControlId }),
      })
      .select("id")
      .single()

    if (error) {
      console.error("⚠️ [call-records] Failed to insert inbound call:", error)
      return null
    }

    return {
      callId: call.id,
      phoneNumber: { label: phoneNumber.label, phone_number: phoneNumber.phone_number },
    }
  }

  async function insertOutbound(phoneNumberId: string, to: string): Promise<string | null> {
    const { data: call, error } = await supabase
      .from("calls")
      .insert({
        phone_number_id: phoneNumberId,
        contact_number: to,
        direction: "outbound",
        status: "initiated",
      })
      .select("id")
      .single()

    if (error) {
      console.error("⚠️ [call-records] Failed to insert outbound call:", error)
      return null
    }

    return call.id
  }

  async function markAnswered(callId: string, startedAt: string): Promise<void> {
    const { error } = await supabase
      .from("calls")
      .update({ status: "answered", started_at: startedAt })
      .eq("id", callId)

    if (error) console.error("⚠️ [call-records] Failed to mark answered:", error)
  }

  async function markCompleted(callId: string, startedAt: string): Promise<void> {
    const endedAt = new Date().toISOString()
    const durationSeconds = Math.round(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000
    )
    const { error } = await supabase
      .from("calls")
      .update({ status: "completed", ended_at: endedAt, duration_seconds: durationSeconds })
      .eq("id", callId)

    if (error) console.error("⚠️ [call-records] Failed to mark completed:", error)
  }

  async function markMissed(callId: string): Promise<void> {
    const { error } = await supabase
      .from("calls")
      .update({ status: "missed" })
      .eq("id", callId)

    if (error) console.error("⚠️ [call-records] Failed to mark missed:", error)
  }

  async function markFailed(callId: string): Promise<void> {
    const { error } = await supabase
      .from("calls")
      .update({ status: "failed", ended_at: new Date().toISOString() })
      .eq("id", callId)

    if (error) console.error("⚠️ [call-records] Failed to mark failed:", error)
  }

  return { insertInbound, insertOutbound, markAnswered, markCompleted, markMissed, markFailed }
}
```

- [ ] **Step 2: Commit**

```bash
git add components/calls/hooks/use-call-records.ts
git commit -m "feat: add useCallRecords hook for WebRTC call DB tracking"
```

---

## Task 3: Create `use-webrtc-client.ts`

**Files:**
- Create: `components/calls/hooks/use-webrtc-client.ts`

Owns SDK init, SIP registration, and `newCall`. Receives a notification callback from the orchestrator so it doesn't need to know about call state.

- [ ] **Step 1: Create the hook**

```ts
// components/calls/hooks/use-webrtc-client.ts
"use client"

import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import type { Call as TelnyxCall } from "@telnyx/webrtc"

type Notification = { type: string; call?: TelnyxCall }

export function useWebRTCClient(
  audioRef: RefObject<HTMLAudioElement | null>,
  onNotification: (n: Notification) => void
) {
  const clientRef = useRef<InstanceType<typeof import("@telnyx/webrtc").TelnyxRTC> | null>(null)
  const onNotificationRef = useRef(onNotification)
  const [isReady, setIsReady] = useState(false)

  // Keep callback ref current without restarting the effect
  useEffect(() => {
    onNotificationRef.current = onNotification
  })

  useEffect(() => {
    let mounted = true

    async function init() {
      const { TelnyxRTC } = await import("@telnyx/webrtc")

      const res = await fetch("/api/calls/webrtc-token")
      if (!res.ok) {
        console.warn("WebRTC: could not fetch credentials — is TELNYX_SIP_USERNAME set?")
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

      client.on("telnyx.notification", (n: Notification) => {
        console.log(
          "🔔 Telnyx notification:",
          n.type,
          (n.call as any)?.state,
          (n.call as any)?.direction
        )
        onNotificationRef.current(n)
      })

      client.connect()
    }

    init()

    return () => {
      mounted = false
      clientRef.current?.disconnect()
    }
  }, [])

  function newCall(to: string, callerNumber: string): TelnyxCall | null {
    const client = clientRef.current
    if (!client || !isReady) return null
    return client.newCall({
      destinationNumber: to,
      callerNumber,
      remoteElement: audioRef.current ?? undefined,
    })
  }

  return { isReady, newCall }
}
```

- [ ] **Step 2: Commit**

```bash
git add components/calls/hooks/use-webrtc-client.ts
git commit -m "refactor: extract useWebRTCClient hook from webrtc-provider"
```

---

## Task 4: Create `ui/incoming-call-popup.tsx`

**Files:**
- Create: `components/calls/ui/incoming-call-popup.tsx`

Pure UI component — no Supabase, no SDK. Adapted from `incoming-call-provider.tsx` (which has the nicer pulsing UI + company label row). Props drive everything.

- [ ] **Step 1: Create the component**

```tsx
// components/calls/ui/incoming-call-popup.tsx
import { Phone, PhoneOff } from "lucide-react"

type Props = {
  callerNumber: string
  companyLabel: string | null
  companyNumber: string | null
  busy: boolean
  onAnswer: () => void
  onReject: () => void
}

export function IncomingCallPopup({
  callerNumber,
  companyLabel,
  companyNumber,
  busy,
  onAnswer,
  onReject,
}: Props) {
  return (
    <div className="fixed right-6 bottom-6 z-50 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="relative flex items-center gap-3 bg-green-500/10 px-4 py-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
        </span>
        <span className="text-xs font-semibold tracking-widest text-green-600 uppercase dark:text-green-400">
          Incoming Call
        </span>
      </div>

      <div className="space-y-1 px-4 py-3">
        <p className="text-lg font-semibold tracking-tight tabular-nums">{callerNumber}</p>
        {companyLabel && companyNumber && (
          <p className="text-sm text-muted-foreground">
            → {companyLabel} ({companyNumber})
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onReject}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
        >
          <PhoneOff className="h-4 w-4" />
          Decline
        </button>
        <button
          onClick={onAnswer}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-500 py-2.5 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50"
        >
          <Phone className="h-4 w-4" />
          Answer
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/calls/ui/incoming-call-popup.tsx
git commit -m "feat: add IncomingCallPopup UI component with company label support"
```

---

## Task 5: Create `ui/active-call-hud.tsx`

**Files:**
- Create: `components/calls/ui/active-call-hud.tsx`

Pure UI extracted from lines 330–410 of `webrtc-provider.tsx`. No changes to behaviour.

- [ ] **Step 1: Create the component**

```tsx
// components/calls/ui/active-call-hud.tsx
import { Mic, MicOff, PhoneOff } from "lucide-react"

type Props = {
  callState: string
  duration: string
  remoteNumber: string
  muted: boolean
  speakText: string
  speaking: boolean
  onHangup: () => void
  onToggleMute: () => void
  onSpeakTextChange: (text: string) => void
  onSpeak: () => void
}

export function ActiveCallHud({
  callState,
  duration,
  remoteNumber,
  muted,
  speakText,
  speaking,
  onHangup,
  onToggleMute,
  onSpeakTextChange,
  onSpeak,
}: Props) {
  return (
    <div className="fixed right-6 top-6 z-50 w-80 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
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
        <p className="text-base font-semibold">{remoteNumber}</p>
      </div>

      {callState === "active" && (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Speak on call (TTS)</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={speakText}
              onChange={(e) => onSpeakTextChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSpeak()}
              placeholder="Type message…"
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={onSpeak}
              disabled={!speakText.trim() || speaking}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {speaking ? "…" : "Speak"}
            </button>
          </div>
        </div>
      )}

      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onToggleMute}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition ${
            muted
              ? "bg-yellow-500 text-white hover:bg-yellow-600"
              : "bg-muted text-foreground hover:bg-muted/80"
          }`}
        >
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={onHangup}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
        >
          <PhoneOff className="h-4 w-4" />
          Hang up
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/calls/ui/active-call-hud.tsx
git commit -m "refactor: extract ActiveCallHud UI component from webrtc-provider"
```

---

## Task 6: Rewrite `webrtc-provider.tsx` as thin orchestrator

**Files:**
- Modify: `components/calls/webrtc-provider.tsx`

This is the core task. The orchestrator wires the four hooks together, handles the call state machine, and triggers DB writes at the right lifecycle moments. All the old inline code is replaced with hook calls.

**Call recording lifecycle:**

- **Inbound ringing** → `insertInbound` → store `callId` + `phoneNumber` in refs/state
- **Outbound `makeCall`** → `insertOutbound` → store `callId` in ref
- **State `active`** → `markAnswered(callId, now)` → store `startedAt` in ref
- **State terminated** → if `startedAt`: `markCompleted`; else if inbound: `markMissed`; else: `markFailed`

- [ ] **Step 1: Replace `webrtc-provider.tsx` entirely**

```tsx
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
        // Persist final call status
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
      if (state === "ringing" && call.direction !== "outbound") {
        if (activeCallRef.current) return
        const callerNumber =
          (call.options as any)?.remoteCallerNumber ??
          (call.options as any)?.destinationNumber ??
          "Unknown"
        const destination = (call.options as any)?.destinationNumber ?? ""
        const telnyxId = (call as any).telnyxIDs?.telnyxCallControlId as string | undefined
        records.insertInbound(callerNumber, destination, telnyxId).then((record) => {
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

      // Call became active (answered)
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
    // records functions are stable (created from useMemo'd supabase client)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startRing, stopRing]
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isReady, newCall]
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
```

- [ ] **Step 2: Commit**

```bash
git add components/calls/webrtc-provider.tsx
git commit -m "refactor: rewrite webrtc-provider as thin orchestrator with call recording"
```

---

## Task 7: Update `new-call-dialog.tsx`

**Files:**
- Modify: `components/calls/new-call-dialog.tsx`

`makeCall` signature changed from `(to: string, callerNumber: string)` to `(to: string, phoneNumber: PhoneNumber)`. Update the single call site.

- [ ] **Step 1: Update the call in `handleCall`**

In `components/calls/new-call-dialog.tsx`, find line:
```tsx
makeCall(to.trim(), selectedPhone.phone_number)
```
Replace with:
```tsx
makeCall(to.trim(), selectedPhone)
```

`selectedPhone` is already typed as `PhoneNumber` — no other changes needed.

- [ ] **Step 2: Commit**

```bash
git add components/calls/new-call-dialog.tsx
git commit -m "fix: pass full PhoneNumber object to makeCall in NewCallDialog"
```

---

## Task 8: Delete dead file and final cleanup

**Files:**
- Delete: `components/calls/incoming-call-provider.tsx`

This file is not imported anywhere in the codebase (verified: only referenced in a spec doc). Its Supabase-realtime-based approach is superseded by the WebRTC provider's direct recording.

- [ ] **Step 1: Remove the file and commit**

```bash
git rm components/calls/incoming-call-provider.tsx
git commit -m "chore: remove dead incoming-call-provider (superseded by webrtc-provider)"
```

- [ ] **Step 2: Remove the debug logging added during investigation**

In `components/calls/incoming-call-provider.tsx` — already deleted above.

Check `components/calls/incoming-call-provider.tsx` is gone and no imports reference it:

```bash
grep -r "incoming-call-provider" components/ app/ --include="*.tsx" --include="*.ts"
```

Expected: no output.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors. If there are errors, fix them before proceeding.
