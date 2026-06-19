import { getRequestUserId } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"
import { getTelnyxClient } from "@/lib/telnyx/client"
import { getOrCreateAgentCredential } from "@/lib/telnyx/agent-credentials"

export const runtime = "nodejs"

export async function GET(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const connectionId = process.env.TELNYX_CREDENTIAL_CONNECTION_ID
  if (!connectionId) {
    return Response.json({ error: "TELNYX_CREDENTIAL_CONNECTION_ID not set" }, { status: 500 })
  }

  try {
    const admin = createAdminClient()
    const telnyx = getTelnyxClient()
    const { login, password } = await getOrCreateAgentCredential(
      admin,
      telnyx,
      userId,
      connectionId
    )
    return Response.json({ login, password })
  } catch (err) {
    console.error("⚠️ Failed to provision/return agent SIP credential:", err)
    return Response.json({ error: "Failed to obtain credential" }, { status: 500 })
  }
}
