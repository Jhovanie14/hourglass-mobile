# Bucket Baddie AI Receptionist — Assistant Instructions

> ## ⚠️ §1 below is SUPERSEDED — read this first
>
> As of 2026-08-26 there is **no Bucket Baddie prompt**. One shared,
> brand-agnostic block serves every brand and lives in
> **`docs/ai-receptionist-instructions.md`** — that is the only file
> `npm run sync:assistant` reads.
>
> The §1 block below was split into two live sources and is kept only as the
> record of how it was written:
>
> | What it was | Where it lives now |
> |---|---|
> | Menu, prices, price-collision warning | `lib/pricing/bucketbaddie.ts` (collisions are **derived**) |
> | Combo / mac / glaze / vegetarian / ordering / challenge / catering / halal rules | `BUCKET_BADDIE_RULES` in `lib/pricing/rules.ts` |
> | Hours and open-now wording | the shared block, fed by `lib/pricing/hours.ts` |
> | Delivery-apps line | `bucketBaddiePricingText()` |
>
> **Editing §1 changes nothing.** To change what the AI says, edit the source in
> the table above, then `npm run sync:assistant -- --dry-run`.

Discovery and decisions: `docs/bucketbaddie-ai-discovery.md`.
Shared prompt: `docs/ai-receptionist-instructions.md`.

## Dynamic variables

Shared assistant, so `{{ brand_name }}` already arrives on the
`startAIAssistant` command (`lib/telnyx/voice-orchestrator.ts:146`). The rest
come from `/api/webhooks/telnyx/ai/variables`, which today serves TLP pricing
unconditionally and must become brand-aware.

| Variable | Type | Source | Fail-safe default |
|---|---|---|---|
| `{{ brand_name }}` | text | `AI_BRAND_NAMES` mapping | — |
| `{{ pricing }}` | text block | new `lib/pricing/bucketbaddie.ts` | empty → "can't quote right now" |
| `{{ hours }}` | text block | `config/fulfillment.php` mirrored into code | empty → take a message |
| `{{ open_now }}` | boolean | computed in `America/Chicago` | `false` |
| `{{ coupons }}` | text block | live read, public+active only | **empty** → say nothing about promos |

`{{ open_now }}` is worth the extra plumbing: "are you open?" is the most common
call a restaurant gets, the assistant has no reliable clock of its own, and
Monday is closed while the marketing site says "Open Daily". Defaulting it to
`false` is deliberate — telling someone you're shut when you're open costs one
order; the reverse sends them across Houston to a locked door.

`{{ coupons }}` defaults to **empty, not to a cached list**. A stale promo is
worse than no promo.

---

## §1 Instructions block — SUPERSEDED, see the banner above

```
You are the receptionist for Bucket Baddie, a halal fried chicken spot in
Houston. You answer the phone, answer questions, and take messages. This call
may be recorded for quality purposes.

Keep every reply short and natural — one or two sentences. You are speaking, not
writing: no lists, no bullet points, no reading out punctuation. If someone asks
what's on the menu, name a few things and ask what they're after. Never read the
whole menu aloud.

HOW TO BE CONSISTENT
Handle the same request the same way every time.
- Ask one question at a time and wait for the answer.
- Use the exact item names from the menu block. Never shorten them, pluralise
  them, or invent a name for an item.
- Read every phone number back digit by digit and wait for confirmation.
- When you cannot help, say plainly what you do not have, then offer to take a
  message. Do not apologise repeatedly and do not pad the answer.
- Before the call ends, ask whether there is anything else.

THE MENU
{{ pricing }}

Quote only from that block. If someone asks about an item or a price that is not
in it, say you don't have that one to hand and offer to take a message. Never
estimate, never round, and never invent a price or an item name. If the menu
block is empty, say you can't quote prices right now and offer to take a
message.

NEVER TAKE A PRICE AS AN ORDER
Almost every price on this menu names more than one thing. Eleven ninety-nine is
ten wings, five tenders, a regular rice bowl, a regular build your baddie, or a
large gobi-a. Nine ninety-nine is a small combo, regular loaded fries, a burger
on its own, or large fries. Sixteen ninety-nine is fifteen wings, eight tenders,
a large rice bowl, or a large build your baddie. Seven ninety-nine is six wings,
three tenders, or medium fries.

If someone names a price instead of an item, never guess. Ask what they're after
and work it out from the item, not the number.

"COMBO" MEANS THREE DIFFERENT THINGS
A Small, Medium, Large or Party Combo is wings or tenders with fries. The Burger
Baddie Combo is a burger with fries and a canned soda. Family Meals are
different again. If someone just says "the combo", ask which.

Combos come with fries. Wings on their own and tenders on their own do not. A
Small Combo is five wings with fries; six wings by themselves is a different,
cheaper item.

GLAZES AND DIPS ARE NOT THE SAME THING
There are nine glazes, which go on the chicken. From hottest down: Ghost Pepper
is insanely hot, then Mirchi Melt and Peri Peri are extra hot, Mango Habanero is
hot, Buffalo Baddie and Lemon Pepper are medium, Garlic Parmesan and Honey BBQ
are mild, and Butter Masala has no heat.

There are three drizzle dips: Ranch Drip, Green Baddie Drip and OG Baddie Drip.

Do not call a glaze a dip or a dip a glaze. They are counted separately in what
comes included, and they cost different amounts extra. If someone asks for
something mild, steer them to Butter Masala, Garlic Parmesan or Honey BBQ.

VEGETARIAN
The Gobi-A Baddie is crispy fried cauliflower bites in a veggie-friendly glaze.
You can also build a baddie with cauliflower or no protein at all. Those are the
vegetarian options. Do not tell anyone anything else is vegetarian.

MAC N CHEESE IS FOUR THINGS
An eight ounce side, a twelve ounce side, a substitute for the fries for two
fifty, and Loaded Mac N Cheese, which is a main. Ask which they mean.

Masala butter corn is a side, and it can go on a build your baddie as a veggie.
It does not go on loaded fries.

HOURS
{{ hours }}

Open right now: {{ open_now }}

If open_now is false, tell them we're closed and give the next day we're open.
Do not work out the current time yourself and do not guess. If the hours block
is empty, say you can't confirm hours and offer to take a message.

DELIVERY
We don't deliver ourselves, but we're on GrubHub, DoorDash and Uber Eats. If
someone wants delivery, point them at those. Ordering direct from us is pickup
only. Do not quote a delivery fee or a delivery area — we don't have either.

ORDERING
You cannot take an order and you cannot check on an order that has already been
placed. Orders are placed on the website, on the delivery apps, or in person. If
someone wants to order, tell them they can order at bucketbaddie.com or come by,
and offer to take a message if they'd rather someone called them back. Never say
an order is placed, confirmed, or on its way, and never give an order time.

DEALS
{{ coupons }}

Mention a deal only if it is in that block. Whenever a deal is limited to
certain days, say which days as part of the same sentence — never quote the deal
without the days. If the block is empty, say you don't have any deals to hand
right now. Never invent a discount and never guess whether an old code still
works.

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
call back with a quote, and note that this was a catering enquiry.

HALAL
All the chicken is one hundred percent halal from certified suppliers. There is
no pork or pork by-product in the kitchen. You can say that plainly.

TRANSFERS
You cannot transfer this call. You are only on the line because the phone rang
first and nobody picked up, and you have no way to reach anyone from here. If
someone asks for a person, say nobody is available right now, offer to take a
message, and collect their name, number and reason for calling. Never say you
are connecting them, putting them through, or finding someone — you are not, and
they will be left listening to silence.

TAKING A MESSAGE
Collect name, callback number, and the reason for calling. Read the number back
to confirm it. Keep it brief.

WHAT NOT TO DO
Do not discuss anything outside Bucket Baddie. Do not speculate about hours,
locations, staffing, suppliers or policies you have not been told. Do not
comment on how spicy something is beyond what the menu says. If you do not know
something, say so and offer to take a message. It is always better to say "I
don't have that" than to guess.
```

---

## §2 What it can and cannot do

**It can:** quote the menu, explain what an item includes, give hours and say
whether we're open now, explain pickup-only, explain the Ghost Mode Challenge,
confirm halal, read out live public deals, and take a message.

**It cannot:**

1. **Take an order.** By decision — v1 does not touch the Laravel app or Square.
2. **Check an existing order.** `orders.customer_phone` makes this cheap to add
   later (caller ID is already the key), but only if the forwarded leg preserves
   caller ID. Test that during cutover.
3. **Transfer.** Same as TLP — no transfer tool exists on the assistant.
4. **Quote catering.** No prices exist anywhere.
5. **Answer challenge edge cases** — refunds, disputes, group attempts, whether
   the board is currently open. Only the rules above are known.

## §3 Where each fact comes from

| In the prompt | Source | Drifts when |
|---|---|---|
| Menu and prices | **`~/Downloads/e-menu.png`, 2026-08-18** | someone edits `products` / `product_sizes` in the admin UI, or a new board is printed |
| Hours | `config/fulfillment.php:39` | the BB repo's config changes |
| No first-party delivery | `.env.production DELIVERY_ENABLED=false` | delivery is switched back on |
| Delivery apps | delivery-app logos on `e-menu.png` | they leave or join an app |
| Challenge | `resources/js/pages/Challenge.vue` | the page is edited |
| Halal | `bucket-baddie/app/components/core/FAQ.tsx:12` | — |

Three older menu artefacts exist (`BUCKET BADDIE (1).pdf` 2026-03-19,
`BUCKET-BADDIE-FINAL-MENU-BOARD.md` 2026-04-25, `Updated Menu Bucket Baddie.svg`
2026-05-03). All are superseded. The markdown in particular says to remove rice
from the menu — four months later rice is a headline item. **Do not build from
any of the three.**

**The menu is the fragile one.** TLP's prices live in a code constant that only a
deploy can change. BB's live in a database with an admin UI, so a hardcoded
`lib/pricing/bucketbaddie.ts` starts drifting the first time someone changes a
price in the app. Options, cheapest first: accept the drift and add a test that
fails loudly; have the variables webhook read BB's menu live the same way it
will read coupons; or export the menu on a schedule. Worth deciding before the
first price change, not after a caller is quoted a stale $9.99.

## §4 Build work

### Done — additive, nothing on the live TLP path (2026-08-26)

- **`lib/pricing/bucketbaddie.ts`** — the whole menu from `e-menu.png` plus
  `bucketBaddiePricingText()`. The price-collision warning is **derived from the
  data**, not written down, so it cannot go stale when a price moves.
- **`lib/pricing/hours.ts`** — `BUCKET_BADDIE_HOURS`, `hoursText()`,
  `isOpenAt()`, `nextOpening()`, `spokenTime()`. Timezone-correct in
  `America/Chicago`, and a Friday midnight close does not spill into Saturday.
- **`lib/pricing/index.ts`** — `brandContentForLabel()`, keyed on
  `phone_numbers.label` like the rest of the brand plumbing. An unknown label
  returns null so the caller degrades to an empty block rather than serving one
  brand's prices to another brand's caller.
- **`lib/pricing/coupons.ts`** — `couponsText()` and `fetchCouponsText()`. Off
  unless `BB_COUPONS_ENABLED=true`; every failure path returns `""`; never
  serves a cached list; 1.5s timeout.

62 new tests, 365 passing overall, `tsc --noEmit` and eslint clean.

**Slack needed no code.** `slackWebhookForLabel` (`lib/slack.ts:12`) already
resolves `SLACK_WEBHOOK_URL_<LABEL>` and falls back to `SLACK_WEBHOOK_URL`, so
BB's channel is just `SLACK_WEBHOOK_URL_BB` in env.

### Done — phase 2, brand-aware routing (2026-08-26)

- **`lib/pricing/rules.ts`** — `TLP_RULES` and `BUCKET_BADDIE_RULES`, resolving
  `{{ brand_rules }}`. Brand policy had to leave the shared prompt: one
  assistant serving two businesses would otherwise carry a car wash's
  membership rules into a chicken shop call. Tests assert neither block
  mentions the other's trade.
- **`lib/telnyx/ai-brand-variables.ts`** — `brandVariables()`,
  `brandLabelFromWebhookBody()`, `resolveBrandLabel()`.
- **`startAIAssistantOnCall`** now carries `pricing`, `brand_rules`, `hours`,
  `open_now`. This is the primary path: the label comes off the
  `phone_numbers` row that took the call, so the brand is certain here.
- **`/api/webhooks/telnyx/ai/variables`** is brand-aware, and **omits** the
  brand keys rather than emptying them when it cannot identify the caller's
  brand — an omitted key leaves the start-command value standing.
- **`docs/ai-receptionist-instructions.md`** — the shared, brand-agnostic §1
  block. 2,739 chars, names no brand. `scripts/sync-tlp-assistant.mjs` now
  syncs this instead of the TLP doc.

415 tests passing, `tsc --noEmit` clean, eslint clean on all new code.

**`open_now` is a tri-state, not a boolean** — `yes` / `no` / `unknown`. A
boolean forces TLP, which publishes no hours, to claim one or the other, and
both are wrong: "no" turns away a caller, "yes" sends someone to a locked door.

**The unresolved-brand question is contained, not answered.** Nobody has
confirmed Telnyx sends `brand_label` in the variables webhook body. Rather than
guess, `resolveBrandLabel` falls back to the sole configured label — which is
today's production state, making the rewrite a provable no-op for TLP. Adding
Bucket Baddie to `AI_AGENT_LABELS` in production removes that fallback, so the
answer surfaces as a loud log on the first call after, never as a wrong price.

### Live as of 2026-08-26

Code deployed (`f35e6a1`) and the shared prompt synced. The assistant is now
**"Hourglass AI Receptionist"** — renamed from "The Launch Pad Receptionist —
Test", which was wrong on both counts. Verified against the live assistant:
name, 2,739-char shared block, brand-agnostic greeting, `tools: []`, and all
nine variable defaults.

TLP was re-verified by call afterwards — bookings, commercial vehicles,
Commercial Wash interior, and the tire-shine confusion all answered correctly,
which proves `{{ brand_rules }}` resolves end to end.

**Still unproven: whether Telnyx sends `brand_label` in the variables webhook
body.** TLP resolves through the sole-configured-label fallback, so its passing
tells us nothing about that. It matters the moment Bucket Baddie is added,
because a second label retires the fallback. The Vercel log line
`🏷️ AI variables: brand=TLP (resolved via …)` names which path ran and answers
it for free.

### Outstanding

1. **The coupons endpoint does not exist.** It has to be built in the BB Laravel
   repo, serving public+active+in-window rows with `free_product_id` resolved to
   a product name. `lib/pricing/coupons.ts` documents the expected shape. Until
   it exists the flag stays off and the AI says nothing about deals — which is
   a working state, not a blocked one.
2. Buy a Telnyx number, set its `phone_numbers.label` to **`Bucket Baddie`**
   (the live label, confirmed 2026-08-26 — not a short code), then forward
   (832) 650-1126 to it.

### Env keys, exactly

| Key | Value | Why |
|---|---|---|
| `AI_AGENT_LABELS` | `TLP,Bucket Baddie` | **Not currently set in `.env.local` at all**, so `aiAgentSettings()` returns null and the AI path is dormant locally. Without the BB entry the assistant never picks up. |
| `SLACK_WEBHOOK_URL_BUCKET_BADDIE` | new incoming-webhook URL | Derived from the label by `slackWebhookForLabel` — verified, not guessed. Falls back to `SLACK_WEBHOOK_URL` (the TLP channel) if unset. |
| `AI_BRAND_NAMES` | **leave as `TLP:The Launch Pad`** | No BB entry needed. `brandNameForLabel` falls back to the label when unmapped, and the label already reads correctly aloud. Adding `Bucket Baddie:Bucket Baddie` would be a no-op. |
| `BB_COUPONS_ENABLED` | unset, or `false` | Ship dark. |

⚠️ **The label must have exactly one space.** `brandContentForLabel` collapses
repeated whitespace defensively, but the gate that runs first —
`isAIAgentLabel` (`lib/telnyx/ai-agent.ts:46`) — only trims and upper-cases. A
`phone_numbers.label` of `Bucket  Baddie` fails that check and the AI never
starts, so the registry's tolerance never gets a chance to help. Worth
tightening in phase 2; until then, check the row.

## §5 Open questions

Rice and the three delivery apps were both confirmed by the owner on 2026-08-26
and are settled in the prompt. Remaining:

- **`Locations.tsx` says "Open Daily"** against a closed Monday. The AI will be
  correcting the website on live calls. Fix the site.
- **Does the forwarded leg preserve caller ID?** Decides whether order-status
  lookup is ever buildable without porting.
- **Is `www.bucketbaddie.com` live and taking orders?** The prompt tells callers
  to order there. If it isn't live, that line has to change.
- **`(713) 555-0123`** is a placeholder number on two live pages
  (`BucketBaddieLayout.vue:698`, `Challenge.vue:818`). Unrelated to this build,
  but customers can see it.
