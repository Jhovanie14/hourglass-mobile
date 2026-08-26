import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { BRAND_PROMPTS, bakeInstructions } from "./brand-prompts.mjs"
import { extractInstructions } from "./sync-tlp-assistant.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SHARED = extractInstructions(
  readFileSync(resolve(ROOT, "docs/ai-receptionist-instructions.md"), "utf8")
)

const brand = (label) => BRAND_PROMPTS.find((b) => b.label === label)

describe("BRAND_PROMPTS", () => {
  it("covers both AI brands, labelled exactly as phone_numbers.label", () => {
    expect(BRAND_PROMPTS.map((b) => b.label).sort()).toEqual([
      "Bucket Baddie",
      "The Launch Pad",
    ])
  })

  it("gives each brand its own assistant id env key", () => {
    const keys = BRAND_PROMPTS.map((b) => b.assistantIdEnv)
    expect(new Set(keys).size).toBe(keys.length)
    expect(brand("Bucket Baddie").assistantIdEnv).toBe(
      "TELNYX_AI_ASSISTANT_ID_BUCKET_BADDIE"
    )
  })

  it("gives each brand its own webhook slug", () => {
    const slugs = BRAND_PROMPTS.map((b) => b.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const b of BRAND_PROMPTS) expect(b.slug).toMatch(/^[a-z0-9-]+$/)
  })

  it("keeps each brand's rules free of the other's trade", () => {
    expect(brand("The Launch Pad").rules).not.toMatch(
      /halal|wings|tenders|glaze|chicken|pickup/i
    )
    expect(brand("Bucket Baddie").rules).not.toMatch(
      /membership|wash|detail|vehicle|tire shine/i
    )
  })
})

describe("bakeInstructions", () => {
  it("substitutes the brand's name and rules into the shared block", () => {
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(baked).toContain("You are the receptionist for Bucket Baddie.")
    expect(baked).toContain("You are a halal fried chicken spot in Houston.")
  })

  it("leaves no brand placeholder behind", () => {
    for (const b of BRAND_PROMPTS) {
      expect(bakeInstructions(SHARED, b)).not.toMatch(/\{\{\s*brand_/)
    }
  })

  it("never lets one brand's policy or prices reach the other", () => {
    // The bug this whole file exists to prevent: on 2026-08-26 the Bucket
    // Baddie assistant offered car washes, because its identity and policy
    // arrived over a network call that resolved to the wrong brand.
    const bb = bakeInstructions(SHARED, brand("Bucket Baddie"))
    const tlp = bakeInstructions(SHARED, brand("The Launch Pad"))
    expect(bb).not.toContain(brand("The Launch Pad").rules)
    expect(bb).not.toContain(brand("The Launch Pad").pricing)
    expect(bb).not.toMatch(/membership|tire shine/i)
    expect(tlp).not.toContain(brand("Bucket Baddie").rules)
    expect(tlp).not.toContain(brand("Bucket Baddie").pricing)
    expect(tlp).not.toMatch(/halal|wings|glaze/i)
  })

  it("lets Bucket Baddie name the car wash, but only for directions", () => {
    // They share a lot — the truck is findable only by naming the car wash —
    // so the location note is the single sanctioned cross-brand mention.
    const bb = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(bb).toContain("same lot as The Launch Pad car wash")

    const outsideLocation = bb.replaceAll(brand("Bucket Baddie").locationNote, "")
    expect(outsideLocation).not.toContain("The Launch Pad")
  })

  it("gives both brands the shared address", () => {
    for (const b of BRAND_PROMPTS) {
      expect(bakeInstructions(SHARED, b), b.label).toContain(
        "10410 South Main Street, Houston, Texas 77025"
      )
    }
  })

  it("bakes in the menu, so the assistant knows it without a webhook", () => {
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(baked).toContain("Rice Bowl (regular): $11.99")
    expect(baked).toContain("Ghost Pepper")      // a glaze
    expect(baked).toContain("Ranch Drip")        // a dip
    expect(baked).toContain("SAME PRICE, DIFFERENT ITEMS")
    expect(baked).not.toContain("{{ pricing }}")
  })

  it("bakes in the address", () => {
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(baked).toContain("10410 South Main Street, Houston, Texas 77025")
    expect(baked).toContain("food truck")
  })

  it("bakes The Launch Pad's own prices", () => {
    const baked = bakeInstructions(SHARED, brand("The Launch Pad"))
    expect(baked).toContain("Express Complete Detail")
    expect(baked).not.toContain("{{ pricing }}")
  })

  it("does NOT bake hours — they change by the calendar", () => {
    // The Launch Pad drops to Thursday–Sunday on 18 September 2026. A baked
    // copy would still be telling callers we open on Mondays.
    for (const b of BRAND_PROMPTS) {
      expect(bakeInstructions(SHARED, b), b.label).toContain("{{ hours }}")
    }
  })

  it("leaves as placeholders only what cannot be known at sync time", () => {
    // Whether we are open this minute, live deals, and agent presence. Baking
    // any of those would freeze them at the moment of the last sync.
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    for (const v of ["{{ hours }}", "{{ open_now }}", "{{ coupons }}"]) {
      expect(baked).toContain(v)
    }
  })

  it("throws rather than shipping a prompt that never names the brand", () => {
    expect(() =>
      bakeInstructions("no placeholders at all", brand("Bucket Baddie"))
    ).toThrow(/never names the brand/)
  })

  it("throws on a placeholder it cannot resolve", () => {
    expect(() =>
      bakeInstructions("{{ brand_name }} and {{ brand_label }}", brand("Bucket Baddie"))
    ).toThrow(/placeholder survived/)
  })

  it("throws if a brand names another outside its location note", () => {
    const poisoned = { ...brand("Bucket Baddie"), rules: "Ask about The Launch Pad." }
    expect(() => bakeInstructions(SHARED, poisoned)).toThrow(
      /names The Launch Pad outside the location note/
    )
  })

  it("throws if another brand's whole rule block gets in", () => {
    const poisoned = {
      ...brand("Bucket Baddie"),
      rules: brand("The Launch Pad").rules,
    }
    expect(() => bakeInstructions(SHARED, poisoned)).toThrow(/carries The Launch Pad's rules/)
  })

  it("throws if another brand's price list gets in", () => {
    const poisoned = {
      ...brand("Bucket Baddie"),
      pricing: brand("The Launch Pad").pricing,
    }
    expect(() => bakeInstructions(SHARED, poisoned)).toThrow(/carries The Launch Pad's prices/)
  })
})
