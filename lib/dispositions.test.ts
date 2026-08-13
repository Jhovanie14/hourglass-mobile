import { describe, it, expect, vi } from "vitest"
import {
  saveDisposition,
  fetchDispositionsForCalls,
  clearFollowUp,
} from "./dispositions"

function updateEqClient(result: { error: unknown }) {
  const eq = vi.fn().mockResolvedValue(result)
  const update = vi.fn(() => ({ eq }))
  const from = vi.fn(() => ({ update }))
  return { client: { from } as never, from, update, eq }
}

describe("clearFollowUp", () => {
  it("nulls follow_up_at on the row by id", async () => {
    const m = updateEqClient({ error: null })
    await clearFollowUp(m.client, "d1")
    expect(m.from).toHaveBeenCalledWith("call_dispositions")
    expect(m.update).toHaveBeenCalledWith({
      follow_up_at: null,
      updated_at: expect.any(String),
    })
    expect(m.eq).toHaveBeenCalledWith("id", "d1")
  })

  it("throws a friendly message on error", async () => {
    const m = updateEqClient({ error: { message: "boom" } })
    await expect(clearFollowUp(m.client, "d1")).rejects.toThrow(
      /Failed to clear follow-up/
    )
  })
})

function upsertClient(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result)
  const select = vi.fn(() => ({ single }))
  const upsert = vi.fn<
    (payload: Record<string, unknown>, opts: { onConflict: string }) => unknown
  >(() => ({ select }))
  const from = vi.fn(() => ({ upsert }))
  return { client: { from } as never, upsert }
}

function selectInClient(rows: unknown[]) {
  const inFn = vi.fn().mockResolvedValue({ data: rows, error: null })
  const select = vi.fn(() => ({ in: inFn }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as never, from, inFn }
}

describe("saveDisposition", () => {
  it("upserts on (telnyx_call_id, agent_id) without sending agent_id", async () => {
    const row = {
      id: "d1",
      telnyx_call_id: "call-1",
      outcome: "answered",
      notes: "hi",
      follow_up_at: null,
      contact_number: "+12105551234",
      direction: "outbound",
      created_at: "t",
      updated_at: "t",
    }
    const { client, upsert } = upsertClient({ data: row, error: null })
    const result = await saveDisposition(client, {
      telnyxCallId: "call-1",
      outcome: "answered",
      notes: "  hi  ",
      followUpAt: null,
      contactNumber: "+12105551234",
      direction: "outbound",
    })
    expect(result).toEqual(row)
    const [payload, opts] = upsert.mock.calls[0]
    expect(payload).toMatchObject({
      telnyx_call_id: "call-1",
      outcome: "answered",
      notes: "hi", // trimmed
      follow_up_at: null,
      contact_number: "+12105551234",
      direction: "outbound",
    })
    expect(payload).not.toHaveProperty("agent_id")
    expect(opts).toEqual({ onConflict: "telnyx_call_id,agent_id" })
  })

  it("throws with a friendly message on error", async () => {
    const { client } = upsertClient({ data: null, error: { message: "boom" } })
    await expect(
      saveDisposition(client, {
        telnyxCallId: "c",
        outcome: "spam",
        notes: "",
        followUpAt: null,
        contactNumber: "",
        direction: "inbound",
      })
    ).rejects.toThrow(/boom/)
  })
})

describe("fetchDispositionsForCalls", () => {
  it("returns {} for empty ids without querying", async () => {
    const { client, from } = selectInClient([])
    expect(await fetchDispositionsForCalls(client, [])).toEqual({})
    expect(from).not.toHaveBeenCalled()
  })

  it("maps rows by telnyx_call_id", async () => {
    const rows = [
      { id: "d1", telnyx_call_id: "a", outcome: "answered" },
      { id: "d2", telnyx_call_id: "b", outcome: "spam" },
    ]
    const { client, inFn } = selectInClient(rows)
    const map = await fetchDispositionsForCalls(client, ["a", "b", ""])
    expect(inFn).toHaveBeenCalledWith("telnyx_call_id", ["a", "b"]) // "" filtered
    expect(map.a.outcome).toBe("answered")
    expect(map.b.id).toBe("d2")
  })
})
