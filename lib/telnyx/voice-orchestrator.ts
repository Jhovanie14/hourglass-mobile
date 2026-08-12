import crypto from "crypto"
import { getTelnyxClient, withRetry } from "./client"
import { encodeClientState } from "./client-state"
import { transcriptionMode, transcriptionStartBody } from "./transcription"

export const DEFAULT_GREETING =
  "Hi, you've reached our team. We're currently unavailable. Please leave a message after the tone."

function commandId(): string {
  return crypto.randomUUID()
}

/** Telnyx restricts from_display_name to letters, numbers, spaces and -_~!.+ and
 *  128 chars. Callers can arrive as a SIP URI (e.g. "+123@sip.telnyx.com"), whose
 *  "@" is rejected with a 422. Drop the SIP host and strip disallowed chars. */
function sanitizeDisplayName(value: string): string {
  return value
    .split("@")[0]
    .replace(/[^a-zA-Z0-9 \-_~!.+]/g, "")
    .slice(0, 128)
}

/** Answer the inbound caller leg (leg A). The body arg is required by the SDK. */
export async function answerCaller(callControlId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() => telnyx.calls.actions.answer(callControlId, { command_id: commandId() }))
}

/** Dial ONE agent's own SIP credential as a tagged leg B. Returns the dialed
 *  leg's call_control_id so the caller can record it in call_agent_legs.
 *  `from` MUST be the owned DID the customer dialed (un-owned `from` is
 *  rejected); the caller's number is shown via from_display_name. */
export async function dialAgentLeg(params: {
  aLegId: string
  callId: string
  didNumber: string // owned DID the customer dialed (payload.to)
  callerNumber: string // customer's number, shown as caller ID
  sipUsername: string // THIS agent's sip_username (agent_sip_credentials)
  userId: string // THIS agent's user_id
}): Promise<string> {
  const telnyx = getTelnyxClient()
  const appId = process.env.TELNYX_VOICE_APP_ID
  if (!appId) throw new Error("TELNYX_VOICE_APP_ID not set")

  const displayName = sanitizeDisplayName(params.callerNumber)

  const res = await withRetry(() =>
    telnyx.calls.dial({
      connection_id: appId,
      to: `sip:${params.sipUsername}@sip.telnyx.com`,
      from: params.didNumber,
      ...(displayName ? { from_display_name: displayName } : {}),
      // `from` must be the owned DID, so the SIP invite's caller fields carry the
      // DID, not the customer. Telnyx does NOT surface from_display_name to the
      // WebRTC client either, so pass the customer's number as a custom SIP header
      // the softphone reads to show who's actually calling.
      custom_headers: [{ name: "X-Caller-Number", value: params.callerNumber }],
      timeout_secs: 25,
      command_id: commandId(),
      client_state: encodeClientState({
        role: "agent",
        aLegId: params.aLegId,
        callId: params.callId,
        userId: params.userId,
      }),
    })
  )

  const legId = (res as { data?: { call_control_id?: string } })?.data?.call_control_id
  if (!legId) throw new Error("Telnyx dial response missing call_control_id")
  return legId
}

/** Hang up a single leg (cancel a ringing sibling or a losing agent leg). */
export async function hangupLeg(callControlId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() => telnyx.calls.actions.hangup(callControlId, { command_id: commandId() }))
}

/** Bridge the answered agent leg (B) to the caller leg (A). */
export async function bridgeLegs(aLegId: string, bLegId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.bridge(aLegId, {
      call_control_id_to_bridge_with: bLegId,
      command_id: commandId(),
    })
  )
}

/** Speak the greeting on the caller leg to begin the voicemail flow. */
export async function startVoicemail(aLegId: string, greeting: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.speak(aLegId, {
      payload: greeting || DEFAULT_GREETING,
      voice: "female",
      language: "en-US",
      command_id: commandId(),
    })
  )
}

/** Start real-time transcription on a live call leg — both tracks, Telnyx
 *  engine (the client-approved $0.025/min option, and the only engine that
 *  labels which track spoke). Telnyx stops it automatically at hang-up.
 *  The body varies by CALL_TRANSCRIPTION_MODE — a temporary bisect flag; see
 *  transcriptionStartBody. Unset behaves exactly as before. */
export async function startCallTranscription(callControlId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  // Same cast idiom the voice webhook uses for isTranscriptionEnabled: ProcessEnv's
  // index signature does not structurally match a narrow named-key type.
  const mode = transcriptionMode(process.env as Record<string, string | undefined>)
  await withRetry(() =>
    telnyx.calls.actions.startTranscription(callControlId, {
      ...transcriptionStartBody(mode),
      command_id: commandId(),
    })
  )
  // Logged on SUCCESS too: the failure we are chasing is a command Telnyx
  // accepts and then never acts on, which leaves no trace otherwise.
  console.log(`🎧 Transcription start accepted (mode=${mode}) on ${callControlId}`)
}

/** Start the configured Telnyx AI Assistant speaking on an answered caller
 *  leg. The assistant's instructions/greeting reference {{brand_name}} (the
 *  spoken name, e.g. "The Launch Pad") — {{brand_label}} (the short code,
 *  e.g. "TLP") rides along for tooling — so one assistant serves all brands. */
export async function startAIAssistantOnCall(params: {
  callControlId: string
  assistantId: string
  brandLabel: string
  brandName: string
}): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.startAIAssistant(params.callControlId, {
      assistant: {
        id: params.assistantId,
        dynamic_variables: { brand_name: params.brandName, brand_label: params.brandLabel },
      },
      command_id: commandId(),
    })
  )
  console.log(`🤖 AI assistant ${params.assistantId} started on ${params.callControlId}`)
}

/** Record an AI-handled call: dual channel keeps caller and assistant on
 *  separate tracks; mp3 to match the voicemail flow; no beep. */
export async function startAICallRecording(callControlId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() =>
    telnyx.calls.actions.startRecording(callControlId, {
      format: "mp3",
      channels: "dual",
      command_id: commandId(),
    })
  )
}
