# Ringback While Dialing the Agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Play a ringback tone to the inbound caller while the agent's leg is ringing, so the caller hears ringing instead of silence and stays on the line until pickup or voicemail.

**Architecture:** The Telnyx Voice API (Call Control) flow answers the caller leg early to orchestrate dial → bridge → voicemail, which kills carrier ringback. We restore it by bridging the caller leg to the agent leg *at dial time* with `play_ringtone: true`; Telnyx then plays ringback to the caller while the (not-yet-answered) agent leg rings. When the agent answers, the bridge completes; when the agent times out, the existing hangup handler still routes to voicemail.

**Tech Stack:** TypeScript, Next.js (App Router) route handler, Telnyx Node SDK, Vitest.

---

## File Structure

- `lib/telnyx/voice-orchestrator.ts` (modify) — `dialAgent` returns the agent leg id; `bridgeLegs` gains an optional `{ playRingtone }`.
- `lib/telnyx/voice-orchestrator.test.ts` (create) — unit tests for the two changed functions. (Vitest only includes `lib/**/*.test.ts`, so this is the only place these get unit coverage.)
- `app/api/webhooks/telnyx/voice/route.ts` (modify) — bridge early in `handleCallAnswered`; on agent answer, just update status (no second bridge). Not unit-tested (lives under `app/`, outside the vitest include); verified by `typecheck` + the manual real-call test plan.

---

## Task 1: Orchestrator — return agent leg id and support `play_ringtone`

**Files:**
- Modify: `lib/telnyx/voice-orchestrator.ts`
- Test: `lib/telnyx/voice-orchestrator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/telnyx/voice-orchestrator.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

// vi.mock is hoisted; use vi.hoisted so the spies exist when the factory runs.
const { dial, bridge } = vi.hoisted(() => ({ dial: vi.fn(), bridge: vi.fn() }))

vi.mock("./client", () => ({
  getTelnyxClient: () => ({ calls: { dial, actions: { bridge } } }),
  withRetry: (fn: () => Promise<unknown>) => fn(),
}))

import { dialAgent, bridgeLegs } from "./voice-orchestrator"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELNYX_SIP_USERNAME = "agent-sip-user"
  process.env.TELNYX_VOICE_APP_ID = "app-123"
})

describe("dialAgent", () => {
  const params = {
    aLegId: "caller-leg-1",
    callId: "db-1",
    didNumber: "+18326501126",
    callerNumber: "+15551234567",
  }

  it("returns the dialed agent leg's call_control_id", async () => {
    dial.mockResolvedValue({ data: { call_control_id: "agent-leg-xyz" } })
    const id = await dialAgent(params)
    expect(id).toBe("agent-leg-xyz")
  })

  it("throws if the dial response has no call_control_id", async () => {
    dial.mockResolvedValue({ data: {} })
    await expect(dialAgent(params)).rejects.toThrow(/call_control_id/)
  })
})

describe("bridgeLegs", () => {
  it("sends play_ringtone when requested", async () => {
    bridge.mockResolvedValue({})
    await bridgeLegs("caller-leg-1", "agent-leg-xyz", { playRingtone: true })
    expect(bridge).toHaveBeenCalledWith(
      "caller-leg-1",
      expect.objectContaining({
        call_control_id_to_bridge_with: "agent-leg-xyz",
        play_ringtone: true,
      })
    )
  })

  it("omits play_ringtone by default", async () => {
    bridge.mockResolvedValue({})
    await bridgeLegs("caller-leg-1", "agent-leg-xyz")
    expect(bridge.mock.calls[0][1]).not.toHaveProperty("play_ringtone")
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- voice-orchestrator`
Expected: FAIL — `dialAgent` returns `undefined` (not `"agent-leg-xyz"`) and never throws; `bridgeLegs` doesn't accept a third arg / never sends `play_ringtone`.

- [ ] **Step 3: Change `dialAgent` to return the agent leg id**

In `lib/telnyx/voice-orchestrator.ts`, change the `dialAgent` signature from `Promise<void>` to `Promise<string>` and capture the dial response. Replace the existing `await withRetry(() => telnyx.calls.dial({ ... }))` call so the result is captured and the leg id returned:

```ts
export async function dialAgent(params: {
  aLegId: string
  callId: string
  didNumber: string // owned DID the customer dialed (payload.to)
  callerNumber: string // customer's number, shown as caller ID
}): Promise<string> {
  const telnyx = getTelnyxClient()
  const sipUser = process.env.TELNYX_SIP_USERNAME
  const appId = process.env.TELNYX_VOICE_APP_ID
  if (!sipUser || !appId) throw new Error("TELNYX_SIP_USERNAME or TELNYX_VOICE_APP_ID not set")

  const displayName = sanitizeDisplayName(params.callerNumber)

  const res = await withRetry(() =>
    telnyx.calls.dial({
      connection_id: appId,
      to: `sip:${sipUser}@sip.telnyx.com`,
      from: params.didNumber, // owned DID — required, un-owned `from` is rejected
      ...(displayName ? { from_display_name: displayName } : {}),
      timeout_secs: 25,
      command_id: commandId(),
      client_state: encodeClientState({
        role: "agent",
        aLegId: params.aLegId,
        callId: params.callId,
      }),
    })
  )

  const agentLegId = res?.data?.call_control_id
  if (!agentLegId) throw new Error("dialAgent: no call_control_id in Telnyx dial response")
  return agentLegId
}
```

- [ ] **Step 4: Add the `playRingtone` option to `bridgeLegs`**

Replace the existing `bridgeLegs` function with:

```ts
/** Bridge the agent leg (B) to the caller leg (A). When the target leg has not
 *  answered yet, pass `playRingtone` so Telnyx plays ringback to the caller. */
export async function bridgeLegs(
  aLegId: string,
  bLegId: string,
  opts: { playRingtone?: boolean } = {}
): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.bridge(aLegId, {
      call_control_id_to_bridge_with: bLegId,
      command_id: commandId(),
      ...(opts.playRingtone ? { play_ringtone: true } : {}),
    })
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- voice-orchestrator`
Expected: PASS (4 tests).

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (`res.data.call_control_id` resolves against the SDK's `CallDialResponse`; `play_ringtone` is a valid `ActionBridgeParams` field.)

- [ ] **Step 7: Commit**

```bash
git add lib/telnyx/voice-orchestrator.ts lib/telnyx/voice-orchestrator.test.ts
git commit -m "feat: dialAgent returns leg id; bridgeLegs supports play_ringtone"
```

---

## Task 2: Webhook — bridge early with ringback; status-only on agent answer

**Files:**
- Modify: `app/api/webhooks/telnyx/voice/route.ts`

- [ ] **Step 1: Bridge immediately after dialing (caller-leg branch)**

In `handleCallAnswered`, the caller-leg (A) branch currently calls `dialAgent(...)` and ignores its result. Replace the `try { await dialAgent({ ... }) } catch (...)` block with one that captures the agent leg id and bridges with ringback:

```ts
  try {
    const agentLegId = await dialAgent({
      aLegId: payload.call_control_id,
      callId: call.id,
      didNumber: payload.to, // owned DID the customer dialed
      callerNumber: payload.from, // shown to the agent as caller ID
    })
    // Bridge now, before the agent answers, so Telnyx plays ringback to the
    // caller while the agent leg rings. (We answered the caller leg early to
    // orchestrate, which stopped the carrier ringback.)
    await bridgeLegs(payload.call_control_id, agentLegId, { playRingtone: true })
  } catch (err) {
    console.error("⚠️ Failed to dial agent; sending caller to voicemail:", err)
    await beginVoicemail(supabase, payload.call_control_id)
  }
```

- [ ] **Step 2: On agent answer, update status only (agent-leg branch)**

In `handleCallAnswered`, the agent-leg (B) branch currently calls `bridgeLegs(...)` then updates status. Since the bridge now happens at dial time, replace that branch's body with a status update only:

```ts
  // Agent (leg B) picked up. The legs were already bridged at dial time (with
  // ringback), so the agent answering simply completes the connection — just
  // mark the caller's call answered.
  if (agentState?.role === "agent") {
    const { error } = await supabase
      .from("calls")
      .update({ status: "answered", started_at: new Date().toISOString() })
      .eq("telnyx_call_id", agentState.aLegId)
    if (error) console.error("⚠️ Failed to mark call answered:", error)
    return
  }
```

- [ ] **Step 3: Verify `bridgeLegs` is still imported**

`bridgeLegs` moved from the agent branch to the caller branch but is still used, so the existing import at the top of the file (`import { answerCaller, dialAgent, bridgeLegs, startVoicemail, DEFAULT_GREETING } from "@/lib/telnyx/voice-orchestrator"`) stays unchanged. Confirm no unused-import lint error.

Run: `npm run lint`
Expected: no errors for this file.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Run the full unit test suite (no regressions)**

Run: `npm test`
Expected: PASS (client-state, webhook, voice-orchestrator suites all green).

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/telnyx/voice/route.ts
git commit -m "feat: ringback to caller while dialing agent (bridge early + play_ringtone)"
```

---

## Task 3: Manual verification with a real call

The route handler is not unit-tested (it lives under `app/`, outside the vitest include), so the behavior is verified with real calls. Deploy the branch to production (or a preview that the Telnyx webhook points at) before testing. **Telnyx must be able to reach the deployed code at the configured webhook URL `https://www.megestic.com/api/webhooks/telnyx/voice`.**

- [ ] **Step 1: Agent online, answers**
  - Call a routed DID (`+18326501126`, `+18326621055`, or `+18322198320`).
  - Expected: caller hears **ringback**, then connects when the agent picks up.
  - DB: `calls` row → `answered`, then `completed` on hangup.

- [ ] **Step 2: Agent online, ignores (PRIMARY FIX — previously untested)**
  - Call a routed DID; do not answer for the full ~25s.
  - Expected: caller hears **ringback** for the whole window, then the voicemail greeting + beep + recording.
  - DB: `calls` row → `voicemail` (NOT `missed`); a `voicemails` row and a `voicemail` notification appear.

- [ ] **Step 3: Agent offline**
  - Sign the agent out, then call a routed DID.
  - Expected: caller hears brief ringback (agent leg fails fast), then voicemail. Still works (no regression).

- [ ] **Step 4: Caller hangs up during ringback**
  - Call and hang up after a few seconds of ringback.
  - Expected: `calls` row → `missed`; no orphaned/stuck legs (check Telnyx no longer shows an active call).

- [ ] **If Step 2 shows the caller leg is dropped on agent-timeout (no voicemail):** apply the spec's fallback — add `park_after_unbridge: "self"` to the `bridgeLegs` call options for the early bridge (pass it through to the Telnyx `bridge` action the same way as `play_ringtone`), so the caller leg survives the unbridge and proceeds to voicemail. Re-run Step 2.

---

## Self-Review Notes

- **Spec coverage:** ringback during dial (Task 1 + Task 2 Step 1); agent-answer no longer double-bridges (Task 2 Step 2); no-answer→voicemail preserved (unchanged hangup handler, verified Task 3 Step 2); no DB/schema change (none in any task). All covered.
- **Type consistency:** `dialAgent` → `Promise<string>` used by Task 2 Step 1; `bridgeLegs(a, b, { playRingtone })` signature defined in Task 1 Step 4 and called identically in Task 2 Step 1. Consistent.
- **Out of scope (unchanged):** HGI number `+2109348999` DB typo and unrouted `+18326130706` — tracked in the spec, not part of this plan.
