# Extension Always-On Phone Implementation Plan (Part 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Chrome extension ring on inbound (and play ringback on outbound) even when the side panel is closed, by moving the WebRTC phone into an MV3 offscreen document and turning the visible panel into a remote control.

**Architecture:** An invisible offscreen document hosts a hidden iframe of `https://www.megestic.com/panel?mode=background` — a headless phone (existing `WebRTCProvider` logic, no UI) that owns the single Telnyx connection. The side panel iframe (`?mode=remote`) renders UI only, exchanging typed `postMessage` events/commands with the background phone through the extension service worker. Chrome notifications get Answer/Decline buttons.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase JS (browser client), `@telnyx/webrtc`, Chrome Extension Manifest V3 (`sidePanel`, `notifications`, `offscreen`), Vitest.

## Global Constraints

- **Zero secrets in the extension:** no tokens or SIP credentials in `chrome.storage`; everything lives in the megestic origin's storage (spec: Security).
- **Permissions:** exactly `sidePanel`, `notifications`, `offscreen`. `host_permissions` stay `https://www.megestic.com/*` only.
- **One-phone rule:** only the background iframe holds a Telnyx WebRTC connection; the visible panel never instantiates `useWebRTCClient`.
- **`postMessage` origin checks on every listener, both directions.** Extension shells check `event.origin === "https://www.megestic.com"`; app iframes validate message shape via the Task 1 guards.
- **Dashboard behavior unchanged:** `/dashboard/calls` keeps working exactly as today through every task.
- **Origin:** `https://www.megestic.com`. Extension ID stays pinned via the existing manifest `key`.
- Commands: `npm test` (vitest), `npm run typecheck`, `npm run build`. Test style: `import { describe, it, expect } from "vitest"`.
- Message source constant is the string `"hourglass-panel"` (backward-compatible with the shipped v1 extension).

---

### Task 0: Spike — verify the two platform assumptions

**Files:**
- Create: `docs/superpowers/spikes/2026-07-02-offscreen-spike.md` (results)
- Create: `extension-spike/manifest.json`, `extension-spike/service-worker.js`, `extension-spike/offscreen.html`, `extension-spike/offscreen.js`, `extension-spike/side-panel.html` (throwaway, git-ignored or deleted after)

**Interfaces:**
- Consumes: nothing.
- Produces: a documented GO / FALLBACK decision. GO = offscreen iframe and side-panel iframe of the same origin share localStorage (Supabase session visible to both) AND `chrome.sidePanel.open()` succeeds from a notification-button click. FALLBACK = Task 4/5 must add an explicit `session-handoff` command (panel posts the Supabase session JSON to the background via the bus after login).

- [ ] **Step 1: Build the spike extension**

`extension-spike/manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "Hourglass Spike",
  "version": "0.0.1",
  "minimum_chrome_version": "114",
  "permissions": ["sidePanel", "notifications", "offscreen"],
  "host_permissions": ["https://www.megestic.com/*"],
  "background": { "service_worker": "service-worker.js" },
  "side_panel": { "default_path": "side-panel.html" },
  "action": { "default_title": "Spike" }
}
```

`extension-spike/service-worker.js`:
```js
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return
  await chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["AUDIO_PLAYBACK"],
    justification: "spike",
  })
}
chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreen()
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
  chrome.notifications.create("spike", {
    type: "basic",
    iconUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    title: "Spike",
    message: "Click a button",
    buttons: [{ title: "Open panel" }],
    priority: 2,
  })
})
chrome.notifications.onButtonClicked.addListener(async () => {
  const win = await chrome.windows.getLastFocused()
  try {
    await chrome.sidePanel.open({ windowId: win.id })
    console.log("SPIKE: sidePanel.open OK from notification button")
  } catch (e) {
    console.log("SPIKE: sidePanel.open FAILED", e)
  }
})
```

`extension-spike/offscreen.html`:
```html
<!doctype html>
<html><body>
  <iframe src="https://www.megestic.com/panel" allow="microphone; autoplay"></iframe>
  <script src="offscreen.js"></script>
</body></html>
```

`extension-spike/offscreen.js`:
```js
console.log("SPIKE offscreen loaded")
```

`extension-spike/side-panel.html`:
```html
<!doctype html>
<html><body>
  <iframe src="https://www.megestic.com/panel" style="width:100%;height:100vh;border:0"
          allow="microphone; autoplay"></iframe>
</body></html>
```

- [ ] **Step 2: Manual verification (requires human)**

1. Load `extension-spike/` unpacked at `chrome://extensions`.
2. Open the side panel, sign in to the panel with a test agent account.
3. Inspect the **offscreen document** (chrome://extensions → service worker → offscreen.html link, or `chrome://inspect`), and in its iframe's console run `Object.keys(localStorage).filter(k => k.includes("auth"))` — a Supabase auth token key present = **storage partition shared**.
4. Reload the extension to re-fire the notification; click "Open panel"; confirm the side panel opens and the SW console logs `sidePanel.open OK`.

- [ ] **Step 3: Record the result and clean up**

Write GO or FALLBACK (with console evidence pasted) into `docs/superpowers/spikes/2026-07-02-offscreen-spike.md`. Delete `extension-spike/`.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/spikes/2026-07-02-offscreen-spike.md
git rm -r --cached extension-spike 2>/dev/null; rm -rf extension-spike
git commit -m "docs: offscreen spike results (partition + notification gesture)"
```

> **STOP if FALLBACK:** raise to the controller before Task 4 — the `session-handoff` command must be added to the Task 1 contract first.

---

### Task 1: Panel message-bus contract

**Files:**
- Create: `lib/panel-bus.ts`
- Test: `lib/panel-bus.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (used verbatim by Tasks 4, 5, 6):
  - `PANEL_SOURCE = "hourglass-panel"` (const string)
  - `type CallStatus = "idle" | "incoming" | "trying" | "ringing" | "active"`
  - `type SerializedCallState` (fields below)
  - `type PanelEvent`, `type PanelCommand` (discriminated unions below)
  - `isPanelEvent(msg: unknown): msg is PanelEvent`
  - `isPanelCommand(msg: unknown): msg is PanelCommand`
  - `IDLE_STATE: SerializedCallState`

- [ ] **Step 1: Write the failing test**

Create `lib/panel-bus.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import {
  isPanelCommand,
  isPanelEvent,
  IDLE_STATE,
  PANEL_SOURCE,
} from "./panel-bus"

describe("isPanelEvent", () => {
  it("accepts every event type", () => {
    for (const e of [
      { source: PANEL_SOURCE, type: "state-sync", state: IDLE_STATE },
      { source: PANEL_SOURCE, type: "incoming", caller: "+15551234567", label: "HGI" },
      { source: PANEL_SOURCE, type: "call-active" },
      { source: PANEL_SOURCE, type: "call-ended" },
      { source: PANEL_SOURCE, type: "auth-required" },
      { source: PANEL_SOURCE, type: "mic-blocked" },
    ]) {
      expect(isPanelEvent(e)).toBe(true)
    }
  })

  it("rejects wrong source, commands, junk, and nullish", () => {
    expect(isPanelEvent({ source: "evil", type: "incoming" })).toBe(false)
    expect(isPanelEvent({ source: PANEL_SOURCE, type: "cmd", cmd: "answer" })).toBe(false)
    expect(isPanelEvent({ type: "incoming" })).toBe(false)
    expect(isPanelEvent(null)).toBe(false)
    expect(isPanelEvent("incoming")).toBe(false)
  })
})

describe("isPanelCommand", () => {
  it("accepts every command", () => {
    for (const c of [
      { source: PANEL_SOURCE, type: "cmd", cmd: "dial", to: "+15551234567", callerId: "+15550001111" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "answer" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "decline" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "hangup" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "mute" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "unmute" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "dtmf", digit: "5" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "speak", text: "hello" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "set-online", online: false },
    ]) {
      expect(isPanelCommand(c)).toBe(true)
    }
  })

  it("rejects events, unknown cmds, wrong source, and nullish", () => {
    expect(isPanelCommand({ source: PANEL_SOURCE, type: "call-active" })).toBe(false)
    expect(isPanelCommand({ source: PANEL_SOURCE, type: "cmd", cmd: "self-destruct" })).toBe(false)
    expect(isPanelCommand({ source: "evil", type: "cmd", cmd: "answer" })).toBe(false)
    expect(isPanelCommand(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- lib/panel-bus.test.ts`
Expected: FAIL — cannot resolve `./panel-bus`.

- [ ] **Step 3: Write the implementation**

Create `lib/panel-bus.ts`:
```ts
/**
 * Typed postMessage contract between the megestic /panel iframes and the
 * Chrome extension. The background phone (?mode=background) emits PanelEvents
 * and consumes PanelCommands; the remote panel UI (?mode=remote) does the
 * reverse. Extension shells relay these over chrome.runtime messages.
 *
 * `incoming`/`call-active`/`call-ended` keep the shipped v1 shape so an old
 * extension build degrades gracefully.
 */
export const PANEL_SOURCE = "hourglass-panel" as const

export type CallStatus = "idle" | "incoming" | "trying" | "ringing" | "active"

export type SerializedCallState = {
  status: CallStatus
  direction: "inbound" | "outbound" | null
  /** Inbound: the customer's number (from X-Caller-Number). */
  callerNumber: string | null
  /** Inbound: which company line was dialed. */
  companyLabel: string | null
  companyNumber: string | null
  /** Active call: the other party. */
  remoteNumber: string | null
  muted: boolean
  /** Epoch ms when the call went active; remote UI derives duration. */
  startedAt: number | null
  /** WebRTC registered and ready to place calls. */
  isReady: boolean
  online: boolean
  signedIn: boolean
  micBlocked: boolean
}

export const IDLE_STATE: SerializedCallState = {
  status: "idle",
  direction: null,
  callerNumber: null,
  companyLabel: null,
  companyNumber: null,
  remoteNumber: null,
  muted: false,
  startedAt: null,
  isReady: false,
  online: true,
  signedIn: false,
  micBlocked: false,
}

export type PanelEvent =
  | { source: typeof PANEL_SOURCE; type: "state-sync"; state: SerializedCallState }
  | { source: typeof PANEL_SOURCE; type: "incoming"; caller: string; label: string | null }
  | { source: typeof PANEL_SOURCE; type: "call-active" }
  | { source: typeof PANEL_SOURCE; type: "call-ended" }
  | { source: typeof PANEL_SOURCE; type: "auth-required" }
  | { source: typeof PANEL_SOURCE; type: "mic-blocked" }

export type PanelCommand =
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "dial"; to: string; callerId: string }
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "answer" | "decline" | "hangup" | "mute" | "unmute" }
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "dtmf"; digit: string }
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "speak"; text: string }
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "set-online"; online: boolean }

const EVENT_TYPES = new Set([
  "state-sync",
  "incoming",
  "call-active",
  "call-ended",
  "auth-required",
  "mic-blocked",
])

const COMMANDS = new Set([
  "dial",
  "answer",
  "decline",
  "hangup",
  "mute",
  "unmute",
  "dtmf",
  "speak",
  "set-online",
])

function hasSource(msg: unknown): msg is { source: string; type: string } {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as { source?: unknown }).source === PANEL_SOURCE &&
    typeof (msg as { type?: unknown }).type === "string"
  )
}

export function isPanelEvent(msg: unknown): msg is PanelEvent {
  return hasSource(msg) && EVENT_TYPES.has(msg.type)
}

export function isPanelCommand(msg: unknown): msg is PanelCommand {
  return (
    hasSource(msg) &&
    msg.type === "cmd" &&
    COMMANDS.has((msg as { cmd?: unknown }).cmd as string)
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- lib/panel-bus.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/panel-bus.ts lib/panel-bus.test.ts
git commit -m "feat: typed panel message-bus contract for extension phone"
```

---

### Task 2: Supabase browser-client singleton (session-sharing / RLS 401 fix)

**Files:**
- Modify: `lib/client.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createClient()` (same signature) now returns a per-page singleton in the browser, so every hook/component shares the one authenticated session — the panel's bearer-token calls stop failing under RLS from parallel anonymous clients.

- [ ] **Step 1: Make the client a browser singleton**

Replace the whole of `lib/client.ts` with:
```ts
import { createBrowserClient } from '@supabase/ssr'

let browserClient: ReturnType<typeof createBrowserClient> | null = null

export function createClient() {
  // During SSR each call gets a fresh throwaway instance (no shared state on
  // the server); in the browser everyone shares one client so the panel's
  // authenticated session is visible to every hook (fixes RLS 401s from
  // parallel anonymous clients and GoTrue multi-instance warnings).
  if (typeof window === "undefined") {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
  }
  if (!browserClient) {
    browserClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
    )
  }
  return browserClient
}
```

- [ ] **Step 2: Verify nothing regressed**

Run: `npm run typecheck` → PASS. Run: `npm test` → all existing tests pass. Run: `npm run build` → compiles.

- [ ] **Step 3: Commit**

```bash
git add lib/client.ts
git commit -m "fix: share one Supabase browser client (panel RLS 401)"
```

---

### Task 3: Extract the headless `usePhone` hook from WebRTCProvider

**Files:**
- Create: `components/calls/hooks/use-phone.ts`
- Modify: `components/calls/webrtc-provider.tsx` (becomes a thin wrapper)
- Modify: `components/calls/hooks/use-ringtone.ts` (add ringback flavor)

**Interfaces:**
- Consumes: existing `useWebRTCClient`, `useRingtone`, `useDuration`, `useInboundPhoneLookup`, `PhoneNumber` from `@/types/calls`.
- Produces (Task 4 mounts this headless; the provider keeps the dashboard identical):
  ```ts
  function usePhone(): {
    remoteAudioRef: RefObject<HTMLAudioElement | null>
    isReady: boolean
    online: boolean
    setOnline: (next: boolean) => void
    incomingCall: TelnyxCall | null
    activeCall: TelnyxCall | null
    callState: string
    direction: "inbound" | "outbound" | null
    muted: boolean
    duration: string
    startedAtRef: RefObject<number | null>
    callerNumber: string
    activeNumber: string
    inboundPhoneNumber: { label: string; phone_number: string } | null
    speakText: string
    setSpeakText: (t: string) => void
    speaking: boolean
    actionBusy: boolean
    makeCall: (to: string, phoneNumber: PhoneNumber) => Promise<void>
    handleAnswer: () => Promise<void>
    handleReject: () => Promise<void>
    handleHangup: () => Promise<void>
    toggleMute: () => void
    handleDtmf: (digit: string) => void
    handleSpeak: () => Promise<void>
  }
  ```
- `useRingtone(kind?: "ring" | "ringback")` — same `{ start, stop }` API; `"ringback"` plays 440 Hz with a 4 s cadence.

- [ ] **Step 1: Add the ringback flavor to `use-ringtone.ts`**

Replace the whole file with:
```ts
import { useCallback, useEffect, useRef } from "react"

/**
 * Synthesized ring tones. "ring" = inbound (480 Hz double-burst every 3 s,
 * unchanged). "ringback" = outbound waiting tone (440 Hz double-burst every
 * 4 s, US-style cadence approximation).
 */
export function useRingtone(kind: "ring" | "ringback" = "ring") {
  const ctxRef = useRef<AudioContext | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const freq = kind === "ringback" ? 440 : 480
  const period = kind === "ringback" ? 4000 : 3000

  const burst = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.25, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)
    osc.start(now)
    osc.stop(now + 0.45)
  }, [freq])

  const start = useCallback(() => {
    if (intervalRef.current) return
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    if (ctxRef.current.state === "suspended") ctxRef.current.resume()
    burst()
    setTimeout(burst, 500)
    intervalRef.current = setInterval(() => {
      burst()
      setTimeout(burst, 500)
    }, period)
  }, [burst, period])

  const stop = useCallback(() => {
    clearInterval(intervalRef.current ?? undefined)
    intervalRef.current = null
  }, [])

  useEffect(() => () => stop(), [stop])

  return { start, stop }
}
```

- [ ] **Step 2: Create `components/calls/hooks/use-phone.ts`**

Move the phone logic out of `webrtc-provider.tsx` verbatim (state, notification handler, actions), adding only: `direction`, `startedAtRef`, and stamping `startedAt` when a call goes active. Full file:

```ts
"use client"

import { useCallback, useRef, useState } from "react"
import type { RefObject } from "react"
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
```

(The TEMP DIAGNOSTIC `console.log("🔎 inbound call.options:"...)` block from the old provider is intentionally dropped — it has served its purpose.)

- [ ] **Step 3: Slim `webrtc-provider.tsx` to a wrapper**

Replace the whole file with:
```tsx
// components/calls/webrtc-provider.tsx
"use client"

import { createContext, useContext } from "react"
import { usePhone } from "./hooks/use-phone"
import { IncomingCallPopup } from "./ui/incoming-call-popup"
import { ActiveCallHud } from "./ui/active-call-hud"
import type { PhoneNumber } from "@/types/calls"

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
 * Local phone with UI: mounts the headless usePhone hook and renders the
 * incoming popup + active-call HUD. Used by the dashboard and by /panel when
 * opened as a normal tab. The extension uses BackgroundPhone/RemotePhone
 * instead (one-phone rule).
 */
export function WebRTCProvider({ children }: { children: React.ReactNode }) {
  const phone = usePhone()

  return (
    <WebRTCContext.Provider
      value={{
        isReady: phone.isReady,
        makeCall: phone.makeCall,
        online: phone.online,
        setOnline: phone.setOnline,
      }}
    >
      {children}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={phone.remoteAudioRef} autoPlay hidden />

      {phone.incomingCall && !phone.activeCall && (
        <IncomingCallPopup
          callerNumber={phone.callerNumber}
          companyLabel={phone.inboundPhoneNumber?.label ?? null}
          companyNumber={phone.inboundPhoneNumber?.phone_number ?? null}
          busy={phone.actionBusy}
          onAnswer={phone.handleAnswer}
          onReject={phone.handleReject}
        />
      )}

      {phone.activeCall && (
        <ActiveCallHud
          callState={phone.callState}
          duration={phone.duration}
          remoteNumber={phone.activeNumber}
          muted={phone.muted}
          speakText={phone.speakText}
          speaking={phone.speaking}
          onHangup={phone.handleHangup}
          onToggleMute={phone.toggleMute}
          onSpeakTextChange={phone.setSpeakText}
          onSpeak={phone.handleSpeak}
          onDtmf={phone.handleDtmf}
        />
      )}
    </WebRTCContext.Provider>
  )
}
```

Note: the v1 embedded `postMessage` bridge (`incoming`/`call-active`/`call-ended` effects) is deliberately **removed** from the provider — Task 4's BackgroundPhone supersedes it, and Task 6 repoints the side panel at `?mode=remote` in the same release.

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → PASS. Run: `npm run build` → PASS. Run: `npm test` → all pass.

- [ ] **Step 5: Commit**

```bash
git add components/calls/hooks/use-phone.ts components/calls/hooks/use-ringtone.ts components/calls/webrtc-provider.tsx
git commit -m "refactor: extract headless usePhone hook from WebRTCProvider"
```

---

### Task 4: Background phone mode (`/panel?mode=background`)

**Files:**
- Create: `components/calls/panel/background-phone.tsx`
- Modify: `components/calls/panel/panel-app.tsx`

**Interfaces:**
- Consumes: `usePhone` (Task 3), `useRingtone("ringback")` (Task 3), `PANEL_SOURCE`, `SerializedCallState`, `isPanelCommand`, `PanelEvent` types (Task 1), existing `PanelLogin`, `createClient`.
- Produces: `/panel?mode=background` renders `<BackgroundPhone phoneNumbers={...} />` — headless phone that posts `state-sync` on every change, posts `incoming`/`call-active`/`call-ended`/`mic-blocked`, and executes `PanelCommand`s from `window` messages. `/panel?mode=background` with no session posts `auth-required` and renders nothing visible. Task 6's shells rely on exactly these events.

- [ ] **Step 1: Create `components/calls/panel/background-phone.tsx`**

```tsx
"use client"

import { useEffect, useRef } from "react"
import {
  IDLE_STATE,
  isPanelCommand,
  PANEL_SOURCE,
  type PanelEvent,
  type SerializedCallState,
} from "@/lib/panel-bus"
import { usePhone } from "@/components/calls/hooks/use-phone"
import { useRingtone } from "@/components/calls/hooks/use-ringtone"
import type { PhoneNumber } from "@/types/calls"

function post(event: PanelEvent) {
  // targetOrigin "*" is safe: payloads carry no secrets and the extension
  // shell validates event.origin before acting.
  window.parent.postMessage(event, "*")
}

/**
 * Headless phone for the extension's offscreen document. Owns THE WebRTC
 * connection (one-phone rule), plays ring + ringback audio, mirrors state to
 * the extension via postMessage, and executes remote commands.
 */
export function BackgroundPhone({ phoneNumbers }: { phoneNumbers: PhoneNumber[] }) {
  const phone = usePhone()
  const { start: startRingback, stop: stopRingback } = useRingtone("ringback")
  const micBlockedRef = useRef(false)

  // ── Mic gate: probe once on mount ─────────────────────────────────────────
  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => stream.getTracks().forEach((t) => t.stop()))
      .catch(() => {
        micBlockedRef.current = true
        post({ source: PANEL_SOURCE, type: "mic-blocked" })
      })
  }, [])

  // ── Outbound ringback while dialing ───────────────────────────────────────
  const dialing =
    phone.direction === "outbound" &&
    (phone.callState === "trying" ||
      phone.callState === "requesting" ||
      phone.callState === "ringing" ||
      phone.callState === "early")
  useEffect(() => {
    if (dialing) startRingback()
    else stopRingback()
  }, [dialing, startRingback, stopRingback])

  // ── State sync to the extension ───────────────────────────────────────────
  const status: SerializedCallState["status"] = phone.incomingCall
    ? "incoming"
    : phone.activeCall
      ? phone.callState === "active"
        ? "active"
        : phone.callState === "ringing"
          ? "ringing"
          : "trying"
      : "idle"

  const state: SerializedCallState = {
    ...IDLE_STATE,
    status,
    direction: phone.direction,
    callerNumber: phone.incomingCall ? phone.callerNumber : null,
    companyLabel: phone.inboundPhoneNumber?.label ?? null,
    companyNumber: phone.inboundPhoneNumber?.phone_number ?? null,
    remoteNumber: phone.activeCall ? phone.activeNumber : null,
    muted: phone.muted,
    startedAt: phone.startedAtRef.current,
    isReady: phone.isReady,
    online: phone.online,
    signedIn: true,
    micBlocked: micBlockedRef.current,
  }
  const stateJson = JSON.stringify(state)
  useEffect(() => {
    post({ source: PANEL_SOURCE, type: "state-sync", state: JSON.parse(stateJson) })
  }, [stateJson])

  // ── Discrete events (v1-compatible) ───────────────────────────────────────
  useEffect(() => {
    if (phone.incomingCall && !phone.activeCall) {
      post({
        source: PANEL_SOURCE,
        type: "incoming",
        caller: phone.callerNumber,
        label: phone.inboundPhoneNumber?.label ?? null,
      })
    }
  }, [phone.incomingCall, phone.activeCall, phone.callerNumber, phone.inboundPhoneNumber])

  const everActiveRef = useRef(false)
  useEffect(() => {
    if (phone.activeCall) {
      everActiveRef.current = true
      post({ source: PANEL_SOURCE, type: "call-active" })
    } else if (everActiveRef.current) {
      everActiveRef.current = false
      post({ source: PANEL_SOURCE, type: "call-ended" })
    }
  }, [phone.activeCall])

  // ── Command execution ─────────────────────────────────────────────────────
  const phoneRef = useRef(phone)
  phoneRef.current = phone
  const phoneNumbersRef = useRef(phoneNumbers)
  phoneNumbersRef.current = phoneNumbers

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const msg = event.data
      if (!isPanelCommand(msg)) return
      const p = phoneRef.current
      switch (msg.cmd) {
        case "dial": {
          const pn = phoneNumbersRef.current.find(
            (n) => n.phone_number === msg.callerId
          )
          if (pn) p.makeCall(msg.to, pn)
          break
        }
        case "answer":
          p.handleAnswer()
          break
        case "decline":
          p.handleReject()
          break
        case "hangup":
          p.handleHangup()
          break
        case "mute":
          if (!p.muted) p.toggleMute()
          break
        case "unmute":
          if (p.muted) p.toggleMute()
          break
        case "dtmf":
          p.handleDtmf(msg.digit)
          break
        case "speak":
          p.setSpeakText(msg.text)
          // handleSpeak reads speakText from state; defer one tick so the
          // setState above lands first.
          setTimeout(() => phoneRef.current.handleSpeak(), 0)
          break
        case "set-online":
          p.setOnline(msg.online)
          break
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio ref={phone.remoteAudioRef} autoPlay hidden />
    </>
  )
}
```

- [ ] **Step 2: Branch `panel-app.tsx` on mode**

Replace the whole of `components/calls/panel/panel-app.tsx` with:
```tsx
"use client"

import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { createClient } from "@/lib/client"
import { WebRTCProvider } from "@/components/calls/webrtc-provider"
import { PANEL_SOURCE } from "@/lib/panel-bus"
import type { PhoneNumber } from "@/types/calls"
import { PanelLogin } from "./panel-login"
import { PanelDialer } from "./panel-dialer"
import { BackgroundPhone } from "./background-phone"
import { RemotePhone } from "./remote-phone"

type PanelMode = "local" | "background" | "remote"

function getMode(): PanelMode {
  if (typeof window === "undefined") return "local"
  const m = new URLSearchParams(window.location.search).get("mode")
  return m === "background" || m === "remote" ? m : "local"
}

export function PanelApp() {
  const [supabase] = useState(() => createClient())
  const [mode] = useState<PanelMode>(getMode)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([])

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setLoading(false))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s)
    )
    return () => sub.subscription.unsubscribe()
  }, [supabase])

  const accessToken = session?.access_token
  useEffect(() => {
    if (!accessToken) return
    fetch("/api/calls/phone-numbers", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => res.json())
      .then((body) => {
        if (Array.isArray(body.phoneNumbers)) {
          setPhoneNumbers(body.phoneNumbers as PhoneNumber[])
        } else {
          console.error("Failed to load phone numbers:", body.error)
        }
      })
      .catch((err) => console.error("Failed to load phone numbers:", err))
  }, [accessToken])

  // Background mode with no session: tell the extension loudly, render nothing.
  useEffect(() => {
    if (mode !== "background" || loading) return
    if (!session) {
      window.parent.postMessage({ source: PANEL_SOURCE, type: "auth-required" }, "*")
    }
  }, [mode, loading, session])

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>
  }

  if (mode === "background") {
    if (!session) return null
    return <BackgroundPhone phoneNumbers={phoneNumbers} />
  }

  if (!session) {
    return <PanelLogin supabase={supabase} />
  }

  if (mode === "remote") {
    return (
      <RemotePhone
        phoneNumbers={phoneNumbers}
        onSignOut={() => supabase.auth.signOut()}
      />
    )
  }

  return (
    <WebRTCProvider>
      <PanelDialer
        phoneNumbers={phoneNumbers}
        onSignOut={() => supabase.auth.signOut()}
      />
    </WebRTCProvider>
  )
}
```

Note: this imports `RemotePhone` from Task 5. If executing tasks strictly in order, create a minimal placeholder in this task —
`components/calls/panel/remote-phone.tsx`:
```tsx
"use client"

import type { PhoneNumber } from "@/types/calls"

// Full implementation lands in the next task (remote-control panel UI).
export function RemotePhone(_props: {
  phoneNumbers: PhoneNumber[]
  onSignOut: () => void
}) {
  return <div className="p-4 text-sm text-muted-foreground">Connecting…</div>
}
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` → PASS. Run: `npm run build` → PASS. Run: `npm test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add components/calls/panel/background-phone.tsx components/calls/panel/remote-phone.tsx components/calls/panel/panel-app.tsx
git commit -m "feat: headless background phone mode for extension offscreen doc"
```

---

### Task 5: Remote-control panel UI (`/panel?mode=remote`)

**Files:**
- Modify: `components/calls/panel/remote-phone.tsx` (replace the Task 4 placeholder)

**Interfaces:**
- Consumes: `isPanelEvent`, `PanelCommand`, `SerializedCallState`, `IDLE_STATE`, `PANEL_SOURCE` (Task 1); existing `IncomingCallPopup`, `ActiveCallHud`, `PresenceToggle` behavior via a local context mirror; `PhoneNumber` type.
- Produces: `RemotePhone({ phoneNumbers, onSignOut })` — full panel UI driven by `state-sync`, sending `PanelCommand`s to `window.parent`. Never mounts `useWebRTCClient`/`usePhone` (one-phone rule).

- [ ] **Step 1: Implement `remote-phone.tsx`**

Replace the placeholder with:
```tsx
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

function send(cmd: Omit<PanelCommand, "source" | "type">) {
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
```

Note: if `components/ui/switch.tsx` does not exist in the repo, replace the `<Switch …/>` block with the same `<Button variant="outline">` toggle used by `components/calls/ui/presence-toggle.tsx` (check that file and mirror its control) — do not add a new dependency for this.

- [ ] **Step 2: Verify**

Run: `npm run typecheck` → PASS. Run: `npm run build` → PASS. Run: `npm test` → all pass.

- [ ] **Step 3: Commit**

```bash
git add components/calls/panel/remote-phone.tsx
git commit -m "feat: remote-control panel UI driven by background phone state"
```

---

### Task 6: Extension shell — offscreen document, routing, notifications

**Files:**
- Modify: `extension/manifest.json`
- Create: `extension/offscreen.html`, `extension/offscreen.js`
- Modify: `extension/service-worker.js` (rewrite)
- Modify: `extension/side-panel.html` (iframe src → `?mode=remote`)
- Modify: `extension/panel.js` (rewrite as relay)

**Interfaces:**
- Consumes: the Task 1 contract (shapes duplicated in plain JS — the extension has no build step), `/panel?mode=background` (Task 4), `/panel?mode=remote` (Task 5).
- Produces: chrome.runtime message envelope used by all three extension contexts: `{ kind: "panel-event" | "panel-command", payload: <PanelEvent|PanelCommand> }`.

- [ ] **Step 1: Update `extension/manifest.json`**

Change only these fields (keep `key`, icons, action, side_panel as-is):
```json
{
  "version": "2.0.0",
  "permissions": ["sidePanel", "notifications", "offscreen"]
}
```

- [ ] **Step 2: Create `extension/offscreen.html`**

```html
<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <iframe
      id="phone"
      src="https://www.megestic.com/panel?mode=background"
      allow="microphone; autoplay"
      style="display: none"
    ></iframe>
    <script src="offscreen.js"></script>
  </body>
</html>
```

- [ ] **Step 3: Create `extension/offscreen.js`**

```js
// Shell around the background phone iframe: forwards its PanelEvents to the
// rest of the extension, and injects PanelCommands into it.
const PANEL_ORIGIN = "https://www.megestic.com"
const iframe = document.getElementById("phone")

// Events out of the phone → broadcast to SW + side panel shell.
window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type === "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-event", payload: msg }).catch(() => {})
})

// Commands in → the phone iframe.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-command") return
  iframe.contentWindow.postMessage(message.payload, PANEL_ORIGIN)
})
```

- [ ] **Step 4: Rewrite `extension/service-worker.js`**

```js
// Coordinator: keeps the offscreen phone alive, turns PanelEvents into
// notifications/badge, and issues Answer/Decline commands from notification
// buttons (button clicks are user gestures, so sidePanel.open is allowed).
const INCOMING_ID = "hourglass-incoming"
const AUTH_ID = "hourglass-auth"
const MIC_ID = "hourglass-mic"

async function ensureOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification:
        "Keeps the agent phone registered so calls ring and connect while the side panel is closed.",
    })
  } catch (e) {
    // "Only a single offscreen document" race — safe to ignore.
    if (!String(e).includes("single offscreen")) console.error(e)
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreen()
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})
})
chrome.runtime.onStartup.addListener(ensureOffscreen)

async function openSidePanel() {
  const win = await chrome.windows.getLastFocused()
  try {
    await chrome.sidePanel.open({ windowId: win.id })
  } catch (e) {
    console.warn("sidePanel.open failed:", e)
  }
}

function sendCommand(cmd) {
  chrome.runtime
    .sendMessage({
      kind: "panel-command",
      payload: { source: "hourglass-panel", type: "cmd", ...cmd },
    })
    .catch(() => {})
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  ensureOffscreen()
  const evt = message.payload

  if (evt.type === "incoming") {
    chrome.notifications.create(INCOMING_ID, {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Incoming call",
      message: evt.label ? `${evt.caller} → ${evt.label}` : String(evt.caller),
      buttons: [{ title: "Answer" }, { title: "Decline" }],
      requireInteraction: true,
      priority: 2,
    })
    chrome.action.setBadgeText({ text: "●" })
    chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" })
  } else if (evt.type === "call-active") {
    chrome.notifications.clear(INCOMING_ID)
    chrome.action.setBadgeText({ text: "●" })
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" })
  } else if (evt.type === "call-ended") {
    chrome.notifications.clear(INCOMING_ID)
    chrome.action.setBadgeText({ text: "" })
  } else if (evt.type === "auth-required") {
    chrome.notifications.create(AUTH_ID, {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Sign in to receive calls",
      message: "Open the Hourglass panel and sign in — calls will not ring until you do.",
      priority: 2,
    })
    chrome.action.setBadgeText({ text: "!" })
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" })
  } else if (evt.type === "mic-blocked") {
    chrome.notifications.create(MIC_ID, {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Microphone blocked",
      message: "Open the Hourglass panel and grant microphone access to take calls.",
      priority: 2,
    })
  } else if (evt.type === "state-sync") {
    if (evt.state && evt.state.signedIn) {
      chrome.notifications.clear(AUTH_ID)
      if (evt.state.status === "idle") chrome.action.setBadgeText({ text: "" })
    }
  }
})

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  if (id !== INCOMING_ID) return
  if (buttonIndex === 0) {
    sendCommand({ cmd: "answer" })
    openSidePanel()
  } else {
    sendCommand({ cmd: "decline" })
  }
  chrome.notifications.clear(INCOMING_ID)
})

chrome.notifications.onClicked.addListener((id) => {
  openSidePanel()
  chrome.notifications.clear(id)
})
```

- [ ] **Step 5: Update `extension/side-panel.html`**

Change the iframe line to:
```html
    <iframe
      src="https://www.megestic.com/panel?mode=remote"
      allow="microphone; autoplay"
    ></iframe>
```
(Everything else in the file stays.)

- [ ] **Step 6: Rewrite `extension/panel.js`**

```js
// Shell around the remote panel UI: relays its PanelCommands to the
// background phone, and forwards PanelEvents (state-sync etc.) into it.
const PANEL_ORIGIN = "https://www.megestic.com"
const iframe = document.querySelector("iframe")

// Commands out of the panel UI → broadcast (offscreen shell injects them).
window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type !== "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-command", payload: msg }).catch(() => {})
})

// Events from the background phone → into the panel UI iframe.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  iframe.contentWindow.postMessage(message.payload, PANEL_ORIGIN)
})
```

- [ ] **Step 7: Static verify + commit**

The extension is plain JS (no build). Verify by loading unpacked at `chrome://extensions` and checking for manifest/console errors on the service worker and offscreen document.

```bash
git add extension/
git commit -m "feat: offscreen background phone + notification answer buttons in extension"
```

---

### Task 7: End-to-end verification (manual, requires human + deployed app)

**Files:**
- Create: `docs/superpowers/specs/2026-07-02-extension-phone-verification.md` (results)

**Interfaces:**
- Consumes: everything above, deployed to `https://www.megestic.com`, extension v2.0.0 loaded unpacked.
- Produces: a pass/fail record for every checklist item; Part 2 (SMS) is blocked until all pass.

- [ ] **Step 1: Deploy the app changes** (Tasks 2–5 must be live on `www.megestic.com` — the extension loads the deployed origin, not localhost).

- [ ] **Step 2: Run the E2E checklist** (record each in the results file)

1. Load extension → offscreen document exists (`chrome://extensions` → inspect views) → its console shows the phone registering after panel sign-in.
2. Sign in via side panel → close the panel → call the business line → **ring audio plays + notification with Answer/Decline appears** with the panel still closed.
3. Click **Answer** → audio connects both ways, side panel opens showing the active HUD → mute/unmute, DTMF, hangup all work.
4. Second inbound → click **Decline** → agent leg drops; caller falls through per existing flow (other agents / voicemail).
5. Outbound from panel with each caller ID → **ringback audible while dialing** → callee's phone shows the selected number → connect → hangup.
6. Call rows in `/dashboard/calls` still correct for all of the above (webhook logging unchanged).
7. Restart Chrome → do NOT open the panel → inbound still rings (offscreen auto-recreated).
8. Sign out from the panel → "Sign in to receive calls" notification + `!` badge appear; no ringing while signed out; sign back in → ringing resumes without reloading the extension.
9. Presence toggle in panel → Offline stops inbound ring-all reaching this agent; Online resumes.
10. Dashboard (`/dashboard/calls`) still rings/answers exactly as before (regression).

- [ ] **Step 3: Security verification** (record results)

- `curl https://www.megestic.com/api/calls/webrtc-token` unauthenticated → `401`.
- Extension permissions in `chrome://extensions` show only `sidePanel`, `notifications`, `offscreen` + megestic host.
- A third-party page cannot iframe `/panel` (frame-ancestors blocks).
- DevTools on both iframes: no Supabase token ever appears in `chrome.storage` (`chrome.storage.local.get(console.log)` in SW console → empty).

- [ ] **Step 4: Commit the verification record**

```bash
git add docs/superpowers/specs/2026-07-02-extension-phone-verification.md
git commit -m "docs: always-on phone E2E + security verification results"
```

---

## Self-Review

**Spec coverage:**
- One-phone rule / offscreen architecture → Tasks 4, 6. ✓
- Answer/Decline notification buttons + `sidePanel.open` on gesture → Task 6. ✓
- Outbound ringback → Task 3 (ringback flavor) + Task 4 (dialing effect). ✓
- Login once, shared partition, `auth-required` loud state → Task 4 (panel-app), Task 6 (SW notification), Task 0 verifies the assumption. ✓
- Lifecycle (recreate offscreen on install/startup/message) → Task 6 `ensureOffscreen` on all three paths. ✓
- Mic-permission gate → Task 4 (probe + event), Task 5 (grant banner), Task 6 (notification). ✓
- RLS 401 shared-client fix → Task 2. ✓
- Security constraints (permissions, origin checks, zero secrets) → Global Constraints + Task 6 + Task 7 audit. ✓
- Part 2 (SMS) → explicitly out of scope; separate plan after Task 7 passes. ✓

**Placeholder scan:** none — all steps carry complete code; Task 4's `RemotePhone` placeholder is explicit, minimal, and replaced by Task 5.

**Type consistency:** `SerializedCallState`/`PanelEvent`/`PanelCommand` field names match across Tasks 1, 4, 5 (`state-sync`/`state`, `cmd`/`dial`/`to`/`callerId`, `set-online`/`online`); extension JS mirrors `{ source: "hourglass-panel", type, cmd }` and the `{ kind, payload }` envelope consistently across offscreen.js / panel.js / service-worker.js. `usePhone`'s return shape in Task 3 matches every consumer use in Task 4.
