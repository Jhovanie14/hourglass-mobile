import type { createAdminClient } from "@/lib/admin"

type Admin = ReturnType<typeof createAdminClient>

/**
 * Decide the terminal status of a call from its last-known status + direction.
 *
 * - answered/completed → completed
 * - voicemail          → voicemail (left for the recording flow)
 * - otherwise inbound  → missed   (nobody answered an incoming call)
 * - otherwise outbound → failed   (an outgoing call that never connected)
 */
export function computeFinalStatus(
  prevStatus: string | undefined,
  direction: string | undefined
): string {
  if (prevStatus === "answered" || prevStatus === "completed") return "completed"
  if (prevStatus === "voicemail") return "voicemail"
  if (direction === "inbound") return "missed"
  return "failed"
}

/**
 * Mark an outbound (softphone-originated) call as answered.
 *
 * The voice webhook records outbound calls as `initiated`; without this the call
 * never transitions to `answered`, so on hangup it is wrongly finalized as
 * `failed`. Call this from the outbound `call.answered` event.
 */
export async function markOutboundAnswered(
  admin: Admin,
  telnyxCallId: string,
  now: Date = new Date()
): Promise<void> {
  const { error } = await admin
    .from("calls")
    .update({ status: "answered", started_at: now.toISOString() })
    .eq("telnyx_call_id", telnyxCallId)
  if (error) throw error
}

/**
 * Finalize a call on hangup: compute its terminal status, attach duration when
 * it was answered, and persist. Returns the status written.
 */
export async function finalizeCall(
  admin: Admin,
  args: {
    telnyxCallId: string
    prevStatus: string | undefined
    direction: string | undefined
    startedAt: string | null | undefined
    endedAt: string
  }
): Promise<string> {
  const status = computeFinalStatus(args.prevStatus, args.direction)

  let durationSeconds: number | null = null
  if (status === "completed" && args.startedAt) {
    durationSeconds = Math.round(
      (new Date(args.endedAt).getTime() - new Date(args.startedAt).getTime()) /
        1000
    )
  }

  const { error } = await admin
    .from("calls")
    .update({
      status,
      ended_at: args.endedAt,
      ...(durationSeconds !== null && { duration_seconds: durationSeconds }),
    })
    .eq("telnyx_call_id", args.telnyxCallId)
  if (error) throw error

  return status
}
