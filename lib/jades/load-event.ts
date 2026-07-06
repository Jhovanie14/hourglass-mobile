import type { Notification } from "@/types/notifications"
import type { CallRef, ConversationRef, JadesEvent, MessageRef, VoicemailRef } from "./payload"
import { buildMissedCallEvent, buildSmsEvent, buildVoicemailEvent } from "./payload"

export type EventDataSource = {
  getCall(callId: string): Promise<CallRef | null>
  getVoicemailByCall(callId: string): Promise<VoicemailRef | null>
  getConversation(convId: string): Promise<ConversationRef | null>
  getLatestInboundMessage(convId: string): Promise<MessageRef | null>
}

export async function loadJadesEvent(src: EventDataSource, n: Notification): Promise<JadesEvent | null> {
  switch (n.type) {
    case "missed_call": {
      const call = await src.getCall(n.reference_id)
      return call ? buildMissedCallEvent(n, call) : null
    }
    case "voicemail": {
      const call = await src.getCall(n.reference_id)
      const vm = await src.getVoicemailByCall(n.reference_id)
      return call && vm ? buildVoicemailEvent(n, call, vm) : null
    }
    case "unread_message": {
      const conv = await src.getConversation(n.reference_id)
      const msg = await src.getLatestInboundMessage(n.reference_id)
      return conv && msg ? buildSmsEvent(n, conv, msg) : null
    }
    default:
      return null
  }
}
