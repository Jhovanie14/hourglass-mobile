import { useCallback, useEffect, useRef } from "react"

/**
 * Synthesized ring tones. "ring" = inbound (480 Hz double-burst every 3 s,
 * unchanged). "ringback" = outbound waiting tone (440 Hz double-burst every
 * 4 s, US-style cadence approximation).
 */
export function useRingtone(kind: "ring" | "ringback" = "ring") {
  const ctxRef = useRef<AudioContext | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const freq = kind === "ringback" ? 440 : 480
  const period = kind === "ringback" ? 4000 : 3000

  const burst = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.25, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)
    osc.start(now)
    osc.stop(now + 0.45)
  }, [freq])

  const start = useCallback(() => {
    if (intervalRef.current) return
    if (!ctxRef.current) ctxRef.current = new AudioContext()
    if (ctxRef.current.state === "suspended") ctxRef.current.resume()
    burst()
    setTimeout(burst, 500)
    intervalRef.current = setInterval(() => {
      burst()
      setTimeout(burst, 500)
    }, period)
  }, [burst, period])

  const stop = useCallback(() => {
    clearInterval(intervalRef.current ?? undefined)
    intervalRef.current = null
  }, [])

  useEffect(() => () => stop(), [stop])

  return { start, stop }
}
