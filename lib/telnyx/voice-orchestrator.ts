import crypto from "crypto"
import { getTelnyxClient, withRetry } from "./client"
import { encodeClientState } from "./client-state"

export const DEFAULT_GREETING =
  "Hi, you've reached our team. We're currently unavailable. Please leave a message after the tone."

function commandId(): string {
  return crypto.randomUUID()
}

/** Answer the inbound caller leg (leg A). The body arg is required by the SDK. */
export async function answerCaller(callControlId: string): Promise<void> {
  const telnyx = getTelnyxClient()
  await withRetry(() => telnyx.calls.actions.answer(callControlId, { command_id: commandId() }))
}

/** Dial the WebRTC SIP credential as leg B, tagged so we can correlate it back.
 *  NOTE (proven in the Task 0 spike): `from` MUST be an owned DID (the number the
 *  customer dialed = payload.to), NOT the caller's raw number — Telnyx rejects an
 *  un-owned `from`. The caller's number is passed as `from_display_name` so the
 *  agent still sees who's calling. */
export async function dialAgent(params: {
  aLegId: string
  callId: string
  didNumber: string // owned DID the customer dialed (payload.to)
  callerNumber: string // customer's number, shown as caller ID
}): Promise<void> {
  const telnyx = getTelnyxClient()
  const sipUser = process.env.TELNYX_SIP_USERNAME
  const appId = process.env.TELNYX_VOICE_APP_ID
  if (!sipUser || !appId) throw new Error("TELNYX_SIP_USERNAME or TELNYX_VOICE_APP_ID not set")

  await withRetry(() =>
    telnyx.calls.dial({
      connection_id: appId,
      to: `sip:${sipUser}@sip.telnyx.com`,
      from: params.didNumber, // owned DID — required, un-owned `from` is rejected
      from_display_name: params.callerNumber, // agent still sees the customer's number
      timeout_secs: 25,
      command_id: commandId(),
      client_state: encodeClientState({
        role: "agent",
        aLegId: params.aLegId,
        callId: params.callId,
      }),
    })
  )
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
