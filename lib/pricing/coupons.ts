// Live public coupons for the Bucket Baddie receptionist, resolving
// `{{ coupons }}`.
//
// THIS IS THE ONLY PART OF THE BB ASSISTANT THAT READS LIVE DATA. Everything
// else it says comes from a constant in this repo. That makes it the only thing
// that can be stale mid-call, and the only thing that can fail on the critical
// path of answering a phone, so it is built defensively:
//
//   - Off unless BB_COUPONS_ENABLED is explicitly "true". Ship dark, turn on
//     once the rest is proven (docs/bucketbaddie-ai-discovery.md decision 8).
//   - Every failure — flag off, no URL, timeout, non-2xx, malformed body —
//     returns "". An empty block makes the assistant say it has no deals to
//     hand, which is always true-enough. It never returns a cached list: a
//     stale promo is worse than no promo.
//   - Short timeout. A caller is on the line; a slow coupon read must not hold
//     up the greeting.
//
// The endpoint does not exist yet. It has to be built in the Bucket Baddie
// Laravel repo and must apply the same filter as `selectSpeakable` below, since
// this client cannot be the only thing standing between a draft coupon and a
// caller.

/** One row from the BB `coupons` table, as the endpoint should serve it. */
export type Coupon = {
  code: string
  name: string
  type: "percentage" | "fixed" | "free_item"
  /** Percent for "percentage", dollars for "fixed", null for "free_item". */
  value: number | null
  /** Product name resolved from `free_product_id`. Null unless free_item. */
  free_item_name?: string | null
  /** Lower-case day names. Null or empty means every day. */
  redeemable_weekdays?: string[] | null
  starts_at?: string | null
  expires_at?: string | null
}

/** Reading a long promo list down the phone is unusable. Three is plenty. */
export const MAX_SPOKEN_COUPONS = 3

/** Milliseconds. A caller is waiting; this is not a background job. */
export const COUPON_FETCH_TIMEOUT_MS = 1500

export type CouponsEnv = {
  BB_COUPONS_ENABLED?: string
  BB_COUPONS_URL?: string
  BB_COUPONS_TOKEN?: string
}

/**
 * Rows that may be spoken right now. The endpoint should already filter, but
 * a future-dated or expired coupon reaching a caller is a real cost, so it is
 * checked here too. Belt and braces on purpose.
 */
export function selectSpeakable(coupons: Coupon[], now: Date): Coupon[] {
  return coupons.filter((coupon) => {
    if (!coupon.code?.trim()) return false
    if (coupon.starts_at && new Date(coupon.starts_at) > now) return false
    if (coupon.expires_at && new Date(coupon.expires_at) <= now) return false
    return true
  })
}

/** "20% off", "$5.00 off", "a free Small Combo". */
function whatItGives(coupon: Coupon): string | null {
  switch (coupon.type) {
    case "percentage":
      return coupon.value === null ? null : `${coupon.value}% off`
    case "fixed":
      return coupon.value === null ? null : `$${coupon.value.toFixed(2)} off`
    case "free_item": {
      const item = coupon.free_item_name?.trim()
      return item ? `a free ${item}` : null
    }
    default:
      return null
  }
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** "Tuesdays", "Tuesdays and Wednesdays", "Fridays, Saturdays and Sundays". */
function spokenDays(days: string[]): string {
  const named = days.map((day) => `${titleCase(day.trim().toLowerCase())}s`)
  if (named.length === 1) return named[0]
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`
}

function spokenDate(iso: string, timeZone: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
  }).format(date)
}

/**
 * The coupons block. Empty string when there is nothing safe to say.
 *
 * The day restriction is rendered into the SAME sentence as the offer, never
 * as a trailing caveat. A caller who hears "twenty percent off with code
 * SUMMER" and only later "that's Tuesdays only" has already stopped listening,
 * and turns up on a Saturday expecting a discount.
 */
export function couponsText(
  coupons: Coupon[],
  now: Date,
  timeZone = "America/Chicago"
): string {
  const speakable = selectSpeakable(coupons, now)
  if (speakable.length === 0) return ""

  const lines: string[] = []
  for (const coupon of speakable.slice(0, MAX_SPOKEN_COUPONS)) {
    const gives = whatItGives(coupon)
    // A coupon we can't describe precisely is not spoken at all.
    if (!gives) continue

    const days = coupon.redeemable_weekdays?.filter((day) => day?.trim()) ?? []
    const when = days.length > 0 ? `, but only on ${spokenDays(days)}` : ""
    const until =
      coupon.expires_at && spokenDate(coupon.expires_at, timeZone)
        ? `, until ${spokenDate(coupon.expires_at, timeZone)}`
        : ""

    lines.push(`- ${gives} with code ${coupon.code.trim()}${when}${until}.`)
  }

  if (lines.length === 0) return ""

  const dropped = speakable.length - lines.length
  const header = "Current deals:"
  const footer =
    dropped > 0
      ? "There are more deals on the website — mention that rather than listing them."
      : null

  return [header, ...lines, ...(footer ? [footer] : [])].join("\n")
}

/**
 * Fetch and format, or "" on any failure. Never throws — the caller is a
 * webhook that must answer within Telnyx's window no matter what happened here.
 */
export async function fetchCouponsText(
  env: CouponsEnv,
  now: Date,
  fetchImpl: typeof fetch = fetch
): Promise<string> {
  if (env.BB_COUPONS_ENABLED?.trim().toLowerCase() !== "true") return ""

  const url = env.BB_COUPONS_URL?.trim()
  if (!url) return ""

  try {
    const res = await fetchImpl(url, {
      headers: env.BB_COUPONS_TOKEN
        ? { authorization: `Bearer ${env.BB_COUPONS_TOKEN}` }
        : {},
      signal: AbortSignal.timeout(COUPON_FETCH_TIMEOUT_MS),
    })
    if (!res.ok) {
      console.warn(`⚠️ BB coupons fetch returned ${res.status}; speaking no deals`)
      return ""
    }

    const body: unknown = await res.json()
    const rows = Array.isArray(body)
      ? body
      : Array.isArray((body as { data?: unknown })?.data)
        ? (body as { data: unknown[] }).data
        : null
    if (!rows) {
      console.warn("⚠️ BB coupons response was not a list; speaking no deals")
      return ""
    }

    return couponsText(rows as Coupon[], now)
  } catch (err) {
    console.warn("⚠️ BB coupons fetch failed; speaking no deals:", err)
    return ""
  }
}
