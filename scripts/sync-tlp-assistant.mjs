#!/usr/bin/env node
// Push the repo's TLP receptionist config to the live Telnyx assistant:
//
//   1. `instructions` <- the §1 fenced block of docs/tlp-ai-assistant-instructions.md
//   2. the call-summary insight + its group, attached to the assistant
//
// Why this exists: on 2026-08-19 the assistant's `instructions` field was found
// to hold the ENTIRE 8k-char markdown doc — the "paste the block in §1" meta
// text, the open questions, all of it — because that step was manual. Extract
// it in code and the mistake cannot happen twice.
//
// Usage:  node scripts/sync-tlp-assistant.mjs [--dry-run]
// Env:    TELNYX_API_KEY, TELNYX_AI_ASSISTANT_ID (both read from .env.local)

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const DOC = resolve(ROOT, "docs/tlp-ai-assistant-instructions.md")
const API = "https://api.telnyx.com/v2"
const DRY_RUN = process.argv.includes("--dry-run")

const INSIGHT_NAME = "TLP call summary"
const INSIGHT_GROUP_NAME = "TLP Receptionist"

/** The hand-off note the agents team reads in Slack. Written as one structured
 *  insight rather than several so the fields can never arrive half-populated,
 *  and so the format is identical on every call. */
const INSIGHT_INSTRUCTIONS = `You are reviewing a finished phone call between The Launch Pad's AI receptionist
and a caller. Write a factual hand-off note for the human team.

Report only what is in the transcript. Never guess at intent, and never invent a
name, number, price, or promise that was not actually said.

why_they_called — one sentence, the caller's own reason, in plain past tense.

what_the_ai_did — one or two sentences: what was quoted, explained, or
collected. Name services exactly as the AI named them. If a message was taken,
say so and include the caller's name and callback number as they gave them.

outcome — one short sentence on how the call ended: message taken, question
answered, caller declined, caller hung up, and so on.

knowledge_gaps — every question the AI could not answer, one entry each, phrased
as the missing fact rather than the exchange: "Sunday opening hours", "whether
we detail motorcycles", "price for a ceramic coating". Include anything the AI
deflected, said it did not have, or promised someone would check. Empty array if
the AI answered everything it was asked.

at_risk — every point where the business may have lost or nearly lost the job,
one entry each: the caller wanted to book and could not, asked for a human and
got a message instead, reacted badly to a price, went quiet, or hung up before
they were helped. Say what happened and what it was about. Empty array if
nothing was at risk.

Both arrays default to empty. Do not pad them with anything the caller did not
actually raise.`

/** Mirrors AICallSummary in lib/slack.ts — change both together.
 *
 *  Telnyx enforces OpenAI-style strict structured output: `additionalProperties`
 *  must be false on every object, and `required` must list every property.
 *  Omitting either is a 400 (code 10015). "Required" here means the key is
 *  always present, not that it carries content — the model returns an empty
 *  string or an empty array when it has nothing, which lib/slack.ts treats the
 *  same as absent. */
const INSIGHT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    why_they_called: { type: "string", description: "The caller's reason, one sentence." },
    what_the_ai_did: { type: "string", description: "What the AI quoted, explained or collected." },
    outcome: { type: "string", description: "How the call ended, one short sentence." },
    knowledge_gaps: {
      type: "array",
      items: { type: "string" },
      description: "Facts the AI did not have. Empty if it answered everything.",
    },
    at_risk: {
      type: "array",
      items: { type: "string" },
      description: "Business that may have been lost. Empty if nothing was at risk.",
    },
  },
  required: ["why_they_called", "what_the_ai_did", "outcome", "knowledge_gaps", "at_risk"],
}

/** The §1 block and nothing else: the first fenced block after the §1 heading. */
export function extractInstructions(markdown) {
  const heading = markdown.indexOf("## §1 Instructions block")
  if (heading === -1) throw new Error("docs: '## §1 Instructions block' heading not found")
  const open = markdown.indexOf("```", heading)
  if (open === -1) throw new Error("docs: no fenced block after the §1 heading")
  const start = markdown.indexOf("\n", open) + 1
  const close = markdown.indexOf("```", start)
  if (close === -1) throw new Error("docs: §1 fenced block is never closed")
  const block = markdown.slice(start, close).trim()
  if (block.length === 0) throw new Error("docs: §1 fenced block is empty")
  if (block.includes("Paste the block in")) {
    throw new Error("docs: extracted the meta text, not the prompt — check the §1 heading")
  }
  return block
}

function loadEnv() {
  const env = { ...process.env }
  try {
    for (const line of readFileSync(resolve(ROOT, ".env.local"), "utf8").split(/\r?\n/)) {
      const eq = line.indexOf("=")
      if (eq === -1 || line.trimStart().startsWith("#")) continue
      const key = line.slice(0, eq).trim()
      if (!env[key]) env[key] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "")
    }
  } catch {
    // no .env.local — rely on the real environment
  }
  return env
}

async function telnyx(apiKey, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 400)}`)
  return text ? JSON.parse(text) : null
}

async function ensureInsight(apiKey) {
  const { data: insights } = await telnyx(apiKey, "GET", "/ai/conversations/insights")
  const existing = insights?.find((i) => i.name === INSIGHT_NAME)
  const payload = {
    name: INSIGHT_NAME,
    instructions: INSIGHT_INSTRUCTIONS,
    json_schema: INSIGHT_SCHEMA,
  }
  if (existing) {
    await telnyx(apiKey, "PUT", `/ai/conversations/insights/${existing.id}`, payload)
    console.log(`↻ updated insight "${INSIGHT_NAME}" (${existing.id})`)
    return existing.id
  }
  const { data } = await telnyx(apiKey, "POST", "/ai/conversations/insights", payload)
  console.log(`+ created insight "${INSIGHT_NAME}" (${data.id})`)
  return data.id
}

async function ensureGroup(apiKey, insightId) {
  const { data: groups } = await telnyx(apiKey, "GET", "/ai/conversations/insight-groups")
  let group = groups?.find((g) => g.name === INSIGHT_GROUP_NAME)
  if (!group) {
    const created = await telnyx(apiKey, "POST", "/ai/conversations/insight-groups", {
      name: INSIGHT_GROUP_NAME,
      description: "Post-call hand-off note for the agents team (see lib/slack.ts).",
    })
    group = created.data
    console.log(`+ created insight group "${INSIGHT_GROUP_NAME}" (${group.id})`)
  }
  if (!group.insights?.some((i) => i.id === insightId)) {
    await telnyx(
      apiKey,
      "POST",
      `/ai/conversations/insight-groups/${group.id}/insights/${insightId}/assign`,
      {}
    )
    console.log(`+ assigned the insight to the group`)
  }
  return group.id
}

async function main() {
  const env = loadEnv()
  const apiKey = env.TELNYX_API_KEY
  const assistantId = env.TELNYX_AI_ASSISTANT_ID
  if (!apiKey || !assistantId) {
    throw new Error("TELNYX_API_KEY and TELNYX_AI_ASSISTANT_ID must be set (.env.local)")
  }

  const instructions = extractInstructions(readFileSync(DOC, "utf8"))
  console.log(`§1 instructions: ${instructions.length} chars, starts "${instructions.slice(0, 60)}…"`)

  if (DRY_RUN) {
    console.log("--dry-run: nothing sent to Telnyx")
    return
  }

  const insightId = await ensureInsight(apiKey)
  const groupId = await ensureGroup(apiKey, insightId)

  await telnyx(apiKey, "PUT", `/ai/assistants/${assistantId}`, {
    instructions,
    insight_settings: { insight_group_id: groupId },
  })
  console.log(`↻ assistant ${assistantId} updated (instructions + insight group ${groupId})`)
}

// Only run when invoked directly, so extractInstructions stays unit-testable.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error("✖", err.message)
    process.exit(1)
  })
}
