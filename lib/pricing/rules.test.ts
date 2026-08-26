import { describe, expect, it } from "vitest"
import { BUCKET_BADDIE_RULES, TLP_RULES } from "./rules"
import { bucketBaddiePricingText } from "./bucketbaddie"

describe("brand rules isolation", () => {
  // The whole reason brand rules are a dynamic variable rather than part of the
  // shared instructions block: one assistant serves both brands, and a call
  // must never carry the other brand's policy.
  it("keeps chicken shop policy out of the car wash rules", () => {
    expect(TLP_RULES).not.toMatch(/halal|wings|tenders|glaze|chicken|pickup/i)
  })

  it("keeps car wash policy out of the chicken shop rules", () => {
    expect(BUCKET_BADDIE_RULES).not.toMatch(
      /membership|wash|detail|vehicle|tire shine/i
    )
  })

  it("opens each with what the business actually is", () => {
    expect(TLP_RULES).toMatch(/^You are a car wash\./)
    expect(BUCKET_BADDIE_RULES).toMatch(/^You are a halal fried chicken spot in Houston\./)
  })
})

describe("TLP_RULES", () => {
  it("keeps the two confusions that caused real mistakes", () => {
    expect(TLP_RULES).toMatch(/Quick Service membership includes wheels and tires shine/)
    expect(TLP_RULES).toMatch(/first-time membership only/)
  })

  it("forbids implying a booking", () => {
    expect(TLP_RULES).toMatch(/Never say a booking is made, confirmed, reserved, or scheduled/)
  })

  it("holds Commercial Wash to exterior only", () => {
    // The source copy contradicts itself; the assistant promises the lesser
    // service. See lib/tlp-pricing.ts and the discovery doc.
    expect(BUCKET_BADDIE_RULES.length).toBeGreaterThan(0)
    expect(TLP_RULES).toMatch(/Do not tell a commercial caller that interior cleaning is\s+included/)
  })
})

describe("BUCKET_BADDIE_RULES", () => {
  it("forbids implying an order was placed", () => {
    expect(BUCKET_BADDIE_RULES).toMatch(
      /Never say\s+an order is placed, confirmed, or on its way/
    )
  })

  it("separates the winner's voucher from everyone else's giveaway entry", () => {
    // A winner gets a free small combo voucher; a loser gets an entry into a
    // weekly giveaway. Collapsing the two promises free food to someone who
    // did not earn it.
    expect(BUCKET_BADDIE_RULES).toMatch(/free small combo voucher is for winners only/)
    expect(BUCKET_BADDIE_RULES).toMatch(
      /Do not promise a voucher to someone who has not won/
    )
  })

  it("states the challenge is free and gated on age and a waiver", () => {
    expect(BUCKET_BADDIE_RULES).toMatch(/It is free to\s+enter/)
    expect(BUCKET_BADDIE_RULES).toMatch(/18 or over and sign the waiver/)
  })

  it("sends catering to a callback rather than a quote", () => {
    expect(BUCKET_BADDIE_RULES).toMatch(/You cannot quote a price, a\s+minimum or a lead time/)
    expect(BUCKET_BADDIE_RULES).toMatch(/catering enquiry/)
  })

  it("leaves the price-collision warning to the derived pricing block", () => {
    // Duplicating it here would let the two drift apart, and the derived one is
    // the copy that updates itself when a price moves.
    expect(BUCKET_BADDIE_RULES).not.toMatch(/never take a price as an order/i)
    expect(bucketBaddiePricingText()).toMatch(/never take a price as an order/i)
  })
})
