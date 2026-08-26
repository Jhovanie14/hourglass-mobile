import { createAdminClient } from "@/lib/admin"
import { enqueueJadesDelivery } from "@/lib/jades/notify"
import type { Notification } from "@/types/notifications"
import { verifyTelnyxWebhook } from "@/lib/telnyx/webhook"
import { decodeClientState } from "@/lib/telnyx/client-state"
import {
  answerCaller,
  dialAgentLeg,
  hangupLeg,
  bridgeLegs,
  startVoicemail,
  startCallTranscription,
  startAIAssistantOnCall,
  startAICallRecording,
  DEFAULT_GREETING,
} from "@/lib/telnyx/voice-orchestrator"
import {
  aiAgentSettings,
  isAIAgentLabel,
  brandNameForLabel,
  conversationMessagesToSegments,
  type ConversationMessage,
} from "@/lib/telnyx/ai-agent"
import { brandVariables } from "@/lib/telnyx/ai-brand-variables"
import {
  slackWebhookForLabel,
  buildAIRecordingMessage,
  buildAISummaryMessage,
  postToSlack,
} from "@/lib/slack"
import {
  isTranscriptionEnabled,
  segmentFromEvent,
  type TranscriptionData,
} from "@/lib/telnyx/transcription"
import {
  getOnlineReachableAgents,
  recordAgentLegs,
  claimCall,
  markLegAnswered,
  markLegFailedIfRinging,
  getRingingAgentLegIds,
  getAnsweredAgentLegId,
} from "@/lib/telnyx/ring-all"
import {
  finalizeCall,
  markOutboundAnswered,
  answeredAction,
} from "@/lib/telnyx/call-logging"

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
  // call.transcription fields
  transcription_data?: TranscriptionData
  // call.conversation.ended / call.conversation_insights.generated fields
  conversation_id?: string
  duration_sec?: number
  reason?: string | null
  results?: Array<{ insight_id?: string; result?: unknown }>
}

type TelnyxVoiceWebhookBody = {
  data: {
    event_type: string
    occurred_at?: string
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
    case "call.transcription":
      await handleTranscription(supabase, payload, body.data.occurred_at)
      break
    case "call.conversation.ended":
      await handleConversationEnded(supabase, payload, body.data.occurred_at)
      break
    case "call.conversation_insights.generated":
      await handleConversationInsights(supabase, payload)
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
    .select("id, label")
    .eq("phone_number", payload.to)
    .eq("is_active", true)
    .maybeSingle()

  if (!phoneNumber) {
    console.warn("⚠️ No active phone number matches:", payload.to)
    return
  }

  // AI voice agent (TLP): flagged brands still ring their own agents first. The
  // assistant only picks up where the caller would otherwise have hit voicemail
  // — nobody available (below), every dial failed (below), or nobody answered in
  // time (handleCallHangup). Fully dormant unless configured.
  const aiSettings = aiAgentSettings(process.env as Record<string, string | undefined>)
  const aiBrand = isAIAgentLabel(aiSettings, phoneNumber.label)

  const { error: upsertError } = await supabase.from("calls").upsert(
    {
      phone_number_id: phoneNumber.id,
      contact_number: payload.from,
      direction: "inbound",
      status: "ringing",
      telnyx_call_id: payload.call_control_id,
    },
    { onConflict: "telnyx_call_id", ignoreDuplicates: true }
  )
  if (upsertError) {
    // A swallowed error here meant the caller row was never written and the call
    // silently died (ring → hangup, nothing logged). Surface it loudly instead.
    console.error("⚠️ Failed to upsert inbound call row:", upsertError)
    return
  }

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
    await answerWithAIOrVoicemail(supabase, {
      callId: call.id,
      aLegId: payload.call_control_id,
      aiBrand,
      context: "no agents",
    })
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
        ...(aiBrand && aiSettings ? { timeoutSecs: aiSettings.ringTimeoutSecs } : {}),
      }).then((agentLegId) => ({ agentLegId, userId: a.userId }))
    )
  )

  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`⚠️ dialAgentLeg failed for agent ${agents[i].userId}:`, r.reason)
    }
  })

  const dialed = results
    .filter((r): r is PromiseFulfilledResult<{ agentLegId: string; userId: string }> =>
      r.status === "fulfilled"
    )
    .map((r) => r.value)

  if (dialed.length === 0) {
    await answerWithAIOrVoicemail(supabase, {
      callId: call.id,
      aLegId: payload.call_control_id,
      aiBrand,
      context: "all dials failed",
    })
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

  // A non-agent leg was answered. call.answered payloads carry NO `direction`,
  // so we read it (and the status) from the stored call row to decide what to do.
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, direction, ai_handled, phone_numbers(voicemail_greeting, label)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) return

  const action = answeredAction({
    direction: call.direction,
    status: call.status,
    aiHandled: call.ai_handled === true,
  })

  // Outbound (softphone-originated) call connected → mark answered so hangup
  // finalizes it as `completed` (not `failed`).
  if (action === "mark_outbound_answered") {
    await markOutboundAnswered(supabase, payload.call_control_id)
    if (isTranscriptionEnabled(process.env as Record<string, string | undefined>)) {
      try {
        await startCallTranscription(payload.call_control_id)
      } catch (err) {
        console.error("⚠️ Failed to start transcription (outbound):", err)
      }
    }
    return
  }

  if (action === "start_ai") {
    const aiSettings = aiAgentSettings(process.env as Record<string, string | undefined>)
    const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
    const brandLabel = (pn as { label?: string } | null)?.label ?? "Unknown"

    if (aiSettings) {
      try {
        // Brand content is resolved here, not in the /ai/variables webhook,
        // because `brandLabel` above came off the phone_numbers row that took
        // the call — this is the only point where the brand is certain. A
        // label with no registered content yields null, and we send no content
        // variables at all rather than another brand's prices.
        const vars = brandVariables(brandLabel, new Date())
        if (!vars) {
          console.warn(
            `⚠️ No brand content registered for label "${brandLabel}"; assistant starts without pricing`
          )
        }
        await startAIAssistantOnCall({
          callControlId: payload.call_control_id,
          assistantId: aiSettings.assistantId,
          brandLabel,
          // Registry name first — it is the only source with the right
          // casing. brandNameForLabel stays as the fallback for a label with
          // no registered content.
          brandName:
            vars?.brand_name ??
            brandNameForLabel(brandLabel, process.env as Record<string, string | undefined>),
          variables: vars
            ? {
                pricing: vars.pricing,
                brand_rules: vars.brand_rules,
                hours: vars.hours,
                open_now: vars.open_now,
              }
            : undefined,
        })
        await supabase
          .from("calls")
          .update({ status: "answered", started_at: new Date().toISOString() })
          .eq("id", call.id)
        try {
          await startAICallRecording(payload.call_control_id)
        } catch (err) {
          console.error("⚠️ Failed to start AI call recording (call continues):", err)
        }
        return
      } catch (err) {
        console.error("⚠️ Failed to start AI assistant; falling back to voicemail:", err)
      }
    } else {
      console.error("⚠️ AI call answered but assistant config is gone; voicemail fallback")
    }

    // Fallback: clear the AI flag so recording.saved treats this as a normal
    // voicemail, then run the standard greeting flow on the answered leg.
    await supabase
      .from("calls")
      .update({ status: "voicemail", ai_handled: false })
      .eq("id", call.id)
    await speakGreeting(payload.call_control_id, call)
    return
  }

  if (action === "bridge") {
    // A winner is waiting → bridge A to the answered agent leg.
    const agentLeg = await getAnsweredAgentLegId(supabase, call.id)
    if (agentLeg) {
      try {
        await bridgeLegs(payload.call_control_id, agentLeg)
        await supabase
          .from("calls")
          .update({ started_at: new Date().toISOString() })
          .eq("id", call.id)
        if (isTranscriptionEnabled(process.env as Record<string, string | undefined>)) {
          try {
            await startCallTranscription(payload.call_control_id)
          } catch (err) {
            console.error("⚠️ Failed to start transcription (inbound):", err)
          }
        }
        return
      } catch (err) {
        console.error("⚠️ Bridge failed; falling back to voicemail:", err)
      }
    }
    // Winner vanished or bridge failed → voicemail on the (already answered) A.
    await supabase.from("calls").update({ status: "voicemail" }).eq("id", call.id)
    await speakGreeting(payload.call_control_id, call)
    return
  }

  if (action === "voicemail") {
    await speakGreeting(payload.call_control_id, call)
  }
}

/** Resolve the per-number greeting and speak it on the answered caller leg. */
async function speakGreeting(aLegId: string, call: { phone_numbers?: unknown }) {
  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  const greeting =
    (pn as { voicemail_greeting: string | null } | null)?.voicemail_greeting ?? DEFAULT_GREETING
  try {
    await startVoicemail(aLegId, greeting)
  } catch (err) {
    console.error("⚠️ Failed to start voicemail greeting:", err)
  }
}

/**
 * Every path where no agent is going to take the call converges here: on an AI
 * brand the assistant picks up, everywhere else the caller gets voicemail.
 *
 * The AI hand-off deliberately leaves `status` as "ringing" — `answeredAction`
 * only returns "start_ai" for a ringing ai_handled row — and answering A is what
 * fires the `call.answered` event that actually starts the assistant.
 */
async function answerWithAIOrVoicemail(
  supabase: SupabaseClient,
  opts: { callId: string; aLegId: string; aiBrand: boolean; context: string }
) {
  let handedToAI = false
  if (opts.aiBrand) {
    const { error } = await supabase
      .from("calls")
      .update({ ai_handled: true })
      .eq("id", opts.callId)
    if (error) {
      // An un-flagged row would answer A into dead air (answeredAction → "noop"),
      // so a failed flag write has to fall through to voicemail, not proceed.
      console.error(`⚠️ Failed to flag call for the AI agent (${opts.context}):`, error)
    } else {
      handedToAI = true
    }
  }
  if (!handedToAI) {
    await supabase.from("calls").update({ status: "voicemail" }).eq("id", opts.callId)
  }
  try {
    await answerCaller(opts.aLegId)
  } catch (err) {
    // The leg is gone (usually the caller hung up mid-ring). Nothing will start
    // the assistant now, so drop the flag rather than leave an abandoned call
    // labelled AI-handled in the dashboard.
    console.error(`⚠️ Failed to answer caller (${opts.context}):`, err)
    if (handedToAI) {
      await supabase.from("calls").update({ ai_handled: false }).eq("id", opts.callId)
    }
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
      .select("id, status, phone_numbers(label)")
      .eq("telnyx_call_id", agentState.aLegId)
      .maybeSingle()
    if (callerCall?.status === "ringing") {
      // Agents were online but nobody answered inside the ring window. On an AI
      // brand the assistant catches it; the caller has already waited, so
      // voicemail here is the worse of the two outcomes.
      const pn = Array.isArray(callerCall.phone_numbers)
        ? callerCall.phone_numbers[0]
        : callerCall.phone_numbers
      const aiSettings = aiAgentSettings(process.env as Record<string, string | undefined>)
      await answerWithAIOrVoicemail(supabase, {
        callId: callerCall.id,
        aLegId: agentState.aLegId,
        aiBrand: isAIAgentLabel(aiSettings, (pn as { label?: string } | null)?.label),
        context: "no agent answered",
      })
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

  const endedAt = payload.end_time ?? new Date().toISOString()

  const finalStatus = await finalizeCall(supabase, {
    telnyxCallId: payload.call_control_id,
    prevStatus: call?.status,
    direction: call?.direction,
    startedAt: call?.started_at,
    endedAt,
  })

  console.log(`📴 Call ${payload.call_control_id} → ${finalStatus}`)

  if (finalStatus === "missed" && call?.id && call?.phone_number_id) {
    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("label, color")
      .eq("id", call.phone_number_id)
      .maybeSingle()

    const { data: missedNotif, error } = await supabase
      .from("notifications")
      .insert({
        type: "missed_call",
        reference_id: call.id,
        metadata: {
          contact_number: payload.from,
          phone_label: phoneNumber?.label ?? "Unknown",
          phone_color: phoneNumber?.color ?? "#6b7280",
        },
      })
      .select("id, type, reference_id, metadata, is_read, created_at")
      .single()

    if (error) {
      console.error("⚠️ Failed to insert missed_call notification:", error)
    } else if (missedNotif) {
      enqueueJadesDelivery(supabase, missedNotif as Notification)
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
    .select(
      "id, contact_number, phone_number_id, has_voicemail, ai_handled, ai_recording_path, phone_numbers(label)"
    )
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  if (!call) {
    console.warn("⚠️ No call found for recording:", payload.call_control_id)
    return
  }

  // AI-handled calls store their recording separately — never as a voicemail.
  if (call.ai_handled) {
    await handleAIRecordingSaved(supabase, call, recordingUrl, durationMs)
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

  const { data: vmNotif, error: notifError } = await supabase
    .from("notifications")
    .insert({
      type: "voicemail",
      reference_id: call.id,
      metadata: {
        contact_number: call.contact_number,
        phone_label: (pn as { label: string } | null)?.label ?? "Unknown",
        duration_seconds: Math.round(durationMs / 1000),
      },
    })
    .select("id, type, reference_id, metadata, is_read, created_at")
    .single()

  if (notifError) {
    console.error("⚠️ Failed to insert voicemail notification:", notifError)
  } else if (vmNotif) {
    enqueueJadesDelivery(supabase, vmNotif as Notification)
  }

  console.log(
    `📬 Voicemail saved for call ${call.id}, duration: ${Math.round(durationMs / 1000)}s`
  )
}

const AI_RECORDING_LINK_DAYS = 7

/** Recording of an AI-handled call: copy to the private call-recordings
 *  bucket, remember the path, and post a Slack message with a signed link. */
async function handleAIRecordingSaved(
  supabase: SupabaseClient,
  call: {
    id: string
    contact_number: string
    ai_recording_path?: string | null
    phone_numbers?: unknown
  },
  recordingUrl: string,
  durationMs: number
) {
  if (call.ai_recording_path) return // idempotency: Telnyx webhook retry

  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  const brandLabel = (pn as { label: string } | null)?.label ?? "Unknown"

  // Copy into the private bucket; fall back to the (time-limited) Telnyx URL
  // so the audio link is never lost. Same pattern as voicemails.
  let audioUrl = recordingUrl
  try {
    const res = await fetch(recordingUrl)
    if (!res.ok) throw new Error(`download failed: ${res.status}`)
    const bytes = new Uint8Array(await res.arrayBuffer())
    const path = `${call.id}.mp3`
    const { error: upErr } = await supabase.storage
      .from("call-recordings")
      .upload(path, bytes, { contentType: "audio/mpeg", upsert: true })
    if (upErr) throw upErr

    const { error: updErr } = await supabase
      .from("calls")
      .update({ ai_recording_path: path })
      .eq("id", call.id)
    if (updErr) console.error("⚠️ Failed to store ai_recording_path:", updErr)

    const { data: signed, error: signErr } = await supabase.storage
      .from("call-recordings")
      .createSignedUrl(path, 60 * 60 * 24 * AI_RECORDING_LINK_DAYS)
    if (signErr || !signed?.signedUrl) {
      console.error("⚠️ Failed to sign AI recording URL; using Telnyx URL:", signErr)
    } else {
      audioUrl = signed.signedUrl
    }
  } catch (err) {
    console.error("⚠️ Failed to copy AI recording to bucket; keeping Telnyx URL:", err)
  }

  const env = process.env as Record<string, string | undefined>
  const webhook = slackWebhookForLabel(brandLabel, env)
  if (!webhook) return
  try {
    await postToSlack(
      webhook,
      buildAIRecordingMessage({
        brandLabel: brandNameForLabel(brandLabel, env),
        caller: call.contact_number,
        url: audioUrl,
        expiresInDays: AI_RECORDING_LINK_DAYS,
      })
    )
    console.log(
      `🎙 AI recording posted to Slack for call ${call.id} (${Math.round(durationMs / 1000)}s)`
    )
  } catch (err) {
    console.error("⚠️ Failed to post AI recording to Slack:", err)
  }
}

/** The AI conversation finished: fetch its message history (the transcript),
 *  store it as dashboard transcript segments, and post it to Slack. The
 *  broken real-time call.transcription pipeline is deliberately not involved
 *  — see docs/superpowers/specs/2026-08-13-tlp-ai-voice-slack-design.md. */
async function handleConversationEnded(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload,
  occurredAt: string | undefined
) {
  const { data: call } = await supabase
    .from("calls")
    .select("id, ai_handled, ai_conversation_id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call?.ai_handled) return // not an AI-handled call — nothing to do
  if (call.ai_conversation_id) return // idempotency: Telnyx webhook retry

  const conversationId = payload.conversation_id
  if (!conversationId) {
    console.warn("⚠️ call.conversation.ended without conversation_id:", payload.call_control_id)
    return
  }

  const messages: ConversationMessage[] = []
  try {
    const { getTelnyxClient } = await import("@/lib/telnyx/client")
    for await (const message of getTelnyxClient().ai.conversations.messages.list(
      conversationId
    )) {
      messages.push(message as ConversationMessage)
    }
  } catch (err) {
    console.error(
      `⚠️ Failed to fetch AI conversation ${conversationId} (transcript lost unless replayed manually):`,
      err
    )
  }

  const segments = conversationMessagesToSegments(messages, occurredAt ?? new Date().toISOString())

  if (segments.length > 0) {
    const { error } = await supabase
      .from("call_transcript_segments")
      .insert(segments.map((segment) => ({ call_id: call.id, ...segment })))
    if (error) console.error("⚠️ Failed to insert AI transcript segments:", error)
  }

  // Mark processed even when empty so a webhook retry can't double-post Slack.
  const { error: markError } = await supabase
    .from("calls")
    .update({
      ai_conversation_id: conversationId,
      ...(segments.length > 0 && { has_transcript: true }),
    })
    .eq("id", call.id)
  if (markError) console.error("⚠️ Failed to mark AI conversation processed:", markError)

  // Deliberately no Slack post here. The team asked for summaries, not
  // transcripts, so the transcript stops at the dashboard and Slack is served
  // by handleConversationInsights below.
  console.log(`💬 AI transcript stored for call ${call.id} (${segments.length} segments)`)
}

/** Post-call insights → the one Slack message per AI call. Fires only when an
 *  insight group is attached to the assistant; if Telnyx never generates one
 *  the call is still complete in the dashboard, and the warning below says so. */
async function handleConversationInsights(supabase: SupabaseClient, payload: TelnyxCallPayload) {
  const results = payload.results
  if (!results || results.length === 0) return

  const { data: call } = await supabase
    .from("calls")
    .select("id, contact_number, ai_handled, duration_seconds, phone_numbers(label)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call?.ai_handled) return

  const pn = Array.isArray(call.phone_numbers) ? call.phone_numbers[0] : call.phone_numbers
  const brandLabel = (pn as { label: string } | null)?.label ?? "Unknown"

  const env = process.env as Record<string, string | undefined>
  const webhook = slackWebhookForLabel(brandLabel, env)
  if (!webhook) {
    console.warn("⚠️ AI summary ready but no Slack webhook is configured")
    return
  }
  const base = env.APP_BASE_URL?.replace(/\/+$/, "")
  try {
    await postToSlack(
      webhook,
      buildAISummaryMessage({
        brandLabel: brandNameForLabel(brandLabel, env),
        caller: call.contact_number,
        // handleCallHangup writes duration_seconds; payload.duration_sec covers
        // the window where the insight beats that write.
        durationSec: call.duration_seconds ?? payload.duration_sec ?? null,
        results,
        dashboardUrl: base ? `${base}/dashboard/calls` : null,
      })
    )
    console.log(`📋 AI summary posted to Slack for call ${call.id}`)
  } catch (err) {
    console.error("⚠️ Failed to post AI summary to Slack:", err)
  }
}

async function handleTranscription(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload,
  occurredAt: string | undefined
) {
  const { data: call } = await supabase
    .from("calls")
    .select("id, direction, has_transcript")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()
  if (!call) {
    console.warn("⚠️ No call found for transcription event:", payload.call_control_id)
    return
  }

  const segment = segmentFromEvent(call.direction, payload.transcription_data, occurredAt)
  if (!segment) return

  const { error } = await supabase.from("call_transcript_segments").insert({
    call_id: call.id,
    ...segment,
  })
  if (error) {
    console.error("⚠️ Failed to insert transcript segment:", error)
    return
  }

  if (!call.has_transcript) {
    const { error: flagError } = await supabase
      .from("calls")
      .update({ has_transcript: true })
      .eq("id", call.id)
    if (flagError) {
      console.error("⚠️ Failed to set has_transcript flag:", flagError)
    }
  }
}
