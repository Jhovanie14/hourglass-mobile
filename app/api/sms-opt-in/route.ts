import { createAdminClient } from "@/lib/admin"
import { CONSENT_TEXT, CONSENT_VERSION, validateOptIn } from "@/lib/sms-consent"

// Records a verifiable SMS opt-in from the public /sms-signup form.
//
// This is the consent proof Telnyx requires for the 10DLC campaign: each row is
// a timestamped record of someone agreeing to the exact CONSENT_TEXT. No
// outbound SMS is sent here — outbound is filtered by carriers until the
// campaign is approved; the confirmation text becomes the first message after
// approval.
export const runtime = "nodejs"

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 })
  }

  const result = validateOptIn(body as Record<string, unknown>)
  if (!result.ok) {
    return Response.json({ errors: result.errors }, { status: 422 })
  }

  const supabase = createAdminClient()

  const { error } = await supabase.from("sms_consents").insert({
    name: result.value.name,
    phone: result.value.phone,
    consent_text: CONSENT_TEXT,
    consent_version: CONSENT_VERSION,
    source: "web_form:/sms-signup",
    ip_address:
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: req.headers.get("user-agent"),
  })

  if (error) {
    console.error("Failed to record SMS consent:", error)
    return Response.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    )
  }

  return Response.json({ ok: true })
}
