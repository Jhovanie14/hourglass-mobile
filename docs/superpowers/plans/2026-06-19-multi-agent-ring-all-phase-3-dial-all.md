# Multi-Agent Ring-All — Phase 3: Dial-All + Natural Ringback (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a call comes in, ring every online agent at once over native carrier ringback (never answer the caller leg during the ring); the first to answer is bridged, the rest are cancelled, and no-answer/none-online falls to the existing voicemail flow.

**Architecture:** A new `lib/telnyx/ring-all.ts` module holds the dependency-injected, unit-tested orchestration logic (resolve online+reachable agents, record/mark/query agent legs, atomic first-answer-wins claim). `voice-orchestrator.ts` gains the Telnyx action wrappers (`dialAgentLeg` per-agent, `hangupLeg`). The webhook route (`app/api/webhooks/telnyx/voice/route.ts`) is rewritten into a `calls.status` state machine: `call.initiated` fans out to all agents without answering A; an agent's `call.answered` atomically claims the win and answers A; A's own `call.answered` drives the bridge or the voicemail greeting; hangups handle cancellation and all-failed→voicemail. This phase also re-applies the per-agent SIP credential in the token endpoint (the Phase 1 wiring that was hotfix-reverted) so agents register and are dialed on their own identity together.

**Tech Stack:** TypeScript, Next.js route handlers, Telnyx Node SDK (`telnyx.calls.*`), Supabase service-role (admin) client, Vitest.

**Design:** `docs/superpowers/specs/2026-06-19-multi-agent-ring-all-phase-3-design.md`

---

## File Structure

- DB (Supabase dashboard, not in repo): new table `call_agent_legs` + RLS + 2 indexes. No in-repo migration tooling — SQL run in the Supabase SQL editor. `calls.status` gains a `ringing` value (no DDL; `status` is free text).
- `lib/telnyx/client-state.ts` — **modify**: add `userId` to `AgentLegState`.
- `lib/telnyx/ring-all.ts` — **create**: orchestration logic + agent-leg bookkeeping (DI'd, unit-tested).
- `lib/telnyx/ring-all.test.ts` — **create**: unit tests.
- `lib/telnyx/voice-orchestrator.ts` — **modify**: replace `dialAgent` with per-agent `dialAgentLeg` (returns the dialed leg id), add `hangupLeg`.
- `app/api/webhooks/telnyx/voice/route.ts` — **modify**: rewrite `handleCallInitiated` / `handleCallAnswered` / `handleCallHangup` into the state machine.
- `app/api/calls/webrtc-token/route.ts` — **modify**: re-apply per-agent credential (uses the `getRequestUserId` added in Phase 2 + `getOrCreateAgentCredential` from Phase 1).

---

## Task 1: Create the `call_agent_legs` table (Supabase dashboard)

**This is a manual step — not a git commit.** Run SQL in the Supabase SQL editor. Do this just before deploying Phase 3 (deploy-ordering rule).

- [ ] **Step 1: Run the table + RLS + index SQL**

Supabase dashboard → SQL Editor → New query, paste and run:

```sql
create table if not exists public.call_agent_legs (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  agent_leg_id text not null,
  user_id uuid not null,
  status text not null default 'ringing',  -- ringing | answered | failed
  created_at timestamptz not null default now()
);

-- Server-only: enable RLS, add NO policies (service-role admin client bypasses RLS).
alter table public.call_agent_legs enable row level security;

-- Hot-path indexes (every agent-leg webhook touches this table).
create index if not exists call_agent_legs_call_id_idx
  on public.call_agent_legs(call_id);
create index if not exists call_agent_legs_agent_leg_id_idx
  on public.call_agent_legs(agent_leg_id);
```

- [ ] **Step 2: Verify the table exists and is locked down**

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' and tablename = 'call_agent_legs';
```

Expected: one row, `rowsecurity = true`.

- [ ] **Step 3: Verify clients cannot read it**

```bash
set -a; source .env.local; set +a
curl -s "$NEXT_PUBLIC_SUPABASE_URL/rest/v1/call_agent_legs?select=id" \
  -H "apikey: $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" \
  -H "Authorization: Bearer $NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
```

Expected: `[]` (RLS hides rows), NOT a permission error and NOT a list of rows.

---

## Task 2: Add `userId` to the agent-leg client state

**Files:**
- Modify: `lib/telnyx/client-state.ts`
- Test: `lib/telnyx/client-state.test.ts` (exists)

- [ ] **Step 1: Add a failing test**

Append to `lib/telnyx/client-state.test.ts`:

```ts
import { encodeClientState, decodeClientState } from "./client-state"

describe("client-state userId", () => {
  it("round-trips userId on the agent leg state", () => {
    const encoded = encodeClientState({
      role: "agent",
      aLegId: "a-1",
      callId: "call-1",
      userId: "user-1",
    })
    expect(decodeClientState(encoded)).toEqual({
      role: "agent",
      aLegId: "a-1",
      callId: "call-1",
      userId: "user-1",
    })
  })
})
```

> If `client-state.test.ts` already imports `describe/it/expect` and the functions, do not duplicate the imports — only add the new `describe` block.

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- client-state`
Expected: FAIL — type error / `userId` missing from `AgentLegState` (decode drops it).

- [ ] **Step 3: Add `userId` to the type**

In `lib/telnyx/client-state.ts`, change `AgentLegState`:

```ts
export type AgentLegState = {
  role: "agent"
  aLegId: string // caller leg call_control_id
  callId: string // calls.id in our DB
  userId: string // which agent this leg targets (agent_sip_credentials.user_id)
}
```

(The existing `decodeClientState` already returns `parsed as AgentLegState`, so it passes `userId` through unchanged — no further edit needed there.)

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test -- client-state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/telnyx/client-state.ts lib/telnyx/client-state.test.ts
git commit -m "feat: carry userId in agent-leg client_state"
```

---

## Task 3: Ring-all orchestration module

**Files:**
- Create: `lib/telnyx/ring-all.ts`
- Test: `lib/telnyx/ring-all.test.ts`

This module is pure logic + DB access via the injected admin client (same mock style as `agent-credentials.test.ts` / `presence.test.ts`). It does **not** call Telnyx — the Telnyx actions live in `voice-orchestrator.ts` (Task 4).

- [ ] **Step 1: Write the failing tests**

Create `lib/telnyx/ring-all.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest"
import {
  getOnlineReachableAgents,
  recordAgentLegs,
  claimCall,
  markLegAnswered,
  markLegFailedIfRinging,
  getRingingAgentLegIds,
  getAnsweredAgentLegId,
} from "./ring-all"

// Chainable Supabase-admin mock. Each call returns `this` until a terminal
// (await) — terminals resolve to { data, error }. Per-table behavior is keyed
// by the table name passed to from().
function makeAdmin(opts: {
  online?: { user_id: string }[] // agent_presence rows
  creds?: { user_id: string; sip_username: string }[] // agent_sip_credentials rows
  claimRows?: { id: string }[] // rows returned by the conditional UPDATE
  ringing?: { agent_leg_id: string }[] // ringing call_agent_legs rows
  answered?: { agent_leg_id: string }[] // answered call_agent_legs rows
}) {
  const insert = vi.fn().mockResolvedValue({ error: null })

  // presence: from('agent_presence').select('user_id').gte(...) -> online
  const presenceGte = vi.fn().mockResolvedValue({ data: opts.online ?? [], error: null })
  const presenceSelect = vi.fn(() => ({ gte: presenceGte }))

  // credentials: from('agent_sip_credentials').select(...).in('user_id', ids) -> creds
  const credsIn = vi.fn().mockResolvedValue({ data: opts.creds ?? [], error: null })
  const credsSelect = vi.fn(() => ({ in: credsIn }))

  // claim: from('calls').update(...).eq('telnyx_call_id', x).eq('status','ringing').select('id')
  const claimSelect = vi.fn().mockResolvedValue({ data: opts.claimRows ?? [], error: null })
  const claimEq2 = vi.fn(() => ({ select: claimSelect }))
  const claimEq1 = vi.fn(() => ({ eq: claimEq2 }))
  const update = vi.fn(() => ({ eq: claimEq1 }))

  // legs SELECTs: from('call_agent_legs').select('agent_leg_id').eq('call_id',c).eq('status',s)
  // Return ringing or answered depending on the status filter.
  const legsEqStatus = vi.fn((_col: string, status: string) =>
    Promise.resolve({
      data: status === "answered" ? opts.answered ?? [] : opts.ringing ?? [],
      error: null,
    })
  )
  const legsEqCall = vi.fn(() => ({ eq: legsEqStatus }))
  const legsSelect = vi.fn(() => ({ eq: legsEqCall }))

  // legs UPDATEs: from('call_agent_legs').update({status}).eq('agent_leg_id', id)[.eq('status','ringing')]
  const legUpdateEq2 = vi.fn().mockResolvedValue({ error: null })
  const legUpdateEq1 = vi.fn(() => ({ eq: legUpdateEq2, then: undefined }))
  const legUpdate = vi.fn(() => ({ eq: legUpdateEq1 }))

  const from = vi.fn((table: string) => {
    if (table === "agent_presence") return { select: presenceSelect }
    if (table === "agent_sip_credentials") return { select: credsSelect }
    if (table === "calls") return { update }
    if (table === "call_agent_legs") return { insert, select: legsSelect, update: legUpdate }
    throw new Error("unexpected table " + table)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, insert, update, from, credsIn, presenceGte, legUpdate }
}

describe("getOnlineReachableAgents", () => {
  it("returns only online agents that also have a credential", async () => {
    const admin = makeAdmin({
      online: [{ user_id: "a" }, { user_id: "b" }],
      creds: [{ user_id: "a", sip_username: "gencredA" }],
    })
    const result = await getOnlineReachableAgents(admin.client, new Date())
    expect(result).toEqual([{ userId: "a", sipUsername: "gencredA" }])
  })

  it("returns [] when nobody is online (and does not query credentials)", async () => {
    const admin = makeAdmin({ online: [], creds: [{ user_id: "a", sip_username: "x" }] })
    const result = await getOnlineReachableAgents(admin.client, new Date())
    expect(result).toEqual([])
    expect(admin.credsIn).not.toHaveBeenCalled()
  })
})

describe("recordAgentLegs", () => {
  it("inserts one row per dialed leg", async () => {
    const admin = makeAdmin({})
    await recordAgentLegs(admin.client, "call-1", [
      { agentLegId: "b1", userId: "a" },
      { agentLegId: "b2", userId: "b" },
    ])
    expect(admin.insert).toHaveBeenCalledWith([
      { call_id: "call-1", agent_leg_id: "b1", user_id: "a", status: "ringing" },
      { call_id: "call-1", agent_leg_id: "b2", user_id: "b", status: "ringing" },
    ])
  })

  it("does nothing when there are no legs", async () => {
    const admin = makeAdmin({})
    await recordAgentLegs(admin.client, "call-1", [])
    expect(admin.insert).not.toHaveBeenCalled()
  })
})

describe("claimCall", () => {
  it("returns true when the conditional update flips a ringing call", async () => {
    const admin = makeAdmin({ claimRows: [{ id: "call-1" }] })
    expect(await claimCall(admin.client, "a-leg")).toBe(true)
  })

  it("returns false when no ringing call matched (already claimed)", async () => {
    const admin = makeAdmin({ claimRows: [] })
    expect(await claimCall(admin.client, "a-leg")).toBe(false)
  })
})

describe("getRingingAgentLegIds / getAnsweredAgentLegId", () => {
  it("lists ringing leg ids for a call", async () => {
    const admin = makeAdmin({ ringing: [{ agent_leg_id: "b1" }, { agent_leg_id: "b2" }] })
    expect(await getRingingAgentLegIds(admin.client, "call-1")).toEqual(["b1", "b2"])
  })

  it("returns the answered leg id, or null when none", async () => {
    const won = makeAdmin({ answered: [{ agent_leg_id: "b9" }] })
    expect(await getAnsweredAgentLegId(won.client, "call-1")).toBe("b9")
    const none = makeAdmin({ answered: [] })
    expect(await getAnsweredAgentLegId(none.client, "call-1")).toBeNull()
  })
})

describe("markLegAnswered / markLegFailedIfRinging", () => {
  it("marks a leg answered by its leg id", async () => {
    const admin = makeAdmin({})
    await markLegAnswered(admin.client, "b1")
    expect(admin.from).toHaveBeenCalledWith("call_agent_legs")
    expect(admin.legUpdate).toHaveBeenCalledWith({ status: "answered" })
  })

  it("marks a leg failed only if still ringing", async () => {
    const admin = makeAdmin({})
    await markLegFailedIfRinging(admin.client, "b1")
    expect(admin.legUpdate).toHaveBeenCalledWith({ status: "failed" })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- ring-all`
Expected: FAIL — module `./ring-all` does not exist.

- [ ] **Step 3: Implement the module**

Create `lib/telnyx/ring-all.ts`:

```ts
import type { createAdminClient } from "@/lib/admin"
import { getOnlineAgentUserIds } from "./presence"

type Admin = ReturnType<typeof createAdminClient>

export type ReachableAgent = { userId: string; sipUsername: string }

/**
 * Agents who are both online (fresh presence) AND reachable (have a SIP
 * credential). Only these can be dialed. Reuses the Phase 2 presence window.
 */
export async function getOnlineReachableAgents(
  admin: Admin,
  now: Date = new Date()
): Promise<ReachableAgent[]> {
  const onlineIds = await getOnlineAgentUserIds(admin, now)
  if (onlineIds.length === 0) return []

  const { data, error } = await admin
    .from("agent_sip_credentials")
    .select("user_id, sip_username")
    .in("user_id", onlineIds)
  if (error) throw error

  return (data ?? []).map((r: { user_id: string; sip_username: string }) => ({
    userId: r.user_id,
    sipUsername: r.sip_username,
  }))
}

/** Insert one ringing call_agent_legs row per dialed leg. No-op if empty. */
export async function recordAgentLegs(
  admin: Admin,
  callId: string,
  legs: { agentLegId: string; userId: string }[]
): Promise<void> {
  if (legs.length === 0) return
  const { error } = await admin.from("call_agent_legs").insert(
    legs.map((l) => ({
      call_id: callId,
      agent_leg_id: l.agentLegId,
      user_id: l.userId,
      status: "ringing",
    }))
  )
  if (error) throw error
}

/**
 * First-answer-wins lock. Atomically flip the caller call from `ringing` to
 * `answered`. Returns true iff THIS call won (a row was updated). Concurrent
 * agents racing here: Postgres serializes the row update, so exactly one sees
 * status='ringing' and wins; the rest get zero rows.
 */
export async function claimCall(
  admin: Admin,
  aLegId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { data, error } = await admin
    .from("calls")
    .update({ status: "answered", started_at: now.toISOString() })
    .eq("telnyx_call_id", aLegId)
    .eq("status", "ringing")
    .select("id")
  if (error) throw error
  return (data ?? []).length > 0
}

export async function markLegAnswered(admin: Admin, agentLegId: string): Promise<void> {
  const { error } = await admin
    .from("call_agent_legs")
    .update({ status: "answered" })
    .eq("agent_leg_id", agentLegId)
  if (error) throw error
}

/** Mark a still-ringing leg failed. An already-answered leg is left alone. */
export async function markLegFailedIfRinging(admin: Admin, agentLegId: string): Promise<void> {
  const { error } = await admin
    .from("call_agent_legs")
    .update({ status: "failed" })
    .eq("agent_leg_id", agentLegId)
    .eq("status", "ringing")
  if (error) throw error
}

/** Leg ids still ringing for a call (used to cancel siblings / detect all-failed). */
export async function getRingingAgentLegIds(admin: Admin, callId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("call_agent_legs")
    .select("agent_leg_id")
    .eq("call_id", callId)
    .eq("status", "ringing")
  if (error) throw error
  return (data ?? []).map((r: { agent_leg_id: string }) => r.agent_leg_id)
}

/** The winning (answered) leg id for a call, or null. */
export async function getAnsweredAgentLegId(admin: Admin, callId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("call_agent_legs")
    .select("agent_leg_id")
    .eq("call_id", callId)
    .eq("status", "answered")
  if (error) throw error
  return (data ?? [])[0]?.agent_leg_id ?? null
}
```

> Note on the test mock: `markLegFailedIfRinging` chains a second `.eq(...)` after the first. The mock's `legUpdateEq1` returns an object whose `.eq` (`legUpdateEq2`) resolves to `{ error: null }`, and `legUpdateEq1` itself is awaitable-compatible because `markLegAnswered` awaits after a single `.eq`. If the single-`.eq` await fails in your runtime, make `legUpdateEq1` a thenable returning `{ error: null }`. Keep the production code as written; adjust only the mock.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- ring-all`
Expected: PASS (all describe blocks green). If a chained-mock assertion fails, fix the **mock** (not the module) per the note above, then re-run.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/telnyx/ring-all.ts lib/telnyx/ring-all.test.ts
git commit -m "feat: ring-all orchestration module (resolve agents, legs, first-answer-wins)"
```

---

## Task 4: Per-agent dial + hangup Telnyx wrappers

**Files:**
- Modify: `lib/telnyx/voice-orchestrator.ts`
- Test: `lib/telnyx/voice-orchestrator.test.ts` (**create** — the old one was deleted in the ringback revert `29d34e7`)

`dialAgent` currently dials the single shared `TELNYX_SIP_USERNAME` and returns nothing. Replace it with `dialAgentLeg`, which dials a **specific** agent's SIP username, carries `userId` in client_state, and **returns the dialed leg's call_control_id** (needed to record the leg). Add `hangupLeg` for cancelling siblings/losers.

- [ ] **Step 1: Write failing tests**

Create `lib/telnyx/voice-orchestrator.test.ts` (it does not currently exist):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock is hoisted above imports, so the spies it references must come from
// vi.hoisted (also hoisted) — a plain `const dial = vi.fn()` would be in the
// temporal dead zone when the factory runs.
const { dial, hangup } = vi.hoisted(() => ({ dial: vi.fn(), hangup: vi.fn() }))
vi.mock("./client", () => ({
  getTelnyxClient: () => ({ calls: { dial, actions: { hangup } } }),
  withRetry: (fn: () => unknown) => fn(),
}))

import { dialAgentLeg, hangupLeg } from "./voice-orchestrator"
import { decodeClientState } from "./client-state"

beforeEach(() => {
  dial.mockReset()
  hangup.mockReset()
  process.env.TELNYX_VOICE_APP_ID = "app-1"
})

describe("dialAgentLeg", () => {
  it("dials the agent's own SIP username and returns the new leg id", async () => {
    dial.mockResolvedValue({ data: { call_control_id: "b-leg-1" } })

    const legId = await dialAgentLeg({
      aLegId: "a-1",
      callId: "call-1",
      didNumber: "+18326501126",
      callerNumber: "+15551234567",
      sipUsername: "gencredXYZ",
      userId: "user-1",
    })

    expect(legId).toBe("b-leg-1")
    const arg = dial.mock.calls[0][0]
    expect(arg.to).toBe("sip:gencredXYZ@sip.telnyx.com")
    expect(arg.from).toBe("+18326501126")
    expect(arg.connection_id).toBe("app-1")
    expect(decodeClientState(arg.client_state)).toEqual({
      role: "agent",
      aLegId: "a-1",
      callId: "call-1",
      userId: "user-1",
    })
  })
})

describe("hangupLeg", () => {
  it("hangs up the given call_control_id", async () => {
    hangup.mockResolvedValue({})
    await hangupLeg("b-leg-9")
    expect(hangup).toHaveBeenCalledWith("b-leg-9", expect.objectContaining({}))
  })
})
```

> This is a fresh test file. `vi.mock("./client", …)` is hoisted by Vitest, so the `dial`/`hangup` spies declared above it are in scope inside the factory. `withRetry` is stubbed to call through (`(fn) => fn()`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- voice-orchestrator`
Expected: FAIL — `dialAgentLeg` / `hangupLeg` not exported.

- [ ] **Step 3: Implement the wrappers**

In `lib/telnyx/voice-orchestrator.ts`, **replace** the whole `dialAgent` function with `dialAgentLeg`, and add `hangupLeg`:

```ts
/** Dial ONE agent's own SIP credential as a tagged leg B. Returns the dialed
 *  leg's call_control_id so the caller can record it in call_agent_legs.
 *  `from` MUST be the owned DID the customer dialed (un-owned `from` is
 *  rejected); the caller's number is shown via from_display_name. */
export async function dialAgentLeg(params: {
  aLegId: string
  callId: string
  didNumber: string // owned DID the customer dialed (payload.to)
  callerNumber: string // customer's number, shown as caller ID
  sipUsername: string // THIS agent's sip_username (agent_sip_credentials)
  userId: string // THIS agent's user_id
}): Promise<string> {
  const telnyx = getTelnyxClient()
  const appId = process.env.TELNYX_VOICE_APP_ID
  if (!appId) throw new Error("TELNYX_VOICE_APP_ID not set")

  const displayName = sanitizeDisplayName(params.callerNumber)

  const res = await withRetry(() =>
    telnyx.calls.dial({
      connection_id: appId,
      to: `sip:${params.sipUsername}@sip.telnyx.com`,
      from: params.didNumber,
      ...(displayName ? { from_display_name: displayName } : {}),
      timeout_secs: 25,
      command_id: commandId(),
      client_state: encodeClientState({
        role: "agent",
        aLegId: params.aLegId,
        callId: params.callId,
        userId: params.userId,
      }),
    })
  )

  const legId = (res as { data?: { call_control_id?: string } })?.data?.call_control_id
  if (!legId) throw new Error("Telnyx dial response missing call_control_id")
  return legId
}

/** Hang up a single leg (cancel a ringing sibling or a losing agent leg). */
export async function hangupLeg(callControlId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() => telnyx.calls.actions.hangup(callControlId, { command_id: commandId() }))
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- voice-orchestrator`
Expected: PASS.

- [ ] **Step 5: Typecheck (will fail until the route is updated)**

Run: `npm run typecheck`
Expected: errors ONLY in `app/api/webhooks/telnyx/voice/route.ts` (it still imports/calls the removed `dialAgent`). That is fixed in Task 5. If errors appear elsewhere, address them now.

- [ ] **Step 6: Commit**

```bash
git add lib/telnyx/voice-orchestrator.ts lib/telnyx/voice-orchestrator.test.ts
git commit -m "feat: per-agent dialAgentLeg (returns leg id) + hangupLeg"
```

---

## Task 5: Rewrite the webhook into the state machine

**Files:**
- Modify: `app/api/webhooks/telnyx/voice/route.ts`

This wires the tested module functions into the `calls.status` state machine from the spec. The route itself isn't unit-tested (it needs signature verification + live Telnyx/Supabase, matching the project's existing approach); correctness rests on the Task 3/4 unit tests + typecheck + the Task 7 manual matrix.

- [ ] **Step 1: Update imports**

At the top of `app/api/webhooks/telnyx/voice/route.ts`, replace the `voice-orchestrator` import block and add the ring-all import:

```ts
import {
  answerCaller,
  dialAgentLeg,
  hangupLeg,
  bridgeLegs,
  startVoicemail,
  DEFAULT_GREETING,
} from "@/lib/telnyx/voice-orchestrator"
import {
  getOnlineReachableAgents,
  recordAgentLegs,
  claimCall,
  markLegAnswered,
  markLegFailedIfRinging,
  getRingingAgentLegIds,
  getAnsweredAgentLegId,
} from "@/lib/telnyx/ring-all"
```

- [ ] **Step 2: Rewrite `handleCallInitiated` (inbound branch only)**

Keep the agent-leg guard and the outbound-softphone branch exactly as they are. Replace the **inbound caller leg (A)** section (from the `// Inbound caller leg (A)` comment to the end of the function) with:

```ts
  // Inbound caller leg (A): log it as `ringing`, then fan out to all online
  // agents WITHOUT answering A (so the carrier plays native ringback). A is
  // answered only when an agent wins (to bridge) or when we fall to voicemail.
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
      status: "ringing",
      telnyx_call_id: payload.call_control_id,
    },
    { onConflict: "telnyx_call_id", ignoreDuplicates: true }
  )

  const { data: call } = await supabase
    .from("calls")
    .select("id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) {
    console.error("⚠️ Inbound call row missing right after upsert:", payload.call_control_id)
    return
  }

  const agents = await getOnlineReachableAgents(supabase)

  if (agents.length === 0) {
    // Nobody to ring → voicemail. Mark, then answer A; greeting plays on A's answered.
    await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)
    try {
      await answerCaller(payload.call_control_id)
    } catch (err) {
      console.error("⚠️ Failed to answer caller for voicemail (no agents):", err)
    }
    return
  }

  // Dial all agents in parallel; record the legs that actually got dialed.
  const results = await Promise.allSettled(
    agents.map((a) =>
      dialAgentLeg({
        aLegId: payload.call_control_id,
        callId: call.id,
        didNumber: payload.to,
        callerNumber: payload.from,
        sipUsername: a.sipUsername,
        userId: a.userId,
      }).then((agentLegId) => ({ agentLegId, userId: a.userId }))
    )
  )

  const dialed = results
    .filter((r): r is PromiseFulfilledResult<{ agentLegId: string; userId: string }> =>
      r.status === "fulfilled"
    )
    .map((r) => r.value)

  if (dialed.length === 0) {
    // Every dial failed → voicemail.
    await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)
    try {
      await answerCaller(payload.call_control_id)
    } catch (err) {
      console.error("⚠️ Failed to answer caller for voicemail (all dials failed):", err)
    }
    return
  }

  await recordAgentLegs(supabase, call.id, dialed)
```

- [ ] **Step 3: Rewrite `handleCallAnswered`**

Replace the whole function with:

```ts
async function handleCallAnswered(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const agentState = decodeClientState(payload.client_state)

  // An agent (leg B) picked up → try to claim the caller. First-answer-wins.
  if (agentState?.role === "agent") {
    const won = await claimCall(supabase, agentState.aLegId)
    if (!won) {
      // Someone else already won → drop this losing leg.
      try {
        await hangupLeg(payload.call_control_id)
      } catch (err) {
        console.error("⚠️ Failed to hang up losing agent leg:", err)
      }
      return
    }

    // Winner: record it, cancel siblings, then answer A. The bridge is issued
    // when A's own call.answered arrives (below).
    await markLegAnswered(supabase, payload.call_control_id)
    const ringing = await getRingingAgentLegIds(supabase, agentState.callId)
    await Promise.allSettled(
      ringing
        .filter((legId) => legId !== payload.call_control_id)
        .map((legId) => hangupLeg(legId))
    )
    try {
      await answerCaller(agentState.aLegId)
    } catch (err) {
      console.error("⚠️ Failed to answer caller after agent won:", err)
    }
    return
  }

  // Caller leg (A) was answered by us. What happens next depends on status.
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, phone_numbers(voicemail_greeting)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) return

  if (call.status === "answered") {
    // A winner is waiting → bridge A to the answered agent leg.
    const agentLeg = await getAnsweredAgentLegId(supabase, call.id)
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
    // Winner vanished or bridge failed → voicemail on the (already answered) A.
    await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)
    await speakGreeting(supabase, payload.call_control_id, call)
    return
  }

  if (call.status === "voicemail") {
    await speakGreeting(supabase, payload.call_control_id, call)
  }
}

/** Resolve the per-number greeting and speak it on the answered caller leg. */
async function speakGreeting(
  _supabase: SupabaseClient,
  aLegId: string,
  call: { phone_numbers?: unknown }
) {
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

- [ ] **Step 4: Rewrite the agent branch of `handleCallHangup`; add sibling-cancel to the caller branch**

Replace the **agent-leg** block at the top of `handleCallHangup` with:

```ts
  // Agent leg (B) ended. Mark it failed (if it was still ringing); if no legs
  // are ringing and nobody won, the caller falls to voicemail.
  if (agentState?.role === "agent") {
    await markLegFailedIfRinging(supabase, payload.call_control_id)

    const stillRinging = await getRingingAgentLegIds(supabase, agentState.callId)
    if (stillRinging.length > 0) return

    const { data: callerCall } = await supabase
      .from("calls")
      .select("id, status")
      .eq("telnyx_call_id", agentState.aLegId)
      .maybeSingle()
    if (callerCall?.status === "ringing") {
      await supabase.from("calls").update({ status: "voicemail" }).eq("id", callerCall.id)
      try {
        await answerCaller(agentState.aLegId)
      } catch (err) {
        console.error("⚠️ Failed to answer caller for voicemail (all agents failed):", err)
      }
    }
    return
  }
```

Then, in the **caller-leg (A)** section of `handleCallHangup`, immediately after the `call` lookup (the `select("id, status, started_at, direction, phone_number_id")`), add sibling cancellation for the hung-up-during-ring case:

```ts
  // Caller hung up while still ringing → cancel any agent legs still ringing.
  if (call?.status === "ringing" && call?.id) {
    const ringing = await getRingingAgentLegIds(supabase, call.id)
    await Promise.allSettled(ringing.map((legId) => hangupLeg(legId)))
  }
```

> The existing status-finalization logic below it already maps a non-answered inbound call to `missed` (now reached from `status='ringing'` instead of `'initiated'`) — leave it unchanged.

- [ ] **Step 5: Delete the now-unused `beginVoicemail` if nothing references it**

Search: `grep -n "beginVoicemail" app/api/webhooks/telnyx/voice/route.ts`
The rewrite replaces every caller-path use with the `status='voicemail'` + `answerCaller` + `speakGreeting` flow. If `beginVoicemail` has **zero** remaining references, delete the function. If any reference remains, leave it. (The `call.speak.ended` and `call.recording.saved` handlers are unchanged and do not use it.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors (the Task 4 dangling `dialAgent` reference is now resolved).

- [ ] **Step 7: Full test suite + lint**

Run: `npm test`
Expected: PASS (all suites, including the new ring-all and updated voice-orchestrator tests).
Run: `npx eslint app/api/webhooks/telnyx/voice/route.ts lib/telnyx/ring-all.ts lib/telnyx/voice-orchestrator.ts`
Expected: no NEW errors in these files.

- [ ] **Step 8: Commit**

```bash
git add app/api/webhooks/telnyx/voice/route.ts
git commit -m "feat: ring-all webhook state machine (fan-out, first-answer-wins, natural ringback)"
```

---

## Task 6: Re-apply per-agent SIP credential in the token endpoint

**Files:**
- Modify: `app/api/calls/webrtc-token/route.ts`

This restores the Phase 1 wiring that was hotfix-reverted (`868bd95`). It MUST ship with the dial change above — agents must register on the same per-agent identity that `dialAgentLeg` dials. Uses `getRequestUserId` (added in Phase 2) + `getOrCreateAgentCredential` (Phase 1).

- [ ] **Step 1: Replace the route with the per-agent version**

Replace the entire contents of `app/api/calls/webrtc-token/route.ts` with:

```ts
import { getRequestUserId } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"
import { getTelnyxClient } from "@/lib/telnyx/client"
import { getOrCreateAgentCredential } from "@/lib/telnyx/agent-credentials"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const connectionId = process.env.TELNYX_CREDENTIAL_CONNECTION_ID
  if (!connectionId) {
    return Response.json({ error: "TELNYX_CREDENTIAL_CONNECTION_ID not set" }, { status: 500 })
  }

  try {
    const admin = createAdminClient()
    const telnyx = getTelnyxClient()
    const { login, password } = await getOrCreateAgentCredential(
      admin,
      telnyx,
      userId,
      connectionId
    )
    return Response.json({ login, password })
  } catch (err) {
    console.error("⚠️ Failed to provision/return agent SIP credential:", err)
    return Response.json({ error: "Failed to obtain credential" }, { status: 500 })
  }
}
```

- [ ] **Step 2: Typecheck + tests**

Run: `npm run typecheck && npm test`
Expected: no type errors; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add app/api/calls/webrtc-token/route.ts
git commit -m "feat: webrtc-token returns each agent's own SIP credential (re-apply Phase 1)"
```

---

## Task 7: Manual verification (deployed)

Real Telnyx calls + live DB. **Run Task 1's SQL in Supabase BEFORE deploying this branch.** Then deploy (merge to main → Vercel) and run the matrix. Use 2–3 browsers signed in as distinct agents (each opens the dialer so it registers AND heartbeats presence).

- [ ] **Step 1: Two agents both register on their own credential**
  - Sign in as agent A and agent B (separate browser profiles), open the dialer in each.
  - DB: `select user_id, sip_username from agent_sip_credentials;` → distinct row per agent.
  - DB: `select user_id, last_seen_at from agent_presence;` → both fresh (advancing ~15s).

- [ ] **Step 2: Ring-all + natural ringback**
  - Call a routed DID. Expected: **caller hears continuous ringing (no dead air)**; BOTH agents' phones ring.
  - DB during ring: `select agent_leg_id, user_id, status from call_agent_legs where call_id = '<id>';` → two `ringing` rows. `select status from calls where telnyx_call_id='<A>';` → `ringing`.

- [ ] **Step 3: First answer wins**
  - Agent A answers. Expected: A is bridged to the caller; B stops ringing.
  - DB: the call → `answered`; A's leg `answered`, B's leg `failed` (cancelled). Talk path works both ways.

- [ ] **Step 4: A different agent can win**
  - Place a second call; this time agent B answers. Expected: B bridged, A stops. Confirms it isn't pinned to one agent.

- [ ] **Step 5: No answer → voicemail (the original bug)**
  - Call; neither agent answers. Expected: caller hears ringing for ~25s, then the **voicemail greeting**, then the beep, and can leave a message.
  - DB: call → `voicemail`, then a `voicemails` row + `has_voicemail = true`. **No "rings forever" and no dead-air.**

- [ ] **Step 6: Zero online → immediate voicemail**
  - All agents close their tabs (wait >30s for presence to go stale). Call. Expected: greeting comes quickly (no 25s ring), message records.

- [ ] **Step 7: Caller hangs up mid-ring → missed**
  - Call, let it ring, hang up before any agent answers. Expected: both agent legs stop ringing; call logged `missed`; a missed-call notification appears.

---

## Self-Review Notes

- **Spec coverage:** `call.initiated` fan-out without answering A (Task 5 Step 2); online⋈reachable resolver (Task 3); per-agent dial on own SIP identity (Task 4) + credential re-apply (Task 6); first-answer-wins atomic claim (Task 3 `claimCall`, wired Task 5 Step 3); sibling cancellation (Task 5 Steps 3 & 4); A's `call.answered` drives bridge/greeting via `calls.status` (Task 5 Step 3); all-failed/none-online → voicemail (Task 5 Steps 2 & 4); unchanged greeting/recording path (untouched `call.speak.ended` / `call.recording.saved`); `call_agent_legs` table + RLS + indexes (Task 1); `userId` in client_state (Task 2); manual matrix incl. dead-air + voicemail (Task 7).
- **Placeholder scan:** none — every code step shows complete code.
- **Type consistency:** `dialAgentLeg(...)` returns `Promise<string>` (leg id) and is consumed as `agentLegId` in Task 5; `getOnlineReachableAgents` → `{ userId, sipUsername }[]` matches `dialAgentLeg`'s `sipUsername`/`userId` params; `AgentLegState` gains `userId` (Task 2) and is encoded by `dialAgentLeg` (Task 4) / decoded in the route (Task 5); `claimCall` → `boolean`; `getAnsweredAgentLegId` → `string | null` consumed with a null check.
- **Ordering:** Task 1 (DB) must precede deploy. Tasks 4–6 must deploy together (per-agent register + dial + the table). All code tasks land on one branch `feat/multi-agent-ring-all-phase-3` → single PR → create table → merge → Task 7.
