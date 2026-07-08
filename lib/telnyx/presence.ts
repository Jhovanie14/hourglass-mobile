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

/**
 * User ids with at least one push-registered device marked available.
 *
 * Mobile agents can't prove liveness with heartbeats — Android suspends JS
 * timers as soon as the app leaves the foreground (that's why call delivery
 * there is FCM-push-based). So mobile availability is a DECLARED state: the
 * app's Online toggle flips `agent_devices.is_available`, and logout deletes
 * the row. Ring-all dials these agents regardless of presence freshness; the
 * push wakes the phone.
 */
export async function getAvailableDeviceUserIds(
  admin: Admin
): Promise<string[]> {
  const { data, error } = await admin
    .from("agent_devices")
    .select("user_id")
    .eq("is_available", true)
  if (error) throw error
  return [...new Set((data ?? []).map((r: { user_id: string }) => r.user_id))]
}

/**
 * Immediately drop an agent from the online set (manual "go offline").
 *
 * Deletes the agent's single `agent_presence` row so ring-all stops dialing them
 * right away, instead of waiting out the ~30s staleness window.
 */
export async function expirePresence(
  admin: Admin,
  userId: string
): Promise<void> {
  const { error } = await admin
    .from("agent_presence")
    .delete()
    .eq("user_id", userId)
  if (error) throw error
}
