import { createClient } from "@supabase/supabase-js"

/**
 * Server-only Supabase client using the SECRET (service role) key.
 *
 * This client bypasses Row Level Security and can call the Auth Admin API
 * (e.g. inviteUserByEmail). NEVER import this into client components or expose
 * the secret key to the browser. Use only inside server actions / route handlers.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
