import { describe, it, expect } from "vitest"
import { isValidE164 } from "./phone"

describe("isValidE164", () => {
  it("accepts valid US and PH numbers in E.164", () => {
    expect(isValidE164("+12109348999")).toBe(true)
    expect(isValidE164("+639171234567")).toBe(true)
  })

  it("rejects numbers missing the + / country code", () => {
    expect(isValidE164("12109348999")).toBe(false)
    expect(isValidE164("09171234567")).toBe(false)
    expect(isValidE164("2109348999")).toBe(false)
  })

  it("rejects junk, empty, and nullish values", () => {
    expect(isValidE164("nope")).toBe(false)
    expect(isValidE164("+123")).toBe(false)
    expect(isValidE164("")).toBe(false)
    expect(isValidE164(null)).toBe(false)
    expect(isValidE164(undefined)).toBe(false)
  })
})
