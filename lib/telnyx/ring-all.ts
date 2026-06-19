import type { createAdminClient } from "@/lib/admin"
import { getOnlineAgentUserIds } from "./presence"

type Admin = ReturnType<typeof createAdminClient>

export type ReachableAgent = { userId: string; sipUsername: string }

/**
 * Agents who are both online (fresh presence) AND reachable (have a SIP
 * credential). Only these can be dialed. Reuses the Phase 2 presence window.
 */
export async function getOnlineReachableAgents(
  admin: Admin,
  now: Date = new Date()
): Promise<ReachableAgent[]> {
  const onlineIds = await getOnlineAgentUserIds(admin, now)
  if (onlineIds.length === 0) return []

  const { data, error } = await admin
    .from("agent_sip_credentials")
    .select("user_id, sip_username")
    .in("user_id", onlineIds)
  if (error) throw error

  return (data ?? []).map((r: { user_id: string; sip_username: string }) => ({
    userId: r.user_id,
    sipUsername: r.sip_username,
  }))
}

/** Insert one ringing call_agent_legs row per dialed leg. No-op if empty. */
export async function recordAgentLegs(
  admin: Admin,
  callId: string,
  legs: { agentLegId: string; userId: string }[]
): Promise<void> {
  if (legs.length === 0) return
  const { error } = await admin.from("call_agent_legs").insert(
    legs.map((l) => ({
      call_id: callId,
      agent_leg_id: l.agentLegId,
      user_id: l.userId,
      status: "ringing",
    }))
  )
  if (error) throw error
}

/**
 * First-answer-wins lock. Atomically flip the caller call from `ringing` to
 * `answered`. Returns true iff THIS call won (a row was updated). Concurrent
 * agents racing here: Postgres serializes the row update, so exactly one sees
 * status='ringing' and wins; the rest get zero rows.
 */
export async function claimCall(
  admin: Admin,
  aLegId: string,
  now: Date = new Date()
): Promise<boolean> {
  const { data, error } = await admin
    .from("calls")
    .update({ status: "answered", started_at: now.toISOString() })
    .eq("telnyx_call_id", aLegId)
    .eq("status", "ringing")
    .select("id")
  if (error) throw error
  return (data ?? []).length > 0
}

export async function markLegAnswered(admin: Admin, agentLegId: string): Promise<void> {
  const { error } = await admin
    .from("call_agent_legs")
    .update({ status: "answered" })
    .eq("agent_leg_id", agentLegId)
  if (error) throw error
}

/** Mark a still-ringing leg failed. An already-answered leg is left alone. */
export async function markLegFailedIfRinging(admin: Admin, agentLegId: string): Promise<void> {
  const { error } = await admin
    .from("call_agent_legs")
    .update({ status: "failed" })
    .eq("agent_leg_id", agentLegId)
    .eq("status", "ringing")
  if (error) throw error
}

/** Leg ids still ringing for a call (used to cancel siblings / detect all-failed). */
export async function getRingingAgentLegIds(admin: Admin, callId: string): Promise<string[]> {
  const { data, error } = await admin
    .from("call_agent_legs")
    .select("agent_leg_id")
    .eq("call_id", callId)
    .eq("status", "ringing")
  if (error) throw error
  return (data ?? []).map((r: { agent_leg_id: string }) => r.agent_leg_id)
}

/** The winning (answered) leg id for a call, or null. */
export async function getAnsweredAgentLegId(admin: Admin, callId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("call_agent_legs")
    .select("agent_leg_id")
    .eq("call_id", callId)
    .eq("status", "answered")
  if (error) throw error
  return (data ?? [])[0]?.agent_leg_id ?? null
}
