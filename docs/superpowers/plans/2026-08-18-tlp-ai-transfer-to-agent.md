# TLP AI Transfer to Human Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a caller on an AI-answered TLP call asks for a human, the assistant transfers them to an online agent; when nobody is online, it says so and takes a message instead.

**Architecture:** Telnyx's AI Assistant has a first-class `transfer` tool, so the transfer itself is portal configuration, not code. The only code we own is a **dynamic variables webhook** that Telnyx POSTs once at conversation start: it calls the existing `getOnlineReachableAgents()` and returns `agents_available` plus a `targets` array that the transfer tool's `{{ targets }}` placeholder resolves to. Everything fails safe to "no agents, take a message".

**Tech Stack:** Next.js 16 App Router (route handlers, `runtime = "nodejs"`), TypeScript, Supabase admin client, Telnyx Node SDK ^6.73.0 (types only — no SDK call needed here), vitest (`environment: "node"`).

**Spec:** `docs/superpowers/specs/2026-08-18-tlp-ai-transfer-to-agent-design.md`

## Global Constraints

- **Everything fails safe.** Any failure — bad signature, DB error, thrown exception — returns HTTP **200** with `{ dynamic_variables: { agents_available: false, targets: [] } }`. Never a 4xx/5xx, never a thrown error. A broken route must be indistinguishable from today's working behaviour.
- **The response MUST be wrapped in a top-level `dynamic_variables` object.** Telnyx silently ignores a flat object and falls back to assistant defaults. This failure is invisible at runtime, so a unit test asserts the wrapper.
- **No new env vars. No new SQL.** Availability reuses the existing presence tables via `getOnlineReachableAgents`; brand naming is unchanged.
- **Target cap is a module constant** `MAX_TRANSFER_TARGETS = 5` in `lib/telnyx/ai-transfer.ts` — not configurable.
- Agent SIP URI form is exactly `sip:{sipUsername}@sip.telnyx.com` (matches `dialAgentLeg` in `lib/telnyx/voice-orchestrator.ts`).
- **Vitest runs with `environment: "node"`** and the repo has no jsdom and no testing-library. Tests cover pure modules and API routes only. Do not add a test harness.
- Web deploy only (megestic.com). No Chrome extension changes, no changes to other brands or to outbound calls.
- Commit after every task.

### Deviation from the spec, with rationale

The spec's Components table says the route should "resolve the brand from the payload's `to` number". **It does not need to.** The parent spec (`2026-08-13`) already passes `dynamic_variables: { brand_label }` on the `startAIAssistant` command, so brand naming is solved before this webhook fires. Availability is also global — any online agent can take any call — so the route never needs to know which number was dialled.

Dropping it removes the plan's only dependency on the dynamic variables webhook's payload shape, which is not documented in the SDK. The route therefore ignores the request body entirely except for signature verification. Flag this to the spec author so the Components table can be corrected.

---

## File Structure

**Create:**
- `lib/telnyx/ai-transfer.ts` — pure: builds the `dynamic_variables` payload from `ReachableAgent[]`; owns the fail-safe constant and the target cap.
- `lib/telnyx/ai-transfer.test.ts` — unit tests for the above.
- `app/api/webhooks/telnyx/ai/variables/route.ts` — the webhook: verify signature, read presence, respond.
- `app/api/webhooks/telnyx/ai/variables/route.test.ts` — route tests.

**Modify:** nothing. No existing file changes in this plan.

**Telnyx portal (not repo files):** transfer tool, `dynamic_variables_webhook_url`, timeout, default variables, assistant instructions — Task 3.

---

## Task 1: Pure payload builder (TDD)

**Files:**
- Create: `lib/telnyx/ai-transfer.ts`
- Test: `lib/telnyx/ai-transfer.test.ts`

**Interfaces:**
- Consumes: `type ReachableAgent = { userId: string; sipUsername: string }` from `lib/telnyx/ring-all.ts` (already exported).
- Produces, used by Task 2:
  - `MAX_TRANSFER_TARGETS: 5`
  - `type TransferTarget = { to: string; name: string }`
  - `type TransferVariables = { agents_available: boolean; targets: TransferTarget[] }`
  - `FAIL_SAFE_VARIABLES: TransferVariables`
  - `transferVariables(agents: ReachableAgent[]): TransferVariables`
  - `wrapDynamicVariables(vars: TransferVariables): { dynamic_variables: TransferVariables }`

- [ ] **Step 1: Write the failing test**

Create `lib/telnyx/ai-transfer.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  MAX_TRANSFER_TARGETS,
  FAIL_SAFE_VARIABLES,
  transferVariables,
  wrapDynamicVariables,
} from "./ai-transfer"

const agent = (n: number) => ({ userId: `user-${n}`, sipUsername: `gencred${n}` })

describe("transferVariables", () => {
  it("reports no availability and no targets when nobody is online", () => {
    expect(transferVariables([])).toEqual({ agents_available: false, targets: [] })
  })

  it("maps one online agent to a Telnyx SIP URI target", () => {
    expect(transferVariables([agent(1)])).toEqual({
      agents_available: true,
      targets: [{ to: "sip:gencred1@sip.telnyx.com", name: "Agent 1" }],
    })
  })

  it("preserves order across several agents", () => {
    const targets = transferVariables([agent(1), agent(2), agent(3)]).targets
    expect(targets.map((t) => t.to)).toEqual([
      "sip:gencred1@sip.telnyx.com",
      "sip:gencred2@sip.telnyx.com",
      "sip:gencred3@sip.telnyx.com",
    ])
  })

  it("caps the target list so a large team cannot bloat the payload", () => {
    const many = Array.from({ length: MAX_TRANSFER_TARGETS + 4 }, (_, i) => agent(i))
    expect(transferVariables(many).targets).toHaveLength(MAX_TRANSFER_TARGETS)
  })

  it("skips agents with a blank sip username rather than emitting a broken URI", () => {
    const vars = transferVariables([{ userId: "u", sipUsername: "  " }, agent(2)])
    expect(vars.targets).toEqual([{ to: "sip:gencred2@sip.telnyx.com", name: "Agent 1" }])
    expect(vars.agents_available).toBe(true)
  })

  it("reports no availability when every agent was unusable", () => {
    expect(transferVariables([{ userId: "u", sipUsername: "" }])).toEqual({
      agents_available: false,
      targets: [],
    })
  })
})

describe("FAIL_SAFE_VARIABLES", () => {
  it("is the take-a-message state, so any failure degrades to today's behaviour", () => {
    expect(FAIL_SAFE_VARIABLES).toEqual({ agents_available: false, targets: [] })
  })
})

describe("wrapDynamicVariables", () => {
  it("nests under a top-level dynamic_variables key (Telnyx ignores a flat object)", () => {
    expect(wrapDynamicVariables({ agents_available: false, targets: [] })).toEqual({
      dynamic_variables: { agents_available: false, targets: [] },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/telnyx/ai-transfer.test.ts`
Expected: FAIL — cannot resolve `./ai-transfer`.

- [ ] **Step 3: Write minimal implementation**

Create `lib/telnyx/ai-transfer.ts`:

```ts
// Pure helpers for the AI assistant's transfer-to-human tool. No SDK, DB, or
// env access at module scope so it unit-tests in plain node (mirrors the other
// lib/telnyx pure modules).

import type { ReachableAgent } from "./ring-all"

/** Cap on how many agents we hand the assistant. Not configurable: the
 *  assistant picks one target anyway, so a longer list only bloats the
 *  payload and slows the webhook. */
export const MAX_TRANSFER_TARGETS = 5

export type TransferTarget = {
  to: string
  name: string
}

export type TransferVariables = {
  agents_available: boolean
  targets: TransferTarget[]
}

/** The state every failure path returns: the assistant tells the caller nobody
 *  is available and takes a message, which is exactly today's behaviour. */
export const FAIL_SAFE_VARIABLES: TransferVariables = {
  agents_available: false,
  targets: [],
}

/**
 * Online agents → the dynamic variables the assistant's transfer tool needs.
 * `agents_available` is what the instructions branch on; `targets` is what
 * `{{ targets }}` resolves to. Agents without a usable SIP username are
 * dropped rather than emitted as a malformed URI the transfer would fail on.
 */
export function transferVariables(agents: ReachableAgent[]): TransferVariables {
  const targets = agents
    .filter((a) => a.sipUsername.trim() !== "")
    .slice(0, MAX_TRANSFER_TARGETS)
    .map((a, index) => ({
      to: `sip:${a.sipUsername.trim()}@sip.telnyx.com`,
      // Deliberately generic: the caller may hear this, and it must not leak a
      // real agent's identity. Telnyx does not report which target it chose, so
      // this is a label only (see the spec's Known limitations).
      name: `Agent ${index + 1}`,
    }))
  return { agents_available: targets.length > 0, targets }
}

/** Telnyx silently ignores a flat response and falls back to assistant
 *  defaults, so every response goes through this wrapper. */
export function wrapDynamicVariables(vars: TransferVariables): {
  dynamic_variables: TransferVariables
} {
  return { dynamic_variables: vars }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/telnyx/ai-transfer.test.ts`
Expected: PASS (9 tests across 3 suites).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/telnyx/ai-transfer.ts lib/telnyx/ai-transfer.test.ts
git commit -m "feat(ai): pure builder for transfer-tool dynamic variables"
```

---

## Task 2: Dynamic variables webhook route (TDD)

**Files:**
- Create: `app/api/webhooks/telnyx/ai/variables/route.ts`
- Test: `app/api/webhooks/telnyx/ai/variables/route.test.ts`

**Interfaces:**
- Consumes: `transferVariables`, `wrapDynamicVariables`, `FAIL_SAFE_VARIABLES` (Task 1); `getOnlineReachableAgents(admin)` from `@/lib/telnyx/ring-all`; `createAdminClient()` from `@/lib/admin`; `verifyTelnyxWebhook({ body, signature, timestamp, publicKeyBase64 })` from `@/lib/telnyx/webhook`.
- Produces: `POST(req: Request): Promise<Response>` — the URL configured as `dynamic_variables_webhook_url`.

**Why the admin client is correct here:** there is no user session on a Telnyx webhook. Reading presence requires bypassing RLS, exactly as the voice webhook does. This is not the pattern the SMS spec forbids — that rule is about *user-initiated deletes*, where RLS is the authorization.

**Header names** (copy exactly, same as `app/api/webhooks/telnyx/voice/route.ts`): `telnyx-signature-ed25519` and `telnyx-timestamp`; key from `process.env.TELNYX_WEBHOOK_PUBLIC_KEY ?? process.env.TELNYX_PUBLIC_KEY`.

- [ ] **Step 1: Write the failing test**

Create `app/api/webhooks/telnyx/ai/variables/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const { verifyTelnyxWebhook, getOnlineReachableAgents, createAdminClient } = vi.hoisted(
  () => ({
    verifyTelnyxWebhook: vi.fn(),
    getOnlineReachableAgents: vi.fn(),
    createAdminClient: vi.fn(() => ({})),
  })
)
vi.mock("@/lib/telnyx/webhook", () => ({ verifyTelnyxWebhook }))
vi.mock("@/lib/telnyx/ring-all", () => ({ getOnlineReachableAgents }))
vi.mock("@/lib/admin", () => ({ createAdminClient }))

import { POST } from "./route"

const req = () =>
  new Request("http://test/api/webhooks/telnyx/ai/variables", {
    method: "POST",
    headers: {
      "telnyx-signature-ed25519": "sig",
      "telnyx-timestamp": "123",
    },
    body: JSON.stringify({ data: { payload: {} } }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELNYX_WEBHOOK_PUBLIC_KEY = "key"
  verifyTelnyxWebhook.mockReturnValue(true)
  getOnlineReachableAgents.mockResolvedValue([])
})

describe("POST /api/webhooks/telnyx/ai/variables", () => {
  it("returns online agents as transfer targets, wrapped for Telnyx", async () => {
    getOnlineReachableAgents.mockResolvedValue([
      { userId: "u1", sipUsername: "gencred1" },
    ])

    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      dynamic_variables: {
        agents_available: true,
        targets: [{ to: "sip:gencred1@sip.telnyx.com", name: "Agent 1" }],
      },
    })
  })

  it("reports no availability when no agent is online", async () => {
    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      dynamic_variables: { agents_available: false, targets: [] },
    })
  })

  it("fails safe with 200 on a bad signature, so Telnyx does not retry", async () => {
    verifyTelnyxWebhook.mockReturnValue(false)

    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      dynamic_variables: { agents_available: false, targets: [] },
    })
    expect(getOnlineReachableAgents).not.toHaveBeenCalled()
  })

  it("fails safe with 200 when the presence lookup throws", async () => {
    getOnlineReachableAgents.mockRejectedValue(new Error("db down"))

    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      dynamic_variables: { agents_available: false, targets: [] },
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run "app/api/webhooks/telnyx/ai/variables/route.test.ts"`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write minimal implementation**

Create `app/api/webhooks/telnyx/ai/variables/route.ts`:

```ts
import { createAdminClient } from "@/lib/admin"
import { verifyTelnyxWebhook } from "@/lib/telnyx/webhook"
import { getOnlineReachableAgents } from "@/lib/telnyx/ring-all"
import {
  FAIL_SAFE_VARIABLES,
  transferVariables,
  wrapDynamicVariables,
} from "@/lib/telnyx/ai-transfer"

export const runtime = "nodejs"

/** Always 200 with the take-a-message state. Telnyx falls back to assistant
 *  defaults on a non-2xx, so an error status would reach the same outcome —
 *  but a 200 stops it retrying a request we are never going to accept. */
function failSafe(): Response {
  return Response.json(wrapDynamicVariables(FAIL_SAFE_VARIABLES))
}

/**
 * Telnyx POSTs this once, at the start of an AI conversation, to resolve the
 * assistant's dynamic variables. We answer with whether any agent is online
 * and the SIP targets its transfer tool may use.
 *
 * The request body is deliberately unused beyond signature verification:
 * brand naming already arrives via `dynamic_variables.brand_label` on the
 * startAIAssistant command, and availability is global rather than per-number,
 * so nothing here depends on the (undocumented) payload shape.
 *
 * Every failure path returns the fail-safe state, so the assistant tells the
 * caller nobody is available and takes a message — today's behaviour.
 */
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
    console.warn("⚠️ AI variables webhook rejected (bad signature / stale timestamp / missing key)")
    return failSafe()
  }

  try {
    const supabase = createAdminClient()
    const agents = await getOnlineReachableAgents(supabase)
    const vars = transferVariables(agents)
    console.log(
      `🤖 AI variables: agents_available=${vars.agents_available} targets=${vars.targets.length}`
    )
    return Response.json(wrapDynamicVariables(vars))
  } catch (err) {
    console.error("⚠️ AI variables webhook failed; falling back to no-agents:", err)
    return failSafe()
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run "app/api/webhooks/telnyx/ai/variables/route.test.ts"`
Expected: PASS (4 tests).

- [ ] **Step 5: Full gate**

Run: `npm run test`
Expected: all files pass.
Run: `npm run typecheck`
Expected: PASS.
Run: `npx eslint "app/api/webhooks/telnyx/ai/variables/route.ts" lib/telnyx/ai-transfer.ts`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "app/api/webhooks/telnyx/ai/variables/route.ts" "app/api/webhooks/telnyx/ai/variables/route.test.ts"
git commit -m "feat(ai): dynamic variables webhook exposing online agents as transfer targets"
```

---

## Task 3: Telnyx portal configuration + manual E2E (human-assisted)

**Files:** none. Telnyx Mission Control only.

**Interfaces:**
- Consumes: the deployed route from Task 2 at `https://www.megestic.com/api/webhooks/telnyx/ai/variables`.
- Produces: a live transfer path on the TLP assistant.

- [ ] **Step 1: Deploy first, while the feature is still inert**

The route does nothing until the portal points at it, so deploy before configuring.

```bash
git push origin main
```

Wait for the Vercel production deploy to finish.

- [ ] **Step 2: Confirm open question #1 before configuring auth**

The spec's blocking open question: **is the dynamic variables webhook signed with the same Ed25519 scheme as the voice and message webhooks?** Task 2 assumes it is.

Verify by watching the production logs during the first test call in Step 5. If the log line reads `⚠️ AI variables webhook rejected`, the answer is no — the request is not signed the same way, and the route falls back to no-agents (fail-safe working as designed, but transfer will never be offered).

If it is not signed: do **not** remove verification. Instead add a shared secret to the configured URL (e.g. `…/variables?key=<random>`) and check it in the route alongside the signature. Treat that as a follow-up task, not a patch during E2E.

- [ ] **Step 3: Add the transfer tool to the TLP assistant**

Mission Control → AI → AI Assistants → the TLP assistant → Tools → Add tool → **Transfer**:

- `from` — the TLP DID (the number the transfer leg is placed from).
- `targets` — the literal string `{{ targets }}` (not a list; this is the dynamic-variable form).
- `warm_transfer_instructions`:

  > Before connecting, briefly tell the person who answers the caller's name, their number, and the reason they called. Keep it to one or two sentences.

- `voicemail_detection.action` — `stop_transfer` (per spec open question #6, so a failed transfer returns the caller to the AI rather than leaving a message on their behalf).

- [ ] **Step 4: Point the assistant at the webhook and set fail-safe defaults**

On the same assistant:

- `dynamic_variables_webhook_url` = `https://www.megestic.com/api/webhooks/telnyx/ai/variables`
- `dynamic_variables_webhook_timeout_ms` = `3000`
- Default `dynamic_variables` — **required, this is the safety net**:
  - `agents_available` = `false`
  - `targets` = `[]`

Append to the assistant's instructions:

> If the caller asks to speak to a person and `agents_available` is true, use the transfer tool. If `agents_available` is false, tell them no one is available right now, offer to take a message, and collect their name, number and reason for calling. Do not promise a transfer you cannot make, and do not offer a transfer unless they ask for one.

- [ ] **Step 5: Manual E2E — agent online**

Set yourself Online in the dashboard, then call the TLP number.

1. AI answers as today.
2. Ask "can you transfer me to a person?"
3. Expected: your softphone rings, you hear the AI's briefing, then you are connected to the caller.
4. Check production logs for `🤖 AI variables: agents_available=true targets=1`.

- [ ] **Step 6: Manual E2E — nobody online**

Set every agent Offline (and ensure no mobile device is marked available), then call TLP and ask for a person.

Expected: the AI says nobody is available right now and offers to take a message. Log line shows `agents_available=false targets=0`.

- [ ] **Step 7: Manual E2E — prove the fail-safe**

Temporarily change `dynamic_variables_webhook_url` to a nonexistent path on the same host, then call TLP with an agent online and ask for a person.

Expected: the AI still says nobody is available and takes a message — the assistant defaults took over. This is the single most important behaviour in the design; do not skip it. Restore the correct URL afterwards.

- [ ] **Step 8: Confirm the existing flow is untouched**

1. After a successful transfer, check Slack still receives the AI-portion transcript and the dashboard shows the segments.
2. Call a non-TLP number: unchanged ring-all.
3. Confirm the call row finalizes as `completed` with a duration.

Note for Step 8.1: the transcript will end where the AI handed over, because the human portion is not transcribed. That is expected (spec D12), not a bug.

- [ ] **Step 9: Record the outcome**

Update the spec's open questions with what the test settled — in particular #1 (signature) and #7 (answered-by attribution: confirm a transferred call shows no agent in the answered-by filter).

```bash
git add docs/superpowers/specs/2026-08-18-tlp-ai-transfer-to-agent-design.md
git commit -m "docs: record TLP transfer E2E outcomes and settled open questions"
```

---

## Deferred to a follow-up

**D12's "transferred" note in the Slack message.** The spec says the Slack post should mark a call as transferred so the transcript's abrupt ending is not read as a bug. Implementing it needs a reliable way to detect that a transfer happened, and the only candidate is the shape of `role: "tool"` messages in the conversation history — which `conversationMessagesToSegments` currently filters out and which is not documented in the SDK.

Rather than guess at a payload shape, capture a real transferred conversation during Task 3 Step 5, inspect its messages, then write this as its own small task. The rest of the feature does not depend on it.

---

## Self-Review

**Spec coverage:**
- Caller asks for a human, AI transfers when someone is online → Tasks 1–3 (tool + `agents_available` branch). ✅
- AI says nobody is available and takes a message otherwise → Task 3 Step 4 instructions, verified Step 6. ✅
- D7 availability via dynamic variables webhook at conversation start → Task 2. ✅
- D8 built-in transfer tool, single target → Task 3 Step 3. ✅
- D9 fail safe by default → Global Constraints, Task 2 tests 3–4, Task 3 Step 7. ✅
- D10 warm transfer briefing → Task 3 Step 3. ✅
- D11 instructions branch on `agents_available` → Task 3 Step 4. ✅
- D12 transcript still posts; transferred note → verified Task 3 Step 8.1; the note itself is explicitly deferred with a reason. ✅
- D13 no call-row lifecycle change → no existing file is modified. ✅
- Response wrapper gotcha → Global Constraints + Task 1 `wrapDynamicVariables` test. ✅
- Target cap as module constant → Task 1 (`MAX_TRANSFER_TARGETS = 5`, spec open question #5 recommendation). ✅
- Known limitation (answered-by attribution) → recorded in Task 3 Step 9; `name` is deliberately generic in Task 1. ✅
- Open question #1 (signature) → Task 3 Step 2 makes it a verification step with a concrete fallback. ✅
- Spec's "resolve brand from `to`" → explicitly dropped, with rationale, in Global Constraints. ✅

**Placeholder scan:** No TBD/TODO. Every code step carries complete code; every command carries expected output. The one deferred item names exactly what blocks it and how to unblock it. ✅

**Type consistency:** `ReachableAgent { userId, sipUsername }` matches `lib/telnyx/ring-all.ts:6`. `TransferVariables` / `TransferTarget` / `FAIL_SAFE_VARIABLES` / `MAX_TRANSFER_TARGETS` are defined in Task 1 and consumed with identical names in Task 2. `verifyTelnyxWebhook` argument names (`body`, `signature`, `timestamp`, `publicKeyBase64`) match `lib/telnyx/webhook.ts:13-18`. `getOnlineReachableAgents(admin)` matches its signature at `lib/telnyx/ring-all.ts:15`. Header names match `app/api/webhooks/telnyx/voice/route.ts:72-75`. ✅
