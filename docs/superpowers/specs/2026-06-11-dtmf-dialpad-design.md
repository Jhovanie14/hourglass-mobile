# DTMF Dialpad Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Add a dialpad to the active call HUD so users can send DTMF tones (e.g., "press 1 for sales") during outbound calls that hit IVR menus. Must be available immediately when a call starts — before the other end picks up — because some IVRs play menus the moment the call connects.

## Scope

Three file changes:

| Action | File | Change |
|--------|------|--------|
| Create | `components/calls/ui/dial-pad.tsx` | New pure UI component |
| Modify | `components/calls/ui/active-call-hud.tsx` | Add `onDtmf` prop, render `<DialPad>` |
| Modify | `components/calls/webrtc-provider.tsx` | Add `handleDtmf` callback |

No schema changes. No new API routes. No new hooks. Existing call recording (insertInbound/Outbound → markAnswered → markCompleted/Missed/Failed) is unaffected.

---

## Component: `DialPad`

**File:** `components/calls/ui/dial-pad.tsx`

Pure UI component. No Supabase, no SDK, no external dependencies beyond React.

**Props:**
```ts
type Props = {
  onDtmf: (digit: string) => void
}
```

**Local state:**
- `digits: string` — accumulates every digit pressed during the call. Display only; never sent anywhere.

**Layout:**
- A read-only text display showing accumulated digits (e.g., `"125"`). Empty placeholder when nothing pressed yet.
- A backspace (`⌫`) button that removes the last character from the display. Does not re-send any DTMF tone.
- A 3-column grid of 12 buttons: `1 2 3 / 4 5 6 / 7 8 9 / * 0 #`

**Behavior:**
- Each digit button appends to `digits` state **and** calls `onDtmf(digit)`.
- Backspace only mutates `digits` state — no DTMF side effect.
- `digits` resets naturally when the HUD unmounts (call ends). No auto-clear timer.

**Styling:** Consistent with existing HUD sections — muted background buttons, rounded corners, hover transition.

---

## Changes to `ActiveCallHud`

**File:** `components/calls/ui/active-call-hud.tsx`

One new prop: `onDtmf: (digit: string) => void`

`<DialPad onDtmf={onDtmf} />` is rendered as a new bordered section. It is **always visible** whenever the HUD is shown — no `callState` condition. This is intentional: digits may be needed before `callState === "active"` (e.g., during `"trying"` or `"ringing"`).

**Section order:**
1. Header (call status label + duration timer)
2. Remote number
3. **Dialpad** ← new
4. TTS speak section (active only)
5. Mute / Hang up buttons

---

## Changes to `webrtc-provider.tsx`

One new handler following the same `useCallback` pattern as `toggleMute`:

```ts
const handleDtmf = useCallback((digit: string) => {
  activeCall?.dtmf(digit)
}, [activeCall])
```

Passed to `<ActiveCallHud>` as `onDtmf={handleDtmf}`.

`call.dtmf(digit)` is the Telnyx WebRTC SDK's documented method for sending DTMF tones over the WebRTC data channel. No HTTP request, no server-side involvement.

---

## What Does Not Change

- Call recording lifecycle — completely unaffected
- Inbound call popup — unaffected
- Telnyx configuration — no changes needed
- Database schema — no new columns
