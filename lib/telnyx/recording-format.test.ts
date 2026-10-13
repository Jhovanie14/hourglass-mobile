import { describe, it, expect } from "vitest"
import { recordingFormat } from "./recording-format"

const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))

describe("recordingFormat", () => {
  it("recognises a WAV by its RIFF/WAVE header", () => {
    expect(recordingFormat(bytes("RIFF\x00\x00\x00\x00WAVEfmt "))).toEqual({
      ext: "wav",
      contentType: "audio/wav",
    })
  })

  it("treats an ID3-tagged file as mp3", () => {
    expect(recordingFormat(bytes("ID3\x04\x00\x00\x00\x00\x00\x00\x00\x00"))).toEqual({
      ext: "mp3",
      contentType: "audio/mpeg",
    })
  })

  it("treats a RIFF container that is not WAVE as mp3", () => {
    expect(recordingFormat(bytes("RIFF\x00\x00\x00\x00AVI LIST")).ext).toBe("mp3")
  })

  it("treats a too-short download as mp3 rather than throwing", () => {
    expect(recordingFormat(bytes("RIF")).ext).toBe("mp3")
  })
})
