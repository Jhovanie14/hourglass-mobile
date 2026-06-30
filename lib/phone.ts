import { isValidPhoneNumber } from "libphonenumber-js"

/**
 * Returns true only when `value` is a complete, valid international phone
 * number in E.164 form (e.g. "+12109348999"). Used by both the compose UI
 * and the server send actions so Telnyx never receives a malformed `to`
 * address (Telnyx error 40310).
 *
 * libphonenumber-js treats a string as international only when it starts
 * with "+", so national-format inputs (no "+") correctly return false.
 */
export function isValidE164(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    return isValidPhoneNumber(value)
  } catch {
    return false
  }
}
