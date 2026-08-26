import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

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
import { bucketBaddiePricingText } from "@/lib/pricing/bucketbaddie"
import { BUCKET_BADDIE_RULES, TLP_RULES } from "@/lib/pricing/rules"

const req = (body: unknown = { data: { payload: {} } }) =>
  new Request("http://test/api/webhooks/telnyx/ai/variables", {
    method: "POST",
    headers: {
      "telnyx-signature-ed25519": "sig",
      "telnyx-timestamp": "123",
    },
    body: JSON.stringify(body),
  })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELNYX_WEBHOOK_PUBLIC_KEY = "key"
  // Production state as of 2026-08-26: one AI brand.
  process.env.TELNYX_AI_ASSISTANT_ID = "assistant-1"
  process.env.AI_AGENT_LABELS = "TLP"
  delete process.env.BB_COUPONS_ENABLED
  delete process.env.BB_COUPONS_URL
  verifyTelnyxWebhook.mockReturnValue(true)
  getOnlineReachableAgents.mockResolvedValue([])
})

afterEach(() => {
  delete process.env.AI_AGENT_LABELS
  delete process.env.TELNYX_AI_ASSISTANT_ID
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
        brand_rules: TLP_RULES,
        hours: "",
        open_now: "unknown",
      },
    })
  })

  it("serves TLP's block byte-for-byte while it is the only AI brand", async () => {
    // The no-regression proof for the brand-aware rewrite. With one configured
    // label and a body that names no brand, the answer must be exactly what
    // the single-brand route returned before.
    const body = await POST(req()).then((r) => r.json())
    expect(body.dynamic_variables.pricing).toBe(pricingText())
  })

  it("gives TLP no hours and an unknown open flag rather than claiming it is shut", async () => {
    const body = await POST(req()).then((r) => r.json())
    expect(body.dynamic_variables.hours).toBe("")
    expect(body.dynamic_variables.open_now).toBe("unknown")
  })

  it("reports no availability when no agent is online", async () => {
    const res = await POST(req())

    expect(await res.json()).toEqual({
      dynamic_variables: {
        agents_available: false,
        targets: [],
        pricing: pricingText(),
        brand_rules: TLP_RULES,
        hours: "",
        open_now: "unknown",
      },
    })
  })

  it("fails safe with 200 on a bad signature, and trusts no brand from it", async () => {
    verifyTelnyxWebhook.mockReturnValue(false)

    const res = await POST(req({ brand_label: "Bucket Baddie" }))

    expect(res.status).toBe(200)
    // No brand keys at all: an unverified body must not pick a brand, and
    // omitting leaves whatever the start command set standing.
    expect(await res.json()).toEqual({
      dynamic_variables: { agents_available: false, targets: [] },
    })
    expect(getOnlineReachableAgents).not.toHaveBeenCalled()
  })

  it("still serves the brand block when the presence lookup throws", async () => {
    getOnlineReachableAgents.mockRejectedValue(new Error("db down"))

    const body = await POST(req()).then((r) => r.json())

    expect(body.dynamic_variables.pricing).toContain("Express Complete Detail")
    expect(body.dynamic_variables.agents_available).toBe(false)
    expect(body.dynamic_variables.targets).toEqual([])
  })
})

describe("brand resolution", () => {
  it("uses the brand named in the body, even with several brands configured", async () => {
    process.env.AI_AGENT_LABELS = "TLP,Bucket Baddie"

    const body = await POST(
      req({ data: { payload: { dynamic_variables: { brand_label: "Bucket Baddie" } } } })
    ).then((r) => r.json())

    expect(body.dynamic_variables.pricing).toBe(bucketBaddiePricingText())
    expect(body.dynamic_variables.brand_rules).toBe(BUCKET_BADDIE_RULES)
    expect(body.dynamic_variables.hours).toContain("- Monday: closed.")
    expect(["yes", "no"]).toContain(body.dynamic_variables.open_now)
  })

  it("omits the brand keys rather than guessing once two brands are live", async () => {
    // Two brands and a body that names none. Picking either would risk quoting
    // car wash prices to someone ringing a chicken shop.
    process.env.AI_AGENT_LABELS = "TLP,Bucket Baddie"

    const body = await POST(req()).then((r) => r.json())

    expect(body.dynamic_variables).toEqual({ agents_available: false, targets: [] })
    expect(body.dynamic_variables).not.toHaveProperty("pricing")
  })

  it("omits the brand keys when a configured label has no content registered", async () => {
    process.env.AI_AGENT_LABELS = "STR"

    const body = await POST(req()).then((r) => r.json())

    expect(body.dynamic_variables).not.toHaveProperty("pricing")
  })

  it("never serves one brand's prices under another brand's label", async () => {
    process.env.AI_AGENT_LABELS = "TLP,Bucket Baddie"

    const bb = await POST(req({ brand_label: "Bucket Baddie" })).then((r) => r.json())
    const tlp = await POST(req({ brand_label: "TLP" })).then((r) => r.json())

    expect(bb.dynamic_variables.pricing).not.toContain("The Launch Pad")
    expect(tlp.dynamic_variables.pricing).not.toContain("Bucket Baddie")
  })
})

describe("coupons", () => {
  it("sends no coupons key while the flag is off", async () => {
    process.env.AI_AGENT_LABELS = "Bucket Baddie"

    const body = await POST(req()).then((r) => r.json())

    expect(body.dynamic_variables).not.toHaveProperty("coupons")
  })

  it("sends live deals for Bucket Baddie once enabled", async () => {
    process.env.AI_AGENT_LABELS = "Bucket Baddie"
    process.env.BB_COUPONS_ENABLED = "true"
    process.env.BB_COUPONS_URL = "https://bucketbaddie.test/api/public-coupons"
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([{ code: "SUMMER", name: "Summer", type: "percentage", value: 20 }]),
        { status: 200 }
      )
    )

    const body = await POST(req()).then((r) => r.json())

    expect(body.dynamic_variables.coupons).toContain("20% off with code SUMMER")
    fetchSpy.mockRestore()
  })

  it("never fetches Bucket Baddie deals on a TLP call", async () => {
    process.env.AI_AGENT_LABELS = "TLP"
    process.env.BB_COUPONS_ENABLED = "true"
    process.env.BB_COUPONS_URL = "https://bucketbaddie.test/api/public-coupons"
    const fetchSpy = vi.spyOn(globalThis, "fetch")

    const body = await POST(req()).then((r) => r.json())

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(body.dynamic_variables).not.toHaveProperty("coupons")
    fetchSpy.mockRestore()
  })

  it("stays silent about deals when the coupon endpoint fails", async () => {
    process.env.AI_AGENT_LABELS = "Bucket Baddie"
    process.env.BB_COUPONS_ENABLED = "true"
    process.env.BB_COUPONS_URL = "https://bucketbaddie.test/api/public-coupons"
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("endpoint down"))

    const body = await POST(req()).then((r) => r.json())

    expect(body.dynamic_variables).not.toHaveProperty("coupons")
    // The menu still goes out — a dead coupon endpoint is no reason to stop
    // the assistant quoting food prices.
    expect(body.dynamic_variables.pricing).toContain("Bucket Baddie — current menu.")
    fetchSpy.mockRestore()
  })
})
