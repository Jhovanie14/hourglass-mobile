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

// Chainable Supabase-admin mock. Per-table behavior keyed by from() table name.
function makeAdmin(opts: {
  online?: { user_id: string }[]
  creds?: { user_id: string; sip_username: string }[]
  claimRows?: { id: string }[]
  ringing?: { agent_leg_id: string }[]
  answered?: { agent_leg_id: string }[]
}) {
  const insert = vi.fn().mockResolvedValue({ error: null })

  const presenceGte = vi.fn().mockResolvedValue({ data: opts.online ?? [], error: null })
  const presenceSelect = vi.fn(() => ({ gte: presenceGte }))

  const credsIn = vi.fn().mockResolvedValue({ data: opts.creds ?? [], error: null })
  const credsSelect = vi.fn(() => ({ in: credsIn }))

  const claimSelect = vi.fn().mockResolvedValue({ data: opts.claimRows ?? [], error: null })
  const claimEq2 = vi.fn(() => ({ select: claimSelect }))
  const claimEq1 = vi.fn(() => ({ eq: claimEq2 }))
  const update = vi.fn(() => ({ eq: claimEq1 }))

  const legsEqStatus = vi.fn((_col: string, status: string) =>
    Promise.resolve({
      data: status === "answered" ? opts.answered ?? [] : opts.ringing ?? [],
      error: null,
    })
  )
  const legsEqCall = vi.fn(() => ({ eq: legsEqStatus }))
  const legsSelect = vi.fn(() => ({ eq: legsEqCall }))

  const legUpdateEq2 = vi.fn().mockResolvedValue({ error: null })
  const legUpdateEq1 = vi.fn(() => ({ eq: legUpdateEq2 }))
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
