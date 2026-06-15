"use client"

import { useEffect, useState } from "react"
import type { Session } from "@supabase/supabase-js"
import { createClient } from "@/lib/client"
import { WebRTCProvider } from "@/components/calls/webrtc-provider"
import type { PhoneNumber } from "@/types/calls"
import { PanelLogin } from "./panel-login"
import { PanelDialer } from "./panel-dialer"

export function PanelApp() {
  const [supabase] = useState(() => createClient())
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) =>
      setSession(s)
    )
    return () => sub.subscription.unsubscribe()
  }, [supabase])

  useEffect(() => {
    if (!session) return
    supabase
      .from("phone_numbers")
      .select("id, label, phone_number, color")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .then(({ data }) => setPhoneNumbers((data ?? []) as PhoneNumber[]))
  }, [session, supabase])

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">Loading…</div>
  }

  if (!session) {
    return <PanelLogin supabase={supabase} />
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
