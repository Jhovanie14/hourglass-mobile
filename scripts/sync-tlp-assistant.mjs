#!/usr/bin/env node
// Push the repo's receptionist config to the live Telnyx assistant:
//
//   1. `instructions` <- the §1 fenced block of docs/ai-receptionist-instructions.md
//   2. the call-summary insight + its group, attached to the assistant
//   3. the assistant's name, description and dynamic-variable DEFAULTS
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
// The shared, brand-agnostic block. One assistant serves every AI brand; each
// brand's prices and policy arrive as dynamic variables at call time, so this
// file is the only prompt there is. The old per-brand TLP doc is superseded.
const DOC = resolve(ROOT, "docs/ai-receptionist-instructions.md")
const API = "https://api.telnyx.com/v2"
const DRY_RUN = process.argv.includes("--dry-run")

// Matched by NAME against what already exists in Telnyx, so renaming these
// creates a second insight and a second group rather than renaming the live
// ones. They read as TLP-only and are not — leave them until someone is willing
// to clean up the orphans in the portal afterwards.
// One assistant serves every AI brand, so its name should not claim one. The
// live name was "The Launch Pad Receptionist — Test" until 2026-08-26: wrong on
// both counts — brand-specific, and not a test. Callers never hear this; it is
// the portal label only.
export const ASSISTANT_NAME = "Hourglass AI Receptionist"
const ASSISTANT_DESCRIPTION =
  "Shared receptionist for every AI-enabled brand. Brand facts (menu, prices, policy, hours) arrive as dynamic variables at call time — see docs/ai-receptionist-instructions.md."

/**
 * Fallbacks Telnyx substitutes when a variable is not supplied — the
 * dynamic-variables webhook failed, or the start command never set it.
 *
 * EVERY VALUE HERE MUST DEGRADE TO "I don't have that, can I take a message?".
 * That is the one answer that is never wrong for any brand. The live defaults
 * before this script owned them were `brand_name: "The Launch Pad"` and
 * `pricing: null` — the first greets a chicken shop caller by a car wash's
 * name, the second risks rendering the literal string "null" into the prompt.
 *
 * Empty `brand_name` leaves the greeting as "Hi, thanks for calling." That is
 * slightly clipped, and it is the correct trade: a missing name is a stumble,
 * the wrong name is a different business.
 *
 * Telnyx stores these as strings, booleans and arrays included.
 */
export const DYNAMIC_VARIABLE_DEFAULTS = {
  // brand_name and brand_label are deliberately ABSENT. Each brand now has its
  // own assistant, so those are per-assistant identity rather than shared
  // config, and each one's default names its own brand. Managing them here
  // would reset every assistant to the same value — which is how the greeting
  // became "Hi, thanks for calling ." on 2026-08-26.
  brand_rules: "",
  pricing: "",
  hours: "",
  open_now: "unknown",
  coupons: "",
  agents_available: "false",
  targets: "[]",
}

const INSIGHT_NAME = "TLP call summary"
const INSIGHT_GROUP_NAME = "TLP Receptionist"

/** The hand-off note the agents team reads in Slack. Written as one structured
 *  insight rather than several so the fields can never arrive half-populated,
 *  and so the format is identical on every call. */
const INSIGHT_INSTRUCTIONS = `You are reviewing a finished phone call between a business's AI receptionist
and a caller. Write a factual hand-off note for the human team.

The business differs from call to call — a car wash, a chicken shop — so take
what it sells from the transcript itself and never assume an industry.

Report only what is in the transcript. Never guess at intent, and never invent a
name, number, price, or promise that was not actually said.

why_they_called — one sentence, the caller's own reason, in plain past tense.

what_the_ai_did — one or two sentences: what was quoted, explained, or
collected. Name items and services exactly as the AI named them. If a message was taken,
say so and include the caller's name and callback number as they gave them.

outcome — one short sentence on how the call ended: message taken, question
answered, caller declined, caller hung up, and so on.

knowledge_gaps — every question the AI could not answer, one entry each, phrased
as the missing fact rather than the exchange: "Sunday opening hours", "whether
we cater for 50 people", "price for a ceramic coating". Include anything the AI
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
  // core.autocrlf hands us CRLF on checkout. Send LF: the model has no use for
  // carriage returns, and leaving them in makes the byte count differ from what
  // we sent, which turns the post-update verification into a permanent false
  // alarm.
  const block = markdown.slice(start, close).replaceAll("\r\n", "\n").trim()
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

  console.log(`name:            "${ASSISTANT_NAME}"`)
  console.log(`variable defaults: ${JSON.stringify(DYNAMIC_VARIABLE_DEFAULTS)}`)

  if (DRY_RUN) {
    console.log("--dry-run: nothing sent to Telnyx")
    return
  }

  const insightId = await ensureInsight(apiKey)
  const groupId = await ensureGroup(apiKey, insightId)

  // Assistants update with POST, not PUT — a PUT here 404s, which reads like a
  // bad assistant id rather than a bad verb. (Insights genuinely do use PUT.)
  await telnyx(apiKey, "POST", `/ai/assistants/${assistantId}`, {
    name: ASSISTANT_NAME,
    description: ASSISTANT_DESCRIPTION,
    instructions,
    dynamic_variables: DYNAMIC_VARIABLE_DEFAULTS,
    insight_settings: { insight_group_id: groupId },
  })
  console.log(`↻ assistant ${assistantId} updated (name + instructions + defaults + insight group ${groupId})`)

  // Read it back. Telnyx does not document whether a partial POST merges or
  // replaces, and this assistant carries a greeting, voice settings and the
  // dynamic-variables webhook that nothing here sends. If a field below comes
  // back MISSING, the update replaced rather than merged — restore from the
  // backup rather than guessing at the values.
  // Assistants come back at the top level; insights come back under `data`.
  // Reading `.data` here cost a sync run to a TypeError after the update had
  // already succeeded, so accept either shape.
  const body = await telnyx(apiKey, "GET", `/ai/assistants/${assistantId}`)
  const after = body?.data ?? body
  const checks = [
    ["instructions", after.instructions?.length === instructions.length],
    ["name", after.name === ASSISTANT_NAME],
    ["insight group", after.insight_settings?.insight_group_id === groupId],
    ["greeting", Boolean(after.greeting)],
    ["voice", Boolean(after.voice_settings?.voice)],
    ["dynamic variables webhook", Boolean(after.dynamic_variables_webhook_url)],
    ["model", Boolean(after.model)],
    // Checked by value, not presence: a default that silently kept its old
    // value is exactly the failure this section was added to catch.
    ...Object.entries(DYNAMIC_VARIABLE_DEFAULTS).map(([key, want]) => [
      `default ${key}`,
      String(after.dynamic_variables?.[key] ?? "") === String(want),
    ]),
    // The greeting is portal-managed and must stay brand-agnostic, or every
    // brand is greeted as whichever one someone typed in there.
    ["greeting uses {{brand_name}}", /\{\{\s*brand_name\s*\}\}/.test(after.greeting ?? "")],
  ]
  console.log("\nverifying:")
  for (const [name, ok] of checks) console.log(`  ${ok ? "✓" : "✗ MISSING"} ${name}`)
  if (checks.some(([, ok]) => !ok)) {
    throw new Error("assistant is missing fields after the update — see the backup before recalling")
  }
  console.log(`\nassistant instructions are now ${after.instructions.length} chars.`)
}

// Only run when invoked directly, so extractInstructions stays unit-testable.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error("✖", err.message)
    process.exit(1)
  })
}
