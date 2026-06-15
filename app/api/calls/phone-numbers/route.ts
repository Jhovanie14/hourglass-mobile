import { isRequestAuthenticated } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"

export const runtime = "nodejs"

// Returns the active phone numbers (caller-ID options) for an authenticated
// caller. Reads with the admin client so it works regardless of row-level
// security — the panel runs client-side and cannot rely on RLS-scoped reads.
export async function GET(req: Request) {
  if (!(await isRequestAuthenticated(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("phone_numbers")
    .select("id, label, phone_number, color")
    .eq("is_active", true)
    .order("created_at", { ascending: true })

  if (error) {
    return Response.json({ error: error.message }, { status: 500 })
  }

  return Response.json({ phoneNumbers: data ?? [] })
}
