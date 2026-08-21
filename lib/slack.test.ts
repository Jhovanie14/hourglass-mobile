import { describe, it, expect, vi, afterEach } from "vitest"
import {
  slackWebhookForLabel,
  escapeSlackText,
  buildAIRecordingMessage,
  buildAISummaryMessage,
  parseAISummaryResult,
  postToSlack,
} from "./slack"

const blockTexts = (message: { blocks: Record<string, unknown>[] }): string =>
  message.blocks.map((b) => JSON.stringify(b)).join("\n")

describe("slackWebhookForLabel", () => {
  it("prefers the per-label override, then the generic URL, then null", () => {
    const env = {
      SLACK_WEBHOOK_URL: "https://hooks.slack/general",
      SLACK_WEBHOOK_URL_TLP: "https://hooks.slack/tlp",
    }
    expect(slackWebhookForLabel("tlp", env)).toBe("https://hooks.slack/tlp")
    expect(slackWebhookForLabel("STR", env)).toBe("https://hooks.slack/general")
    expect(slackWebhookForLabel(null, env)).toBe("https://hooks.slack/general")
    expect(slackWebhookForLabel("TLP", {})).toBeNull()
  })

  it("normalizes odd labels into env-safe keys (no edge underscores)", () => {
    const env = { SLACK_WEBHOOK_URL_MY_BRAND: "https://hooks.slack/mb" }
    expect(slackWebhookForLabel("My Brand!", env)).toBe("https://hooks.slack/mb")
  })
})

describe("escapeSlackText", () => {
  it("escapes the three mrkdwn specials", () => {
    expect(escapeSlackText("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d")
  })
})

describe("buildAIRecordingMessage", () => {
  it("links the audio with expiry note", () => {
    const message = buildAIRecordingMessage({
      brandLabel: "TLP",
      caller: "+18325550100",
      url: "https://signed.example/rec.mp3",
      expiresInDays: 7,
    })
    const joined = blockTexts(message)
    expect(joined).toContain("https://signed.example/rec.mp3")
    expect(joined).toContain("7 days")
  })
})

describe("parseAISummaryResult", () => {
  const full = {
    why_they_called: "Price for a full detail on a Suburban",
    what_the_ai_did: "Quoted Express Complete Detail at $65",
    outcome: "Caller said they would think about it",
    knowledge_gaps: ["Asked if we are open Sunday"],
    at_risk: ["Wanted to book Saturday 10am"],
  }

  it("reads a structured object result", () => {
    expect(parseAISummaryResult([{ result: full }])).toEqual(full)
  })

  it("reads the same payload delivered as a JSON string", () => {
    expect(parseAISummaryResult([{ result: JSON.stringify(full) }])).toEqual(full)
  })

  it("accepts a partial object as long as one known field carries content", () => {
    expect(parseAISummaryResult([{ result: { outcome: "Took a message" } }])).toEqual({
      outcome: "Took a message",
    })
  })

  it("picks the structured insight out of a mixed results array", () => {
    expect(parseAISummaryResult([{ result: "some prose" }, { result: full }])).toEqual(full)
  })

  it("returns null for prose, malformed, empty, and unrelated shapes", () => {
    expect(parseAISummaryResult([{ result: "Caller asked about pricing" }])).toBeNull()
    expect(parseAISummaryResult([{ result: "{not json" }])).toBeNull()
    expect(parseAISummaryResult([{ result: { sentiment: "positive" } }])).toBeNull()
    expect(parseAISummaryResult([])).toBeNull()
    expect(parseAISummaryResult(undefined)).toBeNull()
  })

  it("coerces a stringified list into an array and drops blank entries", () => {
    const parsed = parseAISummaryResult([
      { result: { outcome: "x", knowledge_gaps: "Sunday hours", at_risk: ["", "  "] } },
    ])
    expect(parsed?.knowledge_gaps).toEqual(["Sunday hours"])
    expect(parsed?.at_risk).toEqual([])
  })
})

describe("buildAISummaryMessage", () => {
  const baseArgs = {
    brandLabel: "The Launch Pad",
    caller: "+18325550100",
    durationSec: 102,
    dashboardUrl: "https://x.test/dashboard/calls",
  }

  const structured = [
    {
      result: {
        why_they_called: "Price for a full detail",
        what_the_ai_did: "Quoted $65 & mentioned the membership",
        outcome: "Will think about it",
        knowledge_gaps: ["Asked if we are open <Sunday>"],
        at_risk: ["Wanted to book Saturday"],
      },
    },
  ]

  it("renders every section of a structured summary with caller and duration", () => {
    const joined = blockTexts(buildAISummaryMessage({ ...baseArgs, results: structured }))
    expect(joined).toContain("The Launch Pad")
    expect(joined).toContain("+18325550100")
    expect(joined).toContain("1m 42s")
    expect(joined).toContain("Why they called")
    expect(joined).toContain("Price for a full detail")
    expect(joined).toContain("What the AI did")
    expect(joined).toContain("Outcome")
    expect(joined).toContain("What we're missing")
    expect(joined).toContain("At risk")
    expect(joined).toContain("Wanted to book Saturday")
    expect(joined).toContain("https://x.test/dashboard/calls")
  })

  it("escapes mrkdwn specials inside summary fields", () => {
    const joined = blockTexts(buildAISummaryMessage({ ...baseArgs, results: structured }))
    expect(joined).toContain("Quoted $65 &amp; mentioned the membership")
    expect(joined).toContain("open &lt;Sunday&gt;")
    expect(joined).not.toContain("<Sunday>")
  })

  it("always prints the missing-info note, even when nothing was flagged", () => {
    const joined = blockTexts(
      buildAISummaryMessage({
        ...baseArgs,
        results: [{ result: { outcome: "Took a message", knowledge_gaps: [], at_risk: [] } }],
      })
    )
    expect(joined).toContain("What we're missing")
    expect(joined).toContain("Nothing flagged")
  })

  it("omits the at-risk section when nothing is at risk", () => {
    const joined = blockTexts(
      buildAISummaryMessage({
        ...baseArgs,
        results: [{ result: { outcome: "Took a message", at_risk: [] } }],
      })
    )
    expect(joined).not.toContain("At risk")
  })

  it("falls back to the raw insight text rather than posting an empty card", () => {
    const joined = blockTexts(
      buildAISummaryMessage({
        ...baseArgs,
        results: [{ result: "Caller asked about pricing" }, { result: { sentiment: "positive" } }],
      })
    )
    expect(joined).toContain("Caller asked about pricing")
    expect(joined).toContain("sentiment")
    expect(joined).toContain("What we're missing")
    expect(joined).toContain("+18325550100")
  })

  it("still posts a usable card when no insight was generated at all", () => {
    const joined = blockTexts(buildAISummaryMessage({ ...baseArgs, results: [] }))
    expect(joined).toContain("+18325550100")
    expect(joined).toContain("No summary generated")
    expect(joined).toContain("https://x.test/dashboard/calls")
  })

  it("keeps every section under Slack's 3000-char cap", () => {
    const long = "y".repeat(9000)
    const message = buildAISummaryMessage({
      ...baseArgs,
      results: [{ result: { why_they_called: long, knowledge_gaps: [long] } }],
    })
    for (const block of message.blocks) {
      const text = (block as { text?: { text?: string } }).text?.text
      if (text) expect(text.length).toBeLessThanOrEqual(3000)
    }
    expect(blockTexts(message)).toContain("yyy")
  })

  it("summarizes the call in message.text for notifications", () => {
    const message = buildAISummaryMessage({ ...baseArgs, results: structured })
    expect(message.text).toContain("The Launch Pad")
    expect(message.text).toContain("+18325550100")
  })
})

describe("postToSlack", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("resolves on 200", async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", ok)
    await expect(
      postToSlack("https://hooks.slack/x", { text: "t", blocks: [] })
    ).resolves.toBeUndefined()
    expect(ok).toHaveBeenCalledOnce()
  })

  it("throws on non-2xx with the status in the message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" })
    )
    await expect(postToSlack("https://hooks.slack/x", { text: "t", blocks: [] })).rejects.toThrow(
      /500/
    )
  })
})
