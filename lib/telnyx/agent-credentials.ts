import type { createAdminClient } from "@/lib/admin"
import type Telnyx from "telnyx"

type Admin = ReturnType<typeof createAdminClient>

/**
 * Return the agent's SIP credential, creating it once if needed.
 *
 * Idempotent per user: the first call provisions a Telnyx telephony credential
 * under the given connection and stores it; later calls return the stored one.
 * This is deliberately keyed to user_id (not per session) to avoid leaking a
 * new credential on every page load.
 */
export async function getOrCreateAgentCredential(
  admin: Admin,
  telnyx: Telnyx,
  userId: string,
  connectionId: string
): Promise<{ login: string; password: string }> {
  const { data: existing, error: readErr } = await admin
    .from("agent_sip_credentials")
    .select("sip_username, sip_password")
    .eq("user_id", userId)
    .maybeSingle()
  if (readErr) throw readErr
  if (existing) {
    return { login: existing.sip_username, password: existing.sip_password }
  }

  const res = await telnyx.telephonyCredentials.create({
    connection_id: connectionId,
    name: `agent-${userId}`,
  })
  const cred = res.data
  const login = cred?.sip_username
  const password = cred?.sip_password
  if (!cred?.id || !login || !password) {
    throw new Error(
      "Telnyx telephony credential response missing id/sip_username/sip_password"
    )
  }

  const { error: writeErr } = await admin.from("agent_sip_credentials").insert({
    user_id: userId,
    telnyx_credential_id: cred.id,
    sip_username: login,
    sip_password: password,
  })
  if (writeErr) throw writeErr

  return { login, password }
}
