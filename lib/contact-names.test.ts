import { describe, it, expect } from "vitest"
import { buildContactNameMap } from "./contact-names"

describe("buildContactNameMap", () => {
  it("keys names by contact_number", () => {
    const map = buildContactNameMap([
      { contact_number: "+1", name: "Alice", updated_at: "2026-01-01T00:00:00Z" },
    ])
    expect(map["+1"]).toBe("Alice")
  })

  it("keeps the latest updated_at when a number has multiple rows", () => {
    const map = buildContactNameMap([
      { contact_number: "+1", name: "Old", updated_at: "2026-01-01T00:00:00Z" },
      { contact_number: "+1", name: "New", updated_at: "2026-05-01T00:00:00Z" },
    ])
    expect(map["+1"]).toBe("New")
  })

  it("returns {} for empty input", () => {
    expect(buildContactNameMap([])).toEqual({})
  })
})
