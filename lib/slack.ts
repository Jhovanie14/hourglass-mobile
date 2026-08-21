// Slack delivery for AI-handled calls: pure message builders + one poster.
// Uses incoming webhooks (v1) — no bot token, no threads, no file uploads.

import { formatDuration } from "@/lib/format-duration"

export type SlackMessage = { text: string; blocks: Record<string, unknown>[] }

const SECTION_CHAR_BUDGET = 2800 // Slack caps section text at 3000 chars
const MAX_BLOCKS = 45 // well under Slack's 50-block message cap

/** Env key per brand: SLACK_WEBHOOK_URL_TLP beats SLACK_WEBHOOK_URL. */
export function slackWebhookForLabel(
  label: string | null | undefined,
  env: Record<string, string | undefined>
): string | null {
  if (label) {
    const key = `SLACK_WEBHOOK_URL_${label
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")}`
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

/** Pack lines into as few ≤budget-char mrkdwn sections as possible; a single
 *  line longer than the budget is hard-sliced so nothing is ever dropped. */
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

export function buildAIRecordingMessage(args: {
  brandLabel: string
  caller: string
  url: string
  expiresInDays: number
}): SlackMessage {
  const text = `🎙 *Recording — AI call · ${args.brandLabel}* (${escapeSlackText(args.caller)})\n<${args.url}|Listen> — link expires in ${args.expiresInDays} days`
  return {
    text: `Recording — AI call · ${args.brandLabel} · ${args.caller}`,
    blocks: [section(text)],
  }
}

/** The structured post-call insight we ask Telnyx for. Every field is optional:
 *  the model may legitimately have nothing to say, and one missing field must
 *  never cost us the whole Slack post. */
export type AICallSummary = {
  why_they_called?: string
  what_the_ai_did?: string
  outcome?: string
  knowledge_gaps?: string[]
  at_risk?: string[]
}

const TEXT_FIELDS = ["why_they_called", "what_the_ai_did", "outcome"] as const
const LIST_FIELDS = ["knowledge_gaps", "at_risk"] as const

/** A model asked for an array will sometimes hand back a single string. Blank
 *  entries are dropped so an empty slot never renders as a stray bullet. */
function toStringList(value: unknown): string[] | null {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed === "" ? [] : [trimmed]
  }
  if (!Array.isArray(value)) return null
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return asObject(JSON.parse(value))
    } catch {
      return null // prose insight, or truncated JSON — the caller falls back
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/**
 * Telnyx insight results → our summary shape, or null when nothing in the array
 * matches it. Null is the signal to render the raw insight text instead, which
 * is what stops an insight-group change from silently emptying Slack.
 */
export function parseAISummaryResult(
  results: Array<{ insight_id?: string; result?: unknown }> | null | undefined
): AICallSummary | null {
  for (const { result } of results ?? []) {
    const raw = asObject(result)
    if (!raw) continue

    const summary: AICallSummary = {}
    let hasContent = false

    for (const field of TEXT_FIELDS) {
      const value = raw[field]
      if (typeof value !== "string") continue
      const trimmed = value.trim()
      if (trimmed === "") continue
      summary[field] = trimmed
      hasContent = true
    }
    for (const field of LIST_FIELDS) {
      const list = toStringList(raw[field])
      if (list === null) continue
      summary[field] = list
      if (list.length > 0) hasContent = true
    }

    if (hasContent) return summary
  }
  return null
}

/** Heading + body as one or more ≤budget sections, so a long field can never
 *  breach Slack's 3000-char section cap. */
function labeledSection(heading: string, lines: string[]): Record<string, unknown>[] {
  return chunkLines([heading, ...lines]).map(section)
}

function bullets(entries: string[]): string[] {
  return entries.map((entry) => `• ${escapeSlackText(entry)}`)
}

/**
 * The one Slack message per AI call. The team asked for summaries rather than
 * transcripts, so the transcript now stops at the dashboard and this card
 * carries the "what we're missing" note — printed on every call, flagged or
 * not, because an absent note reads as "nothing to report" when what it really
 * means is "nobody looked".
 */
export function buildAISummaryMessage(args: {
  brandLabel: string
  caller: string
  durationSec: number | null
  results: Array<{ insight_id?: string; result?: unknown }> | null | undefined
  dashboardUrl?: string | null
}): SlackMessage {
  const duration = formatDuration(args.durationSec ?? 0)
  const summary = parseAISummaryResult(args.results)

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

  if (summary) {
    const { why_they_called, what_the_ai_did, outcome } = summary
    if (why_they_called) {
      blocks.push(...labeledSection("*Why they called*", [escapeSlackText(why_they_called)]))
    }
    if (what_the_ai_did) {
      blocks.push(...labeledSection("*What the AI did*", [escapeSlackText(what_the_ai_did)]))
    }
    if (outcome) {
      blocks.push(...labeledSection("*Outcome*", [escapeSlackText(outcome)]))
    }
    const gaps = summary.knowledge_gaps ?? []
    blocks.push(
      ...labeledSection(
        "⚠️ *What we're missing*",
        gaps.length > 0 ? bullets(gaps) : ["_Nothing flagged._"]
      )
    )
    const atRisk = summary.at_risk ?? []
    if (atRisk.length > 0) blocks.push(...labeledSection("💸 *At risk*", bullets(atRisk)))
  } else {
    // No structured insight: print whatever Telnyx did return rather than
    // nothing, so a prompt or insight-group change degrades to noisy, not blank.
    const raw = (args.results ?? []).map(({ result }) =>
      typeof result === "string" ? escapeSlackText(result) : escapeSlackText(JSON.stringify(result))
    )
    blocks.push(...labeledSection("*Summary*", raw.length > 0 ? raw : ["_No summary generated._"]))
    blocks.push(
      ...labeledSection("⚠️ *What we're missing*", [
        "_Not captured — the insight didn't return the structured fields._",
      ])
    )
  }

  const trimmed = blocks.slice(0, MAX_BLOCKS)
  if (blocks.length > MAX_BLOCKS) {
    trimmed.push(context("Summary truncated — open the dashboard for the rest."))
  }
  if (args.dashboardUrl) {
    trimmed.push(context(`<${args.dashboardUrl}|Open dashboard for the full transcript>`))
  }

  return {
    text: `AI call · ${args.brandLabel} · ${args.caller} (${duration})`,
    blocks: trimmed,
  }
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
