import { getRequestUserId } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"
import { getOrCreateConversationWithClient } from "@/lib/messaging"

export const runtime = "nodejs"

/**
 * Mobile-app "compose": get-or-create the conversation for a contact number
 * on one of our lines. Auth: Supabase Bearer token. Validation (E.164) lives
 * in the shared lib/messaging.ts implementation.
 */
export async function POST(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: { phoneNumberId?: string; contactNumber?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { phoneNumberId, contactNumber } = body
  if (!phoneNumberId || !contactNumber) {
    return Response.json(
      { error: "phoneNumberId and contactNumber are required" },
      { status: 400 }
    )
  }

  const result = await getOrCreateConversationWithClient(
    createAdminClient(),
    phoneNumberId,
    contactNumber
  )

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 422 })
  }
  return Response.json({ conversationId: result.conversationId })
}
