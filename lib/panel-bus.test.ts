import { describe, it, expect } from "vitest"
import {
  isPanelCommand,
  isPanelEvent,
  IDLE_STATE,
  PANEL_SOURCE,
} from "./panel-bus"

describe("isPanelEvent", () => {
  it("accepts every event type", () => {
    for (const e of [
      { source: PANEL_SOURCE, type: "state-sync", state: IDLE_STATE },
      { source: PANEL_SOURCE, type: "incoming", caller: "+15551234567", label: "HGI" },
      { source: PANEL_SOURCE, type: "call-active" },
      { source: PANEL_SOURCE, type: "call-ended" },
      { source: PANEL_SOURCE, type: "auth-required" },
      { source: PANEL_SOURCE, type: "mic-blocked" },
    ]) {
      expect(isPanelEvent(e)).toBe(true)
    }
  })

  it("rejects wrong source, commands, junk, and nullish", () => {
    expect(isPanelEvent({ source: "evil", type: "incoming" })).toBe(false)
    expect(isPanelEvent({ source: PANEL_SOURCE, type: "cmd", cmd: "answer" })).toBe(false)
    expect(isPanelEvent({ type: "incoming" })).toBe(false)
    expect(isPanelEvent(null)).toBe(false)
    expect(isPanelEvent("incoming")).toBe(false)
  })
})

describe("isPanelCommand", () => {
  it("accepts every command", () => {
    for (const c of [
      { source: PANEL_SOURCE, type: "cmd", cmd: "dial", to: "+15551234567", callerId: "+15550001111" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "answer" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "decline" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "hangup" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "mute" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "unmute" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "dtmf", digit: "5" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "speak", text: "hello" },
      { source: PANEL_SOURCE, type: "cmd", cmd: "set-online", online: false },
    ]) {
      expect(isPanelCommand(c)).toBe(true)
    }
  })

  it("rejects events, unknown cmds, wrong source, and nullish", () => {
    expect(isPanelCommand({ source: PANEL_SOURCE, type: "call-active" })).toBe(false)
    expect(isPanelCommand({ source: PANEL_SOURCE, type: "cmd", cmd: "self-destruct" })).toBe(false)
    expect(isPanelCommand({ source: "evil", type: "cmd", cmd: "answer" })).toBe(false)
    expect(isPanelCommand(undefined)).toBe(false)
  })
})
