# Multi-Agent Ring-All — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan

## Problem

All agents' WebRTC clients authenticate with the **same** shared SIP credential: `/api/calls/webrtc-token`
returns the single `TELNYX_SIP_USERNAME` / `TELNYX_SIP_PASSWORD` to every user. When multiple devices
register the same SIP credential, Telnyx routes an inbound call to only **one** registration. So with
2-3 agents online, only one agent's browser rings — and which one is effectively "last to register
wins." The inbound dial (`lib/telnyx/voice-orchestrator.ts` → `dialAgent`) targets that one shared
identity (`sip:${TELNYX_SIP_USERNAME}@sip.telnyx.com`), so there is no way to reach the others.

## Goal

When a call comes in, **ring all currently-online agents simultaneously**. The first agent to answer
is connected to the caller; the others stop ringing. If no one answers within the existing ~25s
window, the caller goes to voicemail (unchanged). The caller hears normal ringback throughout.

Non-goals: round-robin/sequential distribution, per-agent DID ownership, skill-based routing,
agent-to-agent transfer, hold/queue music.

## Telnyx model (no new infrastructure)

Telnyx separates the **Credential Connection** (routing + webhook config) from **Telephony
Credentials** (individual SIP usernames/passwords) that live under it. Many credentials can share one
connection. We keep the existing connection `hourglass-webrtc`
(`TELNYX_CREDENTIAL_CONNECTION_ID = 2975050015291999626`) and create **one telephony credential per
agent** under it via `telnyx.telephonyCredentials.create({ connection_id })`, which returns
`sip_username` + `sip_password`. No new SIP trunk / connection is required.

**Lesson from current state:** the account already has ~15 orphaned `webrtc-session-<timestamp>`
telephony credentials from a previous per-session approach that never cleaned up. Our provisioning
MUST be **per-user and idempotent** (create once, store, reuse) to avoid recreating that leak. The
orphans are cleaned up separately (see "Housekeeping").

## Architecture (four components + the call-flow rewrite)

1. **Per-agent SIP credentials** — auto-provisioned on first use, stored server-side, keyed to `user_id`.
2. **Presence** — the app heartbeats "online"; the server keeps a live list of who can be rung.
3. **Token endpoint** — returns the requesting user's own credential instead of the shared env one.
4. **Dial-all orchestration** — fan out to all online agents, first-answer-wins, cancel the rest,
   voicemail if none answer.

## Data model (new tables)

**`agent_sip_credentials`** (persistent, one row per user):
- `user_id uuid primary key references auth.users`
- `telnyx_credential_id text not null`
- `sip_username text not null`
- `sip_password text not null`
- `created_at timestamptz default now()`
- **RLS: deny all client access.** Only the server (Supabase admin/service-role client) reads or
  writes this table. The SIP password lives here and must never reach a client other than its owner
  (and only via the token endpoint, which returns just that user's credential).

**`agent_presence`** (ephemeral, one row per user):
- `user_id uuid primary key references auth.users`
- `last_seen_at timestamptz not null`
- "Online" = `last_seen_at >= now() - interval '30 seconds'`.
- RLS: a user may upsert only their own row; the server reads all rows.

**`call_agent_legs`** (per-call fan-out tracking):
- `id uuid primary key default gen_random_uuid()`
- `call_id uuid references calls(id)`
- `agent_leg_id text not null` (the dialed Telnyx call_control_id)
- `user_id uuid` (which agent this leg targets)
- `status text not null default 'ringing'` (`ringing` | `answered` | `failed`)
- `created_at timestamptz default now()`
- Server-only access. Used to (a) hang up sibling legs when one answers and (b) detect when all
  legs have failed → voicemail.

## Component details

### 1 & 3. Credential provisioning + token endpoint (`app/api/calls/webrtc-token/route.ts`)
Already authenticates the user. New behavior:
1. Read `agent_sip_credentials` for `user_id` (admin client).
2. If absent: `telnyx.telephonyCredentials.create({ connection_id: TELNYX_CREDENTIAL_CONNECTION_ID, name: <user id/email> })`, persist `{ telnyx_credential_id, sip_username, sip_password }`, then use it.
3. Return `{ login: sip_username, password: sip_password }` for **this** user only.

Idempotent: a given user always gets the same credential. The shared `TELNYX_SIP_USERNAME` /
`TELNYX_SIP_PASSWORD` env vars are no longer used for inbound agent routing (kept only if needed for
any fallback/migration; otherwise retired).

### 2. Presence (`app/api/calls/presence/route.ts` + client heartbeat)
- Client: while the WebRTC client is connected (`telnyx.ready`), POST to `/api/calls/presence` every
  ~15s. The endpoint upserts `agent_presence` with `last_seen_at = now()` for the authenticated user.
  No explicit "offline" call is required — staleness (>30s) drops the agent from the online set.
- The heartbeat lives alongside the existing WebRTC client lifecycle (`use-webrtc-client.ts` /
  `webrtc-provider.tsx`), started on ready and cleared on unmount.

### 4. Dial-all orchestration (`app/api/webhooks/telnyx/voice/route.ts` + `voice-orchestrator.ts`)
On `call.answered` for the caller leg (A):
1. Query online agents (`agent_presence` fresh) that have a credential (`agent_sip_credentials`).
2. If **none online** → `beginVoicemail` immediately.
3. Otherwise, **dial each online agent in parallel** as a tagged agent leg
   (`client_state = { role: "agent", aLegId, callId }`, as today), targeting that agent's
   `sip:<their sip_username>@sip.telnyx.com`. Insert a `call_agent_legs` row per leg.
4. **Ringback to the caller:** start a **looping ringback tone** playback on leg A (Telnyx
   `playback_start` with a hosted ringback `.mp3` and loop). **This replaces the single-agent
   `play_ringtone`-on-bridge mechanism** shipped on 2026-06-18 (that trick can't ring N legs at
   once). The caller hears continuous ringing while the agents' phones ring.
5. **First answer wins (concurrency lock):** on an agent leg's `call.answered`, atomically flip the
   caller's call row from a "ringing" state to "answered" with a conditional update
   (`update calls set status='answered' where telnyx_call_id=<aLeg> and status in ('initiated','ringing')`
   returning the row). If the update returns a row, this agent **won**: stop the ringback playback on
   A, bridge A↔this leg, mark this `call_agent_legs` row `answered`, and **hang up all sibling legs**
   for the call. If the update returns no row, another agent already won → **hang up this (losing)
   leg** and do nothing else.
6. **All legs fail → voicemail:** on each agent leg's `call.hangup`, mark its `call_agent_legs` row
   `failed`; if no `ringing` legs remain for the call AND the caller was never answered →
   `beginVoicemail`. (Replaces today's single-leg "caller still initiated → voicemail" check.)

A "ringing" status is introduced for the caller's call row to make the first-answer lock explicit
(set when fan-out begins; the conditional update accepts both `initiated` and `ringing` to be safe).

### Ringback asset
A short ringback tone is hosted at `public/audio/ringback.mp3` (served at
`https://www.megestic.com/audio/ringback.mp3`) and played in a loop on leg A. Stopped when an agent
wins the bridge or when voicemail begins.

## Edge cases

- **Zero online agents** → immediate voicemail.
- **Caller hangs up during ring** → caller-leg `call.hangup` cancels all `ringing` agent legs for the
  call; call logged `missed`.
- **Winner's bridge fails** → fall through to voicemail.
- **Stale presence** (agent closed tab without dropping) → that agent's dialed leg fails fast (no
  registration); counted as a failed leg, doesn't block others or voicemail.
- **Two agents answer near-simultaneously** → the conditional-update lock guarantees exactly one
  winner; the loser's leg is hung up.
- **Provisioning failure** (Telnyx create errors) → token endpoint returns 500; that agent simply
  isn't online/able to register (logged), others unaffected.

## Security

`agent_sip_credentials` is service-role-only; no RLS policy grants client access. The token endpoint
returns only the authenticated caller's own credential. SIP passwords are never exposed cross-user
and never sent to the browser except to their owner.

## Phased delivery

Each phase is independently shippable and testable (own branch → PR → deploy → test):
- **Phase 1 — Per-agent credentials:** `agent_sip_credentials` table + provisioning in the token
  endpoint. Test: two agents log in and both register successfully. (Calls still ring one agent —
  expected until Phase 3.)
- **Phase 2 — Presence:** `agent_presence` table + `/api/calls/presence` + client heartbeat. Test:
  open/close tabs and watch agents appear/disappear in the online set.
- **Phase 3 — Ring-all orchestration:** `call_agent_legs` + dial-all fan-out, looped ringback,
  first-answer-wins, sibling cancellation, all-failed→voicemail. Test: multi-browser real call.

## Housekeeping (separate task, not part of the feature)

Delete the ~15 orphaned `webrtc-session-<timestamp>` telephony credentials left by the prior
per-session approach, and the now-unused shared `hourglass-webrtc` credential(s) once Phase 1 is live
and verified. A one-off script lists telephony credentials, filters by the `webrtc-session-` name
prefix (and the retired shared id), and deletes them via the Telnyx API. Must run only AFTER Phase 1
is confirmed working, so no live registration is disrupted.

## Testing

- **Unit (vitest, `lib/`):** online-agent filter (freshness window), create-credential-if-missing
  idempotency, leg fan-out construction, first-answer-wins conditional-update logic, sibling
  cancellation selection, all-legs-failed→voicemail decision.
- **Manual (real calls):** 2-3 browsers signed in as distinct agents → inbound call → all ring →
  one answers, others stop, caller connected; nobody answers → all stop, caller to voicemail; zero
  online → immediate voicemail.

## Out of scope (tracked elsewhere)

- HGI number `+12109348999` mistyped as `+2109348999` in `phone_numbers`.
- `+18326130706` has no Telnyx connection / not in DB.
- Toast reposition (`bottom-left`) — minor UI change, separate.
