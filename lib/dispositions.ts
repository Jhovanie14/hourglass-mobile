import type { SupabaseClient } from "@supabase/supabase-js"
import type { CallDirection, Outcome } from "@/lib/disposition-logic"

export type Db = SupabaseClient<any, any, any>

/**
 * One agent-owned record of how a call went. Keyed by telnyx_call_id
 * (matches calls.telnyx_call_id) by value, not FK — a disposition can exist
 * before/without its calls row. RLS scopes rows to the agent.
 */
export type Disposition = {
  id: string
  telnyx_call_id: string
  outcome: Outcome
  notes: string | null
  follow_up_at: string | null // ISO, null = no follow-up
  contact_number: string | null
  direction: CallDirection | null
  created_at: string
  updated_at: string
}

/**
 * Save (insert or edit) the agent's disposition for a call. Upserts on
 * (telnyx_call_id, agent_id): re-saving edits the row. agent_id is NOT sent —
 * it defaults to auth.uid() server-side.
 */
export async function saveDisposition(
  db: Db,
  input: {
    telnyxCallId: string
    outcome: Outcome
    notes: string
    followUpAt: string | null
    contactNumber: string
    direction: CallDirection
  }
): Promise<Disposition> {
  const { data, error } = await db
    .from("call_dispositions")
    .upsert(
      {
        telnyx_call_id: input.telnyxCallId,
        outcome: input.outcome,
        notes: input.notes.trim() || null,
        follow_up_at: input.followUpAt,
        contact_number: input.contactNumber || null,
        direction: input.direction,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "telnyx_call_id,agent_id" }
    )
    .select()
    .single()

  if (error) throw new Error(`Failed to save call notes (${error.message})`)
  return data as Disposition
}

/**
 * Clear a follow-up reminder on the agent's own disposition row. RLS
 * guarantees ownership; the row keeps its outcome and notes.
 */
export async function clearFollowUp(db: Db, id: string): Promise<void> {
  const { error } = await db
    .from("call_dispositions")
    .update({ follow_up_at: null, updated_at: new Date().toISOString() })
    .eq("id", id)

  if (error) throw new Error(`Failed to clear follow-up (${error.message})`)
}

/**
 * The agent's dispositions for a set of calls, keyed by telnyx_call_id.
 * RLS scopes rows to this agent.
 */
export async function fetchDispositionsForCalls(
  db: Db,
  telnyxCallIds: string[]
): Promise<Record<string, Disposition>> {
  const ids = telnyxCallIds.filter(Boolean)
  if (ids.length === 0) return {}

  const { data, error } = await db
    .from("call_dispositions")
    .select("*")
    .in("telnyx_call_id", ids)

  if (error) throw new Error(`Failed to load call notes (${error.message})`)

  const map: Record<string, Disposition> = {}
  for (const d of (data ?? []) as Disposition[]) map[d.telnyx_call_id] = d
  return map
}
