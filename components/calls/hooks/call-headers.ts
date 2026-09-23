// components/calls/hooks/call-headers.ts

/**
 * Read a custom SIP header off a Telnyx WebRTC call. dialAgentLeg sets them on
 * every inbound ring-all leg (X-Caller-Number, X-Line-Label, X-Line-Number);
 * outbound legs carry none. Case-insensitive; null when absent or empty.
 */
export function sipHeader(call: unknown, name: string): string | null {
  const headers = (call as { options?: { customHeaders?: unknown } } | null)?.options
    ?.customHeaders as Array<{ name?: string; value?: string }> | undefined
  if (!Array.isArray(headers)) return null
  const wanted = name.toLowerCase()
  const match = headers.find((h) => h.name?.toLowerCase() === wanted)
  return match?.value || null
}

/**
 * The business line an inbound leg came in on (e.g. Bucket Baddie), straight
 * from the headers the voice webhook stamped on it — no DB lookup, so no RLS
 * and no race. Null when the headers are missing (older server, outbound leg).
 */
export function lineFromHeaders(
  call: unknown
): { label: string; phone_number: string } | null {
  const label = sipHeader(call, "X-Line-Label")
  const phoneNumber = sipHeader(call, "X-Line-Number")
  if (!label || !phoneNumber) return null
  return { label, phone_number: phoneNumber }
}
