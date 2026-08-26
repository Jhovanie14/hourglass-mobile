import { describe, it, expect } from "vitest"
import {
  aiAgentSettings,
  assistantIdForLabel,
  isAIAgentLabel,
  brandNameForLabel,
  conversationMessagesToSegments,
  parseAIRingTimeoutSecs,
  DEFAULT_AI_RING_TIMEOUT_SECS,
} from "./ai-agent"

describe("aiAgentSettings", () => {
  it("is null when either env var is missing or empty", () => {
    expect(aiAgentSettings({})).toBeNull()
    expect(aiAgentSettings({ TELNYX_AI_ASSISTANT_ID: "a-1" })).toBeNull()
    expect(aiAgentSettings({ AI_AGENT_LABELS: "TLP" })).toBeNull()
    expect(aiAgentSettings({ TELNYX_AI_ASSISTANT_ID: "  ", AI_AGENT_LABELS: "TLP" })).toBeNull()
    expect(aiAgentSettings({ TELNYX_AI_ASSISTANT_ID: "a-1", AI_AGENT_LABELS: " , " })).toBeNull()
  })

  it("parses and normalizes labels", () => {
    expect(
      aiAgentSettings({ TELNYX_AI_ASSISTANT_ID: "a-1", AI_AGENT_LABELS: " tlp , Str " })
    ).toEqual({
      assistantId: "a-1",
      labels: ["TLP", "STR"],
      ringTimeoutSecs: DEFAULT_AI_RING_TIMEOUT_SECS,
    })
  })

  it("carries the configured ring timeout", () => {
    expect(
      aiAgentSettings({
        TELNYX_AI_ASSISTANT_ID: "a-1",
        AI_AGENT_LABELS: "TLP",
        AI_AGENT_RING_TIMEOUT_SECS: "15",
      })?.ringTimeoutSecs
    ).toBe(15)
  })
})

describe("parseAIRingTimeoutSecs", () => {
  it("defaults when unset or unparseable", () => {
    expect(parseAIRingTimeoutSecs(undefined)).toBe(DEFAULT_AI_RING_TIMEOUT_SECS)
    expect(parseAIRingTimeoutSecs("")).toBe(DEFAULT_AI_RING_TIMEOUT_SECS)
    expect(parseAIRingTimeoutSecs("soon")).toBe(DEFAULT_AI_RING_TIMEOUT_SECS)
  })

  it("clamps so agents always get a real ring and callers never wait forever", () => {
    expect(parseAIRingTimeoutSecs("0")).toBe(5)
    expect(parseAIRingTimeoutSecs("-30")).toBe(5)
    expect(parseAIRingTimeoutSecs("600")).toBe(60)
  })

  it("accepts sensible values as-is", () => {
    expect(parseAIRingTimeoutSecs("15")).toBe(15)
    expect(parseAIRingTimeoutSecs(" 25 ")).toBe(25)
  })
})

describe("isAIAgentLabel", () => {
  const settings = { assistantId: "a-1", labels: ["TLP"], ringTimeoutSecs: 20 }
  it("matches case-insensitively and rejects everything else", () => {
    expect(isAIAgentLabel(settings, "tlp")).toBe(true)
    expect(isAIAgentLabel(settings, "TLP")).toBe(true)
    expect(isAIAgentLabel(settings, "HGI")).toBe(false)
    expect(isAIAgentLabel(settings, null)).toBe(false)
    expect(isAIAgentLabel(null, "TLP")).toBe(false)
  })
})

describe("brandNameForLabel", () => {
  it("falls back to the label when no mapping is configured", () => {
    expect(brandNameForLabel("TLP", {})).toBe("TLP")
    expect(brandNameForLabel("TLP", { AI_BRAND_NAMES: "" })).toBe("TLP")
  })

  it("resolves mapped labels case-insensitively, with whitespace tolerance", () => {
    const env = { AI_BRAND_NAMES: " TLP : The Launch Pad , STR: Star Realty " }
    expect(brandNameForLabel("TLP", env)).toBe("The Launch Pad")
    expect(brandNameForLabel("tlp", env)).toBe("The Launch Pad")
    expect(brandNameForLabel("STR", env)).toBe("Star Realty")
    expect(brandNameForLabel("HGI", env)).toBe("HGI")
  })

  it("ignores malformed entries", () => {
    expect(brandNameForLabel("TLP", { AI_BRAND_NAMES: "garbage,TLP:The Launch Pad" })).toBe(
      "The Launch Pad"
    )
    expect(brandNameForLabel("TLP", { AI_BRAND_NAMES: "garbage" })).toBe("TLP")
  })
})

describe("conversationMessagesToSegments", () => {
  const base = "2026-08-13T10:00:00.000Z"

  it("maps assistant→agent and user→contact, dropping tool calls and empty text", () => {
    const segments = conversationMessagesToSegments(
      [
        { role: "assistant", text: " Hi, this is TLP. ", sent_at: "2026-08-13T10:00:01.000Z" },
        { role: "tool", text: "lookup()" },
        { role: "user", text: "", sent_at: "2026-08-13T10:00:02.000Z" },
        { role: "user", text: "I need a quote", sent_at: "2026-08-13T10:00:03.000Z" },
      ],
      base
    )
    expect(segments).toEqual([
      {
        speaker: "agent",
        transcript: "Hi, this is TLP.",
        confidence: null,
        occurred_at: "2026-08-13T10:00:01.000Z",
      },
      {
        speaker: "contact",
        transcript: "I need a quote",
        confidence: null,
        occurred_at: "2026-08-13T10:00:03.000Z",
      },
    ])
  })

  it("falls back sent_at → created_at → fallbackTime + index (monotonic)", () => {
    const segments = conversationMessagesToSegments(
      [
        { role: "assistant", text: "a", created_at: "2026-08-13T09:59:00.000Z" },
        { role: "user", text: "b" },
        { role: "assistant", text: "c" },
      ],
      base
    )
    expect(segments[0].occurred_at).toBe("2026-08-13T09:59:00.000Z")
    expect(segments[1].occurred_at).toBe("2026-08-13T10:00:00.001Z")
    expect(segments[2].occurred_at).toBe("2026-08-13T10:00:00.002Z")
  })

  it("handles null text without throwing", () => {
    expect(conversationMessagesToSegments([{ role: "assistant", text: null }], base)).toEqual([])
  })
})

describe("assistantIdForLabel", () => {
  const shared = { TELNYX_AI_ASSISTANT_ID: "assistant-shared" }

  it("prefers the brand's own assistant over the shared one", () => {
    expect(
      assistantIdForLabel("Bucket Baddie", {
        ...shared,
        TELNYX_AI_ASSISTANT_ID_BUCKET_BADDIE: "assistant-bb",
      })
    ).toBe("assistant-bb")
  })

  it("derives the env key the same way slackWebhookForLabel does", () => {
    // Space becomes one underscore, so the two env families read alike:
    // TELNYX_AI_ASSISTANT_ID_BUCKET_BADDIE / SLACK_WEBHOOK_URL_BUCKET_BADDIE.
    expect(
      assistantIdForLabel("  bucket   baddie  ", {
        TELNYX_AI_ASSISTANT_ID_BUCKET_BADDIE: "assistant-bb",
      })
    ).toBe("assistant-bb")
  })

  it("falls back to the shared assistant for a brand without its own", () => {
    expect(assistantIdForLabel("The Launch Pad", shared)).toBe("assistant-shared")
  })

  it("keeps brands on separate assistants once both are configured", () => {
    const env = {
      TELNYX_AI_ASSISTANT_ID: "assistant-tlp",
      TELNYX_AI_ASSISTANT_ID_BUCKET_BADDIE: "assistant-bb",
    }
    expect(assistantIdForLabel("The Launch Pad", env)).toBe("assistant-tlp")
    expect(assistantIdForLabel("Bucket Baddie", env)).toBe("assistant-bb")
  })

  it("returns null when nothing is configured at all", () => {
    expect(assistantIdForLabel("Bucket Baddie", {})).toBeNull()
    expect(assistantIdForLabel(null, {})).toBeNull()
    expect(assistantIdForLabel(null, shared)).toBe("assistant-shared")
  })

  it("ignores a blank per-brand override rather than treating it as set", () => {
    expect(
      assistantIdForLabel("Bucket Baddie", {
        ...shared,
        TELNYX_AI_ASSISTANT_ID_BUCKET_BADDIE: "   ",
      })
    ).toBe("assistant-shared")
  })
})

describe("isAIAgentLabel across label spellings", () => {
  const settingsFor = (labels: string) =>
    aiAgentSettings({ TELNYX_AI_ASSISTANT_ID: "a1", AI_AGENT_LABELS: labels })

  it("matches the database label when env uses the short code", () => {
    // AI_AGENT_LABELS=TLP with phone_numbers.label="The Launch Pad" sent every
    // Launch Pad caller to voicemail, silently, on 2026-08-26.
    expect(isAIAgentLabel(settingsFor("TLP"), "The Launch Pad")).toBe(true)
  })

  it("matches the short code when env uses the database label", () => {
    expect(isAIAgentLabel(settingsFor("The Launch Pad"), "TLP")).toBe(true)
  })

  it("matches either spelling alongside a second brand", () => {
    for (const env of ["TLP,Bucket Baddie", "The Launch Pad,Bucket Baddie"]) {
      expect(isAIAgentLabel(settingsFor(env), "The Launch Pad"), env).toBe(true)
      expect(isAIAgentLabel(settingsFor(env), "Bucket Baddie"), env).toBe(true)
    }
  })

  it("still refuses a brand that is not configured", () => {
    // STR and HGI are live rows with no AI receptionist.
    expect(isAIAgentLabel(settingsFor("The Launch Pad"), "STR")).toBe(false)
    expect(isAIAgentLabel(settingsFor("The Launch Pad"), "HGI")).toBe(false)
    expect(isAIAgentLabel(settingsFor("The Launch Pad"), "Bucket Baddie")).toBe(false)
  })

  it("tolerates casing and stray whitespace on both sides", () => {
    expect(isAIAgentLabel(settingsFor(" bucket baddie "), "Bucket  Baddie")).toBe(true)
  })
})
