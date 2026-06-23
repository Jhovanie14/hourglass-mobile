// components/calls/hooks/use-inbound-phone.ts
"use client"

import { useCallback, useMemo } from "react"
import { createClient } from "@/lib/client"

/**
 * Look up the business phone number an inbound call came in on, for display in
 * the incoming-call popup. Read-only — call records are written server-side by
 * the Telnyx voice webhook (the single source of truth), not the client.
 */
export function useInboundPhoneLookup() {
  const supabase = useMemo(() => createClient(), [])

  return useCallback(
    async (
      rawDestination: string
    ): Promise<{ label: string; phone_number: string } | null> => {
      // Normalize to E.164: strip non-digits, prepend "+".
      const digits = rawDestination.replace(/\D/g, "")
      const normalized = digits ? `+${digits}` : rawDestination

      const { data } = await supabase
        .from("phone_numbers")
        .select("label, phone_number")
        .eq("phone_number", normalized)
        .eq("is_active", true)
        .maybeSingle()

      return data as { label: string; phone_number: string } | null
    },
    [supabase]
  )
}
