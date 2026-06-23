// Shared SMS opt-in consent text + validation.
//
// The consent language and version live here so the public form, the API route
// that records the consent, and any future audit all reference the SAME wording.
// When you change CONSENT_TEXT, bump CONSENT_VERSION — stored records keep the
// exact text the subscriber agreed to.

export const CONSENT_VERSION = "2026-06-24"

// The literal SMS opt-in language shown next to the consent checkbox. Carriers
// require: brand name, program/message types, frequency, "msg & data rates",
// and STOP/HELP instructions. Keep this in sync with /sms-terms.
export const CONSENT_TEXT =
  "By checking this box and providing my phone number, I agree to receive " +
  "recurring SMS text messages (account and service updates and two-way " +
  "customer-care conversations) from Hourglass Investments LLC at the number " +
  "provided, including messages sent by an automated system. Consent is not a " +
  "condition of any purchase. Message frequency varies. Message and data rates " +
  "may apply. Reply STOP to opt out, HELP for help."

// Carrier-standard opt-out / opt-in keywords. Telnyx auto-handles these at the
// network level; we detect them too so we can mirror the suppression into our
// own DB for team visibility.
const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
])
const START_KEYWORDS = new Set(["START", "UNSTOP"])

// A message counts as a STOP/START only if the whole message is the keyword
// (optionally with surrounding whitespace/punctuation) — matching carrier
// behavior, so "please don't stop helping me" is NOT treated as an opt-out.
function normalizeKeyword(text: string): string {
  return text.trim().replace(/[.!?,]+$/, "").toUpperCase()
}

export function isStopKeyword(text: string): boolean {
  return STOP_KEYWORDS.has(normalizeKeyword(text))
}

export function isStartKeyword(text: string): boolean {
  return START_KEYWORDS.has(normalizeKeyword(text))
}

export type OptInInput = {
  name?: unknown
  phone?: unknown
  consent?: unknown
}

export type OptInResult =
  | { ok: true; value: { name: string; phone: string } }
  | { ok: false; errors: Record<string, string> }

// Normalize a US phone number to E.164 (+1XXXXXXXXXX). Returns null if the
// input does not look like a valid US number.
export function normalizeUsPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "")
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`
  return null
}

export function validateOptIn(input: OptInInput): OptInResult {
  const errors: Record<string, string> = {}

  const name = typeof input.name === "string" ? input.name.trim() : ""
  if (name.length < 2) {
    errors.name = "Please enter your name."
  }

  const phoneRaw = typeof input.phone === "string" ? input.phone.trim() : ""
  const phone = phoneRaw ? normalizeUsPhone(phoneRaw) : null
  if (!phone) {
    errors.phone = "Please enter a valid US mobile number."
  }

  // The box must be explicitly checked — consent cannot be assumed.
  if (input.consent !== true) {
    errors.consent = "You must agree to receive text messages to continue."
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors }
  }

  return { ok: true, value: { name, phone: phone! } }
}
