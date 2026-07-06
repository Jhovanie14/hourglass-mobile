// Flat event shape Jades polls for via GET /api/jades/events.
// Covers inbound AND outbound calls/SMS plus voicemails, sourced directly from
// the calls / messages / voicemails tables (not the inbound-only notifications).

export type JadesFeedType = "call" | "sms" | "voicemail"
export type JadesDirection = "inbound" | "outbound"
export type JadesFeedStatus = "missed" | "answered" | "sent" | "received"

export type JadesFeedEvent = {
  type: JadesFeedType
  direction: JadesDirection
  from: string
  to: string
  phone_label: string
  timestamp: string
  duration_sec: number | null
  transcript: string | null
  body: string | null
  status: JadesFeedStatus | null
  audio_url?: string // voicemail only — lets Jades transcribe from the recording
}

type PhoneRef = { label: string; phone_number: string }

export type CallRow = {
  contact_number: string
  direction: JadesDirection
  status: string
  duration_seconds: number
  started_at: string | null
  created_at: string
  phone: PhoneRef
}
export type MessageRow = {
  direction: JadesDirection
  body: string | null
  sent_at: string | null
  created_at: string
  contact_number: string
  phone: PhoneRef
}
export type VoicemailRow = {
  recording_url: string
  duration_seconds: number
  created_at: string
  contact_number: string
  phone: PhoneRef
}

// Inbound: the external party is `from`, our line is `to`. Outbound: reversed.
function fromTo(direction: JadesDirection, external: string, line: string): { from: string; to: string } {
  return direction === "inbound" ? { from: external, to: line } : { from: line, to: external }
}

function callStatus(status: string): JadesFeedStatus {
  return status === "answered" || status === "completed" ? "answered" : "missed"
}

export function callToFeedEvent(c: CallRow): JadesFeedEvent {
  const { from, to } = fromTo(c.direction, c.contact_number, c.phone.phone_number)
  return {
    type: "call",
    direction: c.direction,
    from,
    to,
    phone_label: c.phone.label,
    timestamp: c.started_at ?? c.created_at,
    duration_sec: c.duration_seconds,
    transcript: null,
    body: null,
    status: callStatus(c.status),
  }
}

export function messageToFeedEvent(m: MessageRow): JadesFeedEvent {
  const { from, to } = fromTo(m.direction, m.contact_number, m.phone.phone_number)
  return {
    type: "sms",
    direction: m.direction,
    from,
    to,
    phone_label: m.phone.label,
    timestamp: m.sent_at ?? m.created_at,
    duration_sec: null,
    transcript: null,
    body: m.body,
    status: m.direction === "inbound" ? "received" : "sent",
  }
}

export function voicemailToFeedEvent(v: VoicemailRow): JadesFeedEvent {
  return {
    type: "voicemail",
    direction: "inbound",
    from: v.contact_number,
    to: v.phone.phone_number,
    phone_label: v.phone.label,
    timestamp: v.created_at,
    duration_sec: v.duration_seconds,
    transcript: null,
    body: null,
    status: null,
    audio_url: v.recording_url,
  }
}

// Merge already-mapped events, order oldest→newest, cap to limit.
export function mergeFeedEvents(events: JadesFeedEvent[], limit: number): JadesFeedEvent[] {
  return [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(0, limit)
}
