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
import { pricingText } from "@/lib/tlp-pricing"

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
        pricing: pricingText(),
      },
    })
  })

  it("reports no availability when no agent is online", async () => {
    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      dynamic_variables: {
        agents_available: false,
        targets: [],
        pricing: pricingText(),
      },
    })
  })

  it("fails safe with 200 on a bad signature, so Telnyx does not retry", async () => {
    verifyTelnyxWebhook.mockReturnValue(false)

    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      dynamic_variables: {
        agents_available: false,
        targets: [],
        pricing: pricingText(),
      },
    })
    expect(getOnlineReachableAgents).not.toHaveBeenCalled()
  })

  it("fails safe with 200 when the presence lookup throws", async () => {
    getOnlineReachableAgents.mockRejectedValue(new Error("db down"))

    const res = await POST(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      dynamic_variables: {
        agents_available: false,
        targets: [],
        pricing: pricingText(),
      },
    })
  })

  it("still serves pricing when presence is unavailable, so the AI can quote prices without transfer", async () => {
    getOnlineReachableAgents.mockRejectedValue(new Error("db down"))

    const body = await POST(req()).then((r) => r.json())

    expect(body.dynamic_variables.pricing).toContain("Express Complete Detail")
    expect(body.dynamic_variables.agents_available).toBe(false)
  })
})
