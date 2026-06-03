import Telnyx from "telnyx"
import { createClient } from "@/lib/server"

export const runtime = "nodejs"

const DEFAULT_GREETING =
  "Hi, you've reached our team. We're unavailable right now. Please leave a message after the tone."

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret")
  if (secret !== process.env.CRON_SECRET) {
    console.warn("⚠️ voicemail-check: unauthorized request")
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createClient()
  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })

  const threshold = new Date(Date.now() - 30_000).toISOString()

  const { data: staleCalls } = await supabase
    .from("calls")
    .select("id, telnyx_call_id, phone_numbers(voicemail_greeting)")
    .eq("status", "initiated")
    .eq("direction", "inbound")
    .lt("created_at", threshold)

  if (!staleCalls || staleCalls.length === 0) {
    return Response.json({ ok: true, triggered: 0 })
  }

  let triggered = 0

  for (const call of staleCalls) {
    // Atomic guard — only proceed if this process wins the status update
    const { data: updated } = await supabase
      .from("calls")
      .update({ status: "voicemail" })
      .eq("id", call.id)
      .eq("status", "initiated")
      .select("id")
      .maybeSingle()

    if (!updated) continue

    const pn = Array.isArray(call.phone_numbers)
      ? call.phone_numbers[0]
      : call.phone_numbers
    const greeting =
      (pn as { voicemail_greeting: string | null } | null)
        ?.voicemail_greeting ?? DEFAULT_GREETING

    try {
      await telnyx.calls.actions.answer(call.telnyx_call_id, {})
      await telnyx.calls.actions.speak(call.telnyx_call_id, {
        payload: greeting,
        voice: "female",
        language: "en-US",
      })
      triggered++
      console.log(`🎙 Voicemail triggered for call ${call.id}`)
    } catch (err) {
      console.error("⚠️ Failed to trigger voicemail for call:", call.id, err)
      await supabase
        .from("calls")
        .update({ status: "missed" })
        .eq("id", call.id)
    }
  }

  return Response.json({ ok: true, triggered })
}
