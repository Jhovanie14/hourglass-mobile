import { describe, it, expect } from "vitest"
import {
  isStartKeyword,
  isStopKeyword,
  normalizeUsPhone,
  validateOptIn,
} from "./sms-consent"

describe("isStopKeyword", () => {
  it("matches STOP keywords regardless of case/whitespace/punctuation", () => {
    for (const t of ["STOP", "stop", "  Stop  ", "STOP.", "unsubscribe", "QUIT"]) {
      expect(isStopKeyword(t)).toBe(true)
    }
  })

  it("does not match STOP inside a sentence", () => {
    expect(isStopKeyword("please don't stop texting me")).toBe(false)
    expect(isStopKeyword("stop by the office tomorrow")).toBe(false)
  })
})

describe("isStartKeyword", () => {
  it("matches START keywords", () => {
    for (const t of ["START", "start", "UNSTOP", "unstop"]) {
      expect(isStartKeyword(t)).toBe(true)
    }
  })

  it("does not match START inside a sentence", () => {
    expect(isStartKeyword("when does it start?")).toBe(false)
  })
})

describe("normalizeUsPhone", () => {
  it("normalizes a 10-digit number to E.164", () => {
    expect(normalizeUsPhone("2109348999")).toBe("+12109348999")
  })

  it("normalizes a formatted 10-digit number", () => {
    expect(normalizeUsPhone("(210) 934-8999")).toBe("+12109348999")
  })

  it("normalizes an 11-digit number starting with 1", () => {
    expect(normalizeUsPhone("12109348999")).toBe("+12109348999")
  })

  it("normalizes a number already in +1 form", () => {
    expect(normalizeUsPhone("+1 210 934 8999")).toBe("+12109348999")
  })

  it("rejects too-short numbers", () => {
    expect(normalizeUsPhone("12345")).toBeNull()
  })

  it("rejects too-long numbers", () => {
    expect(normalizeUsPhone("210934899900")).toBeNull()
  })
})

describe("validateOptIn", () => {
  const valid = { name: "Jane Doe", phone: "210-934-8999", consent: true }

  it("accepts a fully valid submission", () => {
    const result = validateOptIn(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ name: "Jane Doe", phone: "+12109348999" })
    }
  })

  it("trims the name", () => {
    const result = validateOptIn({ ...valid, name: "  Jane Doe  " })
    expect(result.ok && result.value.name).toBe("Jane Doe")
  })

  it("rejects a missing/short name", () => {
    const result = validateOptIn({ ...valid, name: "J" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.name).toBeDefined()
  })

  it("rejects an invalid phone", () => {
    const result = validateOptIn({ ...valid, phone: "nope" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.phone).toBeDefined()
  })

  it("rejects when consent is not explicitly true", () => {
    for (const consent of [false, undefined, "true", 1]) {
      const result = validateOptIn({ ...valid, consent })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors.consent).toBeDefined()
    }
  })

  it("reports multiple errors at once", () => {
    const result = validateOptIn({ name: "", phone: "", consent: false })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual([
        "consent",
        "name",
        "phone",
      ])
    }
  })
})
