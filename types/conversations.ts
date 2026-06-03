export type PhoneNumber = {
  id: string
  label: string
  phone_number: string
  color: string
  is_active: boolean
  voicemail_greeting?: string | null
}

/** Full row including timestamps — used by the admin settings page. */
export type PhoneNumberRecord = PhoneNumber & {
  created_at: string
  updated_at: string
}

export type Conversation = {
  id: string
  phone_number_id: string
  contact_number: string
  last_message_at: string | null
  last_message_text: string | null
  unread_count: number
  created_at: string
  phone_numbers?: PhoneNumber // joined
}

export type MessageDirection = "inbound" | "outbound"

export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "delivery_failed"
  | "received"

export type Message = {
  id: string
  conversation_id: string
  phone_number_id: string
  direction: MessageDirection
  body: string | null
  media_urls: string[] | null
  status: MessageStatus
  telnyx_message_id: string | null
  sent_at: string | null
  created_at: string
}
