import Telnyx from "telnyx"

export const runtime = "nodejs"

export async function GET() {
  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })
  const credentialId = process.env.TELNYX_TELEPHONY_CREDENTIAL_ID

  // First run: no credential yet — create one and tell the user to save the ID
  if (!credentialId) {
    const connectionId = process.env.TELNYX_CREDENTIAL_CONNECTION_ID
    if (!connectionId) {
      return Response.json(
        { error: "TELNYX_CREDENTIAL_CONNECTION_ID not set" },
        { status: 500 }
      )
    }

    const credential = await telnyx.telephonyCredentials.create({
      connection_id: connectionId,
      name: "hourglass-webrtc",
    })

    console.log("✅ Telephony credential created. Add this to .env.local:")
    console.log(`TELNYX_TELEPHONY_CREDENTIAL_ID=${credential.data?.id}`)

    return Response.json(
      {
        error: "Credential created. Add TELNYX_TELEPHONY_CREDENTIAL_ID to .env.local and restart.",
        credential_id: credential.data?.id,
      },
      { status: 503 }
    )
  }

  // Normal flow: generate a short-lived JWT from the stored credential
  const token = await telnyx.telephonyCredentials.createToken(credentialId)

  return Response.json({ token })
}
