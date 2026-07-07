"use server"

import { createAdminClient } from "@/lib/admin"
import { createClient } from "@/lib/server"
import {
  getOrCreateConversationWithClient,
  isOptedOut,
  sendMessageWithClient,
  type SendMessageInput,
  type SendResult,
} from "@/lib/messaging"
import type { Message } from "@/types/conversations"
import { isValidE164 } from "@/lib/phone"

/**
 * Sends an SMS via Telnyx and records it in the database. Thin auth wrapper —
 * the send flow itself lives in lib/messaging.ts, shared with the mobile
 * app's /api/messages/send route.
 */
export async function sendMessage(input: SendMessageInput): Promise<SendResult> {
  const supabase = await createClient()

  // Auth guard — only signed-in users can send.
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) {
    return { ok: false, error: "You must be signed in." }
  }

  return sendMessageWithClient(supabase, input)
}

/**
 * Creates a conversation for a contact+inbox if one doesn't exist, returning
 * its id. Used by the compose modal. Thin auth wrapper around the shared
 * lib/messaging.ts implementation.
 */
export async function getOrCreateConversation(
  phoneNumberId: string,
  contactNumber: string
): Promise<{ ok: true; conversationId: string } | { ok: false; error: string }> {
  const supabase = await createClient()

  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) {
    return { ok: false, error: "You must be signed in." }
  }

  return getOrCreateConversationWithClient(supabase, phoneNumberId, contactNumber)
}

export async function deleteMessage(
  messageId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return { ok: false, error: "Not signed in." }

  const { error } = await supabase
    .from("messages")
    .delete()
    .eq("id", messageId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Permanently deletes a conversation and (via the messages→conversations FK
 * cascade) all of its messages. Opt-out suppression (sms_opt_outs, keyed by
 * phone) is intentionally left untouched so a deleted contact stays suppressed.
 */
export async function deleteConversation(
  conversationId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return { ok: false, error: "Not signed in." }

  const { error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", conversationId)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function resendMessage(
  messageId: string
): Promise<SendResult> {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return { ok: false, error: "Not signed in." }

  const { data: msg } = await supabase
    .from("messages")
    .select("id, conversation_id, phone_number_id, body, direction, status")
    .eq("id", messageId)
    .single()

  if (!msg) return { ok: false, error: "Message not found." }
  if (msg.status !== "delivery_failed") return { ok: false, error: "Only failed messages can be resent." }

  const { data: conv } = await supabase
    .from("conversations")
    .select("contact_number")
    .eq("id", msg.conversation_id)
    .single()

  if (!conv) return { ok: false, error: "Conversation not found." }

  if (!isValidE164(conv.contact_number)) {
    return {
      ok: false,
      error: "Stored contact number is not a valid phone number.",
    }
  }

  // Consent guard — never resend to someone who has opted out.
  if (await isOptedOut(conv.contact_number)) {
    return { ok: false, error: "This contact has opted out of text messages." }
  }

  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("phone_number")
    .eq("id", msg.phone_number_id)
    .single()

  if (!phoneNumber) return { ok: false, error: "Phone number not found." }

  await supabase.from("messages").update({ status: "queued" }).eq("id", messageId)

  const apiKey = process.env.TELNYX_API_KEY
  if (!apiKey) return { ok: false, error: "TELNYX_API_KEY not set." }

  const res = await fetch("https://api.telnyx.com/v2/messages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: phoneNumber.phone_number,
      to: conv.contact_number,
      text: msg.body,
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => null)
    console.error(`⚠️ Telnyx resend error (${res.status}):`, JSON.stringify(errBody))
    await supabase.from("messages").update({ status: "delivery_failed" }).eq("id", messageId)
    return { ok: false, error: `Telnyx error (${res.status}).` }
  }

  const json = (await res.json()) as { data?: { id?: string } }
  const { data: updated } = await supabase
    .from("messages")
    .update({
      status: "sent",
      telnyx_message_id: json.data?.id ?? null,
      sent_at: new Date().toISOString(),
    })
    .eq("id", messageId)
    .select("id, conversation_id, phone_number_id, direction, body, media_urls, status, telnyx_message_id, sent_at, created_at")
    .single()

  return { ok: true, message: updated as Message }
}

/**
 * Manually opt a contact out of (or back into) texts — for opt-out requests
 * made by voice or in person, which Telnyx never sees. Recording an opt-out
 * here makes sendMessage/resendMessage refuse that number.
 */
export async function setContactOptOut(
  phone: string,
  optedOut: boolean
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) return { ok: false, error: "Not signed in." }

  const admin = createAdminClient()

  if (optedOut) {
    const { error } = await admin.from("sms_opt_outs").upsert(
      { phone, source: "voice:agent", note: "Opt-out recorded by agent" },
      { onConflict: "phone", ignoreDuplicates: true }
    )
    if (error) return { ok: false, error: error.message }
    return { ok: true }
  }

  const { error } = await admin.from("sms_opt_outs").delete().eq("phone", phone)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

