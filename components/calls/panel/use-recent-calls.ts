"use client"

import { useCallback, useEffect, useState } from "react"
import type { RecentCall } from "./recent-row"

/**
 * Fetches the latest calls for the Recent tab using the panel's bearer token.
 * One fetch per mount (+ manual reload); no realtime subscription (YAGNI).
 */
export function useRecentCalls(accessToken: string | undefined) {
  const [calls, setCalls] = useState<RecentCall[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(() => {
    if (!accessToken) return
    setLoading(true)
    setError(null)
    fetch("/api/calls/recent", {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || "Request failed")
        setCalls(Array.isArray(body.recentCalls) ? body.recentCalls : [])
      })
      .catch((err) => setError(err.message || "Couldn't load recent calls"))
      .finally(() => setLoading(false))
  }, [accessToken])

  useEffect(() => {
    reload()
  }, [reload])

  return { calls, loading, error, reload }
}
