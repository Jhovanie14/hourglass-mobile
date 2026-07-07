import { getRequestUserId } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"
import { sendMessageWithClient } from "@/lib/messaging"

export const runtime = "nodejs"

/**
 * Mobile-app SMS send. Auth: Supabase Bearer token (same pattern as
 * /api/calls/webrtc-token). The send flow — E.164 guard, opt-out suppression,
 * queued→sent status handling — is shared with the dashboard's server action
 * via lib/messaging.ts.
 */
export async function POST(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: {
    conversationId?: string
    phoneNumberId?: string
    to?: string
    body?: string
  }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { conversationId, phoneNumberId, to, body: text } = body
  if (!conversationId || !phoneNumberId || !to || typeof text !== "string") {
    return Response.json(
      { error: "conversationId, phoneNumberId, to and body are required" },
      { status: 400 }
    )
  }

  const result = await sendMessageWithClient(createAdminClient(), {
    conversationId,
    phoneNumberId,
    to,
    body: text,
  })

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 422 })
  }
  return Response.json({ message: result.message })
}
