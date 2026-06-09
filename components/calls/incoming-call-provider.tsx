"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Phone, PhoneOff } from "lucide-react"
import { createClient } from "@/lib/client"

type IncomingCall = {
  id: string
  telnyx_call_id: string
  contact_number: string
  phone_numbers?: { label: string; phone_number: string } | null
}

// Generates a "brrring brrring" pattern using the Web Audio API.
function useRingtone() {
  const ctxRef = useRef<AudioContext | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const playBurst = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx) return
    const now = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 480
    gain.gain.setValueAtTime(0.25, now)
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45)
    osc.start(now)
    osc.stop(now + 0.45)
  }, [])

  const start = useCallback(() => {
    if (!ctxRef.current) {
      ctxRef.current = new AudioContext()
    }
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume()
    }
    playBurst()
    // Two bursts, then pause — classic "ring ring … ring ring" pattern
    intervalRef.current = setInterval(() => {
      playBurst()
      setTimeout(playBurst, 500)
    }, 3000)
  }, [playBurst])

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  useEffect(() => () => stop(), [stop])

  return { start, stop }
}

export function IncomingCallProvider() {
  const supabase = useMemo(() => createClient(), [])
  const [call, setCall] = useState<IncomingCall | null>(null)
  const [busy, setBusy] = useState(false)
  const { start: startRing, stop: stopRing } = useRingtone()

  // Watch for new inbound calls in "initiated" state, and auto-dismiss when caller hangs up
  useEffect(() => {
    const channel = supabase
      .channel("incoming-calls")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "calls" },
        async (payload) => {
          const row = payload.new as IncomingCall & {
            direction: string
            status: string
            phone_number_id: string
          }
          if (row.direction !== "inbound" || row.status !== "initiated") return

          // Fetch phone number label for display
          console.log("📞 incoming call phone_number_id:", row.phone_number_id)
          const { data: pn, error: pnError } = await supabase
            .from("phone_numbers")
            .select("label, phone_number")
            .eq("id", row.phone_number_id)
            .single()
          if (pnError) console.warn("⚠️ phone_numbers fetch error:", pnError)
          console.log("📞 phone number data:", pn)

          setCall({
            id: row.id,
            telnyx_call_id: row.telnyx_call_id,
            contact_number: row.contact_number,
            phone_numbers: pn ?? null,
          })
          startRing()
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "calls" },
        (payload) => {
          const updated = payload.new as IncomingCall & { status: string }
          setCall((current) => {
            if (current?.id !== updated.id) return current
            if (updated.status !== "initiated") {
              stopRing()
              return null
            }
            return current
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, startRing, stopRing])

  const dismiss = useCallback(() => {
    stopRing()
    setCall(null)
    setBusy(false)
  }, [stopRing])

  async function handleAnswer() {
    if (!call || busy) return
    setBusy(true)
    stopRing()
    await fetch("/api/calls/answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_control_id: call.telnyx_call_id }),
    })
    dismiss()
  }

  async function handleReject() {
    if (!call || busy) return
    setBusy(true)
    stopRing()
    await fetch("/api/calls/reject", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ call_control_id: call.telnyx_call_id }),
    })
    dismiss()
  }

  if (!call) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 w-72 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      {/* Pulsing ring indicator */}
      <div className="relative flex items-center gap-3 bg-green-500/10 px-4 py-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
        </span>
        <span className="text-xs font-semibold uppercase tracking-widest text-green-600 dark:text-green-400">
          Incoming Call
        </span>
      </div>

      <div className="space-y-1 px-4 py-3">
        <p className="text-lg font-semibold tabular-nums tracking-tight">
          {call.contact_number}
        </p>
        {call.phone_numbers && (
          <p className="text-sm text-muted-foreground">
            → {call.phone_numbers.label} ({call.phone_numbers.phone_number})
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button
          onClick={handleReject}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
        >
          <PhoneOff className="h-4 w-4" />
          Decline
        </button>
        <button
          onClick={handleAnswer}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-500 py-2.5 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50"
        >
          <Phone className="h-4 w-4" />
          Answer
        </button>
      </div>
    </div>
  )
}
