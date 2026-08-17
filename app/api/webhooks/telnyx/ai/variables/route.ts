import { createAdminClient } from "@/lib/admin"
import { verifyTelnyxWebhook } from "@/lib/telnyx/webhook"
import { getOnlineReachableAgents } from "@/lib/telnyx/ring-all"
import {
  FAIL_SAFE_VARIABLES,
  transferVariables,
  wrapDynamicVariables,
} from "@/lib/telnyx/ai-transfer"

export const runtime = "nodejs"

/** Always 200 with the take-a-message state. Telnyx falls back to assistant
 *  defaults on a non-2xx, so an error status would reach the same outcome —
 *  but a 200 stops it retrying a request we are never going to accept. */
function failSafe(): Response {
  return Response.json(wrapDynamicVariables(FAIL_SAFE_VARIABLES))
}

/**
 * Telnyx POSTs this once, at the start of an AI conversation, to resolve the
 * assistant's dynamic variables. We answer with whether any agent is online
 * and the SIP targets its transfer tool may use.
 *
 * The request body is deliberately unused beyond signature verification:
 * brand naming already arrives via `dynamic_variables.brand_label` on the
 * startAIAssistant command, and availability is global rather than per-number,
 * so nothing here depends on the (undocumented) payload shape.
 *
 * Every failure path returns the fail-safe state, so the assistant tells the
 * caller nobody is available and takes a message — today's behaviour.
 */
export async function POST(req: Request) {
  const rawBody = await req.text()

  const valid = verifyTelnyxWebhook({
    body: rawBody,
    signature: req.headers.get("telnyx-signature-ed25519"),
    timestamp: req.headers.get("telnyx-timestamp"),
    publicKeyBase64:
      process.env.TELNYX_WEBHOOK_PUBLIC_KEY ?? process.env.TELNYX_PUBLIC_KEY,
  })
  if (!valid) {
    console.warn(
      "⚠️ AI variables webhook rejected (bad signature / stale timestamp / missing key)"
    )
    return failSafe()
  }

  try {
    const supabase = createAdminClient()
    const agents = await getOnlineReachableAgents(supabase)
    const vars = transferVariables(agents)
    console.log(
      `🤖 AI variables: agents_available=${vars.agents_available} targets=${vars.targets.length}`
    )
    return Response.json(wrapDynamicVariables(vars))
  } catch (err) {
    console.error("⚠️ AI variables webhook failed; falling back to no-agents:", err)
    return failSafe()
  }
}
