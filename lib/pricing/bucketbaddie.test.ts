import { describe, expect, it } from "vitest"
import {
  BUCKET_BADDIE_MENU,
  bucketBaddiePricingText,
  priceCollisions,
} from "./bucketbaddie"

/** Glaze and sauce names from the superseded 2026-04-25 markdown board. None of
 *  these exist on the current menu, and a caller who hears one is being quoted
 *  a flavour we don't sell. */
const RETIRED_NAMES = [
  "Ghost Mode Mirchi",
  "PeriPeri Masala",
  "Mango Habanero Heat",
  "Buff Baddie",
  "Lemon MasalaFlex",
  "Butter Baddie",
  "Garlic Drip",
  "Chutney",
  "Bucket Baddie OG",
]

describe("BUCKET_BADDIE_MENU", () => {
  it("keeps rice on the menu", () => {
    // The 2026-04-25 markdown board says "Remove all rice references". It is
    // four months stale and the owner confirmed on 2026-08-26 that rice is
    // back. This test exists so nobody re-applies that note from the old file.
    const text = bucketBaddiePricingText()
    expect(text).toMatch(/Rice Bowl \(regular\): \$11\.99/)
    expect(text).toMatch(/Rice Bowl \(large\): \$16\.99/)
    expect(text).toMatch(/Seasoned rice instead of fries: \$2\.50/)
    expect(BUCKET_BADDIE_MENU.buildYourBaddie.bases).toContain("rice")
  })

  it("carries nine glazes, hottest first, each with a heat level", () => {
    expect(BUCKET_BADDIE_MENU.glazes).toHaveLength(9)
    expect(BUCKET_BADDIE_MENU.glazes.map((g) => g.name)).toEqual([
      "Ghost Pepper",
      "Mirchi Melt",
      "Peri Peri",
      "Mango Habanero",
      "Buffalo Baddie",
      "Lemon Pepper",
      "Garlic Parmesan",
      "Honey BBQ",
      "Butter Masala",
    ])
    for (const glaze of BUCKET_BADDIE_MENU.glazes) {
      expect(glaze.heat.trim()).not.toBe("")
    }
  })

  it("never speaks a retired flavour name", () => {
    const text = bucketBaddiePricingText()
    for (const retired of RETIRED_NAMES) {
      expect(text).not.toContain(retired)
    }
  })

  it("calls them Combos, not Buckets", () => {
    // "Buckets" was the markdown board's name for the same four items. The
    // printed board says Combos, and the assistant must use the board's words.
    const titles = BUCKET_BADDIE_MENU.sections.map((s) => s.title)
    expect(titles).toContain("COMBOS")
    expect(titles.some((t) => t.includes("BUCKET"))).toBe(false)
  })

  it("offers only cauliflower routes as vegetarian", () => {
    const text = bucketBaddiePricingText()
    expect(text).toMatch(/VEGETARIAN: .*Gobi-A Baddie.*cauliflower/)
    expect(text).toContain("Nothing else on the menu is vegetarian.")
  })
})

describe("priceCollisions", () => {
  it("finds every price that names more than one product", () => {
    const byPrice = new Map(priceCollisions().map((c) => [c.price, c.items]))

    // The five-way collision is the reason the whole mechanism exists.
    expect(byPrice.get(11.99)).toEqual([
      "10 piece wings",
      "5 piece tenders",
      "Rice Bowl (regular)",
      "Build Your Baddie (regular)",
      "Gobi-A Baddie (large)",
    ])
    expect(byPrice.get(9.99)).toEqual([
      "Small Combo",
      "Loaded Fries (regular)",
      "Burger Baddie",
      "Large Fries",
    ])
    expect(byPrice.get(16.99)).toEqual([
      "15 piece wings",
      "8 piece tenders",
      "Rice Bowl (large)",
      "Build Your Baddie (large)",
    ])
    expect(byPrice.get(7.99)).toEqual([
      "6 piece wings",
      "3 piece tenders",
      "Medium Fries",
    ])
    expect(byPrice.get(24.99)).toEqual(["20 piece wings", "Baddie Duo"])
    expect(byPrice.get(3.75)).toEqual(["Blue Lemonade", "Soursop"])
  })

  it("reports collisions cheapest first", () => {
    const prices = priceCollisions().map((c) => c.price)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
  })

  it("does not report a price that names exactly one product", () => {
    const prices = priceCollisions().map((c) => c.price)
    expect(prices).not.toContain(28.99) // Party Combo, unique
    expect(prices).not.toContain(35.99) // 30 piece wings, unique
    expect(prices).not.toContain(20.99) // 15 piece tenders, unique
  })

  it("derives the collisions rather than hardcoding them", () => {
    // A price change must move the warning with it. If someone re-prices the
    // large fries, $9.99 stops being a four-way collision on its own.
    const menu = structuredClone(BUCKET_BADDIE_MENU)
    const sides = menu.sections.find((s) => s.title === "SIDES")!
    sides.items.find((i) => i.name === "Large Fries")!.price = 10.49

    const byPrice = new Map(priceCollisions(menu).map((c) => [c.price, c.items]))
    expect(byPrice.get(9.99)).toEqual([
      "Small Combo",
      "Loaded Fries (regular)",
      "Burger Baddie",
    ])
  })
})

describe("bucketBaddiePricingText", () => {
  it("prints every price to two decimal places", () => {
    const text = bucketBaddiePricingText()
    const prices = text.match(/\$\d+(\.\d+)?/g) ?? []
    expect(prices.length).toBeGreaterThan(40)
    for (const price of prices) {
      expect(price).toMatch(/^\$\d+\.\d{2}$/)
    }
  })

  it("names the three delivery apps and never promises our own delivery", () => {
    const text = bucketBaddiePricingText()
    expect(text).toContain("GrubHub, DoorDash, Uber Eats")
    expect(text).toContain("pickup only")
    expect(text).not.toMatch(/delivery fee|delivery area|we deliver\b/i)
  })

  it("keeps glazes and dips as separate, non-interchangeable lists", () => {
    const text = bucketBaddiePricingText()
    expect(text).toContain("Never call a glaze a dip.")
    expect(text).toMatch(
      /DRIZZLE DIPS \(three, separate from glazes\): Ranch Drip, Green Baddie Drip, OG Baddie Drip\./
    )
  })

  it("ends with the price-collision warning so it is the last thing in context", () => {
    const text = bucketBaddiePricingText()
    expect(text).toContain("SAME PRICE, DIFFERENT ITEMS — never take a price as an order:")
    expect(text.trimEnd().endsWith("work it out from the item, not the number.")).toBe(true)
  })

  it("tells the assistant fries are not included with wings or tenders", () => {
    const text = bucketBaddiePricingText()
    expect(text).toContain("Wings on their own. No fries included.")
    expect(text).toContain("Tenders on their own. No fries included.")
  })
})
