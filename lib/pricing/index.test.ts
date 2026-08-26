import { describe, expect, it } from "vitest"
import { brandContentForLabel, knownBrandLabels, normalizeLabel } from "./index"
import { pricingText as tlpPricingText } from "@/lib/tlp-pricing"

describe("brandContentForLabel", () => {
  it("resolves TLP to the existing wash pricing, byte for byte", () => {
    // The TLP block must not change as a side effect of adding brands. This
    // compares against the same function the live route calls today.
    const content = brandContentForLabel("TLP")
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
    const tlp = brandContentForLabel("TLP")!.pricingText()
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

  it("does not resolve the old 'BB' short code", () => {
    // Guards the correction made on 2026-08-26: the registry was keyed on "BB"
    // before the live label was confirmed as "Bucket Baddie".
    expect(brandContentForLabel("BB")).toBeNull()
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
    expect(brandContentForLabel("TLP")!.hours).toBeNull()
  })
})

describe("knownBrandLabels", () => {
  it("lists the labels that have content", () => {
    expect(knownBrandLabels().sort()).toEqual(["BUCKET BADDIE", "TLP"])
  })

  it("stores every key already normalised, so lookups can match", () => {
    for (const label of knownBrandLabels()) {
      expect(label).toBe(normalizeLabel(label))
    }
  })
})
