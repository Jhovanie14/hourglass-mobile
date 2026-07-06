import { after } from "next/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Notification } from "@/types/notifications"
import { deliverToJades } from "./deliver"
import { loadJadesEvent } from "./load-event"
import { supabaseDataSource } from "./supabase-source"

/**
 * Schedule enrichment + signed push to Jades after the response is sent, so the
 * Telnyx webhook returns 200 immediately. A push failure is logged only — the
 * backfill endpoint (/api/jades/events) is the durable safety net.
 */
export function enqueueJadesDelivery(supabase: SupabaseClient, notification: Notification): void {
  after(async () => {
    try {
      const event = await loadJadesEvent(supabaseDataSource(supabase), notification)
      if (event) await deliverToJades(event)
    } catch (err) {
      console.error("Jades delivery error for notification", notification.id, err)
    }
  })
}
