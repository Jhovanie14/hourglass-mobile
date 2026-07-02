import { describe, expect, it } from "vitest"
import { canInjectWidget, shouldShowWidget } from "./widget-policy.js"

describe("canInjectWidget", () => {
  it("allows normal http/https pages", () => {
    expect(canInjectWidget("https://app.example.com/leads")).toBe(true)
    expect(canInjectWidget("http://localhost:3000/")).toBe(true)
  })
  it("blocks browser-internal and store pages", () => {
    expect(canInjectWidget("chrome://extensions")).toBe(false)
    expect(canInjectWidget("chrome-extension://abc/side.html")).toBe(false)
    expect(canInjectWidget("https://chromewebstore.google.com/detail/x")).toBe(false)
    expect(canInjectWidget("https://chrome.google.com/webstore/x")).toBe(false)
    expect(canInjectWidget("about:blank")).toBe(false)
    expect(canInjectWidget("edge://settings")).toBe(false)
    expect(canInjectWidget("view-source:https://x.com")).toBe(false)
    expect(canInjectWidget("file:///C:/doc.pdf")).toBe(false)
  })
  it("is false for empty/garbage input", () => {
    expect(canInjectWidget("")).toBe(false)
    expect(canInjectWidget("not a url")).toBe(false)
  })
})

describe("shouldShowWidget", () => {
  it("shows for any live call status", () => {
    for (const s of ["incoming", "ringing", "trying", "active"]) {
      expect(shouldShowWidget(s)).toBe(true)
    }
  })
  it("hides when idle or unknown", () => {
    expect(shouldShowWidget("idle")).toBe(false)
    expect(shouldShowWidget("")).toBe(false)
  })
})
