# TLP AI Receptionist — Assistant Instructions

**Do not paste this file into the Telnyx portal.** Run `npm run sync:assistant`
instead: it extracts the fenced block in §1 — and nothing else — and PUTs it to
the assistant's `instructions` field, along with the call-summary insight. Use
`npm run sync:assistant -- --dry-run` to see what it would send.

That script exists because the manual step went wrong. On 2026-08-19 the live
assistant was found holding all 8,282 characters of this document: the "paste
the block" instruction, the `[OPTIONAL]` policy notes, the open questions, the
lot. The AI had been reading its own to-do list back to callers as context,
which is the likeliest reason it sounded generic and hedgy.
`scripts/sync-tlp-assistant.test.mjs` now fails if the extraction ever picks up
the meta text again.

**Decisions to make before syncing:** the block marked `[OPTIONAL]` in §2 is a
policy call, not a technical one. Read §3 first — it explains what the assistant
can and cannot actually do today.

## Dynamic variables it relies on

All three are supplied at conversation start by
`/api/webhooks/telnyx/ai/variables`:

| Variable | Type | Source |
|---|---|---|
| `{{ pricing }}` | text block | `lib/tlp-pricing.ts` → `pricingText()` |
| `{{ agents_available }}` | boolean | `getOnlineReachableAgents()` |
| `{{ targets }}` | array | built for the transfer tool — **unused today**, since no such tool is configured (see §3) |

If the webhook fails, Telnyx falls back to the assistant's **default** values.
Set those defaults to `agents_available: false` and `targets: []`. Leave the
`pricing` default empty — an empty pricing block makes the assistant say it
cannot quote, which is the correct behaviour when we don't know prices.

---

## §1 Instructions block

```
You are the receptionist for The Launch Pad, a car wash. You answer the phone,
answer questions, and take messages. This call may be recorded for quality
purposes.

Keep every reply short and natural — one or two sentences. You are speaking, not
writing: no lists, no bullet points, no reading out punctuation. If a caller
needs several prices, give the two most relevant and offer the rest.

HOW TO BE CONSISTENT
Handle the same request the same way every time.
- Ask one question at a time and wait for the answer.
- Use the exact service names from the pricing block. Never shorten them,
  pluralise them, or invent a name for a service.
- Quote a price once and do not restate it differently later in the call.
- Read every phone number back digit by digit and wait for confirmation.
- When you cannot help, say plainly what you do not have, then offer to take a
  message. Do not apologise repeatedly and do not pad the answer.
- Before the call ends, ask whether there is anything else.

PRICING
Current prices:
{{ pricing }}

Quote only from that block. If a caller asks about a service or a price that is
not in it, say you don't have that one to hand and offer to take a message.
Never estimate, never round, and never invent a price or a service name. If the
pricing block is empty, say you can't quote prices right now and offer to take a
message.

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

BOOKINGS
You cannot book appointments. There is no booking system connected to this
phone line yet. If a caller wants to book, take their name, number, the service
they want and when they'd like to come in, and tell them someone will call back
to confirm. Never say a booking is made, confirmed, reserved, or scheduled, and
never give an appointment time.

TRANSFERS
You cannot transfer this call. You are only on the line because the team's
phones rang first and nobody picked up, and you have no way to reach them from
here. If the caller asks for a person, tell them nobody is available right now,
offer to take a message, and collect their name, number and reason for calling.
Never say you are connecting them, putting them through, transferring them, or
finding someone — you are not, and the caller will be left listening to silence.

COMMERCIAL VEHICLES
The Quick Service, Express Detail and Self-Service Bay memberships are for
personal vehicles. Tow trucks, 8 ft and 9 ft bed trucks and sprinter vans need
the Commercial Wash plan instead — quote that from the pricing block.

Commercial Wash is an exterior wash: hand wash, wheels and tires shine, towel
dry, unlimited washes. Do not tell a commercial caller that interior cleaning is
included. If they ask specifically about interior work on a commercial vehicle,
say you'll have someone confirm what's covered, and take a message.

TAKING A MESSAGE
Collect name, callback number, and the reason for calling. Read the number back
to confirm it. Keep it brief.

WHAT NOT TO DO
Do not discuss anything outside The Launch Pad's services. Do not speculate
about hours, locations, staffing or policies you have not been told. If you do
not know something, say so and offer to take a message. It is always better to
say "I don't have that" than to guess.
```

---

## §2 Policy blocks

### Membership upsell — ENABLED (2026-08-18, client decision)

Now part of the §1 block, in the PRICING section. Nothing extra to paste.

The claim it makes is true at both price points: Express Detail is $59.99/month
full price and $53.99 for a first-time member, and both beat a single $65 Express
Complete Detail. Quick Service at $35.99 breaks even against two $25 Quick
Exterior Washes.

Expect this to convert some one-time jobs into subscriptions. That is the point,
but it does trade same-day revenue for recurring revenue — worth watching in the
first month. To disable, delete that paragraph from §1; nothing else depends on
it.

### `[OPTIONAL]` Recording disclosure

The §1 block already opens with "This call may be recorded for quality
purposes." Texas is one-party consent, but callers can be anywhere. Remove the
sentence only if you have decided you don't want it.

---

## §2.5 When the assistant actually picks up (changed 2026-08-19)

It no longer answers every TLP call. Agents ring first, and the assistant only
takes the call where the caller would otherwise have reached voicemail:

1. Nobody online in the web app and no mobile device flagged available.
2. Every agent dial failed.
3. Agents rang but nobody answered within `AI_AGENT_RING_TIMEOUT_SECS`
   (default 20s; non-AI brands still ring 25s and still go to voicemail).

Two consequences worth knowing:

- **There is no transfer tool at all** (verified 2026-08-22, `tools: []`), and
  even if there were, `agents_available` is a snapshot from the moment the
  assistant starts — false by construction in cases 1 and 2. Only case 3 can
  produce a live call where an agent is online, and only if they came back
  during the conversation. §1 now tells the caller plainly that nobody can be
  reached; Track B replaces that with a live check.
- **The greeting doesn't know the caller waited.** In case 3 someone hears 20
  seconds of ringing and is then greeted as if they'd just dialled. Fixing that
  means passing a dynamic variable on assistant start and branching the greeting
  — not done yet.

## §3 What this assistant can and cannot do

Worth being blunt, because the gap matters operationally.

**It can:** answer questions, quote the prices in `{{ pricing }}`, explain what
each service includes and excludes, and take a message.

**It cannot:**

0. **Transfer a call.** Verified against the live assistant on 2026-08-22:
   `tools` is an empty array. The transfer tool designed in
   `docs/superpowers/specs/2026-08-18-tlp-ai-transfer-to-agent-design.md` was
   never added in the portal, so the old TRANSFERS paragraph — "use the transfer
   tool" — described a capability that does not exist. A caller who asked for a
   human was told they were being connected and then heard nothing. §1 now says
   plainly that it cannot transfer. Restoring the capability is Track B:
   `docs/superpowers/specs/2026-08-22-tlp-ai-live-agent-handoff-design.md`.
1. **Book anything.** No booking system is connected. The instructions
   deliberately forbid it from implying otherwise, because a caller who believes
   they have an appointment and turns up to nothing is worse than one who was
   told someone will call back. Closing this is the ecosystem booking
   integration — the separate project already identified.
2. **Confirm whether Commercial Wash includes interior work.** The source copy
   contradicts itself — see §5. The assistant promises exterior only and
   escalates if asked directly.
3. **Know anything not in its instructions** — hours, locations, staff names,
   promotions. Add them here if callers ask for them.
4. **Reach an agent who came online mid-call.** Availability is a snapshot from
   the moment the call connected. See the transfer spec.

## §4 Updating prices

Prices live in `lib/tlp-pricing.ts`, not in this prompt. Change them there and
deploy; the assistant picks them up on the next call with no portal edit.

Only services that are active belong in that file. The source table mixes live
rows with scratch data — including a `test wash` priced at $1.00 — and
`lib/tlp-pricing.test.ts` asserts none of the inactive rows can reach a caller.
If you add a service, add it to the test's expected list too, or the suite will
tell you the file and the prompt have drifted.

## §5 Open: does Commercial Wash include interior cleaning?

The Commercial Wash marketing copy contradicts itself.

Its prose reads: *"Express **exterior** wash for commercial vehicles. Hand wash,
wheels & tires shine, and towel dry unlimited washes built for tow trucks, large
bed trucks, and sprinter vans."*

Its bullet list reads: *"Everything in Quick · **Interior vacuum** · **Interior
wipe-down** · **Windows cleaned** · Unlimited washes · Any vehicle size."*

Those bullets are byte-identical to the Express Detail tier's, which is why they
look like a copy-paste error rather than a real inclusion.

**Currently encoded: exterior only.** `lib/tlp-pricing.ts` deliberately omits the
interior items, and `lib/tlp-pricing.test.ts` asserts they stay omitted so nobody
adds them back without reading this note.

The reasoning is asymmetric risk. If the plan really is exterior-only and the
assistant promised interior work, a commercial driver arrives expecting a vacuum
they were quoted and you either eat the cost or have the argument. If the plan
does include interior work and the assistant under-promised, the customer gets
more than expected.

**To change it:** confirm which is right. If interior is genuinely included, add
the three interior items to the `Commercial Wash` entry's `includes`, drop
`"Exterior only"` from its `notes`, and update the two assertions in the test.

## §6 The Slack summary (added 2026-08-22)

Slack no longer receives the `AI:` / `Caller:` transcript — the agents team
asked for a hand-off note instead, and the transcript stays in the dashboard.

One message per call is built by `buildAISummaryMessage` in `lib/slack.ts` from
a **single structured insight**, defined in `scripts/sync-tlp-assistant.mjs` and
attached to the assistant as the "TLP Receptionist" insight group. One insight
rather than several, because separate insights can arrive half-populated and the
format drifts between calls; one JSON schema cannot.

| Field | Renders as | Empty when |
|---|---|---|
| `why_they_called` | *Why they called* | omitted |
| `what_the_ai_did` | *What the AI did* | omitted |
| `outcome` | *Outcome* | omitted |
| `knowledge_gaps` | ⚠️ *What we're missing* | still printed, as "Nothing flagged" |
| `at_risk` | 💸 *At risk* | omitted |

`knowledge_gaps` prints on **every** call, flagged or not. An absent note reads
as "nothing to report" when what it usually means is "nobody looked", and the
whole point of the section is to show what to add to §1 next.

Two failure modes are handled rather than hidden. If the insight returns prose
instead of the schema — which is what the stock Telnyx "Default" group did until
2026-08-22 — the raw text is posted under *Summary* rather than an empty card.
If Telnyx never generates an insight at all, no Slack message is posted and
`⚠️ AI summary ready but no Slack webhook is configured` / a missing
`📋 AI summary posted` line in the Vercel log is the signal; the call itself is
still complete in the dashboard.

**Changing the fields means changing three things together:** the schema in the
script, `AICallSummary` in `lib/slack.ts`, and the tests in `lib/slack.test.ts`.
