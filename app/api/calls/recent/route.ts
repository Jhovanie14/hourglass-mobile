import { isRequestAuthenticated } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"
import { buildContactNameMap } from "@/lib/contact-names"

export const runtime = "nodejs"

// Latest calls for the Recent tab. Bearer-auth + admin client, same pattern as
// phone-numbers/route.ts: the panel runs client-side and cannot rely on
// RLS-scoped reads, so calls are returned team-wide (as on the dashboard).
export async function GET(req: Request) {
  if (!(await isRequestAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("calls")
    .select(
      "id, telnyx_call_id, contact_number, direction, status, started_at, created_at, phone_numbers(label, phone_number, color)"
    )
    .order("created_at", { ascending: false })
    .limit(30)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Supabase returns the joined phone_numbers as an array; flatten to one object.
  const flattened = (data ?? []).map((c) => ({
    ...c,
    phone_numbers: Array.isArray(c.phone_numbers)
      ? (c.phone_numbers[0] ?? null)
      : (c.phone_numbers ?? null),
  }))

  // Merge saved contact names (service-role client reads contacts unrestricted).
  const numbers = Array.from(new Set(flattened.map((c) => c.contact_number)))
  let nameMap: Record<string, string> = {}
  if (numbers.length) {
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("contact_number, name, updated_at")
      .in("contact_number", numbers)
    nameMap = buildContactNameMap(contactRows ?? [])
  }

  const recentCalls = flattened.map((c) => ({
    ...c,
    contact_name: nameMap[c.contact_number] ?? null,
  }))

  return Response.json({ recentCalls })
}
