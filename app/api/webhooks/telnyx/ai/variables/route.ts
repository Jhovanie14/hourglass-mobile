import { aiVariablesResponse } from "@/lib/telnyx/ai-variables"

export const runtime = "nodejs"

/**
 * Legacy, brand-agnostic entry point: the brand is worked out at runtime from
 * the body, or from the sole configured AI label.
 *
 * New assistants should point at `/api/webhooks/telnyx/ai/variables/<brand>`
 * instead, which names the brand in the URL and cannot get it wrong. This route
 * exists for the assistant already configured against it, and can be deleted
 * once nothing references it.
 */
export async function POST(req: Request) {
  return aiVariablesResponse(req)
}
