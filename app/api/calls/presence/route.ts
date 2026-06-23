import { getRequestUserId } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"
import { recordHeartbeat, expirePresence } from "@/lib/telnyx/presence"

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

/**
 * Manual "go offline" — the WebRTC client calls this when the agent toggles
 * Offline. Deletes the agent's presence row so ring-all skips them immediately.
 */
export async function DELETE(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const admin = createAdminClient()
    await expirePresence(admin, userId)
    return Response.json({ ok: true })
  } catch (err) {
    console.error("⚠️ Failed to expire presence:", err)
    return Response.json({ error: "Failed to expire presence" }, { status: 500 })
  }
}
