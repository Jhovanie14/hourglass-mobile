import Telnyx from "telnyx"
import { createClient } from "@/lib/server"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { call_control_id } = await req.json()
  if (!call_control_id) {
    return Response.json({ error: "Missing call_control_id" }, { status: 400 })
  }

  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })
  await telnyx.calls.actions.reject(call_control_id, { cause: "USER_BUSY" })

  const supabase = await createClient()
  await supabase
    .from("calls")
    .update({ status: "missed", ended_at: new Date().toISOString() })
    .eq("telnyx_call_id", call_control_id)

  return Response.json({ ok: true })
}
