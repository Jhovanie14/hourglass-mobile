import { createClient } from "@/lib/server"
import { CallsPageClient } from "@/components/calls/calls-page-client"
import { buildContactNameMap } from "@/lib/contact-names"
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

  // Merge saved contact names so rows show a name instead of the raw number.
  // The contacts SELECT is allowed by its team-wide RLS read policy.
  const numbers = Array.from(new Set(initialCalls.map((c) => c.contact_number)))
  let nameMap: Record<string, string> = {}
  if (numbers.length) {
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("contact_number, name, updated_at")
      .in("contact_number", numbers)
    nameMap = buildContactNameMap(contactRows ?? [])
  }

  const callsWithNames: Call[] = initialCalls.map((c) => ({
    ...c,
    contact_name: nameMap[c.contact_number] ?? null,
  }))

  return (
    <CallsPageClient phoneNumbers={phoneNumbers} initialCalls={callsWithNames} />
  )
}
