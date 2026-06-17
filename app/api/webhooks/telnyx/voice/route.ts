import { createAdminClient } from "@/lib/admin"
import { verifyTelnyxWebhook } from "@/lib/telnyx/webhook"
import { decodeClientState } from "@/lib/telnyx/client-state"
import {
  answerCaller,
  dialAgent,
  bridgeLegs,
  startVoicemail,
  DEFAULT_GREETING,
} from "@/lib/telnyx/voice-orchestrator"

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
  client_state?: string | null
  // call.recording.saved fields
  recording_url?: string // legacy/unused by Telnyx; real URLs live in recording_urls
  recording_urls?: { mp3?: string; wav?: string }
  public_recording_urls?: { mp3?: string; wav?: string }
  recording_started_at?: string
  recording_ended_at?: string
  duration_ms?: number
}

type TelnyxVoiceWebhookBody = {
  data: {
    event_type: string
    payload: TelnyxCallPayload
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text()

  const valid = verifyTelnyxWebhook({
    body: rawBody,
    signature: req.headers.get("telnyx-signature-ed25519"),
    timestamp: req.headers.get("telnyx-timestamp"),
    publicKeyBase64: process.env.TELNYX_WEBHOOK_PUBLIC_KEY ?? process.env.TELNYX_PUBLIC_KEY,
  })
  if (!valid) {
    console.warn("⚠️ Voice webhook rejected (bad signature / stale timestamp / missing key)")
    return Response.json({ error: "Invalid signature" }, { status: 403 })
  }

  const body = JSON.parse(rawBody) as TelnyxVoiceWebhookBody
  const { event_type, payload } = body.data
  console.log("📞 Telnyx voice event:", event_type, {
    call_control_id: payload.call_control_id,
    leg: payload.client_state ? "AGENT(B)" : "CALLER(A)",
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

async function handleCallInitiated(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const agentState = decodeClientState(payload.client_state)

  // The dialed agent leg (B) is outgoing and tagged — never log it as a call.
  if (agentState?.role === "agent") return

  if (payload.direction === "outgoing") {
    // Softphone-originated outbound call — preserve existing logging.
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

  // Inbound caller leg (A): log it, then answer so we can orchestrate.
  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("id")
    .eq("phone_number", payload.to)
    .eq("is_active", true)
    .maybeSingle()

  if (!phoneNumber) {
    console.warn("⚠️ No active phone number matches:", payload.to)
    return
  }

  const { error: insertError } = await supabase.from("calls").upsert(
    {
      phone_number_id: phoneNumber.id,
      contact_number: payload.from,
      direction: "inbound",
      status: "initiated",
      telnyx_call_id: payload.call_control_id,
    },
    { onConflict: "telnyx_call_id", ignoreDuplicates: true }
  )
  if (insertError) {
    console.error("⚠️ Failed to insert inbound call:", insertError)
  }

  try {
    await answerCaller(payload.call_control_id)
  } catch (err) {
    console.error("⚠️ Failed to answer inbound caller:", err)
  }
}

async function handleCallAnswered(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const agentState = decodeClientState(payload.client_state)

  // Agent (leg B) picked up. The legs were already bridged at dial time (with
  // ringback), so the agent answering simply completes the connection — just
  // mark the caller's call answered.
  if (agentState?.role === "agent") {
    const { error } = await supabase
      .from("calls")
      .update({ status: "answered", started_at: new Date().toISOString() })
      .eq("telnyx_call_id", agentState.aLegId)
    if (error) console.error("⚠️ Failed to mark call answered:", error)
    return
  }

  // Caller (leg A) was answered by us → look up DB id, then dial the agent.
  const { data: call } = await supabase
    .from("calls")
    .select("id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) return

  try {
    const agentLegId = await dialAgent({
      aLegId: payload.call_control_id,
      callId: call.id,
      didNumber: payload.to, // owned DID the customer dialed
      callerNumber: payload.from, // shown to the agent as caller ID
    })
    // Bridge now, before the agent answers, so Telnyx plays ringback to the
    // caller while the agent leg rings. (We answered the caller leg early to
    // orchestrate, which stopped the carrier ringback.)
    await bridgeLegs(payload.call_control_id, agentLegId, { playRingtone: true })
  } catch (err) {
    console.error("⚠️ Failed to dial agent; sending caller to voicemail:", err)
    await beginVoicemail(supabase, payload.call_control_id)
  }
}

async function handleCallHangup(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const agentState = decodeClientState(payload.client_state)

  // Agent leg (B) ended. If the caller leg was never bridged (still "initiated"),
  // the agent was offline or didn't answer → voicemail.
  if (agentState?.role === "agent") {
    const { data: callerCall } = await supabase
      .from("calls")
      .select("status")
      .eq("telnyx_call_id", agentState.aLegId)
      .maybeSingle()
    if (callerCall?.status === "initiated") {
      await beginVoicemail(supabase, agentState.aLegId)
    }
    return
  }

  // Caller leg (A) ended.
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, started_at, direction, phone_number_id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  const wasAnswered = call?.status === "answered" || call?.status === "completed"
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
      (new Date(endedAt).getTime() - new Date(call.started_at).getTime()) / 1000
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

/** Resolve the greeting, flip the caller's call to voicemail (idempotently), and speak it. */
async function beginVoicemail(supabase: SupabaseClient, aLegId: string) {
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, phone_numbers(voicemail_greeting)")
    .eq("telnyx_call_id", aLegId)
    .maybeSingle()

  // Idempotency: only start once.
  if (!call || call.status === "voicemail") return

  await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)

  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  const greeting =
    (pn as { voicemail_greeting: string | null } | null)?.voicemail_greeting ?? DEFAULT_GREETING

  try {
    await startVoicemail(aLegId, greeting)
  } catch (err) {
    console.error("⚠️ Failed to start voicemail greeting:", err)
  }
}

async function handleSpeakEnded(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const { data: call } = await supabase
    .from("calls")
    .select("status")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  if (call?.status !== "voicemail") return

  const { getTelnyxClient, withRetry } = await import("@/lib/telnyx/client")
  try {
    await withRetry(() =>
      getTelnyxClient().calls.actions.startRecording(payload.call_control_id, {
        format: "mp3",
        channels: "single",
        play_beep: true, // play the "tone" the greeting promises before recording
      })
    )
    console.log(`🎙 Recording started for call ${payload.call_control_id}`)
  } catch (err) {
    console.error("⚠️ Failed to start recording:", err)
  }
}

async function handleRecordingSaved(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  // Telnyx puts the real (signed, time-limited) URLs in recording_urls; the flat
  // recording_url field is not populated. Prefer mp3, fall back to wav/legacy.
  const recordingUrl =
    payload.recording_urls?.mp3 ?? payload.recording_urls?.wav ?? payload.recording_url

  // duration_ms isn't sent on this event; derive it from the recording timestamps.
  let durationMs = payload.duration_ms ?? 0
  if (!durationMs && payload.recording_started_at && payload.recording_ended_at) {
    durationMs =
      new Date(payload.recording_ended_at).getTime() -
      new Date(payload.recording_started_at).getTime()
  }

  if (!recordingUrl) {
    console.warn("⚠️ call.recording.saved has no recording url")
    return
  }

  const { data: call } = await supabase
    .from("calls")
    .select("id, contact_number, phone_number_id, has_voicemail, phone_numbers(label)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  if (!call) {
    console.warn("⚠️ No call found for recording:", payload.call_control_id)
    return
  }
  if (call.has_voicemail) return // idempotency: already processed

  // Copy the MP3 into the private bucket; fall back to the Telnyx URL on failure
  // so a voicemail is never lost.
  let storagePath: string | null = null
  try {
    const res = await fetch(recordingUrl)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const path = `${call.id}.mp3`
    const { error: upErr } = await supabase.storage
      .from("voicemails")
      .upload(path, bytes, { contentType: "audio/mpeg", upsert: true })
    if (upErr) throw upErr
    storagePath = path
  } catch (err) {
    console.error("⚠️ Failed to copy recording to private bucket; keeping Telnyx URL:", err)
  }

  const { error: vmError } = await supabase.from("voicemails").insert({
    call_id: call.id,
    recording_url: recordingUrl,
    storage_path: storagePath,
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

  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers

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
