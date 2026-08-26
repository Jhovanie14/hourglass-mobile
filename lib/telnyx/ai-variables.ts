// Shared handler behind both dynamic-variable webhook routes.
//
// TWO ROUTES, ONE BODY:
//
//   /api/webhooks/telnyx/ai/variables            — brand resolved at runtime
//   /api/webhooks/telnyx/ai/variables/[brand]    — brand named in the URL
//
// The per-brand path is the one to point new assistants at. Giving each brand
// its own assistant and its own webhook URL means nothing has to work out who
// is calling: the URL says so. Every brand-mixup bug in this feature came from
// runtime resolution — a registry keyed on a short code the database never
// used, a name upper-cased by the env parser, a name missing entirely on a
// portal test. A path segment cannot get any of those wrong.
//
// The unsuffixed route stays for the assistant that already points at it, and
// keeps its sole-configured-label fallback. It can be deleted once no assistant
// references it.

import { createAdminClient } from "@/lib/admin"
import { verifyTelnyxWebhook } from "@/lib/telnyx/webhook"
import { getOnlineReachableAgents } from "@/lib/telnyx/ring-all"
import {
  FAIL_SAFE_VARIABLES,
  transferVariables,
  wrapDynamicVariables,
} from "@/lib/telnyx/ai-transfer"
import { aiAgentSettings } from "@/lib/telnyx/ai-agent"
import { brandVariables, resolveBrandLabel } from "@/lib/telnyx/ai-brand-variables"
import { normalizeLabel } from "@/lib/pricing"
import { fetchCouponsText } from "@/lib/pricing/coupons"

/**
 * @param forcedLabel brand from the URL. When given, no resolution happens and
 *   an unknown value yields no brand keys rather than a guess.
 */
export async function aiVariablesResponse(
  req: Request,
  forcedLabel: string | null = null
): Promise<Response> {
  const rawBody = await req.text()
  const env = process.env as Record<string, string | undefined>

  const valid = verifyTelnyxWebhook({
    body: rawBody,
    signature: req.headers.get("telnyx-signature-ed25519"),
    timestamp: req.headers.get("telnyx-timestamp"),
    publicKeyBase64: env.TELNYX_WEBHOOK_PUBLIC_KEY ?? env.TELNYX_PUBLIC_KEY,
  })
  if (!valid) {
    console.warn(
      "⚠️ AI variables webhook rejected (bad signature / stale timestamp / missing key)"
    )
    // Even with a brand in the URL, an unverified request gets nothing but the
    // presence fail-safe. Omitting the brand keys leaves whatever the start
    // command set standing.
    return Response.json(wrapDynamicVariables({ ...FAIL_SAFE_VARIABLES }))
  }

  let label: string | null
  let source: string
  if (forcedLabel) {
    label = forcedLabel
    source = "url"
  } else {
    const settings = aiAgentSettings(env)
    const resolved = resolveBrandLabel(rawBody, settings?.labels ?? [])
    label = resolved.label
    source = resolved.source
  }

  const vars = brandVariables(label, new Date())

  if (vars) {
    console.log(`🏷️ AI variables: brand=${vars.brand_name} (via ${source})`)
  } else {
    console.warn(
      `⚠️ AI variables: no content for brand (source=${source}, label=${label ?? "none"}).` +
        " Omitting brand keys — the assistant keeps whatever the start command set."
    )
  }

  // SPIKE (2026-08-22). Only worth logging where the brand is still a mystery;
  // a URL-scoped call has nothing to learn from the body.
  if (source !== "url" && source !== "body") {
    console.log("🔍 SPIKE ai/variables request body:", rawBody.slice(0, 2000))
  }

  const brandKeys = vars
    ? {
        brand_name: vars.brand_name,
        brand_label: label ?? "",
        pricing: vars.pricing,
        brand_rules: vars.brand_rules,
        hours: vars.hours,
        open_now: vars.open_now,
      }
    : {}

  // Coupons are Bucket Baddie only, and off unless BB_COUPONS_ENABLED=true.
  // Resolved here rather than at call-start because Telnyx is already waiting
  // on us — a round-trip before the greeting would be dead air.
  const coupons =
    normalizeLabel(label ?? "") === "BUCKET BADDIE"
      ? await fetchCouponsText(env, new Date())
      : ""
  const couponKeys = coupons ? { coupons } : {}

  try {
    const supabase = createAdminClient()
    const agents = await getOnlineReachableAgents(supabase)
    const presence = transferVariables(agents)
    console.log(
      `🤖 AI variables: agents_available=${presence.agents_available} targets=${presence.targets.length}`
    )
    return Response.json(
      wrapDynamicVariables({ ...presence, ...brandKeys, ...couponKeys })
    )
  } catch (err) {
    // Losing presence is no reason to stop the assistant quoting prices — the
    // brand content is a local constant and is still good.
    console.error("⚠️ AI variables webhook failed; falling back to no-agents:", err)
    return Response.json(
      wrapDynamicVariables({ ...FAIL_SAFE_VARIABLES, ...brandKeys, ...couponKeys })
    )
  }
}
