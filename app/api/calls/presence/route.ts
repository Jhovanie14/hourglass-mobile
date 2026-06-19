import { getRequestUserId } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"
import { recordHeartbeat } from "@/lib/telnyx/presence"

export const runtime = "nodejs"

/**
 * Presence heartbeat. The WebRTC client POSTs here every ~15s while connected;
 * each call refreshes the authenticated agent's `agent_presence.last_seen_at`.
 * No explicit "offline" call — staleness (>30s) drops the agent from the online
 * set used by the ring-all fan-out (Phase 3).
 */
export async function POST(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    await recordHeartbeat(admin, userId)
    return Response.json({ ok: true })
  } catch (err) {
    console.error("⚠️ Failed to record presence heartbeat:", err)
    return Response.json({ error: "Failed to record presence" }, { status: 500 })
  }
}
