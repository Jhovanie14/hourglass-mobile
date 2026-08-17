import { describe, expect, it } from "vitest"
import {
  MAX_TRANSFER_TARGETS,
  FAIL_SAFE_VARIABLES,
  transferVariables,
  wrapDynamicVariables,
} from "./ai-transfer"

const agent = (n: number) => ({ userId: `user-${n}`, sipUsername: `gencred${n}` })

describe("transferVariables", () => {
  it("reports no availability and no targets when nobody is online", () => {
    expect(transferVariables([])).toEqual({ agents_available: false, targets: [] })
  })

  it("maps one online agent to a Telnyx SIP URI target", () => {
    expect(transferVariables([agent(1)])).toEqual({
      agents_available: true,
      targets: [{ to: "sip:gencred1@sip.telnyx.com", name: "Agent 1" }],
    })
  })

  it("preserves order across several agents", () => {
    const targets = transferVariables([agent(1), agent(2), agent(3)]).targets
    expect(targets.map((t) => t.to)).toEqual([
      "sip:gencred1@sip.telnyx.com",
      "sip:gencred2@sip.telnyx.com",
      "sip:gencred3@sip.telnyx.com",
    ])
  })

  it("caps the target list so a large team cannot bloat the payload", () => {
    const many = Array.from({ length: MAX_TRANSFER_TARGETS + 4 }, (_, i) => agent(i))
    expect(transferVariables(many).targets).toHaveLength(MAX_TRANSFER_TARGETS)
  })

  it("skips agents with a blank sip username rather than emitting a broken URI", () => {
    const vars = transferVariables([{ userId: "u", sipUsername: "  " }, agent(2)])
    expect(vars.targets).toEqual([{ to: "sip:gencred2@sip.telnyx.com", name: "Agent 1" }])
    expect(vars.agents_available).toBe(true)
  })

  it("reports no availability when every agent was unusable", () => {
    expect(transferVariables([{ userId: "u", sipUsername: "" }])).toEqual({
      agents_available: false,
      targets: [],
    })
  })
})

describe("FAIL_SAFE_VARIABLES", () => {
  it("is the take-a-message state, so any failure degrades to today's behaviour", () => {
    expect(FAIL_SAFE_VARIABLES).toEqual({ agents_available: false, targets: [] })
  })
})

describe("wrapDynamicVariables", () => {
  it("nests under a top-level dynamic_variables key (Telnyx ignores a flat object)", () => {
    expect(wrapDynamicVariables({ agents_available: false, targets: [] })).toEqual({
      dynamic_variables: { agents_available: false, targets: [] },
    })
  })
})
