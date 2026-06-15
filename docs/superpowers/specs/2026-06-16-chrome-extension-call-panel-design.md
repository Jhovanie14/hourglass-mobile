# Chrome Extension — Always-Available Call Panel (Design)

**Date:** 2026-06-16
**Status:** Approved design, pending implementation plan
**Author:** Hourglass Mobile team

## Summary

Build a secure Manifest V3 Chrome extension that gives agents and admins an
always-available **call panel** in the browser side panel: see incoming calls,
dial out, and select which of the 5 active phone numbers to use as the caller
ID — without keeping the full Hourglass web app tab open.

The extension is a **thin shell** that loads a dedicated, slim route of the
already-deployed Hourglass web app inside the Chrome Side Panel via an iframe.
All telephony logic and all credentials stay on the existing deployed origin.
The extension itself ships **zero secrets**.

## Goals

- Side-panel call panel: number selector, dialer, active-call HUD, incoming-call popup.
- Choose which of the 5 numbers is used as caller ID per outbound call.
- Native notifications for incoming calls.
- Reuse existing call logic (`WebRTCProvider`, `DialPad`, `ActiveCallHud`,
  `IncomingCallPopup`) — no duplicated telephony code.
- Be secure by construction: no credentials in the extension, minimal permissions,
  strict frame controls.

## Non-Goals (this phase)

- Ringing while the side panel is **closed** (requires an MV3 offscreen document;
  documented as Phase 2 below).
- A separate login UI inside the extension.
- Storing any tokens or SIP credentials in the extension.
- Content scripts / interaction with third-party pages (e.g. click-to-call from
  arbitrary sites).

## Context: relevant facts about the current app

- Next.js 16 (App Router), Supabase SSR cookie auth, Telnyx WebRTC.
- Auth is enforced in `lib/middleware.ts`: unauthenticated requests to
  `/dashboard/*` redirect to `/auth/login`.
- Telephony is a single **shared SIP login** (`TELNYX_SIP_USERNAME` /
  `TELNYX_SIP_PASSWORD`); the 5 phone numbers are selected per call as the
  caller ID. **The SIP password is the crown jewel.**
- Existing call UI lives in `components/calls/`:
  `webrtc-provider.tsx`, `ui/dial-pad.tsx`, `ui/active-call-hud.tsx`,
  `ui/incoming-call-popup.tsx`, `hooks/use-webrtc-client.ts`.

### Pre-existing security issue this work must fix

`app/api/calls/webrtc-token/route.ts` currently returns the shared SIP
username/password as plain JSON with **no authentication check**. On a public
deployment this leaks credentials that allow placing calls billed to the Telnyx
account. This must be auth-gated as part of this work — it is required for the
extension design to be secure and it also closes a live web-app vulnerability.

## Architecture

```
┌─ Chrome Extension (MV3) ──────────────────────────┐
│  manifest.json                                     │
│  side-panel.html  ──>  <iframe src=                │
│        https://<HOURGLASS_ORIGIN>/panel >          │
│  service-worker.js  (opens panel, notifications)   │
│  icon assets                                       │
└────────────────────────────────────────────────────┘
                         │  loads over HTTPS, your origin only
                         ▼
┌─ Deployed Hourglass (Next.js) ─────────────────────┐
│  /panel  route ── slim UI: number selector +       │
│        dialer + ActiveCallHud + IncomingCallPopup  │
│        wrapped in existing <WebRTCProvider>        │
│  Supabase session cookies (already present)        │
│  /api/calls/webrtc-token ── NOW auth-gated (401)   │
└────────────────────────────────────────────────────┘
```

### Components

**Extension (new, holds no secrets):**
- `manifest.json` — MV3, permissions limited to `sidePanel` and `notifications`;
  `host_permissions` limited to `https://<HOURGLASS_ORIGIN>/*`; pinned extension
  ID via `key`.
- `side-panel.html` — a near-empty page containing a single full-size iframe
  pointing at `https://<HOURGLASS_ORIGIN>/panel`.
- `service-worker.js` — registers the side panel, opens it on toolbar click,
  receives `postMessage`-relayed incoming-call events and raises
  `chrome.notifications`, manages the toolbar badge.
- Icon assets.

**Deployed app (new route, reuses existing logic):**
- `/panel` — a focused protected route rendering the existing call components
  wrapped in the existing `WebRTCProvider`. No new telephony logic. Subject to
  existing middleware auth (redirects to `/auth/login` when unauthenticated).

## Authentication

**Token-based login inside the panel. No secrets in the extension.**

### Why not silent cookie reuse

When the panel runs inside the side-panel iframe, the top-level origin is
`chrome-extension://…`, so `www.megestic.com` cookies are in a cross-site /
third-party context. Supabase's session cookie defaults to `SameSite=Lax`, which
is **not** sent on cross-site iframe requests, and Chrome is phasing out
third-party cookies entirely. Silent cookie-based session reuse is therefore not
viable in an extension iframe.

### Chosen approach

- `/panel` authenticates **client-side** using the Supabase browser client
  (`lib/client.ts`). If there is no session, it renders a minimal email/password
  login form. On success, the Supabase JS session persists in the iframe's
  (partitioned) `localStorage` and survives panel reopens.
- Authenticated API calls from the panel send the Supabase **access token** as an
  `Authorization: Bearer <token>` header. The session lives in the megestic
  origin's storage, **not** in the extension — the extension still holds zero
  secrets.
- This is immune to third-party-cookie blocking because it does not rely on
  cookies for the iframe at all.

## Security controls

1. **Auth-gate `/api/calls/webrtc-token`** — the route returns `401` for
   unauthenticated requests before returning any credentials. It accepts **either**
   a valid Supabase session cookie (existing web app) **or** a valid
   `Authorization: Bearer <token>` (the panel), validating the token server-side.
   Required.
2. **Frame controls (both directions):**
   - The `/panel` route (and the auth pages it may redirect to) send
     `Content-Security-Policy: frame-ancestors chrome-extension://<EXTENSION_ID>`
     so only this extension can iframe it.
   - The extension's `host_permissions` are scoped to `https://<HOURGLASS_ORIGIN>/*`.
3. **Minimal permissions** — only `sidePanel` and `notifications`. No
   `<all_urls>`, no content scripts, no tabs/cookies permissions.
4. **Secrets stay server-side** — nothing stored in `chrome.storage`.
5. **Pinned extension ID** — include a `key` in the manifest so the stable
   extension ID can be used in the `frame-ancestors` allow-list.

## Incoming-call behavior & notifications

- Ringing works whenever the side panel is open (expected shift-long usage).
- The `/panel` page already detects incoming calls (`IncomingCallPopup`). It
  `postMessage`s a minimal event `{ type: "incoming", caller, label }` to the
  extension shell, which raises a `chrome.notifications` notification. Clicking it
  focuses the side panel.
- No caller PII beyond what the agent already sees leaves the origin — the
  notification shows only number/label.
- Toolbar badge ("●") indicates an active call.
- The `postMessage` contract is designed so it can be reused by the Phase 2
  offscreen-document approach without changing the message shape.

## Error handling

- **Not logged in:** `/panel` renders its own client-side email/password login
  form inside the iframe; on success the panel renders. No data is served without
  a valid token.
- **Token endpoint 401 / network failure:** panel shows a clear
  "Reconnect / Sign in again" state instead of silently failing to register.
- **Mic permission denied:** panel surfaces a "Microphone blocked — click to
  grant" message (permission is requested by the Hourglass origin in the iframe).
- **WebRTC disconnect:** reuse/extend existing `useWebRTCClient` ready-state
  handling to show a connection indicator.

## Testing

**Manual E2E checklist:**
- Load unpacked extension → open side panel → `/panel` loads authenticated.
- Place outbound call selecting each of the 5 numbers as caller ID.
- Receive inbound call → notification fires → answer / reject / hangup / mute / DTMF.

**Security verification:**
- `curl` `/api/calls/webrtc-token` unauthenticated → expect `401`.
- Confirm a different website cannot iframe `/panel` (`frame-ancestors` blocks it).
- Confirm the extension requests only `sidePanel` / `notifications` permissions
  and `host_permissions` limited to the Hourglass origin.

**Static checks:**
- `npm run lint` and `npm run typecheck` pass for the new `/panel` route.

## Phase 2 (future, not in this scope)

If agents need calls to ring while the side panel is **closed**: introduce an MV3
**offscreen document** that holds a persistent Telnyx WebRTC connection and fires
notifications, coordinated by the service worker. This is significantly more work
(MV3 service workers are ephemeral; WebRTC/media must live in the offscreen
document) and would re-implement telephony outside the web app. The Phase 1
`postMessage` event contract is intentionally compatible with this path.

## Open configuration

- `<HOURGLASS_ORIGIN>` — the deployed app's origin: `https://www.megestic.com`
  (used in `manifest.json` `host_permissions`, `side-panel.html` iframe src,
  `frame-ancestors` value).
- `<EXTENSION_ID>` — derived from the pinned manifest `key`; used in
  `frame-ancestors`.
