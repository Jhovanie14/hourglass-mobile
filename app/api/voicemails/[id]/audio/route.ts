import { getCurrentUser } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"

export const runtime = "nodejs"

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const supabase = createAdminClient()
  const { data: vm } = await supabase
    .from("voicemails")
    .select("storage_path, recording_url")
    .eq("id", id)
    .maybeSingle()
  if (!vm) return Response.json({ error: "Not found" }, { status: 404 })

  // Old rows / upload fallback: redirect to the Telnyx URL.
  if (!vm.storage_path) {
    if (!vm.recording_url) return Response.json({ error: "No recording" }, { status: 404 })
    return Response.redirect(vm.recording_url, 307)
  }

  const { data: signed, error } = await supabase.storage
    .from("voicemails")
    .createSignedUrl(vm.storage_path, 60)
  if (error || !signed) {
    return Response.json({ error: "Could not sign URL" }, { status: 500 })
  }
  return Response.redirect(signed.signedUrl, 307)
}
