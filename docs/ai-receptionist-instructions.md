# AI Receptionist — shared assistant instructions

> ## ⚠️ Standing rule: deploy before syncing
>
> This block reads variables the app supplies. Sync it to Telnyx while
> production runs code that doesn't yet send one, and that variable falls back
> to its empty default — silently. A brand would lose whatever policy sat in it,
> on live calls, with no error anywhere.
>
> **Whenever you add a variable to this block: deploy first, then sync.**
>
> **Migrated 2026-08-26.** Code deployed (`f35e6a1`), assistant synced, and the
> shared block verified against the live assistant by call:
>
> | Asked | Required answer | Result |
> |---|---|---|
> | "Can I book a wash for Saturday?" | takes a message, never says booked/confirmed/reserved | ✅ |
> | "I've got a tow truck, can I get Quick Service?" | steers to Commercial Wash | ✅ |
> | "Does Commercial Wash include an interior vacuum?" | exterior only, offers to check | ✅ |
> | "Does Quick Exterior Wash come with tire shine?" | no — that's the membership | ✅ |
>
> All four live only in `TLP_RULES`, so passing them proves `{{ brand_rules }}`
> resolves end to end. Instructions went 4,057 → 2,739 chars.

**Do not paste this file into the Telnyx portal.** Run `npm run sync:assistant`
instead: it extracts the fenced block in §1 — and nothing else — and POSTs it to
the assistant's `instructions` field. `npm run sync:assistant -- --dry-run`
shows what it would send.

That script exists because the manual step went wrong once. On 2026-08-19 the
live assistant was found holding all 8,282 characters of the old TLP document:
the "paste the block" instruction, the policy notes, the open questions, the
lot. The AI had been reading its own to-do list back to callers.

## One assistant, many brands

This block is brand-agnostic. Everything specific to a business arrives as a
dynamic variable, so a Bucket Baddie call never carries The Launch Pad's
membership policy and vice versa.

| Variable | Carries | Source | When empty |
|---|---|---|---|
| `{{ brand_name }}` | spoken name | `AI_BRAND_NAMES`, else the label itself | — |
| `{{ brand_rules }}` | that brand's policy | `lib/pricing/rules.ts` | block reads oddly — treat as a bug |
| `{{ pricing }}` | menu or price list | `lib/pricing/*` per brand | assistant says it can't quote |
| `{{ hours }}` | opening hours | `lib/pricing/hours.ts` | assistant can't confirm hours |
| `{{ open_now }}` | `yes` / `no` / `unknown` | computed in the brand's timezone | treated as `unknown` |
| `{{ coupons }}` | live public deals | BB only, flagged off | assistant says it has no deals |
| `{{ agents_available }}` | presence | `/api/webhooks/telnyx/ai/variables` | `false` |

The assistant's **defaults** are owned by the sync script
(`DYNAMIC_VARIABLE_DEFAULTS`), not the portal, and were applied live on
2026-08-26. Every one degrades to "I don't have that, can I take a message?",
which is the one answer that is never wrong for any brand.

They previously read `brand_name: "The Launch Pad"` and `pricing: null` — the
first greets a chicken shop caller by a car wash's name the one time the
fallback is needed, the second risks rendering the literal string `null` into
the prompt.

The **greeting** stays portal-managed and is deliberately not overwritten by the
sync. It already reads `Hi, thanks for calling {{brand_name}}. …`, which is
brand-agnostic; the sync verifies it still contains `{{brand_name}}` and fails
if someone hardcodes a brand into it.

Two places supply these: `startAIAssistantOnCall` at call-start, where the
brand is certain, and the `/ai/variables` webhook, which tops up presence and
coupons and omits the brand keys when it can't tell who is calling. See
`lib/telnyx/ai-brand-variables.ts` for why both exist.

---

## §1 Instructions block

```
You are the receptionist for {{ brand_name }}. You answer the phone, answer
questions, and take messages. This call may be recorded for quality purposes.

{{ brand_rules }}

Keep every reply short and natural — one or two sentences. You are speaking, not
writing: no lists, no bullet points, no reading out punctuation.

HOW TO BE CONSISTENT
Handle the same request the same way every time.
- Ask one question at a time and wait for the answer.
- Use the exact names from the pricing block. Never shorten them, pluralise
  them, or invent a name for something we sell.
- Read every phone number back digit by digit and wait for confirmation.
- When you cannot help, say plainly what you do not have, then offer to take a
  message. Do not apologise repeatedly and do not pad the answer.
- Before the call ends, ask whether there is anything else.

WHAT WE SELL AND WHAT IT COSTS
{{ pricing }}

Quote only from that block. If someone asks about something that is not in it,
say you don't have that one to hand and offer to take a message. Never estimate,
never round, and never invent a price or a name. If the block is empty, say you
can't quote prices right now and offer to take a message.

HOURS
{{ hours }}

Open right now: {{ open_now }}

If that says no, tell them we're closed and give the next day we're open from
the hours above. If it says unknown, say you can't confirm whether we're open
right now and offer to take a message. Never work the current time out yourself
and never guess. If the hours block is empty, say you can't confirm hours.

DEALS
{{ coupons }}

Mention a deal only if it is in that block. Where a deal is limited to certain
days, say which days in the same sentence — never quote the deal without them.
If the block is empty, say you don't have any deals to hand right now. Never
invent a discount and never guess whether an old code still works.

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
Do not discuss anything outside this business. Do not speculate about hours,
locations, staffing, suppliers or policies you have not been told. If you do not
know something, say so and offer to take a message. It is always better to say
"I don't have that" than to guess.
```

---

## §2 What it can and cannot do, on every brand

**It can:** answer questions, quote from `{{ pricing }}`, give hours and say
whether we're open, read out live deals, and take a message.

**It cannot:**

1. **Transfer a call.** Verified against the live assistant on 2026-08-22:
   `tools` is an empty array. Restoring it is Track B,
   `docs/superpowers/specs/2026-08-22-tlp-ai-live-agent-handoff-design.md`.
2. **Book, order, or check an existing order.** Neither brand has a booking or
   ordering path wired to the phone line. Each brand's `{{ brand_rules }}`
   spells out what to say instead.
3. **Know anything not in its variables.** Add it to that brand's entry in
   `lib/pricing/rules.ts`, not to this block.

## §3 Per-brand notes

- **The Launch Pad** — `docs/tlp-ai-assistant-instructions.md`. That file's §1
  block is now **superseded by this one**; its remaining value is §3–§6, the
  history and the open questions.
- **Bucket Baddie** — `docs/bucketbaddie-ai-assistant-instructions.md` and
  `docs/bucketbaddie-ai-discovery.md`.

## §4 Changing a brand's behaviour

Almost never edit this block. In order of preference:

1. A price or item → the brand's module under `lib/pricing/`.
2. A policy, a thing to refuse, a thing to escalate → that brand's constant in
   `lib/pricing/rules.ts`.
3. Something true of every brand → here, and re-read §2 first.

Then `npm run sync:assistant -- --dry-run`, read the diff, and sync.
