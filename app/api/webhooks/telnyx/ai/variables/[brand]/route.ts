import { aiVariablesResponse } from "@/lib/telnyx/ai-variables"

export const runtime = "nodejs"

/**
 * Per-brand dynamic-variable webhook. Point each Telnyx assistant at its own
 * path and the brand stops being a runtime question:
 *
 *   .../ai/variables/the-launch-pad
 *   .../ai/variables/bucket-baddie
 *
 * The slug is matched against `phone_numbers.label` with hyphens treated as
 * spaces (see `normalizeLabel`), so `bucket-baddie` finds "Bucket Baddie". An
 * unknown slug yields no brand keys at all rather than another brand's prices.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ brand: string }> }
) {
  const { brand } = await params
  return aiVariablesResponse(req, { urlLabel: brand })
}
