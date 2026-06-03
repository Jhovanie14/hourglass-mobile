import { createClient } from "@/lib/server"
import { ConversationsLayout } from "@/components/conversations/conversations-layout"
import type { Conversation, PhoneNumber } from "@/types/conversations"

type SearchParams = Promise<{ contact?: string; inbox?: string }>

export default async function ConversationsPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const { contact, inbox } = await searchParams
  const supabase = await createClient()

  const [phoneNumbersRes, conversationsRes] = await Promise.all([
    supabase
      .from("phone_numbers")
      .select("id, label, phone_number, color, is_active")
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    supabase
      .from("conversations")
      .select(
        "id, phone_number_id, contact_number, last_message_at, last_message_text, unread_count, created_at, phone_numbers(id, label, phone_number, color, is_active)"
      )
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(50),
  ])

  const phoneNumbers = (phoneNumbersRes.data ?? []) as PhoneNumber[]

  const initialConversations: Conversation[] = (
    conversationsRes.data ?? []
  ).map((c) => ({
    id: c.id,
    phone_number_id: c.phone_number_id,
    contact_number: c.contact_number,
    last_message_at: c.last_message_at,
    last_message_text: c.last_message_text,
    unread_count: c.unread_count ?? 0,
    created_at: c.created_at,
    phone_numbers: Array.isArray(c.phone_numbers)
      ? c.phone_numbers[0]
      : c.phone_numbers,
  }))

  return (
    <ConversationsLayout
      phoneNumbers={phoneNumbers}
      initialConversations={initialConversations}
      prefillContact={contact}
      prefillInbox={inbox}
    />
  )
}
