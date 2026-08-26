import { describe, expect, it } from "vitest"
import {
  brandContentForLabel,
  knownBrandLabels,
  normalizeLabel,
  resolvableLabels,
} from "./index"
import { pricingText as tlpPricingText } from "@/lib/tlp-pricing"

describe("brandContentForLabel", () => {
  it("resolves The Launch Pad to the existing wash pricing, byte for byte", () => {
    // The TLP block must not change as a side effect of adding brands. This
    // compares against the same function the live route calls today.
    const content = brandContentForLabel("The Launch Pad")
    expect(content).not.toBeNull()
    expect(content!.pricingText()).toBe(tlpPricingText())
  })

  it("resolves the live 'Bucket Baddie' label to the Bucket Baddie menu", () => {
    // This is the exact string in phone_numbers.label — the brand name, not a
    // short code. Changing it in the DB without changing the registry key here
    // silently drops the caller to an empty menu.
    const text = brandContentForLabel("Bucket Baddie")!.pricingText()
    expect(text).toContain("Bucket Baddie — current menu.")
    expect(text).toContain("Rice Bowl (regular): $11.99")
  })

  it("never serves one brand's prices to another", () => {
    const tlp = brandContentForLabel("The Launch Pad")!.pricingText()
    const bb = brandContentForLabel("Bucket Baddie")!.pricingText()
    expect(tlp).not.toContain("Bucket Baddie")
    expect(bb).not.toContain("The Launch Pad")
    expect(bb).not.toMatch(/membership/i)
  })

  it("matches labels case-insensitively, ignoring outer and repeated space", () => {
    // phone_numbers.label is hand-entered, same as in isAIAgentLabel. A
    // two-word label makes a stray double space a real possibility.
    for (const label of ["bucket baddie", " Bucket Baddie ", "BUCKET BADDIE", "Bucket  Baddie"]) {
      expect(brandContentForLabel(label)).not.toBeNull()
    }
  })

  // The exact `phone_numbers.label` values, read from the live table on
  // 2026-08-26. These are the strings that actually arrive at runtime, and
  // keying the registry on anything else fails silently — the routes just omit
  // the brand and the assistant says it cannot quote.
  it("resolves every AI-enabled label exactly as the database spells it", () => {
    expect(brandContentForLabel("The Launch Pad")).not.toBeNull()
    expect(brandContentForLabel("Bucket Baddie")).not.toBeNull()
  })

  it("resolves the TLP short code as an alias for The Launch Pad", () => {
    // AI_BRAND_NAMES uses "TLP:The Launch Pad", so either form can reach
    // AI_AGENT_LABELS. Both must land on the same content.
    expect(brandContentForLabel("TLP")!.pricingText()).toBe(
      brandContentForLabel("The Launch Pad")!.pricingText()
    )
    expect(brandContentForLabel("BB")!.pricingText()).toBe(
      brandContentForLabel("Bucket Baddie")!.pricingText()
    )
  })

  it("returns null for the non-AI brands in the same table", () => {
    // STR and HGI are live rows with no AI receptionist. They must stay null,
    // not inherit another brand's prices.
    expect(brandContentForLabel("STR")).toBeNull()
    expect(brandContentForLabel("HGI")).toBeNull()
  })

  it("returns null for an unknown, empty or missing label", () => {
    expect(brandContentForLabel("STR")).toBeNull()
    expect(brandContentForLabel("")).toBeNull()
    expect(brandContentForLabel(null)).toBeNull()
    expect(brandContentForLabel(undefined)).toBeNull()
  })

  it("gives Bucket Baddie hours and TLP none", () => {
    const bb = brandContentForLabel("Bucket Baddie")!
    expect(bb.hours).not.toBeNull()
    expect(bb.hours!.timeZone).toBe("America/Chicago")
    // TLP has never published hours through the assistant.
    expect(brandContentForLabel("The Launch Pad")!.hours).toBeNull()
  })
})

describe("knownBrandLabels", () => {
  it("lists the labels that have content", () => {
    expect(knownBrandLabels().sort()).toEqual(["BUCKET BADDIE", "THE LAUNCH PAD"])
  })

  it("stores every key already normalised, so lookups can match", () => {
    for (const label of resolvableLabels()) {
      expect(label).toBe(normalizeLabel(label))
    }
  })

  it("resolves everything it claims to resolve", () => {
    for (const label of resolvableLabels()) {
      expect(brandContentForLabel(label), label).not.toBeNull()
    }
  })
})

describe("displayName", () => {
  it("is the name as a person writes it, never the upper-cased label", () => {
    // aiAgentSettings upper-cases AI_AGENT_LABELS, so deriving the spoken name
    // from env produced "thanks for calling THE LAUNCH PAD".
    for (const label of resolvableLabels()) {
      const name = brandContentForLabel(label)!.displayName
      expect(name, label).not.toBe(name.toUpperCase())
      expect(name.trim(), label).not.toBe("")
    }
  })

  it("names each brand exactly", () => {
    expect(brandContentForLabel("The Launch Pad")!.displayName).toBe("The Launch Pad")
    expect(brandContentForLabel("Bucket Baddie")!.displayName).toBe("Bucket Baddie")
    // Aliases resolve to the same spoken name, not to the alias.
    expect(brandContentForLabel("TLP")!.displayName).toBe("The Launch Pad")
  })
})
