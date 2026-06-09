// components/calls/hooks/use-webrtc-client.ts
"use client"

import { useEffect, useRef, useState } from "react"
import type { RefObject } from "react"
import type { Call as TelnyxCall } from "@telnyx/webrtc"

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

      const res = await fetch("/api/calls/webrtc-token")
      if (!res.ok) {
        console.warn("WebRTC: could not fetch credentials — is TELNYX_SIP_USERNAME set?")
        return
      }
      const { login, password } = await res.json()
      if (!mounted || !login || !password) return

      const client = new TelnyxRTC({ login, password })
      clientRef.current = client

      client.on("telnyx.ready", () => {
        console.log("✅ TelnyxRTC ready — SIP registered")
        if (mounted) setIsReady(true)
      })

      client.on("telnyx.error", (err: unknown) => {
        console.error("❌ TelnyxRTC error:", err)
      })

      client.on("telnyx.notification", (n: Notification) => {
        console.log(
          "🔔 Telnyx notification:",
          n.type,
          (n.call as any)?.state,
          (n.call as any)?.direction
        )
        onNotificationRef.current(n)
      })

      client.connect()
    }

    init()

    return () => {
      mounted = false
      clientRef.current?.disconnect()
    }
  }, [])

  function newCall(to: string, callerNumber: string): TelnyxCall | null {
    const client = clientRef.current
    if (!client || !isReady) return null
    return client.newCall({
      destinationNumber: to,
      callerNumber,
      remoteElement: audioRef.current ?? undefined,
    })
  }

  return { isReady, newCall }
}
