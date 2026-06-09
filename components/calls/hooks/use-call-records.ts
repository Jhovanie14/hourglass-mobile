// components/calls/hooks/use-call-records.ts
"use client"

import { useMemo } from "react"
import { createClient } from "@/lib/client"

type InboundRecord = {
  callId: string
  phoneNumber: { label: string; phone_number: string }
}

export function useCallRecords() {
  const supabase = useMemo(() => createClient(), [])

  async function insertInbound(
    callerNumber: string,
    rawDestination: string,
    telnyxCallControlId?: string
  ): Promise<InboundRecord | null> {
    // Normalize to E.164: strip non-digits, prepend "+"
    const digits = rawDestination.replace(/\D/g, "")
    const normalized = digits ? `+${digits}` : rawDestination

    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("id, label, phone_number")
      .eq("phone_number", normalized)
      .eq("is_active", true)
      .maybeSingle()

    if (!phoneNumber) {
      console.warn("⚠️ [call-records] No active phone number for destination:", normalized)
      return null
    }

    const { data: call, error } = await supabase
      .from("calls")
      .insert({
        phone_number_id: phoneNumber.id,
        contact_number: callerNumber,
        direction: "inbound",
        status: "initiated",
        ...(telnyxCallControlId && { telnyx_call_id: telnyxCallControlId }),
      })
      .select("id")
      .single()

    if (error) {
      console.error("⚠️ [call-records] Failed to insert inbound call:", error)
      return null
    }

    return {
      callId: call.id,
      phoneNumber: { label: phoneNumber.label, phone_number: phoneNumber.phone_number },
    }
  }

  async function insertOutbound(phoneNumberId: string, to: string): Promise<string | null> {
    const { data: call, error } = await supabase
      .from("calls")
      .insert({
        phone_number_id: phoneNumberId,
        contact_number: to,
        direction: "outbound",
        status: "initiated",
      })
      .select("id")
      .single()

    if (error) {
      console.error("⚠️ [call-records] Failed to insert outbound call:", error)
      return null
    }

    return call.id
  }

  async function markAnswered(callId: string, startedAt: string): Promise<void> {
    const { error } = await supabase
      .from("calls")
      .update({ status: "answered", started_at: startedAt })
      .eq("id", callId)

    if (error) console.error("⚠️ [call-records] Failed to mark answered:", error)
  }

  async function markCompleted(callId: string, startedAt: string): Promise<void> {
    const endedAt = new Date().toISOString()
    const durationSeconds = Math.round(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000
    )
    const { error } = await supabase
      .from("calls")
      .update({ status: "completed", ended_at: endedAt, duration_seconds: durationSeconds })
      .eq("id", callId)

    if (error) console.error("⚠️ [call-records] Failed to mark completed:", error)
  }

  async function markMissed(callId: string): Promise<void> {
    const { error } = await supabase
      .from("calls")
      .update({ status: "missed", ended_at: new Date().toISOString() })
      .eq("id", callId)

    if (error) console.error("⚠️ [call-records] Failed to mark missed:", error)
  }

  async function markFailed(callId: string): Promise<void> {
    const { error } = await supabase
      .from("calls")
      .update({ status: "failed", ended_at: new Date().toISOString() })
      .eq("id", callId)

    if (error) console.error("⚠️ [call-records] Failed to mark failed:", error)
  }

  return { insertInbound, insertOutbound, markAnswered, markCompleted, markMissed, markFailed }
}
