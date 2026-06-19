import { createClient } from "@/lib/server"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

/**
 * Returns the current user's claims, or null if not signed in.
 */
export async function getCurrentUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  return data?.claims ?? null
}

/**
 * True when the request carries a valid Supabase session — either via cookie
 * (the web app) or an `Authorization: Bearer <access_token>` header (the
 * extension panel, which has no cross-site cookies inside its iframe).
 */
export async function isRequestAuthenticated(req: Request): Promise<boolean> {
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

/**
 * Resolve the authenticated user's id from a cookie session (the web app) or an
 * `Authorization: Bearer <access_token>` header (the extension panel). Returns
 * null if unauthenticated.
 */
export async function getRequestUserId(req: Request): Promise<string | null> {
  // 1. Cookie-based session (the web app). Claim `sub` is the user id.
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

/**
 * Returns the current user's role from the profiles table, or null.
 */
export async function getCurrentRole() {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims?.sub

  if (!userId) {
    return null
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single()

  return profile?.role ?? null
}

/**
 * True when the current user is an admin.
 */
export async function isAdmin() {
  return (await getCurrentRole()) === "admin"
}
