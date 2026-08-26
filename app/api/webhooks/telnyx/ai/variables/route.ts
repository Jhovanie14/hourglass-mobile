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

export const runtime = "nodejs"

/**
 * Telnyx POSTs this once, at the start of an AI conversation, to resolve the
 * assistant's dynamic variables. We answer with whether any agent is online,
 * the SIP targets its transfer tool may use, and — when we can tell which brand
 * is on the line — that brand's menu, hours and deals.
 *
 * WHY THE BRAND KEYS ARE SOMETIMES OMITTED RATHER THAN EMPTIED. The brand is
 * known for certain at call-start, where `startAIAssistantOnCall` already sets
 * pricing/hours/open_now as dynamic variables. Here it is only *maybe* known,
 * because nobody has confirmed Telnyx sends `brand_label` in this body. So when
 * the brand can't be resolved we leave those keys out of the response entirely:
 * an omitted key leaves the start-command value standing, where an empty string
 * would overwrite good prices with nothing.
 *
 * Every failure path still returns the presence fail-safe, so the assistant
 * tells the caller nobody is available and takes a message.
 */
export async function POST(req: Request) {
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
    // An unverified body must not be trusted to name a brand, so no brand keys
    // here. The start command already supplied them; omitting leaves them be.
    return Response.json(wrapDynamicVariables({ ...FAIL_SAFE_VARIABLES }))
  }

  const settings = aiAgentSettings(env)
  const { label, source } = resolveBrandLabel(rawBody, settings?.labels ?? [])
  const vars = brandVariables(label, new Date())

  if (vars) {
    console.log(`🏷️ AI variables: brand=${label} (resolved via ${source})`)
  } else {
    console.warn(
      `⚠️ AI variables: brand unresolved (source=${source}, label=${label ?? "none"}).` +
        " Omitting pricing/hours/open_now — the assistant keeps whatever the start command set."
    )
  }

  // SPIKE (2026-08-22, Track B unknown #1). Logged only when the body did NOT
  // carry the brand, because that is the only case where its contents are still
  // a mystery worth 2KB of log. A `resolved via body` line above answers the
  // original question on its own; this is here for what else is in there.
  if (source !== "body") {
    console.log("🔍 SPIKE ai/variables request body:", rawBody.slice(0, 2000))
  }

  const brandKeys = vars
    ? {
        pricing: vars.pricing,
        brand_rules: vars.brand_rules,
        hours: vars.hours,
        open_now: vars.open_now,
      }
    : {}

  // Coupons are Bucket Baddie only, and off unless BB_COUPONS_ENABLED=true.
  // They are resolved here rather than at call-start because this is where
  // Telnyx is already waiting on us — adding a network round-trip before the
  // assistant's first word would be dead air on the caller's ear.
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
