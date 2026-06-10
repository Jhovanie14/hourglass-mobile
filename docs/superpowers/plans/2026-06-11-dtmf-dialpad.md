# DTMF Dialpad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a always-visible DTMF dialpad to the active call HUD so users can send tones to IVR menus immediately when a call starts.

**Architecture:** A new pure UI component `DialPad` holds local state for the digit display and fires `onDtmf` callbacks. `ActiveCallHud` receives a new `onDtmf` prop and renders `<DialPad>` as a section above TTS. `webrtc-provider` adds a single `handleDtmf` callback that calls `activeCall.dtmf(digit)` from the Telnyx WebRTC SDK.

**Tech Stack:** Next.js 15, React, TypeScript, Tailwind CSS, `@telnyx/webrtc`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `components/calls/ui/dial-pad.tsx` | Pure UI dialpad with digit display and 12-button grid |
| Modify | `components/calls/ui/active-call-hud.tsx` | Add `onDtmf` prop, render `<DialPad>` |
| Modify | `components/calls/webrtc-provider.tsx` | Add `handleDtmf` callback, pass to HUD |

---

## Task 1: Create `dial-pad.tsx`

**Files:**
- Create: `components/calls/ui/dial-pad.tsx`

- [ ] **Step 1: Create the component**

```tsx
// components/calls/ui/dial-pad.tsx
import { useState } from "react"
import { Delete } from "lucide-react"

type Props = {
  onDtmf: (digit: string) => void
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]

export function DialPad({ onDtmf }: Props) {
  const [digits, setDigits] = useState("")

  function press(digit: string) {
    setDigits((d) => d + digit)
    onDtmf(digit)
  }

  function backspace() {
    setDigits((d) => d.slice(0, -1))
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Keypad</p>

      {/* Digit display */}
      <div className="mb-2 flex items-center gap-2">
        <div className="min-h-[2rem] flex-1 rounded-lg border border-input bg-background px-3 py-1 font-mono text-sm tabular-nums text-foreground">
          {digits || <span className="text-muted-foreground">—</span>}
        </div>
        <button
          onClick={backspace}
          disabled={digits.length === 0}
          className="rounded-lg border border-input bg-background p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
          aria-label="Backspace"
        >
          <Delete className="h-4 w-4" />
        </button>
      </div>

      {/* Key grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {KEYS.map((key) => (
          <button
            key={key}
            onClick={() => press(key)}
            className="rounded-xl bg-muted py-2.5 text-sm font-semibold tabular-nums text-foreground transition hover:bg-muted/60 active:scale-95"
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/calls/ui/dial-pad.tsx
git commit -m "feat: add DialPad UI component with digit display and backspace"
```

---

## Task 2: Update `active-call-hud.tsx`

**Files:**
- Modify: `components/calls/ui/active-call-hud.tsx`

- [ ] **Step 1: Add `onDtmf` prop and import `DialPad`**

Replace the entire file with:

```tsx
// components/calls/ui/active-call-hud.tsx
import { Mic, MicOff, PhoneOff } from "lucide-react"
import { DialPad } from "./dial-pad"

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
  onDtmf: (digit: string) => void
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
  onDtmf,
}: Props) {
  return (
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

      {/* Remote number */}
      <div className="px-4 py-3">
        <p className="text-base font-semibold">{remoteNumber}</p>
      </div>

      {/* Dialpad — always visible during a call */}
      <DialPad onDtmf={onDtmf} />

      {/* TTS speak section — active calls only */}
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

      {/* Call controls */}
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

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: one error — `webrtc-provider.tsx` is now missing the `onDtmf` prop on `<ActiveCallHud>`. That's expected; it gets fixed in Task 3.

- [ ] **Step 3: Commit**

```bash
git add components/calls/ui/active-call-hud.tsx
git commit -m "feat: add onDtmf prop and DialPad to ActiveCallHud"
```

---

## Task 3: Update `webrtc-provider.tsx`

**Files:**
- Modify: `components/calls/webrtc-provider.tsx`

- [ ] **Step 1: Add `handleDtmf` and wire it to `<ActiveCallHud>`**

In `components/calls/webrtc-provider.tsx`, add the handler after `toggleMute` (around line 227):

```ts
const handleDtmf = useCallback((digit: string) => {
  activeCall?.dtmf(digit)
}, [activeCall])
```

Then update the `<ActiveCallHud>` JSX (around line 280) to pass the new prop:

```tsx
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
```

- [ ] **Step 2: Verify TypeScript compiles clean**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/calls/webrtc-provider.tsx
git commit -m "feat: wire DTMF handler in webrtc-provider — sends tones via Telnyx SDK"
```

---

## Manual Verification

After all three tasks are committed:

1. Start the dev server: `npm run dev`
2. Make an outbound call to a number with an IVR (e.g., a bank or service line)
3. While the call is in the `"trying"` state, tap a digit on the dialpad — confirm it appears in the display
4. Once the IVR answers, confirm tones are audible on the other end and the IVR responds
5. Tap backspace — confirm the last digit is removed from the display
6. Hang up — confirm the call records correctly in Supabase (existing behavior unchanged)
