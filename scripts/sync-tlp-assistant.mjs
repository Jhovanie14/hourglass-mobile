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
import { BRAND_PROMPTS, bakeInstructions } from "./brand-prompts.mjs"
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
  // brand_name, brand_label and brand_rules are ABSENT on purpose: they are
  // baked into each brand's instructions at sync time (see brand-prompts.mjs),
  // so no webhook result can substitute another brand's identity or policy.
  // What remains is only what genuinely changes call to call.
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

/**
 * How the receptionist paces itself.
 *
 * The account defaults had `voice_speed: 1` with every endpointing threshold at
 * 0.1s, which is what made it feel rushed and robotic: it began speaking a
 * tenth of a second after the caller stopped making noise, so any mid-sentence
 * pause got talked over.
 *
 * `onNumberSeconds` matters most. Taking a message is this assistant's main
 * job, and people read a phone number in groups with gaps between them. At
 * 0.1s it interrupted halfway through and captured half a number.
 *
 * The voice itself is NOT managed here — whichever voice is chosen in the
 * portal is preserved. Only the pacing fields are overwritten.
 */
const SPEECH = {
  voice_speed: 0.9,
  wait_seconds: 0.5,
  on_punctuation_seconds: 0.3,
  on_no_punctuation_seconds: 0.8,
  on_number_seconds: 1.2,
}

const BASE_URL = (process.env.APP_BASE_URL ?? "https://www.megestic.com").replace(/\/$/, "")

function assistantConfig(brand, sharedBlock) {
  return {
    name: `${brand.displayName} Receptionist`,
    instructions: bakeInstructions(sharedBlock, brand),
    greeting: `Hi, thanks for calling ${brand.displayName}. Just so you know, this call may be recorded for quality. How can I help you today?`,
    dynamic_variables_webhook_url: `${BASE_URL}/api/webhooks/telnyx/ai/variables/${brand.slug}`,
    dynamic_variables: DYNAMIC_VARIABLE_DEFAULTS,
  }
}

async function syncBrand(apiKey, brand, sharedBlock, groupId, env) {
  const assistantId = env[brand.assistantIdEnv]?.trim()
  if (!assistantId) {
    console.log(`\n— ${brand.label}: ${brand.assistantIdEnv} not set, skipping`)
    return { skipped: true }
  }

  const cfg = assistantConfig(brand, sharedBlock)
  console.log(`\n— ${brand.label} (${assistantId})`)
  console.log(`  instructions: ${cfg.instructions.length} chars`)
  console.log(`  webhook:      ${cfg.dynamic_variables_webhook_url}`)

  if (DRY_RUN) return { skipped: false, dryRun: true }

  // Read first so pacing merges onto whatever voice is configured, rather than
  // replacing a voice someone deliberately chose in the portal.
  const currentBody = await telnyx(apiKey, "GET", `/ai/assistants/${assistantId}`)
  const current = currentBody?.data ?? currentBody
  const prior = current.interruption_settings ?? {}
  const priorPlan = prior.start_speaking_plan ?? {}

  await telnyx(apiKey, "POST", `/ai/assistants/${assistantId}`, {
    ...cfg,
    insight_settings: { insight_group_id: groupId },
    voice_settings: { ...(current.voice_settings ?? {}), voice_speed: SPEECH.voice_speed },
    interruption_settings: {
      ...prior,
      start_speaking_plan: {
        ...priorPlan,
        wait_seconds: SPEECH.wait_seconds,
        transcription_endpointing_plan: {
          ...(priorPlan.transcription_endpointing_plan ?? {}),
          on_punctuation_seconds: SPEECH.on_punctuation_seconds,
          on_no_punctuation_seconds: SPEECH.on_no_punctuation_seconds,
          on_number_seconds: SPEECH.on_number_seconds,
        },
      },
    },
  })

  const body = await telnyx(apiKey, "GET", `/ai/assistants/${assistantId}`)
  const after = body?.data ?? body
  const checks = [
    ["instructions", after.instructions === cfg.instructions],
    ["names its own brand", (after.instructions ?? "").includes(brand.displayName)],
    ["greeting", after.greeting === cfg.greeting],
    ["webhook", after.dynamic_variables_webhook_url === cfg.dynamic_variables_webhook_url],
    ["insight group", after.insight_settings?.insight_group_id === groupId],
    ["voice kept", after.voice_settings?.voice === current.voice_settings?.voice],
    ["speech slowed", after.voice_settings?.voice_speed === SPEECH.voice_speed],
    [
      "waits before replying",
      after.interruption_settings?.start_speaking_plan?.wait_seconds === SPEECH.wait_seconds,
    ],
    [
      "waits mid phone number",
      after.interruption_settings?.start_speaking_plan?.transcription_endpointing_plan
        ?.on_number_seconds === SPEECH.on_number_seconds,
    ],
    ["model kept", Boolean(after.model)],
    // The failure this whole change exists to prevent.
    ...BRAND_PROMPTS.filter((b) => b.label !== brand.label).map((other) => [
      `does NOT mention ${other.displayName}`,
      !(after.instructions ?? "").includes(other.displayName),
    ]),
  ]
  for (const [name, ok] of checks) console.log(`  ${ok ? "✓" : "✗ FAILED"} ${name}`)
  if (checks.some(([, ok]) => !ok)) {
    throw new Error(`${brand.label}: assistant did not take the update`)
  }
  return { skipped: false }
}

async function main() {
  const env = loadEnv()
  const apiKey = env.TELNYX_API_KEY
  if (!apiKey) throw new Error("TELNYX_API_KEY must be set (.env.local)")

  const sharedBlock = extractInstructions(readFileSync(DOC, "utf8"))
  console.log(`shared block: ${sharedBlock.length} chars`)
  console.log(`variable defaults: ${JSON.stringify(DYNAMIC_VARIABLE_DEFAULTS)}`)

  // Bake every brand BEFORE sending anything. bakeInstructions throws on an
  // unresolved placeholder or a cross-brand mention, and it is far better to
  // fail with nothing sent than to leave one assistant updated and one not.
  for (const brand of BRAND_PROMPTS) bakeInstructions(sharedBlock, brand)

  const groupId = DRY_RUN ? "(dry-run)" : await ensureGroup(apiKey, await ensureInsight(apiKey))

  let synced = 0
  for (const brand of BRAND_PROMPTS) {
    const result = await syncBrand(apiKey, brand, sharedBlock, groupId, env)
    if (!result.skipped) synced++
  }

  console.log(DRY_RUN ? "\n--dry-run: nothing sent to Telnyx" : `\n${synced} assistant(s) updated.`)
}

// Only run when invoked directly, so extractInstructions stays unit-testable.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error("✖", err.message)
    process.exit(1)
  })
}
