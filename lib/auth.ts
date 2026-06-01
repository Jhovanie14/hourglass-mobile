import { createClient } from "@/lib/server"

/**
 * Returns the current user's claims, or null if not signed in.
 */
export async function getCurrentUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  return data?.claims ?? null
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
