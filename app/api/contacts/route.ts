import { getRequestUserId } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"
import { upsertContactWithClient } from "@/lib/contacts"

export const runtime = "nodejs"

/**
 * Save (create or rename) a saved contact name under one of the agent's
 * phone lines. Auth: Supabase Bearer token, same as the other mobile-facing
 * routes. Validation (E.164) lives in the shared lib/contacts.ts.
 */
export async function POST(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { phoneNumberId?: string; contactNumber?: string; name?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { phoneNumberId, contactNumber, name } = body
  if (!phoneNumberId || !contactNumber || !name) {
    return Response.json(
      { error: "phoneNumberId, contactNumber, and name are required" },
      { status: 400 }
    )
  }

  const result = await upsertContactWithClient(createAdminClient(), {
    phoneNumberId,
    contactNumber,
    name,
    userId,
  })

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 422 })
  }
  return Response.json({ contact: result.contact })
}
