import { getCurrentUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"

export const runtime = "nodejs"

// The browser <audio> tag buffers immediately, so 60s is plenty. The mobile
// app needs longer: an agent can pause a voicemail, take a call, and scrub
// back minutes later, which re-requests the URL.
const BROWSER_TTL_SECONDS = 60
const MOBILE_TTL_SECONDS = 600

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  // The mobile app can't follow the redirect: native players forward the
  // Authorization header to the redirect target, and Supabase Storage would
  // evaluate that JWT against a bucket agents have no policy for. It asks for
  // the signed URL as JSON and plays it directly instead.
  const wantsJson = new URL(req.url).searchParams.get("format") === "json"

  const { id } = await params
  const supabase = createAdminClient()
  const { data: vm } = await supabase
    .from("voicemails")
    .select("storage_path, recording_url")
    .eq("id", id)
    .maybeSingle()
  if (!vm) return Response.json({ error: "Not found" }, { status: 404 })

  // Old rows / upload fallback: the Telnyx URL, which does not expire.
  if (!vm.storage_path) {
    if (!vm.recording_url) return Response.json({ error: "No recording" }, { status: 404 })
    return wantsJson
      ? Response.json({ url: vm.recording_url, expiresAt: null })
      : Response.redirect(vm.recording_url, 307)
  }

  const ttl = wantsJson ? MOBILE_TTL_SECONDS : BROWSER_TTL_SECONDS
  const { data: signed, error } = await supabase.storage
    .from("voicemails")
    .createSignedUrl(vm.storage_path, ttl)
  if (error || !signed) {
    return Response.json({ error: "Could not sign URL" }, { status: 500 })
  }

  return wantsJson
    ? Response.json({
        url: signed.signedUrl,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      })
    : Response.redirect(signed.signedUrl, 307)
}
