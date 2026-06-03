# Voicemail Design Spec

**Date:** 2026-06-04
**Status:** Approved

## Problem

When no agent answers an inbound call — whether agents are offline or simply busy — the caller gets nothing. There is no way for them to leave a message and no way for agents to know what the caller needed. Missed calls become dead ends.

## Solution Overview

After 30 seconds of ringing with no answer, Telnyx answers the call programmatically, speaks a custom TTS greeting per phone number (brand), and records the caller's message. The recording is saved to Supabase, surfaced in the Calls page as an expandable audio player, and delivered to agents via the notification bell. The timeout is enforced by a Supabase pg_cron job — so voicemail works even when zero agents are online.

## Database

### 1. `phone_numbers` — add `voicemail_greeting`

```sql
alter table phone_numbers
  add column voicemail_greeting text;
```

Nullable. If null, falls back to the default greeting: *"Hi, you've reached our team. We're unavailable right now. Please leave a message after the tone."*

Each brand configures their own greeting text in the Phone Numbers settings page.

### 2. New `voicemails` table

```sql
create table voicemails (
  id               uuid primary key default gen_random_uuid(),
  call_id          uuid not null references calls(id),
  recording_url    text not null,
  duration_seconds int not null default 0,
  is_heard         boolean not null default false,
  created_at       timestamptz not null default now()
);

alter table voicemails enable row level security;

create policy "Agents can read voicemails"
  on voicemails for select to authenticated using (true);

create policy "Agents can update voicemails"
  on voicemails for update to authenticated using (true) with check (true);
```

### 3. `calls` — add `has_voicemail`

```sql
alter table calls
  add column has_voicemail boolean not null default false;
```

Set to `true` when a voicemail recording is saved. Allows the Calls page to show the voicemail indicator without joining the `voicemails` table on every row.

### 4. `calls` — new status value

The existing `status` field (plain `text`) gains a new value: `'voicemail'`. This is set the moment the server answers the call to begin the voicemail flow, preventing duplicate triggers.

## Timeout Mechanism — pg_cron + pg_net

Enable both extensions in Supabase dashboard → Database → Extensions:
- `pg_cron` — runs scheduled PostgreSQL jobs
- `pg_net` — makes HTTP requests from inside PostgreSQL

### Cron job

```sql
select cron.schedule(
  'voicemail-trigger',
  '15 seconds',
  $$
    select net.http_post(
      url := 'https://<your-domain>/api/cron/voicemail-check',
      headers := '{"Content-Type": "application/json", "x-cron-secret": "<CRON_SECRET>"}'::jsonb,
      body := '{}'::jsonb
    )
  $$
);
```

Runs every 15 seconds. Calls the voicemail-check route which queries for unanswered calls and triggers voicemail for each.

### Environment variable

`CRON_SECRET` — a random string set in `.env.local` and Vercel env vars. The cron route validates this header to reject unauthorized requests.

## Call Flow Sequence

```
1. Inbound call arrives
   → Telnyx fires call.initiated
   → Saved to DB: status='initiated', direction='inbound'
   → IncomingCallProvider shows ringing UI to online agents

2. pg_cron fires every 15 seconds
   → Queries: calls WHERE status='initiated'
              AND direction='inbound'
              AND created_at < now() - interval '30 seconds'
   → POSTs each to /api/cron/voicemail-check

3. /api/calls/voicemail-start (called by voicemail-check)
   → Guards: if call.status !== 'initiated', return early (duplicate protection)
   → Updates call status to 'voicemail'
   → Answers call via Telnyx API: POST /v2/calls/{call_control_id}/actions/answer
   → Fetches phone_number.voicemail_greeting (falls back to default)
   → Speaks greeting via Telnyx TTS: POST /v2/calls/{call_control_id}/actions/speak

4. Telnyx fires call.speak.ended
   → Starts recording: POST /v2/calls/{call_control_id}/actions/record_start

5. Caller leaves message and hangs up
   → Telnyx fires call.recording.saved with recording_url and duration

6. handleRecordingSaved (in voice webhook)
   → Inserts row into voicemails table
   → Sets calls.has_voicemail = true
   → Inserts 'voicemail' notification into notifications table
```

## API Routes

### `POST /api/cron/voicemail-check`

Protected by `x-cron-secret` header. Queries for unanswered inbound calls older than 30 seconds. For each call found, inline:
1. Guards against duplicate execution — updates `status` to `'voicemail'` atomically (only if current status is `'initiated'`)
2. Answers the call via Telnyx API
3. Fetches `phone_numbers.voicemail_greeting` (falls back to default)
4. Speaks the greeting via Telnyx TTS

No separate voicemail-start route needed — all logic lives in the cron handler.

## Voice Webhook — New Events

Add two cases to the existing switch in `app/api/webhooks/telnyx/voice/route.ts`:

```ts
case "call.speak.ended":
  await handleSpeakEnded(supabase, payload)
  break
case "call.recording.saved":
  await handleRecordingSaved(supabase, payload)
  break
```

### `handleSpeakEnded`
- Checks call status is `'voicemail'` (guards against speak events from other flows)
- Calls Telnyx `record_start` action

### `handleRecordingSaved`
Payload includes `recording_url`, `duration_ms`, `call_control_id`:
- Looks up call by `telnyx_call_id`
- Inserts voicemail row
- Updates `calls.has_voicemail = true`
- Looks up phone number for label
- Inserts notification:
```ts
{
  type: "voicemail",
  reference_id: call.id,
  metadata: {
    contact_number: call.contact_number,
    phone_label: phoneNumber.label,
    duration_seconds: Math.round(payload.duration_ms / 1000),
  }
}
```

## UI Changes

### Calls Page — Row Expansion

`components/calls/calls-table.tsx`:
- Rows where `has_voicemail = true` show a mic icon
- Clicking the row expands it to reveal:
  - `<audio>` element with `src={recording_url}`
  - Play/pause button and duration display
  - On first play: updates `voicemails.is_heard = true`

### Notification Bell — Voicemail Section

`components/notifications/notification-bell.tsx`:
- Third section added: **Voicemails** with a mic icon
- Each item shows contact number, phone label, duration, relative time
- Clicking navigates to `/dashboard/calls`

`types/notifications.ts`:
- `NotificationType` union gains `'voicemail'`
- `NotificationMetadata` gains optional `duration_seconds?: number`

### Phone Numbers Settings — Greeting Field

`app/dashboard/settings/phone-numbers/page.tsx`:
- Each phone number row gets a textarea for `voicemail_greeting`
- Placeholder: *"Hi, you've reached our team..."*
- Saving updates `phone_numbers.voicemail_greeting`
- Empty = use default greeting

## Error Handling

| Scenario | Behavior |
|---|---|
| Agent answers before 30s | Call status is `answered` — pg_cron skips it |
| Caller hangs up before 30s | Status becomes `missed` — voicemail-check finds nothing |
| Duplicate pg_cron trigger | `voicemail-start` checks status !== `initiated` → returns early |
| Telnyx API error on answer | Log error, call stays `missed`, no broken state |
| pg_net POST fails | Next 15s tick retries — call still `initiated` |
| Caller hangs up during greeting | `call.recording.saved` never fires — no voicemail created |
| No recording URL in payload | Log and skip — `has_voicemail` stays false |
| Missing CRON_SECRET | Route returns 401, logs warning |

## Future Extensibility

- **Transcription** — add `transcription text` column to `voicemails`. A post-processing step calls a speech-to-text API (Deepgram, Whisper) after `call.recording.saved` and fills it in. The Calls page can show the transcript below the audio player.
- **AI voicemail** — the greeting can be replaced with a conversational AI agent that gathers caller intent before recording.
