import { getRequestUserId } from "@/lib/auth"
import { createAdminClient } from "@/lib/admin"

export const runtime = "nodejs"

/**
 * SMS-push device registry. The mobile app POSTs its FCM token after login
 * (upsert — safe to repeat) and DELETEs it on logout. The inbound-SMS webhook
 * fans out a push to every row in agent_devices (lib/push.ts).
 */

type Body = { token?: string; platform?: string; isAvailable?: boolean }

async function parseBody(req: Request): Promise<Body | null> {
  try {
    return (await req.json()) as Body
  } catch {
    return null
  }
}

export async function POST(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const body = await parseBody(req)
  if (!body?.token) {
    return Response.json({ error: "token is required" }, { status: 400 })
  }

  const admin = createAdminClient()
  // isAvailable is only written when the caller sends it: the app's Online
  // toggle flips it, while plain token registration (login) must not clobber
  // the agent's current availability. Ring-all dials every available device
  // (see lib/telnyx/presence.ts getAvailableDeviceUserIds).
  const { error } = await admin.from("agent_devices").upsert(
    {
      user_id: userId,
      fcm_token: body.token,
      platform: body.platform ?? "android",
      ...(typeof body.isAvailable === "boolean"
        ? { is_available: body.isAvailable }
        : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "fcm_token" }
  )

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const userId = await getRequestUserId(req)
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const body = await parseBody(req)
  if (!body?.token) {
    return Response.json({ error: "token is required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("agent_devices")
    .delete()
    .eq("fcm_token", body.token)
    .eq("user_id", userId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
