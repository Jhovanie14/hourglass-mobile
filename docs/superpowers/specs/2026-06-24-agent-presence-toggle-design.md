# Agent Online/Offline Presence Toggle — Design

**Date:** 2026-06-24
**Status:** Approved design, pre-implementation

## Goal

Let an agent manually toggle their availability between **Online** and
**Offline**. While Offline, the agent must **not receive inbound calls**, even
though the app is open and their WebRTC client is connected.

Offline affects **inbound** only. An Offline agent can still **place outbound
calls** (toggling Offline means "don't ring me," not "disable calling").

Not in scope: SMS/10DLC (entirely separate channel — unaffected), an admin view
of who's online, a "Busy/Away" third state, or persisting status across sessions.

## Background — how presence works today

- Table `agent_presence(user_id, last_seen_at)`, one row per agent.
- The WebRTC client (`components/calls/hooks/use-webrtc-client.ts`) POSTs
  `/api/calls/presence` every ~15s while connected → upserts `last_seen_at`.
- `getOnlineAgentUserIds` (`lib/telnyx/presence.ts`) returns agents whose
  `last_seen_at` is within `PRESENCE_WINDOW_SECONDS` (30s).
- `getOnlineReachableAgents` (`lib/telnyx/ring-all.ts`) = online ∩ has a SIP
  credential. **This is exactly the set ring-all dials.**

So presence today is *automatic*: connected = online; app closed = offline after
30s staleness. There is no manual control.

## Decisions (confirmed)

1. **Default state on connect:** Online.
2. **Stickiness:** Non-sticky — each new session starts at the default (Online).
3. **States:** Two only — Online / Offline.
4. **Toggle placement:** Dashboard sidebar status pill (visible on every page),
   mirrored in the extension panel header.
5. **Mechanism:** Approach A — heartbeat-gating + instant-offline expire.

## Approach A — heartbeat-gating + instant-offline expire

The agent's Online/Offline *intent* lives in the client. Presence-row existence
remains the single source of truth for "dialable."

- **Online:** keep heartbeating (today's behavior) → fresh row → included in the
  ring-all dial set.
- **Offline:** stop heartbeating **and** immediately expire (delete) the agent's
  presence row, so they leave the dial set right away rather than waiting out the
  30s staleness window.

This yields "default Online" and "non-sticky" for free: closing the app stops
beats; reopening restarts them → Online again. `getOnlineReachableAgents` needs
**no change**.

Rejected alternatives:
- **B (`is_available` column):** schema migration + reset-on-connect logic for a
  "connected-but-away" distinction not needed now. YAGNI.
- **C (stop heartbeat only, no expire):** leaves an agent dialable for up to 30s
  after going Offline. Bad UX for someone stepping away.

## Components

### 1. Data / server — `lib/telnyx/presence.ts` + presence route

- Add `expirePresence(admin, userId)` to `lib/telnyx/presence.ts`: deletes the
  agent's `agent_presence` row. After it runs, the agent is absent from
  `getOnlineAgentUserIds`.
- Add a `DELETE` handler to `app/api/calls/presence/route.ts`: authenticates the
  caller (same `getRequestUserId` guard as POST) and calls `expirePresence` for
  that user. POST (heartbeat) is unchanged.
- No DB schema change.

### 2. Client state — `WebRTCProvider` + heartbeat hook

- Extend `WebRTCContextType` with `online: boolean` (default `true`) and
  `setOnline: (next: boolean) => void`.
- `WebRTCProvider` owns the `online` state and passes it to the heartbeat logic.
- Heartbeat effect (currently in `use-webrtc-client.ts`) keys off `online`:
  - `online && isReady` → immediate beat + 15s interval (today's behavior).
  - `!online` → clear the interval and send one `DELETE /api/calls/presence` to
    expire immediately.
- New session / reconnect: `online` defaults to `true` (non-sticky).

### 3. UI — `<PresenceToggle />`

- New component using the existing `Switch` (`components/ui/switch.tsx`).
- Renders a pill: **Online** (green dot/accent) or **Offline** (muted), with the
  switch bound to `online`/`setOnline` from `useWebRTC()`.
- While `!isReady`: disabled, shows "Connecting…".
- On toggle: a `sonner` toast confirms — e.g. "You're offline — you won't
  receive calls" / "You're online".
- Placement: dashboard **sidebar** (in `components/sidebar-nav.tsx`, visible on
  all dashboard pages) and the **extension panel header**
  (`components/calls/panel/panel-app.tsx`). Both shells already mount
  `WebRTCProvider`, so the context is available in each.

### 4. Ring-all integration

None. Expiring the presence row removes the agent from `getOnlineReachableAgents`
automatically. `lib/telnyx/ring-all.ts` is untouched.

## Data flow

```
Agent clicks toggle → setOnline(false)
  → heartbeat effect clears interval
  → DELETE /api/calls/presence → expirePresence() deletes agent_presence row
  → next inbound: getOnlineReachableAgents() omits agent → not dialed

Agent clicks toggle → setOnline(true)
  → heartbeat effect sends immediate beat → upserts agent_presence row
  → 15s interval resumes
  → next inbound: agent included again
```

## Error handling

- `DELETE` failure (network): log a warning; the row goes stale within 30s
  anyway, so the agent still ends up Offline — just not instantly. The UI still
  reflects Offline (client intent), so no inconsistent user-facing state.
- Heartbeat POST failure: unchanged from today (logged, retried next interval).

## Edge cases

- **Toggle Offline during an incoming ring:** that call already routed; the agent
  can still answer/reject it. No *new* calls ring. Acceptable.
- **Multiple tabs:** if any tab is Online it keeps refreshing the row, so the
  agent stays reachable even if another tab is Offline. Correct — they are
  reachable somewhere. (Documented, not specially handled.)
- **Network blip pausing beats:** same 30s staleness as today. Not a regression.

## Testing

- Unit-test `expirePresence` in `lib/telnyx/presence.test.ts`: after expiring,
  the user is absent from `getOnlineAgentUserIds` (mirror the existing
  admin-mock style in that file).
- Dial-set behavior (`getOnlineReachableAgents`) already covered by existing
  tests; no change needed.
- Client hook/UI: light — logic is thin and mostly wiring; rely on the unit
  tests for the server-side guarantee.

## Files touched

- `lib/telnyx/presence.ts` — add `expirePresence`.
- `lib/telnyx/presence.test.ts` — add expire test.
- `app/api/calls/presence/route.ts` — add `DELETE`.
- `components/calls/webrtc-provider.tsx` — `online`/`setOnline` in context.
- `components/calls/hooks/use-webrtc-client.ts` — gate heartbeat on `online`,
  expire on going offline (or a small dedicated `useAgentPresence` hook).
- `components/calls/ui/presence-toggle.tsx` — new component.
- `components/sidebar-nav.tsx` — mount the toggle.
- `components/calls/panel/panel-app.tsx` — mount the toggle in the panel header.
