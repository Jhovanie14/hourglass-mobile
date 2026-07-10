import { createBrowserClient } from '@supabase/ssr'
import { createClient as createJsClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

function makeClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_KEY)
}

// The extension panel runs as a cross-origin iframe inside a chrome-extension://
// page. Third-party cookies there are partitioned and do NOT persist across
// reopens, so the cookie-based SSR client silently loses the session (symptom:
// "back to login" every reopen, and 401s fetching Telnyx creds → no mic). The
// panel authenticates every API via `Authorization: Bearer` (never cookies), so
// it can safely persist its session in localStorage instead — which IS durable
// in that iframe and is shared across the extension's side panel + offscreen
// documents (same top-level origin → same storage partition).
function makePanelClient() {
  return createJsClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: window.localStorage,
      storageKey: "hg-panel-auth",
    },
  })
}

let browserClient: ReturnType<typeof makeClient> | null = null
let panelClient: ReturnType<typeof makePanelClient> | null = null

export function createClient() {
  // During SSR each call gets a fresh throwaway instance (no shared state on
  // the server); in the browser everyone shares one client so the panel's
  // authenticated session is visible to every hook (fixes RLS 401s from
  // parallel anonymous clients and GoTrue multi-instance warnings).
  if (typeof window === "undefined") return makeClient()

  // In the extension panel, use a localStorage-backed client so the session
  // survives iframe reopens and reaches the headless offscreen phone.
  if (window.location.pathname.startsWith("/panel")) {
    if (!panelClient) panelClient = makePanelClient()
    return panelClient
  }

  if (!browserClient) browserClient = makeClient()
  return browserClient
}
