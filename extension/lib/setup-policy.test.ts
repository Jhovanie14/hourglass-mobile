import { describe, expect, it } from "vitest"
import { needsSetup } from "./setup-policy.js"

describe("needsSetup", () => {
  it("is false only when signed in AND mic granted", () => {
    expect(needsSetup({ signedIn: true, micGranted: true })).toBe(false)
  })
  it("is true if either is missing", () => {
    expect(needsSetup({ signedIn: false, micGranted: true })).toBe(true)
    expect(needsSetup({ signedIn: true, micGranted: false })).toBe(true)
    expect(needsSetup({ signedIn: false, micGranted: false })).toBe(true)
  })
})
