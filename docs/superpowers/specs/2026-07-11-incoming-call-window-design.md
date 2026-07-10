# Incoming-Call Popup Window — Design Spec

**Date:** 2026-07-11
**Status:** Draft for review
**Author:** Jhovanie + Claude

## Problem

Today, when a call arrives, the extension only **rings** (audio from the
offscreen phone) and shows an easily-missed OS notification toast. To answer,
the agent must manually click the toolbar icon to open the panel. If the agent
is on another browser tab, in another app, or has Chrome minimized, they hear
the ring but see nothing actionable — calls get missed.

## Goal

The instant a call rings, a **softphone card pops up on its own** in the
top-right corner of the screen — regardless of which tab or app is focused, or
whether the extension panel is open — showing:

- "Incoming call"
- The **caller's number** (e.g. `+15039758026`)
- **Which of our numbers they dialed + its brand label** (e.g.
  `→ Ellen Marketing NY (+19143504966)`)
- **Accept / Decline** buttons

Answering turns the same window into the live-call screen (mute / hang up).
When the call ends, is declined, missed, or answered elsewhere, the window
closes itself.

Reference mockup: a compact top-right card, softphone-style (see chat image).

## Non-goals

- **Calls while Chrome is fully quit.** The phone lives inside Chrome's
  offscreen document; if Chrome is completely closed, nothing rings at all —
  this is already true today and unchanged. Ringing while Chrome is closed would
  require a native/mobile push path (separate project).
- Redesigning the panel, ringtone, or call engine.
- The in-tab widget keeps working unchanged. The **incoming-call OS notification
  toast is being removed** (the new window replaces it); the `auth-required` and
  `mic-blocked` notifications stay.

## Key facts grounding the design (verified in code)

- The offscreen **background phone** (`components/calls/panel/background-phone.tsx`)
  owns the one WebRTC connection, plays the ring, and mirrors call state to the
  extension via `postMessage` → `chrome.runtime`.
- Any panel "remote" surface, on mount, sends `{ cmd: "request-state" }`; the
  background phone replies with a full `state-sync` (status, `callerNumber`,
  `companyLabel`, `companyNumber`, …). So a **freshly-opened window immediately
  learns about an in-progress incoming call** and renders the card. (Verified:
  `background-phone.tsx` L167–170; `remote-phone.tsx` L58; `widget-phone.tsx` L47.)
- `WidgetPhone` (`mode=widget`) is **already the exact clean card view we want**:
  renders nothing when idle → `IncomingCallPopup` (caller + brand + Accept/Decline)
  when incoming → compact mute/hang-up card when in-call.
- `IncomingCallPopup` already shows the dialed-number + brand line via
  `companyLabel`/`companyNumber`, sourced from the `phone_numbers` table
  (`use-inbound-phone.ts`). **No new "where they called" work needed.**
- The panel must run on the deployed web origin (localhost in dev,
  `https://www.megestic.com` in prod) so it shares the `hg-panel-auth`
  localStorage session. **This feature depends on the localStorage auth fix
  (branch `fix/panel-auth-localstorage-persistence`) being deployed.**

## Approach

Reuse the existing "remote surface" pattern (same as the toolbar popup and the
in-tab widget): a small **extension-owned window** that hosts the panel web UI in
an iframe and bridges its messages to the background phone. The service worker
opens/closes this window based on call state.

Rejected alternatives:
- **In-page content overlay only** — can't show on non-web tabs (`chrome://`,
  New Tab, PDFs) or when Chrome isn't the focused app. Fails the core goal.
- **Auto-open the toolbar popup** — Chrome forbids `chrome.action.openPopup()`
  without a user gesture; not possible on an inbound event.

## Components

### 1. Extension: window host (new)

- **`extension/call-window.html`** — minimal page sized to the card
  (~`360×230`), hosting `<iframe src="http://localhost:3000/panel?mode=call">`.
  (The package script rewrites the origin to prod at build time; the guard
  already fails the build if any dev origin leaks.)
- **`extension/call-window.js`** — the same postMessage↔`chrome.runtime` bridge
  as `popup.js`/`call-widget.js` (relay panel commands out, panel events in).
  On load, self-positions to the top-right using `window.screen.availWidth` /
  `availTop` + `window.moveTo(...)`, so **no new permissions** are required
  (`chrome.windows` needs none; we avoid `system.display`).

### 2. Extension: service-worker orchestration (`service-worker.js`)

- On `panel-event` `incoming`: **open the call window** if not already open —
  `chrome.windows.create({ url: "call-window.html", type: "popup",
  focused: true, width, height })`. Track the created `windowId`.
- **Single instance:** before creating, verify any tracked window still exists
  (`chrome.windows.get`); reuse if so. Guard against the repeated `incoming`
  events / state-syncs opening duplicates.
- On `call-ended` (or a `state-sync` returning to `idle` after being non-idle):
  **close the window** (`chrome.windows.remove(windowId)`), clear the tracked id.
- Listen to `chrome.windows.onRemoved` to clear the tracked id if the user
  closes it manually.
- **Remove the incoming-call OS notification toast** (the `INCOMING_ID`
  `chrome.notifications.create` on the `incoming` event, plus its
  `onButtonClicked`/`onClicked` answer handlers) — the popup window replaces it.
  Keep the **ring audio** and the **badge**. Keep the `auth-required` and
  `mic-blocked` notifications untouched.

### 3. Extension: pure policy module (new, unit-tested)

- **`extension/lib/call-window-policy.js`** — no `chrome.*`, mirrors the
  `widget-policy.js` pattern for testability. Exposes pure decisions:
  - `shouldOpenCallWindow(prevStatus, nextStatus)` → true on transition into
    `incoming` (and defensively when a call becomes `active` with no window,
    e.g. answered from the OS notification).
  - `shouldCloseCallWindow(prevStatus, nextStatus)` → true on transition to
    `idle` from any non-idle status.
- **`extension/lib/call-window-policy.test.ts`** — covers the transition matrix
  (idle→incoming opens; incoming→active keeps open; active→idle closes;
  incoming→idle (missed/declined) closes; idle→idle no-op; repeated incoming
  does not re-open).

### 4. Web app: a `call` panel mode (small)

- Add `"call"` to `PanelMode` in `panel-app.tsx`, routing to a card view that
  **reuses `IncomingCallPopup` and the compact in-call card**, but renders the
  card to **fill the small window** (remove the `fixed right-6 bottom-6`
  corner-anchoring used by the in-tab widget; center/stretch to the window
  instead). Simplest implementation: a thin `CallWindowPhone` that reuses the
  same subcomponents as `WidgetPhone` with window-fill layout, or a layout prop
  on the shared card. Requires an authenticated session (same as `remote`);
  shows `PanelLogin` if signed out.
- Optional polish to match the mockup exactly (not required for function):
  "Accept" wording, logo, and a "Show more" affordance. Track separately.

## Data & control flow

```
inbound call → offscreen background phone (ring + state)
   → postMessage → offscreen.js → chrome.runtime "panel-event: incoming"
      → service worker: open call-window.html (top-right, focused)
         → call-window.js loads /panel?mode=call (shares hg-panel-auth session)
            → card view sends {cmd: request-state}
               → background phone replies state-sync (caller, brand, dialed #)
                  → card renders: caller + "→ Brand (number)" + Accept/Decline
Accept/Decline click → card → call-window.js → chrome.runtime "panel-command"
   → offscreen.js → background phone executes answer/decline
call ends → "panel-event: call-ended" → service worker closes the window
```

## Lifecycle decisions

- **Focus:** window opens `focused: true` and comes to the front (the point is
  to be unmissable). OS focus-stealing rules may sometimes flash the taskbar
  instead of full foreground; acceptable.
- **Manual close while ringing:** closing the window does **not** decline the
  call (avoids accidental drops). The ring continues until the call is answered
  or times out. An unanswered call — including when Chrome is closed — is
  recorded as a missed/ring by the **server-side Telnyx webhook** (the single
  source of truth in Supabase), which the window plays no part in; closing it
  therefore cannot corrupt call records.
- **Answered elsewhere:** if answered from the toolbar popup or in-tab widget
  while the window is open, the window shows the live-call card (state-sync
  driven). If a call is answered before the window exists, the defensive
  `active`-with-no-window rule still opens it as the call screen.
- **Reuse for the next call:** window is torn down on `idle`; the next `incoming`
  creates a fresh one.

## Testing

- **Unit:** `call-window-policy.test.ts` for the open/close transition matrix
  (pure, runs under vitest like the existing `widget-policy.test.ts`).
- **Manual E2E (real Chrome profile):** with the extension panel closed and the
  agent on (a) another tab, (b) a `chrome://` page, (c) another app with Chrome
  minimized — place an inbound call and confirm the card pops to the top-right,
  shows caller + brand, and Accept/Decline work; verify the window closes on
  hang-up, decline, and missed call; verify a second call reuses one window.

## Delivery

Two channels (as with the earlier auth work):
- **Web app** (`panel-app.tsx` + card view) ships by deploying megestic.com.
- **Extension** (`call-window.*`, `service-worker.js`, policy module) ships by
  `npm run package:extension` → upload the new versioned zip to the Chrome Web
  Store → **Store review required**. Bump `manifest.json` version accordingly.
- The window's panel iframe relies on the **localStorage auth fix being live**,
  so deploy that first.

## Open questions / risks

- **Cold-load latency:** the window loads the web app fresh each ring; if slow,
  the card appears a beat late. Mitigation: ring window is ~20–30s; acceptable.
  Revisit (pre-warm) only if it feels laggy in testing.
- **OS focus-stealing** behavior varies by OS/settings; the window may flash
  rather than fully foreground when another app is fullscreen.
- **Window creation failure:** with the incoming toast removed, the popup window
  is the only visual alert (ring still plays). If `chrome.windows.create` ever
  fails, the agent gets audio only. Log failures; revisit a fallback only if it
  proves flaky in testing.
