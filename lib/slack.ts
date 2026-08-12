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

  const lines = args.segments.map((segment) => {
    const label =
      segment.speaker === "agent" ? "AI" : segment.speaker === "contact" ? "Caller" : "—"
    return `*${label}:* ${escapeSlackText(segment.transcript)}`
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
  return {
    text: `Recording — AI call · ${args.brandLabel} · ${args.caller}`,
    blocks: [section(text)],
  }
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
