/**
 * Pure decision logic for call dispositions — the agent's post-call
 * "how did it go?" record. Import-free (no supabase, no React) so it runs
 * under Vitest. Ported verbatim from the phone app (hourglass-app) so web and
 * phone can never drift.
 */
export type Outcome = "answered" | "no_answer" | "rejected" | "spam"
export type CallDirection = "inbound" | "outbound"
export type FollowUpPreset = "none" | "tomorrow" | "in_3_days" | "next_week"

export const OUTCOME_OPTIONS: { value: Outcome; label: string }[] = [
  { value: "answered", label: "Answered" },
  { value: "no_answer", label: "No answer" },
  { value: "rejected", label: "Rejected" },
  { value: "spam", label: "Spam" },
]

export const FOLLOW_UP_OPTIONS: { value: FollowUpPreset; label: string }[] = [
  { value: "none", label: "None" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "in_3_days", label: "In 3 days" },
  { value: "next_week", label: "Next week" },
]

export function outcomeLabel(outcome: Outcome): string {
  return OUTCOME_OPTIONS.find((o) => o.value === outcome)?.label ?? outcome
}

/**
 * Should the post-call sheet appear for this call?
 * - Outbound: always — the agent placed it, and "no answer" is worth logging.
 * - Inbound: only if THIS device answered.
 */
export function shouldPromptForDisposition(
  direction: CallDirection,
  wasAnswered: boolean
): boolean {
  return direction === "outbound" || wasAnswered
}

const PRESET_DAYS: Record<Exclude<FollowUpPreset, "none">, number> = {
  tomorrow: 1,
  in_3_days: 3,
  next_week: 7,
}

/**
 * Resolve a follow-up preset to a concrete time: N days out at 09:00 local
 * (start of the working day), or null for "none".
 */
export function followUpDate(preset: FollowUpPreset, now: Date): Date | null {
  if (preset === "none") return null
  const d = new Date(now)
  d.setDate(d.getDate() + PRESET_DAYS[preset])
  d.setHours(9, 0, 0, 0)
  return d
}
