import { describe, expect, it } from "vitest"
import {
  brandLabelFromWebhookBody,
  brandVariables,
  resolveBrandLabel,
} from "./ai-brand-variables"

/** Tuesday 2026-08-25, 16:30 America/Chicago — inside Bucket Baddie's window. */
const OPEN = new Date(Date.UTC(2026, 7, 25, 21, 30))
/** Monday 2026-08-24, 18:00 Chicago — Bucket Baddie is closed Mondays. */
const CLOSED = new Date(Date.UTC(2026, 7, 24, 23, 0))

describe("brandVariables", () => {
  it("gives Bucket Baddie its menu, its hours, and a live open flag", () => {
    const vars = brandVariables("Bucket Baddie", OPEN)!
    expect(vars.pricing).toContain("Bucket Baddie — current menu.")
    expect(vars.hours).toContain("- Monday: closed.")
    expect(vars.open_now).toBe("yes")
  })

  it("reports closed on a Monday", () => {
    expect(brandVariables("Bucket Baddie", CLOSED)!.open_now).toBe("no")
  })

  it("gives TLP its prices, its service hours, and a real open flag", () => {
    // 2026-08-25 16:30 Chicago is inside The Launch Pad's 9:30-6:30 window.
    const vars = brandVariables("The Launch Pad", OPEN)!
    expect(vars.pricing).toContain("The Launch Pad")
    expect(vars.hours).toContain("- Monday: 9:30 AM to 6:30 PM.")
    expect(vars.open_now).toBe("yes")
  })

  it("warns TLP callers about the September change while it is still ahead", () => {
    expect(brandVariables("The Launch Pad", OPEN)!.hours).toContain(
      "From 18 September these hours change to:"
    )
  })

  it("returns null for an unknown label rather than another brand's prices", () => {
    expect(brandVariables("STR", OPEN)).toBeNull()
    expect(brandVariables("", OPEN)).toBeNull()
    expect(brandVariables(null, OPEN)).toBeNull()
    expect(brandVariables(undefined, OPEN)).toBeNull()
  })

  it("never leaks one brand's content into the other", () => {
    const bb = brandVariables("Bucket Baddie", OPEN)!
    const tlp = brandVariables("The Launch Pad", OPEN)!
    expect(bb.pricing).not.toContain("The Launch Pad")
    expect(tlp.pricing).not.toContain("Bucket Baddie")
  })

  it("carries no brand policy — that is baked into each prompt at sync time", () => {
    // Identity and policy left the runtime on 2026-08-26. Only what genuinely
    // changes call to call is still sent, so a webhook that answers for the
    // wrong brand can no longer make one business speak as another.
    // See scripts/brand-prompts.mjs.
    expect(brandVariables("Bucket Baddie", OPEN)).not.toHaveProperty("brand_rules")
    expect(brandVariables("The Launch Pad", OPEN)).not.toHaveProperty("brand_rules")
  })
})

describe("brandLabelFromWebhookBody", () => {
  it("finds brand_label at the top level", () => {
    expect(brandLabelFromWebhookBody(JSON.stringify({ brand_label: "TLP" }))).toBe("TLP")
  })

  it("finds it under dynamic_variables", () => {
    const body = JSON.stringify({ dynamic_variables: { brand_label: "Bucket Baddie" } })
    expect(brandLabelFromWebhookBody(body)).toBe("Bucket Baddie")
  })

  it("finds it however deeply Telnyx nests it", () => {
    // The body shape is undocumented, so the search must not depend on a path.
    const body = JSON.stringify({
      data: {
        event_type: "conversation.started",
        payload: {
          conversation: { dynamic_variables: { brand_label: "Bucket Baddie" } },
        },
      },
    })
    expect(brandLabelFromWebhookBody(body)).toBe("Bucket Baddie")
  })

  it("finds it inside an array", () => {
    const body = JSON.stringify({ items: [{ noise: 1 }, { brand_label: "TLP" }] })
    expect(brandLabelFromWebhookBody(body)).toBe("TLP")
  })

  it("trims surrounding whitespace", () => {
    expect(brandLabelFromWebhookBody(JSON.stringify({ brand_label: "  TLP " }))).toBe("TLP")
  })

  it("returns null when the key is absent", () => {
    expect(brandLabelFromWebhookBody(JSON.stringify({ call_control_id: "abc" }))).toBeNull()
  })

  it("returns null for a blank or non-string value", () => {
    expect(brandLabelFromWebhookBody(JSON.stringify({ brand_label: "   " }))).toBeNull()
    expect(brandLabelFromWebhookBody(JSON.stringify({ brand_label: 42 }))).toBeNull()
    expect(brandLabelFromWebhookBody(JSON.stringify({ brand_label: null }))).toBeNull()
  })

  it("returns null rather than throwing on unparseable or empty bodies", () => {
    expect(brandLabelFromWebhookBody("not json")).toBeNull()
    expect(brandLabelFromWebhookBody("")).toBeNull()
    expect(brandLabelFromWebhookBody("null")).toBeNull()
  })

  it("gives up past the depth cap instead of walking forever", () => {
    // 20 levels deep; the cap is 8.
    let nested: Record<string, unknown> = { brand_label: "TLP" }
    for (let i = 0; i < 20; i++) nested = { down: nested }
    expect(brandLabelFromWebhookBody(JSON.stringify(nested))).toBeNull()
  })

  it("survives a self-referential shape without hanging", () => {
    // JSON can't be cyclic, but deeply repeated wide objects can still blow up
    // a naive walk. This is the shape that would.
    const wide = { a: {}, b: {}, c: {} }
    expect(brandLabelFromWebhookBody(JSON.stringify({ wide, brand_label: "TLP" }))).toBe("TLP")
  })
})

describe("resolveBrandLabel", () => {
  const body = (obj: unknown) => JSON.stringify(obj)

  it("prefers the label in the body, whatever is configured", () => {
    expect(resolveBrandLabel(body({ brand_label: "Bucket Baddie" }), ["TLP"])).toEqual({
      label: "Bucket Baddie",
      source: "body",
    })
  })

  it("falls back to the sole configured label when the body is silent", () => {
    // Today's production state. This is what makes the rewrite a no-op for TLP.
    expect(resolveBrandLabel(body({ call_control_id: "x" }), ["TLP"])).toEqual({
      label: "TLP",
      source: "sole-configured-label",
    })
  })

  it("refuses to guess once a second brand is enabled", () => {
    // Two brands and a silent body: any pick would be a coin flip, and the
    // wrong side quotes car wash prices to a chicken shop caller.
    expect(resolveBrandLabel(body({ call_control_id: "x" }), ["TLP", "BUCKET BADDIE"])).toEqual({
      label: null,
      source: "unresolved",
    })
  })

  it("refuses to guess when nothing is configured", () => {
    expect(resolveBrandLabel(body({}), [])).toEqual({
      label: null,
      source: "unresolved",
    })
  })

  it("still resolves from the body with two brands configured", () => {
    const two = ["TLP", "BUCKET BADDIE"]
    expect(resolveBrandLabel(body({ brand_label: "TLP" }), two).label).toBe("TLP")
    expect(resolveBrandLabel(body({ brand_label: "Bucket Baddie" }), two).label).toBe(
      "Bucket Baddie"
    )
  })

  it("treats an unparseable body as a silent one rather than throwing", () => {
    expect(resolveBrandLabel("<html>502</html>", ["TLP"])).toEqual({
      label: "TLP",
      source: "sole-configured-label",
    })
  })
})
