// Pure helpers for call transcription. No SDK, DB, or env access here so it
// unit-tests in plain node (mirrors the other lib/telnyx pure modules).

export type TranscriptSpeaker = "agent" | "contact"

/** Shape of transcription_data on a `call.transcription` webhook event. */
export type TranscriptionData = {
  transcript?: string
  confidence?: number
  is_final?: boolean
  transcription_track?: string
}

export type TranscriptSegmentInsert = {
  speaker: TranscriptSpeaker | null
  transcript: string
  confidence: number | null
  occurred_at: string
}

/** Kill switch: transcription is always on unless explicitly disabled. */
export function isTranscriptionEnabled(env: {
  CALL_TRANSCRIPTION_ENABLED?: string
}): boolean {
  return env.CALL_TRANSCRIPTION_ENABLED !== "false"
}

/**
 * Who spoke, from the call direction plus Telnyx's transcription_track.
 * Track semantics are per-leg: `inbound` = audio Telnyx receives from that
 * leg's party, `outbound` = audio sent to them. We always transcribe the leg
 * stored in calls.telnyx_call_id: the customer's A leg for inbound calls, the
 * softphone-originated leg for outbound — so the mapping flips with direction.
 */
export function speakerForTrack(
  direction: "inbound" | "outbound",
  track: string | undefined
): TranscriptSpeaker | null {
  if (track !== "inbound" && track !== "outbound") return null
  if (direction === "inbound") return track === "inbound" ? "contact" : "agent"
  return track === "inbound" ? "agent" : "contact"
}

/**
 * Normalize one webhook event into an insertable segment row, or null for
 * events we drop (interim results, empty transcripts, missing data). Missing
 * is_final counts as final: engines configured without interim results omit it.
 */
export function segmentFromEvent(
  direction: "inbound" | "outbound",
  data: TranscriptionData | undefined,
  occurredAt: string | undefined
): TranscriptSegmentInsert | null {
  if (!data) return null
  if (data.is_final === false) return null
  const transcript = (data.transcript ?? "").trim()
  if (!transcript) return null
  return {
    speaker: speakerForTrack(direction, data.transcription_track),
    transcript,
    confidence: typeof data.confidence === "number" ? data.confidence : null,
    occurred_at: occurredAt ?? new Date().toISOString(),
  }
}
