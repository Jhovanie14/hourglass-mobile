# TLP AI Voice Agent → Slack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Inbound calls to AI-enabled brands (TLP first) are answered by a Telnyx AI Assistant, recorded, and — when the conversation ends — the full transcript (plus recording link and optional AI summary) is posted to Slack and stored in the existing dashboard transcript tables.

**Architecture:** Pure config/mapping logic lives in `lib/telnyx/ai-agent.ts`; Slack message building/posting in `lib/slack.ts`; two new Telnyx commands in `lib/telnyx/voice-orchestrator.ts`; all wiring in the existing voice webhook (`app/api/webhooks/telnyx/voice/route.ts`) via an `ai_handled` flag on `calls`. Transcripts come from the Telnyx AI **conversation history API** (`telnyx.ai.conversations.messages.list`) on the `call.conversation.ended` webhook — NOT from the broken real-time `call.transcription` pipeline.

**Tech Stack:** Next.js 16 App Router (nodejs runtime), telnyx SDK ^6.73.0, Supabase (admin client + storage), Slack incoming webhooks, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-tlp-ai-voice-slack-design.md`

## Global Constraints

- **Feature is dormant unless BOTH `TELNYX_AI_ASSISTANT_ID` and `AI_AGENT_LABELS` are set.** Every new path must no-op cleanly when they're unset — zero behavior change for existing flows.
- **DB prerequisite (run in Supabase dashboard before deploy — no migrations dir in this repo):**
  ```sql
  alter table calls add column ai_handled boolean not null default false;
  alter table calls add column ai_conversation_id text;
  alter table calls add column ai_recording_path text;
  ```
  plus a **private** storage bucket named `call-recordings`.
- **Env vars:** `TELNYX_AI_ASSISTANT_ID`, `AI_AGENT_LABELS` (comma-separated `phone_numbers.label`, case-insensitive), `SLACK_WEBHOOK_URL` (+ optional `SLACK_WEBHOOK_URL_<LABEL>` per-brand override), optional `APP_BASE_URL`.
- **Prettier style:** no semicolons, double quotes, 2-space indent.
- **Tests:** pure `lib/` modules only (Vitest, colocated `*.test.ts`, `npm test`). Webhook route gets manual E2E.
- **Stage only the files each task names** — the tree has unrelated uncommitted changes (`extension/manifest.json`, `extension-spike/`, zips, screenshots). Never `git add -A`.
- **No extension changes** (web deploy only).

---

## File Structure

**New files:**
- `lib/telnyx/ai-agent.ts` — env settings, label match, conversation-messages → transcript segments. + `lib/telnyx/ai-agent.test.ts`
- `lib/slack.ts` — webhook-per-label resolution, Block Kit builders, `postToSlack`. + `lib/slack.test.ts`

**Modified files:**
- `lib/telnyx/call-logging.ts` — `answeredAction` learns `aiHandled` → `"start_ai"`. + extend `lib/telnyx/call-logging.test.ts`
- `lib/telnyx/voice-orchestrator.ts` — `startAIAssistantOnCall`, `startAICallRecording`
- `app/api/webhooks/telnyx/voice/route.ts` — AI branches + two new event cases
- `types/calls.ts` — optional `ai_handled`, `ai_conversation_id`, `ai_recording_path`
- `README.md` — ops section (env vars + setup steps)

**Task order:** pure modules (1–3) → Telnyx commands (4) → webhook wiring (5) → docs + full verify (6).

---

## Task 1: `lib/telnyx/ai-agent.ts` — settings + transcript mapping

**Files:**
- Create: `lib/telnyx/ai-agent.ts`
- Test: `lib/telnyx/ai-agent.test.ts`

**Interfaces (produces):**
- `type AIAgentSettings = { assistantId: string; labels: string[] }`
- `aiAgentSettings(env: { TELNYX_AI_ASSISTANT_ID?: string; AI_AGENT_LABELS?: string }): AIAgentSettings | null`
- `isAIAgentLabel(settings: AIAgentSettings | null, label: string | null | undefined): boolean`
- `type ConversationMessage = { role: string; text?: string | null; sent_at?: string; created_at?: string }`
- `type AITranscriptSegmentInsert = { speaker: "agent" | "contact"; transcript: string; confidence: null; occurred_at: string }`
- `conversationMessagesToSegments(messages: ConversationMessage[], fallbackTime: string): AITranscriptSegmentInsert[]`

- [ ] **Step 1: Write the failing test** (`lib/telnyx/ai-agent.test.ts`)

```ts
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
})
```

- [ ] **Step 2: Run to verify it fails.** `npm test -- ai-agent` → FAIL (module not found).

- [ ] **Step 3: Implement** (`lib/telnyx/ai-agent.ts`)

```ts
// Pure helpers for the AI voice agent (Telnyx AI Assistant) flow. No SDK, DB,
// or env access at module scope so it unit-tests in plain node (mirrors the
// other lib/telnyx pure modules).

export type AIAgentSettings = {
  assistantId: string
  labels: string[] // normalized upper-case phone_numbers.label values
}

/** The feature is live only when BOTH the assistant id and at least one label
 *  are configured; anything else is dormant (today's behavior everywhere). */
export function aiAgentSettings(env: {
  TELNYX_AI_ASSISTANT_ID?: string
  AI_AGENT_LABELS?: string
}): AIAgentSettings | null {
  const assistantId = env.TELNYX_AI_ASSISTANT_ID?.trim()
  if (!assistantId) return null
  const labels = (env.AI_AGENT_LABELS ?? "")
    .split(",")
    .map((label) => label.trim().toUpperCase())
    .filter(Boolean)
  if (labels.length === 0) return null
  return { assistantId, labels }
}

/** Case-insensitive membership test against phone_numbers.label. */
export function isAIAgentLabel(
  settings: AIAgentSettings | null,
  label: string | null | undefined
): boolean {
  if (!settings || !label) return false
  return settings.labels.includes(label.trim().toUpperCase())
}

/** One message from telnyx.ai.conversations.messages.list(conversation_id). */
export type ConversationMessage = {
  role: string // "user" | "assistant" | "tool"
  text?: string | null
  sent_at?: string
  created_at?: string
}

export type AITranscriptSegmentInsert = {
  speaker: "agent" | "contact"
  transcript: string
  confidence: null
  occurred_at: string
}

/**
 * Conversation history → insertable call_transcript_segments rows. The
 * assistant maps to "agent" and the caller to "contact" so the existing
 * dashboard transcript view renders AI calls unchanged. Tool calls and empty
 * texts are dropped. API order is preserved; occurred_at prefers the
 * message's own timestamps and otherwise nudges fallbackTime by the message
 * index so the dashboard's occurred_at ordering can never scramble turns.
 */
export function conversationMessagesToSegments(
  messages: ConversationMessage[],
  fallbackTime: string
): AITranscriptSegmentInsert[] {
  const fallbackMs = new Date(fallbackTime).getTime()
  return messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        (message.role === "user" || message.role === "assistant") &&
        (message.text ?? "").trim() !== ""
    )
    .map(({ message, index }) => ({
      speaker: message.role === "assistant" ? ("agent" as const) : ("contact" as const),
      transcript: (message.text ?? "").trim(),
      confidence: null,
      occurred_at:
        message.sent_at ??
        message.created_at ??
        new Date(fallbackMs + index).toISOString(),
    }))
}
```

- [ ] **Step 4: Run to verify it passes.** `npm test -- ai-agent` → PASS.
- [ ] **Step 5: Commit** `git add lib/telnyx/ai-agent.ts lib/telnyx/ai-agent.test.ts && git commit -m "feat(ai-agent): env settings + conversation→transcript mapping"`

---

## Task 2: `lib/slack.ts` — webhook resolution, Block Kit builders, poster

**Files:**
- Create: `lib/slack.ts`
- Test: `lib/slack.test.ts`

**Interfaces (produces):**
- `slackWebhookForLabel(label: string | null | undefined, env: Record<string, string | undefined>): string | null`
- `escapeSlackText(text: string): string`
- `type SlackMessage = { text: string; blocks: Record<string, unknown>[] }`
- `buildAICallMessage(args: { brandLabel: string; caller: string; durationSec: number | null; endedReason?: string | null; segments: Array<{ speaker: "agent" | "contact" | null; transcript: string }>; dashboardUrl?: string | null }): SlackMessage`
- `buildAIRecordingMessage(args: { brandLabel: string; caller: string; url: string; expiresInDays: number }): SlackMessage`
- `buildAISummaryMessage(args: { brandLabel: string; caller: string; results: Array<{ insight_id?: string; result?: unknown }> }): SlackMessage`
- `postToSlack(webhookUrl: string, message: SlackMessage): Promise<void>` — throws on non-2xx

**Consumes:** `formatDuration(seconds)` from `@/lib/format-duration`.

Key rules baked into the builder (test all of them):
- mrkdwn escaping: only `&`, `<`, `>`.
- Transcript lines render as `*AI:* …` / `*Caller:* …` (`null` speaker → `*—:*`).
- Sections capped at **2,800 chars** (Slack limit 3,000); a single oversized line is hard-sliced; at most **12** transcript blocks, then a context block `Transcript truncated — open the dashboard for the rest.`
- Empty segments → one section `_No transcript captured._`
- Per-label webhook env key: upper-case label, non-alphanumerics collapsed to `_` (`SLACK_WEBHOOK_URL_TLP`); falls back to `SLACK_WEBHOOK_URL`, else `null`.

- [ ] **Step 1: Write the failing test** (`lib/slack.test.ts`)

```ts
import { describe, it, expect, vi, afterEach } from "vitest"
import {
  slackWebhookForLabel,
  escapeSlackText,
  buildAICallMessage,
  buildAIRecordingMessage,
  buildAISummaryMessage,
  postToSlack,
} from "./slack"

const blockTexts = (message: { blocks: Record<string, unknown>[] }): string[] =>
  message.blocks.map((b) => JSON.stringify(b))

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

  it("normalizes odd labels into env-safe keys", () => {
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
    const joined = blockTexts(message).join("\n")
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
    expect(blockTexts(message).join("\n")).toContain("No transcript captured")
  })

  it("chunks long transcripts into ≤2800-char sections and truncates past 12", () => {
    const line = "x".repeat(1000)
    const segments = Array.from({ length: 60 }, () => ({
      speaker: "contact" as const,
      transcript: line,
    }))
    const message = buildAICallMessage({ ...baseArgs, segments })
    const sections = message.blocks.filter(
      (b) =>
        b.type === "section" &&
        JSON.stringify(b).includes("xxx")
    )
    expect(sections.length).toBeLessThanOrEqual(12)
    for (const s of sections) {
      const text = (s as { text?: { text?: string } }).text?.text ?? ""
      expect(text.length).toBeLessThanOrEqual(2800)
    }
    expect(blockTexts(message).join("\n")).toContain("Transcript truncated")
  })

  it("hard-slices a single line longer than the section budget", () => {
    const message = buildAICallMessage({
      ...baseArgs,
      segments: [{ speaker: "contact", transcript: "y".repeat(6000) }],
    })
    const sections = message.blocks.filter((b) => JSON.stringify(b).includes("yyy"))
    expect(sections.length).toBeGreaterThan(1)
  })

  it("adds a dashboard link when given", () => {
    const message = buildAICallMessage({ ...baseArgs, dashboardUrl: "https://x.test/dashboard/calls" })
    expect(blockTexts(message).join("\n")).toContain("https://x.test/dashboard/calls")
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
    const joined = blockTexts(message).join("\n")
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
    const joined = blockTexts(message).join("\n")
    expect(joined).toContain("Caller asked about pricing")
    expect(joined).toContain("sentiment")
  })
})

describe("postToSlack", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("resolves on 200 and throws on non-2xx", async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal("fetch", ok)
    await expect(postToSlack("https://hooks.slack/x", { text: "t", blocks: [] })).resolves.toBeUndefined()
    expect(ok).toHaveBeenCalledOnce()

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" })
    )
    await expect(postToSlack("https://hooks.slack/x", { text: "t", blocks: [] })).rejects.toThrow(
      /500/
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails.** `npm test -- slack` → FAIL.

- [ ] **Step 3: Implement** (`lib/slack.ts`)

```ts
// Slack delivery for AI-handled calls: pure message builders + one poster.
// Uses incoming webhooks (v1) — no bot token, no threads, no file uploads.

import { formatDuration } from "@/lib/format-duration"

export type SlackMessage = { text: string; blocks: Record<string, unknown>[] }

const SECTION_CHAR_BUDGET = 2800 // Slack caps section text at 3000 chars
const MAX_TRANSCRIPT_BLOCKS = 12 // well under Slack's 50-block message cap

/** Env key per brand: SLACK_WEBHOOK_URL_TLP beats SLACK_WEBHOOK_URL. */
export function slackWebhookForLabel(
  label: string | null | undefined,
  env: Record<string, string | undefined>
): string | null {
  if (label) {
    const key = `SLACK_WEBHOOK_URL_${label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`
    if (env[key]) return env[key] ?? null
  }
  return env.SLACK_WEBHOOK_URL ?? null
}

/** Slack mrkdwn needs exactly these three escaped. */
export function escapeSlackText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
}

function section(text: string): Record<string, unknown> {
  return { type: "section", text: { type: "mrkdwn", text } }
}

function context(text: string): Record<string, unknown> {
  return { type: "context", elements: [{ type: "mrkdwn", text }] }
}

/** Pack lines into as few ≤budget-char mrkdwn sections as possible. */
function chunkLines(lines: string[], budget = SECTION_CHAR_BUDGET): string[] {
  const chunks: string[] = []
  let current = ""
  const push = () => {
    if (current) chunks.push(current)
    current = ""
  }
  for (const line of lines) {
    const pieces =
      line.length > budget
        ? Array.from({ length: Math.ceil(line.length / budget) }, (_, i) =>
            line.slice(i * budget, (i + 1) * budget)
          )
        : [line]
    for (const piece of pieces) {
      if (current && current.length + piece.length + 1 > budget) push()
      current = current ? `${current}\n${piece}` : piece
    }
  }
  push()
  return chunks
}

export function buildAICallMessage(args: {
  brandLabel: string
  caller: string
  durationSec: number | null
  endedReason?: string | null
  segments: Array<{ speaker: "agent" | "contact" | null; transcript: string }>
  dashboardUrl?: string | null
}): SlackMessage {
  const duration = formatDuration(args.durationSec ?? 0)
  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `🤖 AI call · ${args.brandLabel}`, emoji: true },
    },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Caller:*\n${escapeSlackText(args.caller)}` },
        { type: "mrkdwn", text: `*Duration:*\n${duration}` },
      ],
    },
    { type: "divider" },
  ]

  const lines = args.segments.map((s) => {
    const label = s.speaker === "agent" ? "AI" : s.speaker === "contact" ? "Caller" : "—"
    return `*${label}:* ${escapeSlackText(s.transcript)}`
  })

  if (lines.length === 0) {
    blocks.push(section("_No transcript captured._"))
  } else {
    const chunks = chunkLines(lines)
    for (const chunk of chunks.slice(0, MAX_TRANSCRIPT_BLOCKS)) blocks.push(section(chunk))
    if (chunks.length > MAX_TRANSCRIPT_BLOCKS) {
      blocks.push(context("Transcript truncated — open the dashboard for the rest."))
    }
  }

  const footer: string[] = []
  if (args.endedReason) footer.push(`Ended: ${escapeSlackText(args.endedReason)}`)
  if (args.dashboardUrl) footer.push(`<${args.dashboardUrl}|Open dashboard>`)
  if (footer.length > 0) blocks.push(context(footer.join(" · ")))

  return {
    text: `AI call · ${args.brandLabel} · ${args.caller} (${duration})`,
    blocks,
  }
}

export function buildAIRecordingMessage(args: {
  brandLabel: string
  caller: string
  url: string
  expiresInDays: number
}): SlackMessage {
  const text = `🎙 *Recording — AI call · ${args.brandLabel}* (${escapeSlackText(args.caller)})\n<${args.url}|Listen> — link expires in ${args.expiresInDays} days`
  return { text: `Recording — AI call · ${args.brandLabel} · ${args.caller}`, blocks: [section(text)] }
}

export function buildAISummaryMessage(args: {
  brandLabel: string
  caller: string
  results: Array<{ insight_id?: string; result?: unknown }>
}): SlackMessage {
  const lines = args.results.map(({ result }) =>
    typeof result === "string" ? escapeSlackText(result) : escapeSlackText(JSON.stringify(result))
  )
  const [first] = chunkLines(lines)
  const text = `📋 *AI summary · ${args.brandLabel}* (${escapeSlackText(args.caller)})\n${first ?? "_empty_"}`
  return { text: `AI summary · ${args.brandLabel} · ${args.caller}`, blocks: [section(text)] }
}

/** POST to an incoming webhook. Throws on non-2xx so callers can log. */
export async function postToSlack(webhookUrl: string, message: SlackMessage): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(message),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`Slack webhook failed: ${res.status} ${body.slice(0, 200)}`)
  }
}
```

- [ ] **Step 4: Run to verify it passes.** `npm test -- slack` → PASS.
- [ ] **Step 5: Commit** `git add lib/slack.ts lib/slack.test.ts && git commit -m "feat(slack): AI-call message builders + webhook poster"`

---

## Task 3: `answeredAction` learns `aiHandled`

**Files:**
- Modify: `lib/telnyx/call-logging.ts` (`answeredAction`)
- Test: extend `lib/telnyx/call-logging.test.ts`

**Interfaces:**
- Produces: `answeredAction(call: { direction?: string; status?: string; aiHandled?: boolean }): "mark_outbound_answered" | "bridge" | "voicemail" | "start_ai" | "noop"`
- Rule: outbound wins first (unchanged); then **any `aiHandled` call** returns `"start_ai"` when still `ringing` and otherwise `"noop"` (so a duplicate `call.answered` can never drop a live AI call into the bridge/voicemail machinery); then the existing `answered`→bridge / `voicemail`→voicemail rules.

- [ ] **Step 1: Add failing tests** to `lib/telnyx/call-logging.test.ts`:

```ts
describe("answeredAction — AI-handled calls", () => {
  it("starts the AI on a ringing inbound AI call", () => {
    expect(answeredAction({ direction: "inbound", status: "ringing", aiHandled: true })).toBe(
      "start_ai"
    )
  })

  it("noops on any non-ringing AI call (duplicate answered events)", () => {
    expect(answeredAction({ direction: "inbound", status: "answered", aiHandled: true })).toBe(
      "noop"
    )
    expect(answeredAction({ direction: "inbound", status: "voicemail", aiHandled: true })).toBe(
      "noop"
    )
  })

  it("keeps outbound and non-AI behavior unchanged", () => {
    expect(answeredAction({ direction: "outbound", status: "initiated", aiHandled: true })).toBe(
      "mark_outbound_answered"
    )
    expect(answeredAction({ direction: "inbound", status: "answered" })).toBe("bridge")
    expect(answeredAction({ direction: "inbound", status: "voicemail", aiHandled: false })).toBe(
      "voicemail"
    )
    expect(answeredAction({ direction: "inbound", status: "ringing" })).toBe("noop")
  })
})
```

- [ ] **Step 2: Run to verify the new cases fail.** `npm test -- call-logging`
- [ ] **Step 3: Implement** — in `answeredAction`, after the outbound check:

```ts
export function answeredAction(call: {
  direction: string | undefined
  status: string | undefined
  aiHandled?: boolean
}): "mark_outbound_answered" | "bridge" | "voicemail" | "start_ai" | "noop" {
  if (call.direction === "outbound") return "mark_outbound_answered"
  // AI-handled calls have their own path; a duplicate answered event on a
  // live AI call must never fall into the bridge/voicemail machinery.
  if (call.aiHandled) return call.status === "ringing" ? "start_ai" : "noop"
  if (call.status === "answered") return "bridge"
  if (call.status === "voicemail") return "voicemail"
  return "noop"
}
```

- [ ] **Step 4: Run to verify all pass.** `npm test -- call-logging` → PASS (existing cases too).
- [ ] **Step 5: Commit** `git add lib/telnyx/call-logging.ts lib/telnyx/call-logging.test.ts && git commit -m "feat(call-logging): start_ai answered action for AI-handled calls"`

---

## Task 4: orchestrator commands

**Files:**
- Modify: `lib/telnyx/voice-orchestrator.ts`

**Interfaces (produces):**
- `startAIAssistantOnCall(params: { callControlId: string; assistantId: string; brandLabel: string }): Promise<void>`
- `startAICallRecording(callControlId: string): Promise<void>`

No unit tests (thin SDK wrappers, same as `answerCaller`/`bridgeLegs`; the existing orchestrator test file only covers its pure helper).

- [ ] **Step 1: Implement both commands** (append near `startCallTranscription`, same `withRetry` + `commandId()` idiom):

```ts
/** Start the configured Telnyx AI Assistant speaking on an answered caller
 *  leg. brand_label is available to the assistant's instructions/greeting as
 *  {{brand_label}}, so one assistant can serve all four brands. */
export async function startAIAssistantOnCall(params: {
  callControlId: string
  assistantId: string
  brandLabel: string
}): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.startAIAssistant(params.callControlId, {
      assistant: {
        id: params.assistantId,
        dynamic_variables: { brand_label: params.brandLabel },
      },
      command_id: commandId(),
    })
  )
  console.log(`🤖 AI assistant ${params.assistantId} started on ${params.callControlId}`)
}

/** Record an AI-handled call: dual channel keeps caller and assistant on
 *  separate tracks; mp3 to match the voicemail flow; no beep. */
export async function startAICallRecording(callControlId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.startRecording(callControlId, {
      format: "mp3",
      channels: "dual",
      command_id: commandId(),
    })
  )
}
```

- [ ] **Step 2: Typecheck.** `npm run typecheck` → clean (validates the SDK call signatures).
- [ ] **Step 3: Commit** `git add lib/telnyx/voice-orchestrator.ts && git commit -m "feat(orchestrator): startAIAssistantOnCall + dual-channel AI recording"`

---

## Task 5: webhook wiring + `types/calls.ts`

**Files:**
- Modify: `app/api/webhooks/telnyx/voice/route.ts`
- Modify: `types/calls.ts`

**Consumes:** everything produced by Tasks 1–4.

Changes, in order through the file:

- [ ] **Step 1: types/calls.ts** — add to `Call`:

```ts
  ai_handled?: boolean
  ai_conversation_id?: string | null
  ai_recording_path?: string | null
```

- [ ] **Step 2: route imports + payload type.** Import `aiAgentSettings`, `isAIAgentLabel`, `conversationMessagesToSegments`, `type ConversationMessage` from `@/lib/telnyx/ai-agent`; `slackWebhookForLabel`, `buildAICallMessage`, `buildAIRecordingMessage`, `buildAISummaryMessage`, `postToSlack` from `@/lib/slack`; add `startAIAssistantOnCall`, `startAICallRecording` to the voice-orchestrator import. Extend `TelnyxCallPayload` with:

```ts
  // call.conversation.ended / call.conversation_insights.generated fields
  conversation_id?: string
  duration_sec?: number
  reason?: string | null
  results?: Array<{ insight_id?: string; result?: unknown }>
```

- [ ] **Step 3: event switch** — add before `default`:

```ts
    case "call.conversation.ended":
      await handleConversationEnded(supabase, payload, body.data.occurred_at)
      break
    case "call.conversation_insights.generated":
      await handleConversationInsights(supabase, payload)
      break
```

- [ ] **Step 4: `handleCallInitiated` AI branch.** Change the inbound `phone_numbers` select from `"id"` to `"id, label"`. Immediately after the `if (!phoneNumber)` guard, insert:

```ts
  // AI voice agent (TLP test): flagged brands are answered by the Telnyx AI
  // assistant instead of ringing agents. Fully dormant unless configured.
  const aiSettings = aiAgentSettings(process.env as Record<string, string | undefined>)
  if (isAIAgentLabel(aiSettings, phoneNumber.label)) {
    const { error: aiUpsertError } = await supabase.from("calls").upsert(
      {
        phone_number_id: phoneNumber.id,
        contact_number: payload.from,
        direction: "inbound",
        status: "ringing",
        telnyx_call_id: payload.call_control_id,
        ai_handled: true,
      },
      { onConflict: "telnyx_call_id", ignoreDuplicates: true }
    )
    if (aiUpsertError) {
      console.error("⚠️ Failed to upsert AI-handled call row:", aiUpsertError)
      return
    }
    try {
      await answerCaller(payload.call_control_id)
    } catch (err) {
      console.error("⚠️ Failed to answer caller for AI agent:", err)
    }
    return
  }
```

- [ ] **Step 5: `handleCallAnswered` start_ai branch.** Extend the call select to `"id, status, direction, ai_handled, phone_numbers(voicemail_greeting, label)"`, pass `aiHandled` into `answeredAction`:

```ts
  const action = answeredAction({
    direction: call.direction,
    status: call.status,
    aiHandled: call.ai_handled === true,
  })
```

then add before the `bridge` branch:

```ts
  if (action === "start_ai") {
    const aiSettings = aiAgentSettings(process.env as Record<string, string | undefined>)
    const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
    const brandLabel = (pn as { label?: string } | null)?.label ?? "Unknown"

    if (aiSettings) {
      try {
        await startAIAssistantOnCall({
          callControlId: payload.call_control_id,
          assistantId: aiSettings.assistantId,
          brandLabel,
        })
        await supabase
          .from("calls")
          .update({ status: "answered", started_at: new Date().toISOString() })
          .eq("id", call.id)
        try {
          await startAICallRecording(payload.call_control_id)
        } catch (err) {
          console.error("⚠️ Failed to start AI call recording (call continues):", err)
        }
        return
      } catch (err) {
        console.error("⚠️ Failed to start AI assistant; falling back to voicemail:", err)
      }
    } else {
      console.error("⚠️ AI call answered but assistant config is gone; voicemail fallback")
    }

    // Fallback: clear the AI flag so recording.saved treats this as a normal
    // voicemail, then run the standard greeting flow on the answered leg.
    await supabase
      .from("calls")
      .update({ status: "voicemail", ai_handled: false })
      .eq("id", call.id)
    await speakGreeting(payload.call_control_id, call)
    return
  }
```

- [ ] **Step 6: `handleRecordingSaved` AI branch.** Extend the select to `"id, contact_number, phone_number_id, has_voicemail, ai_handled, ai_recording_path, phone_numbers(label)"`; right after the `if (!call)` guard add `if (call.ai_handled) { await handleAIRecordingSaved(supabase, call, recordingUrl, durationMs); return }` and add the handler:

```ts
const AI_RECORDING_LINK_DAYS = 7

async function handleAIRecordingSaved(
  supabase: SupabaseClient,
  call: {
    id: string
    contact_number: string
    ai_recording_path?: string | null
    phone_numbers?: unknown
  },
  recordingUrl: string,
  durationMs: number
) {
  if (call.ai_recording_path) return // idempotency: Telnyx webhook retry

  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  const brandLabel = (pn as { label: string } | null)?.label ?? "Unknown"

  // Copy into the private bucket; fall back to the (time-limited) Telnyx URL
  // so the audio link is never lost. Same pattern as voicemails.
  let audioUrl = recordingUrl
  try {
    const res = await fetch(recordingUrl)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const path = `${call.id}.mp3`
    const { error: upErr } = await supabase.storage
      .from("call-recordings")
      .upload(path, bytes, { contentType: "audio/mpeg", upsert: true })
    if (upErr) throw upErr

    const { error: updErr } = await supabase
      .from("calls")
      .update({ ai_recording_path: path })
      .eq("id", call.id)
    if (updErr) console.error("⚠️ Failed to store ai_recording_path:", updErr)

    const { data: signed, error: signErr } = await supabase.storage
      .from("call-recordings")
      .createSignedUrl(path, 60 * 60 * 24 * AI_RECORDING_LINK_DAYS)
    if (signErr || !signed?.signedUrl) {
      console.error("⚠️ Failed to sign AI recording URL; using Telnyx URL:", signErr)
    } else {
      audioUrl = signed.signedUrl
    }
  } catch (err) {
    console.error("⚠️ Failed to copy AI recording to bucket; keeping Telnyx URL:", err)
  }

  const webhook = slackWebhookForLabel(brandLabel, process.env as Record<string, string | undefined>)
  if (!webhook) return
  try {
    await postToSlack(
      webhook,
      buildAIRecordingMessage({
        brandLabel,
        caller: call.contact_number,
        url: audioUrl,
        expiresInDays: AI_RECORDING_LINK_DAYS,
      })
    )
    console.log(`🎙 AI recording posted to Slack for call ${call.id} (${Math.round(durationMs / 1000)}s)`)
  } catch (err) {
    console.error("⚠️ Failed to post AI recording to Slack:", err)
  }
}
```

- [ ] **Step 7: `handleConversationEnded` + `handleConversationInsights`:**

```ts
async function handleConversationEnded(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload,
  occurredAt: string | undefined
) {
  const { data: call } = await supabase
    .from("calls")
    .select("id, contact_number, ai_handled, ai_conversation_id, phone_numbers(label)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call?.ai_handled) return // not an AI-handled call — nothing to do
  if (call.ai_conversation_id) return // idempotency: Telnyx webhook retry

  const conversationId = payload.conversation_id
  if (!conversationId) {
    console.warn("⚠️ call.conversation.ended without conversation_id:", payload.call_control_id)
    return
  }

  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  const brandLabel = (pn as { label: string } | null)?.label ?? "Unknown"

  // The conversation history IS the transcript (the broken call.transcription
  // pipeline is deliberately not involved — see the design spec).
  const messages: ConversationMessage[] = []
  try {
    const { getTelnyxClient } = await import("@/lib/telnyx/client")
    for await (const message of getTelnyxClient().ai.conversations.messages.list(conversationId)) {
      messages.push(message as ConversationMessage)
    }
  } catch (err) {
    console.error(`⚠️ Failed to fetch AI conversation ${conversationId} (transcript lost unless replayed manually):`, err)
  }

  const segments = conversationMessagesToSegments(
    messages,
    occurredAt ?? new Date().toISOString()
  )

  if (segments.length > 0) {
    const { error } = await supabase
      .from("call_transcript_segments")
      .insert(segments.map((segment) => ({ call_id: call.id, ...segment })))
    if (error) console.error("⚠️ Failed to insert AI transcript segments:", error)
  }

  // Mark processed even when empty so a webhook retry can't double-post Slack.
  const { error: markError } = await supabase
    .from("calls")
    .update({ ai_conversation_id: conversationId, ...(segments.length > 0 && { has_transcript: true }) })
    .eq("id", call.id)
  if (markError) console.error("⚠️ Failed to mark AI conversation processed:", markError)

  const env = process.env as Record<string, string | undefined>
  const webhook = slackWebhookForLabel(brandLabel, env)
  if (!webhook) {
    console.warn("⚠️ AI call finished but no Slack webhook is configured")
    return
  }
  const base = env.APP_BASE_URL?.replace(/\/+$/, "")
  try {
    await postToSlack(
      webhook,
      buildAICallMessage({
        brandLabel,
        caller: call.contact_number,
        durationSec: payload.duration_sec ?? null,
        endedReason: payload.reason ?? null,
        segments,
        dashboardUrl: base ? `${base}/dashboard/calls` : null,
      })
    )
    console.log(`💬 AI transcript posted to Slack for call ${call.id} (${segments.length} segments)`)
  } catch (err) {
    console.error("⚠️ Failed to post AI transcript to Slack:", err)
  }
}

async function handleConversationInsights(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const results = payload.results
  if (!results || results.length === 0) return

  const { data: call } = await supabase
    .from("calls")
    .select("id, contact_number, ai_handled, phone_numbers(label)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call?.ai_handled) return

  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  const brandLabel = (pn as { label: string } | null)?.label ?? "Unknown"

  const webhook = slackWebhookForLabel(brandLabel, process.env as Record<string, string | undefined>)
  if (!webhook) return
  try {
    await postToSlack(
      webhook,
      buildAISummaryMessage({ brandLabel, caller: call.contact_number, results })
    )
  } catch (err) {
    console.error("⚠️ Failed to post AI summary to Slack:", err)
  }
}
```

- [ ] **Step 8: Verify.** `npm run typecheck && npm test && npm run lint` → all clean.
- [ ] **Step 9: Commit** `git add app/api/webhooks/telnyx/voice/route.ts types/calls.ts && git commit -m "feat: TLP AI voice agent — answer, converse, record, transcript → Slack"`

---

## Task 6: README ops section + full verification

**Files:**
- Modify: `README.md` (new section after the Jades section)

- [ ] **Step 1: Add README section** — "AI voice agent (TLP test)": what it does (one paragraph), the env vars table (`TELNYX_AI_ASSISTANT_ID`, `AI_AGENT_LABELS`, `SLACK_WEBHOOK_URL[_<LABEL>]`, `APP_BASE_URL`), the SQL + `call-recordings` bucket prerequisite, and a pointer to the design spec.
- [ ] **Step 2: Full suite.** `npm run typecheck && npm test && npm run lint && npm run build` → all green.
- [ ] **Step 3: Commit** `git add README.md && git commit -m "docs: AI voice agent setup (env, SQL, Slack webhook)"`

---

## Manual E2E (after deploy + portal setup — meeting checklist)

1. Run the SQL + create the `call-recordings` bucket (Supabase dashboard).
2. Create the Telnyx assistant (portal → AI → AI Assistants), note its ID.
3. Create the Slack incoming webhook for the target channel.
4. Set env vars in Vercel; deploy; set `AI_AGENT_LABELS=TLP` last.
5. Call the TLP number: AI answers with the configured greeting.
6. Hang up: Slack transcript message within ~30 s; recording message follows; transcript visible in the dashboard expanded call row; call row `completed` with duration.
7. Call an STR/BB/HGI number: normal ring-all, unchanged.
8. Unset `AI_AGENT_LABELS`: TLP reverts to ring-all.
