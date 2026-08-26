# BucketBaddie AI receptionist — discovery prompt

Paste the fenced block below into a Claude Code session opened **in the
BucketBaddie repo/directory**. It produces `BB-AI-DISCOVERY.md` in that repo;
bring that file back here and the BB receptionist build starts from it.

Why a discovery pass at all: the TLP receptionist took its worst damage from
*unknowns treated as knowns* — a transfer tool that did not exist, a
`test wash` priced at $1.00 sitting in the same table as live rows, and
marketing copy that contradicts itself about Commercial Wash. Every section
below exists because one of those bit us.

---

```
You are doing DISCOVERY ONLY for a second AI phone receptionist. Write no
feature code and change no behaviour in this repo. The single deliverable is a
new file, BB-AI-DISCOVERY.md, at the repo root.

CONTEXT
We already run an AI phone receptionist for another brand ("The Launch Pad", a
car wash) on Telnyx AI Assistants, from a separate Next.js repo. It answers
questions, quotes prices from a code-held pricing constant, and takes a
message. It cannot book and cannot transfer. We now want the same thing for
BucketBaddie, and I need to know exactly what BucketBaddie's version has to say
and do.

You know this repo; I do not. Go find the answers.

RULES — these matter more than completeness
1. Never guess, never round, never infer a price, a service name, or an hour of
   business. An unknown recorded as "UNKNOWN — ask owner" is worth more to me
   than a plausible answer, because a plausible answer gets spoken to a real
   caller as fact.
2. Cite file:line (or table.column) for every fact you take from this repo.
   Facts with no citation go in the "from marketing copy / unverified" bucket.
3. When two sources disagree, record BOTH and mark it CONTRADICTION. Do not
   pick a winner. Our existing brand has exactly this — prose says one thing,
   the feature bullets say another, and it is still unresolved.
4. If pricing lives in a database, distinguish LIVE rows from scratch/test/
   inactive rows and say which column decides. Report any row that looks like
   test data — implausible price, junk text, obvious placeholder — by name.
5. Quote exact strings for anything the AI will speak. Service names especially:
   the assistant is instructed never to shorten, pluralise, or invent one.

WHAT TO FIND — use these as the headings of BB-AI-DISCOVERY.md

## 1. The business, in one paragraph
What BucketBaddie sells, to whom. The name as it should be SPOKEN on the phone
(may differ from the legal name — give both if you find both). Hours,
locations, service area, with citations. Say so plainly if none exist here.

## 2. Services and prices
Every sellable thing: exact name, price, duration, what is included, what is
explicitly NOT included. Table form. Where they live in the codebase (file,
table, CMS) and what makes a row live.

## 3. Recurring plans / memberships / subscriptions
Price, any first-time or promotional price, what is included, who qualifies,
and whether the discount applies to renewals. State the eligibility rule
exactly as written in the source.

## 4. Which offering fits which customer
Any rule that steers a caller to one tier over another — customer type,
property size, vehicle type, volume, commercial vs residential. Also any tier a
given customer is NOT allowed to buy.

## 5. Confusable pairs
Two offerings with similar names but different contents, or the same word
meaning different things across tiers. List each pair and the exact difference.
If you find none, say so explicitly — do not leave the section out.

## 6. What the receptionist must NOT claim
Anything a caller could reasonably ask for that this business cannot deliver
over the phone, or that must not be promised without a human. Include anything
where a wrong promise costs real money or a wasted trip.

## 7. Booking
Is there a booking/scheduling system in this repo? Name it, and say whether it
has an API or a callable function a server could use. If yes: what does
creating a booking require (fields, auth, availability check), and is there a
sandbox? If no, say NO BOOKING SYSTEM. Our other brand's assistant is forbidden
from implying a booking was made; I need to know whether BucketBaddie gets the
same restriction.

## 8. Reaching a human
Any phone numbers, SIP addresses, escalation paths, or on-call/staff routing in
this repo. Who should a caller reach when the AI cannot help, and by what route.

## 9. Phone numbers and existing telephony
Any BucketBaddie phone number that appears anywhere in this repo, and any
existing call handling (IVR, voicemail, forwarding, answering service, a
different provider). Note each number's current published use — the number on
the website is the one callers dial.

## 10. Data the AI could look up mid-call
Any per-customer state a caller might phone about — order status, account,
pickup or delivery schedule, balance, appointment. For each: the table or API,
and what identifier a caller could supply out loud (phone number? order id?).
This is scoping only; I am not asking you to build it.

## 11. Compliance and consent
Any existing recording notice, terms, privacy page, SMS consent, or state the
business operates in. Our other brand opens with "This call may be recorded for
quality purposes" — tell me whether BucketBaddie has an equivalent already and
which state's law applies.

## 12. Who owns changes
Who updates prices, how often, and through what surface (code deploy, CMS,
admin UI, spreadsheet). If prices change weekly, a hardcoded constant is the
wrong design and I want to know now.

## 13. UNKNOWNS — ask the owner
A numbered list of every question this repo could not answer, phrased so the
business owner can answer it directly without seeing any code. Put the ones
that block a first working version at the top and mark them BLOCKING. This
section is the most valuable part of the file; do not pad it, and do not skip
it because the rest looks complete.

FORMAT
Markdown. Tables where the data is tabular. Every factual claim either carries a
file:line citation or sits under a heading that marks it unverified. End the
file with a one-paragraph "biggest risk" note: the single thing most likely to
make this receptionist say something false to a caller.
```

---

## If BucketBaddie has no codebase

Skip the prompt and answer §1–§13 with the owner directly — the headings work
as an interview script unchanged. Sections 2, 3, 5, 6 and 7 are the ones that
must be right before a single call is answered.

## What we decide back here once that file lands

**The fork: one shared Telnyx assistant, or a second one.**

Today `aiAgentSettings()` reads a single `TELNYX_AI_ASSISTANT_ID`
(`lib/telnyx/ai-agent.ts:31`), while `AI_AGENT_LABELS` is already a list and
`brand_name` / `brand_label` already ride along as dynamic variables
(`lib/telnyx/voice-orchestrator.ts:146`). So a shared assistant is nearly free:
make the variables webhook brand-aware so `{{ pricing }}` resolves per brand
instead of always calling `pricingText()`
(`app/api/webhooks/telnyx/ai/variables/route.ts:22`), and write one instructions
block that speaks `{{ brand_name }}`.

A second assistant costs an env-shape change (a label→assistant-id map) plus a
second sync script and insight group. It is only worth it if BucketBaddie's call
handling differs *in kind* — it can book, or it transfers, or it needs tools TLP
does not have. §7, §8 and §10 above are what settle that.

Three smaller items fall out of the same file:

- `lib/tlp-pricing.ts` becomes a per-brand module behind a registry, keeping the
  `pricingText()` shape so the assistant needs no change.
- Slack: same webhook as TLP, or a BucketBaddie channel. `buildAISummaryMessage`
  is brand-agnostic already; only the destination is a decision.
- The BB number's `phone_numbers.label` must be added to `AI_AGENT_LABELS`, and
  the label→spoken-name pair to `AI_BRAND_NAMES`, or the AI never picks up.
