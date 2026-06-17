# Ringback While Dialing the Agent — Design

**Date:** 2026-06-18
**Status:** Approved (design), pending implementation plan

## Problem

Inbound calls are orchestrated via the Telnyx **Voice API (Call Control)** application. On
`call.initiated` the webhook immediately issues the `answer` command on the caller's leg (leg A)
so it can orchestrate dial → bridge → voicemail (`app/api/webhooks/telnyx/voice/route.ts:153`).

Answering the leg stops the carrier-generated ringback. The handler then dials the agent's WebRTC
leg (leg B) with a 25-second timeout (`lib/telnyx/voice-orchestrator.ts:53`) but plays **no audio to
the caller** during that window. Result: the caller hears one ring, then dead silence for up to 25s.

Observed impact (2026-06-18 test): with the agent online but ignoring the call, the caller assumed
the line had dropped and hung up during the silence → the call was logged as `missed` instead of
ever reaching voicemail. (Offline-agent → voicemail already works, because the timeout fires before
the caller gives up.)

This is inherent to the Call Control model: answering early to gain control means we own the
caller's audio. Telnyx provides `play_ringtone` on the `bridge` action as the sanctioned way to
restore ringback within this model. No "automatic ringback" toggle exists on a Call Control app.

## Goal

While the agent's leg is ringing, the caller hears a normal ringback tone (not silence), so they
stay on the line until the agent answers or the call falls through to voicemail.

Non-goals: hold music, "please hold" greetings, changing the 25s timeout, any DB/schema change.

## Approach (chosen: native `play_ringtone` bridge)

Bridge the caller leg to the agent leg **before** the agent answers, with `play_ringtone: true`.
Telnyx then plays ringback to the caller for the duration that the agent leg is ringing.

### Current flow (unchanged parts in italics)

1. *`call.initiated` (caller A): log call, `answer` leg A.*
2. `call.answered` (caller A): dial agent leg B, then **immediately bridge A↔B with
   `play_ringtone: true`**. Caller now hears ringback while B rings.
3. Agent answers (`call.answered`, agent B): legs are already bridged → connected. Handler **only
   updates the call status to `answered`** (no second bridge command).
4. Agent ignores / no answer: after 25s the agent leg times out and hangs up → *existing
   `call.hangup` (agent role) handler sees the caller still `initiated` → starts voicemail.*

### Changes required

**`lib/telnyx/voice-orchestrator.ts`**
- `dialAgent(...)` returns the dialed agent leg's `call_control_id` (from `calls.dial()` →
  `response.data.call_control_id`).
- `bridgeLegs(aLegId, bLegId, opts?)` accepts an optional `{ playRingtone?: boolean }` and passes
  `play_ringtone` through to the Telnyx `bridge` action.

**`app/api/webhooks/telnyx/voice/route.ts`**
- `handleCallAnswered`, caller-leg branch: capture the agent leg id from `dialAgent` and call
  `bridgeLegs(callerLegId, agentLegId, { playRingtone: true })`. Keep the existing try/catch that
  falls back to voicemail if dialing fails.
- `handleCallAnswered`, agent-leg branch: since the bridge was issued at dial time, **replace the
  `bridgeLegs` call with just the status update** (`answered`, `started_at`). (If re-bridging an
  already-bridged leg proves harmless we may keep it idempotently, but the default is to drop it.)

No changes to `call.hangup`, voicemail, recording, or notification handling.

## Edge case to verify in testing

The one behavior we must confirm (and is exactly the previously-untested scenario): **agent online
but ignores the call → caller still reaches voicemail.** The expectation is that because the agent
leg never answers, the bridge never fully establishes, so the caller leg is not torn down when the
agent leg times out — leaving `call.hangup` (agent role) to trigger voicemail as today.

If testing shows the caller leg is dropped on agent-timeout, the mitigation is to set
`park_after_unbridge: 'self'` on the caller leg (or fall back to Approach B, a ringback audio loop).

## Test plan (manual, real call)

1. **Agent online, answers** → caller hears ringback, then connects on pickup; call logged
   `answered` → `completed`.
2. **Agent online, ignores** → caller hears ringback for 25s, then voicemail greeting + recording;
   call logged `voicemail` (NOT `missed`). ← primary fix verification.
3. **Agent offline** → caller hears ringback briefly (B fails fast) then voicemail; still works.
4. **Caller hangs up during ringback** → logged `missed`, no orphaned legs.

## Out of scope (tracked separately)

- HGI number `+12109348999` mistyped as `+2109348999` in the `phone_numbers` table.
- `+18326130706` has no Telnyx connection and is not in the DB.
