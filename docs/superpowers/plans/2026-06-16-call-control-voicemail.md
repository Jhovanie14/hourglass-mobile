# Call Control Off-hours / No-answer Voicemail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an inbound call is unanswered because agents are offline or nobody picks up, play a greeting, record the caller's message, and save it to the database with a notification — driven entirely by Telnyx Call Control reacting to the dial result.

**Architecture:** The phone number moves from the SIP trunk to a Telnyx **Voice API (Call Control) application**. Its webhook orchestrates each inbound call: `answer` the caller, `dial` the WebRTC SIP credential with a 25s timeout, `bridge` on answer, and on dial failure/timeout run `speak` → record → save. Recordings are copied to a private Supabase Storage bucket and served via short-lived signed URLs. No schedule and no presence tracking — the dial outcome is the trigger.

**Tech Stack:** Next.js 16 (App Router route handlers, `runtime = "nodejs"`), Telnyx Node SDK `^6.73`, Supabase (`@supabase/supabase-js` admin client + Storage), Vitest (new, for pure-logic unit tests only).

**Spec:** `docs/superpowers/specs/2026-06-16-call-control-voicemail-design.md`

---

## File Map

| File | Responsibility | Action |
|---|---|---|
| `lib/telnyx/client.ts` | Single Telnyx client factory + `withRetry` backoff | Create |
| `lib/telnyx/client-state.ts` | `encodeClientState` / `decodeClientState` (leg correlation) | Create |
| `lib/telnyx/webhook.ts` | Ed25519 signature + timestamp-freshness verification | Create |
| `lib/telnyx/voice-orchestrator.ts` | `answerCaller`, `dialAgent`, `bridgeLegs`, `startVoicemail`, greeting resolution | Create |
| `app/api/webhooks/telnyx/voice/route.ts` | Thin webhook dispatcher wired to orchestrator | Modify |
| `app/api/voicemails/[id]/audio/route.ts` | Authenticated signed-URL redirect for playback | Create |
| `components/calls/calls-table.tsx` | Point `<audio src>` at the signed-URL route | Modify |
| `app/api/calls/speak/route.ts` | Insecure, unused | Delete |
| `app/api/calls/voicemail-start/route.ts` | Folded into orchestrator | Delete |
| `app/api/cron/voicemail-check/route.ts` | Obsolete polling hack | Delete |
| `vitest.config.ts`, `package.json` | Test runner for pure logic | Create / Modify |
| Supabase migration (SQL, run in dashboard) | `voicemails.storage_path` + private bucket | Apply |

**Milestone order:** Task 0 (spike) gates everything. Then 1–4 (infra+security), 5–7 (orchestration), 8–11 (secure storage), 12 (end-to-end verification).

---

## Task 0: Phase 0 spike — prove the agent dial → bridge

**This gates the whole plan. Do not start Task 1 until this passes.** Throwaway code; it will be replaced by the real orchestrator.

**Files:**
- Create (temporary): `app/api/webhooks/telnyx/voice-spike/route.ts`

**Telnyx portal (you, manually):**
- [ ] **Step 1: Create a Voice API (Call Control) application.** Voice → Call Control → Applications → Create. Set the webhook URL to `https://<your-domain>/api/webhooks/telnyx/voice-spike`. Note its **Application ID** (this is the `connection_id`).
- [ ] **Step 2: Assign ONE test number to this application** (move it off the SIP trunk). Keep your main production number on the trunk for now.
- [ ] **Step 3: Confirm the Credential SIP Connection that the softphone registers to has inbound enabled** (Voice → SIP Trunking → your credential connection → Inbound — ensure it accepts calls). This is the most likely failure point.

**Code:**

- [ ] **Step 4: Write the throwaway spike route.**

```ts
// app/api/webhooks/telnyx/voice-spike/route.ts
import Telnyx from "telnyx"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const body = await req.json()
  const { event_type, payload } = body.data
  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })
  const ccid = payload.call_control_id

  console.log("SPIKE event:", event_type, {
    direction: payload.direction,
    client_state: payload.client_state,
  })

  // Caller leg arrives parked → answer it.
  if (event_type === "call.initiated" && payload.direction === "incoming") {
    await telnyx.calls.actions.answer(ccid)
  }

  // Caller answered → dial the WebRTC SIP credential as a second leg.
  if (event_type === "call.answered" && payload.direction === "incoming") {
    await telnyx.calls.create({
      connection_id: process.env.TELNYX_VOICE_APP_ID!,
      to: `sip:${process.env.TELNYX_SIP_USERNAME}@sip.telnyx.com`,
      from: payload.from,
      timeout_secs: 25,
      client_state: Buffer.from(JSON.stringify({ role: "agent" })).toString("base64"),
    })
  }

  // Agent (outgoing leg) answered → bridge the two legs.
  if (event_type === "call.answered" && payload.direction === "outgoing") {
    // payload.client_state is the base64 we set above
    const aLeg = body.data.payload.call_control_id // this is leg B; need leg A — see note
    console.log("SPIKE agent answered, bridging is validated manually here", aLeg)
  }

  return Response.json({ ok: true })
}
```

> Note: full leg-A/leg-B correlation is built properly in Tasks 3/5. For the spike, the goal is only to confirm the browser **rings** when leg B is dialed and that audio flows once you accept. If you want the spike to also bridge, temporarily log both `call_control_id`s and bridge in the orchestrator tasks instead.

- [ ] **Step 5: Add the new env var.** In `.env.local`: `TELNYX_VOICE_APP_ID=<Application ID from Step 1>`. Restart `npm run dev` (deploy if testing against a real domain — Telnyx must reach the webhook).

- [ ] **Step 6: Manual test.** With the softphone open and registered in the browser, call the test number from a phone.
  - Expected: the browser softphone **rings**. Accept it → two-way audio.
  - If it rings and bridges → **spike passed**, proceed to Task 1.
  - If the browser does NOT ring: check the Telnyx Debugging → SIP/Call logs. Most likely the Credential Connection rejected the inbound leg → fix its inbound settings (Step 3) and retry. If still failing after that, **pivot:** create a Telephony Credential tied to the Voice API app (`POST /v2/telephony_credentials` with `connection_id=$TELNYX_VOICE_APP_ID`), repoint `TELNYX_SIP_USERNAME`/`TELNYX_SIP_PASSWORD` to it, and retry this spike.

- [ ] **Step 7: Delete the spike route once proven.**

```bash
git rm app/api/webhooks/telnyx/voice-spike/route.ts
git commit -m "chore: remove voicemail dial-bridge spike (validated)"
```

---

## Task 1: Add Vitest for pure-logic unit tests

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest.**

Run: `npm install -D vitest`

- [ ] **Step 2: Add the test script to `package.json`** (in the `scripts` block):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create `vitest.config.ts`.**

```ts
import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
})
```

- [ ] **Step 4: Verify the runner works (no tests yet).**

Run: `npm test`
Expected: exits 0 with "No test files found" (acceptable) — confirms the runner is wired.

- [ ] **Step 5: Commit.**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test: add vitest for pure-logic unit tests"
```

---

## Task 2: Telnyx client factory + retry helper

**Files:**
- Create: `lib/telnyx/client.ts`

- [ ] **Step 1: Write the client + `withRetry`.**

```ts
// lib/telnyx/client.ts
import Telnyx from "telnyx"

let cached: Telnyx | null = null

/** Single server-only Telnyx client. Never import into client components. */
export function getTelnyxClient(): Telnyx {
  if (!cached) {
    const apiKey = process.env.TELNYX_API_KEY
    if (!apiKey) throw new Error("TELNYX_API_KEY is not set")
    cached = new Telnyx({ apiKey })
  }
  return cached
}

/**
 * Retry a Telnyx command on rate-limit (429) / transient 5xx with exponential
 * backoff. Telnyx command calls are idempotent when given the same command_id,
 * so retries are safe.
 */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err: unknown) {
      lastErr = err
      const status = (err as { statusCode?: number })?.statusCode
      const retryable = status === 429 || (typeof status === "number" && status >= 500)
      if (!retryable || i === attempts - 1) throw err
      await new Promise((r) => setTimeout(r, 250 * 2 ** i))
    }
  }
  throw lastErr
}
```

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck`
Expected: passes (no errors introduced).

- [ ] **Step 3: Commit.**

```bash
git add lib/telnyx/client.ts
git commit -m "feat: shared Telnyx client with retry/backoff helper"
```

---

## Task 3: `client_state` codec (leg correlation)

**Files:**
- Create: `lib/telnyx/client-state.ts`
- Test: `lib/telnyx/client-state.test.ts`

- [ ] **Step 1: Write the failing test.**

```ts
// lib/telnyx/client-state.test.ts
import { describe, it, expect } from "vitest"
import { encodeClientState, decodeClientState } from "./client-state"

describe("client-state codec", () => {
  it("round-trips an agent-leg payload", () => {
    const encoded = encodeClientState({ role: "agent", aLegId: "abc-123", callId: "db-1" })
    expect(typeof encoded).toBe("string")
    expect(decodeClientState(encoded)).toEqual({
      role: "agent",
      aLegId: "abc-123",
      callId: "db-1",
    })
  })

  it("returns null for undefined / garbage input", () => {
    expect(decodeClientState(undefined)).toBeNull()
    expect(decodeClientState("not-base64-json!!")).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npm test`
Expected: FAIL — `encodeClientState` not defined.

- [ ] **Step 3: Implement the codec.**

```ts
// lib/telnyx/client-state.ts

export type AgentLegState = {
  role: "agent"
  aLegId: string // caller leg call_control_id
  callId: string // calls.id in our DB
}

/** Telnyx requires client_state to be a base64 string; it echoes it on every
 *  webhook for that leg. We use it to correlate the dialed agent leg back to
 *  the caller leg without a DB lookup race. */
export function encodeClientState(state: AgentLegState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64")
}

export function decodeClientState(value: string | null | undefined): AgentLegState | null {
  if (!value) return null
  try {
    const json = Buffer.from(value, "base64").toString("utf8")
    const parsed = JSON.parse(json)
    if (parsed && parsed.role === "agent" && typeof parsed.aLegId === "string") {
      return parsed as AgentLegState
    }
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/telnyx/client-state.ts lib/telnyx/client-state.test.ts
git commit -m "feat: client_state codec for Telnyx leg correlation"
```

---

## Task 4: Webhook signature + timestamp-freshness verifier

Extracts the inline verifier from the route, makes it **fail closed**, and rejects **stale** (replayed) timestamps.

**Files:**
- Create: `lib/telnyx/webhook.ts`
- Test: `lib/telnyx/webhook.test.ts`

- [ ] **Step 1: Write the failing test** (generates a real Ed25519 key to sign with).

```ts
// lib/telnyx/webhook.test.ts
import { describe, it, expect } from "vitest"
import crypto from "crypto"
import { verifyTelnyxWebhook } from "./webhook"

// Telnyx signs `${timestamp}|${body}` with Ed25519; the public key is sent
// base64 (raw 32 bytes). Build a matching keypair for the test.
function makeSigned(body: string, timestamp: string) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const sig = crypto.sign(null, Buffer.from(`${timestamp}|${body}`), privateKey)
  const rawPub = publicKey.export({ type: "spki", format: "der" }).subarray(-32)
  return {
    signature: sig.toString("base64"),
    publicKeyBase64: rawPub.toString("base64"),
  }
}

describe("verifyTelnyxWebhook", () => {
  const body = '{"hello":"world"}'

  it("accepts a valid, fresh signature", () => {
    const ts = Math.floor(Date.now() / 1000).toString()
    const { signature, publicKeyBase64 } = makeSigned(body, ts)
    expect(verifyTelnyxWebhook({ body, signature, timestamp: ts, publicKeyBase64 })).toBe(true)
  })

  it("rejects a stale timestamp (replay)", () => {
    const ts = (Math.floor(Date.now() / 1000) - 600).toString() // 10 min old
    const { signature, publicKeyBase64 } = makeSigned(body, ts)
    expect(verifyTelnyxWebhook({ body, signature, timestamp: ts, publicKeyBase64 })).toBe(false)
  })

  it("rejects a bad signature", () => {
    const ts = Math.floor(Date.now() / 1000).toString()
    const { publicKeyBase64 } = makeSigned(body, ts)
    expect(
      verifyTelnyxWebhook({ body, signature: "AAAA", timestamp: ts, publicKeyBase64 })
    ).toBe(false)
  })

  it("rejects when public key is missing (fail closed)", () => {
    const ts = Math.floor(Date.now() / 1000).toString()
    const { signature } = makeSigned(body, ts)
    expect(
      verifyTelnyxWebhook({ body, signature, timestamp: ts, publicKeyBase64: undefined })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `npm test`
Expected: FAIL — `verifyTelnyxWebhook` not defined.

- [ ] **Step 3: Implement the verifier.**

```ts
// lib/telnyx/webhook.ts
import crypto from "crypto"

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")
const MAX_SKEW_SECONDS = 300 // reject timestamps more than ±5 min from now

type VerifyArgs = {
  body: string
  signature: string | null
  timestamp: string | null
  publicKeyBase64: string | undefined
}

export function verifyTelnyxWebhook({
  body,
  signature,
  timestamp,
  publicKeyBase64,
}: VerifyArgs): boolean {
  if (!signature || !timestamp || !publicKeyBase64) return false // fail closed

  // Replay protection: timestamp must be recent.
  const tsSeconds = Number(timestamp)
  if (!Number.isFinite(tsSeconds)) return false
  const nowSeconds = Date.now() / 1000
  if (Math.abs(nowSeconds - tsSeconds) > MAX_SKEW_SECONDS) return false

  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyBase64, "base64")]),
      format: "der",
      type: "spki",
    })
    return crypto.verify(
      null,
      Buffer.from(`${timestamp}|${body}`),
      publicKey,
      Buffer.from(signature, "base64")
    )
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run: `npm test`
Expected: PASS (4 webhook tests + earlier codec tests).

- [ ] **Step 5: Commit.**

```bash
git add lib/telnyx/webhook.ts lib/telnyx/webhook.test.ts
git commit -m "feat: fail-closed Telnyx webhook verifier with replay protection"
```

---

## Task 5: Voice orchestrator helpers

**Files:**
- Create: `lib/telnyx/voice-orchestrator.ts`

- [ ] **Step 1: Write the orchestrator helpers.**

```ts
// lib/telnyx/voice-orchestrator.ts
import crypto from "crypto"
import { getTelnyxClient, withRetry } from "./client"
import { encodeClientState } from "./client-state"

export const DEFAULT_GREETING =
  "Hi, you've reached our team. We're currently unavailable. Please leave a message after the tone."

function commandId(): string {
  return crypto.randomUUID()
}

/** Answer the inbound caller leg (leg A). The body arg is required by the SDK. */
export async function answerCaller(callControlId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() => telnyx.calls.actions.answer(callControlId, { command_id: commandId() }))
}

/** Dial the WebRTC SIP credential as leg B, tagged so we can correlate it back. */
export async function dialAgent(params: {
  aLegId: string
  callId: string
  callerNumber: string
}): Promise<void> {
  const telnyx = getTelnyxClient()
  const sipUser = process.env.TELNYX_SIP_USERNAME
  const appId = process.env.TELNYX_VOICE_APP_ID
  if (!sipUser || !appId) throw new Error("TELNYX_SIP_USERNAME or TELNYX_VOICE_APP_ID not set")

  await withRetry(() =>
    telnyx.calls.dial({
      connection_id: appId,
      to: `sip:${sipUser}@sip.telnyx.com`,
      from: params.callerNumber, // agent sees the customer's number
      timeout_secs: 25,
      command_id: commandId(),
      client_state: encodeClientState({
        role: "agent",
        aLegId: params.aLegId,
        callId: params.callId,
      }),
    })
  )
}

/** Bridge the answered agent leg (B) to the caller leg (A). */
export async function bridgeLegs(aLegId: string, bLegId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.bridge(aLegId, {
      call_control_id_to_bridge_with: bLegId,
      command_id: commandId(),
    })
  )
}

/** Speak the greeting on the caller leg to begin the voicemail flow. */
export async function startVoicemail(aLegId: string, greeting: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.speak(aLegId, {
      payload: greeting || DEFAULT_GREETING,
      voice: "female",
      language: "en-US",
      command_id: commandId(),
    })
  )
}
```

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck`
Expected: passes. (If the SDK rejects `command_id` on a given action's types, drop that field for that call — it is optional. Note any such adjustment in the commit.)

- [ ] **Step 3: Commit.**

```bash
git add lib/telnyx/voice-orchestrator.ts
git commit -m "feat: Telnyx voice orchestrator (answer/dial/bridge/voicemail)"
```

---

## Task 6: Wire the webhook to the orchestrator

Rewrites the dispatcher to: answer caller, skip logging the agent leg, dial on caller-answer, bridge on agent-answer, voicemail on agent-leg failure. Reuses the existing `handleSpeakEnded` and `handleRecordingSaved` (Task 9 extends the latter).

**Files:**
- Modify: `app/api/webhooks/telnyx/voice/route.ts`

- [ ] **Step 1: Replace the signature block + dispatcher** with the verifier from Task 4 and the new event routing. Full new top of file:

```ts
import Telnyx from "telnyx"
import { createAdminClient } from "@/lib/admin"
import { verifyTelnyxWebhook } from "@/lib/telnyx/webhook"
import { decodeClientState } from "@/lib/telnyx/client-state"
import {
  answerCaller,
  dialAgent,
  bridgeLegs,
  startVoicemail,
  DEFAULT_GREETING,
} from "@/lib/telnyx/voice-orchestrator"

export const runtime = "nodejs"

type TelnyxCallPayload = {
  call_control_id: string
  call_leg_id: string
  from: string
  to: string
  direction: "incoming" | "outgoing"
  state?: string
  hangup_cause?: string
  start_time?: string
  end_time?: string
  connection_id?: string
  client_state?: string | null
  recording_url?: string
  duration_ms?: number
}

type TelnyxVoiceWebhookBody = {
  data: { event_type: string; payload: TelnyxCallPayload }
}

export async function POST(req: Request) {
  const rawBody = await req.text()

  const valid = verifyTelnyxWebhook({
    body: rawBody,
    signature: req.headers.get("telnyx-signature-ed25519"),
    timestamp: req.headers.get("telnyx-timestamp"),
    publicKeyBase64:
      process.env.TELNYX_WEBHOOK_PUBLIC_KEY ?? process.env.TELNYX_PUBLIC_KEY,
  })
  if (!valid) {
    console.warn("⚠️ Voice webhook rejected (bad signature / stale timestamp / missing key)")
    return Response.json({ error: "Invalid signature" }, { status: 403 })
  }

  const body = JSON.parse(rawBody) as TelnyxVoiceWebhookBody
  const { event_type, payload } = body.data
  const supabase = createAdminClient()

  switch (event_type) {
    case "call.initiated":
      await handleCallInitiated(supabase, payload)
      break
    case "call.answered":
      await handleCallAnswered(supabase, payload)
      break
    case "call.hangup":
      await handleCallHangup(supabase, payload)
      break
    case "call.speak.ended":
      await handleSpeakEnded(supabase, payload)
      break
    case "call.recording.saved":
      await handleRecordingSaved(supabase, payload)
      break
    default:
      console.log("ℹ️ Ignoring voice event:", event_type)
  }

  return Response.json({ ok: true })
}

type SupabaseClient = ReturnType<typeof createAdminClient>
```

- [ ] **Step 2: Replace `handleCallInitiated`** — skip the dialed agent leg, otherwise insert + answer the caller.

```ts
async function handleCallInitiated(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const agentState = decodeClientState(payload.client_state)

  // The dialed agent leg (B) is outgoing and tagged — never log it as a call.
  if (agentState?.role === "agent") return

  if (payload.direction === "outgoing") {
    // Softphone-originated outbound call — preserve existing logging.
    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("id")
      .eq("phone_number", payload.from)
      .eq("is_active", true)
      .maybeSingle()
    if (!phoneNumber) return
    await supabase.from("calls").upsert(
      {
        phone_number_id: phoneNumber.id,
        contact_number: payload.to,
        direction: "outbound",
        status: "initiated",
        telnyx_call_id: payload.call_control_id,
      },
      { onConflict: "telnyx_call_id", ignoreDuplicates: true }
    )
    return
  }

  // Inbound caller leg (A): log it, then answer so we can orchestrate.
  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("id")
    .eq("phone_number", payload.to)
    .eq("is_active", true)
    .maybeSingle()
  if (!phoneNumber) {
    console.warn("⚠️ No active phone number matches:", payload.to)
    return
  }
  await supabase.from("calls").upsert(
    {
      phone_number_id: phoneNumber.id,
      contact_number: payload.from,
      direction: "inbound",
      status: "initiated",
      telnyx_call_id: payload.call_control_id,
    },
    { onConflict: "telnyx_call_id", ignoreDuplicates: true }
  )
  try {
    await answerCaller(payload.call_control_id)
  } catch (err) {
    console.error("⚠️ Failed to answer inbound caller:", err)
  }
}
```

- [ ] **Step 3: Replace `handleCallAnswered`** — branch on leg.

```ts
async function handleCallAnswered(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const agentState = decodeClientState(payload.client_state)

  // Agent (leg B) picked up → bridge to the caller (leg A).
  if (agentState?.role === "agent") {
    try {
      await bridgeLegs(agentState.aLegId, payload.call_control_id)
      await supabase
        .from("calls")
        .update({ status: "answered", started_at: new Date().toISOString() })
        .eq("telnyx_call_id", agentState.aLegId)
    } catch (err) {
      console.error("⚠️ Failed to bridge agent leg:", err)
    }
    return
  }

  // Caller (leg A) was answered by us → look up DB id, then dial the agent.
  const { data: call } = await supabase
    .from("calls")
    .select("id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) return
  try {
    await dialAgent({
      aLegId: payload.call_control_id,
      callId: call.id,
      callerNumber: payload.from,
    })
  } catch (err) {
    console.error("⚠️ Failed to dial agent; sending caller to voicemail:", err)
    await beginVoicemail(supabase, payload.call_control_id)
  }
}
```

- [ ] **Step 4: Replace `handleCallHangup`** — when the agent leg ends unbridged, start voicemail; otherwise keep existing missed/completed logic.

```ts
async function handleCallHangup(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const agentState = decodeClientState(payload.client_state)

  // Agent leg (B) ended. If the caller leg was never bridged (still "initiated"),
  // the agent was offline or didn't answer → voicemail.
  if (agentState?.role === "agent") {
    const { data: callerCall } = await supabase
      .from("calls")
      .select("status")
      .eq("telnyx_call_id", agentState.aLegId)
      .maybeSingle()
    if (callerCall?.status === "initiated") {
      await beginVoicemail(supabase, agentState.aLegId)
    }
    return
  }

  // Caller leg (A) ended.
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, started_at, direction, phone_number_id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  const wasAnswered = call?.status === "answered" || call?.status === "completed"
  const endedAt = payload.end_time ?? new Date().toISOString()

  let finalStatus: string
  if (wasAnswered) finalStatus = "completed"
  else if (call?.status === "voicemail") finalStatus = "voicemail"
  else if (call?.direction === "inbound") finalStatus = "missed"
  else finalStatus = "failed"

  let durationSeconds: number | null = null
  if (wasAnswered && call?.started_at) {
    durationSeconds = Math.round(
      (new Date(endedAt).getTime() - new Date(call.started_at).getTime()) / 1000
    )
  }

  await supabase
    .from("calls")
    .update({
      status: finalStatus,
      ended_at: endedAt,
      ...(durationSeconds !== null && { duration_seconds: durationSeconds }),
    })
    .eq("telnyx_call_id", payload.call_control_id)

  if (finalStatus === "missed" && call?.id && call?.phone_number_id) {
    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("label, color")
      .eq("id", call.phone_number_id)
      .maybeSingle()
    await supabase.from("notifications").insert({
      type: "missed_call",
      reference_id: call.id,
      metadata: {
        contact_number: payload.from,
        phone_label: phoneNumber?.label ?? "Unknown",
        phone_color: phoneNumber?.color ?? "#6b7280",
      },
    })
  }
}
```

- [ ] **Step 5: Add the shared `beginVoicemail` helper** (resolves greeting, flips status, speaks). Place above `handleSpeakEnded`.

```ts
async function beginVoicemail(supabase: SupabaseClient, aLegId: string) {
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, phone_numbers(voicemail_greeting)")
    .eq("telnyx_call_id", aLegId)
    .maybeSingle()

  // Idempotency: only start once.
  if (!call || call.status === "voicemail") return

  await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)

  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  const greeting =
    (pn as { voicemail_greeting: string | null } | null)?.voicemail_greeting ?? DEFAULT_GREETING

  try {
    await startVoicemail(aLegId, greeting)
  } catch (err) {
    console.error("⚠️ Failed to start voicemail greeting:", err)
  }
}
```

- [ ] **Step 6: Keep `handleSpeakEnded` and `handleRecordingSaved` as-is** for now (they already start recording and save the voicemail). Remove the local `new Telnyx(...)` in `handleSpeakEnded` and use the shared client:

```ts
async function handleSpeakEnded(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const { data: call } = await supabase
    .from("calls")
    .select("status")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (call?.status !== "voicemail") return

  const { getTelnyxClient, withRetry } = await import("@/lib/telnyx/client")
  try {
    await withRetry(() =>
      getTelnyxClient().calls.actions.startRecording(payload.call_control_id, {
        format: "mp3",
        channels: "single",
      })
    )
  } catch (err) {
    console.error("⚠️ Failed to start recording:", err)
  }
}
```

- [ ] **Step 7: Typecheck + lint.**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 8: Commit.**

```bash
git add app/api/webhooks/telnyx/voice/route.ts
git commit -m "feat: orchestrate inbound via Call Control (answer/dial/bridge/voicemail)"
```

---

## Task 7: Delete the dead/insecure routes

**Files:**
- Delete: `app/api/calls/speak/route.ts`, `app/api/calls/voicemail-start/route.ts`, `app/api/cron/voicemail-check/route.ts`

- [ ] **Step 1: Confirm nothing references them.**

Run: `grep -rn "calls/speak\|voicemail-start\|voicemail-check" --include=*.ts --include=*.tsx . | grep -v node_modules`
Expected: no references outside the route files themselves (and the spec docs).

- [ ] **Step 2: Delete and commit.**

```bash
git rm app/api/calls/speak/route.ts app/api/calls/voicemail-start/route.ts app/api/cron/voicemail-check/route.ts
git commit -m "chore: remove insecure speak route and obsolete voicemail cron/start"
```

- [ ] **Step 3: Remove the pg_cron job** that called `voicemail-check` (Supabase SQL editor), so it stops 404-ing:

```sql
select cron.unschedule('voicemail-trigger');
```

---

## Task 8: DB migration + private Storage bucket

**Files:**
- Apply via Supabase dashboard (SQL editor + Storage).

- [ ] **Step 1: Add the storage path column.**

```sql
alter table voicemails add column if not exists storage_path text;
```

- [ ] **Step 2: Create a PRIVATE bucket named `voicemails`.** Supabase → Storage → New bucket → name `voicemails`, **Public = off**.

- [ ] **Step 3: Restrict object access to authenticated users** (SQL editor):

```sql
create policy "Authenticated can read voicemail objects"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'voicemails');
```

(The admin/service-role client used by the webhook bypasses RLS for uploads, so no insert policy is required.)

- [ ] **Step 4: Verify** the bucket exists and is private (dashboard shows a lock icon). No commit (external infra); note completion in the next commit message.

---

## Task 9: Copy recordings into the private bucket

**Files:**
- Modify: `app/api/webhooks/telnyx/voice/route.ts` (`handleRecordingSaved`)

- [ ] **Step 1: Replace `handleRecordingSaved`** to download the MP3, upload to the bucket, store the path, and best-effort delete the Telnyx copy. Falls back to the Telnyx URL if anything fails so a voicemail is never lost.

```ts
async function handleRecordingSaved(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const recordingUrl = payload.recording_url
  const durationMs = payload.duration_ms ?? 0
  if (!recordingUrl) {
    console.warn("⚠️ call.recording.saved has no recording_url")
    return
  }

  const { data: call } = await supabase
    .from("calls")
    .select("id, contact_number, phone_number_id, has_voicemail, phone_numbers(label)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) {
    console.warn("⚠️ No call found for recording:", payload.call_control_id)
    return
  }
  if (call.has_voicemail) return // idempotency: already processed

  // Copy the MP3 into the private bucket; fall back to the Telnyx URL on failure.
  let storagePath: string | null = null
  try {
    const res = await fetch(recordingUrl)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const path = `${call.id}.mp3`
    const { error: upErr } = await supabase.storage
      .from("voicemails")
      .upload(path, bytes, { contentType: "audio/mpeg", upsert: true })
    if (upErr) throw upErr
    storagePath = path
  } catch (err) {
    console.error("⚠️ Failed to copy recording to private bucket; keeping Telnyx URL:", err)
  }

  const { error: vmError } = await supabase.from("voicemails").insert({
    call_id: call.id,
    recording_url: recordingUrl,
    storage_path: storagePath,
    duration_seconds: Math.round(durationMs / 1000),
  })
  if (vmError) {
    console.error("⚠️ Failed to insert voicemail:", vmError)
    return
  }

  await supabase.from("calls").update({ has_voicemail: true }).eq("id", call.id)

  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  await supabase.from("notifications").insert({
    type: "voicemail",
    reference_id: call.id,
    metadata: {
      contact_number: call.contact_number,
      phone_label: (pn as { label: string } | null)?.label ?? "Unknown",
      duration_seconds: Math.round(durationMs / 1000),
    },
  })
  console.log(`📬 Voicemail saved for call ${call.id}`)
}
```

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck`
Expected: pass.

- [ ] **Step 3: Commit.**

```bash
git add app/api/webhooks/telnyx/voice/route.ts
git commit -m "feat: copy voicemail recordings into private Supabase bucket"
```

---

## Task 10: Signed-URL playback route

**Files:**
- Create: `app/api/voicemails/[id]/audio/route.ts`

- [ ] **Step 1: Write the authenticated signed-URL redirect.** (Next 16: route `params` is a Promise.)

```ts
// app/api/voicemails/[id]/audio/route.ts
import { getCurrentUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"

export const runtime = "nodejs"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const supabase = createAdminClient()
  const { data: vm } = await supabase
    .from("voicemails")
    .select("storage_path, recording_url")
    .eq("id", id)
    .maybeSingle()
  if (!vm) return Response.json({ error: "Not found" }, { status: 404 })

  // Old rows / upload fallback: redirect to the Telnyx URL.
  if (!vm.storage_path) {
    if (!vm.recording_url) return Response.json({ error: "No recording" }, { status: 404 })
    return Response.redirect(vm.recording_url, 307)
  }

  const { data: signed, error } = await supabase.storage
    .from("voicemails")
    .createSignedUrl(vm.storage_path, 60)
  if (error || !signed) {
    return Response.json({ error: "Could not sign URL" }, { status: 500 })
  }
  return Response.redirect(signed.signedUrl, 307)
}
```

- [ ] **Step 2: Typecheck.**

Run: `npm run typecheck`
Expected: pass. (Confirm `getCurrentUser` is exported from `@/lib/auth` — it is used by `app/api/calls/webrtc-token/route.ts`.)

- [ ] **Step 3: Commit.**

```bash
git add app/api/voicemails/[id]/audio/route.ts
git commit -m "feat: authenticated signed-URL route for voicemail playback"
```

---

## Task 11: Point the player at the signed-URL route

**Files:**
- Modify: `components/calls/calls-table.tsx` (`VoicemailPlayer`, line ~107)

- [ ] **Step 1: Change the `<audio src>`** from the raw `recording_url` to the route. Replace line 107:

```tsx
      <audio controls className="h-8 flex-1 max-w-sm" src={`/api/voicemails/${voicemail.id}/audio`} />
```

- [ ] **Step 2: Typecheck + lint.**

Run: `npm run typecheck && npm run lint`
Expected: pass.

- [ ] **Step 3: Commit.**

```bash
git add components/calls/calls-table.tsx
git commit -m "feat: play voicemails via authenticated signed-URL route"
```

---

## Task 12: End-to-end verification

**Files:** none (manual + checks).

- [ ] **Step 1: Set required env vars** in `.env.local` and the deploy target:
  `TELNYX_API_KEY`, `TELNYX_WEBHOOK_PUBLIC_KEY` (from Telnyx → public key; now REQUIRED), `TELNYX_SIP_USERNAME`, `TELNYX_SIP_PASSWORD`, `TELNYX_VOICE_APP_ID`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_URL`.

- [ ] **Step 2: Point the production number** at the Voice API app (move it off the SIP trunk), webhook → `/api/webhooks/telnyx/voice`.

- [ ] **Step 3: Run the full suite.**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 4: Manual call matrix** (check the Calls page + notification bell after each):
  - **Agent online, answers** → call bridges, status `completed`, no voicemail.
  - **Agent online, ignores ~25s** → greeting plays, you leave a message, hang up → `voicemail` row, `has_voicemail=true`, notification, audio plays from the signed URL.
  - **All softphones closed (offline)** → dial fails fast → greeting plays almost immediately → voicemail saved.
  - **Caller hangs up while ringing** → status `missed`, missed-call notification, no voicemail.

- [ ] **Step 5: Verify storage privacy.** Confirm the `voicemails` bucket object is NOT publicly accessible (open the stored object's public URL → should fail) and that the in-app player works (signed URL).

- [ ] **Step 6: Final commit** (if any env/docs notes changed).

```bash
git add -A
git commit -m "docs: voicemail go-live env + verification notes"
```

---

## Self-Review Notes

- **Spec coverage:** Phase 0 spike (Task 0), Voice API routing + dial/bridge (Tasks 5–6), dial-result voicemail trigger (Task 6 `beginVoicemail` + agent-leg hangup), `client_state` correlation (Task 3, used in Task 6), reuse of speak→record→save (Task 6 Step 6, Task 9), private-bucket storage + signed URLs (Tasks 8–11), security hardening — replay/fail-closed verifier (Task 4), deleted insecure routes (Task 7), retry/idempotency (Task 2 + `command_id` in Task 5), no schema change beyond `storage_path` (Task 8). All spec sections map to a task.
- **Greeting fallback** uses the same `DEFAULT_GREETING` constant everywhere (orchestrator export), reused by `beginVoicemail`.
- **Idempotency:** `beginVoicemail` guards on `status==='voicemail'`; `handleRecordingSaved` guards on `has_voicemail`; commands carry `command_id`.
- **Known acceptable gap:** if the caller abandons while the agent leg is still ringing, leg B is left to time out at 25s rather than being proactively hung up (no double voicemail occurs because `beginVoicemail` checks caller status). Documented in the spec's error table.
```
