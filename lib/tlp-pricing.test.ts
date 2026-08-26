import { describe, expect, it } from "vitest"
import { TLP_PRICING, pricingText } from "./tlp-pricing"

/** Names and prices lifted from the inactive rows of service_packages_rows.csv.
 *  None of these may ever reach a caller. The $1.00 "test wash" is the one that
 *  would actually cost money if quoted. */
const INACTIVE_NAMES = ["Deluxe wash", "Basic wash", "test wash"]

describe("TLP_PRICING", () => {
  it("carries the four monthly memberships in site order", () => {
    expect(TLP_PRICING.memberships.map((m) => m.name)).toEqual([
      "Quick Service",
      "Express Detail",
      "Commercial Wash",
      "Self-Service Bay",
    ])
  })

  it("prices memberships at full and first-time-member rates", () => {
    const [quick, express, commercial, selfService] = TLP_PRICING.memberships
    expect(quick.monthlyPrice).toBe(39.99)
    expect(quick.firstTimePrice).toBe(35.99)
    expect(express.monthlyPrice).toBe(59.99)
    expect(express.firstTimePrice).toBe(53.99)
    expect(commercial.monthlyPrice).toBe(89.99)
    expect(commercial.firstTimePrice).toBe(80.99)
    // No advertised discount on the self-service bay tier.
    expect(selfService.monthlyPrice).toBe(19.99)
    expect(selfService.firstTimePrice).toBeNull()
  })

  it("treats Commercial Wash as exterior only, pending confirmation of the source copy", () => {
    // The marketing copy contradicts itself: the prose says "Express exterior
    // wash … hand wash, wheels & tires shine, towel dry" while the bullet list
    // repeats Express Detail's interior items verbatim. Until the client
    // confirms, we promise the lesser service — under-delivering on a quote is
    // recoverable, over-promising is a dispute.
    const commercial = TLP_PRICING.memberships[2]
    expect(commercial.includes.join(" ")).not.toMatch(/interior/i)
    expect(commercial.notes.join(" ")).toMatch(/exterior only/i)
  })

  it("carries only the active one-time services", () => {
    expect(TLP_PRICING.oneTimeServices.map((s) => s.name)).toEqual([
      "Quick Exterior Wash",
      "Quick Interior Refresh",
      "Classic Complete",
      "Express Exterior Detail",
      "Express Interior Detail",
      "Express Complete Detail",
      "Self-Service Bay",
    ])
  })

  it("offers the self-service bay pay-per-use as well as by membership", () => {
    // A caller who does not want a membership can still wash: $10 a visit.
    const payPerUse = TLP_PRICING.oneTimeServices.find((s) => s.name === "Self-Service Bay")!
    expect(payPerUse.price).toBe(10)
    expect(payPerUse.includes).toContain("No commitment needed")

    // Two visits cost more than a month, which is what makes the upsell true.
    const membership = TLP_PRICING.memberships.find((m) => m.name === "Self-Service Bay")!
    expect(payPerUse.price * 2).toBeGreaterThan(membership.monthlyPrice)
  })

  it("says the bays run 24/7, on both the membership and the pay-per-use", () => {
    // Owner confirmed 2026-08-27. The source site's "9:00 AM to 6:30 PM" was
    // wrong; these are the same physical bays, so both entries must agree or
    // a member and a walk-up get told different things about the same gate.
    const membership = TLP_PRICING.memberships.find((m) => m.name === "Self-Service Bay")!
    const payPerUse = TLP_PRICING.oneTimeServices.find((s) => s.name === "Self-Service Bay")!
    expect(membership.notes.join(" ")).toContain("24 hours a day, 7 days a week")
    expect(payPerUse.includes.join(" ")).toContain("24 hours a day, 7 days a week")
    expect(pricingText()).not.toContain("9:00 AM to 6:30 PM")
  })

  it("states no duration where none is published", () => {
    // The membership publishes a 10-minute bay limit; nobody has confirmed it
    // applies to a single paid visit, so the assistant must not claim one.
    const payPerUse = TLP_PRICING.oneTimeServices.find((s) => s.name === "Self-Service Bay")!
    expect(payPerUse.durationMinutes).toBeNull()
    expect(pricingText()).toMatch(/- Self-Service Bay: \$10\.00\. Access to self-service/)
    expect(pricingText()).not.toMatch(/Self-Service Bay: \$10\.00, about/)
  })

  it("excludes every inactive service from the CSV", () => {
    const names = TLP_PRICING.oneTimeServices.map((s) => s.name)
    for (const inactive of INACTIVE_NAMES) {
      expect(names).not.toContain(inactive)
    }
  })

  it("never contains the $1.00 test price", () => {
    expect(TLP_PRICING.oneTimeServices.map((s) => s.price)).not.toContain(1)
  })

  it("lists the vehicle types that need the commercial plan", () => {
    expect(TLP_PRICING.commercialVehicleTypes.join(" ")).toMatch(/tow truck/i)
    expect(TLP_PRICING.commercialVehicleTypes.join(" ")).toMatch(/sprinter van/i)
  })

  it("keeps the Quick naming trap explicit: membership shines tires, one-time does not", () => {
    const quickMembership = TLP_PRICING.memberships[0]
    const quickOneTime = TLP_PRICING.oneTimeServices[0]
    expect(quickMembership.includes.join(" ")).toMatch(/tires/i)
    expect(quickOneTime.excludes.join(" ")).toMatch(/tire shine/i)
  })
})

describe("pricingText", () => {
  const text = pricingText()

  it("states every active service with its price", () => {
    for (const s of TLP_PRICING.oneTimeServices) {
      expect(text).toContain(s.name)
      expect(text).toContain(s.price.toFixed(2))
    }
  })

  it("states every membership with its monthly price", () => {
    for (const m of TLP_PRICING.memberships) {
      expect(text).toContain(m.name)
      expect(text).toContain(m.monthlyPrice.toFixed(2))
    }
  })

  it("leaks no inactive service name", () => {
    for (const inactive of INACTIVE_NAMES) {
      expect(text).not.toContain(inactive)
    }
  })

  it("quotes the commercial plan now that we have its price", () => {
    expect(text).toContain("Commercial Wash")
    expect(text).toContain("89.99")
    expect(text).toContain("80.99")
  })

  it("names the vehicle types that need the commercial plan", () => {
    expect(text).toMatch(/tow truck/i)
    expect(text).toMatch(/sprinter van/i)
  })

  it("does not promise interior work on the commercial plan", () => {
    const commercialLine = text
      .split("\n")
      .find((l) => l.includes("Commercial Wash"))
    expect(commercialLine).toBeDefined()
    expect(commercialLine!).not.toMatch(/interior/i)
  })

  it("qualifies the 10% discount as first-time membership only", () => {
    expect(text).toMatch(/first[- ]time/i)
  })
})
