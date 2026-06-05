"use server"

import { createClient } from "@/lib/server"
import type { Message } from "@/types/conversations"

type SendMessageInput = {
  conversationId: string
  phoneNumberId: string
  to: string
  body: string
}

type SendResult =
  | { ok: true; message: Message }
  | { ok: false; error: string }

/**
 * Sends an SMS via Telnyx and records it in the database.
 *
 * Flow:
 * 1. Insert the message row as `queued` (so it shows immediately).
 * 2. Attempt to send via Telnyx.
 * 3. Update the row to `sent` (+ telnyx id) or `delivery_failed`.
 *
 * If TELNYX_API_KEY is not configured, the message stays `queued` and a
 * warning is logged — no error is thrown.
 */
export async function sendMessage(input: SendMessageInput): Promise<SendResult> {
  const { conversationId, phoneNumberId, to, body } = input

  const trimmed = body.trim()
  if (!trimmed) {
    return { ok: false, error: "Message body is empty." }
  }

  const supabase = await createClient()

  // Auth guard — only signed-in users can send.
  const { data: claims } = await supabase.auth.getClaims()
  if (!claims?.claims) {
    return { ok: false, error: "You must be signed in." }
  }

  // The number we send FROM (the inbox's own phone number).
  const { data: phoneNumber, error: pnError } = await supabase
    .from("phone_numbers")
    .select("phone_number")
    .eq("id", phoneNumberId)
    .single()

  if (pnError || !phoneNumber) {
    return { ok: false, error: "Could not resolve sending number." }
  }

  // 1. Insert as queued.
  const { data: inserted, error: insertError } = await supabase
    .from("messages")
    .insert({
      conversation_id: conversationId,
      phone_number_id: phoneNumberId,
      direction: "outbound",
      body: trimmed,
      status: "queued",
    })
    .select(
      "id, conversation_id, phone_number_id, direction, body, media_urls, status, telnyx_message_id, sent_at, created_at"
    )
    .single()

  if (insertError || !inserted) {
    return { ok: false, error: insertError?.message ?? "Failed to save message." }
  }

  const message = inserted as Message
  const apiKey = process.env.TELNYX_API_KEY

  // 2. No API key configured — leave queued, warn, return.
  if (!apiKey) {
    console.warn(
      "[sendMessage] TELNYX_API_KEY not set — message left as 'queued' and not actually sent."
    )
    await touchConversation(supabase, conversationId, trimmed)
    return { ok: true, message }
  }

  // 3. Send via Telnyx.
  try {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: phoneNumber.phone_number,
        to,
        text: trimmed,
      }),
    })

    if (!res.ok) {
      const errBody = await res.json().catch(() => null)
      console.error(`⚠️ Telnyx SMS error (${res.status}):`, JSON.stringify(errBody))
      await supabase
        .from("messages")
        .update({ status: "delivery_failed" })
        .eq("id", message.id)
      return { ok: false, error: `Telnyx error (${res.status}).` }
    }

    const json = (await res.json()) as { data?: { id?: string } }
    const telnyxId = json.data?.id ?? null

    const { data: updated } = await supabase
      .from("messages")
      .update({
        status: "sent",
        telnyx_message_id: telnyxId,
        sent_at: new Date().toISOString(),
      })
      .eq("id", message.id)
      .select(
        "id, conversation_id, phone_number_id, direction, body, media_urls, status, telnyx_message_id, sent_at, created_at"
      )
      .single()

    await touchConversation(supabase, conversationId, trimmed)
    return { ok: true, message: (updated as Message) ?? message }
  } catch (err) {
    await supabase
      .from("messages")
      .update({ status: "delivery_failed" })
      .eq("id", message.id)
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Network error sending message.",
    }
  }
}

/**
 * Creates a conversation for a contact+inbox if one doesn't exist, returning
 * its id. Used by the compose modal.
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

  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("phone_number_id", phoneNumberId)
    .eq("contact_number", contactNumber)
    .maybeSingle()

  if (existing?.id) {
    return { ok: true, conversationId: existing.id }
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({
      phone_number_id: phoneNumberId,
      contact_number: contactNumber,
      unread_count: 0,
    })
    .select("id")
    .single()

  if (error || !created) {
    return { ok: false, error: error?.message ?? "Failed to create conversation." }
  }

  return { ok: true, conversationId: created.id }
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

async function touchConversation(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  lastText: string
) {
  await supabase
    .from("conversations")
    .update({
      last_message_at: new Date().toISOString(),
      last_message_text: lastText,
    })
    .eq("id", conversationId)
}
