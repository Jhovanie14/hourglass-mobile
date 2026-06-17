import { getCurrentUser } from "@/lib/auth"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/admin"
import { getTelnyxClient } from "@/lib/telnyx/client"
import { getOrCreateAgentCredential } from "@/lib/telnyx/agent-credentials"

export const runtime = "nodejs"

/** Resolve the authenticated user's id from a cookie session (web app) or a
 *  Bearer access token (extension panel). Returns null if unauthenticated. */
async function getUserId(req: Request): Promise<string | null> {
  // 1. Cookie-based session (the web app). Claims `sub` is the user id.
  const claims = await getCurrentUser()
  if (claims?.sub) return claims.sub as string

  // 2. Bearer access token (the extension panel).
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null
  if (!token) return null

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
  const { data, error } = await supabase.auth.getUser(token)
  if (error || !data.user) return null
  return data.user.id
}

export async function GET(req: Request) {
  const userId = await getUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const connectionId = process.env.TELNYX_CREDENTIAL_CONNECTION_ID
  if (!connectionId) {
    return Response.json(
      { error: "TELNYX_CREDENTIAL_CONNECTION_ID not set" },
      { status: 500 }
    )
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
