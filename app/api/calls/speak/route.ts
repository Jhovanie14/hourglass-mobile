import { getCurrentUser } from "@/lib/auth"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { getTelnyxClient, withRetry } from "@/lib/telnyx/client"

export const runtime = "nodejs"

const MAX_TEXT_LENGTH = 1000
const ALLOWED_VOICES = new Set(["male", "female"])

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

export async function POST(req: Request) {
  if (!(await isAuthorized(req))) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { call_control_id, text, voice = "female" } = await req.json()

  if (typeof call_control_id !== "string" || typeof text !== "string") {
    return Response.json({ error: "Missing call_control_id or text" }, { status: 400 })
  }
  const trimmed = text.trim()
  if (!call_control_id || !trimmed) {
    return Response.json({ error: "Missing call_control_id or text" }, { status: 400 })
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    return Response.json({ error: "text too long" }, { status: 400 })
  }
  const safeVoice = ALLOWED_VOICES.has(voice) ? voice : "female"

  try {
    await withRetry(() =>
      getTelnyxClient().calls.actions.speak(call_control_id, {
        payload: trimmed,
        voice: safeVoice,
        language: "en-US",
      })
    )
  } catch (err) {
    console.error("⚠️ Failed to speak on call:", err)
    return Response.json({ error: "Speak failed" }, { status: 502 })
  }

  return Response.json({ ok: true })
}
