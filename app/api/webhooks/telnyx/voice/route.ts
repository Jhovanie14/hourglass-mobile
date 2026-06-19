import { createAdminClient } from "@/lib/admin"
import { verifyTelnyxWebhook } from "@/lib/telnyx/webhook"
import { decodeClientState } from "@/lib/telnyx/client-state"
import {
  answerCaller,
  dialAgentLeg,
  hangupLeg,
  bridgeLegs,
  startVoicemail,
  DEFAULT_GREETING,
} from "@/lib/telnyx/voice-orchestrator"
import {
  getOnlineReachableAgents,
  recordAgentLegs,
  claimCall,
  markLegAnswered,
  markLegFailedIfRinging,
  getRingingAgentLegIds,
  getAnsweredAgentLegId,
} from "@/lib/telnyx/ring-all"

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

  // Inbound caller leg (A): log it as `ringing`, then fan out to all online
  // agents WITHOUT answering A (so the carrier plays native ringback). A is
  // answered only when an agent wins (to bridge) or when we fall to voicemail.
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

  await supabase.from("calls").upsert(
    {
      phone_number_id: phoneNumber.id,
      contact_number: payload.from,
      direction: "inbound",
      status: "ringing",
      telnyx_call_id: payload.call_control_id,
    },
    { onConflict: "telnyx_call_id", ignoreDuplicates: true }
  )

  const { data: call } = await supabase
    .from("calls")
    .select("id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) {
    console.error("⚠️ Inbound call row missing right after upsert:", payload.call_control_id)
    return
  }

  const agents = await getOnlineReachableAgents(supabase)

  if (agents.length === 0) {
    // Nobody to ring → voicemail. Mark, then answer A; greeting plays on A's answered.
    await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)
    try {
      await answerCaller(payload.call_control_id)
    } catch (err) {
      console.error("⚠️ Failed to answer caller for voicemail (no agents):", err)
    }
    return
  }

  // Dial all agents in parallel; record the legs that actually got dialed.
  const results = await Promise.allSettled(
    agents.map((a) =>
      dialAgentLeg({
        aLegId: payload.call_control_id,
        callId: call.id,
        didNumber: payload.to,
        callerNumber: payload.from,
        sipUsername: a.sipUsername,
        userId: a.userId,
      }).then((agentLegId) => ({ agentLegId, userId: a.userId }))
    )
  )

  const dialed = results
    .filter((r): r is PromiseFulfilledResult<{ agentLegId: string; userId: string }> =>
      r.status === "fulfilled"
    )
    .map((r) => r.value)

  if (dialed.length === 0) {
    // Every dial failed → voicemail.
    await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)
    try {
      await answerCaller(payload.call_control_id)
    } catch (err) {
      console.error("⚠️ Failed to answer caller for voicemail (all dials failed):", err)
    }
    return
  }

  await recordAgentLegs(supabase, call.id, dialed)
}

async function handleCallAnswered(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const agentState = decodeClientState(payload.client_state)

  // An agent (leg B) picked up → try to claim the caller. First-answer-wins.
  if (agentState?.role === "agent") {
    const won = await claimCall(supabase, agentState.aLegId)
    if (!won) {
      // Someone else already won → drop this losing leg.
      try {
        await hangupLeg(payload.call_control_id)
      } catch (err) {
        console.error("⚠️ Failed to hang up losing agent leg:", err)
      }
      return
    }

    // Winner: record it, cancel siblings, then answer A. The bridge is issued
    // when A's own call.answered arrives (below).
    await markLegAnswered(supabase, payload.call_control_id)
    const ringing = await getRingingAgentLegIds(supabase, agentState.callId)
    await Promise.allSettled(
      ringing
        .filter((legId) => legId !== payload.call_control_id)
        .map((legId) => hangupLeg(legId))
    )
    try {
      await answerCaller(agentState.aLegId)
    } catch (err) {
      console.error("⚠️ Failed to answer caller after agent won:", err)
    }
    return
  }

  // Caller leg (A) was answered by us. What happens next depends on status.
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, phone_numbers(voicemail_greeting)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) return

  if (call.status === "answered") {
    // A winner is waiting → bridge A to the answered agent leg.
    const agentLeg = await getAnsweredAgentLegId(supabase, call.id)
    if (agentLeg) {
      try {
        await bridgeLegs(payload.call_control_id, agentLeg)
        await supabase
          .from("calls")
          .update({ started_at: new Date().toISOString() })
          .eq("id", call.id)
        return
      } catch (err) {
        console.error("⚠️ Bridge failed; falling back to voicemail:", err)
      }
    }
    // Winner vanished or bridge failed → voicemail on the (already answered) A.
    await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)
    await speakGreeting(supabase, payload.call_control_id, call)
    return
  }

  if (call.status === "voicemail") {
    await speakGreeting(supabase, payload.call_control_id, call)
  }
}

/** Resolve the per-number greeting and speak it on the answered caller leg. */
async function speakGreeting(
  _supabase: SupabaseClient,
  aLegId: string,
  call: { phone_numbers?: unknown }
) {
  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  const greeting =
    (pn as { voicemail_greeting: string | null } | null)?.voicemail_greeting ?? DEFAULT_GREETING
  try {
    await startVoicemail(aLegId, greeting)
  } catch (err) {
    console.error("⚠️ Failed to start voicemail greeting:", err)
  }
}

async function handleCallHangup(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const agentState = decodeClientState(payload.client_state)

  // Agent leg (B) ended. Mark it failed (if it was still ringing); if no legs
  // are ringing and nobody won, the caller falls to voicemail.
  if (agentState?.role === "agent") {
    await markLegFailedIfRinging(supabase, payload.call_control_id)

    const stillRinging = await getRingingAgentLegIds(supabase, agentState.callId)
    if (stillRinging.length > 0) return

    const { data: callerCall } = await supabase
      .from("calls")
      .select("id, status")
      .eq("telnyx_call_id", agentState.aLegId)
      .maybeSingle()
    if (callerCall?.status === "ringing") {
      await supabase.from("calls").update({ status: "voicemail" }).eq("id", callerCall.id)
      try {
        await answerCaller(agentState.aLegId)
      } catch (err) {
        console.error("⚠️ Failed to answer caller for voicemail (all agents failed):", err)
      }
    }
    return
  }

  // Caller leg (A) ended.
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, started_at, direction, phone_number_id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  // Caller hung up while still ringing → cancel any agent legs still ringing.
  if (call?.status === "ringing" && call?.id) {
    const ringing = await getRingingAgentLegIds(supabase, call.id)
    await Promise.allSettled(ringing.map((legId) => hangupLeg(legId)))
  }

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
