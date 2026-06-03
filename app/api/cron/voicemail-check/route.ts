import Telnyx from "telnyx"
import { createClient } from "@/lib/server"

export const runtime = "nodejs"

const DEFAULT_GREETING =
  "Hi, you've reached our team. We're unavailable right now. Please leave a message after the tone."

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret")
  if (!process.env.CRON_SECRET) {
    console.error("⚠️ CRON_SECRET env var is not set — cron route disabled")
    return Response.json({ error: "Server misconfiguration" }, { status: 500 })
  }
  if (secret !== process.env.CRON_SECRET) {
    console.warn("⚠️ voicemail-check: unauthorized request")
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createClient()
  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })

  const threshold = new Date(Date.now() - 30_000).toISOString()

  const { data: staleCalls, error: fetchError } = await supabase
    .from("calls")
    .select("id, telnyx_call_id, phone_numbers(voicemail_greeting)")
    .eq("status", "initiated")
    .eq("direction", "inbound")
    .lt("created_at", threshold)
    .limit(20)

  if (fetchError) {
    console.error("⚠️ voicemail-check: failed to fetch stale calls", fetchError)
    return Response.json({ error: "DB error" }, { status: 500 })
  }

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

    if (!call.telnyx_call_id) {
      console.warn("⚠️ voicemail-check: call has no telnyx_call_id, skipping", call.id)
      continue
    }

    const pn = Array.isArray(call.phone_numbers)
      ? call.phone_numbers[0]
      : call.phone_numbers
    const greeting =
      (pn as { voicemail_greeting: string | null } | null)
        ?.voicemail_greeting ?? DEFAULT_GREETING

    try {
      await telnyx.calls.actions.answer(call.telnyx_call_id, {})
      try {
        await telnyx.calls.actions.speak(call.telnyx_call_id, {
          payload: greeting,
          voice: "female",
          language: "en-US",
        })
        triggered++
        console.log(`🎙 Voicemail triggered for call ${call.id}`)
      } catch (speakErr) {
        console.error("⚠️ speak failed for call:", call.id, speakErr)
        await telnyx.calls.actions.hangup(call.telnyx_call_id, {}).catch(() => {})
        throw speakErr
      }
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
