import Telnyx from "telnyx"
import { createClient } from "@/lib/server"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { to, phone_number_id } = await req.json()

  if (!to || !phone_number_id) {
    return Response.json(
      { error: "Missing required fields: to, phone_number_id" },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  const { data: phoneNumber, error: phoneError } = await supabase
    .from("phone_numbers")
    .select("phone_number")
    .eq("id", phone_number_id)
    .eq("is_active", true)
    .single()

  if (phoneError || !phoneNumber) {
    return Response.json({ error: "Phone number not found" }, { status: 404 })
  }

  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })

  const telnyxCall = await telnyx.calls.dial({
    connection_id: process.env.TELNYX_VOICE_APP_ID!,
    to,
    from: phoneNumber.phone_number,
  })

  const callControlId = telnyxCall.data?.call_control_id

  const { data: callRecord, error: insertError } = await supabase
    .from("calls")
    .insert({
      phone_number_id,
      contact_number: to,
      direction: "outbound",
      status: "initiated",
      telnyx_call_id: callControlId,
    })
    .select("id")
    .single()

  if (insertError) {
    console.error("Failed to insert call record:", insertError)
    return Response.json({ error: "Failed to save call" }, { status: 500 })
  }

  return Response.json({ ok: true, call_id: callRecord.id, call_control_id: callControlId })
}
