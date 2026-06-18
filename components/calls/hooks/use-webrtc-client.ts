// components/calls/hooks/use-webrtc-client.ts
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import type { Call as TelnyxCall } from "@telnyx/webrtc"
import { createClient } from "@/lib/client"

type Notification = { type: string; call?: TelnyxCall }

export function useWebRTCClient(
  audioRef: RefObject<HTMLAudioElement | null>,
  onNotification: (n: Notification) => void
) {
  const clientRef = useRef<InstanceType<typeof import("@telnyx/webrtc").TelnyxRTC> | null>(null)
  const onNotificationRef = useRef(onNotification)
  const [isReady, setIsReady] = useState(false)

  // Keep callback ref current without restarting the effect
  useEffect(() => {
    onNotificationRef.current = onNotification
  })

  useEffect(() => {
    let mounted = true

    async function init() {
      const { TelnyxRTC } = await import("@telnyx/webrtc")

      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const res = await fetch("/api/calls/webrtc-token", {
        headers: session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {},
      })
      if (!res.ok) {
        console.warn("WebRTC: could not fetch credentials — is TELNYX_SIP_USERNAME set?")
        return
      }
      const { login, password } = await res.json()
      if (!mounted || !login || !password) return

      const client = new TelnyxRTC({ login, password })
      clientRef.current = client

      client.on("telnyx.ready", () => {
        if (mounted) setIsReady(true)
      })

      client.on("telnyx.error", (err: unknown) => {
        console.error("❌ TelnyxRTC error:", err)
      })

      client.on("telnyx.notification", (n: Notification) => {
        if (mounted) onNotificationRef.current(n)
      })

      client.connect()
    }

    init()

    return () => {
      mounted = false
      const c = clientRef.current
      if (c) {
        // @ts-ignore
        c.off("telnyx.ready")
        // @ts-ignore
        c.off("telnyx.error")
        // @ts-ignore
        c.off("telnyx.notification")
        c.disconnect()
      }
    }
  }, [])

  // Presence heartbeat: while the WebRTC client is connected, tell the server
  // this agent is online every ~15s so inbound ring-all can reach them. No
  // explicit offline ping — the server drops agents whose heartbeat goes stale.
  useEffect(() => {
    if (!isReady) return
    let active = true

    async function beat() {
      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        if (!active) return
        await fetch("/api/calls/presence", {
          method: "POST",
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        })
      } catch (err) {
        console.warn("WebRTC: presence heartbeat failed", err)
      }
    }

    beat()
    const id = setInterval(beat, 15_000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [isReady])

  const newCall = useCallback(
    (to: string, callerNumber: string): TelnyxCall | null => {
      const client = clientRef.current
      if (!client || !isReady) return null
      return client.newCall({
        destinationNumber: to,
        callerNumber,
        remoteElement: audioRef.current ?? undefined,
      })
    },
    [isReady, audioRef]
  )

  return { isReady, newCall }
}
