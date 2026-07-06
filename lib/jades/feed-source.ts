import type { SupabaseClient } from "@supabase/supabase-js"
import {
  callToFeedEvent,
  mergeFeedEvents,
  messageToFeedEvent,
  voicemailToFeedEvent,
  type JadesDirection,
  type JadesFeedEvent,
} from "./feed"

type PhoneJoin = { label: string; phone_number: string } | null

/**
 * Fetch inbound + outbound calls, SMS, and voicemails created after `since`,
 * mapped to Jades' flat feed shape, ordered oldest→newest and capped to `limit`.
 */
export async function fetchFeedEvents(
  supabase: SupabaseClient,
  since: string,
  limit: number,
): Promise<JadesFeedEvent[]> {
  const [callsRes, messagesRes, voicemailsRes] = await Promise.all([
    supabase
      .from("calls")
      .select("contact_number, direction, status, duration_seconds, started_at, created_at, phone_numbers(label, phone_number)")
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limit),
    supabase
      .from("messages")
      .select("direction, body, sent_at, created_at, conversations(contact_number), phone_numbers(label, phone_number)")
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limit),
    supabase
      .from("voicemails")
      .select("recording_url, duration_seconds, created_at, calls(contact_number, phone_numbers(label, phone_number))")
      .gt("created_at", since)
      .order("created_at", { ascending: true })
      .limit(limit),
  ])

  const events: JadesFeedEvent[] = []

  for (const c of callsRes.data ?? []) {
    const phone = c.phone_numbers as unknown as PhoneJoin
    if (!phone) continue
    events.push(callToFeedEvent({
      contact_number: c.contact_number,
      direction: c.direction as JadesDirection,
      status: c.status,
      duration_seconds: c.duration_seconds,
      started_at: c.started_at,
      created_at: c.created_at,
      phone,
    }))
  }

  for (const m of messagesRes.data ?? []) {
    const phone = m.phone_numbers as unknown as PhoneJoin
    const conv = m.conversations as unknown as { contact_number: string } | null
    if (!phone || !conv) continue
    events.push(messageToFeedEvent({
      direction: m.direction as JadesDirection,
      body: m.body,
      sent_at: m.sent_at,
      created_at: m.created_at,
      contact_number: conv.contact_number,
      phone,
    }))
  }

  for (const v of voicemailsRes.data ?? []) {
    const call = v.calls as unknown as { contact_number: string; phone_numbers: PhoneJoin } | null
    if (!call || !call.phone_numbers) continue
    events.push(voicemailToFeedEvent({
      recording_url: v.recording_url,
      duration_seconds: v.duration_seconds,
      created_at: v.created_at,
      contact_number: call.contact_number,
      phone: call.phone_numbers,
    }))
  }

  return mergeFeedEvents(events, limit)
}
