# Off-hours / No-answer Voicemail via Telnyx Call Control — Design Spec

**Date:** 2026-06-16
**Status:** Draft (awaiting user review)
**Supersedes the trigger mechanism of:** `2026-06-04-voicemail-design.md`

## Problem

When an inbound call is not answered — because every agent is offline (weekends / after
hours) or simply nobody picks up — the caller currently gets nothing. The earlier voicemail
attempt (`2026-06-04-voicemail-design.md`) relied on Telnyx **Programmable Voice / Call
Control** commands (`answer` / `speak` / `record_start`) to drive the voicemail flow, but the
phone numbers are assigned to a **SIP Trunking** profile so the WebRTC client can `REGISTER`
and receive inbound calls. A Telnyx number can point at only **one** connection at a time, and
Call Control commands do not control a leg owned by a SIP trunk — so `speak`/`record` silently
did nothing. The `voicemail-check` cron was consequently gutted down to "mark stale calls as
missed," and voicemail never shipped.

## Goal

Inbound call → ring the WebRTC agents exactly as today → **if offline or unanswered**, play a
greeting, record the caller's message, and save it to the database with a notification. No
business-hours schedule and no agent-presence tracking: the **dial result** is the trigger.

## Solution Overview

Move the number from the SIP trunk to a **Voice API (Call Control) application** and orchestrate
every inbound call server-side, following the Telnyx **Find Me / Follow Me + voicemail** demo
pattern — adapted so the "agent" leg is the WebRTC **SIP credential**
(`sip:$TELNYX_SIP_USERNAME@sip.telnyx.com`) instead of a PSTN mobile.

```
Caller (PSTN)
   │  inbound
   ▼
Telnyx Voice API App ──webhook──▶ /api/webhooks/telnyx/voice  (orchestrator)
   │
   ├─ answer caller leg (A)
   ├─ dial agent leg (B) → sip:$TELNYX_SIP_USERNAME@sip.telnyx.com, timeout_secs = 25
   │
   ├─ B answered            → bridge(A,B)   → normal call (rings agents exactly like today)
   └─ B failed / timeout    → voicemail: speak greeting → record → save → notify
        (offline = no SIP registration → B fails in ~1s; no-answer = B times out at 25s)
```

**Why no schedule is needed:** if no WebRTC client is registered, the dial to the SIP
credential fails almost immediately (SIP 404/480) → voicemail. If a client is registered but
nobody answers, the dial leg times out at `timeout_secs` → voicemail. If answered → bridge.
The system reacts to the dial outcome instead of guessing availability.

## Telnyx Event Sequence

| # | Telnyx event (leg) | Server action |
|---|---|---|
| 1 | `call.initiated` (A, inbound, parked) | Insert call row `status=initiated` (existing). `answer` leg A. |
| 2 | `call.answered` (A) | `telnyx.calls.create(...)` → dial leg B to the SIP credential with `timeout_secs: 25` and `client_state` identifying it as the agent leg + carrying leg A's `call_control_id`. |
| 3 | `call.answered` (B) | `bridge(A, B)`; set call `status=answered`. |
| 4a | `call.hangup` (B) **before** answer (offline / busy / timeout) | Begin voicemail on leg A: set `status=voicemail`, `speak(greeting)`. |
| 4b | `call.hangup` (A) — caller hung up first | `status=missed` + missed-call notification (existing logic). |
| 5 | `call.speak.ended` (A, status=voicemail) | `startRecording({ format:"mp3", channels:"single" })` — **existing handler, unchanged**. |
| 6 | `call.recording.saved` | Download MP3 → private bucket, insert `voicemails`, set `has_voicemail`, notify — extends existing handler (see Storage). |

Steps 5–6 already exist in `app/api/webhooks/telnyx/voice/route.ts`; this design adds the
orchestration in steps 1–4 and hardens step 6's storage.

## Leg Correlation — `client_state`

Telnyx echoes the base64 `client_state` set on `calls.create` back in every webhook for that
leg. We encode JSON `{ role: "agent", aLegId: <A call_control_id>, callId: <db id> }` and use it
to:

1. **Skip logging the agent leg.** Today `handleCallInitiated` treats any `direction:"outgoing"`
   event as an outbound call and inserts a row. The dialed agent leg (B) is `outgoing`; without a
   guard it would create a spurious "outbound" call. → If `client_state.role === "agent"`, return
   early (no DB write).
2. **Find leg A on agent-leg failure.** On `call.hangup` for leg B, read `aLegId` from
   `client_state` to know which caller leg to send to voicemail — no DB lookup race.

`client_state` round-trips through Telnyx and arrives inside a **signature-verified** webhook, so
it cannot be forged by an external caller.

## Database

**No schema migration for the trigger.** Reuses `voicemails`, `calls.has_voicemail`,
`calls.status='voicemail'`, `phone_numbers.voicemail_greeting`, and `notifications`.

**One additive column for secure storage:**

```sql
alter table voicemails add column storage_path text;
```

`recording_url` remains for backward compatibility / transcription source; `storage_path` holds
the private-bucket object path once the MP3 is copied in (see Storage). Nullable so existing rows
are unaffected.

## Recording Storage (PII hardening)

Telnyx-hosted `recording_url` is a publicly reachable MP3 — anyone with the link can listen, and
it contains customer voice (PII). Instead:

1. On `call.recording.saved`, fetch the MP3 from Telnyx server-side (`TELNYX_API_KEY` auth).
2. Upload to a **private** Supabase Storage bucket `voicemails/<call_id>.mp3`; store the object
   path in `voicemails.storage_path`.
3. (Best-effort) delete the Telnyx-side recording via the Recordings API to avoid leaving a
   public copy.
4. The Calls page no longer binds `recording_url` directly. A new tiny authenticated route
   `GET /api/voicemails/[id]/audio` returns a **short-lived signed URL** (≈60s) from the private
   bucket, gated by the user's session. The `<audio>` element points at this route.

Bucket creation + RLS-equivalent policy (storage objects) is a one-time setup documented in the
plan. If fetching/uploading fails, fall back to storing the Telnyx `recording_url` so a voicemail
is never lost — logged as a warning.

## Code Structure

New / changed:

- `lib/telnyx/client.ts` — single `getTelnyxClient()` plus a `withRetry(fn)` helper
  (exponential backoff, honors `429`/`5xx`) replacing the ad-hoc `new Telnyx(...)` scattered in
  routes. All Call Control commands pass a `command_id` (idempotency key) so Telnyx-side retries
  don't double-execute.
- `lib/telnyx/voice-orchestrator.ts` — small single-purpose helpers: `answerCaller`,
  `dialAgent`, `bridgeLegs`, `startVoicemail`, `encodeClientState`/`decodeClientState`. Keeps the
  route handler thin and unit-testable.
- `app/api/webhooks/telnyx/voice/route.ts` — extend the existing switch:
  - `handleCallInitiated`: answer leg A (inbound); for agent-leg events (`client_state.role==="agent"`) return early.
  - `handleCallAnswered`: leg A → `dialAgent`; leg B → `bridgeLegs`.
  - `handleAgentLegHangup` (new): on leg B failure before bridge → `startVoicemail` on leg A.
  - `handleSpeakEnded`, `handleRecordingSaved`: reused; `handleRecordingSaved` extended with the
    private-bucket copy.
- `app/api/voicemails/[id]/audio/route.ts` — authenticated signed-URL issuer for playback.
- `components/calls/calls-table.tsx` — audio player `src` points at the signed-URL route.

Deleted (dead and/or insecure):

- `app/api/calls/speak/route.ts` — **unauthenticated**; anyone could POST a `call_control_id`
  + text and make Telnyx speak (cost abuse). Not called by any client. Orchestrator speaks
  internally instead.
- `app/api/calls/voicemail-start/route.ts` — folded into the webhook orchestrator; removes a
  public surface.
- `app/api/cron/voicemail-check/route.ts` — the 15s polling hack is obsolete; the dial-result
  flow replaces it. (Stale-call cleanup, if still desired, becomes a non-trigger concern.)

## Security Hardening Summary

| Risk | Mitigation |
|---|---|
| **Webhook replay** | Existing Ed25519 verify ignores timestamp age. Add freshness window: reject if `telnyx-timestamp` is more than **±300s** from server time. |
| **Signature optional in prod** | Make `TELNYX_WEBHOOK_PUBLIC_KEY` **required** — fail closed (403) if unset. |
| **Unauthenticated speak route** | Deleted (see above). |
| **Open voicemail-start route** | Deleted / folded into webhook. |
| **API key leakage** | `TELNYX_API_KEY` + `SUPABASE_SECRET_KEY` stay server-only, never `NEXT_PUBLIC_`, never logged. Logs carry call metadata only. |
| **Telnyx rate limits** | `withRetry()` backoff on `429`/`5xx`; `command_id` idempotency keys on every command. |
| **Duplicate / out-of-order webhooks** | Idempotent handlers guarded on DB `status` transitions; `upsert(..., { ignoreDuplicates: true })` for inserts; `client_state` to disambiguate legs. |
| **Recording PII / public MP3 URL** | Copied to a private bucket; served via short-lived signed URLs gated by session; Telnyx-side copy deleted best-effort. |
| **Call-spam cost abuse** | Residual: answering+dialing every inbound costs money. Limited by signature-verified webhooks and Telnyx number-level controls; noted, not fully solved. |

## Error Handling

| Scenario | Behavior |
|---|---|
| Agents offline (no SIP registration) | Leg B fails ~1s → voicemail. |
| Agents online, no pickup | Leg B times out at `timeout_secs` → voicemail. |
| Agent answers | `bridge(A,B)`, `status=answered`. |
| Caller hangs up while ringing | Leg A `call.hangup` → `missed` + notification; leg B is cleaned up. |
| Caller hangs up during greeting | No `call.recording.saved` → no voicemail row (matches current behavior). |
| `dialAgent` Telnyx error | Logged; on failure go straight to voicemail rather than dropping the caller. |
| Bucket upload fails | Fall back to storing Telnyx `recording_url`; warn. Voicemail never lost. |
| Duplicate webhook delivery | Status guards + idempotency keys make re-processing a no-op. |
| `TELNYX_WEBHOOK_PUBLIC_KEY` unset | 403, request rejected (fail closed). |

## Testing

- **Unit:** `encode/decodeClientState` round-trip; orchestrator helpers with a mocked Telnyx
  client (assert correct `answer`/`create`/`bridge`/`speak` calls + `client_state` payloads);
  signature + timestamp-freshness verifier (valid, bad-sig, stale-timestamp, missing-key cases).
- **Integration (mocked Telnyx + Supabase):** drive the webhook with recorded event fixtures for
  the three paths — bridged, offline→voicemail, no-answer→voicemail — and assert DB end state.
- **Manual:** with the number on the Voice API app — (a) agent online answers; (b) agent online
  ignores until timeout; (c) all agents offline. Verify voicemail row, `has_voicemail`,
  notification, and signed-URL playback.

## Telnyx Dashboard / Env Config (one-time, documented in the plan)

- Create/confirm a **Voice API (Call Control) application**; set its webhook URL to
  `/api/webhooks/telnyx/voice`; assign the phone number(s) to it (moving them off the SIP trunk).
- Keep the **credential SIP connection** for the WebRTC client (the dial target
  `sip:$TELNYX_SIP_USERNAME@sip.telnyx.com` resolves to it).
- Env: `TELNYX_API_KEY`, `TELNYX_WEBHOOK_PUBLIC_KEY` (now required), `TELNYX_SIP_USERNAME`,
  `TELNYX_SIP_PASSWORD`, `SUPABASE_SECRET_KEY` — all server-only.

## Out of Scope (future)

- Transcription of recordings (Deepgram/Whisper) into a `voicemails.transcription` column.
- Conversational **Telnyx AI Assistant** as an alternative to plain voicemail.
- Per-brand business-hours schedule / distinct weekend greeting (the greeting text already covers
  both offline and no-answer generically).
- Per-agent SIP credentials / presence UI (currently one shared credential).

## Decisions Locked

- **Recording storage:** private Supabase bucket + signed URLs (PII hardening).
- **`timeout_secs`:** 25 seconds.
- **Trigger:** dial-result based; no schedule.
