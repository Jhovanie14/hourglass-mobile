"use client"

import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { createClient } from "@/lib/client"
import { WebRTCProvider } from "@/components/calls/webrtc-provider"
import { PANEL_SOURCE } from "@/lib/panel-bus"
import type { PhoneNumber } from "@/types/calls"
import { PanelLogin } from "./panel-login"
import { PanelDialer } from "./panel-dialer"
import { BackgroundPhone } from "./background-phone"
import { RemotePhone } from "./remote-phone"
import { WidgetPhone } from "./widget-phone"

type PanelMode = "local" | "background" | "remote" | "widget"

function getMode(): PanelMode {
  if (typeof window === "undefined") return "local"
  const m = new URLSearchParams(window.location.search).get("mode")
  return m === "background" || m === "remote" || m === "widget" ? m : "local"
}

export function PanelApp() {
  const [supabase] = useState(() => createClient())
  const [mode] = useState<PanelMode>(getMode)
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([])

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .finally(() => setLoading(false))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s)
    )
    return () => sub.subscription.unsubscribe()
  }, [supabase])

  const accessToken = session?.access_token
  useEffect(() => {
    if (!accessToken) return
    fetch("/api/calls/phone-numbers", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then((res) => res.json())
      .then((body) => {
        if (Array.isArray(body.phoneNumbers)) {
          setPhoneNumbers(body.phoneNumbers as PhoneNumber[])
        } else {
          console.error("Failed to load phone numbers:", body.error)
        }
      })
      .catch((err) => console.error("Failed to load phone numbers:", err))
  }, [accessToken])

  // Background mode with no session: tell the extension loudly, render nothing.
  useEffect(() => {
    if (mode !== "background" || loading) return
    if (!session) {
      window.parent.postMessage({ source: PANEL_SOURCE, type: "auth-required" }, "*")
    }
  }, [mode, loading, session])

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>
  }

  if (mode === "background") {
    if (!session) return null
    return <BackgroundPhone phoneNumbers={phoneNumbers} />
  }

  if (mode === "widget") {
    if (!session) return null
    return <WidgetPhone phoneNumbers={phoneNumbers} />
  }

  if (!session) {
    return <PanelLogin supabase={supabase} />
  }

  if (mode === "remote") {
    return (
      <RemotePhone
        phoneNumbers={phoneNumbers}
        accessToken={accessToken}
        onSignOut={() => supabase.auth.signOut()}
      />
    )
  }

  return (
    <WebRTCProvider>
      <PanelDialer
        phoneNumbers={phoneNumbers}
        onSignOut={() => supabase.auth.signOut()}
      />
    </WebRTCProvider>
  )
}
