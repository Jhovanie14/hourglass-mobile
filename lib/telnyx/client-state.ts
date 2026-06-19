export type AgentLegState = {
  role: "agent"
  aLegId: string // caller leg call_control_id
  callId: string // calls.id in our DB
  userId: string // which agent this leg targets (agent_sip_credentials.user_id)
}

/** Telnyx requires client_state to be a base64 string; it echoes it on every
 *  webhook for that leg. We use it to correlate the dialed agent leg back to
 *  the caller leg without a DB lookup race. */
export function encodeClientState(state: AgentLegState): string {
  return Buffer.from(JSON.stringify(state)).toString("base64")
}

export function decodeClientState(value: string | null | undefined): AgentLegState | null {
  if (!value) return null
  try {
    const json = Buffer.from(value, "base64").toString("utf8")
    const parsed = JSON.parse(json)
    if (parsed && parsed.role === "agent" && typeof parsed.aLegId === "string") {
      return parsed as AgentLegState
    }
    return null
  } catch {
    return null
  }
}
