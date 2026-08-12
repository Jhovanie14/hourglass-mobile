import { describe, it, expect } from "vitest"
import {
  aiAgentSettings,
  isAIAgentLabel,
  conversationMessagesToSegments,
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
    ).toEqual({ assistantId: "a-1", labels: ["TLP", "STR"] })
  })
})

describe("isAIAgentLabel", () => {
  const settings = { assistantId: "a-1", labels: ["TLP"] }
  it("matches case-insensitively and rejects everything else", () => {
    expect(isAIAgentLabel(settings, "tlp")).toBe(true)
    expect(isAIAgentLabel(settings, "TLP")).toBe(true)
    expect(isAIAgentLabel(settings, "HGI")).toBe(false)
    expect(isAIAgentLabel(settings, null)).toBe(false)
    expect(isAIAgentLabel(null, "TLP")).toBe(false)
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
