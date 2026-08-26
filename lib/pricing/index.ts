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
import { BUCKET_BADDIE_HOURS, TLP_HOURS, type BrandHours } from "./hours"

export type BrandContent = {
  /**
   * Resolves `{{ brand_name }}` — the name the assistant SAYS.
   *
   * Kept here rather than derived from env because both env sources mangle it:
   * `aiAgentSettings` upper-cases labels ("THE LAUNCH PAD"), and
   * `AI_BRAND_NAMES` is keyed on a short code that no longer matches the label.
   * A caller hearing "thanks for calling THE LAUNCH PAD" is the giveaway.
   */
  displayName: string
  /** Resolves `{{ pricing }}`. */
  pricingText: () => string
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
  // Hyphens and underscores collapse to spaces too, so a URL slug
  // ("bucket-baddie") resolves to the same brand as the label ("Bucket
  // Baddie"). That is what lets each assistant have its own webhook path.
  return label.trim().toUpperCase().replace(/[\s_-]+/g, " ")
}

/**
 * Keyed by the normalised `phone_numbers.label` — the value that actually
 * arrives at runtime, not the short code used in env.
 *
 * Getting this wrong is silent: an unmatched label returns null, the routes
 * omit the brand keys, and the assistant politely says it cannot quote. It
 * happened on 2026-08-26, when this map was keyed "TLP" while the live row
 * reads "The Launch Pad". Check the DB, not the env, when adding a brand:
 *
 *   select phone_number, label from phone_numbers where is_active;
 */
const BRANDS: Record<string, BrandContent> = {
  "THE LAUNCH PAD": {
    displayName: "The Launch Pad",
    pricingText: () => tlpPricingText(),
    hours: TLP_HOURS,
  },
  // The live label is "Bucket Baddie" — the brand name itself, not a short
  // code. That is why there is no AI_BRAND_NAMES entry for it: brandNameForLabel
  // falls back to the label when unmapped, and the label already reads correctly
  // when spoken. It does still have to appear in AI_AGENT_LABELS, or the AI
  // never picks up.
  "BUCKET BADDIE": {
    displayName: "Bucket Baddie",
    pricingText: () => bucketBaddiePricingText(),
    hours: BUCKET_BADDIE_HOURS,
  },
}

/**
 * Short codes that mean the same brand as a canonical label above.
 *
 * "TLP" is the form used in `AI_BRAND_NAMES` (`TLP:The Launch Pad`) and in the
 * older docs, while `phone_numbers.label` says "The Launch Pad". Both have to
 * resolve, because either can end up in `AI_AGENT_LABELS`.
 */
const LABEL_ALIASES: Record<string, string> = {
  TLP: "THE LAUNCH PAD",
  BB: "BUCKET BADDIE",
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
  const key = normalizeLabel(label)
  return BRANDS[key] ?? BRANDS[LABEL_ALIASES[key] ?? ""] ?? null
}

/**
 * A label reduced to the one spelling everything else keys on.
 *
 * "TLP" and "The Launch Pad" name the same brand — the first is what
 * AI_BRAND_NAMES and the older docs use, the second is what
 * `phone_numbers.label` actually contains. Anything comparing labels must
 * compare canonical forms or the two spellings silently fail to match, which
 * is how AI_AGENT_LABELS=TLP stopped real Launch Pad calls reaching the
 * assistant on 2026-08-26.
 *
 * An unknown label comes back normalised but otherwise untouched, so
 * non-AI brands still compare correctly against each other.
 */
export function canonicalLabel(label: string | null | undefined): string {
  if (!label) return ""
  const key = normalizeLabel(label)
  return LABEL_ALIASES[key] ?? key
}

/** Canonical labels with content. Exposed for tests and diagnostics. */
export function knownBrandLabels(): string[] {
  return Object.keys(BRANDS)
}

/** Every string that resolves, canonical labels and aliases alike. */
export function resolvableLabels(): string[] {
  return [...Object.keys(BRANDS), ...Object.keys(LABEL_ALIASES)]
}
