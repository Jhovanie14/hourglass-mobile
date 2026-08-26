# TODO (after Hourglass approval): multi-brand SMS opt-in

**Do NOT start this until the Hourglass Investments LLC 10DLC campaign is
APPROVED.** Reason below.

## Context

The owner runs 4 businesses. They share one owner but have **different EINs**, so
to the carriers / TCR they are **4 separate brands**. 10DLC registration is per
legal entity (per EIN), not per owner. Each brand therefore needs its own:

- TCR **brand** registration (~$4 one-time each)
- **10DLC campaign** (its own $15 reviews)
- **opt-in form** + **terms/privacy page** branded to that exact legal entity
  (a reviewer who sees the wrong company name on the form will reject it)
- real **contact email + phone** in the HELP message

Business #1 (Hourglass Investments LLC) is already built and live:
`/sms-signup` + `/sms-terms`, campaign submitted for review.

## ⚠️ Hard constraint — never break the submitted URL

The Hourglass campaign was submitted referencing **`https://www.megestic.com/sms-signup`**
(no slug). A reviewer opens that exact URL. The refactor below MUST keep that URL
working unchanged. Approach is **additive**:

- Keep `/sms-signup` and `/sms-terms` exactly as-is = the Hourglass pages.
- Add NEW routes for the other 3 businesses only.
- Don't touch the live files while a review is in flight (a bad deploy = $15 lost).

## Planned approach (config-driven, additive)

1. Add `lib/sms-businesses.ts` — one entry per business:
   `{ slug, legalName, contactEmail, contactPhone, numbers: string[] }`.
   Hourglass is the first entry, pinned to the no-slug URL as a special case.
2. New routes for the other brands: `/sms-signup/[slug]` and `/sms-terms/[slug]`,
   rendering the same components but reading copy/contact from the config.
3. Refactor the existing form/terms/API to read Hourglass values from the same
   config (without changing its URL or output).
4. Add a `business_slug` (or similar) column to `sms_consents` and
   `sms_opt_outs` so all 4 programs stay separated in one table. Stamp it in
   `/api/sms-opt-in` and the webhook.
5. Per business, produce a campaign-resubmission copy doc like
   `docs/10dlc-campaign-resubmission.md` (message flow w/ that brand's form URL,
   HELP w/ that brand's contact, samples, STOP/opt-in confirmations).

## Info needed before building (per other business)

For each of the 3 remaining businesses:
1. Exact **legal name** (as registered to the EIN / TCR)
2. **Contact email** for SMS support
3. **Contact phone** (published business line)
4. Which **Telnyx number(s)** belong to that business

## Meanwhile (safe, no code)

Owner can start the **TCR brand registrations** for the other 3 EINs in the
Telnyx/TCR portal now — that's portal work with no risk to the live page.
