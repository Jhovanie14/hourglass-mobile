# Jades AI Event Integration — Design

**Date:** 2026-07-07
**Status:** Approved (design)
**Author:** Jhovanie + Claude

## Problem

The team runs a Slack-integrated AI agent ("Jades"). When an inbound
communication event happens on the Hourglass telephony backend — a **new SMS**,
a **missed call**, or a **voicemail** — Jades should receive it in real time so
it can post an enriched, property-tagged summary into Slack and tag the right
people.

Jades gave a precise data contract per event type. This design delivers those
events to Jades **securely and robustly**, without exposing the database or
handing out credentials.

## Key context (existing infrastructure)

- **Event spine already exists.** A `notifications` table already records every
  event Jades cares about. Its type is
  `NotificationType = "missed_call" | "unread_message" | "voicemail"`, and each
  row has `id`, `type`, `reference_id`, `metadata`, `is_read`, `created_at`.
  The Telnyx webhook handlers (`app/api/webhooks/telnyx/message`,
  `app/api/webhooks/telnyx/voice`) already write these rows.
- **Signed-webhook pattern already exists.** Inbound Telnyx webhooks are
  verified in `lib/telnyx/webhook.ts` (Ed25519 over `"{timestamp}|{body}"`). We
  mirror this style for our **outbound** signature (HMAC).
- Relevant tables/types: `calls`, `voicemails`, `messages`, `conversations`,
  `phone_numbers` (`.label` = the property name, e.g. "Fontana Dallas").

This feature is therefore a **delivery layer** on top of the existing
`notifications` table — not new event detection.

## Data availability vs. Jades' contract

| Field Jades wants | Source | Notes |
|---|---|---|
| Missed call: number, timestamp, property, duration | `calls` + `phone_numbers.label` | present |
| Missed call: caller name (CNAM) | — | **not available**; always `null` in v1 |
| Voicemail: audio URL, duration, timestamp, property | `voicemails.recording_url`, `calls`, `phone_numbers` | present |
| Voicemail: transcription | — | **not done in-app**; `null` — Jades transcribes from `audio_url` |
| SMS: from, to, body, timestamp, read/unread | `messages`, `conversations`, `notifications.is_read` | present |

`caller_name` and `transcription` are always emitted as `null` so Jades' parser
never breaks; they can be populated later (CNAM / transcription) **without a
contract change**.

## Architecture

```
Telnyx webhook (SMS / missed call / voicemail)   [already happens]
        │
        ▼
  write row to `notifications`   ◄── event spine / durability
        │
        ├──► [PUSH]  after() → deliverToJades(notification)
        │        enrich (join calls/voicemails/messages/phone_numbers)
        │        → build payload → HMAC-sign → POST JADES_WEBHOOK_URL
        │        → retry 2–3× w/ backoff; on final failure, log (backfill covers)
        │
        └──► [BACKFILL]  GET /api/jades/events?since=<cursor>
                 bearer auth → query notifications since cursor
                 → same enriched payloads → JSON array + next_since
```

**Durability guarantee:** the `notifications` table is the source of truth.
Backfill reads the same rows push sends, so **no event is ever lost** — a push
failure simply falls through to Jades' next poll. Push is a latency
optimization, not the safety net. Idempotency is free via `event_id` =
`notifications.id` (Jades dedupes).

**Single enrichment layer:** one pure function builds the payload for a
notification regardless of path, so push and backfill always emit identical
shapes.

## Payload schemas

**Type mapping** (DB notification type → payload `type`): `missed_call` →
`missed_call`, `voicemail` → `voicemail`, `unread_message` → `new_sms`. The
enrichment layer owns this mapping so the DB naming never leaks to Jades.

**Envelope (all events):**
```json
{
  "event_id": "b3f1…",                    // = notifications.id (idempotency key)
  "type": "missed_call | voicemail | new_sms",
  "occurred_at": "2026-07-07T18:42:05Z",  // ISO 8601, notifications.created_at
  "property": "Fontana Dallas",           // phone_numbers.label
  "property_line": "+19725550101",
  "data": { … }
}
```

**`missed_call` → data:**
```json
{
  "caller_number": "+12145551234",
  "caller_name": null,
  "duration_seconds": 0,
  "started_at": "2026-07-07T18:42:00Z",
  "call_id": "…"
}
```

**`voicemail` → data:**
```json
{
  "caller_number": "+12145551234",
  "caller_name": null,
  "audio_url": "https://…/recording.mp3",
  "transcription": null,
  "duration_seconds": 42,
  "voicemail_id": "…",
  "call_id": "…"
}
```

**`new_sms` → data:**
```json
{
  "from_number": "+12145551234",
  "to_number": "+19725550101",
  "body": "Is the unit still available?",
  "media_urls": [],
  "read": false,
  "message_id": "…",
  "conversation_id": "…"
}
```

Backfill returns a JSON array of these same objects.

## Security

**Outbound push signing (HMAC-SHA256, mirrors the Telnyx pattern):**
- Headers: `X-Hourglass-Signature: sha256=<hex>`, `X-Hourglass-Timestamp: <unix>`
- Signature = `HMAC-SHA256(JADES_WEBHOOK_SECRET, "{timestamp}.{rawBody}")`
- Jades verifies: recompute, **constant-time compare**, reject if timestamp skew
  > 5 minutes (replay protection).

**Backfill endpoint auth (`GET /api/jades/events`):**
- `Authorization: Bearer <JADES_API_TOKEN>`, constant-time compared.
- HTTPS only; reject non-GET.
- Caps: `limit` maxed at 200; `since` required and within a bounded window;
  basic rate-limit — a leaked token cannot dump unbounded history or hammer the DB.

**Least privilege / blast radius:**
- Endpoint exposes **only** the three notification types and **only** the fields
  above — no other tables, no DB keys, no write path. Jades can never write to
  the DB.
- **Two separate secrets** (`JADES_WEBHOOK_SECRET` for signing,
  `JADES_API_TOKEN` for backfill) so rotating one doesn't break the other. Both
  in deployment env vars, never in the repo.

## Robustness

- **Fast Telnyx response:** delivery runs in Next.js `after()` so the Telnyx
  webhook returns 200 immediately (Telnyx retries slow handlers).
- **Push retry:** 2–3× exponential backoff (e.g. 1s / 4s) inside the async task;
  final failure is logged with `event_id`.
- **Idempotency:** `event_id` = `notifications.id`; duplicate push+backfill is
  deduped by Jades.
- **Cursor correctness:** backfill orders by `(created_at, id)`, `since` is
  exclusive, returns `next_since`; events sharing a timestamp are never skipped.
- **Deferred (YAGNI):** a `jades_deliveries` outbox table for a retry/observability
  dashboard — not needed for correctness because backfill already guarantees
  delivery.

## Config

| Env var | Purpose |
|---|---|
| `JADES_WEBHOOK_URL` | where we POST events |
| `JADES_WEBHOOK_SECRET` | HMAC signing key (shared with Jades to verify) |
| `JADES_API_TOKEN` | bearer token for the backfill endpoint |

**Provisioning:** Jades provides its webhook URL. We generate the two secrets and
share them with Jades over a secure channel. Confirm `phone_numbers.label`
values are exactly the property names Jades expects ("Fontana Dallas",
"Woodvalley Houston").

## Code structure

Follows existing `lib/telnyx/…` + colocated `*.test.ts` conventions.

```
lib/jades/payload.ts          # pure: notification + joined rows → payload
lib/jades/payload.test.ts
lib/jades/sign.ts             # HMAC-SHA256 sign + verify
lib/jades/sign.test.ts
lib/jades/deliver.ts          # POST w/ retry, invoked via after()
app/api/jades/events/route.ts # backfill GET (bearer, cursor, caps)
```

Plus: call `deliverToJades()` (via `after()`) in the two Telnyx handlers right
after the `notifications` insert for the three relevant types.

## Testing

- **Unit (pure, mirrors `webhook.test.ts`):** payload builders per event type
  (incl. `null` caller_name/transcription); HMAC sign/verify + tampered-body
  rejection; bearer constant-time check; cursor/pagination + `next_since`.
- **Endpoint:** backfill returns correct shape, filters by `since`, enforces
  `limit` cap, rejects bad/missing token.
- **Manual (staging):** real inbound SMS + missed call → confirm signed push
  arrives at Jades and backfill lists the same event.

## Out of scope (v1)

- CNAM caller-name lookups.
- In-app voicemail transcription (Jades transcribes).
- Delivery outbox table / retry dashboard.
- Any write path from Jades back into the Hourglass DB.
```
