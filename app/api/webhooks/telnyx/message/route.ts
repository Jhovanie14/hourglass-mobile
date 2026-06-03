import crypto from "crypto"
import { createClient } from "@/lib/server"

// Use the default Node.js runtime so `crypto` is available for Ed25519
// signature verification. Do NOT switch this to the edge runtime.
export const runtime = "nodejs"

type TelnyxWebhookBody = {
  data: {
    event_type: string
    payload: {
      id: string
      from: { phone_number: string }
      to: Array<{ phone_number: string; status?: string }>
      text: string
      type: "SMS" | "MMS"
      media?: Array<{ content_type: string; url: string }>
    }
  }
}

// Telnyx publishes a raw 32-byte Ed25519 public key (base64). Node's crypto
// needs a SPKI/DER key, so we prepend the standard Ed25519 SPKI header.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function verifyTelnyxSignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  publicKeyBase64: string
): boolean {
  if (!signatureHeader || !timestampHeader) return false

  try {
    const signedPayload = `${timestampHeader}|${rawBody}`
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        ED25519_SPKI_PREFIX,
        Buffer.from(publicKeyBase64, "base64"),
      ]),
      format: "der",
      type: "spki",
    })

    return crypto.verify(
      null,
      Buffer.from(signedPayload),
      publicKey,
      Buffer.from(signatureHeader, "base64")
    )
  } catch (error) {
    console.error("Telnyx signature verification error:", error)
    return false
  }
}

export async function POST(req: Request) {
  // Read the raw body first — signature verification needs the exact bytes
  // Telnyx signed, not a re-serialized JSON object.
  const rawBody = await req.text()

  // Step 1 — Signature verification
  const publicKey =
    process.env.TELNYX_WEBHOOK_PUBLIC_KEY ?? process.env.TELNYX_PUBLIC_KEY

  if (publicKey) {
    const signature = req.headers.get("telnyx-signature-ed25519")
    const timestamp = req.headers.get("telnyx-timestamp")

    const valid = verifyTelnyxSignature(rawBody, signature, timestamp, publicKey)
    if (!valid) {
      console.warn("⚠️ Telnyx webhook signature verification failed")
      return Response.json({ error: "Invalid signature" }, { status: 403 })
    }
  } else {
    console.warn(
      "⚠️ TELNYX_WEBHOOK_PUBLIC_KEY not set — skipping signature verification"
    )
  }

  try {
    const body = JSON.parse(rawBody) as TelnyxWebhookBody
    const { event_type, payload } = body.data

    console.log("📨 Telnyx webhook received:", event_type)

    const supabase = await createClient()

    switch (event_type) {
      case "message.received":
        await handleMessageReceived(supabase, payload)
        break
      case "message.sent":
      case "message.finalized":
        await handleStatusUpdate(supabase, payload)
        break
      default:
        console.log("ℹ️ Ignoring unhandled Telnyx event:", event_type)
    }

    // Step 5 — Always return 200 quickly so Telnyx doesn't retry.
    return Response.json({ ok: true })
  } catch (error) {
    console.error("Telnyx webhook error:", error)
    // Still return 200 to stop Telnyx from retrying indefinitely.
    return Response.json({ ok: true })
  }
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>
type TelnyxPayload = TelnyxWebhookBody["data"]["payload"]

async function handleMessageReceived(
  supabase: SupabaseClient,
  payload: TelnyxPayload
) {
  const fromNumber = payload.from.phone_number
  const toNumber = payload.to[0]?.phone_number
  const messageText = payload.text
  const telnyxMessageId = payload.id
  const mediaAttachments = payload.media ?? []

  console.log("📱 Inbound SMS from:", fromNumber, "→ to:", toNumber)
  console.log("💬 Message:", messageText)

  // Deduplication — Telnyx sometimes delivers the same webhook more than once.
  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("telnyx_message_id", telnyxMessageId)
    .maybeSingle()

  if (existing) {
    console.log("↩️ Duplicate webhook, already processed:", telnyxMessageId)
    return
  }

  // Find which of our active business numbers received the message.
  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("id, label, phone_number")
    .eq("phone_number", toNumber)
    .eq("is_active", true)
    .maybeSingle()

  if (!phoneNumber) {
    console.warn("⚠️ No active phone number matches:", toNumber)
    return
  }

  // Find or create the conversation for this contact + inbox.
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .upsert(
      {
        phone_number_id: phoneNumber.id,
        contact_number: fromNumber,
        last_message_at: new Date().toISOString(),
        last_message_text: messageText?.slice(0, 100) ?? "[Media]",
      },
      {
        onConflict: "phone_number_id,contact_number",
        ignoreDuplicates: false,
      }
    )
    .select("id")
    .single()

  if (convError || !conversation) {
    console.error("Failed to upsert conversation:", convError)
    return
  }

  const { error: msgError } = await supabase.from("messages").insert({
    conversation_id: conversation.id,
    phone_number_id: phoneNumber.id,
    direction: "inbound",
    body: messageText,
    media_urls: mediaAttachments.map((m) => m.url),
    status: "received",
    telnyx_message_id: telnyxMessageId,
    sent_at: new Date().toISOString(),
  })

  if (msgError) {
    console.error("Failed to insert message:", msgError)
    return
  }

  console.log("✅ Message saved to Supabase, conversation:", conversation.id)

  const { error: notifError } = await supabase.from("notifications").insert({
    type: "unread_message",
    reference_id: conversation.id,
    metadata: {
      contact_number: fromNumber,
      phone_label: phoneNumber.label,
      last_message: messageText?.slice(0, 60) ?? "[Media]",
    },
  })

  if (notifError) {
    console.error("⚠️ Failed to insert unread_message notification:", notifError)
  }
}

const TELNYX_STATUS_MAP: Record<string, string> = {
  delivered: "delivered",
  delivery_failed: "delivery_failed",
  sent: "sent",
}

async function handleStatusUpdate(
  supabase: SupabaseClient,
  payload: TelnyxPayload
) {
  const telnyxMessageId = payload.id
  const rawStatus = payload.to?.[0]?.status
  const finalStatus = rawStatus ? TELNYX_STATUS_MAP[rawStatus] : undefined

  // Unknown/unmapped status — leave the existing DB status untouched.
  if (!finalStatus) {
    console.log("ℹ️ No mapped status for message:", telnyxMessageId, rawStatus)
    return
  }

  const { error } = await supabase
    .from("messages")
    .update({ status: finalStatus })
    .eq("telnyx_message_id", telnyxMessageId)

  if (error) {
    console.error("Failed to update message status:", error)
    return
  }

  console.log("📊 Status update for message:", telnyxMessageId, "→", finalStatus)
}
