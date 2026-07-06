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
