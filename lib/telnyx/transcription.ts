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

/**
 * TEMPORARY (2026-07-30 diagnosis). Telnyx accepts our `transcription_start`
 * command (31 of 34 returned failed=false) but has never emitted a single
 * `call.transcription` event, so no segment ever reaches the ingest handler.
 * These modes let us bisect the start body against a live call without a code
 * change per attempt. Remove once the working configuration is known.
 */
export type TranscriptionMode = "default" | "telnyx-single" | "minimal"

const DIAGNOSTIC_MODES: TranscriptionMode[] = ["telnyx-single", "minimal"]

/** Unknown/misspelled values fall back to `default`, so a bad env value can
 *  never silently change production behaviour. */
export function transcriptionMode(env: {
  CALL_TRANSCRIPTION_MODE?: string
}): TranscriptionMode {
  const value = env.CALL_TRANSCRIPTION_MODE
  return DIAGNOSTIC_MODES.find((m) => m === value) ?? "default"
}

export type TranscriptionStartBody = {
  transcription_engine?: "Telnyx"
  transcription_engine_config?: {
    transcription_engine: "Telnyx"
    language: "en"
    transcription_model: "openai/whisper-large-v3-turbo"
  }
  transcription_tracks: string
}

/**
 * The `transcription_start` body for a mode. Suspects, isolated one per mode:
 * - `default`      — today's body. Engine + whisper model + `both` tracks.
 * - `telnyx-single`— same engine/model, one track. If this works, `both` is at
 *                    fault (only the contact's audio is transcribed).
 * - `minimal`      — no engine and no config at all, so Telnyx uses its own
 *                    default engine. Answers "can this account transcribe AT
 *                    ALL?". Telnyx only labels `transcription_track` on its own
 *                    engine, so expect unlabeled ("—") segments here.
 */
export function transcriptionStartBody(mode: TranscriptionMode): TranscriptionStartBody {
  if (mode === "minimal") return { transcription_tracks: "inbound" }
  return {
    transcription_engine: "Telnyx",
    transcription_engine_config: {
      transcription_engine: "Telnyx",
      language: "en",
      transcription_model: "openai/whisper-large-v3-turbo",
    },
    transcription_tracks: mode === "telnyx-single" ? "inbound" : "both",
  }
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
