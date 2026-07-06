# Jades AI Event Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver inbound comms events (new SMS, missed call, voicemail) to the Slack-integrated Jades AI via signed real-time push webhooks plus a bearer-protected backfill endpoint.

**Architecture:** The existing `notifications` table is the event spine. A new `lib/jades/` delivery layer enriches each notification into a stable payload, signs it (HMAC-SHA256), and pushes it to Jades via Next.js `after()`; the same payloads are served by a read-only `GET /api/jades/events?since=` endpoint so nothing is ever lost. Pure builders + an injectable data source keep the logic unit-testable.

**Tech Stack:** Next.js 16 (App Router, `after()`), TypeScript, Supabase (`createAdminClient`), Node `crypto`, Vitest.

## Global Constraints

- Runtime: Next.js **16.2.6**, App Router. Use `import { after } from "next/server"` for post-response work.
- Supabase access server-side uses **`createAdminClient()` from `@/lib/admin`** (service role) — same as the Telnyx webhooks. Never expose this client or its key outside the server.
- Tests use **Vitest** (`npx vitest run`), colocated `*.test.ts`, mirroring `lib/telnyx/webhook.test.ts`.
- Node crypto import style: `import crypto from "node:crypto"`.
- Payload `type` values are exactly `"missed_call" | "voicemail" | "new_sms"`. DB notification type `unread_message` maps to payload `new_sms`.
- `caller_name` and `transcription` are always emitted as literal `null` in v1.
- Secrets come only from env: `JADES_WEBHOOK_URL`, `JADES_WEBHOOK_SECRET`, `JADES_API_TOKEN`. Never hardcode; never commit.
- Spec: `docs/superpowers/specs/2026-07-07-jades-event-integration-design.md`.

---

## File Structure

```
lib/jades/config.ts          # env accessors + isPushConfigured
lib/jades/sign.ts            # HMAC-SHA256 sign + verify (constant-time)
lib/jades/auth.ts            # constant-time bearer check
lib/jades/query.ts           # parse/validate ?since=&limit=
lib/jades/payload.ts         # event types + pure builders
lib/jades/load-event.ts      # EventDataSource interface + loadJadesEvent (pure switch)
lib/jades/supabase-source.ts # supabase-backed EventDataSource
lib/jades/deliver.ts         # sign + POST with retry (no-op if unconfigured)
lib/jades/notify.ts          # enqueueJadesDelivery() — after() wrapper
app/api/jades/events/route.ts # backfill GET endpoint
# modified:
app/api/webhooks/telnyx/message/route.ts  # select notification row + enqueue
app/api/webhooks/telnyx/voice/route.ts     # select notification rows + enqueue (x2)
.env.local.example (or README)             # document the 3 env vars
```

---

### Task 1: Config module

**Files:**
- Create: `lib/jades/config.ts`
- Test: `lib/jades/config.test.ts`

**Interfaces:**
- Produces: `type JadesConfig = { webhookUrl?: string; webhookSecret?: string; apiToken?: string }`, `getJadesConfig(): JadesConfig`, `isPushConfigured(c: JadesConfig): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// lib/jades/config.test.ts
import { afterEach, describe, expect, it } from "vitest"
import { getJadesConfig, isPushConfigured } from "./config"

const KEYS = ["JADES_WEBHOOK_URL", "JADES_WEBHOOK_SECRET", "JADES_API_TOKEN"] as const

afterEach(() => KEYS.forEach((k) => delete process.env[k]))

describe("getJadesConfig", () => {
  it("reads the three env vars", () => {
    process.env.JADES_WEBHOOK_URL = "https://jades.example/hook"
    process.env.JADES_WEBHOOK_SECRET = "sec"
    process.env.JADES_API_TOKEN = "tok"
    expect(getJadesConfig()).toEqual({
      webhookUrl: "https://jades.example/hook",
      webhookSecret: "sec",
      apiToken: "tok",
    })
  })

  it("isPushConfigured is true only when url AND secret present", () => {
    expect(isPushConfigured({ webhookUrl: "u", webhookSecret: "s" })).toBe(true)
    expect(isPushConfigured({ webhookUrl: "u" })).toBe(false)
    expect(isPushConfigured({})).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/jades/config.test.ts`
Expected: FAIL — `Cannot find module './config'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/jades/config.ts
export type JadesConfig = {
  webhookUrl?: string
  webhookSecret?: string
  apiToken?: string
}

export function getJadesConfig(): JadesConfig {
  return {
    webhookUrl: process.env.JADES_WEBHOOK_URL,
    webhookSecret: process.env.JADES_WEBHOOK_SECRET,
    apiToken: process.env.JADES_API_TOKEN,
  }
}

export function isPushConfigured(c: JadesConfig): boolean {
  return Boolean(c.webhookUrl && c.webhookSecret)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/jades/config.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/jades/config.ts lib/jades/config.test.ts
git commit -m "feat(jades): config module for env-based webhook settings"
```

---

### Task 2: Signing module

**Files:**
- Create: `lib/jades/sign.ts`
- Test: `lib/jades/sign.test.ts`

**Interfaces:**
- Produces: `signJadesPayload(secret: string, timestamp: string, rawBody: string): string` (returns `"sha256=<hex>"`), `verifyJadesSignature(secret: string, timestamp: string, rawBody: string, signature: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// lib/jades/sign.test.ts
import { describe, expect, it } from "vitest"
import { signJadesPayload, verifyJadesSignature } from "./sign"

describe("jades signing", () => {
  const secret = "shhh"
  const ts = "1751900000"
  const body = '{"event_id":"abc"}'

  it("produces a sha256= prefixed hex signature", () => {
    const sig = signJadesPayload(secret, ts, body)
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/)
  })

  it("verifies a matching signature", () => {
    const sig = signJadesPayload(secret, ts, body)
    expect(verifyJadesSignature(secret, ts, body, sig)).toBe(true)
  })

  it("rejects a tampered body", () => {
    const sig = signJadesPayload(secret, ts, body)
    expect(verifyJadesSignature(secret, ts, '{"event_id":"XXX"}', sig)).toBe(false)
  })

  it("rejects a wrong secret", () => {
    const sig = signJadesPayload(secret, ts, body)
    expect(verifyJadesSignature("other", ts, body, sig)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/jades/sign.test.ts`
Expected: FAIL — `Cannot find module './sign'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/jades/sign.ts
import crypto from "node:crypto"

export function signJadesPayload(secret: string, timestamp: string, rawBody: string): string {
  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")
  return `sha256=${digest}`
}

export function verifyJadesSignature(
  secret: string,
  timestamp: string,
  rawBody: string,
  signature: string,
): boolean {
  const expected = signJadesPayload(secret, timestamp, rawBody)
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/jades/sign.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/jades/sign.ts lib/jades/sign.test.ts
git commit -m "feat(jades): HMAC-SHA256 payload signing + verification"
```

---

### Task 3: Bearer auth check

**Files:**
- Create: `lib/jades/auth.ts`
- Test: `lib/jades/auth.test.ts`

**Interfaces:**
- Produces: `isValidBearer(authHeader: string | null, token: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
// lib/jades/auth.test.ts
import { describe, expect, it } from "vitest"
import { isValidBearer } from "./auth"

describe("isValidBearer", () => {
  it("accepts a correct bearer token", () => {
    expect(isValidBearer("Bearer tok123", "tok123")).toBe(true)
  })
  it("rejects a wrong token", () => {
    expect(isValidBearer("Bearer nope", "tok123")).toBe(false)
  })
  it("rejects missing header", () => {
    expect(isValidBearer(null, "tok123")).toBe(false)
  })
  it("rejects header without Bearer prefix", () => {
    expect(isValidBearer("tok123", "tok123")).toBe(false)
  })
  it("rejects when configured token is empty", () => {
    expect(isValidBearer("Bearer ", "")).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/jades/auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/jades/auth.ts
import crypto from "node:crypto"

const PREFIX = "Bearer "

export function isValidBearer(authHeader: string | null, token: string): boolean {
  if (!authHeader || !token) return false
  if (!authHeader.startsWith(PREFIX)) return false
  const provided = authHeader.slice(PREFIX.length)
  const a = Buffer.from(provided)
  const b = Buffer.from(token)
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/jades/auth.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/jades/auth.ts lib/jades/auth.test.ts
git commit -m "feat(jades): constant-time bearer token check"
```

---

### Task 4: Query param parsing

**Files:**
- Create: `lib/jades/query.ts`
- Test: `lib/jades/query.test.ts`

**Interfaces:**
- Produces: `type EventsQuery = { since: string; limit: number }`, `type EventsQueryResult = { ok: true; value: EventsQuery } | { ok: false; error: string }`, `parseEventsQuery(params: URLSearchParams): EventsQueryResult`. Constants: default limit 50, max limit 200.

- [ ] **Step 1: Write the failing test**

```ts
// lib/jades/query.test.ts
import { describe, expect, it } from "vitest"
import { parseEventsQuery } from "./query"

function q(s: string) {
  return new URLSearchParams(s)
}

describe("parseEventsQuery", () => {
  it("requires since", () => {
    const r = parseEventsQuery(q(""))
    expect(r.ok).toBe(false)
  })
  it("rejects a non-ISO since", () => {
    const r = parseEventsQuery(q("since=notadate"))
    expect(r.ok).toBe(false)
  })
  it("parses a valid since with default limit 50", () => {
    const r = parseEventsQuery(q("since=2026-07-07T00:00:00Z"))
    expect(r).toEqual({ ok: true, value: { since: "2026-07-07T00:00:00.000Z", limit: 50 } })
  })
  it("caps limit at 200", () => {
    const r = parseEventsQuery(q("since=2026-07-07T00:00:00Z&limit=999"))
    expect(r.ok && r.value.limit).toBe(200)
  })
  it("rejects a non-positive limit", () => {
    const r = parseEventsQuery(q("since=2026-07-07T00:00:00Z&limit=0"))
    expect(r.ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/jades/query.test.ts`
Expected: FAIL — `Cannot find module './query'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/jades/query.ts
export type EventsQuery = { since: string; limit: number }
export type EventsQueryResult =
  | { ok: true; value: EventsQuery }
  | { ok: false; error: string }

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export function parseEventsQuery(params: URLSearchParams): EventsQueryResult {
  const since = params.get("since")
  if (!since) return { ok: false, error: "missing 'since' query param" }
  const parsed = Date.parse(since)
  if (Number.isNaN(parsed)) return { ok: false, error: "'since' must be an ISO 8601 timestamp" }

  let limit = DEFAULT_LIMIT
  const limitRaw = params.get("limit")
  if (limitRaw !== null) {
    const n = Number(limitRaw)
    if (!Number.isInteger(n) || n < 1) return { ok: false, error: "'limit' must be a positive integer" }
    limit = Math.min(n, MAX_LIMIT)
  }
  return { ok: true, value: { since: new Date(parsed).toISOString(), limit } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/jades/query.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/jades/query.ts lib/jades/query.test.ts
git commit -m "feat(jades): backfill query param parsing with limit caps"
```

---

### Task 5: Payload types + pure builders

**Files:**
- Create: `lib/jades/payload.ts`
- Test: `lib/jades/payload.test.ts`

**Interfaces:**
- Consumes: `Notification` from `@/types/notifications` (`{ id, type, reference_id, metadata, is_read, created_at }`).
- Produces:
  - `type JadesEventType = "missed_call" | "voicemail" | "new_sms"`
  - `type JadesEvent` (discriminated union of envelopes)
  - Input row types: `PhoneRef`, `CallRef`, `VoicemailRef`, `ConversationRef`, `MessageRef`
  - `buildMissedCallEvent(n: Notification, call: CallRef): JadesEvent`
  - `buildVoicemailEvent(n: Notification, call: CallRef, vm: VoicemailRef): JadesEvent`
  - `buildSmsEvent(n: Notification, conv: ConversationRef, msg: MessageRef): JadesEvent`

- [ ] **Step 1: Write the failing test**

```ts
// lib/jades/payload.test.ts
import { describe, expect, it } from "vitest"
import type { Notification } from "@/types/notifications"
import { buildMissedCallEvent, buildVoicemailEvent, buildSmsEvent } from "./payload"

const base = { is_read: false, metadata: { contact_number: "+1", phone_label: "x" } }

const missedNotif: Notification = {
  ...base, id: "n1", type: "missed_call", reference_id: "call1", created_at: "2026-07-07T18:42:05.000Z",
}
const vmNotif: Notification = {
  ...base, id: "n2", type: "voicemail", reference_id: "call2", created_at: "2026-07-07T18:43:00.000Z",
}
const smsNotif: Notification = {
  ...base, id: "n3", type: "unread_message", reference_id: "conv1", is_read: true, created_at: "2026-07-07T18:44:00.000Z",
}

describe("payload builders", () => {
  it("builds a missed_call event", () => {
    expect(buildMissedCallEvent(missedNotif, {
      id: "call1", contact_number: "+12145551234", duration_seconds: 0, started_at: "2026-07-07T18:42:00.000Z",
      phone: { label: "Fontana Dallas", phone_number: "+19725550101" },
    })).toEqual({
      event_id: "n1", type: "missed_call", occurred_at: "2026-07-07T18:42:05.000Z",
      property: "Fontana Dallas", property_line: "+19725550101",
      data: { caller_number: "+12145551234", caller_name: null, duration_seconds: 0, started_at: "2026-07-07T18:42:00.000Z", call_id: "call1" },
    })
  })

  it("builds a voicemail event with null transcription", () => {
    const e = buildVoicemailEvent(vmNotif,
      { id: "call2", contact_number: "+12145551234", duration_seconds: 30, started_at: null, phone: { label: "Woodvalley Houston", phone_number: "+17135550102" } },
      { id: "vm1", recording_url: "https://x/rec.mp3", duration_seconds: 42 })
    expect(e).toEqual({
      event_id: "n2", type: "voicemail", occurred_at: "2026-07-07T18:43:00.000Z",
      property: "Woodvalley Houston", property_line: "+17135550102",
      data: { caller_number: "+12145551234", caller_name: null, audio_url: "https://x/rec.mp3", transcription: null, duration_seconds: 42, voicemail_id: "vm1", call_id: "call2" },
    })
  })

  it("builds a new_sms event, mapping unread_message and is_read", () => {
    const e = buildSmsEvent(smsNotif,
      { id: "conv1", contact_number: "+12145551234", phone: { label: "Fontana Dallas", phone_number: "+19725550101" } },
      { id: "msg1", body: "Is the unit available?", media_urls: null })
    expect(e).toEqual({
      event_id: "n3", type: "new_sms", occurred_at: "2026-07-07T18:44:00.000Z",
      property: "Fontana Dallas", property_line: "+19725550101",
      data: { from_number: "+12145551234", to_number: "+19725550101", body: "Is the unit available?", media_urls: [], read: true, message_id: "msg1", conversation_id: "conv1" },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/jades/payload.test.ts`
Expected: FAIL — `Cannot find module './payload'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/jades/payload.ts
import type { Notification } from "@/types/notifications"

export type JadesEventType = "missed_call" | "voicemail" | "new_sms"

type Envelope<T> = {
  event_id: string
  type: JadesEventType
  occurred_at: string
  property: string
  property_line: string
  data: T
}

export type MissedCallData = {
  caller_number: string
  caller_name: null
  duration_seconds: number
  started_at: string | null
  call_id: string
}
export type VoicemailData = {
  caller_number: string
  caller_name: null
  audio_url: string
  transcription: null
  duration_seconds: number
  voicemail_id: string
  call_id: string
}
export type SmsData = {
  from_number: string
  to_number: string
  body: string | null
  media_urls: string[]
  read: boolean
  message_id: string
  conversation_id: string
}
export type JadesEvent =
  | Envelope<MissedCallData>
  | Envelope<VoicemailData>
  | Envelope<SmsData>

// Minimal joined-row inputs the builders consume:
export type PhoneRef = { label: string; phone_number: string }
export type CallRef = {
  id: string
  contact_number: string
  duration_seconds: number
  started_at: string | null
  phone: PhoneRef
}
export type VoicemailRef = { id: string; recording_url: string; duration_seconds: number }
export type ConversationRef = { id: string; contact_number: string; phone: PhoneRef }
export type MessageRef = { id: string; body: string | null; media_urls: string[] | null }

export function buildMissedCallEvent(n: Notification, call: CallRef): JadesEvent {
  return {
    event_id: n.id,
    type: "missed_call",
    occurred_at: n.created_at,
    property: call.phone.label,
    property_line: call.phone.phone_number,
    data: {
      caller_number: call.contact_number,
      caller_name: null,
      duration_seconds: call.duration_seconds,
      started_at: call.started_at,
      call_id: call.id,
    },
  }
}

export function buildVoicemailEvent(n: Notification, call: CallRef, vm: VoicemailRef): JadesEvent {
  return {
    event_id: n.id,
    type: "voicemail",
    occurred_at: n.created_at,
    property: call.phone.label,
    property_line: call.phone.phone_number,
    data: {
      caller_number: call.contact_number,
      caller_name: null,
      audio_url: vm.recording_url,
      transcription: null,
      duration_seconds: vm.duration_seconds,
      voicemail_id: vm.id,
      call_id: call.id,
    },
  }
}

export function buildSmsEvent(n: Notification, conv: ConversationRef, msg: MessageRef): JadesEvent {
  return {
    event_id: n.id,
    type: "new_sms",
    occurred_at: n.created_at,
    property: conv.phone.label,
    property_line: conv.phone.phone_number,
    data: {
      from_number: conv.contact_number,
      to_number: conv.phone.phone_number,
      body: msg.body,
      media_urls: msg.media_urls ?? [],
      read: n.is_read,
      message_id: msg.id,
      conversation_id: conv.id,
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/jades/payload.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/jades/payload.ts lib/jades/payload.test.ts
git commit -m "feat(jades): event payload types + pure builders"
```

---

### Task 6: Enrichment loader (injectable data source)

**Files:**
- Create: `lib/jades/load-event.ts`
- Test: `lib/jades/load-event.test.ts`

**Interfaces:**
- Consumes: `Notification`; builders + row types from `./payload`.
- Produces:
  - `type EventDataSource = { getCall(callId: string): Promise<CallRef | null>; getVoicemailByCall(callId: string): Promise<VoicemailRef | null>; getConversation(convId: string): Promise<ConversationRef | null>; getLatestInboundMessage(convId: string): Promise<MessageRef | null> }`
  - `loadJadesEvent(src: EventDataSource, n: Notification): Promise<JadesEvent | null>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/jades/load-event.test.ts
import { describe, expect, it, vi } from "vitest"
import type { Notification } from "@/types/notifications"
import type { EventDataSource } from "./load-event"
import { loadJadesEvent } from "./load-event"

const meta = { contact_number: "+1", phone_label: "x" }
const phone = { label: "Fontana Dallas", phone_number: "+19725550101" }

function source(overrides: Partial<EventDataSource> = {}): EventDataSource {
  return {
    getCall: vi.fn().mockResolvedValue({ id: "call1", contact_number: "+12145551234", duration_seconds: 0, started_at: null, phone }),
    getVoicemailByCall: vi.fn().mockResolvedValue({ id: "vm1", recording_url: "https://x/r.mp3", duration_seconds: 12 }),
    getConversation: vi.fn().mockResolvedValue({ id: "conv1", contact_number: "+12145551234", phone }),
    getLatestInboundMessage: vi.fn().mockResolvedValue({ id: "msg1", body: "hi", media_urls: null }),
    ...overrides,
  }
}

const n = (over: Partial<Notification>): Notification => ({
  id: "n", type: "missed_call", reference_id: "call1", metadata: meta, is_read: false, created_at: "2026-07-07T00:00:00.000Z", ...over,
})

describe("loadJadesEvent", () => {
  it("loads a missed_call", async () => {
    const e = await loadJadesEvent(source(), n({ type: "missed_call", reference_id: "call1" }))
    expect(e?.type).toBe("missed_call")
  })
  it("loads a voicemail (call + voicemail)", async () => {
    const e = await loadJadesEvent(source(), n({ type: "voicemail", reference_id: "call2" }))
    expect(e?.type).toBe("voicemail")
  })
  it("maps unread_message to new_sms", async () => {
    const e = await loadJadesEvent(source(), n({ type: "unread_message", reference_id: "conv1" }))
    expect(e?.type).toBe("new_sms")
  })
  it("returns null when the joined row is missing", async () => {
    const e = await loadJadesEvent(source({ getCall: vi.fn().mockResolvedValue(null) }), n({ type: "missed_call" }))
    expect(e).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/jades/load-event.test.ts`
Expected: FAIL — `Cannot find module './load-event'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/jades/load-event.ts
import type { Notification } from "@/types/notifications"
import type { CallRef, ConversationRef, JadesEvent, MessageRef, VoicemailRef } from "./payload"
import { buildMissedCallEvent, buildSmsEvent, buildVoicemailEvent } from "./payload"

export type EventDataSource = {
  getCall(callId: string): Promise<CallRef | null>
  getVoicemailByCall(callId: string): Promise<VoicemailRef | null>
  getConversation(convId: string): Promise<ConversationRef | null>
  getLatestInboundMessage(convId: string): Promise<MessageRef | null>
}

export async function loadJadesEvent(src: EventDataSource, n: Notification): Promise<JadesEvent | null> {
  switch (n.type) {
    case "missed_call": {
      const call = await src.getCall(n.reference_id)
      return call ? buildMissedCallEvent(n, call) : null
    }
    case "voicemail": {
      const call = await src.getCall(n.reference_id)
      const vm = await src.getVoicemailByCall(n.reference_id)
      return call && vm ? buildVoicemailEvent(n, call, vm) : null
    }
    case "unread_message": {
      const conv = await src.getConversation(n.reference_id)
      const msg = await src.getLatestInboundMessage(n.reference_id)
      return conv && msg ? buildSmsEvent(n, conv, msg) : null
    }
    default:
      return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/jades/load-event.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/jades/load-event.ts lib/jades/load-event.test.ts
git commit -m "feat(jades): notification enrichment loader with injectable source"
```

---

### Task 7: Supabase-backed data source

**Files:**
- Create: `lib/jades/supabase-source.ts`

**Interfaces:**
- Consumes: `EventDataSource` from `./load-event`; `SupabaseClient` from `@supabase/supabase-js`.
- Produces: `supabaseDataSource(supabase: SupabaseClient): EventDataSource`

This task is a thin adapter over Supabase query chaining; it is verified by
`npx tsc --noEmit` and the manual staging test in Task 11 (mocking the Supabase
query builder in a unit test adds no confidence over typecheck for straight
passthrough). No new unit test file.

- [ ] **Step 1: Write the implementation**

```ts
// lib/jades/supabase-source.ts
import type { SupabaseClient } from "@supabase/supabase-js"
import type { EventDataSource } from "./load-event"

type PhoneJoin = { label: string; phone_number: string } | null

export function supabaseDataSource(supabase: SupabaseClient): EventDataSource {
  return {
    async getCall(callId) {
      const { data } = await supabase
        .from("calls")
        .select("id, contact_number, duration_seconds, started_at, phone_numbers(label, phone_number)")
        .eq("id", callId)
        .single()
      if (!data) return null
      const pn = data.phone_numbers as unknown as PhoneJoin
      if (!pn) return null
      return {
        id: data.id,
        contact_number: data.contact_number,
        duration_seconds: data.duration_seconds,
        started_at: data.started_at,
        phone: { label: pn.label, phone_number: pn.phone_number },
      }
    },

    async getVoicemailByCall(callId) {
      const { data } = await supabase
        .from("voicemails")
        .select("id, recording_url, duration_seconds")
        .eq("call_id", callId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) return null
      return { id: data.id, recording_url: data.recording_url, duration_seconds: data.duration_seconds }
    },

    async getConversation(convId) {
      const { data } = await supabase
        .from("conversations")
        .select("id, contact_number, phone_numbers(label, phone_number)")
        .eq("id", convId)
        .single()
      if (!data) return null
      const pn = data.phone_numbers as unknown as PhoneJoin
      if (!pn) return null
      return {
        id: data.id,
        contact_number: data.contact_number,
        phone: { label: pn.label, phone_number: pn.phone_number },
      }
    },

    async getLatestInboundMessage(convId) {
      const { data } = await supabase
        .from("messages")
        .select("id, body, media_urls")
        .eq("conversation_id", convId)
        .eq("direction", "inbound")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) return null
      return { id: data.id, body: data.body, media_urls: data.media_urls }
    },
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/jades/supabase-source.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/jades/supabase-source.ts
git commit -m "feat(jades): supabase-backed EventDataSource adapter"
```

---

### Task 8: Delivery (sign + POST with retry)

**Files:**
- Create: `lib/jades/deliver.ts`
- Test: `lib/jades/deliver.test.ts`

**Interfaces:**
- Consumes: `getJadesConfig`, `isPushConfigured` from `./config`; `signJadesPayload` from `./sign`; `JadesEvent` from `./payload`.
- Produces: `type DeliverOptions = { fetchImpl?: typeof fetch; maxAttempts?: number; backoffMs?: number[] }`, `deliverToJades(event: JadesEvent, opts?: DeliverOptions): Promise<{ delivered: boolean; attempts: number }>`

- [ ] **Step 1: Write the failing test**

```ts
// lib/jades/deliver.test.ts
import { afterEach, describe, expect, it, vi } from "vitest"
import type { JadesEvent } from "./payload"
import { deliverToJades } from "./deliver"

const event: JadesEvent = {
  event_id: "n1", type: "missed_call", occurred_at: "2026-07-07T00:00:00.000Z",
  property: "Fontana Dallas", property_line: "+19725550101",
  data: { caller_number: "+1", caller_name: null, duration_seconds: 0, started_at: null, call_id: "c1" },
}

afterEach(() => {
  delete process.env.JADES_WEBHOOK_URL
  delete process.env.JADES_WEBHOOK_SECRET
})

function configure() {
  process.env.JADES_WEBHOOK_URL = "https://jades.example/hook"
  process.env.JADES_WEBHOOK_SECRET = "sec"
}

describe("deliverToJades", () => {
  it("no-ops when unconfigured", async () => {
    const fetchImpl = vi.fn()
    const r = await deliverToJades(event, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r).toEqual({ delivered: false, attempts: 0 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("POSTs a signed payload and returns delivered on 200", async () => {
    configure()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    const r = await deliverToJades(event, { fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(r.delivered).toBe(true)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("https://jades.example/hook")
    expect(init.method).toBe("POST")
    expect(init.headers["X-Hourglass-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/)
    expect(init.headers["X-Hourglass-Timestamp"]).toMatch(/^\d+$/)
    expect(init.body).toBe(JSON.stringify(event))
  })

  it("retries then gives up on repeated failure", async () => {
    configure()
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    const r = await deliverToJades(event, { fetchImpl: fetchImpl as unknown as typeof fetch, maxAttempts: 3, backoffMs: [0, 0] })
    expect(r).toEqual({ delivered: false, attempts: 3 })
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/jades/deliver.test.ts`
Expected: FAIL — `Cannot find module './deliver'`

- [ ] **Step 3: Write minimal implementation**

```ts
// lib/jades/deliver.ts
import { getJadesConfig, isPushConfigured } from "./config"
import type { JadesEvent } from "./payload"
import { signJadesPayload } from "./sign"

export type DeliverOptions = {
  fetchImpl?: typeof fetch
  maxAttempts?: number
  backoffMs?: number[]
}

const DEFAULT_MAX_ATTEMPTS = 3
const DEFAULT_BACKOFF_MS = [1000, 4000]

export async function deliverToJades(
  event: JadesEvent,
  opts: DeliverOptions = {},
): Promise<{ delivered: boolean; attempts: number }> {
  const config = getJadesConfig()
  if (!isPushConfigured(config)) return { delivered: false, attempts: 0 }

  const fetchImpl = opts.fetchImpl ?? fetch
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const backoffMs = opts.backoffMs ?? DEFAULT_BACKOFF_MS

  const rawBody = JSON.stringify(event)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = signJadesPayload(config.webhookSecret!, timestamp, rawBody)

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchImpl(config.webhookUrl!, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Hourglass-Signature": signature,
          "X-Hourglass-Timestamp": timestamp,
        },
        body: rawBody,
      })
      if (res.ok) return { delivered: true, attempts: attempt }
      console.error(`Jades push non-2xx (attempt ${attempt}, event ${event.event_id}): ${res.status}`)
    } catch (err) {
      console.error(`Jades push error (attempt ${attempt}, event ${event.event_id}):`, err)
    }
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, backoffMs[attempt - 1] ?? 0))
    }
  }
  return { delivered: false, attempts: maxAttempts }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/jades/deliver.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add lib/jades/deliver.ts lib/jades/deliver.test.ts
git commit -m "feat(jades): signed delivery with retry + no-op when unconfigured"
```

---

### Task 9: after() enqueue wrapper

**Files:**
- Create: `lib/jades/notify.ts`

**Interfaces:**
- Consumes: `after` from `next/server`; `Notification` from `@/types/notifications`; `SupabaseClient`; `supabaseDataSource`, `loadJadesEvent`, `deliverToJades`.
- Produces: `enqueueJadesDelivery(supabase: SupabaseClient, notification: Notification): void`

This wrapper schedules delivery after the HTTP response so Telnyx webhooks stay
fast. It is verified by `npx tsc --noEmit` and Task 11's manual test; unit-testing
`after()` scheduling adds no confidence over the already-tested loader/deliver.

- [ ] **Step 1: Write the implementation**

```ts
// lib/jades/notify.ts
import { after } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Notification } from "@/types/notifications"
import { deliverToJades } from "./deliver"
import { loadJadesEvent } from "./load-event"
import { supabaseDataSource } from "./supabase-source"

/**
 * Schedule enrichment + signed push to Jades after the response is sent, so the
 * Telnyx webhook returns 200 immediately. A push failure is logged only — the
 * backfill endpoint (/api/jades/events) is the durable safety net.
 */
export function enqueueJadesDelivery(supabase: SupabaseClient, notification: Notification): void {
  after(async () => {
    try {
      const event = await loadJadesEvent(supabaseDataSource(supabase), notification)
      if (event) await deliverToJades(event)
    } catch (err) {
      console.error("Jades delivery error for notification", notification.id, err)
    }
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/jades/notify.ts`

- [ ] **Step 3: Commit**

```bash
git add lib/jades/notify.ts
git commit -m "feat(jades): after() delivery enqueue wrapper"
```

---

### Task 10: Wire enqueue into the Telnyx webhook handlers

**Files:**
- Modify: `app/api/webhooks/telnyx/message/route.ts` (the `unread_message` insert, ~line 198)
- Modify: `app/api/webhooks/telnyx/voice/route.ts` (the `missed_call` insert ~line 383 and `voicemail` insert ~line 494)

**Interfaces:**
- Consumes: `enqueueJadesDelivery` from `@/lib/jades/notify`; `Notification` from `@/types/notifications`.

Each insert currently discards the created row. Change it to select the row back, then enqueue delivery. The supabase variable in scope is the `createAdminClient()` instance already used by these handlers.

- [ ] **Step 1: Add the import to `message/route.ts`**

At the top with the other imports:

```ts
import { enqueueJadesDelivery } from "@/lib/jades/notify"
import type { Notification } from "@/types/notifications"
```

- [ ] **Step 2: Replace the `unread_message` insert block**

Find (around line 198):

```ts
  const { error: notifError } = await supabase.from("notifications").insert({
    type: "unread_message",
    reference_id: conversation.id,
    metadata: {
      contact_number: fromNumber,
      phone_label: phoneNumber.label,
      last_message: messageText?.slice(0, 60) ?? "[Media]",
    },
  })

  if (notifError) {
    console.error("⚠️ Failed to insert unread_message notification:", notifError)
  }
```

Replace with:

```ts
  const { data: notif, error: notifError } = await supabase
    .from("notifications")
    .insert({
      type: "unread_message",
      reference_id: conversation.id,
      metadata: {
        contact_number: fromNumber,
        phone_label: phoneNumber.label,
        last_message: messageText?.slice(0, 60) ?? "[Media]",
      },
    })
    .select("id, type, reference_id, metadata, is_read, created_at")
    .single()

  if (notifError) {
    console.error("⚠️ Failed to insert unread_message notification:", notifError)
  } else if (notif) {
    enqueueJadesDelivery(supabase, notif as Notification)
  }
```

- [ ] **Step 3: Add the import to `voice/route.ts`**

```ts
import { enqueueJadesDelivery } from "@/lib/jades/notify"
import type { Notification } from "@/types/notifications"
```

- [ ] **Step 4: Replace the `missed_call` insert block**

Find (around line 383):

```ts
    const { error } = await supabase.from("notifications").insert({
      type: "missed_call",
      reference_id: call.id,
      metadata: {
        contact_number: payload.from,
        phone_label: phoneNumber?.label ?? "Unknown",
        phone_color: phoneNumber?.color ?? "#6b7280",
      },
    })

    if (error) {
      console.error("⚠️ Failed to insert missed_call notification:", error)
    }
```

Replace with:

```ts
    const { data: missedNotif, error } = await supabase
      .from("notifications")
      .insert({
        type: "missed_call",
        reference_id: call.id,
        metadata: {
          contact_number: payload.from,
          phone_label: phoneNumber?.label ?? "Unknown",
          phone_color: phoneNumber?.color ?? "#6b7280",
        },
      })
      .select("id, type, reference_id, metadata, is_read, created_at")
      .single()

    if (error) {
      console.error("⚠️ Failed to insert missed_call notification:", error)
    } else if (missedNotif) {
      enqueueJadesDelivery(supabase, missedNotif as Notification)
    }
```

- [ ] **Step 5: Replace the `voicemail` insert block**

Find (around line 494):

```ts
  const { error: notifError } = await supabase.from("notifications").insert({
    type: "voicemail",
    reference_id: call.id,
    metadata: {
      contact_number: call.contact_number,
      phone_label: (pn as { label: string } | null)?.label ?? "Unknown",
      duration_seconds: Math.round(durationMs / 1000),
    },
  })

  if (notifError) {
    console.error("⚠️ Failed to insert voicemail notification:", notifError)
  }
```

Replace with:

```ts
  const { data: vmNotif, error: notifError } = await supabase
    .from("notifications")
    .insert({
      type: "voicemail",
      reference_id: call.id,
      metadata: {
        contact_number: call.contact_number,
        phone_label: (pn as { label: string } | null)?.label ?? "Unknown",
        duration_seconds: Math.round(durationMs / 1000),
      },
    })
    .select("id, type, reference_id, metadata, is_read, created_at")
    .single()

  if (notifError) {
    console.error("⚠️ Failed to insert voicemail notification:", notifError)
  } else if (vmNotif) {
    enqueueJadesDelivery(supabase, vmNotif as Notification)
  }
```

- [ ] **Step 6: Typecheck + full test run**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass (existing + new jades tests)

- [ ] **Step 7: Commit**

```bash
git add app/api/webhooks/telnyx/message/route.ts app/api/webhooks/telnyx/voice/route.ts
git commit -m "feat(jades): push events to Jades after notification insert"
```

---

### Task 11: Backfill endpoint

**Files:**
- Create: `app/api/jades/events/route.ts`
- Test: `app/api/jades/events/route.test.ts`

**Interfaces:**
- Consumes: `getJadesConfig` from `@/lib/jades/config`; `isValidBearer` from `@/lib/jades/auth`; `parseEventsQuery` from `@/lib/jades/query`; `loadJadesEvent` from `@/lib/jades/load-event`; `supabaseDataSource` from `@/lib/jades/supabase-source`; `createAdminClient` from `@/lib/admin`.
- Produces: `GET(req: Request): Promise<Response>` returning `{ events: JadesEvent[]; next_since: string }`.

The route is testable by mocking `@/lib/admin` and `@/lib/jades/supabase-source`. The test covers auth + validation branches without a live DB.

- [ ] **Step 1: Write the failing test**

```ts
// app/api/jades/events/route.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/admin", () => ({ createAdminClient: vi.fn(() => ({})) }))

const loadJadesEvent = vi.fn()
vi.mock("@/lib/jades/load-event", () => ({ loadJadesEvent: (...a: unknown[]) => loadJadesEvent(...a) }))
vi.mock("@/lib/jades/supabase-source", () => ({ supabaseDataSource: vi.fn(() => ({})) }))

// Supabase query chain stub returning notifications ordered by created_at.
const notifRows = [
  { id: "n1", type: "missed_call", reference_id: "c1", metadata: {}, is_read: false, created_at: "2026-07-07T00:00:01.000Z" },
]
vi.mock("@/lib/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        gt: () => ({
          in: () => ({
            order: () => ({
              order: () => ({
                limit: async () => ({ data: notifRows, error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
}))

import { GET } from "./route"

beforeEach(() => {
  process.env.JADES_API_TOKEN = "tok"
  loadJadesEvent.mockResolvedValue({ event_id: "n1", type: "missed_call", occurred_at: notifRows[0].created_at, property: "x", property_line: "+1", data: {} })
})
afterEach(() => {
  delete process.env.JADES_API_TOKEN
  vi.clearAllMocks()
})

function req(url: string, auth?: string) {
  return new Request(url, { headers: auth ? { authorization: auth } : {} })
}

describe("GET /api/jades/events", () => {
  it("401 without a valid token", async () => {
    const res = await GET(req("https://x/api/jades/events?since=2026-07-07T00:00:00Z", "Bearer nope"))
    expect(res.status).toBe(401)
  })
  it("400 when since is missing", async () => {
    const res = await GET(req("https://x/api/jades/events", "Bearer tok"))
    expect(res.status).toBe(400)
  })
  it("200 with events + next_since", async () => {
    const res = await GET(req("https://x/api/jades/events?since=2026-07-07T00:00:00Z", "Bearer tok"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.events).toHaveLength(1)
    expect(body.next_since).toBe("2026-07-07T00:00:01.000Z")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/jades/events/route.test.ts`
Expected: FAIL — `Cannot find module './route'`

- [ ] **Step 3: Write minimal implementation**

```ts
// app/api/jades/events/route.ts
import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/admin"
import { isValidBearer } from "@/lib/jades/auth"
import { getJadesConfig } from "@/lib/jades/config"
import { loadJadesEvent } from "@/lib/jades/load-event"
import { parseEventsQuery } from "@/lib/jades/query"
import { supabaseDataSource } from "@/lib/jades/supabase-source"
import type { Notification } from "@/types/notifications"

const EVENT_TYPES = ["missed_call", "voicemail", "unread_message"] as const

export async function GET(req: Request): Promise<Response> {
  const config = getJadesConfig()
  if (!config.apiToken) {
    return NextResponse.json({ error: "integration not configured" }, { status: 503 })
  }
  if (!isValidBearer(req.headers.get("authorization"), config.apiToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const parsed = parseEventsQuery(new URL(req.url).searchParams)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { since, limit } = parsed.value

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, reference_id, metadata, is_read, created_at")
    .gt("created_at", since)
    .in("type", EVENT_TYPES as unknown as string[])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: "query failed" }, { status: 500 })
  }

  const rows = (data ?? []) as Notification[]
  const source = supabaseDataSource(supabase)
  const events = []
  for (const n of rows) {
    const event = await loadJadesEvent(source, n)
    if (event) events.push(event)
  }

  const nextSince = rows.length > 0 ? rows[rows.length - 1].created_at : since
  return NextResponse.json({ events, next_since: nextSince })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run app/api/jades/events/route.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add app/api/jades/events/route.ts app/api/jades/events/route.test.ts
git commit -m "feat(jades): bearer-protected backfill endpoint GET /api/jades/events"
```

---

### Task 12: Document env vars + final verification

**Files:**
- Modify: `.env.local` (local, not committed) and add a documented example in `README.md` (or create `.env.example` if the repo uses one — check first).

**Interfaces:** none.

- [ ] **Step 1: Add env var docs**

Check whether a `.env.example` exists (`ls .env.example`). If it does, append there; otherwise add a short section to `README.md`:

```markdown
### Jades AI event integration (optional)

Set these to enable pushing SMS / missed-call / voicemail events to the Jades AI
and to expose the backfill endpoint. If unset, push is a silent no-op and the
endpoint returns 503.

- `JADES_WEBHOOK_URL` — Jades' inbound webhook URL (push target)
- `JADES_WEBHOOK_SECRET` — HMAC-SHA256 signing secret (share with Jades to verify `X-Hourglass-Signature`)
- `JADES_API_TOKEN` — bearer token for `GET /api/jades/events?since=<ISO8601>`
```

- [ ] **Step 2: Full verification**

Run: `npx tsc --noEmit && npx vitest run && npx eslint lib/jades app/api/jades`
Expected: no type errors; all tests pass; no new lint errors in `lib/jades` / `app/api/jades`.

- [ ] **Step 3: Manual staging test (requires deployed env with the 3 vars set + a Jades test URL)**

1. Set the three env vars in staging; point `JADES_WEBHOOK_URL` at a request-bin or Jades' test endpoint.
2. Send a real inbound SMS to a business number → confirm a signed POST with `type: "new_sms"` arrives and `X-Hourglass-Signature` verifies with the secret.
3. Place a call that goes unanswered → confirm `type: "missed_call"`; leave a voicemail → confirm `type: "voicemail"` with `audio_url` set and `transcription: null`.
4. Call the backfill: `curl -H "Authorization: Bearer $JADES_API_TOKEN" "https://www.megestic.com/api/jades/events?since=2026-07-07T00:00:00Z"` → confirm the same events return as a JSON array with `next_since`.

- [ ] **Step 4: Commit**

```bash
git add README.md   # or .env.example
git commit -m "docs(jades): document integration env vars"
```

---

## Self-Review

**Spec coverage:** architecture (Tasks 6–11), payload schemas (Task 5), type mapping unread_message→new_sms (Tasks 5–6), HMAC signing + replay note (Task 2; replay verification is Jades-side, documented in spec), bearer auth + caps (Tasks 3–4, 11), `after()` fast response + retry (Tasks 8–10), backfill cursor + `next_since` (Tasks 4, 11), config/secrets (Tasks 1, 12), testing (every task). CNAM/transcription null (Task 5). All covered.

**Placeholder scan:** no TBD/TODO; every code + test step is complete.

**Type consistency:** `EventDataSource` methods (`getCall`, `getVoicemailByCall`, `getConversation`, `getLatestInboundMessage`) are identical across Tasks 6, 7, 9, 11. `JadesEvent`, `CallRef`, `VoicemailRef`, `ConversationRef`, `MessageRef` defined in Task 5 and consumed unchanged. `deliverToJades` / `loadJadesEvent` / `enqueueJadesDelivery` signatures consistent across producer and consumer tasks. Notification select column list (`id, type, reference_id, metadata, is_read, created_at`) identical in Tasks 10 and 11.
