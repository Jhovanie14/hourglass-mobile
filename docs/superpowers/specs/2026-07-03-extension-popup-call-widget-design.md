# Extension: Popup Dialer + "Answer From Any Tab" Call Widget

**Date:** 2026-07-03
**Status:** Approved design — ready for implementation planning
**Scope:** Voice core only. Dispositions (Busy/No-Answer/Answered + notes) and SMS/Inbox are **separate follow-up specs**.

## Goal

Rework the Chrome MV3 extension from the current **side-panel** model to the
**smrtPhone-style** model the client asked for:

- Click the toolbar icon → a **popup** opens with the dialer → place a call.
- The **live/incoming call UI follows the agent to any tab** (a floating
  content-script widget), so it survives the popup closing.
- The **offscreen background phone** stays registered and holds the mic/audio so
  calls ring and connect while the popup is closed.
- **First-run login + microphone grant** happen once in a real browser tab (the
  only surface where a mic permission prompt can actually show).

The client's stated flow: *don't keep the whole panel open just to be reachable —
log in once, close it, get a popup on incoming calls, and open the dialer only
when placing a call.*

## Non-goals (this spec)

- Call dispositions (Busy/No-Answer/Answered chips) and notes — separate spec.
- SMS / Inbox — separate spec (see `docs/sms-multi-brand-todo.md`).
- Any change to server-side call handling: the inbound voice webhook / ring-all
  state machine, `/api/calls/presence`, and agent-credential issuance are **out
  of scope and must remain untouched**. This build only adds extension surfaces
  and a new `?mode=widget` view of the existing `/panel` route.

## Key platform facts this design depends on

1. **The side panel / popup / offscreen doc cannot show a mic permission prompt**
   (no address bar to anchor it → `NotAllowedError: Permission dismissed`). Only
   a **real browser tab** can. This is why first-run mic capture must happen in a
   setup **tab**, not in the popup.
2. **All extension documents share one storage/permission partition.** The
   popup, offscreen doc, and setup tab are all `chrome-extension://<id>/…`
   top-level pages embedding the same web origin (`localhost:3000` in dev /
   `megestic.com` in prod). Same top-level site + same embedded origin = same
   partition. So a mic grant captured **once, anywhere a prompt can show** (a
   tab) is reused by the offscreen engine forever, and `localStorage`
   (`hg-panel-auth`) is shared across all of them.
3. **`getUserMedia` must run in the offscreen engine**, not the widget or popup.
   The widget and popup are pure UI remotes with no mic.
4. **Content scripts cannot inject into every surface** (`chrome://`, the Chrome
   Web Store, the PDF viewer, etc.). The existing **notification** is the
   guaranteed fallback for incoming calls on those pages.

## Architecture — surfaces & responsibilities

One engine, many thin remotes, all talking through the service worker via the
existing postMessage↔`chrome.runtime` bridge.

| Surface | Chrome context | Loads | Job |
|---|---|---|---|
| **Popup** | `action.default_popup` (`popup.html`) | iframe `/panel?mode=remote` | Login + dialer + settings (device picker, online toggle, log out). Opens on icon click; **closes on blur** → holds no call state, only sends commands. |
| **Offscreen engine** | offscreen doc (`USER_MEDIA`, `AUDIO_PLAYBACK`) | iframe `/panel?mode=background` | The one WebRTC phone: SIP registration, mic, audio. Always on. Reused as-is. |
| **Call widget** | content script → injects `call-widget.html` iframe (`/panel?mode=widget`, **new mode**) | Floating "answer from any tab" UI: incoming ring (Answer/Decline), active call (timer, mute, hang up). No mic — pure UI over the engine. |
| **Setup tab** | `setup.html` opened via `chrome.tabs.create` | iframe `/panel?mode=remote` + an **"Enable microphone"** button | One-time first-run: login + capture the mic grant (only surface that can prompt). Reopened later to re-grant if mic is revoked. |
| **Service worker** | background SW | — | Coordinator: keeps offscreen alive, relays commands/events across surfaces, drives the content script to show/hide the widget, badges. Mostly exists today. |

**The one-phone rule (invariant):** the offscreen engine is the single source of
truth for call state. The popup and widget **never own call state** — they render
what the engine reports and send commands back. Closing the popup or switching
tabs never drops a call.

**Main new build:** the content-script **call widget** (+ the `?mode=widget`
view) and the **popup** replacing the side panel. The setup tab is small; the
offscreen engine and SW bridge are largely reused.

## Data flow

### Incoming call → "answer from any tab"

1. Offscreen engine receives the SIP invite → posts `incoming {caller, label}`
   up through its shell → SW.
2. SW does two things in parallel:
   - fires the **notification** (Answer/Decline) — the guaranteed fallback;
   - broadcasts `show-widget {incoming}` to the **content script of the active
     tab**, which injects/reveals `call-widget.html`.
3. Agent clicks **Answer** (from widget or notification button — both are user
   gestures) → `answer` → SW → offscreen engine picks up. Widget switches to the
   active-call view; notification clears; badge goes green.
4. **Hang Up** in the widget → `hangup` → engine ends → SW broadcasts
   `call-ended` → widget removes itself; badge clears.

**Tab-switching during a call:** the widget is per-tab. The SW tracks "there is
an active call" and re-injects the widget into whatever tab becomes active, so it
follows the agent across tabs. Only the **active** tab ever shows a widget
(single instance; the ringer/audio lives only in the one offscreen engine).

### Outbound → click icon, popup, dial

1. Click toolbar icon → **popup** opens (`?mode=remote`), dialer shown (already
   logged in).
2. Type number / pick agent → **Call** → popup sends `dial {number}` → SW →
   offscreen engine originates.
3. Popup may close immediately; the SW broadcasts `call-active` → the **call
   widget** appears so the live call lives on-page, not trapped in the popup.

## First-run: login + one-time mic grant

**Trigger:** when the SW cannot confirm setup is complete, clicking the toolbar
icon (or a "Finish setup" button in the popup) opens `setup.html` in a tab
instead of the dialer popup. "Setup complete" = a flag in `chrome.storage.local`
set once both steps below succeed.

**Two steps in the setup tab** (embeds `/panel?mode=remote`, same partition as
everyone else):

1. **Login** — the panel's existing `PanelLogin`. On success the session lands in
   `localStorage["hg-panel-auth"]`, shared across all extension docs, so the
   offscreen engine and popup see it too.
2. **Enable microphone** — a button that calls `getUserMedia({audio:true})`
   **inside the panel iframe** (web origin, `allow="microphone"`). In a tab the
   prompt anchors to the address bar and works. Grant persists for the shared
   partition → the offscreen engine reuses it silently.

**Login → engine handshake:** the offscreen engine loads at browser startup,
before login, so it starts unauthenticated. It comes online after login via:

- **Primary:** Supabase `onAuthStateChange` + cross-document `storage` events fire
  in the engine iframe when `hg-panel-auth` is written → engine reads the session
  and registers.
- **Belt-and-suspenders:** after setup completes, the SW recreates/reloads the
  offscreen doc so it re-reads the session cleanly. Cheap; removes the timing
  risk.

**After first run:** setup flag set → clicking the icon opens the popup dialer
directly. The setup tab is revisited only if the grant is revoked or the user
logs out.

## Error handling & edge cases

- **Mic missing/revoked at call time** → engine reports `mic-blocked`; the
  widget/notification show a **"Fix microphone"** button that reopens the setup
  tab to re-grant. The call is declined gracefully rather than connecting with
  dead audio.
- **Not logged in when a call arrives** → engine posts `auth-required`; SW badges
  `!`, notification says "Sign in to receive calls" → opens the setup tab.
- **Popup closed mid-dial / mid-call** → no effect. Engine owns the call; widget
  carries the live UI.
- **No injectable tab** (`chrome://`, Web Store, PDF viewer) → the **notification
  is the guaranteed fallback**; Answer works from it, and clicking it opens the
  popup as the call surface. Never depend solely on the widget.
- **Offscreen doc reclaimed by Chrome** → SW `ensureOffscreen()` recreates it on
  any event and on startup (exists today).
- **Multiple tabs** → widget injected only into the active tab, re-injected on tab
  switch → never more than one visible widget or duplicate ringer.
- **Two windows / rapid icon clicks** → popup is idempotent; `dial`/`answer`
  commands are guarded so a double-send never places two calls.

## Testing

### Unit (pure logic, no Chrome)

- **Widget injection decision** — given tab URL + call state → inject / skip (skip
  `chrome://`, Web Store, no active call). Table-driven.
- **SW message routing** — `incoming` → (`show-widget` + notification);
  `answer`/`decline`/`dial`/`hangup` fan-out; `call-ended` → clear widget +
  badge. Mock `chrome.*`, assert emitted messages.
- **Setup-complete gate** — given `{signedIn, micGranted}` → open setup tab vs.
  open popup.

### Manual acceptance scenarios

1. Fresh install → click icon → setup tab → login + Enable microphone → grant
   persists (reload extension, no re-prompt).
2. Close everything → inbound call → notification **and** widget appear on the
   active tab → Answer from widget → two-way audio.
3. Inbound while on a `chrome://` page → notification only → Answer works.
4. During a call, switch tabs → widget follows to the new active tab, single
   instance.
5. Click icon → popup dialer → dial → **close popup immediately** → call
   continues, widget shows it → Hang Up from widget.
6. Revoke mic in site settings → next call shows "Fix microphone" → reopens setup
   → re-grant works.
7. Log out in popup settings → `auth-required` badge; calls don't ring until
   re-login.
8. Prod parity: repeat 1–2 against `megestic.com` origin (not just localhost).

### Regression guard (verify untouched)

Inbound voice webhook / ring-all state machine, `/api/calls/presence`, and
agent-credential issuance. This build adds extension surfaces + a `?mode=widget`
view only; it must not touch server call handling.

## Files (anticipated)

New / changed in `extension/`:
- `manifest.json` — replace `side_panel` + `openPanelOnActionClick` with
  `action.default_popup`; add `content_scripts`, `web_accessible_resources`
  (`call-widget.html`, `setup.html`), and any host permissions needed for widget
  injection.
- `popup.html` (new) — iframe `/panel?mode=remote` + `popup.js` bridge.
- `call-widget.html` (new) + content script (`content-widget.js`) — inject/manage
  the floating widget iframe on tabs.
- `setup.html` (new) + `setup.js` — first-run login + Enable-microphone.
- `service-worker.js` — add show/hide-widget orchestration, setup-gate routing,
  tab-switch re-injection; keep offscreen/notification logic.
- `offscreen.html` / `offscreen.js`, `panel.js` — reused (bridge already
  origin-derives from `iframe.src`).
- Remove `side-panel.html` once the popup replaces it.

Web app (`components/calls/panel/`):
- `panel-app.tsx` — add `mode === "widget"` routing to a new compact widget view.
- New `widget-phone.tsx` (compact incoming/active call UI, remote over the bus).

## Open questions / risks

- **Origin config for prod:** popup/widget/setup iframes and manifest host
  permissions must switch from `localhost:3000` to `megestic.com` for the prod
  build (mirror of the dev/prod origin split already documented).
- **Widget host permissions breadth:** "any tab" implies broad injection. Confirm
  during planning whether to inject on `<all_urls>` or scope to specific domains
  (privacy/review tradeoff) — not blocking for the design.
