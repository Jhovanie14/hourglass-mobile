# Multi-Agent Ring-All — Phase 3: Dial-All + Natural Ringback (Design)

**Date:** 2026-06-19
**Status:** Approved (design), pending implementation plan
**Supersedes:** §4 (and the ringback approach) of `docs/superpowers/specs/2026-06-18-multi-agent-ring-all-design.md`.
Builds on Phase 1 (per-agent credentials, `lib/telnyx/agent-credentials.ts`) and Phase 2
(presence, `lib/telnyx/presence.ts`).

## Problem

Two problems, fixed together:

1. **Only one agent rings.** Inbound calls dial a single shared SIP identity
   (`sip:usercontact74348@…`), so only one agent's phone rings even when several are online.
2. **Dead air for the caller.** The webhook **answers the caller leg (A) immediately** on
   `call.initiated` so it can orchestrate. Answering stops the carrier's native ringback, and we
   then play nothing while the agent rings (~25s). The caller hears **1 ring → ~25s of silence →
   voicemail**, and many hang up during the silence thinking the call died.

The dead-air is purely the **caller's** experience. Agents hearing their phones ring is expected and
unchanged.

## Goal

When a call comes in, **ring every online agent at once over native carrier ringback**:

- The caller hears **real, continuous ringing** the entire time agents' phones ring — no silent gap.
- The **first** agent to answer is bridged to the caller; the others stop ringing.
- If nobody answers within the ring window, the caller goes to voicemail (existing flow, unchanged).
- If no agent is online, the caller goes straight to voicemail.

Non-goals: round-robin/sequential distribution, skill-based routing, hold/queue music, agent-to-agent
transfer, a looped ringback audio file (explicitly rejected — see "Ringback approach").

## Ringback approach (decision)

The previous outage came from playing a **`play_ringtone`/`playback` audio on the answered caller
leg** that competed with the voicemail greeting — the greeting never played and nothing recorded.
**We do not play any ringback audio.**

Instead we use **natural ringback: never answer leg A during the ring.** While A is unanswered the
carrier plays real ringback automatically. We answer A only at the moment we either (a) bridge it to
a winning agent, or (b) begin voicemail. Because there is never a competing playback and A is never
bridged while unanswered, this **cannot reproduce the stuck-greeting bug** — it removes the dead-air
*and* is the voicemail-safe option.

This **bundles the Phase 1 credential re-revert**: agents register with their own per-agent SIP
identity, so `dialAgent` must now dial each agent's *own* SIP username. Per-agent register and
per-agent dial ship together (the lesson from PR #5 → #6: shipping registration without dialing broke
inbound).

## Call flow (rewrite of `app/api/webhooks/telnyx/voice/route.ts` + `voice-orchestrator.ts`)

### `call.initiated` — inbound caller leg A
1. Log the call (as today) with status **`ringing`** (new value; today it's `initiated`).
2. **Do NOT answer A.** Resolve the **online, reachable** agents:
   `getOnlineAgentUserIds()` (presence within 30s) **joined with** `agent_sip_credentials` (must have
   a credential). 
3. If **none** → answer A and `beginVoicemail` immediately.
4. Otherwise **dial each agent in parallel** as a tagged leg B:
   - `to: sip:<that agent's sip_username>@sip.telnyx.com`
   - `from: payload.to` (owned DID — un-owned `from` is rejected; proven in Task 0 spike)
   - `from_display_name`: sanitized caller number (agent sees who's calling)
   - `client_state: { role: "agent", aLegId, callId, userId }`
   - `timeout_secs: 25`
   - Insert one `call_agent_legs` row per dialed leg (`status='ringing'`).
   The carrier rings A natively throughout → **caller hears continuous ringing.**

### `call.answered` — role=agent (an agent picked up)
First-answer-wins via an **atomic conditional update**:
```sql
update calls set status='answered', started_at=now()
where telnyx_call_id = <aLegId> and status='ringing'
returning id
```
- **Row returned (winner):** answer leg A, then `bridge(A, thisLeg)`; mark this `call_agent_legs` row
  `answered`; **hang up all sibling `ringing` legs** for this call.
- **No row (loser):** another agent already won → **hang up this leg**, do nothing else.

`answer(A)` then `bridge(A,B)`: A must be parked before bridging, so `bridge` uses the existing
`withRetry` to absorb the brief ordering gap. If the bridge ultimately fails → answer A +
`beginVoicemail`.

### `call.answered` — leg A (we answered it ourselves)
We only answer A from inside the winner path (then `bridge`) or the voicemail path (then `speak`), and
those next actions are issued **inline, right after `answer`** in their own handlers — `answer(A)` →
`bridge(A,B)` / `answer(A)` → `beginVoicemail`, with `withRetry` absorbing the answer→action ordering
gap. So **A's own `call.answered` webhook needs to drive nothing** (it is effectively a no-op for
control flow). Critically, **no agent-dial is triggered on `call.answered` anymore** — fan-out moved
to `call.initiated`. This is the behavioral inversion from today (today A is answered first and the
dial happens on A's `call.answered`).

### `call.hangup` — role=agent (an agent leg ended)
1. Mark its `call_agent_legs` row `failed`.
2. If **no `ringing` legs remain** for the call **and** the caller's call is still `ringing` (never
   answered) → answer A + `beginVoicemail`. (Replaces today's single-leg "caller still initiated →
   voicemail" check.)

### `call.hangup` — leg A (caller hung up)
- If the call was never `answered`: **cancel all still-`ringing` agent legs** for this call, then
  finalize as `missed` (existing missed-call notification path unchanged).
- If it was `answered`/`completed`: existing finalize logic (duration, `completed`) unchanged.

### Voicemail & recording — UNCHANGED
Once A is answered and `beginVoicemail` runs, the existing path is reused verbatim:
`beginVoicemail` → `call.speak.ended` → `startRecording({ play_beep:true })` →
`call.recording.saved` → store + notify. This is the part that broke before; here it is the same
code, reached via "all agents failed/none online" instead of "single agent failed."

## Data model

**New table `call_agent_legs`** (per-call fan-out tracking, server-only — RLS on, no policies, same
lockdown as `agent_sip_credentials`/`agent_presence`):

```sql
create table if not exists public.call_agent_legs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  agent_leg_id text not null,              -- the dialed Telnyx call_control_id (leg B)
  user_id uuid not null,                   -- which agent this leg targets
  status text not null default 'ringing',  -- ringing | answered | failed
  created_at timestamptz not null default now()
);

alter table public.call_agent_legs enable row level security;  -- no policies = server-only

-- Hot-path indexes: every agent-leg webhook touches this table.
create index if not exists call_agent_legs_call_id_idx
  on public.call_agent_legs(call_id);                          -- count ringing / cancel siblings
create index if not exists call_agent_legs_agent_leg_id_idx
  on public.call_agent_legs(agent_leg_id);                     -- find the leg on answer/hangup
```

**`calls.status` gains a `ringing` value.** Inbound becomes
`ringing → answered | voicemail | missed` (today it is `initiated → …`). `status` is free-text, so no
schema migration — only a new value and the conditional-update lock that depends on it.

> **Deploy-ordering rule (learned):** the table must exist in Supabase **before** the Phase 3 code
> deploys, or leg inserts/queries error. Schema is managed in the Supabase dashboard (no in-repo
> migrations). Creating `call_agent_legs` is Step 1 of the implementation plan, run just before
> deploy and verified the same way `agent_presence` was.

## Edge cases

- **Zero online agents** → answer A + immediate voicemail.
- **Online agent without a credential** → excluded by the presence ⋈ credentials join; never dialed.
- **Stale presence** (tab closed <30s ago) → leg dialed but fails fast (no registration); counted as
  a `failed` leg; doesn't block siblings or voicemail.
- **Caller hangs up during ring** → cancel all `ringing` agent legs; log `missed`.
- **Two agents answer near-simultaneously** → conditional-update lock yields exactly one winner; the
  loser's leg is hung up.
- **Winner's bridge fails** → answer A + voicemail.
- **All agent legs fail/time out** → on the last leg's hangup, answer A + voicemail.

## Security

`call_agent_legs` is service-role-only (RLS on, no policies); no client reads or writes it. Per-agent
SIP passwords continue to live only in `agent_sip_credentials` (server-only) and reach a browser only
via that user's own `/api/calls/webrtc-token`.

## Testing

**Unit (vitest, `lib/`)** — orchestration logic extracted into pure, dependency-injected functions:
- online-and-reachable agents resolver (presence ⋈ credentials → dial list)
- fan-out leg construction (one tagged dial per agent, correct `client_state` + per-agent SIP target)
- first-answer-wins: winner path (row returned → bridge + cancel siblings) vs loser path (no row →
  hang up self)
- sibling-cancellation selection (which legs to hang up for a call)
- all-legs-failed → voicemail decision (no `ringing` legs left AND caller still `ringing`)

**Manual (real calls, before merge):** 2–3 browsers signed in as distinct agents → inbound call →
**caller hears continuous ringing (no dead air)** while all agents' phones ring → one answers, others
stop, caller connected → a *different* agent can win on a second call → nobody answers → caller hears
ringing then the voicemail greeting and recording works → zero online → immediate voicemail → caller
hangs up mid-ring → all agent legs stop, logged `missed`.

## Rollout

Single branch `feat/multi-agent-ring-all-phase-3` → PR. Create `call_agent_legs` in Supabase
**before** merge/deploy. After deploy, run the manual matrix above. Because this re-applies per-agent
credentials, the shared connection login `usercontact74348` is no longer used for inbound dialing
after this ships (kept only as connection-level fallback; cleanup is separate housekeeping).

## Out of scope (tracked elsewhere)

- The 3 leftover `hourglass-webrtc` gencred telephony creds + unused `TELNYX_TELEPHONY_CREDENTIAL_ID`
  (deferred housekeeping).
- HGI number `+12109348999` mistyped as `+2109348999` in `phone_numbers`.
- A looped ringback `.mp3` (explicitly rejected in favor of native ringback).
