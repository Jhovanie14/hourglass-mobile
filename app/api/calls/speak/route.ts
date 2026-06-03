import Telnyx from "telnyx"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const { call_control_id, text, voice = "female" } = await req.json()
  if (!call_control_id || !text) {
    return Response.json({ error: "Missing call_control_id or text" }, { status: 400 })
  }

  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })
  await telnyx.calls.actions.speak(call_control_id, {
    payload: text,
    voice,
    language: "en-US",
  })

  return Response.json({ ok: true })
}
