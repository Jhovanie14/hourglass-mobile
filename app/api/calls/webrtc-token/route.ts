import { getCurrentUser } from "@/lib/auth"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

export const runtime = "nodejs"

async function isAuthorized(req: Request): Promise<boolean> {
  // 1. Cookie-based session (the web app)
  const user = await getCurrentUser()
  if (user) return true

  // 2. Bearer access token (the extension panel)
  const authHeader = req.headers.get("authorization") ?? ""
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : null
  if (!token) return false

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
  const { data, error } = await supabase.auth.getUser(token)
  return !error && !!data.user
}

export async function GET(req: Request) {
  if (!(await isAuthorized(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const login = process.env.TELNYX_SIP_USERNAME
  const password = process.env.TELNYX_SIP_PASSWORD

  if (!login || !password) {
    return Response.json(
      { error: "TELNYX_SIP_USERNAME or TELNYX_SIP_PASSWORD not set" },
      { status: 500 }
    )
  }

  return Response.json({ login, password })
}
