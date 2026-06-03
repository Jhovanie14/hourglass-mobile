import crypto from "crypto"
import { createClient } from "@/lib/server"

export const runtime = "nodejs"

type TelnyxCallPayload = {
  call_control_id: string
  call_leg_id: string
  from: string
  to: string
  direction: "incoming" | "outgoing"
  state?: string
  hangup_cause?: string
  start_time?: string
  end_time?: string
  connection_id?: string
}

type TelnyxVoiceWebhookBody = {
  data: {
    event_type: string
    payload: TelnyxCallPayload
  }
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  publicKeyBase64: string
): boolean {
  if (!signatureHeader || !timestampHeader) return false
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        ED25519_SPKI_PREFIX,
        Buffer.from(publicKeyBase64, "base64"),
      ]),
      format: "der",
      type: "spki",
    })
    return crypto.verify(
      null,
      Buffer.from(`${timestampHeader}|${rawBody}`),
      publicKey,
      Buffer.from(signatureHeader, "base64")
    )
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text()

  const publicKey =
    process.env.TELNYX_WEBHOOK_PUBLIC_KEY ?? process.env.TELNYX_PUBLIC_KEY

  if (publicKey) {
    const valid = verifySignature(
      rawBody,
      req.headers.get("telnyx-signature-ed25519"),
      req.headers.get("telnyx-timestamp"),
      publicKey
    )
    if (!valid) {
      console.warn("⚠️ Voice webhook signature verification failed")
      return Response.json({ error: "Invalid signature" }, { status: 403 })
    }
  }

  const body = JSON.parse(rawBody) as TelnyxVoiceWebhookBody
  const { event_type, payload } = body.data
  console.log("📞 Telnyx voice event:", event_type, {
    call_control_id: payload.call_control_id,
    direction: payload.direction,
    from: payload.from,
    to: payload.to,
  })

  const supabase = await createClient()

  switch (event_type) {
    case "call.initiated":
      await handleCallInitiated(supabase, payload)
      break
    case "call.answered":
      await handleCallAnswered(supabase, payload)
      break
    case "call.hangup":
      await handleCallHangup(supabase, payload)
      break
    default:
      console.log("ℹ️ Ignoring voice event:", event_type)
  }

  return Response.json({ ok: true })
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

async function handleCallInitiated(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  if (payload.direction === "outgoing") {
    // Outbound call via WebRTC — look up our phone number by the `from` field
    // and insert the record (there is no prior REST call to create it).
    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("id")
      .eq("phone_number", payload.from)
      .eq("is_active", true)
      .maybeSingle()

    if (!phoneNumber) {
      console.warn("⚠️ No active phone number matches from:", payload.from)
      return
    }

    await supabase.from("calls").upsert(
      {
        phone_number_id: phoneNumber.id,
        contact_number: payload.to,
        direction: "outbound",
        status: "initiated",
        telnyx_call_id: payload.call_control_id,
      },
      { onConflict: "telnyx_call_id", ignoreDuplicates: true }
    )
    return
  }

  // Inbound — find which of our numbers was dialled.
  const toNumber = payload.to
  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("id")
    .eq("phone_number", toNumber)
    .eq("is_active", true)
    .maybeSingle()

  if (!phoneNumber) {
    console.warn("⚠️ No active phone number matches:", toNumber)
    return
  }

  await supabase.from("calls").upsert(
    {
      phone_number_id: phoneNumber.id,
      contact_number: payload.from,
      direction: "inbound",
      status: "initiated",
      telnyx_call_id: payload.call_control_id,
    },
    { onConflict: "telnyx_call_id", ignoreDuplicates: true }
  )
}

async function handleCallAnswered(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  await supabase
    .from("calls")
    .update({
      status: "answered",
      started_at: payload.start_time ?? new Date().toISOString(),
    })
    .eq("telnyx_call_id", payload.call_control_id)
}

async function handleCallHangup(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, started_at, direction, phone_number_id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  const wasAnswered =
    call?.status === "answered" || call?.status === "completed"
  const endedAt = payload.end_time ?? new Date().toISOString()

  let finalStatus: string
  if (wasAnswered) {
    finalStatus = "completed"
  } else if (call?.direction === "inbound") {
    finalStatus = "missed"
  } else {
    finalStatus = "failed"
  }

  let durationSeconds: number | null = null
  if (wasAnswered && call?.started_at) {
    durationSeconds = Math.round(
      (new Date(endedAt).getTime() - new Date(call.started_at).getTime()) /
        1000
    )
  }

  await supabase
    .from("calls")
    .update({
      status: finalStatus,
      ended_at: endedAt,
      ...(durationSeconds !== null && { duration_seconds: durationSeconds }),
    })
    .eq("telnyx_call_id", payload.call_control_id)

  console.log(
    `📴 Call ${payload.call_control_id} → ${finalStatus}`,
    durationSeconds != null ? `(${durationSeconds}s)` : ""
  )

  if (finalStatus === "missed" && call?.id && call?.phone_number_id) {
    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("label, color")
      .eq("id", call.phone_number_id)
      .maybeSingle()

    const { error } = await supabase.from("notifications").insert({
      type: "missed_call",
      reference_id: call.id,
      metadata: {
        contact_number: payload.from,
        phone_label: phoneNumber?.label ?? "Unknown",
        phone_color: phoneNumber?.color ?? "#6b7280",
      },
    })

    if (error) {
      console.error("⚠️ Failed to insert missed_call notification:", error)
    }
  }
}
