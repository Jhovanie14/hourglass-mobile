# Extension: Popup Dialer + Answer-From-Any-Tab Call Widget — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the MV3 extension from the side-panel model to a toolbar **popup** dialer + a content-script **call widget** that follows the agent to any tab, backed by the existing offscreen WebRTC engine, with a one-time **setup tab** for login + mic grant.

**Architecture:** One engine (offscreen `/panel?mode=background`), many thin remotes. The popup (`/panel?mode=remote`) sends commands; a new compact `/panel?mode=widget` view is injected into tabs by a content script for the live/incoming call; the service worker coordinates and owns "where is the widget" logic. All surfaces talk over the existing postMessage↔`chrome.runtime` bridge (`lib/panel-bus.ts`). The offscreen engine stays the single source of call state (one-phone rule).

**Tech Stack:** Chrome MV3 (service worker as ES module, offscreen document, content scripts, `chrome.notifications`, `chrome.storage.local`), Next.js `/panel` route + React 19 components, `@telnyx/webrtc`, Supabase auth (localStorage-backed panel client), Vitest (node env) for pure logic.

## Global Constraints

- **Do NOT touch server-side call handling.** Out of scope and must remain byte-for-byte unchanged: `app/api/webhooks/telnyx/voice/route.ts` (inbound ring-all), `app/api/calls/presence`, `lib/telnyx/agent-credentials.ts`. This build only adds extension surfaces and a `?mode=widget` view.
- **One-phone rule.** Popup and widget NEVER own call state — they render `state-sync` and send `PanelCommand`s. Only the offscreen `BackgroundPhone` opens a WebRTC connection.
- **Bridge contract is fixed.** Reuse the existing `PanelEvent` / `PanelCommand` / `SerializedCallState` types in `lib/panel-bus.ts`. Do not invent new message shapes for call control; extend only where a step explicitly says so.
- **Dev origin is `http://localhost:3000`; prod origin is `https://www.megestic.com`.** Every iframe `src`, manifest `host_permissions`, `content_scripts.matches`, and `web_accessible_resources.matches` that references the web app must use the dev origin in committed code, with a clearly marked prod-origin swap documented in the final task. The bridge shells already derive `PANEL_ORIGIN` from `iframe.src` — do not hardcode origins in JS.
- **Vitest include** is `lib/**/*.test.ts` today; Task 1 extends it to also cover `extension/**/*.test.ts`. Pure logic lives in `extension/lib/*.js` (ESM) with colocated `*.test.ts`.
- **Scope:** voice core only. No dispositions, no SMS.

---

## File Structure

New files:
- `extension/lib/widget-policy.js` — pure: can a tab host the widget? should the widget be visible for a given state?
- `extension/lib/widget-policy.test.ts` — vitest for the above.
- `extension/lib/setup-policy.js` — pure: does the agent still need first-run setup?
- `extension/lib/setup-policy.test.ts` — vitest.
- `extension/popup.html`, `extension/popup.js` — toolbar popup shell (iframes `?mode=remote`).
- `extension/call-widget.html`, `extension/call-widget.js` — widget iframe shell (iframes `?mode=widget`).
- `extension/content-widget.js` — content script; injects/toggles the widget iframe on a tab.
- `extension/setup.html`, `extension/setup.js` — first-run login + Enable-microphone tab.
- `components/calls/panel/widget-phone.tsx` — compact incoming/active call UI (new `?mode=widget`).

Modified files:
- `vitest.config.ts` — add `extension/**/*.test.ts` to include.
- `components/calls/panel/panel-app.tsx` — route `mode === "widget"`.
- `extension/manifest.json` — `action.default_popup`, `content_scripts`, `web_accessible_resources`, `"type": "module"` SW; remove `side_panel`.
- `extension/service-worker.js` — widget orchestration + setup-gate routing + tab-switch reinjection; drop `sidePanel` calls.

Deleted files:
- `extension/side-panel.html` — replaced by the popup (removed in the final task).

Untouched (reused as-is): `extension/offscreen.html`, `extension/offscreen.js`, `extension/panel.js`, `components/calls/panel/background-phone.tsx`, `components/calls/panel/remote-phone.tsx`, `lib/panel-bus.ts`, `lib/client.ts`.

---

### Task 1: Widget-injection policy (pure logic)

**Files:**
- Modify: `vitest.config.ts`
- Create: `extension/lib/widget-policy.js`
- Test: `extension/lib/widget-policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `canInjectWidget(url: string): boolean` — false for pages a content script can't run on (`chrome://`, `chrome-extension://`, `https://chromewebstore.google.com`, `https://chrome.google.com/webstore`, `about:`, `edge://`, `view-source:`, `file://` PDF), true otherwise.
  - `shouldShowWidget(status: string): boolean` — true when `status` is `"incoming"`, `"ringing"`, `"trying"`, or `"active"`; false for `"idle"`.

- [ ] **Step 1: Extend the vitest include so extension tests run**

Modify `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "extension/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
})
```

- [ ] **Step 2: Write the failing test**

Create `extension/lib/widget-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { canInjectWidget, shouldShowWidget } from "./widget-policy.js"

describe("canInjectWidget", () => {
  it("allows normal http/https pages", () => {
    expect(canInjectWidget("https://app.example.com/leads")).toBe(true)
    expect(canInjectWidget("http://localhost:3000/")).toBe(true)
  })
  it("blocks browser-internal and store pages", () => {
    expect(canInjectWidget("chrome://extensions")).toBe(false)
    expect(canInjectWidget("chrome-extension://abc/side.html")).toBe(false)
    expect(canInjectWidget("https://chromewebstore.google.com/detail/x")).toBe(false)
    expect(canInjectWidget("https://chrome.google.com/webstore/x")).toBe(false)
    expect(canInjectWidget("about:blank")).toBe(false)
    expect(canInjectWidget("edge://settings")).toBe(false)
    expect(canInjectWidget("view-source:https://x.com")).toBe(false)
    expect(canInjectWidget("file:///C:/doc.pdf")).toBe(false)
  })
  it("is false for empty/garbage input", () => {
    expect(canInjectWidget("")).toBe(false)
    expect(canInjectWidget("not a url")).toBe(false)
  })
})

describe("shouldShowWidget", () => {
  it("shows for any live call status", () => {
    for (const s of ["incoming", "ringing", "trying", "active"]) {
      expect(shouldShowWidget(s)).toBe(true)
    }
  })
  it("hides when idle or unknown", () => {
    expect(shouldShowWidget("idle")).toBe(false)
    expect(shouldShowWidget("")).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test -- extension/lib/widget-policy.test.ts`
Expected: FAIL — cannot resolve `./widget-policy.js`.

- [ ] **Step 4: Write the implementation**

Create `extension/lib/widget-policy.js`:

```js
// Pure decisions for where/when the call widget appears. No chrome.* here so it
// unit-tests in plain node.

const BLOCKED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge://",
  "view-source:",
  "file://",
]

const BLOCKED_HOSTS = new Set(["chromewebstore.google.com"])

/** Can a content script run on this tab URL? */
export function canInjectWidget(url) {
  if (typeof url !== "string" || url.length === 0) return false
  for (const p of BLOCKED_PREFIXES) if (url.startsWith(p)) return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  if (BLOCKED_HOSTS.has(parsed.hostname)) return false
  // Legacy webstore path lives on chrome.google.com/webstore.
  if (parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore")) {
    return false
  }
  return true
}

const LIVE = new Set(["incoming", "ringing", "trying", "active"])

/** Should the widget be visible for this serialized call status? */
export function shouldShowWidget(status) {
  return LIVE.has(status)
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test -- extension/lib/widget-policy.test.ts`
Expected: PASS (2 suites, 5 tests).

- [ ] **Step 6: Commit**

```bash
git add vitest.config.ts extension/lib/widget-policy.js extension/lib/widget-policy.test.ts
git commit -m "feat(ext): widget-injection policy (pure)"
```

---

### Task 2: First-run setup gate (pure logic)

**Files:**
- Create: `extension/lib/setup-policy.js`
- Test: `extension/lib/setup-policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `needsSetup(flags: { signedIn: boolean; micGranted: boolean }): boolean` — true unless BOTH are true. Used by the SW to decide "open setup tab" vs "open popup".

- [ ] **Step 1: Write the failing test**

Create `extension/lib/setup-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { needsSetup } from "./setup-policy.js"

describe("needsSetup", () => {
  it("is false only when signed in AND mic granted", () => {
    expect(needsSetup({ signedIn: true, micGranted: true })).toBe(false)
  })
  it("is true if either is missing", () => {
    expect(needsSetup({ signedIn: false, micGranted: true })).toBe(true)
    expect(needsSetup({ signedIn: true, micGranted: false })).toBe(true)
    expect(needsSetup({ signedIn: false, micGranted: false })).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- extension/lib/setup-policy.test.ts`
Expected: FAIL — cannot resolve `./setup-policy.js`.

- [ ] **Step 3: Write the implementation**

Create `extension/lib/setup-policy.js`:

```js
// Pure first-run gate: setup is complete only once the agent has both a session
// and a persisted mic grant. Either missing → route the icon click to setup.
export function needsSetup(flags) {
  return !(Boolean(flags && flags.signedIn) && Boolean(flags && flags.micGranted))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- extension/lib/setup-policy.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add extension/lib/setup-policy.js extension/lib/setup-policy.test.ts
git commit -m "feat(ext): first-run setup gate (pure)"
```

---

### Task 3: `?mode=widget` compact call view (web app)

**Files:**
- Create: `components/calls/panel/widget-phone.tsx`
- Modify: `components/calls/panel/panel-app.tsx:14` (add `"widget"` to `PanelMode`), `:16-20` (accept `widget`), `:69-95` (route it)
- Verify: `npm run typecheck`

**Interfaces:**
- Consumes: `SerializedCallState`, `PANEL_SOURCE`, `isPanelEvent`, `IDLE_STATE` from `@/lib/panel-bus`; `IncomingCallPopup` from `@/components/calls/ui/incoming-call-popup`; `PhoneNumber` from `@/types/calls`.
- Produces: `WidgetPhone({ phoneNumbers }: { phoneNumbers: PhoneNumber[] })` default-exported view; renders nothing when `status === "idle"`.

- [ ] **Step 1: Create the compact widget component**

Create `components/calls/panel/widget-phone.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { Mic, MicOff, PhoneOff } from "lucide-react"
import {
  IDLE_STATE,
  isPanelEvent,
  PANEL_SOURCE,
  type SerializedCallState,
} from "@/lib/panel-bus"
import { IncomingCallPopup } from "@/components/calls/ui/incoming-call-popup"
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
 * Compact "answer from any tab" widget. One-phone rule: never opens WebRTC —
 * renders state-sync from the offscreen engine and sends commands back.
 * phoneNumbers is unused today but kept for parity with the other panel modes
 * and future click-to-dial from the widget.
 */
export function WidgetPhone(_props: { phoneNumbers: PhoneNumber[] }) {
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

  if (state.status === "idle") return null

  if (state.status === "incoming") {
    return (
      <IncomingCallPopup
        callerNumber={state.callerNumber ?? "Unknown"}
        companyLabel={state.companyLabel}
        companyNumber={state.companyNumber}
        busy={false}
        onAnswer={() => send({ cmd: "answer" })}
        onReject={() => send({ cmd: "decline" })}
      />
    )
  }

  if (!inCall) return null

  return (
    <div className="fixed right-6 bottom-6 z-50 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tabular-nums">
          {state.remoteNumber ?? "Unknown"}
        </span>
        <span className="text-xs font-medium text-green-600 tabular-nums dark:text-green-400">
          {duration}
        </span>
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button
          onClick={() => send({ cmd: state.muted ? "unmute" : "mute" })}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium transition hover:bg-muted"
        >
          {state.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {state.muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={() => send({ cmd: "hangup" })}
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

- [ ] **Step 2: Route the new mode in `panel-app.tsx`**

In `components/calls/panel/panel-app.tsx`, change the mode type (line 14) from:

```tsx
type PanelMode = "local" | "background" | "remote"
```

to:

```tsx
type PanelMode = "local" | "background" | "remote" | "widget"
```

Change `getMode` (lines 16-20) from:

```tsx
  const m = new URLSearchParams(window.location.search).get("mode")
  return m === "background" || m === "remote" ? m : "local"
```

to:

```tsx
  const m = new URLSearchParams(window.location.search).get("mode")
  return m === "background" || m === "remote" || m === "widget" ? m : "local"
```

Add the import near the other panel imports (after line 12):

```tsx
import { WidgetPhone } from "./widget-phone"
```

Add the routing branch immediately after the `mode === "background"` block (after line 72, before the `if (!session)` login check), so the widget also renders nothing when signed out:

```tsx
  if (mode === "widget") {
    if (!session) return null
    return <WidgetPhone phoneNumbers={phoneNumbers} />
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add components/calls/panel/widget-phone.tsx components/calls/panel/panel-app.tsx
git commit -m "feat(panel): compact ?mode=widget call view"
```

---

### Task 4: Toolbar popup surface

**Files:**
- Create: `extension/popup.html`, `extension/popup.js`
- Modify: `extension/manifest.json` (add `action.default_popup`)
- Verify: load unpacked in Chrome

**Interfaces:**
- Consumes: the existing bridge relay pattern from `extension/panel.js` (same command-out / event-in wiring, over `chrome.runtime`).
- Produces: a popup that hosts `/panel?mode=remote`.

- [ ] **Step 1: Create the popup HTML**

Create `extension/popup.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        width: 360px;
        height: 560px;
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
      src="http://localhost:3000/panel?mode=remote"
      allow="microphone; autoplay"
    ></iframe>
    <script src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the popup bridge**

Create `extension/popup.js` (identical relay pattern to `panel.js`; separate file so surfaces stay independent):

```js
// Shell around the popup remote UI: relays its PanelCommands to the background
// phone, and forwards PanelEvents (state-sync etc.) into it.
const iframe = document.querySelector("iframe")
// Match whatever origin the iframe actually loads (localhost in dev, megestic in
// prod). Hardcoding it breaks the message bridge whenever the two drift apart.
const PANEL_ORIGIN = new URL(iframe.src).origin

window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type !== "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-command", payload: msg }).catch(() => {})
})

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  iframe.contentWindow.postMessage(message.payload, PANEL_ORIGIN)
})
```

- [ ] **Step 3: Wire the popup into the action**

In `extension/manifest.json`, replace the `action` block so it opens the popup (keep the icons):

```json
  "action": {
    "default_title": "Open Hourglass Call Panel",
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icon16.png",
      "48": "icon48.png",
      "128": "icon128.png"
    }
  },
```

(Do NOT remove `side_panel` yet — the SW still references it until Task 6.)

- [ ] **Step 4: Manual verification**

1. `chrome://extensions` → Reload the unpacked extension.
2. Ensure the dev server is running (`npm run dev`) and you are logged in in a `localhost:3000` tab once so `hg-panel-auth` exists.
3. Click the toolbar icon → the popup opens showing the Call Panel (online toggle + From/To + Call).
4. Toggle Online → it flips (state round-trips through the offscreen engine).
Expected: popup renders and the toggle responds. (Dial is verified end-to-end in Task 6.)

- [ ] **Step 5: Commit**

```bash
git add extension/popup.html extension/popup.js extension/manifest.json
git commit -m "feat(ext): toolbar popup hosting the remote dialer"
```

---

### Task 5: Call-widget iframe shell + content-script injection

**Files:**
- Create: `extension/call-widget.html`, `extension/call-widget.js`, `extension/content-widget.js`
- Modify: `extension/manifest.json` (add `content_scripts`, `web_accessible_resources`, `host_permissions`)
- Verify: load unpacked; observe injection

**Interfaces:**
- Consumes: `chrome.runtime` messages `{ kind: "widget-visibility", show: boolean }` (broadcast by the SW in Task 6) and the existing `panel-event`/`panel-command` relay.
- Produces:
  - `call-widget.html` hosting `/panel?mode=widget`, injected as an iframe with id `hourglass-call-widget`.
  - `content-widget.js` that shows/hides that iframe on `widget-visibility`.

- [ ] **Step 1: Create the widget iframe shell HTML**

Create `extension/call-widget.html` (transparent; the React view draws its own card):

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
        background: transparent;
      }
      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: transparent;
      }
    </style>
  </head>
  <body>
    <iframe
      src="http://localhost:3000/panel?mode=widget"
      allow="microphone; autoplay"
    ></iframe>
    <script src="call-widget.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the widget iframe bridge**

Create `extension/call-widget.js` (same relay as popup/panel; this iframe lives inside the injected content-script iframe but is itself an extension page, so it has `chrome.runtime`):

```js
// Shell around the widget UI iframe. Relays its PanelCommands out and forwards
// PanelEvents in, over chrome.runtime — same contract as the popup shell.
const iframe = document.querySelector("iframe")
const PANEL_ORIGIN = new URL(iframe.src).origin

window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type !== "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-command", payload: msg }).catch(() => {})
})

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  iframe.contentWindow.postMessage(message.payload, PANEL_ORIGIN)
})
```

- [ ] **Step 3: Create the content script**

Create `extension/content-widget.js`:

```js
// Injected on normal web pages. Owns a single floating iframe that hosts the
// call widget (call-widget.html, an extension page). The service worker tells us
// when to show/hide it via chrome.runtime messages. The widget carries no call
// state itself — it's the offscreen engine's remote.
const WIDGET_ID = "hourglass-call-widget"

function ensureFrame() {
  let frame = document.getElementById(WIDGET_ID)
  if (frame) return frame
  frame = document.createElement("iframe")
  frame.id = WIDGET_ID
  frame.src = chrome.runtime.getURL("call-widget.html")
  frame.allow = "microphone; autoplay"
  // The React card positions itself (fixed, bottom-right); this host frame just
  // needs to float above the page and pass clicks through its transparent area.
  frame.style.cssText = [
    "position:fixed",
    "right:0",
    "bottom:0",
    "width:340px",
    "height:220px",
    "border:0",
    "z-index:2147483647",
    "background:transparent",
    "color-scheme:normal",
  ].join(";")
  document.documentElement.appendChild(frame)
  return frame
}

function setVisible(show) {
  if (!show) {
    const frame = document.getElementById(WIDGET_ID)
    if (frame) frame.remove()
    return
  }
  ensureFrame()
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "widget-visibility") return
  setVisible(Boolean(message.show))
})

// On (re)injection into a freshly-focused tab, ask the SW whether a call is live
// so we re-show the widget when the agent switches tabs mid-call.
chrome.runtime.sendMessage({ kind: "widget-hello" }).catch(() => {})
```

- [ ] **Step 4: Declare content script, web-accessible resource, and host permission**

In `extension/manifest.json`, set `host_permissions` and add the two blocks. Final relevant fields:

```json
  "permissions": ["sidePanel", "notifications", "offscreen", "storage", "tabs", "scripting"],
  "host_permissions": ["http://localhost:3000/*", "https://www.megestic.com/*"],
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["content-widget.js"],
      "run_at": "document_idle",
      "all_frames": false
    }
  ],
  "web_accessible_resources": [
    {
      "resources": ["call-widget.html"],
      "matches": ["http://*/*", "https://*/*"]
    }
  ],
```

(`storage`, `tabs`, `scripting` are needed by the SW in Tasks 6-7. `sidePanel` stays until Task 8.)

- [ ] **Step 5: Manual verification**

1. Reload the unpacked extension. Open a normal `https://` page (e.g. `https://example.com`).
2. DevTools console on that page: run
   `chrome.runtime.sendMessage` is not available in the page — instead verify injection by running in the extension service-worker console:
   `chrome.tabs.query({active:true,currentWindow:true},([t])=>chrome.tabs.sendMessage(t.id,{kind:"widget-visibility",show:true}))`
3. Expected: a floating card iframe appears bottom-right on the page (it will render empty/null because no call is active — that's correct; the frame exists).
4. Send `show:false` the same way → the frame is removed.

- [ ] **Step 6: Commit**

```bash
git add extension/call-widget.html extension/call-widget.js extension/content-widget.js extension/manifest.json
git commit -m "feat(ext): content-script call widget + iframe shell"
```

---

### Task 6: Service-worker orchestration (widget + one-phone wiring)

**Files:**
- Modify: `extension/manifest.json` (SW as ES module)
- Modify: `extension/service-worker.js` (import policies; track call state; drive widget visibility; re-inject on tab switch)
- Verify: end-to-end inbound + outbound manual scenarios

**Interfaces:**
- Consumes: `shouldShowWidget`, `canInjectWidget` from `./lib/widget-policy.js`; existing `panel-event`/`panel-command` relay; new `widget-hello` from the content script; `state-sync` events carry `SerializedCallState`.
- Produces: broadcasts `{ kind: "widget-visibility", show }` to the active tab; keeps `lastStatus` (latest call status string) in SW memory.

- [ ] **Step 1: Make the service worker an ES module**

In `extension/manifest.json`:

```json
  "background": { "service_worker": "service-worker.js", "type": "module" },
```

- [ ] **Step 2: Add widget orchestration to the service worker**

Edit `extension/service-worker.js`. Add the import at the very top (line 1):

```js
import { canInjectWidget, shouldShowWidget } from "./lib/widget-policy.js"
```

Add, just below the existing `const MIC_ID = "hourglass-mic"` line, a place to remember the latest call status:

```js
let lastStatus = "idle"
```

Add a helper to push widget visibility to the active tab (place it next to `openSidePanel`):

```js
async function updateActiveTabWidget() {
  const show = shouldShowWidget(lastStatus)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id || !canInjectWidget(tab.url || "")) return
  chrome.tabs
    .sendMessage(tab.id, { kind: "widget-visibility", show })
    .catch(() => {})
}
```

In the existing `chrome.runtime.onMessage` listener that handles `panel-event`, record status from `state-sync` and refresh the widget. Add this branch alongside the others (e.g. after the `state-sync` branch that clears the auth notification):

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

(Replace the current `state-sync` branch with the version above — it now also tracks `lastStatus` and drives the widget. Keep the `incoming`/`call-active`/`call-ended` notification branches as they are.)

Add a listener so a freshly-focused/reloaded tab re-syncs the widget when it says hello, and when the active tab changes mid-call:

```js
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.kind !== "widget-hello") return
  if (!sender.tab || !sender.tab.id) return
  if (!canInjectWidget(sender.tab.url || "")) return
  chrome.tabs
    .sendMessage(sender.tab.id, {
      kind: "widget-visibility",
      show: shouldShowWidget(lastStatus),
    })
    .catch(() => {})
})

chrome.tabs.onActivated.addListener(() => updateActiveTabWidget())
```

- [ ] **Step 3: Typecheck the extension policy import resolves (sanity)**

Run: `npm run test -- extension/lib/widget-policy.test.ts`
Expected: PASS (unchanged) — confirms the module the SW imports is valid ESM.

- [ ] **Step 4: Manual end-to-end verification**

Preconditions: dev server running, logged in once on `localhost:3000`, mic granted (from a tab), extension reloaded.

Outbound:
1. Open a normal `https://` page. Click the toolbar icon → popup → enter an E.164 number → Call.
2. Close the popup immediately.
3. Expected: the floating widget appears on the page showing the active call + timer; Hang Up ends it and the widget disappears.

Inbound:
4. Place a call to your inbound DID while Online.
5. Expected: notification (Answer/Decline) AND the widget appears on the active tab with Answer/Decline.
6. Click Answer (widget) → two-way audio; widget shows active call; Hang Up works.

Tab switch mid-call:
7. During an active call, switch to another normal tab.
8. Expected: the widget appears on the newly-focused tab (single instance).

- [ ] **Step 5: Commit**

```bash
git add extension/manifest.json extension/service-worker.js
git commit -m "feat(ext): SW drives call widget across tabs (one engine, many remotes)"
```

---

### Task 7: First-run setup tab (login + Enable microphone)

**Files:**
- Create: `extension/setup.html`, `extension/setup.js`
- Modify: `extension/service-worker.js` (setup-gate routing on icon click; recreate offscreen after setup)
- Modify: `extension/manifest.json` (add `setup.html` to `web_accessible_resources`)
- Verify: fresh-profile manual run

**Interfaces:**
- Consumes: `needsSetup` from `./lib/setup-policy.js`; `chrome.storage.local` key `hg-setup-complete` (boolean); the panel's `state-sync.signedIn`.
- Produces: a setup tab that logs in + captures the mic grant, then sets `hg-setup-complete = true` and reloads the offscreen doc.

- [ ] **Step 1: Create the setup HTML**

Create `extension/setup.html`:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        height: 100%;
        font-family: system-ui, sans-serif;
      }
      .wrap {
        display: grid;
        grid-template-rows: 1fr auto;
        height: 100vh;
      }
      iframe {
        width: 100%;
        height: 100%;
        border: 0;
      }
      .bar {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 16px;
        border-top: 1px solid #e5e7eb;
      }
      button {
        padding: 8px 14px;
        border-radius: 8px;
        border: 1px solid #d1d5db;
        background: #111827;
        color: #fff;
        cursor: pointer;
      }
      #mic-status {
        font-size: 14px;
        color: #374151;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <iframe
        id="panel"
        src="http://localhost:3000/panel?mode=remote"
        allow="microphone; autoplay"
      ></iframe>
      <div class="bar">
        <button id="enable-mic">Enable microphone</button>
        <span id="mic-status">Step 2: click to grant microphone access.</span>
      </div>
    </div>
    <script src="setup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create the setup logic**

Design constraint that drives this file: the mic grant must be captured **inside the web-app iframe's origin** (so it lands in the same partition the offscreen engine reads), and it must be prompted **from a real tab** (the only surface that can show the prompt). We do NOT call `getUserMedia` from `setup.js` directly — that would be the wrong origin (extension page) and cross-origin access into the iframe is blocked. Instead:

- The embedded panel (`mode=remote` = `RemotePhone`) already renders a **"Microphone blocked — click to grant access"** button that calls `getUserMedia()` from within the panel origin (see `remote-phone.tsx:125-138`). In a tab, that prompt shows and the grant persists for the correct partition.
- `setup.js` is pure glue: relay the bridge, drive the on-screen instructions, and treat the panel's own `state-sync` (`signedIn === true && micBlocked === false`) as the single source of truth that setup is done. The "Enable microphone" button just nudges the panel to re-probe via `request-state`.

Create `extension/setup.js`:

```js
// First-run tab. Login + mic grant both happen INSIDE the embedded panel
// (correct origin/partition); a real tab is the only surface where the mic
// prompt can show. setup.js is glue: relay the bridge, nudge a re-probe, and
// treat the panel's own state-sync as the source of truth that setup is done.
const iframe = document.getElementById("panel")
const PANEL_ORIGIN = new URL(iframe.src).origin
const statusEl = document.getElementById("mic-status")
let completed = false

// Relay panel commands out and panel events in, like the other shells, so login
// and the online toggle round-trip while the agent is here.
window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type !== "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-command", payload: msg }).catch(() => {})
})

chrome.runtime.onMessage.addListener(async (message) => {
  if (!message || message.kind !== "panel-event") return
  const evt = message.payload
  iframe.contentWindow.postMessage(evt, PANEL_ORIGIN)
  if (
    !completed &&
    evt &&
    evt.type === "state-sync" &&
    evt.state &&
    evt.state.signedIn &&
    !evt.state.micBlocked
  ) {
    completed = true
    await chrome.storage.local.set({ "hg-setup-complete": true })
    chrome.runtime.sendMessage({ kind: "setup-complete" }).catch(() => {})
    statusEl.textContent =
      "Signed in + microphone ready — setup complete. You can close this tab."
  }
})

// Button nudges the panel to re-probe the mic (its request-state handler calls
// probeMic). If the mic is still blocked, the in-panel "grant access" button is
// what actually shows the prompt.
document.getElementById("enable-mic").addEventListener("click", () => {
  statusEl.textContent =
    "If prompted, choose Allow. If a red 'grant access' button shows in the panel, click it."
  iframe.contentWindow.postMessage(
    { source: "hourglass-panel", type: "cmd", cmd: "request-state" },
    PANEL_ORIGIN
  )
})
```

- [ ] **Step 3: Route the icon to setup when needed, and handle completion (service worker)**

In `extension/service-worker.js`, add the import at the top:

```js
import { needsSetup } from "./lib/setup-policy.js"
```

Add a helper to open setup and a completion handler (near `openSidePanel`):

```js
async function openSetup() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") })
}

async function isSetupComplete() {
  const { "hg-setup-complete": done } = await chrome.storage.local.get(
    "hg-setup-complete"
  )
  return Boolean(done)
}
```

Add a message branch for `setup-complete` (in the `widget-hello` listener block or a new listener) that reloads the offscreen engine so it re-reads the session/grant:

```js
chrome.runtime.onMessage.addListener(async (message) => {
  if (!message || message.kind !== "setup-complete") return
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument()
  } catch {}
  ensureOffscreen()
})
```

Because the popup opens automatically via `default_popup`, gate it: keep `default_popup` for the normal case, and on install force setup. Add to the existing `onInstalled` handler:

```js
chrome.runtime.onInstalled.addListener(async () => {
  ensureOffscreen()
  if (needsSetup({ signedIn: false, micGranted: await isSetupComplete() })) {
    openSetup()
  }
})
```

(On first install `hg-setup-complete` is unset → `needsSetup` is true → the setup tab opens. After completion the flag is set and the popup is the normal entry point. A "Finish setup" affordance can be added to the popup later; not required for this task.)

- [ ] **Step 4: Expose setup.html as a web-accessible resource**

In `extension/manifest.json`, add `setup.html` to the resources list:

```json
  "web_accessible_resources": [
    {
      "resources": ["call-widget.html", "setup.html"],
      "matches": ["http://*/*", "https://*/*"]
    }
  ],
```

- [ ] **Step 5: Manual verification (fresh profile)**

1. Remove the extension, then load unpacked again (simulates first install) → a **setup tab** opens automatically.
2. In the setup tab: sign in via the embedded panel. If it shows "Microphone blocked — click to grant access", click it → Chrome prompt appears → Allow.
3. Expected: status line reads "Signed in + microphone ready — setup complete."
4. Reload the extension → the setup tab does NOT reopen (flag persisted); clicking the icon opens the popup dialer.

- [ ] **Step 6: Commit**

```bash
git add extension/setup.html extension/setup.js extension/service-worker.js extension/manifest.json
git commit -m "feat(ext): first-run setup tab for login + mic grant"
```

---

### Task 8: Retire the side panel + finalize manifest

**Files:**
- Delete: `extension/side-panel.html`
- Modify: `extension/manifest.json` (remove `side_panel`, drop `sidePanel` permission)
- Modify: `extension/service-worker.js` (remove `sidePanel` calls; open the popup instead where a surface is needed)
- Verify: full acceptance pass + prod-origin note

**Interfaces:**
- Consumes: nothing new.
- Produces: a manifest with no side-panel surface; notification clicks open the popup.

- [ ] **Step 1: Remove side-panel wiring from the service worker**

In `extension/service-worker.js`:

- Delete the `chrome.sidePanel.setPanelBehavior(...)` call inside `onInstalled`.
- Replace the `openSidePanel()` function body so notification actions open the popup instead:

```js
async function openSidePanel() {
  // Notifications/answer actions are user gestures, so we can open the popup.
  try {
    await chrome.action.openPopup()
  } catch (e) {
    console.warn("openPopup failed:", e)
  }
}
```

(Leave call sites — `onClicked`, the Answer button handler — unchanged; they now open the popup. `chrome.action.openPopup()` requires Chrome 127+; `minimum_chrome_version` is already 114, so bump it in Step 2.)

- [ ] **Step 2: Finalize the manifest**

In `extension/manifest.json`:
- Remove the `"side_panel"` block.
- Remove `"sidePanel"` from `permissions` (leaving `["notifications", "offscreen", "storage", "tabs", "scripting"]`).
- Set `"minimum_chrome_version": "127"` (for `chrome.action.openPopup`).
- Bump `"version"` to `"3.0.0"`.

- [ ] **Step 3: Delete the side panel file**

```bash
git rm extension/side-panel.html
```

- [ ] **Step 4: Full acceptance pass**

Run the spec's manual scenarios end-to-end:
1. Fresh install → setup tab → login + mic → persists across extension reload.
2. Everything closed → inbound call → notification + widget → Answer from widget → audio.
3. Inbound on a `chrome://` page → notification only → Answer opens the popup.
4. Active call → switch tabs → widget follows, single instance.
5. Icon → popup → dial → close popup → call continues in widget → Hang Up.
6. Revoke mic in site settings → next call → "Microphone blocked" → re-grant via setup.
7. Log out in popup → `auth-required` badge; no ring until re-login.

- [ ] **Step 5: Document the prod-origin swap**

Append to `docs/superpowers/plans/2026-07-03-extension-popup-call-widget.md` a short "Prod build" note (or create `extension/PROD-ORIGIN.md`) listing every dev→prod origin change required before shipping to `www.megestic.com`:
- `extension/popup.html` iframe `src`
- `extension/call-widget.html` iframe `src`
- `extension/setup.html` iframe `src`
- `extension/manifest.json`: `host_permissions` (keep only the prod origin), `content_scripts.matches`, `web_accessible_resources.matches` (unchanged — already `*`)
- Verify the same localStorage-panel-client fix (`lib/client.ts`) is deployed on `www.megestic.com`.

- [ ] **Step 6: Commit**

```bash
git add -A extension docs/superpowers/plans/2026-07-03-extension-popup-call-widget.md
git commit -m "feat(ext): retire side panel; popup + widget become the surfaces"
```

---

## Self-Review

**Spec coverage:**
- Popup login/dialer/settings → Task 4 (+ reuses `RemotePhone`). ✓
- Offscreen background engine unchanged → confirmed untouched. ✓
- Content-script "answer from any tab" widget → Tasks 3 (view) + 5 (injection) + 6 (orchestration). ✓
- One-time setup tab (login + mic grant) → Task 7. ✓
- Incoming data flow (notification + widget; Answer both places) → Task 6 (kept notification branches, added widget). ✓
- Outbound data flow (popup dial, close popup, widget carries call) → Task 6 Step 4. ✓
- Error handling: mic-blocked re-grant → Task 7 (setup re-open path) / RemotePhone grant button; no-injectable-tab fallback → notification retained (Task 6); offscreen reclaimed → `ensureOffscreen` retained; single widget instance / tab switch → Task 6. ✓
- Testing: pure logic (widget policy, setup gate) → Tasks 1-2 TDD; manual acceptance → Tasks 6-8. ✓
- Regression guard (server untouched) → Global Constraints + no task touches server files. ✓
- Prod-origin swap → Task 8 Step 5. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. Task 7 Step 2 contains a deliberate correction narrative (cross-origin caveat) ending in the concrete final implementation — the last code block is what ships.

**Type consistency:** `canInjectWidget`/`shouldShowWidget`/`needsSetup` signatures match across Tasks 1, 2, 6, 7. Message kinds (`panel-command`, `panel-event`, `widget-visibility`, `widget-hello`, `setup-complete`) are used consistently. `SerializedCallState.status` values match `shouldShowWidget`'s live set (`incoming`/`ringing`/`trying`/`active`) and the bridge's `CallStatus`.

**Known follow-ups (out of scope, noted for planning):** widget `content_scripts.matches` is broad (`http/https *`) per the "any tab" requirement — revisit if the client wants to scope to specific CRM domains; a "Finish setup" button in the popup for the re-grant path could replace the auto-open-on-install heuristic.
