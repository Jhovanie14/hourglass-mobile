// Pure helpers for the AI voice agent (Telnyx AI Assistant) flow. No SDK, DB,
// or env access at module scope so it unit-tests in plain node (mirrors the
// other lib/telnyx pure modules).

export type AIAgentSettings = {
  assistantId: string
  labels: string[] // normalized upper-case phone_numbers.label values
}

/** The feature is live only when BOTH the assistant id and at least one label
 *  are configured; anything else is dormant (today's behavior everywhere). */
export function aiAgentSettings(env: {
  TELNYX_AI_ASSISTANT_ID?: string
  AI_AGENT_LABELS?: string
}): AIAgentSettings | null {
  const assistantId = env.TELNYX_AI_ASSISTANT_ID?.trim()
  if (!assistantId) return null
  const labels = (env.AI_AGENT_LABELS ?? "")
    .split(",")
    .map((label) => label.trim().toUpperCase())
    .filter(Boolean)
  if (labels.length === 0) return null
  return { assistantId, labels }
}

/** Case-insensitive membership test against phone_numbers.label. */
export function isAIAgentLabel(
  settings: AIAgentSettings | null,
  label: string | null | undefined
): boolean {
  if (!settings || !label) return false
  return settings.labels.includes(label.trim().toUpperCase())
}

/** One message from telnyx.ai.conversations.messages.list(conversation_id). */
export type ConversationMessage = {
  role: string // "user" | "assistant" | "tool"
  text?: string | null
  sent_at?: string
  created_at?: string
}

export type AITranscriptSegmentInsert = {
  speaker: "agent" | "contact"
  transcript: string
  confidence: null
  occurred_at: string
}

/**
 * Conversation history → insertable call_transcript_segments rows. The
 * assistant maps to "agent" and the caller to "contact" so the existing
 * dashboard transcript view renders AI calls unchanged. Tool calls and empty
 * texts are dropped. API order is preserved; occurred_at prefers the
 * message's own timestamps and otherwise nudges fallbackTime by the message
 * index so the dashboard's occurred_at ordering can never scramble turns.
 */
export function conversationMessagesToSegments(
  messages: ConversationMessage[],
  fallbackTime: string
): AITranscriptSegmentInsert[] {
  const fallbackMs = new Date(fallbackTime).getTime()
  return messages
    .map((message, index) => ({ message, index }))
    .filter(
      ({ message }) =>
        (message.role === "user" || message.role === "assistant") &&
        (message.text ?? "").trim() !== ""
    )
    .map(({ message, index }) => ({
      speaker: message.role === "assistant" ? ("agent" as const) : ("contact" as const),
      transcript: (message.text ?? "").trim(),
      confidence: null,
      occurred_at:
        message.sent_at ?? message.created_at ?? new Date(fallbackMs + index).toISOString(),
    }))
}
