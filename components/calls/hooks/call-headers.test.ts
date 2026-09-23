import { describe, it, expect } from "vitest"
import { lineFromHeaders, sipHeader } from "./call-headers"

const call = (customHeaders?: unknown) => ({ options: { customHeaders } })

describe("sipHeader", () => {
  it("finds a header by name, case-insensitively", () => {
    const c = call([{ name: "x-caller-number", value: "+15551234567" }])
    expect(sipHeader(c, "X-Caller-Number")).toBe("+15551234567")
  })

  it("returns null when the header, the list, or the call is missing", () => {
    expect(sipHeader(call([{ name: "Other", value: "x" }]), "X-Line-Label")).toBeNull()
    expect(sipHeader(call(undefined), "X-Line-Label")).toBeNull()
    expect(sipHeader(null, "X-Line-Label")).toBeNull()
  })

  it("treats an empty value as absent", () => {
    expect(sipHeader(call([{ name: "X-Line-Label", value: "" }]), "X-Line-Label")).toBeNull()
  })
})

describe("lineFromHeaders", () => {
  it("returns the line the call came in on", () => {
    const c = call([
      { name: "X-Caller-Number", value: "+15551234567" },
      { name: "X-Line-Label", value: "Bucket Baddie" },
      { name: "X-Line-Number", value: "+18326501126" },
    ])
    expect(lineFromHeaders(c)).toEqual({ label: "Bucket Baddie", phone_number: "+18326501126" })
  })

  it("returns null unless both label and number are present", () => {
    expect(lineFromHeaders(call([{ name: "X-Line-Label", value: "STR" }]))).toBeNull()
    expect(lineFromHeaders(call([]))).toBeNull()
  })
})
