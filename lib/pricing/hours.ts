// Weekly opening hours for AI-answered brands, and whether we are open right
// now.
//
// Pure: every function takes the instant as an argument rather than reading the
// clock, so it unit-tests in plain node without freezing time.
//
// WHY open_now IS COMPUTED HERE AND NOT LEFT TO THE ASSISTANT. "Are you open?"
// is the single most common call a restaurant gets. The assistant has no
// reliable clock, no timezone, and will happily reason its way to a confident
// wrong answer. Sending it a boolean removes the question. Every failure path
// sends `false`: telling someone we're shut when we're open costs one order,
// the reverse sends them across Houston to a locked door.

export type DayWindow = { open: string; close: string }

/** A null day is closed. "24:00" is midnight at the END of that day, so a
 *  Friday 16:00–24:00 window does not spill into Saturday. */
export type WeeklyHours = {
  monday: DayWindow | null
  tuesday: DayWindow | null
  wednesday: DayWindow | null
  thursday: DayWindow | null
  friday: DayWindow | null
  saturday: DayWindow | null
  sunday: DayWindow | null
}

export type BrandHours = {
  /** IANA zone the windows are expressed in, regardless of server timezone. */
  timeZone: string
  hours: WeeklyHours
}

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const

type Weekday = (typeof WEEKDAYS)[number]

/**
 * Mirrors `config/fulfillment.php` in the Bucket Baddie Laravel repo
 * (`store.hours`, `store.timezone`), read 2026-08-26.
 *
 * The owner confirmed these are the real store hours, not just when online
 * ordering is open. Note Monday is closed — the marketing site's "Open Daily"
 * copy contradicts this and is wrong.
 *
 * This is a hand-copy of another repo's config and will drift if that config
 * changes. There is no automated link between them.
 */
export const BUCKET_BADDIE_HOURS: BrandHours = {
  timeZone: "America/Chicago",
  hours: {
    monday: null,
    tuesday: { open: "16:00", close: "22:00" },
    wednesday: { open: "16:00", close: "22:00" },
    thursday: { open: "16:00", close: "22:00" },
    friday: { open: "16:00", close: "24:00" },
    saturday: { open: "16:00", close: "24:00" },
    sunday: { open: "16:00", close: "22:00" },
  },
}

/** "16:00" → 960. "24:00" → 1440. */
export function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map((part) => Number.parseInt(part, 10))
  return hours * 60 + minutes
}

/**
 * The instant as the store experiences it. `hourCycle: "h23"` rather than
 * `hour12: false` on purpose — the latter renders midnight as "24" on some ICU
 * builds, which would put every midnight an entire day out.
 */
function storeLocal(at: Date, timeZone: string): { weekday: Weekday; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at)

  const find = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  const weekday = find("weekday").toLowerCase() as Weekday
  return {
    weekday,
    minutes: Number.parseInt(find("hour"), 10) * 60 + Number.parseInt(find("minute"), 10),
  }
}

/**
 * Open at this instant? Inclusive of the opening minute, exclusive of the
 * closing minute — at exactly 22:00 we are shut.
 */
export function isOpenAt(brand: BrandHours, at: Date): boolean {
  const { weekday, minutes } = storeLocal(at, brand.timeZone)
  const window = brand.hours[weekday]
  if (!window) return false
  return minutes >= toMinutes(window.open) && minutes < toMinutes(window.close)
}

/**
 * The next time we open, for the "we're closed, but we're back on Tuesday at
 * 4" line. Returns null only if every day is closed.
 *
 * Today counts when we haven't opened yet. Today does NOT count once we've
 * closed, so a Tuesday 11pm caller is told about Wednesday.
 */
export function nextOpening(
  brand: BrandHours,
  at: Date
): { weekday: Weekday; opensAt: string } | null {
  const { weekday, minutes } = storeLocal(at, brand.timeZone)
  const todayIndex = WEEKDAYS.indexOf(weekday)

  for (let ahead = 0; ahead < 7; ahead++) {
    const day = WEEKDAYS[(todayIndex + ahead) % 7]
    const window = brand.hours[day]
    if (!window) continue
    if (ahead === 0 && minutes >= toMinutes(window.open)) continue
    return { weekday: day, opensAt: window.open }
  }
  return null
}

/** "16:00" → "4 PM", "22:30" → "10:30 PM", "24:00" → "midnight". */
export function spokenTime(time: string): string {
  const total = toMinutes(time)
  if (total === 0 || total === 1440) return "midnight"
  if (total === 720) return "noon"

  const hours24 = Math.floor(total / 60) % 24
  const minutes = total % 60
  const suffix = hours24 < 12 ? "AM" : "PM"
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return minutes === 0
    ? `${hours12} ${suffix}`
    : `${hours12}:${minutes.toString().padStart(2, "0")} ${suffix}`
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/**
 * The hours block handed to the assistant as `{{ hours }}`. One line per day,
 * Monday first, spoken rather than written — no 24-hour clock, because the
 * assistant reads this aloud.
 *
 * Deliberately not collapsed into ranges ("Tuesday to Thursday, 4 to 10"): a
 * caller asks about one specific day, and a per-day list is the form the
 * assistant can answer from without doing arithmetic.
 */
export function hoursText(brand: BrandHours = BUCKET_BADDIE_HOURS): string {
  const order: Weekday[] = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ]
  const lines = order.map((day) => {
    const window = brand.hours[day]
    return window
      ? `- ${titleCase(day)}: ${spokenTime(window.open)} to ${spokenTime(window.close)}.`
      : `- ${titleCase(day)}: closed.`
  })
  return ["Opening hours:", ...lines].join("\n")
}
