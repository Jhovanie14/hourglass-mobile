import { cert, getApps, initializeApp } from "firebase-admin/app"
import { getMessaging } from "firebase-admin/messaging"
import type { SupabaseClient } from "@supabase/supabase-js"

type Db = SupabaseClient<any, any, any>

/**
 * Lazily init firebase-admin from the base64-encoded service account JSON
 * (same Firebase project as the Telnyx voice push credential). Returns false
 * (push disabled) when the env var is missing so local dev keeps working.
 */
function ensureFirebase(): boolean {
  if (getApps().length) return true
  const b64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64
  if (!b64) {
    console.warn("FIREBASE_SERVICE_ACCOUNT_BASE64 not set — SMS push disabled")
    return false
  }
  initializeApp({
    credential: cert(JSON.parse(Buffer.from(b64, "base64").toString("utf8"))),
  })
  return true
}

type FcmResponse = { success: boolean; error?: { code?: string } | null }

/** Indexes of tokens FCM reports as permanently dead (pure — unit tested). */
export function invalidTokenIndexes(responses: FcmResponse[]): number[] {
  const permanent = new Set([
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
  ])
  return responses.flatMap((r, i) =>
    !r.success && r.error?.code && permanent.has(r.error.code) ? [i] : []
  )
}

type SmsPushInput = { conversationId: string; title: string; body: string }

/**
 * Data-only push to every registered agent device. Data-only (no
 * `notification` field) so the app's FirebaseMessagingService always gets
 * onMessageReceived — even backgrounded/killed — and renders it natively.
 * Never throws: push failure must not fail the Telnyx webhook.
 */
export async function sendSmsPushToAgents(
  admin: Db,
  input: SmsPushInput
): Promise<void> {
  try {
    if (!ensureFirebase()) return

    const { data: devices } = await admin
      .from("agent_devices")
      .select("fcm_token")
    const tokens = (devices ?? []).map(
      (d: { fcm_token: string }) => d.fcm_token
    )
    if (tokens.length === 0) return

    const res = await getMessaging().sendEachForMulticast({
      tokens,
      android: { priority: "high" },
      data: {
        type: "sms",
        conversation_id: input.conversationId,
        title: input.title,
        body: input.body,
      },
    })

    const stale = invalidTokenIndexes(res.responses as FcmResponse[]).map(
      (i) => tokens[i]
    )
    if (stale.length > 0) {
      await admin.from("agent_devices").delete().in("fcm_token", stale)
      console.log("🧹 Removed dead FCM tokens:", stale.length)
    }
    console.log(`📤 SMS push sent to ${tokens.length} device(s)`)
  } catch (err) {
    console.error("⚠️ SMS push fan-out failed:", err)
  }
}
