// Brand registry: a `phone_numbers.label` → the content that brand's AI
// receptionist speaks.
//
// The seam between brands is the OUTPUT, not the data shape. TLP sells
// memberships and washes; Bucket Baddie sells combos and glazes. Their data
// types have nothing in common and shouldn't — what they share is that each
// produces a plain text block for `{{ pricing }}`. This module is the only
// place that knows both exist.
//
// Labels are the same keys `AI_AGENT_LABELS` and `AI_BRAND_NAMES` already use
// (see lib/telnyx/ai-agent.ts), matched case-insensitively for the same reason:
// `phone_numbers.label` is hand-entered.
//
// Pure — no env or DB access — so it unit-tests in plain node.

import { pricingText as tlpPricingText } from "@/lib/tlp-pricing"
import { bucketBaddiePricingText } from "./bucketbaddie"
import { BUCKET_BADDIE_HOURS, type BrandHours } from "./hours"
import { BUCKET_BADDIE_RULES, TLP_RULES } from "./rules"

export type BrandContent = {
  /** Resolves `{{ pricing }}`. */
  pricingText: () => string
  /** Resolves `{{ brand_rules }}` — policy that is true of this brand only. */
  rulesText: () => string
  /** Resolves `{{ hours }}` and `{{ open_now }}`. Null where a brand has no
   *  published hours — TLP has never had any in the prompt. */
  hours: BrandHours | null
}

/**
 * `phone_numbers.label`, normalised. Upper-cased and with runs of internal
 * whitespace collapsed, because the label is hand-entered and Bucket Baddie's
 * is two words — "Bucket  Baddie" with a stray double space would otherwise
 * silently miss the registry and cost the caller their menu.
 */
export function normalizeLabel(label: string): string {
  return label.trim().toUpperCase().replace(/\s+/g, " ")
}

/** Keyed by the normalised `phone_numbers.label`. */
const BRANDS: Record<string, BrandContent> = {
  TLP: {
    pricingText: () => tlpPricingText(),
    rulesText: () => TLP_RULES,
    hours: null,
  },
  // The live label is "Bucket Baddie" — the brand name itself, not a short
  // code. That is why there is no AI_BRAND_NAMES entry for it: brandNameForLabel
  // falls back to the label when unmapped, and the label already reads correctly
  // when spoken. It does still have to appear in AI_AGENT_LABELS, or the AI
  // never picks up.
  "BUCKET BADDIE": {
    pricingText: () => bucketBaddiePricingText(),
    rulesText: () => BUCKET_BADDIE_RULES,
    hours: BUCKET_BADDIE_HOURS,
  },
}

/**
 * Content for a label, or null when the label isn't a brand we have content
 * for.
 *
 * Null is a real outcome, not an error: a number can be flagged AI-enabled in
 * env before anyone writes its menu. The caller's job is to degrade to an empty
 * pricing block — which makes the assistant say it can't quote and take a
 * message — rather than substitute another brand's prices. Serving TLP's wash
 * prices to a Bucket Baddie caller would be worse than serving nothing.
 */
export function brandContentForLabel(
  label: string | null | undefined
): BrandContent | null {
  if (!label) return null
  return BRANDS[normalizeLabel(label)] ?? null
}

/** Labels with content, upper-cased. Exposed for tests and diagnostics. */
export function knownBrandLabels(): string[] {
  return Object.keys(BRANDS)
}
