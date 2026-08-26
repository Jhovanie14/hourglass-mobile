# Bucket Baddie AI receptionist — discovery findings

Sources mined 2026-08-26. Bucket Baddie **does** have code, two codebases in fact:

| Source | What it is | Trust |
|---|---|---|
| `~/projects/bucket_baddie` (WSL) | Laravel 13 + Inertia/Vue 3 ordering app, Square-integrated. The real system. | **Primary** |
| `C:\Users\Prima\bucket-baddie` | Next.js 16 marketing landing page. Older, hardcoded copy. | Secondary — contradicts prod config in places |
| `~/Downloads/BUCKET-BADDIE-FINAL-MENU-BOARD.md` | Final menu board, dated post-revision | **Primary for pricing** |
| `~/Downloads/BUCKET BADDIE (1).pdf`, `Updated Menu Bucket Baddie.svg` | Not yet read | Unverified |

Production URL is `https://www.bucketbaddie.com` (`.env.production:APP_URL`).

---

## 1. The business

Halal fried-chicken concept — wings, tenders, loaded fries in buckets — Houston, TX.
Spoken name: **Bucket Baddie**. `APP_NAME="Bucket Baddie"` (`.env.production`).

- Address: **10410 S Main St, Houston, TX 77025** — hardcoded in
  `bucket-baddie/app/components/core/Locations.tsx:4`.
  ⚠️ `STORE_ADDRESS`, `STORE_CITY`, `STORE_ZIP` are all **empty** in
  `.env.production`, so the Laravel app does not know its own address.
- Halal: *"All chicken is 100% halal from certified suppliers. No pork or pork
  by-products in the kitchen."* (`FAQ.tsx:12`) — safe for the AI to say.
- Legal entity name: **UNKNOWN** — not in either repo.

## 2. Menu and prices

⚠️ **Source superseded 2026-08-26.** Four menu artefacts exist. Dated:

| File | Modified | Status |
|---|---|---|
| `BUCKET BADDIE (1).pdf` | 2026-03-19 | superseded |
| `BUCKET-BADDIE-FINAL-MENU-BOARD.md` | 2026-04-25 | **superseded** — was the source until now |
| `Updated Menu Bucket Baddie.svg` | 2026-05-03 | superseded |
| **`e-menu.png`** | **2026-08-18** | **AUTHORITATIVE** |

`e-menu.png` is a produced menu board carrying the website, address, delivery-app
logos and an order QR code. It is ~4 months newer than the markdown and is a far
larger menu. Everything below comes from it.

**COMBOS** — the markdown called these "Buckets". The current board says
**Combos**. Prices unchanged; glaze counts changed.

| Item | Price | Contents |
|---|---|---|
| Small Combo | $9.99 | 5 wings *or* 2 tenders, 1 glaze, with fries |
| Medium Combo | $14.99 | 8 wings *or* 3 tenders, 1 glaze, with fries |
| Large Combo | $19.99 | 12 wings *or* 5 tenders, 2 glazes, with fries |
| Party Combo | $28.99 | 20 wings *or* 8 tenders, 4 glazes, with fries |

**WINGS** — 6 pc $7.99 (1 glaze) · 10 pc $11.99 (2) · 15 pc $16.99 (3) ·
**20 pc $24.99 (4)** · **30 pc $35.99 (5)**
**TENDERS** — 3 pc $7.99 (1) · 5 pc $11.99 (1) · 8 pc $16.99 (2) ·
**15 pc $20.99 (3)**

**LOADED** — Loaded Fries Regular $9.99 / Large $13.99 ·
**Loaded Mac N Cheese Regular $10.99 / Large $14.99** (new)

**RICE BOWL** (new — see contradiction below) — Regular $11.99 / Large $16.99.
Choose tenders or Gobi-A Baddie.

**BUILD YOUR BADDIE** (new) — Regular $11.99 / Large $16.99.
Base: rice, fries, or mac & cheese. Protein: tenders, cauliflower, or none.
Veggies: onions, jalapeños, cucumber, masala corn, cilantro. One of 9 glazes.
Melted cheese yes/no. Drizzle: ranch, green baddie, or OG baddie.

**GOBI-A BADDIE** (new, vegetarian) — crispy fried cauliflower bites in a
veggie-friendly glaze. Small $5.99 / Medium $8.99 / Large $11.99.

**BURGER BADDIE** (new) — Standalone $9.99 · Combo $12.99 (burger + fries +
canned soda).

**FAMILY MEALS** (new)

| Meal | Price | Contents |
|---|---|---|
| Baddie Duo | $24.99 | 10 wings *or* 5 tenders *or* 2 rice bowls *or* 2 baddie burgers; small fries or 8 oz mac; 2 dips; 2 drinks; 1 glaze (feeds 2–3) |
| Family Feast | $39.99 | 15 wings *or* 8 tenders *or* 3 baddie burgers; medium fries or 8 oz mac; 3 dips; 3 drinks; 2 glazes (feeds 3–4) |
| Block Party | $54.99 | 20 wings *or* 8 tenders *or* 5 baddie burgers; large fries or 12 oz mac; 5 dips; 5 drinks; 2 glazes (3rd +$1.50) (feeds 5–6) |

**SIDES** — Fries S $5.99 / M $7.99 / L $9.99 (add masala fries seasoning +$1.50)
· Mac n Cheese 8 oz $4.99 / 12 oz $6.99 · Masala Butter Corn $4.49 (sweet corn
tossed in masala butter)

**DIP & SAUCES** — Large Sauce Up $1.50 · Baddie Sauce Cup $0.75 · Sauce Trio $2.99

**ADD-ONS** — Extra dip $0.75 · Extra glaze on the side $1.00 · Extra glaze
split $1.00 · Mac sub for fries $2.50 · Seasoned rice sub for fries $2.50 ·
Masala fries seasoning $1.50

**DRINKS** — Bottled soda $2.25 · Canned soda $1.60 · Mango shake $6.00 ·
Blue lemonade $3.75 · Jamaica $4.50 · Soursop $3.75 · Bottled water $2.00

**GLAZES — 9, with heat levels.** These are *renamed* from the markdown's eight;
use these names only.

Ghost Pepper (insanely hot) · Mirchi Melt (extra hot) · Peri Peri (extra hot) ·
Mango Habanero (hot) · Buffalo Baddie (medium) · Lemon Pepper (medium) ·
Garlic Parmesan (mild) · Honey BBQ (mild) · Butter Masala (no heat)

**DRIZZLE DIPS — 3:** Ranch Drip · Green Baddie Drip · OG Baddie Drip

### CONTRADICTION: rice

`BUCKET-BADDIE-FINAL-MENU-BOARD.md` (2026-04-25) opens with *"Remove all rice
references / Remove rice substitution option / Remove rice add-on option"*.

The current board (2026-08-18) has rice in **four** places: a Rice Bowl at
$11.99/$16.99, rice as a Build Your Baddie base, "seasoned rice sub for fries"
at $2.50 in add-ons, and 2 rice bowls as a Baddie Duo option.

**RESOLVED — owner confirmed 2026-08-26: rice is back.** The 2026-04-25 removal
note is dead; ignore it. The AI quotes the Rice Bowl, rice as a Build Your
Baddie base, and the rice-for-fries substitution.

### CONTRADICTION: masala butter corn

The markdown said corn was a side-only upsell, never on loaded fries. The
current board lists it as its own $4.49 item *and* as a Build Your Baddie
veggie. It is not offered on loaded fries either way, so the practical
instruction is unchanged: it is not a loaded-fries topping.

## 3. Recurring plans

**None.** No membership, subscription or loyalty tier anywhere in either repo.
There is a `coupons` table (`Coupon`, `CouponUsage`, with `is_public` and
free-item support) — promo codes, not memberships. Whether the AI should read
out public coupons is an open question, not an assumption.

## 4. Which offering fits which customer

No tier-eligibility rules. The only steering fact: buckets include fries and
sauce; wings-only and tenders-only do not include fries.

## 5. Price collisions — much worse on the full menu

Every price below names **more than one product**. This was three collisions on
the markdown menu; it is nine on the real one.

| Price | Means any of |
|---|---|
| **$5.99** | Small Fries · Gobi-A Baddie Small |
| **$7.99** | 6 pc wings · 3 pc tenders · Medium Fries |
| **$9.99** | Small Combo · Loaded Fries Regular · Burger Baddie standalone · Large Fries |
| **$11.99** | 10 pc wings · 5 pc tenders · Rice Bowl Regular · Build Your Baddie Regular · Gobi-A Large |
| **$14.99** | Medium Combo · Loaded Mac N Cheese Large |
| **$16.99** | 15 pc wings · 8 pc tenders · Rice Bowl Large · Build Your Baddie Large |
| **$24.99** | 20 pc wings · Baddie Duo |
| **$3.75** | Blue Lemonade · Soursop |
| **$2.50** | Mac sub for fries · Seasoned rice sub for fries |

$11.99 alone names **five** different products. A caller who says "the eleven
ninety-nine" has given the AI almost no information.

Other confusions:

1. **Combo vs Combo vs Family Meal.** "Small Combo" is $9.99 (wings/tenders +
   fries). "Combo" under Burger Baddie is $12.99 (burger + fries + canned soda).
   Family Meals are a third thing. Someone saying "the combo" must be asked which.
2. **Combo vs wings-only.** A Small Combo is 5 wings *with* fries at $9.99;
   6 pc wings is $7.99 *without*. One extra wing is not the difference.
3. **Mac n Cheese is four things** — 8 oz side, 12 oz side, fries substitute
   (+$2.50), and Loaded Mac N Cheese ($10.99/$14.99), which is a main.
4. **Glaze vs dip.** Nine glazes and three drizzle dips are separate lists,
   counted separately, and priced separately (extra glaze $1.00, extra dip
   $0.75). The schema agrees — `max_dip_sauces` and `max_extra_sauces` are
   distinct columns on `product_sizes`. Never call a glaze a dip.
5. **Glaze counts are not intuitive.** 5 pc tenders includes 1 glaze but 10 pc
   wings includes 2, at the same $11.99. Medium Combo includes 1 glaze while the
   cheaper Small Combo also includes 1.
6. **Tenders cap at 15 pc, wings go to 30 pc.** "Thirty piece" is wings only.
7. **Gobi-A Baddie is the vegetarian route** — cauliflower, not chicken. Also
   reachable via Build Your Baddie protein "cauliflower" or "none". Anyone asking
   for vegetarian gets these; do not offer them a glaze without noting the
   Gobi-A is tossed in a veggie-friendly glaze.

## 6. Hours

`config/fulfillment.php:39`, timezone `America/Chicago`:

| Day | Window |
|---|---|
| Monday | **Closed** |
| Tue / Wed / Thu | 16:00 – 22:00 |
| Friday | 16:00 – 24:00 |
| Saturday | 16:00 – 24:00 |
| Sunday | 16:00 – 22:00 |

⚠️ Two cautions. These are labelled **online-ordering** hours — the comment says
"Orders are rejected outside these windows" — which is not necessarily when the
door is open. And the marketing site says *"Open Daily (Check IG for times)"*
(`Locations.tsx`), which **contradicts Monday = closed**. See BLOCKING Q3.

## 7. Ordering — there is a real system

Laravel + Square. `orders` (`2026_04_08_190501`) holds `customer_name`,
`customer_phone`, `status` ∈ pending/paid/preparing/ready/completed/cancelled,
`subtotal`, `total`, `square_payment_id`, `square_order_id`, `notes`, plus a
public `token` (`2026_04_09_000144`). Tax via `TAX_RATE`. Catalog IDs are synced
to Square (`2026_04_22_205556`, `SQUARE_CATALOG_SYNC_ENABLED`).

`StoreHoursService::isOpenNow()` gates order creation from
`StoreOrderRequest.php:57`.

**`orders.customer_phone` is the key fact for the AI**: a caller's own number is
already the identifier, so "where's my order?" is answerable from caller ID with
no spelling-out of an order number. That is a capability TLP never had.

## 8. Delivery — CONTRADICTION

- `.env.production`: `DELIVERY_ENABLED=false`, `DELIVERY_ALLOWED_ZIPS=` (empty).
  The config comment notes an empty ZIP list disables delivery anyway. Flat fee
  would be $4.99, no minimum.
- `.env` (local dev): zips `77001,77002,77003`, still `DELIVERY_ENABLED=false`.
- Marketing FAQ: *"On select days we'll be live on delivery apps or pickup-only
  depending on the spot."* (`FAQ.tsx:28`)

**Revised 2026-08-26 after `e-menu.png`.** The current menu board carries
**GrubHub, DoorDash and Uber Eats** logos next to the website address. So both
things are true and they were never in conflict:

- **First-party delivery is off** — Bucket Baddie's own site does not deliver.
  `DELIVERY_ENABLED=false` is correct, the $4.99 fee is dormant, and the owner's
  "pickup only" answer stands *for ordering direct*.
- **Third-party delivery is live** on three apps, printed on the customer-facing
  menu. The FAQ's *"select days we'll be live on delivery apps"* is not stale
  after all.

**RESOLVED — owner confirmed 2026-08-26: all three apps are live.** The AI names
GrubHub, DoorDash and Uber Eats for delivery and says ordering direct is pickup
only. `FAQ.tsx:28` is accurate after all and needs no correction.

## 9. Phone numbers — three of them, one fake

| Number | Where | Read |
|---|---|---|
| **(832) 650-1126** | `BucketBaddieFooter.vue:120`, `Home.vue:391`, `Contact.vue:106` | The published customer line |
| **(832) 219-8320** | `Privacy.vue:295`, `Terms.vue:77,217,377` | Legal / support contact |
| (713) 555-0123 | `BucketBaddieLayout.vue:698`, `Challenge.vue:818` | **Placeholder — 555 is a reserved fake range.** Live on the site. Worth fixing regardless of this project. |

No existing IVR, voicemail or answering service found in either repo.

## 10. Other things a caller might ask about

- **The wing challenge.** `challengers` (name, location, `completion_seconds`,
  `completed_at`, `is_published`) drives a leaderboard, and `challenge_waivers`
  implies a signed waiver is required. `Challenge.vue` exists. Rules, price and
  entry conditions are **not** in the schema — UNKNOWN.
- **Catering.** FAQ says yes — parties, corporate events, car meets — handled
  *"via the waitlist form or email"* (`FAQ.tsx:20`). No catering pricing exists.
  This is a take-a-message path.
- **Coupons.** `is_public` suggests some are advertisable.
- Contact email on the marketing site is `collab@bucketbaddie.com`
  (`OrderForm.tsx:118`), which is an influencer address, not support.
  `MAIL_FROM_ADDRESS` is still the Laravel default `hello@example.com`.

## 11. Compliance

Texas (one-party consent), same as TLP, so the existing "This call may be
recorded for quality purposes" line carries over. `Privacy.vue` and `Terms.vue`
exist on the site. No SMS consent program for this brand — note that Bucket
Baddie is presumably one of the four EINs in
`docs/sms-multi-brand-todo.md`, and its 10DLC brand is a separate track.

## 12. Who owns price changes

Prices live in the database (`products`, `product_sizes`) and sync to Square —
**not** in code. This differs from TLP, where `lib/tlp-pricing.ts` is a
hand-maintained constant. A hardcoded BB pricing constant would drift the moment
someone edits the admin UI.

---

## DECISIONS (owner, 2026-08-26)

1. **Scope: message-only.** Same shape as TLP — answers questions, quotes the
   menu, takes a message. It does **not** touch `orders`, Square, or the
   Laravel app at all. So the §7 finding about `orders.customer_phone` is
   deferred capability, not v1 scope, and no BB API endpoint is needed yet.
2. **Number: (832) 650-1126** — the published customer line from the footer,
   homepage and contact page. Porting vs forwarding still to confirm.
3. **Hours: the `fulfillment.php` table is the real store hours.** The AI quotes
   them for both "are you open?" and online ordering. Consequence: the marketing
   site's *"Open Daily (Check IG for times)"* (`Locations.tsx`) is **wrong** and
   contradicts Monday = closed. Fix it on the site — outside this project, but
   it will generate calls the AI then has to correct.
4. **Delivery: pickup only.** Production config is correct; the FAQ is stale.
   The AI never quotes the $4.99 fee and never implies delivery. `FAQ.tsx:28`
   should be corrected on the site.

Because scope is message-only, the AI's ceiling is the same as TLP's: it cannot
book, cannot order, cannot transfer, cannot check an order. Every one of those
needs the explicit "do not imply otherwise" treatment in the instructions block
— the TLP post-mortem is exactly that lesson.

### Build decisions

5. **One shared Telnyx assistant**, not a second. `AI_AGENT_LABELS` is already a
   list and `brand_name` / `brand_label` already ride along
   (`lib/telnyx/voice-orchestrator.ts:146`), so `TELNYX_AI_ASSISTANT_ID` stays a
   scalar. The work is making `{{ pricing }}` resolve per brand in
   `app/api/webhooks/telnyx/ai/variables/route.ts` instead of always calling
   `pricingText()`, and one instructions block written against `{{ brand_name }}`.
   Split later if BB ever gets order-taking.
6. **Separate Slack channel for BB.** New webhook URL needed. `buildAISummaryMessage`
   is brand-agnostic; only the destination changes, so this is a routing change
   in `lib/slack.ts`, not a message-format change.
7. **Cutover: forward (832) 650-1126 to a new Telnyx number.** Reversible in
   minutes. ⚠️ Verify what caller ID arrives on a forwarded leg before anyone
   depends on it — if the forwarding carrier presents its own number rather than
   the caller's, the deferred order-status-by-caller-ID capability (§7) is dead
   on arrival and would need porting after all. Worth testing during build even
   though v1 doesn't use it.
8. **Public coupons: the AI reads them out.**

   This one has a consequence worth stating plainly, because it contradicts
   decision 1. Message-only was meant to keep the AI isolated from the Laravel
   app entirely — no reads, no writes, no shared failure mode. Reading live
   coupons means `/api/webhooks/telnyx/ai/variables` now needs a read path into
   the BB database or an endpoint on the Laravel app, on the critical path of
   every BB call. Three things follow:

   - It needs its own fail-safe. If the coupon read fails, the call must proceed
     with no promos mentioned — never a hang, never a half-list. Same pattern as
     `failSafe()` in the variables route today, which already keeps quoting
     prices when presence lookup dies.
   - Coupon **expiry and eligibility copy must be exact**. A promo quoted without
     its conditions is an argument at the counter. If the `coupons` rows don't
     carry human-readable terms, that text has to be written before this ships.
   - It is the one part of v1 that can go stale mid-call. Everything else is a
     static constant.

   Recommend building v1 with coupons behind a flag, dark on first calls, and
   turning it on once the rest is proven. Says nothing false in the meantime.

## Content gaps — RESOLVED 2026-08-26

### 1. The Ghost Mode Challenge (`resources/js/pages/Challenge.vue`)

**Free to enter** — `entryPrice = 'Free'` (`:62-63`), and the FAQ says
*"completely free to enter"* (`:128`). The site's "$75+ value" framing is a
marketing total, not a price; the AI should not repeat value claims as fact.

Ten Ghost Mode wings — ghost pepper and reaper — in **5 minutes**. Timer starts
on the first bite. No drinks of any kind, no ranch or dip, no leaving the table,
finish every wing and all the sauce, no sharing. Staff decision is final.
**18+ and the waiver must be signed before starting.** Waiver location is
`10410 S Main St, Houston, TX 77025` (`:143`) — which independently confirms the
address the Laravel env is missing.

| | Gets |
|---|---|
| **Winners** | Ghost Mode Winner shirt · photo on the Wall of Flame · Bucket Baddie social feature · **free small combo voucher** · entry into the monthly $100 giveaway |
| **Everyone, win or lose** | The 10 wings free · weekly free-combo **giveaway entry** · **10% off the next order** (`:129`) |
| **Monthly** | Fastest finisher on the board takes a **$100 gift card**; board resets on the 1st (`:109`) |

⚠️ **Confusable, and the AI must not blur it:** a winner gets a free small combo
*voucher*; a loser gets an *entry into a weekly giveaway*. Those are not the same
prize. The 10% off next order applies either way.

### 2. Catering — take a message, and flag it

Owner decision: the AI does not quote catering. It takes the caller's details and
the request goes into the `knowledge_gaps` field so it surfaces under
⚠️ *What we're missing* in the Slack summary and someone calls back. That reuses
the existing mechanism in `lib/slack.ts` — no new plumbing.

### 3. Coupon fields — richer than expected

`coupons` (`2026_06_08_213046`, `2026_08_07_103847`, `2026_08_24_114547`):
`code` (unique), `name`, `type` ∈ **percentage | fixed | free_item**, `value`
(nullable), `free_product_id` → `products`, **`redeemable_weekdays` (json)**,
`max_uses`, `max_uses_per_customer`, `starts_at`, `expires_at`, `is_active`,
`is_public`.

Owner said to speak the expiry and what it gives. Two fields make that
insufficient on their own:

- **`redeemable_weekdays`** — a coupon can be valid only on certain days. Reading
  out a Tuesday-only deal on a Saturday call is precisely the counter argument
  decision 8 was warned about. **The AI must speak the day restriction whenever
  it is set.**
- **`type` has three values, not two.** `fixed` is a flat dollar amount off,
  which the owner's "food or % off" framing skips. All three need spoken forms.
- `max_uses_per_customer` and `starts_at` do not need speaking, but a coupon
  whose `starts_at` is in the future must not be read out at all.

Filter for the read: `is_public AND is_active AND (starts_at IS NULL OR
starts_at <= now) AND (expires_at IS NULL OR expires_at > now)`.

## Lower priority

- Legal entity name (needed for BB's 10DLC brand, not for voice — see
  `docs/sms-multi-brand-todo.md`).
- A real support email. `MAIL_FROM_ADDRESS` is still Laravel's
  `hello@example.com` default and the only public address is
  `collab@bucketbaddie.com`, which is for influencers.
- Whether `www.bucketbaddie.com` is deployed and taking orders today. Changes
  nothing in a message-only build, but decides whether the AI may point callers
  at the site to order.
- `(713) 555-0123` is a placeholder number live on two site pages
  (`BucketBaddieLayout.vue:698`, `Challenge.vue:818`). Unrelated to this build,
  but it is a fake number in front of customers.

## Biggest risk

The price collisions in §5. Three different price points each name two
different products, and the TLP assistant is instructed to quote a price once
and never restate it. A caller who says "yeah, the sixteen ninety-nine" and
receives 15 wings when they wanted 8 tenders is a wrong order that reaches the
kitchen. The BB instructions block needs an explicit rule — never accept a price
as an order, always confirm wings or tenders — that TLP's has no equivalent of.
