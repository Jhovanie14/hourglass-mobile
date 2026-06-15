// THROWAWAY SPIKE — validates that a Call Control app can ring + bridge the
// WebRTC SIP credential. Delete after Task 0 passes. No DB, no auth, no signature.
import Telnyx from "telnyx"

export const runtime = "nodejs"

type Payload = {
  call_control_id: string
  from: string
  to: string
  direction: "incoming" | "outgoing"
  client_state?: string | null
}

export async function POST(req: Request) {
  const body = (await req.json()) as { data: { event_type: string; payload: Payload } }
  const { event_type, payload } = body.data
  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })
  const ccid = payload.call_control_id

  console.log("🧪 SPIKE", event_type, {
    direction: payload.direction,
    from: payload.from,
    to: payload.to,
    client_state: payload.client_state,
  })

  try {
    // 1) Inbound caller leg arrives parked → answer it.
    if (event_type === "call.initiated" && payload.direction === "incoming") {
      await telnyx.calls.actions.answer(ccid, {})
    }

    // 2) Caller answered → dial the WebRTC SIP credential as leg B, carrying
    //    leg A's id in client_state so we can bridge when B answers.
    if (event_type === "call.answered" && payload.direction === "incoming") {
      const clientState = Buffer.from(JSON.stringify({ aLegId: ccid })).toString("base64")
      await telnyx.calls.dial({
        connection_id: process.env.TELNYX_VOICE_APP_ID!,
        to: `sip:${process.env.TELNYX_SIP_USERNAME}@sip.telnyx.com`,
        from: payload.from,
        timeout_secs: 25,
        client_state: clientState,
      })
    }

    // 3) Agent (leg B) answered → bridge to the caller (leg A).
    if (event_type === "call.answered" && payload.direction === "outgoing" && payload.client_state) {
      const { aLegId } = JSON.parse(Buffer.from(payload.client_state, "base64").toString("utf8"))
      await telnyx.calls.actions.bridge(aLegId, { call_control_id_to_bridge_with: ccid })
      console.log("🧪 SPIKE bridged", { aLegId, bLegId: ccid })
    }
  } catch (err) {
    console.error("🧪 SPIKE error:", err)
  }

  return Response.json({ ok: true })
}
