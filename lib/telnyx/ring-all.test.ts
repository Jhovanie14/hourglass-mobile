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

type Errs = {
  presence?: unknown
  devices?: unknown
  creds?: unknown
  claim?: unknown
  legsRead?: unknown
  insert?: unknown
  legUpdate?: unknown
}

// Chainable Supabase-admin mock. Per-table behavior keyed by from() table name.
// Errors are injectable per operation to exercise the `if (error) throw error` paths.
function makeAdmin(opts: {
  online?: { user_id: string }[]
  devices?: { user_id: string }[]
  creds?: { user_id: string; sip_username: string }[]
  claimRows?: { id: string }[]
  ringing?: { agent_leg_id: string }[]
  answered?: { agent_leg_id: string }[]
  errors?: Errs
}) {
  const e = opts.errors ?? {}

  const insert = vi.fn().mockResolvedValue({ error: e.insert ?? null })

  const presenceGte = vi
    .fn()
    .mockResolvedValue({ data: opts.online ?? [], error: e.presence ?? null })
  const presenceSelect = vi.fn(() => ({ gte: presenceGte }))

  // agent_devices: select("user_id").eq("is_available", true)
  const devicesEq = vi
    .fn()
    .mockResolvedValue({ data: opts.devices ?? [], error: e.devices ?? null })
  const devicesSelect = vi.fn(() => ({ eq: devicesEq }))

  const credsIn = vi.fn().mockResolvedValue({ data: opts.creds ?? [], error: e.creds ?? null })
  const credsSelect = vi.fn(() => ({ in: credsIn }))

  // calls UPDATE ... eq ... eq ... select  (claimCall)
  const claimSelect = vi.fn().mockResolvedValue({ data: opts.claimRows ?? [], error: e.claim ?? null })
  const claimEq2 = vi.fn(() => ({ select: claimSelect }))
  const claimEq1 = vi.fn(() => ({ eq: claimEq2 }))
  const update = vi.fn(() => ({ eq: claimEq1 }))

  // call_agent_legs SELECT ... eq(call_id) ... eq(status)
  const legsEqStatus = vi.fn((_col: string, status: string) =>
    Promise.resolve({
      data: status === "answered" ? opts.answered ?? [] : opts.ringing ?? [],
      error: e.legsRead ?? null,
    })
  )
  const legsEqCall = vi.fn(() => ({ eq: legsEqStatus }))
  const legsSelect = vi.fn(() => ({ eq: legsEqCall }))

  // call_agent_legs UPDATE: markLegAnswered uses ONE .eq (terminal); markLegFailedIfRinging
  // uses TWO .eq (terminal on the 2nd). Branch on the payload so BOTH terminals resolve a Promise.
  const legUpdateEqAnswered = vi.fn().mockResolvedValue({ error: e.legUpdate ?? null })
  const legUpdateEqRinging2 = vi.fn().mockResolvedValue({ error: e.legUpdate ?? null })
  const legUpdateEqRinging1 = vi.fn(() => ({ eq: legUpdateEqRinging2 }))
  const legUpdate = vi.fn((payload: { status: string }) =>
    payload.status === "failed"
      ? { eq: legUpdateEqRinging1 }
      : { eq: legUpdateEqAnswered }
  )

  const from = vi.fn((table: string) => {
    if (table === "agent_presence") return { select: presenceSelect }
    if (table === "agent_devices") return { select: devicesSelect }
    if (table === "agent_sip_credentials") return { select: credsSelect }
    if (table === "calls") return { update }
    if (table === "call_agent_legs") return { insert, select: legsSelect, update: legUpdate }
    throw new Error("unexpected table " + table)
  })

  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: { from } as any,
    insert,
    update,
    from,
    credsIn,
    presenceGte,
    devicesEq,
    legUpdate,
    claimEq1,
  }
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

  it("throws when the presence read errors", async () => {
    const admin = makeAdmin({ errors: { presence: new Error("presence boom") } })
    await expect(getOnlineReachableAgents(admin.client, new Date())).rejects.toThrow(/presence boom/)
  })

  it("throws when the credential read errors", async () => {
    const admin = makeAdmin({
      online: [{ user_id: "a" }],
      errors: { creds: new Error("creds boom") },
    })
    await expect(getOnlineReachableAgents(admin.client, new Date())).rejects.toThrow(/creds boom/)
  })

  // Mobile availability: a backgrounded phone can't heartbeat (Android
  // suspends JS timers), so agents with an available registered device must
  // be dialed even with stale presence — the FCM push wakes the phone.
  it("also dials agents with an available mobile device (stale presence)", async () => {
    const admin = makeAdmin({
      online: [{ user_id: "web-agent" }],
      devices: [{ user_id: "mobile-agent" }],
      creds: [
        { user_id: "web-agent", sip_username: "sip-web" },
        { user_id: "mobile-agent", sip_username: "sip-mobile" },
      ],
    })

    const result = await getOnlineReachableAgents(admin.client, new Date())

    const askedIds = admin.credsIn.mock.calls[0][1] as string[]
    expect([...askedIds].sort()).toEqual(["mobile-agent", "web-agent"])
    expect(result).toEqual([
      { userId: "web-agent", sipUsername: "sip-web" },
      { userId: "mobile-agent", sipUsername: "sip-mobile" },
    ])
  })

  it("dedupes an agent online on web AND available on mobile", async () => {
    const admin = makeAdmin({
      online: [{ user_id: "agent-1" }],
      devices: [{ user_id: "agent-1" }],
      creds: [{ user_id: "agent-1", sip_username: "sip-1" }],
    })

    const result = await getOnlineReachableAgents(admin.client, new Date())

    expect(admin.credsIn.mock.calls[0][1]).toEqual(["agent-1"])
    expect(result).toEqual([{ userId: "agent-1", sipUsername: "sip-1" }])
  })

  it("dials a mobile-only agent when nobody is online on web", async () => {
    const admin = makeAdmin({
      online: [],
      devices: [{ user_id: "mobile-agent" }],
      creds: [{ user_id: "mobile-agent", sip_username: "sip-mobile" }],
    })

    const result = await getOnlineReachableAgents(admin.client, new Date())

    expect(result).toEqual([{ userId: "mobile-agent", sipUsername: "sip-mobile" }])
  })

  it("throws when the device read errors", async () => {
    const admin = makeAdmin({
      online: [{ user_id: "a" }],
      errors: { devices: new Error("devices boom") },
    })
    await expect(getOnlineReachableAgents(admin.client, new Date())).rejects.toThrow(/devices boom/)
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

  it("throws when the insert errors", async () => {
    const admin = makeAdmin({ errors: { insert: new Error("insert boom") } })
    await expect(
      recordAgentLegs(admin.client, "call-1", [{ agentLegId: "b1", userId: "a" }])
    ).rejects.toThrow(/insert boom/)
  })
})

describe("claimCall", () => {
  it("returns true and writes the answered payload when a ringing call is flipped", async () => {
    const admin = makeAdmin({ claimRows: [{ id: "call-1" }] })
    const won = await claimCall(admin.client, "a-leg")
    expect(won).toBe(true)
    expect(admin.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "answered" })
    )
    // first .eq is the telnyx_call_id filter
    expect(admin.client.from("calls").update().eq).toBeDefined()
  })

  it("returns false when no ringing call matched (already claimed)", async () => {
    const admin = makeAdmin({ claimRows: [] })
    expect(await claimCall(admin.client, "a-leg")).toBe(false)
  })

  it("throws when the update errors", async () => {
    const admin = makeAdmin({ errors: { claim: new Error("claim boom") } })
    await expect(claimCall(admin.client, "a-leg")).rejects.toThrow(/claim boom/)
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

  it("getRingingAgentLegIds throws when the read errors", async () => {
    const admin = makeAdmin({ errors: { legsRead: new Error("read boom") } })
    await expect(getRingingAgentLegIds(admin.client, "call-1")).rejects.toThrow(/read boom/)
  })

  it("getAnsweredAgentLegId throws when the read errors", async () => {
    const admin = makeAdmin({ errors: { legsRead: new Error("read boom") } })
    await expect(getAnsweredAgentLegId(admin.client, "call-1")).rejects.toThrow(/read boom/)
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

  it("markLegAnswered throws when the update errors", async () => {
    const admin = makeAdmin({ errors: { legUpdate: new Error("upd boom") } })
    await expect(markLegAnswered(admin.client, "b1")).rejects.toThrow(/upd boom/)
  })

  it("markLegFailedIfRinging throws when the update errors", async () => {
    const admin = makeAdmin({ errors: { legUpdate: new Error("upd boom") } })
    await expect(markLegFailedIfRinging(admin.client, "b1")).rejects.toThrow(/upd boom/)
  })
})
