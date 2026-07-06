import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/admin"
import { isValidBearer } from "@/lib/jades/auth"
import { getJadesConfig } from "@/lib/jades/config"
import { loadJadesEvent } from "@/lib/jades/load-event"
import { parseEventsQuery } from "@/lib/jades/query"
import { supabaseDataSource } from "@/lib/jades/supabase-source"
import type { Notification } from "@/types/notifications"

const EVENT_TYPES = ["missed_call", "voicemail", "unread_message"] as const

export async function GET(req: Request): Promise<Response> {
  const config = getJadesConfig()
  if (!config.apiToken) {
    return NextResponse.json({ error: "integration not configured" }, { status: 503 })
  }
  if (!isValidBearer(req.headers.get("authorization"), config.apiToken)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const parsed = parseEventsQuery(new URL(req.url).searchParams)
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }
  const { since, limit } = parsed.value

  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, reference_id, metadata, is_read, created_at")
    .gt("created_at", since)
    .in("type", EVENT_TYPES as unknown as string[])
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit)

  if (error) {
    return NextResponse.json({ error: "query failed" }, { status: 500 })
  }

  const rows = (data ?? []) as Notification[]
  const source = supabaseDataSource(supabase)
  const events = []
  for (const n of rows) {
    const event = await loadJadesEvent(source, n)
    if (event) events.push(event)
  }

  const nextSince = rows.length > 0 ? rows[rows.length - 1].created_at : since
  return NextResponse.json({ events, next_since: nextSince })
}
