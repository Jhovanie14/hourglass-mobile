/**
 * Save (create or rename) a contact via the existing POST /api/contacts.
 * On the dashboard, same-origin cookies authenticate the request; in the
 * extension panel, pass the Supabase access token for Bearer auth.
 */
export async function saveContact(
  input: { phoneNumberId: string; contactNumber: string; name: string },
  accessToken?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" }
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`

  let res: Response
  try {
    res = await fetch("/api/contacts", {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
  } catch {
    return { ok: false, error: "Network error. Please try again." }
  }

  if (res.ok) return { ok: true }
  const body = await res.json().catch(() => ({}))
  return { ok: false, error: body.error ?? "Failed to save contact." }
}
