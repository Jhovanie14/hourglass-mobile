import { describe, expect, it } from "vitest"
import { shouldOpenCallWindow, shouldCloseCallWindow } from "./call-window-policy.js"

describe("shouldOpenCallWindow", () => {
  it("opens when an inbound call starts ringing", () => {
    expect(shouldOpenCallWindow("idle", "incoming")).toBe(true)
  })
  it("does not reopen while still incoming", () => {
    expect(shouldOpenCallWindow("incoming", "incoming")).toBe(false)
  })
  it("does not open once incoming becomes active", () => {
    expect(shouldOpenCallWindow("incoming", "active")).toBe(false)
  })
  it("does not open for outbound dialing", () => {
    expect(shouldOpenCallWindow("idle", "trying")).toBe(false)
    expect(shouldOpenCallWindow("trying", "ringing")).toBe(false)
    expect(shouldOpenCallWindow("ringing", "active")).toBe(false)
  })
})

describe("shouldCloseCallWindow", () => {
  it("closes when an answered call ends", () => {
    expect(shouldCloseCallWindow("active", "idle")).toBe(true)
  })
  it("closes when an incoming call is missed or declined", () => {
    expect(shouldCloseCallWindow("incoming", "idle")).toBe(true)
  })
  it("closes when an outbound attempt ends", () => {
    expect(shouldCloseCallWindow("trying", "idle")).toBe(true)
  })
  it("stays open across live transitions", () => {
    expect(shouldCloseCallWindow("incoming", "active")).toBe(false)
    expect(shouldCloseCallWindow("trying", "active")).toBe(false)
  })
  it("no-ops when already idle", () => {
    expect(shouldCloseCallWindow("idle", "idle")).toBe(false)
  })
})
