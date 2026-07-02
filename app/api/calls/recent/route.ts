import { isRequestAuthenticated } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"

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
      "id, contact_number, direction, status, started_at, created_at, phone_numbers(label, phone_number, color)"
    )
    .order("created_at", { ascending: false })
    .limit(30)

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  // Supabase returns the joined phone_numbers as an array; flatten to one object.
  const recentCalls = (data ?? []).map((c) => ({
    ...c,
    phone_numbers: Array.isArray(c.phone_numbers)
      ? (c.phone_numbers[0] ?? null)
      : (c.phone_numbers ?? null),
  }))

  return Response.json({ recentCalls })
}
