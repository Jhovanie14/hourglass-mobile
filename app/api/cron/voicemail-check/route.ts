import { createAdminClient } from "@/lib/admin"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret")
  if (!process.env.CRON_SECRET) {
    console.error("⚠️ CRON_SECRET env var is not set — cron route disabled")
    return Response.json({ error: "Server misconfiguration" }, { status: 500 })
  }
  if (secret !== process.env.CRON_SECRET) {
    console.warn("⚠️ voicemail-check: unauthorized request")
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = createAdminClient()

  const threshold = new Date(Date.now() - 15_000).toISOString()

  const { data: staleCalls, error: fetchError } = await supabase
    .from("calls")
    .select("id")
    .eq("status", "initiated")
    .eq("direction", "inbound")
    .lt("created_at", threshold)
    .limit(20)

  if (fetchError) {
    console.error("⚠️ voicemail-check: failed to fetch stale calls", fetchError)
    return Response.json({ error: "DB error" }, { status: 500 })
  }

  console.log(`🔍 voicemail-check: found ${staleCalls?.length ?? 0} stale initiated calls`)

  if (!staleCalls || staleCalls.length === 0) {
    return Response.json({ ok: true, cleaned: 0 })
  }

  // These are calls stuck in "initiated" with no active Telnyx leg — mark as missed
  const ids = staleCalls.map((c) => c.id)
  await supabase.from("calls").update({ status: "missed" }).in("id", ids).eq("status", "initiated")

  console.log(`🧹 Cleaned up ${ids.length} stale initiated calls → missed`)
  return Response.json({ ok: true, cleaned: ids.length })
}
