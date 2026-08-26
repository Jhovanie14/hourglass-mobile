// The Launch Pad pricing, as spoken by the AI receptionist.
//
// Source of truth today is a hand-maintained copy of the ecosystem site's
// `service_packages` table (exported 2026-08-18) plus the membership tiers from
// the marketing site. Pure data + formatting only — no DB or env access — so it
// unit-tests in plain node.
//
// ONLY ACTIVE SERVICES BELONG HERE. The source table mixes live rows with
// scratch data, including a `test wash` priced at $1.00 and rows with junk
// feature text. Anything with `is_active = false` is deliberately omitted, and
// lib/tlp-pricing.test.ts asserts none of them creep back in.
//
// When the ecosystem booking integration lands, replace the constant below with
// a read of the live table filtered on `is_active` — `pricingText()` keeps the
// same shape, so the assistant needs no change.

export type Membership = {
  name: string
  monthlyPrice: number
  /** Price for a first-time member (10% off). Null where no discount applies. */
  firstTimePrice: number | null
  includes: string[]
  notes: string[]
}

export type OneTimeService = {
  name: string
  price: number
  /** Null where no time is published — the assistant then states no duration
   *  rather than inventing one. */
  durationMinutes: number | null
  includes: string[]
  excludes: string[]
}

export type BrandPricing = {
  brand: string
  memberships: Membership[]
  oneTimeServices: OneTimeService[]
  /** Vehicle types that cannot use the personal tiers and need Commercial Wash. */
  commercialVehicleTypes: string[]
  vehiclePolicy: string
  discountPolicy: string
}

export const TLP_PRICING: BrandPricing = {
  brand: "The Launch Pad",

  memberships: [
    {
      name: "Quick Service",
      monthlyPrice: 39.99,
      firstTimePrice: 35.99,
      includes: [
        "Hand wash exterior",
        "Wheels and tires shine",
        "Towel dry",
        "Unlimited washes",
      ],
      notes: ["Exterior only"],
    },
    {
      name: "Express Detail",
      monthlyPrice: 59.99,
      firstTimePrice: 53.99,
      includes: [
        "Everything in Quick Service",
        "Interior vacuum",
        "Interior wipe-down",
        "Windows cleaned",
        "Unlimited washes",
      ],
      notes: ["Inside and outside", "About $1.80 a day"],
    },
    {
      name: "Commercial Wash",
      monthlyPrice: 89.99,
      firstTimePrice: 80.99,
      // EXTERIOR ONLY — deliberately excludes the interior items that appear in
      // the source marketing bullets. Those bullets are byte-identical to the
      // Express Detail tier's and contradict this plan's own prose ("Express
      // exterior wash … hand wash, wheels & tires shine, towel dry"), so they
      // read as a copy-paste error. Until the client confirms, promise the
      // lesser service: under-delivering on a quote is recoverable, an
      // over-promise at the till is not. See lib/tlp-pricing.test.ts.
      includes: [
        "Hand wash exterior",
        "Wheels and tires shine",
        "Towel dry",
        "Unlimited washes",
      ],
      notes: [
        "Exterior only",
        "About $2.70 a day",
        "Built for commercial vehicles — tow trucks, 8 ft and 9 ft bed trucks, sprinter vans",
      ],
    },
    {
      name: "Self-Service Bay",
      monthlyPrice: 19.99,
      firstTimePrice: null,
      includes: [
        "One wash per day at any Self-Service Bay location",
        "Up to 10 minutes per bay use",
        "Access to self-service equipment",
      ],
      notes: [
        "About $0.67 a day",
        "One vehicle per membership",
        // Replaced 2026-08-27: the source site said "9:00 AM to 6:30 PM", the
        // owner says the bays run 24/7. Same physical bays as the pay-per-use
        // entry below, so both say the same thing.
        "Bays are open 24 hours a day, 7 days a week",
        "Vacuum is not included",
        "Not valid for detailing services",
      ],
    },
  ],

  oneTimeServices: [
    {
      name: "Quick Exterior Wash",
      price: 25.0,
      durationMinutes: 15,
      includes: ["Hand wash", "Rinse", "Towel dry"],
      excludes: ["No tire shine", "No wax", "No paint enhancement"],
    },
    {
      name: "Quick Interior Refresh",
      price: 25.0,
      durationMinutes: 15,
      includes: ["Light vacuum of floor areas", "Quick dashboard wipe"],
      excludes: [
        "No window shine",
        "No door panels",
        "No center console",
        "No seats",
        "No deep interior cleaning",
      ],
    },
    {
      name: "Classic Complete",
      price: 45.0,
      durationMinutes: 30,
      includes: ["Quick Exterior Wash", "Quick Interior Refresh"],
      excludes: ["No detailing enhancements"],
    },
    {
      name: "Express Exterior Detail",
      price: 40.0,
      durationMinutes: 20,
      includes: ["Hand wash", "Tire shine", "Spray wax application"],
      excludes: [],
    },
    {
      name: "Express Interior Detail",
      price: 40.0,
      durationMinutes: 25,
      includes: [
        "Complete vacuum of all interior areas",
        "Dashboard wipe-down",
        "Center console",
        "Door panels",
        "Interior windows cleaned",
      ],
      excludes: [],
    },
    {
      name: "Express Complete Detail",
      price: 65.0,
      durationMinutes: 45,
      includes: ["Express Exterior Detail", "Express Interior Detail"],
      excludes: [],
    },
    {
      // Pay-per-use access to the same bays the Self-Service Bay membership
      // covers, for callers who do not want a membership. Duration stays null:
      // the membership publishes "up to 10 minutes per bay use", and the owner
      // confirmed on 2026-08-27 that no time limit is published for a single
      // paid visit, so the assistant states none rather than inventing one.
      name: "Self-Service Bay",
      price: 10.0,
      durationMinutes: null,
      includes: [
        "Access to self-service equipment",
        "No commitment needed",
        "Pay only when you use it",
        "Open 24 hours a day, 7 days a week",
      ],
      excludes: ["Vacuum is not included"],
    },
  ],

  commercialVehicleTypes: [
    "tow trucks",
    "8 ft and 9 ft bed trucks",
    "sprinter vans",
  ],

  vehiclePolicy:
    "The Quick Service, Express Detail and Self-Service Bay memberships cover personal vehicles of any size. Commercial vehicles need the Commercial Wash plan.",

  discountPolicy:
    "The 10% discount applies to a first-time membership only, not to renewals or to one-time services.",
}

/** Money as a caller hears it: "$39.99". */
function money(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/**
 * The pricing block handed to the assistant as a dynamic variable. Plain text
 * rather than JSON on purpose: it is read aloud, it is easy to eyeball in logs,
 * and it keeps the assistant from reciting field names.
 *
 * Brand-agnostic in shape but TLP-only in fact — `AI_AGENT_LABELS` is `TLP`
 * today. When other brands are enabled, take the label as an argument and pick
 * the matching BrandPricing.
 */
export function pricingText(pricing: BrandPricing = TLP_PRICING): string {
  const lines: string[] = []

  lines.push(`${pricing.brand} — current pricing.`)
  lines.push("")
  lines.push("MONTHLY MEMBERSHIPS (auto-renew monthly, cancel anytime):")
  for (const m of pricing.memberships) {
    const price =
      m.firstTimePrice === null
        ? `${money(m.monthlyPrice)} per month`
        : `${money(m.monthlyPrice)} per month, or ${money(m.firstTimePrice)} for a first-time member`
    lines.push(`- ${m.name}: ${price}. ${m.includes.join(", ")}.`)
    if (m.notes.length > 0) lines.push(`  ${m.notes.join(". ")}.`)
  }

  lines.push("")
  lines.push("ONE-TIME SERVICES (no membership needed):")
  for (const s of pricing.oneTimeServices) {
    const duration =
      s.durationMinutes === null ? "" : `, about ${s.durationMinutes} minutes`
    lines.push(`- ${s.name}: ${money(s.price)}${duration}. ${s.includes.join(", ")}.`)
    if (s.excludes.length > 0) lines.push(`  Not included: ${s.excludes.join(", ")}.`)
  }

  lines.push("")
  lines.push(`DISCOUNT: ${pricing.discountPolicy}`)
  lines.push("")
  lines.push(`VEHICLES: ${pricing.vehiclePolicy}`)
  lines.push(
    `Vehicles that need the Commercial Wash plan: ${pricing.commercialVehicleTypes.join(", ")}.`
  )

  return lines.join("\n")
}
