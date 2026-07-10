# Incoming-Call Popup Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an inbound call rings, a small softphone card pops up in the top-right corner of the screen — regardless of the focused tab/app or whether the panel is open — showing the caller, the dialed number/brand, and Accept/Decline, and becoming the live-call screen on answer.

**Architecture:** Reuse the existing "remote surface" pattern. A new extension-owned popup window (`call-window.html`) hosts the panel card view (`/panel?mode=call`) and bridges its messages to the offscreen background phone, exactly like the toolbar popup does. The service worker opens the window when call state transitions into `incoming` and closes it when the call returns to `idle`. The card UI is the already-existing `IncomingCallPopup` (caller + dialed-number/brand) plus a shared in-call card.

**Tech Stack:** Chrome MV3 extension (vanilla JS), Next.js 16 + React 19 web app (`/panel`), Supabase auth, Tailwind, vitest (node env) for pure-logic unit tests.

## Global Constraints

- Manifest V3; `minimum_chrome_version` 127; existing permissions only — **no new permissions** (`chrome.windows` needs none; the window self-positions via `window.screen` + `chrome.windows.update`).
- Dev panel origin `http://localhost:3000`; prod `https://www.megestic.com`. HTML/JS files use the **dev** origin in source; `scripts/package-extension.mjs` rewrites it to prod at package time and **fails the build if any dev origin remains** — so no manual origin edits.
- Panel message source string is exactly `"hourglass-panel"` (`PANEL_SOURCE` in `lib/panel-bus.ts`).
- Serialized call statuses: `"idle" | "incoming" | "ringing" | "trying" | "active"`.
- The window's panel iframe shares the `hg-panel-auth` **localStorage** session — this feature depends on the auth fix (branch `fix/panel-auth-localstorage-persistence`) being deployed to prod.
- Pure logic (no `chrome.*`, no DOM) goes in `extension/lib/*.js` with a `*.test.ts` sibling (vitest, node env). React components are **not** unit-tested in this repo (node env, no jsdom) — verify them via `npm run typecheck` + manual load.
- Work on branch `feat/incoming-call-window` (already created; the spec is committed there).

---

## File Structure

**Create:**
- `extension/lib/call-window-policy.js` — pure open/close decisions from status transitions.
- `extension/lib/call-window-policy.test.ts` — unit tests for the policy.
- `extension/call-window.html` — window host page (iframe → `/panel?mode=call`).
- `extension/call-window.js` — message bridge + top-right self-positioning.
- `components/calls/ui/in-call-card.tsx` — shared compact in-call card (mute / hang up).
- `components/calls/panel/call-window-phone.tsx` — the `mode=call` card view that fills the window.

**Modify:**
- `components/calls/panel/widget-phone.tsx` — use the shared `InCallCard`.
- `components/calls/ui/incoming-call-popup.tsx` — add optional `className` for the outer wrapper.
- `components/calls/panel/panel-app.tsx` — add `"call"` mode routing.
- `extension/service-worker.js` — open/close the window on state transitions; remove the incoming OS notification toast + its handlers.
- `extension/manifest.json` — version bump.

---

## Task 1: Call-window open/close policy (pure, TDD)

**Files:**
- Create: `extension/lib/call-window-policy.js`
- Test: `extension/lib/call-window-policy.test.ts`

**Interfaces:**
- Produces: `shouldOpenCallWindow(prevStatus: string, nextStatus: string): boolean`, `shouldCloseCallWindow(prevStatus: string, nextStatus: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `extension/lib/call-window-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { shouldOpenCallWindow, shouldCloseCallWindow } from "./call-window-policy.js"

describe("shouldOpenCallWindow", () => {
  it("opens when an inbound call starts ringing", () => {
    expect(shouldOpenCallWindow("idle", "incoming")).toBe(true)
  })
  it("does not reopen while still incoming", () => {
    expect(shouldOpenCallWindow("incoming", "incoming")).toBe(false)
  })
  it("does not open once incoming becomes active", () => {
    expect(shouldOpenCallWindow("incoming", "active")).toBe(false)
  })
  it("does not open for outbound dialing", () => {
    expect(shouldOpenCallWindow("idle", "trying")).toBe(false)
    expect(shouldOpenCallWindow("trying", "ringing")).toBe(false)
    expect(shouldOpenCallWindow("ringing", "active")).toBe(false)
  })
})

describe("shouldCloseCallWindow", () => {
  it("closes when an answered call ends", () => {
    expect(shouldCloseCallWindow("active", "idle")).toBe(true)
  })
  it("closes when an incoming call is missed or declined", () => {
    expect(shouldCloseCallWindow("incoming", "idle")).toBe(true)
  })
  it("closes when an outbound attempt ends", () => {
    expect(shouldCloseCallWindow("trying", "idle")).toBe(true)
  })
  it("stays open across live transitions", () => {
    expect(shouldCloseCallWindow("incoming", "active")).toBe(false)
    expect(shouldCloseCallWindow("trying", "active")).toBe(false)
  })
  it("no-ops when already idle", () => {
    expect(shouldCloseCallWindow("idle", "idle")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run extension/lib/call-window-policy.test.ts`
Expected: FAIL — cannot resolve `./call-window-policy.js` / functions undefined.

- [ ] **Step 3: Write minimal implementation**

Create `extension/lib/call-window-policy.js`:

```js
// Pure decisions for when the dedicated incoming-call window opens and closes.
// No chrome.* or DOM here so it unit-tests in plain node (mirrors widget-policy.js).

// Serialized call statuses that mean "a call session is underway".
const LIVE = new Set(["incoming", "ringing", "trying", "active"])

/**
 * Open the call window when an INBOUND call starts ringing. Edge-triggered on the
 * transition into "incoming" so repeated state-syncs don't reopen it. Outbound
 * calls never pass through "incoming", so they never pop a window.
 */
export function shouldOpenCallWindow(prevStatus, nextStatus) {
  return nextStatus === "incoming" && prevStatus !== "incoming"
}

/**
 * Close the call window when a call session ends — any live status (answered,
 * ringing, or the inbound "incoming") returning to idle. Declined/missed/hung-up
 * all land on idle. Harmless for outbound (the service worker only acts if a
 * window is actually tracked).
 */
export function shouldCloseCallWindow(prevStatus, nextStatus) {
  return nextStatus === "idle" && LIVE.has(prevStatus)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run extension/lib/call-window-policy.test.ts`
Expected: PASS (10 assertions across 2 suites).

- [ ] **Step 5: Commit**

```bash
git add extension/lib/call-window-policy.js extension/lib/call-window-policy.test.ts
git commit -m "feat(ext): pure policy for incoming-call window open/close"
```

---

## Task 2: Extract shared `InCallCard`

**Files:**
- Create: `components/calls/ui/in-call-card.tsx`
- Modify: `components/calls/panel/widget-phone.tsx`

**Interfaces:**
- Produces: `InCallCard({ remoteNumber: string, duration: string, muted: boolean, onToggleMute: () => void, onHangup: () => void, className?: string })`. Default `className` keeps the existing bottom-right corner placement so `WidgetPhone` looks unchanged.

- [ ] **Step 1: Create the shared component**

Create `components/calls/ui/in-call-card.tsx`:

```tsx
// components/calls/ui/in-call-card.tsx
import { Mic, MicOff, PhoneOff } from "lucide-react"

type Props = {
  remoteNumber: string
  duration: string
  muted: boolean
  onToggleMute: () => void
  onHangup: () => void
  // Positioning/size for the outer wrapper. Default = bottom-right corner card
  // (in-tab widget); the call window overrides this to fill its window.
  className?: string
}

export function InCallCard({
  remoteNumber,
  duration,
  muted,
  onToggleMute,
  onHangup,
  className = "fixed right-6 bottom-6 z-50 w-72",
}: Props) {
  return (
    <div
      className={`${className} overflow-hidden rounded-2xl border border-border bg-card shadow-2xl`}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tabular-nums">{remoteNumber}</span>
        <span className="text-xs font-medium text-green-600 tabular-nums dark:text-green-400">
          {duration}
        </span>
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onToggleMute}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium transition hover:bg-muted"
        >
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={onHangup}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
        >
          <PhoneOff className="h-4 w-4" />
          Hang Up
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Refactor `WidgetPhone` to use it**

In `components/calls/panel/widget-phone.tsx`:

Replace the import line
```tsx
import { Mic, MicOff, PhoneOff } from "lucide-react"
```
with
```tsx
import { InCallCard } from "@/components/calls/ui/in-call-card"
```

Then replace the entire final in-call `return (...)` block (the `<div className="fixed right-6 bottom-6 ...">` … `</div>` that renders the number, duration, Mute and Hang Up) with:

```tsx
  return (
    <InCallCard
      remoteNumber={state.remoteNumber ?? "Unknown"}
      duration={duration}
      muted={state.muted}
      onToggleMute={() => send({ cmd: state.muted ? "unmute" : "mute" })}
      onHangup={() => send({ cmd: "hangup" })}
    />
  )
```

Leave the earlier `IncomingCallPopup` branch and the `if (state.status === "idle") return null` / `if (!inCall) return null` guards exactly as they are.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors). If it flags an unused `Mic`/`MicOff`/`PhoneOff`, confirm the old import line was fully removed.

- [ ] **Step 4: Commit**

```bash
git add components/calls/ui/in-call-card.tsx components/calls/panel/widget-phone.tsx
git commit -m "refactor(panel): extract shared InCallCard from widget"
```

---

## Task 3: Make `IncomingCallPopup` positioning overridable

**Files:**
- Modify: `components/calls/ui/incoming-call-popup.tsx`

**Interfaces:**
- Produces: `IncomingCallPopup` gains an optional `className?: string` prop for the outer wrapper; default is the current corner placement so existing callers (`RemotePhone`, `WidgetPhone`) are unaffected.

- [ ] **Step 1: Add the prop**

In `components/calls/ui/incoming-call-popup.tsx`, add `className` to `Props`:

```tsx
type Props = {
  callerNumber: string
  companyLabel: string | null
  companyNumber: string | null
  busy: boolean
  onAnswer: () => void
  onReject: () => void
  // Positioning/size for the outer wrapper. Default = bottom-right corner card;
  // the call window overrides this to fill its window.
  className?: string
}
```

Update the destructuring and the outer `<div>` so the wrapper classes come from the prop (keeping the shared visual classes):

```tsx
export function IncomingCallPopup({
  callerNumber,
  companyLabel,
  companyNumber,
  busy,
  onAnswer,
  onReject,
  className = "fixed right-6 bottom-6 z-50 w-72",
}: Props) {
  return (
    <div
      className={`${className} overflow-hidden rounded-2xl border border-border bg-card shadow-2xl`}
    >
```

Leave the rest of the component (header, body, buttons) unchanged.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/calls/ui/incoming-call-popup.tsx
git commit -m "feat(panel): allow IncomingCallPopup wrapper class override"
```

---

## Task 4: `CallWindowPhone` view + `mode=call` routing

**Files:**
- Create: `components/calls/panel/call-window-phone.tsx`
- Modify: `components/calls/panel/panel-app.tsx`

**Interfaces:**
- Consumes: `IncomingCallPopup` (`className`), `InCallCard` (`className`), `SerializedCallState`, `IDLE_STATE`, `isPanelEvent`, `PANEL_SOURCE` from `@/lib/panel-bus`.
- Produces: `CallWindowPhone({ phoneNumbers: PhoneNumber[] })`; new `PanelMode` member `"call"`.

- [ ] **Step 1: Create the card view**

Create `components/calls/panel/call-window-phone.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import {
  IDLE_STATE,
  isPanelEvent,
  PANEL_SOURCE,
  type SerializedCallState,
} from "@/lib/panel-bus"
import { IncomingCallPopup } from "@/components/calls/ui/incoming-call-popup"
import { InCallCard } from "@/components/calls/ui/in-call-card"
import type { PhoneNumber } from "@/types/calls"

function send(cmd: Record<string, unknown>) {
  window.parent.postMessage({ source: PANEL_SOURCE, type: "cmd", ...cmd }, "*")
}

function useDuration(startedAt: number | null): string {
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
 * Full-window softphone card for the dedicated incoming-call popup window
 * (mode=call). One-phone rule: never opens WebRTC — renders state-sync from the
 * offscreen engine and sends commands back, same as WidgetPhone, but fills the
 * window instead of pinning to a corner. phoneNumbers is unused today; kept for
 * parity with the other panel modes.
 */
export function CallWindowPhone(_props: { phoneNumbers: PhoneNumber[] }) {
  const [state, setState] = useState<SerializedCallState>(IDLE_STATE)

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

  const duration = useDuration(state.status === "active" ? state.startedAt : null)
  const inCall = state.status !== "idle" && state.status !== "incoming"

  return (
    <div className="flex h-full min-h-screen items-center justify-center bg-background p-3">
      {state.status === "incoming" && (
        <IncomingCallPopup
          className="w-full max-w-sm"
          callerNumber={state.callerNumber ?? "Unknown"}
          companyLabel={state.companyLabel}
          companyNumber={state.companyNumber}
          busy={false}
          onAnswer={() => send({ cmd: "answer" })}
          onReject={() => send({ cmd: "decline" })}
        />
      )}

      {inCall && (
        <InCallCard
          className="w-full max-w-sm"
          remoteNumber={state.remoteNumber ?? "Unknown"}
          duration={duration}
          muted={state.muted}
          onToggleMute={() => send({ cmd: state.muted ? "unmute" : "mute" })}
          onHangup={() => send({ cmd: "hangup" })}
        />
      )}

      {state.status === "idle" && (
        <p className="text-sm text-muted-foreground">No active call</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Route `mode=call` in `panel-app.tsx`**

In `components/calls/panel/panel-app.tsx`:

Add the import (next to the other panel imports):
```tsx
import { CallWindowPhone } from "./call-window-phone"
```

Widen the mode type:
```tsx
type PanelMode = "local" | "background" | "remote" | "widget" | "call"
```

Update `getMode` to accept it:
```tsx
  const m = new URLSearchParams(window.location.search).get("mode")
  return m === "background" || m === "remote" || m === "widget" || m === "call"
    ? m
    : "local"
```

Add the routing block immediately **after** the existing `if (mode === "remote") { ... }` block (so it sits after the `if (!session) return <PanelLogin .../>` gate — `call` mode requires a session, else the login screen shows):
```tsx
  if (mode === "call") {
    return <CallWindowPhone phoneNumbers={phoneNumbers} />
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Manual render check**

Run: `npm run dev`
Visit `http://localhost:3000/panel?mode=call` in a browser where the panel session exists (sign in at `/panel` first if needed). Expected: a centered card area showing "No active call" (idle). This confirms the view mounts and requests state without errors (check the console).

- [ ] **Step 5: Commit**

```bash
git add components/calls/panel/call-window-phone.tsx components/calls/panel/panel-app.tsx
git commit -m "feat(panel): add mode=call full-window softphone view"
```

---

## Task 5: Extension window host (`call-window.html` + `call-window.js`)

**Files:**
- Create: `extension/call-window.html`
- Create: `extension/call-window.js`

**Interfaces:**
- Consumes: `chrome.runtime` messages `{ kind: "panel-event", payload }` (in) and emits `{ kind: "panel-command", payload }` (out) — identical contract to `popup.js`. Loads `/panel?mode=call`.
- Produces: a self-positioning top-right popup window host.

- [ ] **Step 1: Create the host page**

Create `extension/call-window.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        width: 100%;
        height: 100%;
      }
      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
      }
    </style>
  </head>
  <body>
    <iframe
      src="http://localhost:3000/panel?mode=call"
      allow="microphone; autoplay"
    ></iframe>
    <script src="call-window.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the bridge + positioning script**

Create `extension/call-window.js`:

```js
// Shell around the incoming-call window: bridges the panel card's PanelCommands
// out to the background phone and forwards PanelEvents in — same contract as
// popup.js. On load it parks the window in the top-right corner of the primary
// display (geometry the service worker can't see).
const iframe = document.querySelector("iframe")
// Match whatever origin the iframe loads (localhost in dev, megestic in prod).
const PANEL_ORIGIN = new URL(iframe.src).origin

async function parkTopRight() {
  try {
    const win = await chrome.windows.getCurrent()
    const margin = 16
    const availLeft = window.screen.availLeft ?? 0
    const availTop = window.screen.availTop ?? 0
    const width = win.width ?? 360
    const left = Math.round(availLeft + window.screen.availWidth - width - margin)
    const top = Math.round(availTop + margin)
    await chrome.windows.update(win.id, { left, top, focused: true })
  } catch (e) {
    console.warn("call-window park failed:", e)
  }
}
parkTopRight()

// Commands out of the card → background phone (via offscreen doc).
window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type !== "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-command", payload: msg }).catch(() => {})
})

// Events in → the card iframe.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  iframe.contentWindow.postMessage(message.payload, PANEL_ORIGIN)
})
```

- [ ] **Step 3: Commit**

```bash
git add extension/call-window.html extension/call-window.js
git commit -m "feat(ext): incoming-call window host page + message bridge"
```

---

## Task 6: Service-worker orchestration + remove incoming toast

**Files:**
- Modify: `extension/service-worker.js`

**Interfaces:**
- Consumes: `shouldOpenCallWindow`, `shouldCloseCallWindow` from `./lib/call-window-policy.js`; `chrome.windows.*`.

- [ ] **Step 1: Import the policy**

At the top of `extension/service-worker.js`, add to the imports:

```js
import { shouldOpenCallWindow, shouldCloseCallWindow } from "./lib/call-window-policy.js"
```

- [ ] **Step 2: Remove the unused incoming-notification constant**

Delete the line:
```js
const INCOMING_ID = "hourglass-incoming"
```
(Keep `AUTH_ID` and `MIC_ID`.)

- [ ] **Step 3: Add call-window management helpers**

Add near the other helpers (e.g. just below the `let lastStatus = "idle"` line):

```js
// The dedicated incoming-call popup window, if one is open.
let callWindowId = null

async function openCallWindow() {
  // Reuse an existing window if it's still around (guards repeated state-syncs
  // and create races).
  if (callWindowId !== null) {
    try {
      await chrome.windows.get(callWindowId)
      return
    } catch {
      callWindowId = null
    }
  }
  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL("call-window.html"),
      type: "popup",
      focused: true,
      width: 360,
      height: 250,
    })
    callWindowId = win.id ?? null
  } catch (e) {
    console.error("openCallWindow failed:", e)
  }
}

async function closeCallWindow() {
  if (callWindowId === null) return
  const id = callWindowId
  callWindowId = null
  try {
    await chrome.windows.remove(id)
  } catch {}
}

// If the agent closes the window by hand, forget it (closing does NOT decline —
// the call keeps ringing; the server records a missed call if unanswered).
chrome.windows.onRemoved.addListener((id) => {
  if (id === callWindowId) callWindowId = null
})
```

- [ ] **Step 4: Drop the incoming toast; keep the badge**

In the `chrome.runtime.onMessage` handler for `panel-event`, replace the `incoming` branch:

```js
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
```

with (toast removed, badge kept):

```js
  if (evt.type === "incoming") {
    // The dedicated call window (opened from the state-sync handler below) is now
    // the incoming-call UI; no OS notification toast. Badge still marks the ring.
    chrome.action.setBadgeText({ text: "●" })
    chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" })
  } else if (evt.type === "call-active") {
```

- [ ] **Step 5: Remove the now-dangling `INCOMING_ID` notification clears**

In the same handler, delete the two `chrome.notifications.clear(INCOMING_ID)` lines — one in the `call-active` branch and one in the `call-ended` branch. Keep the `setBadgeText`/`setBadgeBackgroundColor` calls in those branches.

- [ ] **Step 6: Drive window open/close from state transitions**

Replace the `state-sync` branch:

```js
  } else if (evt.type === "state-sync") {
    if (evt.state) {
      lastStatus = evt.state.status
      updateActiveTabWidget()
      if (evt.state.signedIn) {
        chrome.notifications.clear(AUTH_ID)
        if (evt.state.status === "idle") chrome.action.setBadgeText({ text: "" })
      }
    }
  }
```

with:

```js
  } else if (evt.type === "state-sync") {
    if (evt.state) {
      const prevStatus = lastStatus
      const nextStatus = evt.state.status
      lastStatus = nextStatus
      updateActiveTabWidget()
      if (shouldOpenCallWindow(prevStatus, nextStatus)) openCallWindow()
      if (shouldCloseCallWindow(prevStatus, nextStatus)) closeCallWindow()
      if (evt.state.signedIn) {
        chrome.notifications.clear(AUTH_ID)
        if (nextStatus === "idle") chrome.action.setBadgeText({ text: "" })
      }
    }
  }
```

- [ ] **Step 7: Remove the incoming-toast button handler**

Delete the entire `chrome.notifications.onButtonClicked.addListener(...)` block (it only handled the removed `INCOMING_ID` Answer/Decline buttons). Then delete the now-unused `sendCommand` function. **Keep** `openSidePanel` and the `chrome.notifications.onClicked.addListener(...)` block (still used by the `auth-required` / `mic-blocked` notifications).

- [ ] **Step 8: Verify nothing else references removed symbols**

Run: `git grep -n "INCOMING_ID\|sendCommand" extension/service-worker.js`
Expected: no output (both fully removed).

- [ ] **Step 9: Lint the changed file**

Run: `npm run lint`
Expected: PASS with no new errors (in particular, no "unused variable" for `sendCommand`/`INCOMING_ID`).

- [ ] **Step 10: Commit**

```bash
git add extension/service-worker.js
git commit -m "feat(ext): open/close call window on state; remove incoming toast"
```

---

## Task 7: Version bump, package, and end-to-end verification

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Bump the version**

In `extension/manifest.json`, set `"version"` to `"3.1.0"` (new feature). Leave everything else as-is. (If the working tree already carries an earlier uncommitted `manifest.json` edit — a `3.0.1` bump and a `scripting`-permission removal — keep those changes; this step just sets the version to `3.1.0`.)

- [ ] **Step 2: Package the extension**

Run: `npm run package:extension`
Expected output: `Packaged N files -> build/hourglass-call-panel-v3.1.0.zip` and `panel origin: https://www.megestic.com`. The build **fails** if any `http://localhost:3000` leaks into a packaged file — success means `call-window.html`/`call-window.js` were origin-rewritten correctly.

- [ ] **Step 3: Load unpacked for manual testing (dev origin)**

- Run the web app: `npm run dev`.
- In Chrome → `chrome://extensions` → Developer mode → **Load unpacked** → select the `extension/` folder (dev build, points at `localhost:3000`).
- Open the toolbar popup once and sign in so the panel session exists in `localStorage`.

- [ ] **Step 4: Manual E2E — the core scenarios**

Place a **real inbound call** to one of your configured `phone_numbers`, and for each case confirm the behavior:

1. **Extension closed, on another tab / another app / Chrome minimized:** a card pops to the **top-right**, showing the caller number, the `→ Brand (dialed number)` line, and Accept/Decline. (Confirms the whole goal.)
2. **Accept:** the same window switches to the in-call card (mute / hang up); audio works.
3. **Hang up:** the window closes on its own.
4. **Decline:** the window closes; the ring stops.
5. **Missed (let it ring out / caller hangs up):** the window closes on its own.
6. **Close the window by hand while ringing:** the ring continues (window close did **not** decline); the call still appears as a ring/missed in Supabase afterward.
7. **Second call after the first ends:** a fresh window opens (no duplicate/stale window).
8. **Old behavior gone:** confirm there is **no** bottom-right OS notification toast for the incoming call anymore (the ring audio and the toolbar badge dot remain).

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json
git commit -m "chore(ext): bump to 3.1.0 for incoming-call window"
```

- [ ] **Step 6: (Deploy — separate from this plan)**

Reminder for release (not a code step): deploy the web app to megestic.com **after the localStorage auth fix is live**, then upload `build/hourglass-call-panel-v3.1.0.zip` to the Chrome Web Store for review.

---

## Self-Review

**Spec coverage:**
- Corner popup window on inbound call → Tasks 5, 6. ✅
- Reuse existing card (caller + dialed-number/brand + Accept/Decline) → Tasks 3, 4 (`IncomingCallPopup` already renders brand via `companyLabel`/`companyNumber`). ✅
- Becomes live-call screen on answer → Tasks 2, 4 (`InCallCard`). ✅
- Opens regardless of tab/app; self-positions top-right; no new permissions → Task 5. ✅
- Close on end/decline/missed; single instance; manual close ≠ decline → Task 6 (policy Task 1 + `onRemoved`). ✅
- Remove incoming OS toast, keep ring + badge + auth/mic notifications → Task 6. ✅
- Fresh window gets current call state via `request-state` → Task 4 (`send({ cmd: "request-state" })`). ✅
- `mode=call` routing → Task 4. ✅
- Delivery: web deploy + Store repackage + depends on auth fix → Task 7 Step 6 + Global Constraints. ✅
- Unit test the open/close decision matrix → Task 1. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full content; commands have expected output. ✅

**Type consistency:** `InCallCard` and `IncomingCallPopup` `className` props defined in Tasks 2/3 and consumed in Task 4; `shouldOpenCallWindow`/`shouldCloseCallWindow` defined in Task 1 and consumed in Task 6; `CallWindowPhone({ phoneNumbers })` and `PanelMode` `"call"` defined and used in Task 4. ✅

**Non-goals honored:** No native/mobile push; no ringtone/engine changes; in-tab widget behavior preserved (Task 2 is a pure extraction). ✅
