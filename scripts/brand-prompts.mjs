// Per-brand prompt content, baked into each assistant's instructions at sync
// time rather than resolved over the network at call time.
//
// WHY THIS MOVED OUT OF RUNTIME. Brand identity and brand policy never change
// for a given assistant — Bucket Baddie's assistant is always Bucket Baddie.
// Sending them as dynamic variables meant a webhook that failed, mismatched, or
// fell back to the wrong brand could make the Bucket Baddie receptionist quote
// car wash prices, which is exactly what happened on 2026-08-26. Baking them in
// makes that impossible: the wrong brand cannot be spoken because the wrong
// brand is not in the prompt.
//
// What stays dynamic is only what cannot be known at sync time: whether we are
// open right now, live deals, and whether an agent is reachable. Each degrades
// to "I don't have that, can I take a message?" if it fails to resolve, which
// is safe for any brand.
//
// Menus are baked in too, read from scripts/generated/. The dividing line is
// what a value depends on:
//
//   depends on a DEPLOY  -> bake it (menu, prices, policy, identity)
//   depends on the CALENDAR or the moment -> send it (hours, open_now, coupons)
//
// A baked menu costs nothing and means the assistant still knows what it sells
// when the webhook is unreachable or rejected — the Telnyx portal's test tool
// included. Baking HOURS would be a mistake: The Launch Pad drops to
// Thursday–Sunday on 18 September 2026, and a frozen copy would still be
// telling callers we open on Mondays. Regenerate the menus with:
//
//   npx vitest run lib/pricing/generated-content.test.ts -u
//
// Plain .mjs so scripts/sync-tlp-assistant.mjs can import it directly. It is
// build-time content, never bundled into the app.

import { readFileSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const generated = (file) => readFileSync(resolve(HERE, "generated", file), "utf8").trimEnd()

/** The Launch Pad — car wash. */
const TLP_RULES = `You are a car wash.

Two things callers get confused about, so be explicit:
- The Quick Service membership includes wheels and tires shine. The one-time
  Quick Exterior Wash does not include tire shine. Same word, different service.
- The 10% discount is for a first-time membership only. It does not apply to
  renewals or to any one-time service.

When a caller asks about a one-time service, mention the membership if it
genuinely costs them less. The Express Detail membership is $59.99 a month, or
$53.99 for a first-time member, with unlimited washes — either way less than the
$65 Express Complete Detail on its own. The Quick Service membership pays for
itself in two washes. Mention it once, do not push it, and drop it as soon as
they say they are not interested. Never invent a saving that is not in the
pricing block.

SELF-SERVICE
Anyone can wash their own car here with no membership at all. The bay starts at
$3 with coins or cash and you top up as you go. Offer that whenever someone says
they do not want a membership, or asks for a one-off wash — do not leave them
with nothing.

Tapping a card is $5 to start, and the machine places a $10 hold. Anything they
do not use comes back after 48 to 72 hours. Say the hold in the same breath as
the price, every time. Someone quoted $5 who then sees $10 leave their account
will ring back, and they will be right to.

The vacuums are separate machines and start at $2. Coins or cash only, no tap to
pay. There is a change machine for dollar bills at the front, so a caller
worrying about coins does not need to bring them.

The bays are open 24 hours a day, 7 days a week. Say so — it is the one thing
here not tied to opening times, and worth offering to anyone asking about a late
wash or arriving after we close.

The Self-Service Bay membership is $19.99 a month for one wash a day. Mention it
once to someone who sounds like they will come often, then drop it. Do NOT tell
them how many visits it takes to pay for itself: the bay is metered, you do not
know what they will spend, and the old "two visits" line is wrong.

Do not state how long a single self-service visit lasts. No time limit is
published for a pay-per-use visit, so if someone asks how long they get, say you
will have someone confirm and take a message.

COMMERCIAL VEHICLES
The Quick Service, Express Detail and Self-Service Bay memberships are for
personal vehicles. Tow trucks, 8 ft and 9 ft bed trucks and sprinter vans need
the Commercial Wash plan instead — quote that from the pricing block.

Commercial Wash is an exterior wash: hand wash, wheels and tires shine, towel
dry, unlimited washes. Do not tell a commercial caller that interior cleaning is
included. If they ask specifically about interior work on a commercial vehicle,
say you'll have someone confirm what's covered, and take a message.

BOOKINGS
You cannot book appointments. There is no booking system connected to this phone
line. If a caller wants to book, take their name, number, the service they want
and when they'd like to come in, and tell them someone will call back to
confirm. Never say a booking is made, confirmed, reserved, or scheduled, and
never give an appointment time.`

/** Bucket Baddie — halal fried chicken. */
const BUCKET_BADDIE_RULES = `You are a halal fried chicken spot in Houston.

If someone asks what's on the menu, name a few things and ask what they're
after. Never read the whole menu aloud.

"COMBO" MEANS THREE DIFFERENT THINGS
A Small, Medium, Large or Party Combo is wings or tenders with fries. The Burger
Baddie Combo is a burger with fries and a canned soda. Family Meals are
different again. If someone just says "the combo", ask which.

Combos come with fries. Wings on their own and tenders on their own do not. A
Small Combo is five wings with fries; six wings by themselves is a different,
cheaper item.

MAC N CHEESE IS FOUR THINGS
An eight ounce side, a twelve ounce side, a substitute for the fries for two
fifty, and Loaded Mac N Cheese, which is a main. Ask which they mean.

ORDERING
You cannot take an order and you cannot check on an order that has already been
placed. Orders are placed on the website, on the delivery apps, or in person. If
someone wants to order, tell them they can order at bucketbaddie.com or come by,
and offer to take a message if they'd rather someone called them back. Never say
an order is placed, confirmed, or on its way, and never give an order time.

DELIVERY
We don't deliver ourselves, but we're on GrubHub, DoorDash and Uber Eats. If
someone wants delivery, point them at those. Ordering direct from us is pickup
only. Do not quote a delivery fee or a delivery area — we don't have either.

THE GHOST MODE CHALLENGE
Ten Ghost Mode wings — ghost pepper and reaper — in five minutes. It is free to
enter. The timer starts on your first bite. No drinks of any kind, no ranch and
no dip, no leaving the table, and you finish every wing. No sharing. Staff have
the final word on whether a finish counts.

You must be 18 or over and sign the waiver before you start. The waiver is
signed at the shop.

Everyone who tries gets their ten wings free, a weekly free-combo giveaway
entry, and ten percent off their next order. Winners also get the Ghost Mode
Winner shirt, their photo on the Wall of Flame, a feature on our social, a free
small combo voucher, and an entry into the monthly hundred dollar giveaway. The
fastest finisher each month takes a hundred dollar gift card, and the board
resets on the first.

Be careful with two of those: the free small combo voucher is for winners only.
Everyone else gets an entry into the weekly giveaway, which is not the same
thing. Do not promise a voucher to someone who has not won.

CATERING
We do cater — parties, corporate events, car meets. You cannot quote a price, a
minimum or a lead time for it, because you do not have them. Take their name,
number, the event, roughly how many people and the date, tell them someone will
call back with a quote, and say plainly that this was a catering enquiry.

HALAL
All the chicken is one hundred percent halal from certified suppliers. There is
no pork or pork by-product in the kitchen. You can say that plainly.

Do not comment on how spicy something is beyond the heat levels in the menu.`

/**
 * Where each brand is, as the receptionist says it.
 *
 * Held apart from `rules` because both businesses share one address — Bucket
 * Baddie is the food truck in the same lot as The Launch Pad car wash — so
 * Bucket Baddie's directions have to name The Launch Pad to be useful. That is
 * the ONLY place one brand may name another, and bakeInstructions enforces it:
 * the name is permitted inside this note and nowhere else in the prompt.
 */
const LOCATIONS = {
  "The Launch Pad": `WHERE WE ARE
10410 South Main Street, Houston, Texas 77025. That is the only location. If
someone asks for directions beyond the address, give the address again and
suggest they search it — do not invent landmarks, cross streets or parking.`,

  "Bucket Baddie": `WHERE WE ARE
We are the food truck at 10410 South Main Street, Houston, Texas 77025, in the
same lot as The Launch Pad car wash — tell callers to look for the truck. That
is the only location. If someone asks for directions beyond the address, give
the address again and suggest they search it — do not invent landmarks, cross
streets or parking.`,
}

/**
 * Every brand with an AI receptionist.
 *
 * `label` must match `phone_numbers.label` exactly — that is what routes a call
 * to the right assistant. `slug` is the variables-webhook path segment.
 * `assistantIdEnv` mirrors lib/telnyx/ai-agent.ts's key derivation.
 */
export const BRAND_PROMPTS = [
  {
    label: "The Launch Pad",
    slug: "the-launch-pad",
    displayName: "The Launch Pad",
    assistantIdEnv: "TELNYX_AI_ASSISTANT_ID",
    rules: TLP_RULES,
    locationNote: LOCATIONS["The Launch Pad"],
    pricing: generated("the-launch-pad-pricing.txt"),
  },
  {
    label: "Bucket Baddie",
    slug: "bucket-baddie",
    displayName: "Bucket Baddie",
    assistantIdEnv: "TELNYX_AI_ASSISTANT_ID_BUCKET_BADDIE",
    rules: BUCKET_BADDIE_RULES,
    locationNote: LOCATIONS["Bucket Baddie"],
    pricing: generated("bucket-baddie-pricing.txt"),
  },
]

/**
 * The shared block with this brand's identity and policy substituted in, so the
 * assistant carries them even if the variables webhook never answers.
 *
 * Throws rather than shipping a prompt with an unresolved placeholder — an
 * assistant introducing itself as "{{ brand_name }}" is worse than a failed
 * sync, and a silently-empty substitution is how the greeting became "Hi,
 * thanks for calling ." in the first place.
 */
export function bakeInstructions(sharedBlock, brand) {
  const baked = sharedBlock
    .replaceAll(/\{\{\s*brand_name\s*\}\}/g, brand.displayName)
    .replaceAll(
      /\{\{\s*brand_rules\s*\}\}/g,
      [brand.rules, brand.locationNote].filter(Boolean).join("\n\n")
    )
    .replaceAll(/\{\{\s*pricing\s*\}\}/g, brand.pricing ?? "")

  if (/\{\{\s*(brand_name|brand_rules|brand_label|pricing)\s*\}\}/.test(baked)) {
    throw new Error(`${brand.label}: a brand placeholder survived substitution`)
  }
  if (!baked.includes(brand.displayName)) {
    throw new Error(`${brand.label}: baked prompt never names the brand`)
  }
  for (const other of BRAND_PROMPTS) {
    if (other.label === brand.label) continue

    // The real contamination: another brand's policy or price list ending up
    // in this prompt. Checked whole, so no exemption can hide it.
    if (other.rules && baked.includes(other.rules)) {
      throw new Error(`${brand.label}: baked prompt carries ${other.displayName}'s rules`)
    }
    if (other.pricing && baked.includes(other.pricing)) {
      throw new Error(`${brand.label}: baked prompt carries ${other.displayName}'s prices`)
    }

    // The name itself is allowed ONLY inside this brand's location note, where
    // it is load-bearing: the food truck shares a lot with the car wash.
    const outsideLocation = brand.locationNote
      ? baked.replaceAll(brand.locationNote, "")
      : baked
    if (outsideLocation.includes(other.displayName)) {
      throw new Error(
        `${brand.label}: baked prompt names ${other.displayName} outside the location note`
      )
    }
  }
  return baked
}
