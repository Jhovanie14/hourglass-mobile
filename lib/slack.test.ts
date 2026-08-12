import { describe, it, expect, vi, afterEach } from "vitest"
import {
  slackWebhookForLabel,
  escapeSlackText,
  buildAICallMessage,
  buildAIRecordingMessage,
  buildAISummaryMessage,
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

describe("buildAICallMessage", () => {
  const baseArgs = {
    brandLabel: "TLP",
    caller: "+18325550100",
    durationSec: 125,
    segments: [
      { speaker: "agent" as const, transcript: "Hi <there>" },
      { speaker: "contact" as const, transcript: "I need help & fast" },
    ],
  }

  it("includes header, caller, duration, and labeled escaped transcript", () => {
    const message = buildAICallMessage(baseArgs)
    const joined = blockTexts(message)
    expect(joined).toContain("AI call · TLP")
    expect(joined).toContain("+18325550100")
    expect(joined).toContain("2m 5s")
    expect(joined).toContain("*AI:* Hi &lt;there&gt;")
    expect(joined).toContain("*Caller:* I need help &amp; fast")
    expect(message.text).toContain("TLP")
    expect(message.text).toContain("+18325550100")
  })

  it("renders a placeholder when there are no segments", () => {
    const message = buildAICallMessage({ ...baseArgs, segments: [] })
    expect(blockTexts(message)).toContain("No transcript captured")
  })

  it("shows an em dash duration when unknown", () => {
    const message = buildAICallMessage({ ...baseArgs, durationSec: null })
    expect(blockTexts(message)).toContain("—")
  })

  it("chunks long transcripts into ≤2800-char sections and truncates past 12", () => {
    const line = "x".repeat(1000)
    const segments = Array.from({ length: 60 }, () => ({
      speaker: "contact" as const,
      transcript: line,
    }))
    const message = buildAICallMessage({ ...baseArgs, segments })
    const sections = message.blocks.filter(
      (b) => b.type === "section" && JSON.stringify(b).includes("xxx")
    )
    expect(sections.length).toBeGreaterThan(1)
    expect(sections.length).toBeLessThanOrEqual(12)
    for (const s of sections) {
      const text = (s as { text?: { text?: string } }).text?.text ?? ""
      expect(text.length).toBeLessThanOrEqual(2800)
    }
    expect(blockTexts(message)).toContain("Transcript truncated")
  })

  it("hard-slices a single line longer than the section budget", () => {
    const message = buildAICallMessage({
      ...baseArgs,
      segments: [{ speaker: "contact", transcript: "y".repeat(6000) }],
    })
    const sections = message.blocks.filter((b) => JSON.stringify(b).includes("yyy"))
    expect(sections.length).toBeGreaterThan(1)
  })

  it("adds ended reason and dashboard link when given", () => {
    const message = buildAICallMessage({
      ...baseArgs,
      endedReason: "caller_hangup",
      dashboardUrl: "https://x.test/dashboard/calls",
    })
    const joined = blockTexts(message)
    expect(joined).toContain("caller_hangup")
    expect(joined).toContain("https://x.test/dashboard/calls")
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

describe("buildAISummaryMessage", () => {
  it("renders string and object results", () => {
    const message = buildAISummaryMessage({
      brandLabel: "TLP",
      caller: "+18325550100",
      results: [{ result: "Caller asked about pricing" }, { result: { sentiment: "positive" } }],
    })
    const joined = blockTexts(message)
    expect(joined).toContain("Caller asked about pricing")
    expect(joined).toContain("sentiment")
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
