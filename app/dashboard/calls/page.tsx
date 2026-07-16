import { createClient } from "@/lib/server"
import { CallsPageClient } from "@/components/calls/calls-page-client"
import type { Call, PhoneNumber } from "@/types/calls"

export default async function CallsPage() {
  const supabase = await createClient()

  const [phoneNumbersRes, callsRes] = await Promise.all([
    supabase
      .from("phone_numbers")
      .select("id, label, phone_number, color")
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("calls")
      .select(
        "id, phone_number_id, contact_number, direction, status, duration_seconds, telnyx_call_id, started_at, ended_at, created_at, has_voicemail, has_transcript, phone_numbers(id, label, phone_number, color)"
      )
      .order("created_at", { ascending: false })
      .limit(500),
  ])

  const phoneNumbers = (phoneNumbersRes.data ?? []) as PhoneNumber[]

  const initialCalls: Call[] = (callsRes.data ?? []).map((c) => ({
    id: c.id,
    phone_number_id: c.phone_number_id,
    contact_number: c.contact_number,
    direction: c.direction,
    status: c.status,
    duration_seconds: c.duration_seconds ?? 0,
    telnyx_call_id: c.telnyx_call_id,
    started_at: c.started_at,
    ended_at: c.ended_at,
    created_at: c.created_at,
    has_voicemail: c.has_voicemail,
    has_transcript: c.has_transcript,
    phone_numbers: Array.isArray(c.phone_numbers)
      ? c.phone_numbers[0]
      : c.phone_numbers,
  }))

  return (
    <CallsPageClient phoneNumbers={phoneNumbers} initialCalls={initialCalls} />
  )
}
