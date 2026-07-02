# Chrome Extension — Always-On Phone + SMS Panel (Design)

**Date:** 2026-07-02
**Status:** Approved design, pending implementation plan
**Supersedes:** the "Phase 2 (future)" section of
`2026-06-16-chrome-extension-call-panel-design.md`. Phase 1 of that spec is
built and shipping; this spec refactors it.

## Problem

The current extension only works while the side panel is open: the panel
iframe owns the WebRTC connection, so a closed panel means no ringing, no
notifications, and missed calls. Agents must remember to keep the panel open
all shift. The client needs the extension to behave like a phone — ring on
inbound (and play ringback on outbound) even when nothing is open — plus SMS
notifications and texting from the panel.

## Goals

- **Part 1 (this refactor):** calls ring whether or not the side panel is
  open. Inbound raises a Chrome notification with **Answer / Decline**
  buttons; Answer connects audio immediately and opens the side panel for
  in-call controls. Outbound plays ringback. Login once in the panel keeps
  the phone signed in until sign-out.
- **Part 2 (follow-up plan, same architecture):** a **Messages** tab in the
  panel reusing the dashboard conversations UI, plus Chrome notifications
  for inbound SMS.
- Fold in the two pending panel fixes: the call-logging RLS 401
  (shared-client fix) and the mic-permission gate.
- Preserve the June spec's security principles: zero secrets in the
  extension, minimal permissions, strict frame controls.

## Non-Goals

- Ringing while Chrome itself is fully closed (that requires a native app).
- Content scripts / click-to-call on third-party sites.
- Changing the web dashboard's own calling or SMS behavior.

## Architecture (Approach A — background phone via offscreen document)

```
Chrome Extension (MV3)
├─ service-worker.js          coordinator: keeps offscreen doc alive,
│                             raises notifications, routes commands
├─ offscreen.html/.js         invisible; hosts hidden iframe →
│     └─ iframe: https://www.megestic.com/panel?mode=background
│            headless: WebRTCProvider + realtime listeners +
│            postMessage bridge, renders no UI
├─ side-panel.html
│     └─ iframe: https://www.megestic.com/panel    (UI only)
└─ manifest.json              + "offscreen" permission
```

### The one-phone rule

Only the background iframe holds a Telnyx WebRTC connection. The visible
panel is a **remote control**: it renders state received over the message
bus and sends commands. This removes the double-connection class of bugs
(competing registrations, double ring, mic contention) and is the core of
the refactor: `/panel` splits into

- **`?mode=background`** — mounts `WebRTCProvider` and the bridge; no UI.
- **default (UI) mode** — mounts the panel UI bound to a *remote* call-state
  store fed by `state-sync` messages; never instantiates its own client.

### Message bus

Both iframes talk to their extension shells via `postMessage`
(origin-checked in both directions, as today); the service worker relays
between offscreen, side panel, and notifications. The contract extends the
existing `{ source: "hourglass-panel", type, ... }` shape:

- Events (background → SW): `incoming`, `call-active`, `call-ended`
  (existing), plus `state-sync` (full call state for the panel),
  `auth-required`, `mic-blocked`, and later `sms-received`.
- Commands (panel/notification → SW → background): `dial`, `answer`,
  `decline`, `hangup`, `mute`, `unmute`, `dtmf`, with a `caller_id`
  parameter on `dial` (number selection works exactly as today).

### Ringing & notifications

- Inbound: background plays the ring sound (offscreen `AUDIO_PLAYBACK` /
  `USER_MEDIA` justification) and the SW raises a notification with
  **Answer / Decline** buttons. Notification button clicks are user
  gestures, so `chrome.sidePanel.open()` is permitted: Answer connects
  audio in the background at once and opens the panel showing the active
  HUD. Decline hangs up and clears.
- Outbound: background plays ringback while dialing (Telnyx early media
  when available, local ringback tone otherwise).
- Toolbar badge: "●" during an active call (existing behavior, now driven
  by the background phone).

### Login & session

- Agent signs in once inside the side panel (email/password, Supabase
  browser client) — unchanged from the current panel.
- Both iframes are embedded under the same `chrome-extension://` top-level
  origin, so they share the same storage partition; the background iframe
  reads the same Supabase session and is signed in the moment the agent is.
- **Riskiest assumption, verified first in the plan (Task 0 spike):** the
  side-panel iframe and offscreen iframe share partitioned storage. If they
  do not, fallback is an explicit `session-handoff` message (panel posts
  the session to the background via the SW after login); the bus design
  accommodates this without changing anything else.
- Signed out / refresh failure: background posts `auth-required`; the
  extension shows a persistent "Sign in to receive calls" notification and
  badge instead of going silently deaf.

### Lifecycle

- SW recreates the offscreen document on `onInstalled`, `onStartup`, and
  whenever a message finds it missing (`chrome.offscreen.hasDocument()` /
  create-if-absent) — the phone is online whenever Chrome is.
- Mic permission is requested by the megestic origin inside the background
  iframe (`allow="microphone"` on both iframes). The pending mic-gate fix
  ships here: a clear "Microphone blocked — open panel to grant" state
  (notification + panel banner) instead of a silent dead mic.

## Security

Unchanged principles from the June spec, restated as binding:

- Zero secrets in the extension: no tokens or SIP credentials in
  `chrome.storage`; everything lives in the megestic origin's storage.
- Permissions: `sidePanel`, `notifications`, `offscreen` only.
  `host_permissions` stay scoped to `https://www.megestic.com/*`.
- `frame-ancestors` on `/panel` continues to allow only this extension's
  pinned ID (background mode is the same route, same protection).
- `postMessage` origin checks on every listener, both directions.
- `/api/calls/webrtc-token` stays auth-gated; only the background iframe
  ever fetches it.

## Folded-in fixes

1. **Call-logging RLS 401 (shared-client fix):** the panel's call logging
   must reuse the authenticated Supabase client (bearer session) instead of
   the anonymous shared client that 401s under RLS.
2. **Mic-permission gate:** see Lifecycle above.

## Part 2 — SMS in the panel (second plan, same foundation)

- Panel UI gains tabs: **Phone | Messages**.
- Messages tab reuses the existing responsive conversations components
  (list → thread flow, country-picker compose, opt-out guards, delete
  conversation) — no SMS logic duplicated; same tables and server actions
  as the dashboard.
- The background iframe subscribes (Supabase realtime, as the dashboard
  does) to inbound messages → posts `sms-received` → SW raises a
  notification ("New text from +1… → HGI Main"); clicking opens the panel
  on that conversation.
- Ships only after Part 1 is verified end-to-end.

## Error handling

- **Auth expired:** `auth-required` → sign-in notification + badge; panel
  shows the login form; on success the background resumes automatically.
- **Mic blocked:** `mic-blocked` → notification + panel banner with a
  grant button.
- **Offscreen document evicted / SW asleep:** every SW wake path re-ensures
  the offscreen document; missed-state is re-synced via `state-sync` on
  reconnect.
- **WebRTC disconnect:** background reuses `useWebRTCClient` ready-state
  handling; panel shows the connection indicator; ring only when
  registered.
- **Two Chrome profiles/machines signed in as the same agent:** out of
  scope — same behavior as the web app today (both ring).

## Testing

**Task 0 spike (before the plan proceeds):** verify shared storage
partition between side-panel iframe and offscreen iframe on production
Chrome; verify notification-button user gesture opens the side panel.

**Manual E2E (Part 1):**
- Sign in via panel → close panel → inbound call rings + notification →
  Answer → audio connects, panel opens with HUD → mute/DTMF/hangup.
- Decline from notification → caller routed per existing flow (voicemail).
- Outbound from panel: dial with each caller ID → ringback audible →
  connect → hangup. Call rows logged correctly (RLS fix verified).
- Restart Chrome → phone auto-reconnects without opening the panel →
  inbound still rings.
- Sign out → "Sign in to receive calls" notification appears; no ringing.

**Security verification:** permissions audit (only the three named),
`webrtc-token` 401 unauthenticated, third-party site cannot iframe
`/panel`, `postMessage` listeners reject foreign origins.

**Static checks:** `npm run lint`, `npm run typecheck`, `npm test` pass.

## Open configuration

- Origin: `https://www.megestic.com` (manifest `host_permissions`, both
  iframe srcs, `frame-ancestors`).
- Extension ID pinned via the existing manifest `key`.
- Ring/ringback audio assets: bundled in the deployed app (served from the
  megestic origin), not in the extension.
