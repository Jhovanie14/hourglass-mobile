"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/client"
import {
  fetchDispositionsForCalls,
  type Disposition,
} from "@/lib/dispositions"

/**
 * Load the agent's dispositions for the visible calls, keyed by
 * telnyx_call_id. `createClient()` returns the browser client on the dashboard
 * and the localStorage panel client under /panel, so this hook works on both
 * surfaces; RLS scopes rows to the agent either way. `setLocal` lets a save
 * update the map without a refetch.
 */
export function useDispositions(
  telnyxCallIds: (string | null | undefined)[]
): { map: Record<string, Disposition>; setLocal: (d: Disposition) => void } {
  const [map, setMap] = useState<Record<string, Disposition>>({})
  const supabase = useMemo(() => createClient(), [])

  const ids = telnyxCallIds.filter(Boolean) as string[]
  const key = ids.slice().sort().join(",")

  const load = useCallback(async () => {
    try {
      const result = await fetchDispositionsForCalls(supabase, key ? key.split(",") : [])
      setMap(result)
    } catch {
      // Non-fatal: the row just shows no note badge.
    }
  }, [supabase, key])

  useEffect(() => {
    if (key) load()
  }, [key, load])

  const setLocal = useCallback((d: Disposition) => {
    setMap((prev) => ({ ...prev, [d.telnyx_call_id]: d }))
  }, [])

  return { map, setLocal }
}
