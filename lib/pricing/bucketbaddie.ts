// Bucket Baddie menu, as spoken by the AI receptionist.
//
// Source of truth is the printed menu board `e-menu.png` (dated 2026-08-18),
// transcribed by hand. Three older artefacts exist and are ALL superseded —
// see docs/bucketbaddie-ai-discovery.md §2. The 2026-04-25 markdown board in
// particular says to strip rice from the menu; four months later rice is a
// headline item, confirmed by the owner. Do not reconcile this file against
// any of them.
//
// Pure data + formatting only — no DB or env access — so it unit-tests in
// plain node, mirroring lib/tlp-pricing.ts.
//
// DELIBERATELY NOT SHAPED LIKE BrandPricing. TLP sells memberships and
// one-time services; Bucket Baddie sells combos, family meals, build-your-own
// bowls and nine glazes. Forcing both into one type would produce a type that
// describes neither. The seam both brands share is the *output*: a plain text
// block the assistant reads. That contract is what lib/pricing/index.ts keys on.
//
// The real prices live in the BB Laravel app's `products` / `product_sizes`
// tables behind an admin UI, so this constant WILL drift the first time
// somebody edits a price in the app. That is a known, accepted risk for v1 —
// see docs/bucketbaddie-ai-assistant-instructions.md §3 for the options.

export type MenuItem = {
  name: string
  price: number
  /** A size or variant, folded into the spoken name: "Rice Bowl (large)". */
  size?: string
  /** What it comes with, spoken after the price. */
  detail?: string
}

export type MenuSection = {
  title: string
  /** One line of context before the items, when the section name isn't enough. */
  intro?: string
  items: MenuItem[]
  /** Lines appended after the items. Not priced. */
  notes?: string[]
}

export type Glaze = {
  name: string
  /** Spoken heat level, exactly as printed on the board. */
  heat: string
}

export type BucketBaddieMenu = {
  brand: string
  sections: MenuSection[]
  glazes: Glaze[]
  drizzleDips: string[]
  /** Choices for Build Your Baddie, which is configured rather than priced. */
  buildYourBaddie: {
    bases: string[]
    proteins: string[]
    veggies: string[]
    meltedCheese: string
    drizzles: string[]
  }
  /** Named because callers ask "do you do vegetarian?" and the answer is narrow. */
  vegetarianOptions: string[]
  deliveryApps: string[]
}

export const BUCKET_BADDIE_MENU: BucketBaddieMenu = {
  brand: "Bucket Baddie",

  sections: [
    {
      title: "COMBOS",
      intro: "Wings or tenders with fries. The board calls these Combos, not Buckets.",
      items: [
        { name: "Small Combo", price: 9.99, detail: "5 wings or 2 tenders, 1 glaze, with fries" },
        { name: "Medium Combo", price: 14.99, detail: "8 wings or 3 tenders, 1 glaze, with fries" },
        { name: "Large Combo", price: 19.99, detail: "12 wings or 5 tenders, 2 glazes, with fries" },
        { name: "Party Combo", price: 28.99, detail: "20 wings or 8 tenders, 4 glazes, with fries" },
      ],
    },
    {
      title: "WINGS",
      intro: "Wings on their own. No fries included.",
      items: [
        { name: "6 piece wings", price: 7.99, detail: "1 glaze" },
        { name: "10 piece wings", price: 11.99, detail: "2 glazes" },
        { name: "15 piece wings", price: 16.99, detail: "3 glazes" },
        { name: "20 piece wings", price: 24.99, detail: "4 glazes" },
        { name: "30 piece wings", price: 35.99, detail: "5 glazes" },
      ],
    },
    {
      title: "TENDERS",
      intro: "Tenders on their own. No fries included.",
      items: [
        { name: "3 piece tenders", price: 7.99, detail: "1 glaze" },
        { name: "5 piece tenders", price: 11.99, detail: "1 glaze" },
        { name: "8 piece tenders", price: 16.99, detail: "2 glazes" },
        { name: "15 piece tenders", price: 20.99, detail: "3 glazes" },
      ],
      notes: ["Tenders stop at 15 piece. Only wings go up to 20 and 30 piece."],
    },
    {
      title: "LOADED",
      items: [
        { name: "Loaded Fries", price: 9.99, size: "regular" },
        { name: "Loaded Fries", price: 13.99, size: "large" },
        { name: "Loaded Mac N Cheese", price: 10.99, size: "regular" },
        { name: "Loaded Mac N Cheese", price: 14.99, size: "large" },
      ],
    },
    {
      title: "RICE BOWL",
      items: [
        { name: "Rice Bowl", price: 11.99, size: "regular" },
        { name: "Rice Bowl", price: 16.99, size: "large" },
      ],
      notes: ["Choose tenders or Gobi-A Baddie in a rice bowl."],
    },
    {
      title: "BUILD YOUR BADDIE",
      intro: "Pick your own base, protein, veggies, glaze and drizzle.",
      items: [
        { name: "Build Your Baddie", price: 11.99, size: "regular" },
        { name: "Build Your Baddie", price: 16.99, size: "large" },
      ],
    },
    {
      title: "GOBI-A BADDIE",
      intro: "Crispy fried cauliflower bites tossed in a veggie-friendly glaze.",
      items: [
        { name: "Gobi-A Baddie", price: 5.99, size: "small" },
        { name: "Gobi-A Baddie", price: 8.99, size: "medium" },
        { name: "Gobi-A Baddie", price: 11.99, size: "large" },
      ],
    },
    {
      title: "BURGER BADDIE",
      items: [
        { name: "Burger Baddie", price: 9.99, detail: "on its own" },
        { name: "Burger Baddie Combo", price: 12.99, detail: "burger, fries and a canned soda" },
      ],
    },
    {
      title: "FAMILY MEALS",
      items: [
        {
          name: "Baddie Duo",
          price: 24.99,
          detail:
            "pick one of 10 wings, 5 tenders, 2 rice bowls or 2 baddie burgers, plus small fries or 8 ounce mac and cheese, 2 dips, 2 drinks and 1 glaze. Feeds 2 to 3",
        },
        {
          name: "Family Feast",
          price: 39.99,
          detail:
            "pick one of 15 wings, 8 tenders or 3 baddie burgers, plus medium fries or 8 ounce mac and cheese, 3 dips, 3 drinks and 2 glazes. Feeds 3 to 4",
        },
        {
          name: "Block Party",
          price: 54.99,
          detail:
            "pick one of 20 wings, 8 tenders or 5 baddie burgers, plus large fries or 12 ounce mac and cheese, 5 dips, 5 drinks and 2 glazes, a third glaze is $1.50 more. Feeds 5 to 6",
        },
      ],
    },
    {
      title: "SIDES",
      items: [
        { name: "Small Fries", price: 5.99 },
        { name: "Medium Fries", price: 7.99 },
        { name: "Large Fries", price: 9.99 },
        { name: "Mac N Cheese", price: 4.99, size: "8 ounce" },
        { name: "Mac N Cheese", price: 6.99, size: "12 ounce" },
        { name: "Masala Butter Corn", price: 4.49, detail: "sweet corn tossed in masala butter" },
      ],
      notes: [
        "Masala fries seasoning can be added to any fries for $1.50.",
        "Masala butter corn is a side, and a veggie on Build Your Baddie. It does not go on loaded fries.",
      ],
    },
    {
      title: "DIPS AND SAUCES",
      items: [
        { name: "Baddie Sauce Cup", price: 0.75 },
        { name: "Large Sauce Up", price: 1.5 },
        { name: "Sauce Trio", price: 2.99 },
      ],
    },
    {
      title: "ADD-ONS",
      items: [
        { name: "Extra dip", price: 0.75 },
        { name: "Extra glaze on the side", price: 1.0 },
        { name: "Extra glaze split", price: 1.0 },
        { name: "Mac and cheese instead of fries", price: 2.5 },
        { name: "Seasoned rice instead of fries", price: 2.5 },
        { name: "Masala fries seasoning", price: 1.5 },
      ],
    },
    {
      title: "DRINKS",
      items: [
        { name: "Canned Soda", price: 1.6 },
        { name: "Bottled Water", price: 2.0 },
        { name: "Bottled Soda", price: 2.25 },
        { name: "Blue Lemonade", price: 3.75 },
        { name: "Soursop", price: 3.75 },
        { name: "Jamaica", price: 4.5 },
        { name: "Mango Shake", price: 6.0 },
      ],
    },
  ],

  // Nine, in heat order as printed. These names replaced an earlier eight-glaze
  // list (Buff Baddie, Lemon MasalaFlex, Garlic Drip, Ghost Mode Mirchi …) that
  // no longer exists. Never use the old names — the test asserts they are gone.
  glazes: [
    { name: "Ghost Pepper", heat: "insanely hot" },
    { name: "Mirchi Melt", heat: "extra hot" },
    { name: "Peri Peri", heat: "extra hot" },
    { name: "Mango Habanero", heat: "hot" },
    { name: "Buffalo Baddie", heat: "medium" },
    { name: "Lemon Pepper", heat: "medium" },
    { name: "Garlic Parmesan", heat: "mild" },
    { name: "Honey BBQ", heat: "mild" },
    { name: "Butter Masala", heat: "no heat" },
  ],

  drizzleDips: ["Ranch Drip", "Green Baddie Drip", "OG Baddie Drip"],

  buildYourBaddie: {
    bases: ["rice", "fries", "mac and cheese"],
    proteins: ["tenders", "cauliflower", "none"],
    veggies: ["onions", "jalapeños", "cucumber", "masala corn", "cilantro"],
    meltedCheese: "yes or no",
    drizzles: ["Ranch", "Green Baddie", "OG Baddie"],
  },

  vegetarianOptions: [
    "Gobi-A Baddie, which is cauliflower",
    "Build Your Baddie with cauliflower or no protein",
  ],

  deliveryApps: ["GrubHub", "DoorDash", "Uber Eats"],
}

/** Money as a caller hears it: "$9.99". */
function money(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** An item as it reads in the block, with its size folded into the name. */
export function itemLabel(item: MenuItem): string {
  return item.size ? `${item.name} (${item.size})` : item.name
}

/**
 * Prices that name more than one product, derived from the data rather than
 * written down.
 *
 * This exists because the menu has nine of them and $11.99 alone means five
 * different things. A caller who says "the eleven ninety-nine" has told the
 * assistant almost nothing, and an assistant that guesses puts the wrong food
 * in front of someone who paid for it. Deriving the list means it cannot go
 * stale when a price moves — which a hand-written warning in the prompt would.
 *
 * Add-ons and dips are included deliberately: "the two fifty" is genuinely
 * ambiguous between the mac and the rice substitution.
 */
export function priceCollisions(
  menu: BucketBaddieMenu = BUCKET_BADDIE_MENU
): Array<{ price: number; items: string[] }> {
  const byPrice = new Map<number, string[]>()
  for (const section of menu.sections) {
    for (const item of section.items) {
      const names = byPrice.get(item.price) ?? []
      const name = itemLabel(item)
      // The same item at the same price in two sections isn't a collision.
      if (!names.includes(name)) names.push(name)
      byPrice.set(item.price, names)
    }
  }
  return [...byPrice.entries()]
    .filter(([, items]) => items.length > 1)
    .sort(([a], [b]) => a - b)
    .map(([price, items]) => ({ price, items }))
}

/**
 * The menu block handed to the assistant as `{{ pricing }}`. Plain text rather
 * than JSON on purpose: it is read aloud, it is easy to eyeball in logs, and it
 * keeps the assistant from reciting field names. Same contract as
 * `pricingText()` for TLP.
 */
export function bucketBaddiePricingText(
  menu: BucketBaddieMenu = BUCKET_BADDIE_MENU
): string {
  const lines: string[] = []

  lines.push(`${menu.brand} — current menu.`)

  for (const section of menu.sections) {
    lines.push("")
    lines.push(`${section.title}:`)
    if (section.intro) lines.push(section.intro)
    for (const item of section.items) {
      const detail = item.detail ? ` — ${item.detail}` : ""
      lines.push(`- ${itemLabel(item)}: ${money(item.price)}${detail}.`)
    }
    for (const note of section.notes ?? []) lines.push(note)
  }

  lines.push("")
  lines.push("GLAZES (nine, they go on the chicken), hottest first:")
  for (const glaze of menu.glazes) {
    lines.push(`- ${glaze.name}: ${glaze.heat}.`)
  }

  lines.push("")
  lines.push(
    `DRIZZLE DIPS (three, separate from glazes): ${menu.drizzleDips.join(", ")}.`
  )
  lines.push(
    "Glazes and dips are counted separately in what comes included and cost different amounts extra. Never call a glaze a dip."
  )

  const byob = menu.buildYourBaddie
  lines.push("")
  lines.push("BUILD YOUR BADDIE CHOICES:")
  lines.push(`- Base: ${byob.bases.join(", ")}.`)
  lines.push(`- Protein: ${byob.proteins.join(", ")}.`)
  lines.push(`- Veggies: ${byob.veggies.join(", ")}.`)
  lines.push(`- Melted cheese: ${byob.meltedCheese}.`)
  lines.push(`- Drizzle: ${byob.drizzles.join(", ")}.`)
  lines.push("- One glaze from the nine above.")

  lines.push("")
  lines.push(`VEGETARIAN: ${menu.vegetarianOptions.join("; ")}.`)
  lines.push("Nothing else on the menu is vegetarian.")

  lines.push("")
  lines.push(
    `DELIVERY: we do not deliver ourselves. We are on ${menu.deliveryApps.join(", ")}. Ordering direct from us is pickup only.`
  )

  lines.push("")
  lines.push("SAME PRICE, DIFFERENT ITEMS — never take a price as an order:")
  for (const { price, items } of priceCollisions(menu)) {
    lines.push(`- ${money(price)} could be ${items.join(", or ")}.`)
  }
  lines.push(
    "If someone names a price instead of an item, ask what they are after and work it out from the item, not the number."
  )

  return lines.join("\n")
}
