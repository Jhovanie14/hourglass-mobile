export const runtime = "nodejs"

export async function GET() {
  const login = process.env.TELNYX_SIP_USERNAME
  const password = process.env.TELNYX_SIP_PASSWORD

  if (!login || !password) {
    return Response.json(
      { error: "TELNYX_SIP_USERNAME or TELNYX_SIP_PASSWORD not set" },
      { status: 500 }
    )
  }

  return Response.json({ login, password })
}
