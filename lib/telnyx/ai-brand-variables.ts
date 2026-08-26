// Brand-specific dynamic variables for the shared Telnyx AI Assistant.
//
// One assistant serves every AI brand, so everything brand-specific it says has
// to arrive as a dynamic variable. This module is the single place that turns a
// `phone_numbers.label` into that variable set, so the two callers — the
// startAIAssistant command and the /ai/variables webhook — can never disagree
// about what a brand's prices are.
//
// WHY BOTH CALLERS EXIST. The label is known for certain at call-start
// (it comes straight off the `phone_numbers` row), and only *maybe* known at
// variable-resolution time, because nobody has confirmed what Telnyx puts in
// the webhook body — see the SPIKE log in the webhook route. So the start
// command is the primary path and the webhook is a top-up that omits these keys
// entirely when it cannot identify the brand. Omitting is deliberate: an
// omitted variable leaves the start-command value standing, where an empty
// string would overwrite good prices with nothing.
//
// Pure — no env, DB or SDK access — so it unit-tests in plain node.

import { brandContentForLabel } from "@/lib/pricing"
import { hoursText, isOpenAt } from "@/lib/pricing/hours"

export type BrandVariables = {
  /** `{{ pricing }}` — the brand's menu or price list. */
  pricing: string
  /** `{{ brand_rules }}` — policy true of this brand only. Keeps a car wash's
   *  membership rules out of a chicken shop's call on the shared assistant. */
  brand_rules: string
  /** `{{ hours }}` — empty for a brand with no published hours. */
  hours: string
  /**
   * `{{ open_now }}` — tri-state, NOT a boolean.
   *
   * A boolean forces a brand with no hours (TLP) to claim one or the other,
   * and both are wrong: "no" turns away a caller we could have served, "yes"
   * sends someone to a locked door. "unknown" lets the assistant say it cannot
   * confirm and take a message, which is the only honest third option.
   */
  open_now: "yes" | "no" | "unknown"
}

/**
 * Variables for a brand, or null when the label has no content registered.
 *
 * Null means "say nothing about this brand" — callers must omit the keys rather
 * than substitute another brand's. Quoting car wash prices to someone ringing
 * a chicken shop is worse than quoting nothing.
 */
export function brandVariables(
  label: string | null | undefined,
  now: Date
): BrandVariables | null {
  const content = brandContentForLabel(label)
  if (!content) return null

  return {
    pricing: content.pricingText(),
    brand_rules: content.rulesText(),
    hours: content.hours ? hoursText(content.hours) : "",
    open_now: content.hours ? (isOpenAt(content.hours, now) ? "yes" : "no") : "unknown",
  }
}

/**
 * Best-effort brand label out of the /ai/variables webhook body.
 *
 * The body shape is undocumented and unverified — the whole reason the start
 * command carries these variables too. Rather than guess at one path, this
 * walks the parsed object for a `brand_label` string wherever it sits, which
 * survives Telnyx nesting it under `data`, `payload`, `conversation`, or
 * `dynamic_variables` without needing to know which.
 *
 * Returns null on unparseable JSON, a missing key, or a non-string value.
 * Never throws: it runs inside a webhook that must answer regardless.
 */
export function brandLabelFromWebhookBody(rawBody: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return null
  }
  return findBrandLabel(parsed, 0)
}

export type BrandResolution = {
  label: string | null
  source: "body" | "sole-configured-label" | "unresolved"
}

/**
 * Which brand is this webhook call about?
 *
 * Two ways, in order:
 *
 *  1. The body says so. Preferred, works for any number of brands, but
 *     unverified — nobody has confirmed Telnyx sends it.
 *  2. Only one brand has the AI enabled, so there is nothing it could be.
 *     This is today's production state (`AI_AGENT_LABELS=TLP`) and it makes the
 *     brand-aware rewrite a provable no-op for TLP: same prices, same block.
 *
 * When neither applies the answer is null and the caller must omit the brand
 * keys. That is the honest failure — the alternative is picking a brand and
 * quoting car wash prices to someone ringing a chicken shop.
 *
 * Note the consequence of adding a second brand: rule 2 stops applying, so
 * everything rests on rule 1. If Telnyx turns out not to send `brand_label`,
 * that shows up as a loud log on the first call after BB is enabled, rather
 * than as a wrong price. That is deliberate — the risk is concentrated at a
 * moment somebody is watching.
 */
export function resolveBrandLabel(
  rawBody: string,
  configuredLabels: string[]
): BrandResolution {
  const fromBody = brandLabelFromWebhookBody(rawBody)
  if (fromBody) return { label: fromBody, source: "body" }

  if (configuredLabels.length === 1) {
    return { label: configuredLabels[0], source: "sole-configured-label" }
  }

  return { label: null, source: "unresolved" }
}

/** Depth-capped so a pathological payload can't stall the webhook. */
const MAX_SEARCH_DEPTH = 8

function findBrandLabel(node: unknown, depth: number): string | null {
  if (depth > MAX_SEARCH_DEPTH || node === null || typeof node !== "object") {
    return null
  }

  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findBrandLabel(entry, depth + 1)
      if (found) return found
    }
    return null
  }

  const record = node as Record<string, unknown>
  const direct = record.brand_label
  if (typeof direct === "string" && direct.trim() !== "") return direct.trim()

  for (const value of Object.values(record)) {
    const found = findBrandLabel(value, depth + 1)
    if (found) return found
  }
  return null
}
