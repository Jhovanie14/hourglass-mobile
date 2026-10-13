/** How a downloaded recording should be stored. */
export type RecordingFormat = { ext: "wav" | "mp3"; contentType: string }

/**
 * Identify a recording by its bytes, not by which URL it came from. Recordings
 * are started as mp3, but Telnyx sometimes delivers only a WAV — those used to
 * be saved as `.mp3` / `audio/mpeg`, a label players like iOS refuse.
 */
export function recordingFormat(bytes: Uint8Array): RecordingFormat {
  const tag = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4))
  const isWav = bytes.length >= 12 && tag(0) === "RIFF" && tag(8) === "WAVE"
  return isWav ? { ext: "wav", contentType: "audio/wav" } : { ext: "mp3", contentType: "audio/mpeg" }
}
