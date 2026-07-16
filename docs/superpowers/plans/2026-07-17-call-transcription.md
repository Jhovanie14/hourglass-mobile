# Call Transcription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every answered conversation (inbound answered + outbound softphone calls) is transcribed in real time by Telnyx and shown post-call in the dashboard call history, chat-style, attributed to Agent or the contact's number.

**Architecture:** The voice webhook starts Telnyx real-time transcription (`startTranscription`, engine `Telnyx`, tracks `both`) on the leg stored in `calls.telnyx_call_id` at the two moments a conversation becomes live: after the inbound bridge succeeds and after an outbound call is marked answered. Each finalized `call.transcription` webhook event is normalized by a pure helper (speaker attribution from call direction × transcription track) and inserted as a row in `call_transcript_segments`; `calls.has_transcript` mirrors `has_voicemail`. The dashboard's expandable call row renders segments grouped by speaker. Voicemail legs are never transcribed (the start sits strictly after bridge / outbound answer).

**Tech Stack:** Next.js 16 + React 19, Supabase (Postgres + RLS, admin client in webhook), Telnyx Node SDK ^6.73.0 (`calls.actions.startTranscription`), vitest (node env), Tailwind.

## Global Constraints

- Work on branch `feat/call-transcription` (create from `main` at execution start).
- Kill switch: env var `CALL_TRANSCRIPTION_ENABLED` — transcription is ON unless the value is exactly `"false"`. It gates **starting** only; ingest always runs.
- Engine settings are fixed by the client's 2026-07-17 cost decision ($0.025/min standard Telnyx engine): `transcription_engine: "Telnyx"`, `transcription_tracks: "both"`, `transcription_engine_config: { transcription_engine: "Telnyx", language: "en", transcription_model: "openai/whisper-large-v3-turbo" }`.
- Speaker attribution matrix (pure function of call direction + `transcription_track`): inbound call → track `inbound` = `contact`, `outbound` = `agent`; outbound call → track `inbound` = `agent`, `outbound` = `contact`; missing/unknown track → `null`.
- Pure logic goes in `lib/telnyx/*.ts` with a `*.test.ts` sibling (vitest, node env). React components are NOT unit-tested in this repo — verify via `npm run typecheck` + manual load.
- All webhook DB writes use the existing admin client; dashboard reads are client-side under RLS (authenticated read-only, like `voicemails`).
- Task 3 (SQL in the Supabase dashboard) MUST be completed before the webhook code (Task 4) is deployed anywhere Telnyx can reach — otherwise segments are billed but dropped.
- No extension changes. Delivery is a megestic.com web deploy only.
- Failures in transcription start/ingest are logged with the existing `⚠️`/`console.error` idiom and never break call handling.

---

## File Structure

**Create:**
- `lib/telnyx/transcription.ts` — pure: kill switch, speaker matrix, event→row normalizer.
- `lib/telnyx/transcription.test.ts` — unit tests for all three.
- `components/calls/transcript-view.tsx` — fetch + chat-style render of a call's segments.

**Modify:**
- `lib/telnyx/voice-orchestrator.ts` — add `startCallTranscription`.
- `lib/telnyx/voice-orchestrator.test.ts` — cover it (existing mock pattern).
- `app/api/webhooks/telnyx/voice/route.ts` — two start call-sites + `call.transcription` ingest case.
- `types/calls.ts` — `has_transcript` on `Call`; new `TranscriptSegment`.
- `components/calls/calls-table.tsx` — Transcript section in desktop expanded row + mobile card.
- `app/dashboard/calls/page.tsx` — include `has_transcript` in the calls query + mapping.

**Supabase (SQL Editor, not repo files):** `call_transcript_segments` table + index + RLS; `calls.has_transcript` column.

---

## Task 1: Pure transcription helpers (TDD)

**Files:**
- Create: `lib/telnyx/transcription.ts`
- Test: `lib/telnyx/transcription.test.ts`

**Interfaces:**
- Produces:
  - `isTranscriptionEnabled(env: { CALL_TRANSCRIPTION_ENABLED?: string }): boolean`
  - `speakerForTrack(direction: "inbound" | "outbound", track: string | undefined): "agent" | "contact" | null`
  - `type TranscriptionData = { transcript?: string; confidence?: number; is_final?: boolean; transcription_track?: string }`
  - `segmentFromEvent(direction: "inbound" | "outbound", data: TranscriptionData | undefined, occurredAt: string | undefined): { speaker: "agent" | "contact" | null; transcript: string; confidence: number | null; occurred_at: string } | null`

- [ ] **Step 1: Write the failing test**

Create `lib/telnyx/transcription.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  isTranscriptionEnabled,
  speakerForTrack,
  segmentFromEvent,
} from "./transcription"

describe("isTranscriptionEnabled", () => {
  it("is on when the env var is unset", () => {
    expect(isTranscriptionEnabled({})).toBe(true)
  })
  it("is on for any value other than the string false", () => {
    expect(isTranscriptionEnabled({ CALL_TRANSCRIPTION_ENABLED: "true" })).toBe(true)
    expect(isTranscriptionEnabled({ CALL_TRANSCRIPTION_ENABLED: "" })).toBe(true)
  })
  it("is off only for the exact string false", () => {
    expect(isTranscriptionEnabled({ CALL_TRANSCRIPTION_ENABLED: "false" })).toBe(false)
  })
})

describe("speakerForTrack", () => {
  it("maps the inbound call's inbound track to the contact (caller speaks)", () => {
    expect(speakerForTrack("inbound", "inbound")).toBe("contact")
  })
  it("maps the inbound call's outbound track to the agent", () => {
    expect(speakerForTrack("inbound", "outbound")).toBe("agent")
  })
  it("maps the outbound call's inbound track to the agent (agent speaks)", () => {
    expect(speakerForTrack("outbound", "inbound")).toBe("agent")
  })
  it("maps the outbound call's outbound track to the contact", () => {
    expect(speakerForTrack("outbound", "outbound")).toBe("contact")
  })
  it("returns null when the track is missing or unknown", () => {
    expect(speakerForTrack("inbound", undefined)).toBe(null)
    expect(speakerForTrack("outbound", "weird")).toBe(null)
  })
})

describe("segmentFromEvent", () => {
  const occurredAt = "2026-07-17T12:00:00.000Z"

  it("normalizes a final caller segment on an inbound call", () => {
    expect(
      segmentFromEvent(
        "inbound",
        {
          transcript: "Hello, I need help",
          confidence: 0.92,
          is_final: true,
          transcription_track: "inbound",
        },
        occurredAt
      )
    ).toEqual({
      speaker: "contact",
      transcript: "Hello, I need help",
      confidence: 0.92,
      occurred_at: occurredAt,
    })
  })

  it("flips attribution for outbound calls", () => {
    const row = segmentFromEvent(
      "outbound",
      { transcript: "Hi, this is Ellen Marketing", is_final: true, transcription_track: "inbound" },
      occurredAt
    )
    expect(row?.speaker).toBe("agent")
  })

  it("drops interim results", () => {
    expect(
      segmentFromEvent("inbound", { transcript: "partial", is_final: false }, occurredAt)
    ).toBe(null)
  })

  it("drops empty and whitespace-only transcripts", () => {
    expect(segmentFromEvent("inbound", { transcript: "", is_final: true }, occurredAt)).toBe(null)
    expect(segmentFromEvent("inbound", { transcript: "   ", is_final: true }, occurredAt)).toBe(null)
    expect(segmentFromEvent("inbound", undefined, occurredAt)).toBe(null)
  })

  it("treats a missing is_final as final (final-only engines omit it)", () => {
    const row = segmentFromEvent("inbound", { transcript: "hello" }, occurredAt)
    expect(row?.transcript).toBe("hello")
  })

  it("stores null speaker and confidence when absent", () => {
    const row = segmentFromEvent("inbound", { transcript: "hello", is_final: true }, occurredAt)
    expect(row?.speaker).toBe(null)
    expect(row?.confidence).toBe(null)
  })

  it("falls back to now when occurred_at is missing", () => {
    const row = segmentFromEvent("inbound", { transcript: "hello" }, undefined)
    expect(typeof row?.occurred_at).toBe("string")
    expect(Number.isNaN(Date.parse(row!.occurred_at))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/telnyx/transcription.test.ts`
Expected: FAIL — cannot resolve `./transcription`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/telnyx/transcription.ts`:

```ts
// Pure helpers for call transcription. No SDK, DB, or env access here so it
// unit-tests in plain node (mirrors the other lib/telnyx pure modules).

export type TranscriptSpeaker = "agent" | "contact"

/** Shape of transcription_data on a `call.transcription` webhook event. */
export type TranscriptionData = {
  transcript?: string
  confidence?: number
  is_final?: boolean
  transcription_track?: string
}

export type TranscriptSegmentInsert = {
  speaker: TranscriptSpeaker | null
  transcript: string
  confidence: number | null
  occurred_at: string
}

/** Kill switch: transcription is always on unless explicitly disabled. */
export function isTranscriptionEnabled(env: {
  CALL_TRANSCRIPTION_ENABLED?: string
}): boolean {
  return env.CALL_TRANSCRIPTION_ENABLED !== "false"
}

/**
 * Who spoke, from the call direction plus Telnyx's transcription_track.
 * Track semantics are per-leg: `inbound` = audio Telnyx receives from that
 * leg's party, `outbound` = audio sent to them. We always transcribe the leg
 * stored in calls.telnyx_call_id: the customer's A leg for inbound calls, the
 * softphone-originated leg for outbound — so the mapping flips with direction.
 */
export function speakerForTrack(
  direction: "inbound" | "outbound",
  track: string | undefined
): TranscriptSpeaker | null {
  if (track !== "inbound" && track !== "outbound") return null
  if (direction === "inbound") return track === "inbound" ? "contact" : "agent"
  return track === "inbound" ? "agent" : "contact"
}

/**
 * Normalize one webhook event into an insertable segment row, or null for
 * events we drop (interim results, empty transcripts, missing data). Missing
 * is_final counts as final: engines configured without interim results omit it.
 */
export function segmentFromEvent(
  direction: "inbound" | "outbound",
  data: TranscriptionData | undefined,
  occurredAt: string | undefined
): TranscriptSegmentInsert | null {
  if (!data) return null
  if (data.is_final === false) return null
  const transcript = (data.transcript ?? "").trim()
  if (!transcript) return null
  return {
    speaker: speakerForTrack(direction, data.transcription_track),
    transcript,
    confidence: typeof data.confidence === "number" ? data.confidence : null,
    occurred_at: occurredAt ?? new Date().toISOString(),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/telnyx/transcription.test.ts`
Expected: PASS (16 tests across 3 suites).

- [ ] **Step 5: Commit**

```bash
git add lib/telnyx/transcription.ts lib/telnyx/transcription.test.ts
git commit -m "feat(calls): pure transcription helpers (kill switch, speaker map, normalizer)"
```

---

## Task 2: Orchestrator `startCallTranscription` (TDD)

**Files:**
- Modify: `lib/telnyx/voice-orchestrator.ts`
- Test: `lib/telnyx/voice-orchestrator.test.ts`

**Interfaces:**
- Consumes: `getTelnyxClient`, `withRetry` from `./client` (existing); SDK method `telnyx.calls.actions.startTranscription(callControlId, body)`.
- Produces: `startCallTranscription(callControlId: string): Promise<void>` — used by Task 4.

- [ ] **Step 1: Extend the test file's mock and add the failing test**

In `lib/telnyx/voice-orchestrator.test.ts`, replace:

```ts
const { dial, hangup } = vi.hoisted(() => ({ dial: vi.fn(), hangup: vi.fn() }))
vi.mock("./client", () => ({
  getTelnyxClient: () => ({ calls: { dial, actions: { hangup } } }),
  withRetry: (fn: () => unknown) => fn(),
}))

import { dialAgentLeg, hangupLeg } from "./voice-orchestrator"
```

with:

```ts
const { dial, hangup, startTranscription } = vi.hoisted(() => ({
  dial: vi.fn(),
  hangup: vi.fn(),
  startTranscription: vi.fn(),
}))
vi.mock("./client", () => ({
  getTelnyxClient: () => ({ calls: { dial, actions: { hangup, startTranscription } } }),
  withRetry: (fn: () => unknown) => fn(),
}))

import { dialAgentLeg, hangupLeg, startCallTranscription } from "./voice-orchestrator"
```

In the `beforeEach` block, add a reset next to the existing ones:

```ts
  startTranscription.mockReset()
```

Append at the end of the file:

```ts
describe("startCallTranscription", () => {
  it("starts Telnyx-engine transcription of both tracks on the given leg", async () => {
    startTranscription.mockResolvedValue({})

    await startCallTranscription("a-leg-9")

    expect(startTranscription).toHaveBeenCalledTimes(1)
    const [legId, body] = startTranscription.mock.calls[0]
    expect(legId).toBe("a-leg-9")
    expect(body.transcription_engine).toBe("Telnyx")
    expect(body.transcription_tracks).toBe("both")
    expect(body.transcription_engine_config).toMatchObject({
      transcription_engine: "Telnyx",
      language: "en",
      transcription_model: "openai/whisper-large-v3-turbo",
    })
    expect(typeof body.command_id).toBe("string")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/telnyx/voice-orchestrator.test.ts`
Expected: FAIL — `startCallTranscription` is not exported.

- [ ] **Step 3: Implement**

In `lib/telnyx/voice-orchestrator.ts`, append after the `startVoicemail` function:

```ts
/** Start real-time transcription on a live call leg — both tracks, Telnyx
 *  engine (the client-approved $0.025/min option, and the only engine that
 *  labels which track spoke). Telnyx stops it automatically at hang-up. */
export async function startCallTranscription(callControlId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.startTranscription(callControlId, {
      transcription_engine: "Telnyx",
      transcription_engine_config: {
        transcription_engine: "Telnyx",
        language: "en",
        transcription_model: "openai/whisper-large-v3-turbo",
      },
      transcription_tracks: "both",
      command_id: commandId(),
    })
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/telnyx/voice-orchestrator.test.ts`
Expected: PASS (all suites in the file, including the new one).

- [ ] **Step 5: Commit**

```bash
git add lib/telnyx/voice-orchestrator.ts lib/telnyx/voice-orchestrator.test.ts
git commit -m "feat(calls): startCallTranscription orchestrator command"
```

---

## Task 3: Database objects (Supabase SQL Editor — human-assisted)

**Files:** Supabase SQL Editor only (this project keeps no migrations in the repo; same convention as the `voicemails` table).

**Interfaces:**
- Produces: table `call_transcript_segments` (columns `id, call_id, speaker, transcript, confidence, occurred_at, created_at`), column `calls.has_transcript boolean not null default false` — consumed by Tasks 4 and 5.

- [ ] **Step 1: Ask your human partner to run this SQL in the Supabase dashboard → SQL Editor**

```sql
create table call_transcript_segments (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references calls(id) on delete cascade,
  speaker text check (speaker in ('agent', 'contact')),  -- null = unlabeled
  transcript text not null,
  confidence real,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index call_transcript_segments_call_idx
  on call_transcript_segments (call_id, occurred_at);

alter table call_transcript_segments enable row level security;

create policy "Authenticated users can read transcript segments"
  on call_transcript_segments for select
  to authenticated
  using (true);

alter table calls add column has_transcript boolean not null default false;
```

(No insert/update policies: the webhook writes with the service-role admin client, which bypasses RLS — same as `voicemails`.)

- [ ] **Step 2: Verify the objects exist**

Ask your human partner to run in the SQL Editor:

```sql
select column_name, data_type from information_schema.columns
  where table_name = 'call_transcript_segments' order by ordinal_position;
select has_transcript from calls limit 1;
```

Expected: seven rows listing the columns above; the second query returns without error (any value).

- [ ] **Step 3: Confirm before proceeding**

Do not start Task 4 until your human partner confirms both statements ran without error. (Deploying the webhook first would bill transcription minutes whose segments have nowhere to land.)

---

## Task 4: Webhook — start transcription + ingest segments

**Files:**
- Modify: `app/api/webhooks/telnyx/voice/route.ts`

**Interfaces:**
- Consumes: `startCallTranscription` (Task 2), `isTranscriptionEnabled`, `segmentFromEvent`, `type TranscriptionData` (Task 1), table `call_transcript_segments` + `calls.has_transcript` (Task 3).

- [ ] **Step 1: Add imports**

In `app/api/webhooks/telnyx/voice/route.ts`, extend the orchestrator import:

```ts
import {
  answerCaller,
  dialAgentLeg,
  hangupLeg,
  bridgeLegs,
  startVoicemail,
  startCallTranscription,
  DEFAULT_GREETING,
} from "@/lib/telnyx/voice-orchestrator"
```

and add below it:

```ts
import {
  isTranscriptionEnabled,
  segmentFromEvent,
  type TranscriptionData,
} from "@/lib/telnyx/transcription"
```

- [ ] **Step 2: Extend the payload/body types**

In the `TelnyxCallPayload` type, add after the `duration_ms?: number` line:

```ts
  // call.transcription fields
  transcription_data?: TranscriptionData
```

Replace the `TelnyxVoiceWebhookBody` type:

```ts
type TelnyxVoiceWebhookBody = {
  data: {
    event_type: string
    payload: TelnyxCallPayload
  }
}
```

with:

```ts
type TelnyxVoiceWebhookBody = {
  data: {
    event_type: string
    occurred_at?: string
    payload: TelnyxCallPayload
  }
}
```

- [ ] **Step 3: Route the new event**

In the `switch (event_type)` block, add before `default:`:

```ts
    case "call.transcription":
      await handleTranscription(supabase, payload, body.data.occurred_at)
      break
```

- [ ] **Step 4: Start transcription when the inbound bridge succeeds**

In `handleCallAnswered`, the bridge path currently reads:

```ts
    if (agentLeg) {
      try {
        await bridgeLegs(payload.call_control_id, agentLeg)
        await supabase
          .from("calls")
          .update({ started_at: new Date().toISOString() })
          .eq("id", call.id)
        return
      } catch (err) {
        console.error("⚠️ Bridge failed; falling back to voicemail:", err)
      }
    }
```

Replace it with:

```ts
    if (agentLeg) {
      try {
        await bridgeLegs(payload.call_control_id, agentLeg)
        await supabase
          .from("calls")
          .update({ started_at: new Date().toISOString() })
          .eq("id", call.id)
        if (isTranscriptionEnabled(process.env)) {
          try {
            await startCallTranscription(payload.call_control_id)
          } catch (err) {
            console.error("⚠️ Failed to start transcription (inbound):", err)
          }
        }
        return
      } catch (err) {
        console.error("⚠️ Bridge failed; falling back to voicemail:", err)
      }
    }
```

(Voicemail paths never reach this point, so voicemail legs are never transcribed.)

- [ ] **Step 5: Start transcription when an outbound call connects**

Still in `handleCallAnswered`, replace:

```ts
  if (action === "mark_outbound_answered") {
    await markOutboundAnswered(supabase, payload.call_control_id)
    return
  }
```

with:

```ts
  if (action === "mark_outbound_answered") {
    await markOutboundAnswered(supabase, payload.call_control_id)
    if (isTranscriptionEnabled(process.env)) {
      try {
        await startCallTranscription(payload.call_control_id)
      } catch (err) {
        console.error("⚠️ Failed to start transcription (outbound):", err)
      }
    }
    return
  }
```

- [ ] **Step 6: Add the ingest handler**

Append at the end of the file (after `handleRecordingSaved`):

```ts
async function handleTranscription(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload,
  occurredAt: string | undefined
) {
  const { data: call } = await supabase
    .from("calls")
    .select("id, direction, has_transcript")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) {
    console.warn("⚠️ No call found for transcription event:", payload.call_control_id)
    return
  }

  const segment = segmentFromEvent(call.direction, payload.transcription_data, occurredAt)
  if (!segment) return

  const { error } = await supabase.from("call_transcript_segments").insert({
    call_id: call.id,
    ...segment,
  })
  if (error) {
    console.error("⚠️ Failed to insert transcript segment:", error)
    return
  }

  if (!call.has_transcript) {
    const { error: flagError } = await supabase
      .from("calls")
      .update({ has_transcript: true })
      .eq("id", call.id)
    if (flagError) {
      console.error("⚠️ Failed to set has_transcript flag:", flagError)
    }
  }
}
```

- [ ] **Step 7: Typecheck, lint, full unit suite**

Run: `npm run typecheck`
Expected: PASS.
Run: `npm run test`
Expected: all files pass (no webhook unit tests exist; this guards the libs).
Run: `npm run lint 2>&1 | grep -A3 "webhooks/telnyx/voice"`
Expected: no output (no new lint errors in the changed file; the repo has unrelated pre-existing errors elsewhere).

- [ ] **Step 8: Commit**

```bash
git add app/api/webhooks/telnyx/voice/route.ts
git commit -m "feat(calls): start transcription on connect; ingest call.transcription events"
```

---

## Task 5: Types + dashboard transcript UI

**Files:**
- Modify: `types/calls.ts`
- Create: `components/calls/transcript-view.tsx`
- Modify: `components/calls/calls-table.tsx`
- Modify: `app/dashboard/calls/page.tsx`

**Interfaces:**
- Consumes: table `call_transcript_segments` (Task 3), `calls.has_transcript`.
- Produces: `TranscriptView({ callId: string, contactNumber: string })`; `TranscriptSegment` type; `Call.has_transcript?: boolean`.

- [ ] **Step 1: Extend `types/calls.ts`**

In the `Call` type, add after the `has_voicemail?: boolean` line:

```ts
  has_transcript?: boolean
```

Add after the `Voicemail` type:

```ts
export type TranscriptSegment = {
  id: string
  call_id: string
  speaker: "agent" | "contact" | null
  transcript: string
  confidence: number | null
  occurred_at: string
  created_at: string
}
```

- [ ] **Step 2: Create `components/calls/transcript-view.tsx`**

```tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/client"
import { Skeleton } from "@/components/ui/skeleton"
import type { TranscriptSegment } from "@/types/calls"

// Consecutive same-speaker segments merged into one block for a chat-style read.
type TranscriptBlock = {
  speaker: TranscriptSegment["speaker"]
  text: string
}

function groupSegments(segments: TranscriptSegment[]): TranscriptBlock[] {
  const blocks: TranscriptBlock[] = []
  for (const seg of segments) {
    const last = blocks[blocks.length - 1]
    if (last && last.speaker === seg.speaker) {
      last.text += ` ${seg.transcript}`
    } else {
      blocks.push({ speaker: seg.speaker, text: seg.transcript })
    }
  }
  return blocks
}

export function TranscriptView({
  callId,
  contactNumber,
}: {
  callId: string
  contactNumber: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [segments, setSegments] = useState<TranscriptSegment[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await supabase
          .from("call_transcript_segments")
          .select("id, call_id, speaker, transcript, confidence, occurred_at, created_at")
          .eq("call_id", callId)
          .order("occurred_at", { ascending: true })
          .order("created_at", { ascending: true })
        if (!cancelled) setSegments((data ?? []) as TranscriptSegment[])
      } catch (err) {
        console.error("Failed to fetch transcript:", err)
        if (!cancelled) setSegments([])
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [callId, supabase])

  if (segments === null) return <Skeleton className="h-16 w-full max-w-lg" />
  if (segments.length === 0) {
    return <span className="text-xs text-muted-foreground">No transcript available</span>
  }

  const blocks = groupSegments(segments)

  return (
    <div className="max-h-64 space-y-2 overflow-y-auto pr-2">
      {blocks.map((block, i) => (
        <div key={i} className="flex gap-2 text-sm">
          <span className="w-24 shrink-0 text-xs font-medium text-muted-foreground">
            {block.speaker === "agent"
              ? "Agent"
              : block.speaker === "contact"
                ? contactNumber
                : "—"}
          </span>
          <p className="flex-1 text-foreground">{block.text}</p>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Wire it into `components/calls/calls-table.tsx`**

Add the import next to the other component imports:

```tsx
import { TranscriptView } from "@/components/calls/transcript-view"
```

**Desktop expanded row** — inside the `{open && (...)}` block, insert a Transcript section between the voicemail block and the `<dl ...>`:

```tsx
                          {call.has_voicemail && (
                            <div>
                              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Voicemail
                              </p>
                              <VoicemailPlayer callId={call.id} />
                            </div>
                          )}
                          {call.has_transcript && (
                            <div>
                              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Transcript
                              </p>
                              <TranscriptView
                                callId={call.id}
                                contactNumber={call.contact_number}
                              />
                            </div>
                          )}
                          <dl className="grid gap-x-8 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
```

**Mobile card list** — after the mobile voicemail block:

```tsx
              {call.has_voicemail && (
                <div className="mt-2">
                  <VoicemailPlayer callId={call.id} />
                </div>
              )}
```

add:

```tsx
              {call.has_transcript && (
                <div className="mt-2">
                  <TranscriptView callId={call.id} contactNumber={call.contact_number} />
                </div>
              )}
```

- [ ] **Step 4: Include the flag in the calls query (`app/dashboard/calls/page.tsx`)**

In the `.select(...)` string for `calls`, change `has_voicemail,` to `has_voicemail, has_transcript,` so it reads:

```ts
      .select(
        "id, phone_number_id, contact_number, direction, status, duration_seconds, telnyx_call_id, started_at, ended_at, created_at, has_voicemail, has_transcript, phone_numbers(id, label, phone_number, color)"
      )
```

In the `initialCalls` mapping, add after `has_voicemail: c.has_voicemail,`:

```ts
    has_transcript: c.has_transcript,
```

- [ ] **Step 5: Typecheck + render check**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run dev`, sign in to the dashboard, open the Calls page. Expected: table renders exactly as before (no call has `has_transcript = true` yet, so no Transcript sections appear; no console errors).

- [ ] **Step 6: Commit**

```bash
git add types/calls.ts components/calls/transcript-view.tsx components/calls/calls-table.tsx app/dashboard/calls/page.tsx
git commit -m "feat(dashboard): transcript view in call history"
```

---

## Task 6: Full verification + manual E2E

**Files:** none (verification only).

- [ ] **Step 1: Full automated gate**

Run: `npm run test`
Expected: all test files pass (including the two touched/added in Tasks 1–2).
Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 2: Manual E2E (requires the human partner — real calls, deployed webhook)**

The Telnyx webhook targets the deployed URL, so these checks happen after deploying this branch (or pointing a Telnyx test connection at a tunnel). For each:

1. **Inbound answered call:** call a configured number, answer on the softphone, talk on both sides, hang up. Expected: dashboard call row shows a Transcript section; caller lines attributed to the caller's number, agent lines to "Agent".
2. **Outbound call:** dial out from the softphone, converse, hang up. Expected: transcript present with attribution flipped correctly (agent's speech says "Agent").
3. **Voicemail:** call with no agent online, leave a message. Expected: voicemail plays as today; **zero** transcript section, zero rows in `call_transcript_segments` for that call.
4. **Kill switch:** set `CALL_TRANSCRIPTION_ENABLED=false` in the hosting env, redeploy/restart, place an answered call. Expected: no transcript. Remove the var afterward.
5. **Coexistence:** a call that has both a voicemail and (separately) a transcript renders both sections without layout breakage.
6. **Billing sanity:** after these tests, check the Telnyx billing page for transcription line items — confirm the per-minute rate and whether `both` tracks bill 2× (open question from the spec; report the answer back to the client quote).

- [ ] **Step 3: Wrap up the branch**

Use the finishing-a-development-branch skill: verify tests, then choose merge/PR. Reminder — release order: Supabase SQL (Task 3) is already live; deploy megestic.com; no extension/Store work.

---

## Self-Review

**Spec coverage:**
- Always-on transcription of answered in+out calls → Task 4 Steps 4–5. ✅
- Voicemails never transcribed → start sits after bridge/outbound-answer only (Task 4). ✅
- Kill switch `CALL_TRANSCRIPTION_ENABLED`, gates start only → Tasks 1, 4. ✅
- Telnyx engine / both tracks / en / whisper-large-v3-turbo → Task 2. ✅
- Speaker attribution matrix, null for missing track → Task 1. ✅
- Segments table + `has_transcript` flag + RLS (authenticated read) → Task 3. ✅
- Ingest: normalize, insert, flag, all failures logged-and-swallowed → Task 4 Step 6. ✅
- Ordering by `occurred_at` with `created_at` tiebreak → Task 5 Step 2 query. ✅
- Dashboard-only surface: expandable row (desktop + mobile), chat-style, grouped speakers, "Agent"/contact-number labels, unlabeled = "—" → Task 5. ✅
- No extension changes; web-deploy-only; SQL before webhook deploy → Global Constraints + Task 3 Step 3. ✅
- Unit tests for the pure matrix/kill-switch/normalizer → Task 1; orchestrator command test → Task 2. ✅
- Open billing question surfaced during E2E → Task 6 Step 2.6. ✅

**Placeholder scan:** No TBD/TODO; every code step carries complete code; commands include expected output. ✅

**Type consistency:** `TranscriptionData` defined in Task 1, imported in Task 4; `segmentFromEvent(direction, data, occurredAt)` signature identical in Tasks 1 and 4; `startCallTranscription(callControlId)` defined in Task 2, called in Task 4; `TranscriptSegment` defined in Task 5 Step 1 and consumed in Step 2; `TranscriptView({ callId, contactNumber })` matches both call sites in Step 3; `has_transcript` spelled identically in SQL (Task 3), webhook (Task 4), types/query/UI (Task 5). ✅
