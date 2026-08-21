import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { extractInstructions } from "./sync-tlp-assistant.mjs"

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
