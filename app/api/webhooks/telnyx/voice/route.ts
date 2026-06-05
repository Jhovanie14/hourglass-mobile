import crypto from "crypto"
import Telnyx from "telnyx"
import { createAdminClient } from "@/lib/admin"

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
  // call.recording.saved fields
  recording_url?: string
  duration_ms?: number
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

  const supabase = createAdminClient()

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
    case "call.speak.ended":
      await handleSpeakEnded(supabase, payload)
      break
    case "call.recording.saved":
      await handleRecordingSaved(supabase, payload)
      break
    default:
      console.log("ℹ️ Ignoring voice event:", event_type)
  }

  return Response.json({ ok: true })
}

type SupabaseClient = ReturnType<typeof createAdminClient>

async function handleCallInitiated(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  if (payload.direction === "outgoing") {
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

  const { data: inserted, error: insertError } = await supabase.from("calls").upsert(
    {
      phone_number_id: phoneNumber.id,
      contact_number: payload.from,
      direction: "inbound",
      status: "initiated",
      telnyx_call_id: payload.call_control_id,
    },
    { onConflict: "telnyx_call_id", ignoreDuplicates: true }
  ).select("id, created_at").maybeSingle()

  if (insertError) {
    console.error("⚠️ Failed to insert inbound call:", insertError)
  } else {
    console.log(`📥 Inbound call inserted: id=${inserted?.id} created_at=${inserted?.created_at}`)
  }
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
  } else if (call?.status === "voicemail") {
    finalStatus = "voicemail"
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

async function handleSpeakEnded(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  const { data: call } = await supabase
    .from("calls")
    .select("status")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  if (call?.status !== "voicemail") return

  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })

  try {
    await telnyx.calls.actions.startRecording(payload.call_control_id, {
      format: "mp3",
      channels: "single",
    })
    console.log(`🎙 Recording started for call ${payload.call_control_id}`)
  } catch (err) {
    console.error("⚠️ Failed to start recording:", err)
  }
}

async function handleRecordingSaved(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  const recordingUrl = payload.recording_url
  const durationMs = payload.duration_ms ?? 0

  if (!recordingUrl) {
    console.warn("⚠️ call.recording.saved has no recording_url")
    return
  }

  const { data: call } = await supabase
    .from("calls")
    .select("id, contact_number, phone_number_id, phone_numbers(label)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  if (!call) {
    console.warn("⚠️ No call found for recording:", payload.call_control_id)
    return
  }

  const { error: vmError } = await supabase.from("voicemails").insert({
    call_id: call.id,
    recording_url: recordingUrl,
    duration_seconds: Math.round(durationMs / 1000),
  })

  if (vmError) {
    console.error("⚠️ Failed to insert voicemail:", vmError)
    return
  }

  const { error: flagError } = await supabase
    .from("calls")
    .update({ has_voicemail: true })
    .eq("id", call.id)

  if (flagError) {
    console.error("⚠️ Failed to set has_voicemail flag:", flagError)
  }

  const pn = Array.isArray(call.phone_numbers)
    ? call.phone_numbers[0]
    : call.phone_numbers

  const { error: notifError } = await supabase.from("notifications").insert({
    type: "voicemail",
    reference_id: call.id,
    metadata: {
      contact_number: call.contact_number,
      phone_label: (pn as { label: string } | null)?.label ?? "Unknown",
      duration_seconds: Math.round(durationMs / 1000),
    },
  })

  if (notifError) {
    console.error("⚠️ Failed to insert voicemail notification:", notifError)
  }

  console.log(
    `📬 Voicemail saved for call ${call.id}, duration: ${Math.round(durationMs / 1000)}s`
  )
}
