import { createBrowserClient } from '@supabase/ssr'

function makeClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  )
}

let browserClient: ReturnType<typeof makeClient> | null = null

export function createClient() {
  // During SSR each call gets a fresh throwaway instance (no shared state on
  // the server); in the browser everyone shares one client so the panel's
  // authenticated session is visible to every hook (fixes RLS 401s from
  // parallel anonymous clients and GoTrue multi-instance warnings).
  if (typeof window === "undefined") return makeClient()
  if (!browserClient) browserClient = makeClient()
  return browserClient
}
