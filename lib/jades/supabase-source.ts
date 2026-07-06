import type { SupabaseClient } from "@supabase/supabase-js"
import type { EventDataSource } from "./load-event"

type PhoneJoin = { label: string; phone_number: string } | null

export function supabaseDataSource(supabase: SupabaseClient): EventDataSource {
  return {
    async getCall(callId) {
      const { data } = await supabase
        .from("calls")
        .select("id, contact_number, duration_seconds, started_at, phone_numbers(label, phone_number)")
        .eq("id", callId)
        .single()
      if (!data) return null
      const pn = data.phone_numbers as unknown as PhoneJoin
      if (!pn) return null
      return {
        id: data.id,
        contact_number: data.contact_number,
        duration_seconds: data.duration_seconds,
        started_at: data.started_at,
        phone: { label: pn.label, phone_number: pn.phone_number },
      }
    },

    async getVoicemailByCall(callId) {
      const { data } = await supabase
        .from("voicemails")
        .select("id, recording_url, duration_seconds")
        .eq("call_id", callId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) return null
      return { id: data.id, recording_url: data.recording_url, duration_seconds: data.duration_seconds }
    },

    async getConversation(convId) {
      const { data } = await supabase
        .from("conversations")
        .select("id, contact_number, phone_numbers(label, phone_number)")
        .eq("id", convId)
        .single()
      if (!data) return null
      const pn = data.phone_numbers as unknown as PhoneJoin
      if (!pn) return null
      return {
        id: data.id,
        contact_number: data.contact_number,
        phone: { label: pn.label, phone_number: pn.phone_number },
      }
    },

    async getLatestInboundMessage(convId) {
      const { data } = await supabase
        .from("messages")
        .select("id, body, media_urls")
        .eq("conversation_id", convId)
        .eq("direction", "inbound")
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) return null
      return { id: data.id, body: data.body, media_urls: data.media_urls }
    },
  }
}
