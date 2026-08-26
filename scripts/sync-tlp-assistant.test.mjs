import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import {
  extractInstructions,
  ASSISTANT_NAME,
  DYNAMIC_VARIABLE_DEFAULTS,
} from "./sync-tlp-assistant.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DOC = readFileSync(resolve(ROOT, "docs/tlp-ai-assistant-instructions.md"), "utf8")
const CR = String.fromCharCode(13)
const FENCE = "`".repeat(3)

describe("extractInstructions", () => {
  // The regression this whole script exists for: on 2026-08-19 the live
  // assistant was found holding all 8k chars of the doc, meta text included.
  it("pulls only the §1 prompt out of the real doc", () => {
    const block = extractInstructions(DOC)
    expect(block).toMatch(/^You are the receptionist for The Launch Pad/)
    expect(block).not.toContain("Paste the block in")
    expect(block).not.toContain("[OPTIONAL]")
    expect(block).not.toContain("§5 Open:")
    expect(block.length).toBeLessThan(DOC.length / 2)
  })

  it("keeps the sections the prompt depends on", () => {
    const block = extractInstructions(DOC)
    for (const heading of [
      "HOW TO BE CONSISTENT",
      "PRICING",
      "{{ pricing }}",
      "BOOKINGS",
      "TRANSFERS",
      "TAKING A MESSAGE",
      "WHAT NOT TO DO",
    ]) {
      expect(block).toContain(heading)
    }
  })

  // Telnyx stores what we send. Leaving CRLF in makes the stored length differ
  // from the sent length, which turned the post-update verification into a
  // permanent false alarm on the first real sync.
  it("sends LF only, so the stored length matches what we sent", () => {
    expect(extractInstructions(DOC)).not.toContain(CR)
    const crlfDoc = ["## §1 Instructions block", FENCE, "abc", "def", FENCE].join(CR + "\n")
    expect(extractInstructions(crlfDoc)).toBe("abc\ndef")
  })

  it("does not promise a transfer the assistant has no tool for", () => {
    const block = extractInstructions(DOC)
    expect(block).toContain("You cannot transfer this call")
    expect(block).not.toContain("use the transfer tool")
  })

  it("throws rather than shipping the wrong text when the doc shape changes", () => {
    expect(() => extractInstructions("# no heading here")).toThrow(/heading not found/)
    expect(() => extractInstructions("## §1 Instructions block\n\nno fence")).toThrow(/no fenced/)
    expect(() => extractInstructions(`## §1 Instructions block\n${FENCE}\nunclosed`)).toThrow(
      /never closed/
    )
    expect(() => extractInstructions(`## §1 Instructions block\n${FENCE}\n\n${FENCE}`)).toThrow(
      /empty/
    )
  })
})

// The shared block is what the script actually syncs now. The TLP suite above
// still guards extractInstructions itself, but this is the file that reaches
// the live assistant, so it gets its own assertions.
const SHARED = readFileSync(resolve(ROOT, "docs/ai-receptionist-instructions.md"), "utf8")

describe("the shared brand-agnostic block", () => {
  it("is what the sync script points at", () => {
    const source = readFileSync(resolve(ROOT, "scripts/sync-tlp-assistant.mjs"), "utf8")
    expect(source).toContain('resolve(ROOT, "docs/ai-receptionist-instructions.md")')
  })

  it("extracts cleanly and carries no meta text", () => {
    const block = extractInstructions(SHARED)
    expect(block).toMatch(/^You are the receptionist for \{\{ brand_name \}\}/)
    expect(block).not.toContain("Do not paste this file")
    expect(block).not.toContain("§2 What it can")
    expect(block).not.toContain(CR)
    expect(block.length).toBeLessThan(SHARED.length / 2)
  })

  it("names no brand — every brand fact arrives as a variable", () => {
    // The bug this prevents: one assistant serving two businesses, with the
    // car wash's policy hardcoded into the chicken shop's call.
    const block = extractInstructions(SHARED)
    expect(block).not.toMatch(/Launch Pad|car wash|Bucket Baddie|halal|wings/i)
  })

  it("declares every variable the routes actually send", () => {
    const block = extractInstructions(SHARED)
    for (const variable of [
      "{{ brand_name }}",
      "{{ brand_rules }}",
      "{{ pricing }}",
      "{{ hours }}",
      "{{ open_now }}",
      "{{ coupons }}",
    ]) {
      expect(block).toContain(variable)
    }
  })

  it("keeps the sections the prompt depends on", () => {
    const block = extractInstructions(SHARED)
    for (const heading of [
      "HOW TO BE CONSISTENT",
      "WHAT WE SELL AND WHAT IT COSTS",
      "HOURS",
      "DEALS",
      "TRANSFERS",
      "TAKING A MESSAGE",
      "WHAT NOT TO DO",
    ]) {
      expect(block).toContain(heading)
    }
  })

  it("still refuses to promise a transfer", () => {
    const block = extractInstructions(SHARED)
    expect(block).toContain("You cannot transfer this call")
    expect(block).not.toContain("use the transfer tool")
  })

  it("handles an empty open_now rather than assuming a clock", () => {
    const block = extractInstructions(SHARED)
    expect(block).toContain("Never work the current time out yourself")
    expect(block).toMatch(/If it says unknown/)
  })
})

describe("assistant identity and variable defaults", () => {
  it("does not name one brand on an assistant that serves several", () => {
    // Was "The Launch Pad Receptionist — Test" on the live assistant until
    // 2026-08-26 — brand-specific, and not a test.
    expect(ASSISTANT_NAME).not.toMatch(/Launch Pad|Bucket Baddie|Test/i)
  })

  it("defaults every variable the shared block reads", () => {
    const block = extractInstructions(SHARED)
    for (const key of Object.keys(DYNAMIC_VARIABLE_DEFAULTS)) {
      if (key === "agents_available" || key === "targets") continue
      expect(block).toContain(`{{ ${key} }}`)
    }
  })

  it("does not manage brand_name or brand_label", () => {
    // Per-assistant identity, not shared config. Each brand's own assistant
    // defaults them to its own name; syncing a shared value here blanked the
    // greeting to "Hi, thanks for calling ." on 2026-08-26.
    expect(DYNAMIC_VARIABLE_DEFAULTS).not.toHaveProperty("brand_name")
    expect(DYNAMIC_VARIABLE_DEFAULTS).not.toHaveProperty("brand_label")
  })

  it("defaults pricing to an empty string, never null", () => {
    // The live default was null, which risks rendering "null" into the prompt.
    expect(DYNAMIC_VARIABLE_DEFAULTS.pricing).toBe("")
    expect(DYNAMIC_VARIABLE_DEFAULTS.pricing).not.toBeNull()
  })

  it("defaults open_now to unknown rather than claiming open or shut", () => {
    expect(DYNAMIC_VARIABLE_DEFAULTS.open_now).toBe("unknown")
  })

  it("keeps every default falsy-or-unknown so it degrades to taking a message", () => {
    for (const [key, value] of Object.entries(DYNAMIC_VARIABLE_DEFAULTS)) {
      expect(typeof value, `${key} must be a string for Telnyx`).toBe("string")
      expect(["", "unknown", "false", "[]"], `${key} would assert something`).toContain(value)
    }
  })
})
