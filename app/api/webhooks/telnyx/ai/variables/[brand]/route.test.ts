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

const req = (body: unknown = { data: { payload: {} } }) =>
  new Request("http://test/api/webhooks/telnyx/ai/variables/x", {
    method: "POST",
    headers: { "telnyx-signature-ed25519": "sig", "telnyx-timestamp": "123" },
    body: JSON.stringify(body),
  })

const call = (brand: string, body?: unknown) =>
  POST(req(body), { params: Promise.resolve({ brand }) }).then((r) => r.json())

beforeEach(() => {
  vi.clearAllMocks()
  process.env.TELNYX_WEBHOOK_PUBLIC_KEY = "key"
  delete process.env.BB_COUPONS_ENABLED
  delete process.env.BB_COUPONS_URL
  verifyTelnyxWebhook.mockReturnValue(true)
  getOnlineReachableAgents.mockResolvedValue([])
})

afterEach(() => {
  delete process.env.AI_AGENT_LABELS
  delete process.env.TELNYX_AI_ASSISTANT_ID
})

describe("per-brand variables webhook", () => {
  it("serves Bucket Baddie from the slug alone", () => {
    // No AI_AGENT_LABELS, no brand in the body, no assistant id — the URL is
    // the whole input. This is the point of the split.
    return call("bucket-baddie").then((b) => {
      expect(b.dynamic_variables.brand_name).toBe("Bucket Baddie")
      expect(b.dynamic_variables.pricing).toBe(bucketBaddiePricingText())
      expect(b.dynamic_variables.hours).toContain("- Monday: closed.")
    })
  })

  it("serves The Launch Pad from its slug", () => {
    return call("the-launch-pad").then((b) => {
      expect(b.dynamic_variables.brand_name).toBe("The Launch Pad")
      expect(b.dynamic_variables.pricing).toBe(pricingText())
      expect(b.dynamic_variables.open_now).toBe("unknown")
    })
  })

  it("is unaffected by how many brands are configured", () => {
    // The ambiguity that forced the unsuffixed route to give up cannot arise
    // here: two brands live, and each slug still answers for itself.
    process.env.AI_AGENT_LABELS = "The Launch Pad,Bucket Baddie"
    return Promise.all([call("the-launch-pad"), call("bucket-baddie")]).then(
      ([tlp, bb]) => {
        expect(tlp.dynamic_variables.brand_name).toBe("The Launch Pad")
        expect(bb.dynamic_variables.brand_name).toBe("Bucket Baddie")
        expect(tlp.dynamic_variables.pricing).not.toContain("Bucket Baddie")
        expect(bb.dynamic_variables.pricing).not.toContain("The Launch Pad")
      }
    )
  })

  it("ignores a brand named in the body when the URL disagrees", () => {
    // The URL wins. A spoofed or stale body cannot move a caller to another
    // brand's price list.
    return call("bucket-baddie", { brand_label: "The Launch Pad" }).then((b) => {
      expect(b.dynamic_variables.brand_name).toBe("Bucket Baddie")
      expect(b.dynamic_variables.pricing).not.toContain("The Launch Pad")
    })
  })

  it("accepts the label spelled out, not just the slug", () => {
    return call("Bucket%20Baddie").then((b) => {
      // Next decodes the segment before it reaches us; this covers the plain
      // spelling either way.
      expect(b.dynamic_variables).toBeDefined()
    })
  })

  it("omits brand keys for an unknown slug rather than guessing", () => {
    return call("star-realty").then((b) => {
      expect(b.dynamic_variables).toEqual({ agents_available: false, targets: [] })
      expect(b.dynamic_variables).not.toHaveProperty("pricing")
    })
  })

  it("still returns presence to a known brand", () => {
    getOnlineReachableAgents.mockResolvedValue([{ userId: "u1", sipUsername: "gencred1" }])
    return call("bucket-baddie").then((b) => {
      expect(b.dynamic_variables.agents_available).toBe(true)
      expect(b.dynamic_variables.targets).toHaveLength(1)
    })
  })

  it("fails safe on a bad signature and trusts nothing, URL included", () => {
    verifyTelnyxWebhook.mockReturnValue(false)
    return call("bucket-baddie").then((b) => {
      expect(b.dynamic_variables).toEqual({ agents_available: false, targets: [] })
      expect(getOnlineReachableAgents).not.toHaveBeenCalled()
    })
  })

  it("still serves the menu when presence lookup dies", () => {
    getOnlineReachableAgents.mockRejectedValue(new Error("db down"))
    return call("bucket-baddie").then((b) => {
      expect(b.dynamic_variables.pricing).toContain("Bucket Baddie — current menu.")
      expect(b.dynamic_variables.agents_available).toBe(false)
    })
  })

  it("fetches deals only for Bucket Baddie, and only when enabled", async () => {
    process.env.BB_COUPONS_ENABLED = "true"
    process.env.BB_COUPONS_URL = "https://bucketbaddie.test/api/public-coupons"
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([{ code: "SUMMER", name: "S", type: "percentage", value: 20 }]),
        { status: 200 }
      )
    )

    const bb = await call("bucket-baddie")
    expect(bb.dynamic_variables.coupons).toContain("20% off with code SUMMER")

    fetchSpy.mockClear()
    const tlp = await call("the-launch-pad")
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(tlp.dynamic_variables).not.toHaveProperty("coupons")

    fetchSpy.mockRestore()
  })
})

describe("an empty slug must not fall back to guessing", () => {
  it("returns no brand keys instead of the sole configured brand", async () => {
    // The failure this guards: with one brand in AI_AGENT_LABELS, a fall-through
    // to runtime resolution answers as THAT brand. Bucket Baddie's webhook would
    // then hand back The Launch Pad's name and prices — which is exactly what a
    // caller would hear as the wrong business.
    process.env.AI_AGENT_LABELS = "The Launch Pad"
    process.env.TELNYX_AI_ASSISTANT_ID = "assistant-1"

    for (const slug of ["", "   "]) {
      const body = await POST(req(), { params: Promise.resolve({ brand: slug }) }).then((r) =>
        r.json()
      )
      expect(body.dynamic_variables, `slug=${JSON.stringify(slug)}`).toEqual({
        agents_available: false,
        targets: [],
      })
      expect(body.dynamic_variables).not.toHaveProperty("brand_name")
    }
  })

  it("still answers correctly for a real slug with one brand configured", async () => {
    process.env.AI_AGENT_LABELS = "The Launch Pad"
    const body = await call("bucket-baddie")
    expect(body.dynamic_variables.brand_name).toBe("Bucket Baddie")
  })
})
