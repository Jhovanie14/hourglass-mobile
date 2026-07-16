# Call Transcription — Design Spec

**Date:** 2026-07-17
**Status:** Draft for review
**Author:** Jhovanie + Claude

## Problem

Calls leave no readable record. To know what was said on a call, someone has to
have been on it. The client wants transcripts of conversations for review and
records, and has approved the cost: the **standard Telnyx in-house engine at
$0.025/min** (decision 2026-07-17; the $0.05/min Google engine was declined).

## Goal

Every answered conversation — inbound calls an agent picks up and outbound
calls placed from the softphone — is transcribed automatically. After the call,
the transcript appears in the dashboard call history: expandable under the call
row, chat-style, with each line attributed to **Agent** or the contact's
number.

## Non-goals

- **No live/in-call transcript view.** Transcription runs during the call, but
  the product surface is post-call only. (The Telnyx engine sends no interim
  results anyway — only finalized segments.)
- **No voicemail transcription.** Voicemail messages keep working as today
  (audio only).
- **No notifications, no Jades delivery.** Dashboard only.
- **No call recording.** Real-time transcription needs no stored audio.
- **No per-number/per-call toggles.** Always-on, with a single env kill switch.
- **No extension changes.** This feature is entirely server + dashboard; the
  Chrome extension is untouched (no Store review needed).

## Key facts grounding the design (verified in code / SDK)

- **Hook points exist.** `app/api/webhooks/telnyx/voice/route.ts` →
  `handleCallAnswered`: the inbound bridge-success path (where `started_at` is
  set) and the `mark_outbound_answered` path are exactly where a conversation
  becomes live. Voicemail paths answer the caller but never pass through
  either, so hooking there structurally excludes voicemails.
- **One leg per call row.** `calls.telnyx_call_id` stores the caller (A) leg
  for inbound and the softphone-originated leg for outbound. Transcription is
  started on that leg; every `call.transcription` event carries the same
  `call_control_id`, so events map back to the call row with the same
  `eq("telnyx_call_id", ...)` lookup the webhook already uses.
- **SDK support (telnyx ^6.73.0, in node_modules):**
  `telnyx.calls.actions.startTranscription(callControlId, body)` → `POST
  /calls/{id}/actions/transcription_start`. Transcription **stops automatically
  on hang-up** (SDK doc) — no teardown needed. Params:
  `transcription_engine: "Telnyx"`, `transcription_tracks: "inbound" |
  "outbound" | "both"` (default `inbound`), `transcription_engine_config:
  { transcription_engine: "Telnyx", language, transcription_model:
  "openai/whisper-tiny" | "openai/whisper-large-v3-turbo" }`.
- **Webhook event:** `call.transcription` with `transcription_data =
  { transcript, confidence, is_final, transcription_track }`.
  `transcription_track` (`"inbound"` = audio Telnyx receives from that leg's
  party, `"outbound"` = audio sent to them) **is only populated by the Telnyx
  engine** — the engine the client chose — which is what makes per-speaker
  attribution possible.
- **Signature verification already covers it.** `verifyTelnyxWebhook` runs
  before the event switch; `call.transcription` inherits it.
- **UI precedent.** `calls-table.tsx` expandable rows host `VoicemailPlayer`
  keyed on `calls.has_voicemail`; the transcript view mirrors this with
  `has_transcript`. The `voicemails` table + RLS is the DB precedent.

## Approach

Start real-time transcription from the voice webhook at the moment a
conversation becomes live; store each finalized segment from the
`call.transcription` webhook as a row; render segments in the dashboard.

Rejected alternatives:
- **Record calls, transcribe recordings after** — adds recording of every
  conversation (a consent/announcement change the client didn't ask for),
  audio storage forever, delayed transcripts, and a second pipeline.
- **Browser-side transcription (Web Speech API)** — captures only the agent's
  side reliably, browser-dependent quality, no server source of truth.

## Components

### 1. Pure logic: `lib/telnyx/transcription.ts` (new, unit-tested)

No I/O. Three exports:
- `isTranscriptionEnabled(env)` — kill switch: enabled unless
  `CALL_TRANSCRIPTION_ENABLED === "false"`.
- `speakerForTrack(direction, track)` → `"agent" | "contact" | null`:

  | call direction | track `inbound` | track `outbound` | track missing |
  |---|---|---|---|
  | `inbound` (A leg) | `contact` (caller speaks) | `agent` | `null` |
  | `outbound` (softphone leg) | `agent` (agent speaks) | `contact` | `null` |

- `segmentFromEvent(direction, payload, occurredAt)` → insertable row or
  `null` (drops `is_final === false` and empty/whitespace transcripts).

### 2. Orchestrator: `lib/telnyx/voice-orchestrator.ts`

New `startCallTranscription(callControlId)` — same `withRetry` + `commandId()`
idiom as its siblings. Engine `Telnyx`, tracks `both`, language `en`, model
`openai/whisper-large-v3-turbo` (accuracy over the tiny model; same listed
engine price).

### 3. Webhook: `app/api/webhooks/telnyx/voice/route.ts`

- **Start (two one-liners in `handleCallAnswered`):** after `bridgeLegs`
  succeeds (inbound) and after `markOutboundAnswered` (outbound) —
  `if (isTranscriptionEnabled(process.env)) startCallTranscription(...)`,
  try/catch-logged, never blocking the call flow.
- **Ingest (new case `"call.transcription"`):** normalize via
  `segmentFromEvent` (drop → return early), look up
  `calls.id, direction` by `telnyx_call_id`, insert into
  `call_transcript_segments`, then
  `update calls set has_transcript = true where id = ? and has_transcript = false`.
  Every failure is logged and swallowed — segments are independent; one bad
  event never breaks the call or later segments.
- The kill switch gates **starting** only; events from a call already being
  transcribed are always ingested (the cost is already incurred).

### 4. Database (SQL run in the Supabase dashboard, as with `voicemails`)

```sql
create table call_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  speaker text check (speaker in ('agent', 'contact')),  -- null = unlabeled
  transcript text not null,
  confidence real,
  occurred_at timestamptz not null,  -- Telnyx event time; display order
  created_at timestamptz not null default now()
);
create index call_transcript_segments_call_idx
  on call_transcript_segments (call_id, occurred_at);

alter table calls add column has_transcript boolean not null default false;
```

RLS mirrors `voicemails`: authenticated users read; writes come only from the
webhook's admin (service-role) client.

### 5. Dashboard UI

- **`components/calls/transcript-view.tsx`** (new) — mirrors
  `VoicemailPlayer`: client-side Supabase fetch of segments by `call_id`
  ordered by `occurred_at`, chat-style render. Consecutive same-speaker
  segments merge into one block; `agent` → "Agent", `contact` → the call's
  contact number, `null` → neutral/unlabeled. Loading and "No transcript"
  states.
- **`components/calls/calls-table.tsx`** — expanded row shows a Transcript
  section (with `TranscriptView`) when `call.has_transcript`, alongside the
  voicemail player when both exist. Include `has_transcript` in the calls
  query if columns are listed explicitly.
- **`types/calls.ts`** — `has_transcript?: boolean` on `Call`; new
  `TranscriptSegment` type.

## Data & control flow

```
conversation goes live
  inbound:  bridgeLegs(A, B) succeeds ─┐
  outbound: markOutboundAnswered      ─┴→ startCallTranscription(telnyx_call_id leg)
                                            [skipped if CALL_TRANSCRIPTION_ENABLED="false"]
Telnyx transcribes both tracks during the call
  → call.transcription events → voice webhook
     → segmentFromEvent(direction, payload, occurred_at) → null? drop
     → insert call_transcript_segments (speaker via speakerForTrack)
     → calls.has_transcript = true (first segment)
call hangs up → Telnyx stops transcription automatically
dashboard call history → row expands → TranscriptView(call_id)
  → segments ordered by occurred_at → grouped chat view
```

## Error handling & edge cases

- `startCallTranscription` failure: logged, call proceeds untranscribed.
- Segment insert failure: logged; later segments unaffected.
- Missing `transcription_track`: speaker `null`, still stored and rendered.
- Out-of-order webhook delivery: display order is event `occurred_at`
  (`created_at` tiebreak), not arrival order.
- Voicemail legs: never transcribed (start sits strictly after bridge /
  outbound answer).
- Mid-call kill switch flip: affects the next call, not in-flight ones.

## Testing

- **Unit (vitest, node env):** `lib/telnyx/transcription.test.ts` — the
  speaker matrix (2 directions × 3 track states), kill-switch parsing
  (unset / "true" / "false"), `segmentFromEvent` (final vs interim, empty
  transcript, full field mapping).
- **Manual E2E:** inbound answered call → segments with correct speakers;
  outbound call → flipped attribution correct; voicemail left → zero segments;
  `CALL_TRANSCRIPTION_ENABLED=false` → no transcription started; a call with
  both voicemail and transcript renders both in the expanded row.
- React components: `npm run typecheck` + manual load (repo convention — no
  jsdom).

## Delivery

**Web deploy only** (megestic.com). No extension changes, no Chrome Web Store
review. Run the SQL (table + column + RLS) in the Supabase dashboard **before**
deploying the webhook changes; the code is backward-safe if transcription
simply isn't started.

## Open questions / risks

- **Billing for `tracks: "both"`:** Telnyx's pricing page lists $0.025/min for
  the engine but doesn't state whether transcribing both tracks bills each
  track's minutes (≈2× per conversation-minute). Verify with Telnyx
  support / the first invoice before quoting the client a final monthly
  number.
- **Whisper model pricing:** the listed price is per-engine; confirm the
  `whisper-large-v3-turbo` model carries no premium over `whisper-tiny`.
- **English-only** (`language: "en"`) for v1; revisit if the client's brands
  take non-English calls.
- **Segment granularity is engine-controlled:** utterance sizes/punctuation
  may look different from expectations; acceptable for v1, judge in E2E.
