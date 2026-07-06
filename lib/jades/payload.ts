import type { Notification } from "@/types/notifications"

export type JadesEventType = "missed_call" | "voicemail" | "new_sms"

type Envelope<T> = {
  event_id: string
  type: JadesEventType
  occurred_at: string
  property: string
  property_line: string
  data: T
}

export type MissedCallData = {
  caller_number: string
  caller_name: null
  duration_seconds: number
  started_at: string | null
  call_id: string
}
export type VoicemailData = {
  caller_number: string
  caller_name: null
  audio_url: string
  transcription: null
  duration_seconds: number
  voicemail_id: string
  call_id: string
}
export type SmsData = {
  from_number: string
  to_number: string
  body: string | null
  media_urls: string[]
  read: boolean
  message_id: string
  conversation_id: string
}
export type JadesEvent =
  | Envelope<MissedCallData>
  | Envelope<VoicemailData>
  | Envelope<SmsData>

// Minimal joined-row inputs the builders consume:
export type PhoneRef = { label: string; phone_number: string }
export type CallRef = {
  id: string
  contact_number: string
  duration_seconds: number
  started_at: string | null
  phone: PhoneRef
}
export type VoicemailRef = { id: string; recording_url: string; duration_seconds: number }
export type ConversationRef = { id: string; contact_number: string; phone: PhoneRef }
export type MessageRef = { id: string; body: string | null; media_urls: string[] | null }

export function buildMissedCallEvent(n: Notification, call: CallRef): JadesEvent {
  return {
    event_id: n.id,
    type: "missed_call",
    occurred_at: n.created_at,
    property: call.phone.label,
    property_line: call.phone.phone_number,
    data: {
      caller_number: call.contact_number,
      caller_name: null,
      duration_seconds: call.duration_seconds,
      started_at: call.started_at,
      call_id: call.id,
    },
  }
}

export function buildVoicemailEvent(n: Notification, call: CallRef, vm: VoicemailRef): JadesEvent {
  return {
    event_id: n.id,
    type: "voicemail",
    occurred_at: n.created_at,
    property: call.phone.label,
    property_line: call.phone.phone_number,
    data: {
      caller_number: call.contact_number,
      caller_name: null,
      audio_url: vm.recording_url,
      transcription: null,
      duration_seconds: vm.duration_seconds,
      voicemail_id: vm.id,
      call_id: call.id,
    },
  }
}

export function buildSmsEvent(n: Notification, conv: ConversationRef, msg: MessageRef): JadesEvent {
  return {
    event_id: n.id,
    type: "new_sms",
    occurred_at: n.created_at,
    property: conv.phone.label,
    property_line: conv.phone.phone_number,
    data: {
      from_number: conv.contact_number,
      to_number: conv.phone.phone_number,
      body: msg.body,
      media_urls: msg.media_urls ?? [],
      read: n.is_read,
      message_id: msg.id,
      conversation_id: conv.id,
    },
  }
}
