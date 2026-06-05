import Telnyx from "telnyx"
import { createAdminClient } from "@/lib/admin"

export const runtime = "nodejs"

const DEFAULT_GREETING =
  "Hi, you've reached our team. We're unavailable right now. Please leave a message after the tone."

export async function POST(req: Request) {
  const { call_control_id } = await req.json()
  if (!call_control_id) {
    return Response.json({ error: "Missing call_control_id" }, { status: 400 })
  }

  const supabase = createAdminClient()
  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })

  const { data: call } = await supabase
    .from("calls")
    .select("id, phone_numbers(voicemail_greeting)")
    .eq("telnyx_call_id", call_control_id)
    .maybeSingle()

  const pn = Array.isArray(call?.phone_numbers) ? call?.phone_numbers[0] : call?.phone_numbers
  const greeting = (pn as { voicemail_greeting: string | null } | null)?.voicemail_greeting ?? DEFAULT_GREETING

  // Mark as voicemail so speak.ended handler knows to start recording
  if (call?.id) {
    await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)
  }

  await telnyx.calls.actions.speak(call_control_id, {
    payload: greeting,
    voice: "female",
    language: "en-US",
  })

  console.log(`🎙 Voicemail greeting started for call ${call_control_id}`)
  return Response.json({ ok: true })
}
