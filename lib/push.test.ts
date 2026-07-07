import { describe, it, expect } from "vitest"
import { invalidTokenIndexes } from "./push"

describe("invalidTokenIndexes", () => {
  it("flags permanently-invalid tokens only", () => {
    const responses = [
      { success: true },
      { success: false, error: { code: "messaging/registration-token-not-registered" } },
      { success: false, error: { code: "messaging/internal-error" } },
      { success: false, error: { code: "messaging/invalid-registration-token" } },
    ]
    expect(invalidTokenIndexes(responses)).toEqual([1, 3])
  })

  it("handles empty input", () => {
    expect(invalidTokenIndexes([])).toEqual([])
  })
})
