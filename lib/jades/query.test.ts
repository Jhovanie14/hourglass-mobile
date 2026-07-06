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
