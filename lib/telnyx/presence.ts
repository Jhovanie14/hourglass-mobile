import type { createAdminClient } from "@/lib/admin"

type Admin = ReturnType<typeof createAdminClient>

/** Agents whose last heartbeat is within this many seconds count as "online". */
export const PRESENCE_WINDOW_SECONDS = 30

/**
 * Record that an agent is online right now.
 *
 * Upserts the agent's single `agent_presence` row (keyed on user_id) with the
 * current time. Called periodically by the WebRTC client while connected; no
 * explicit "offline" call is needed — staleness drops the agent from the online
 * set (see {@link getOnlineAgentUserIds}).
 */
export async function recordHeartbeat(
  admin: Admin,
  userId: string,
  now: Date = new Date()
): Promise<void> {
  const { error } = await admin
    .from("agent_presence")
    .upsert(
      { user_id: userId, last_seen_at: now.toISOString() },
      { onConflict: "user_id" }
    )
  if (error) throw error
}

/**
 * Return the user ids of agents seen within the freshness window.
 *
 * "Online" = `last_seen_at >= now - windowSeconds`. The cutoff is computed here
 * (not in SQL) so the window is explicit and unit-testable.
 */
export async function getOnlineAgentUserIds(
  admin: Admin,
  now: Date = new Date(),
  windowSeconds: number = PRESENCE_WINDOW_SECONDS
): Promise<string[]> {
  const cutoff = new Date(now.getTime() - windowSeconds * 1000).toISOString()
  const { data, error } = await admin
    .from("agent_presence")
    .select("user_id")
    .gte("last_seen_at", cutoff)
  if (error) throw error
  return (data ?? []).map((row: { user_id: string }) => row.user_id)
}
