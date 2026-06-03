export type NotificationType = "missed_call" | "unread_message"

export type NotificationMetadata = {
  contact_number: string
  phone_label: string
  phone_color?: string   // present on missed_call
  last_message?: string  // present on unread_message
}

export type Notification = {
  id: string
  type: NotificationType
  reference_id: string
  metadata: NotificationMetadata
  is_read: boolean
  created_at: string
}
