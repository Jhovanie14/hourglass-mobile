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

  it("never lets one brand's prompt mention the other", () => {
    // The bug this whole file exists to prevent: on 2026-08-26 the Bucket
    // Baddie assistant offered car washes, because its identity and policy
    // arrived over a network call that resolved to the wrong brand.
    const bb = bakeInstructions(SHARED, brand("Bucket Baddie"))
    const tlp = bakeInstructions(SHARED, brand("The Launch Pad"))
    expect(bb).not.toContain("The Launch Pad")
    expect(bb).not.toMatch(/car wash|membership|tire shine/i)
    expect(tlp).not.toContain("Bucket Baddie")
    expect(tlp).not.toMatch(/halal|wings|glaze/i)
  })

  it("bakes in the menu, so the assistant knows it without a webhook", () => {
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(baked).toContain("Rice Bowl (regular): $11.99")
    expect(baked).toContain("Ghost Pepper")      // a glaze
    expect(baked).toContain("Ranch Drip")        // a dip
    expect(baked).toContain("SAME PRICE, DIFFERENT ITEMS")
    expect(baked).not.toContain("{{ pricing }}")
  })

  it("bakes in the opening hours and the address", () => {
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    expect(baked).toContain("- Monday: closed.")
    expect(baked).toContain("- Friday: 4 PM to midnight.")
    expect(baked).toContain("10410 South Main Street, Houston, Texas 77025")
    expect(baked).not.toContain("{{ hours }}")
  })

  it("bakes The Launch Pad's own prices and no hours", () => {
    const baked = bakeInstructions(SHARED, brand("The Launch Pad"))
    expect(baked).toContain("Express Complete Detail")
    expect(baked).not.toContain("{{ pricing }}")
    expect(baked).not.toContain("{{ hours }}")
  })

  it("leaves as placeholders only what cannot be known at sync time", () => {
    // Whether we are open this minute, live deals, and agent presence. Baking
    // any of those would freeze them at the moment of the last sync.
    const baked = bakeInstructions(SHARED, brand("Bucket Baddie"))
    for (const v of ["{{ open_now }}", "{{ coupons }}"]) {
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

  it("throws if a brand's own rules name another brand", () => {
    const poisoned = { ...brand("Bucket Baddie"), rules: "Ask about The Launch Pad." }
    expect(() => bakeInstructions(SHARED, poisoned)).toThrow(/mentions The Launch Pad/)
  })
})
