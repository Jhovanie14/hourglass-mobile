// components/calls/hooks/use-inbound-phone.ts
"use client"

import { useCallback, useMemo } from "react"
import { createClient } from "@/lib/client"

/**
 * Fallback lookup of the business line an inbound call came in on, for legs
 * that arrive without the X-Line-Label/X-Line-Number headers. Goes through the
 * auth-gated /api/calls/phone-numbers route: phone_numbers is RLS-protected, so
 * a direct browser query comes back empty and the popup silently loses the
 * brand. Read-only — call records are written server-side by the voice webhook.
 */
export function useInboundPhoneLookup() {
  const supabase = useMemo(() => createClient(), [])

  return useCallback(
    async (
      rawDestination: string
    ): Promise<{ label: string; phone_number: string } | null> => {
      // Normalize to E.164: strip non-digits, prepend "+".
      const digits = rawDestination.replace(/\D/g, "")
      if (!digits) return null
      const normalized = `+${digits}`

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const res = await fetch("/api/calls/phone-numbers", {
          headers: session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {},
        })
        if (!res.ok) return null
        const { phoneNumbers } = (await res.json()) as {
          phoneNumbers: Array<{ label: string; phone_number: string }>
        }
        const match = phoneNumbers.find((p) => p.phone_number === normalized)
        return match ? { label: match.label, phone_number: match.phone_number } : null
      } catch (err) {
        console.warn("Inbound line lookup failed", err)
        return null
      }
    },
    [supabase]
  )
}
