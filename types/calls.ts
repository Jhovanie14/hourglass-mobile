export type CallDirection = "inbound" | "outbound"

export type CallStatus =
  | "initiated"
  | "answered"
  | "missed"
  | "declined"
  | "completed"
  | "failed"
  | "voicemail"

export type Call = {
  id: string
  phone_number_id: string
  contact_number: string
  direction: CallDirection
  status: CallStatus
  duration_seconds: number
  telnyx_call_id: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  contact_name?: string | null
  has_voicemail?: boolean
  has_transcript?: boolean
  ai_handled?: boolean
  ai_conversation_id?: string | null
  ai_recording_path?: string | null
  phone_numbers?: {
    id: string
    label: string
    phone_number: string
    color: string
  }
}

export type Voicemail = {
  id: string
  call_id: string
  recording_url: string
  duration_seconds: number
  is_heard: boolean
  created_at: string
}

export type TranscriptSegment = {
  id: string
  call_id: string
  speaker: "agent" | "contact" | null
  transcript: string
  confidence: number | null
  occurred_at: string
  created_at: string
}

export type CallStats = {
  total: number
  answered: number
  missed: number
  avgDurationSeconds: number
}

export type PhoneNumber = {
  id: string
  label: string
  phone_number: string
  color: string
}

export type DateRange = "today" | "yesterday" | "7days" | "30days" | "all"
export type StatusFilter = "all" | "answered" | "missed" | "completed" | "failed" | "voicemail"
export type DirectionFilter = "all" | CallDirection
