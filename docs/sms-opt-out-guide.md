# How SMS opt-out (stopping consent) works

A customer can withdraw consent at any time. Here's exactly how it's handled,
and what (if anything) your team needs to do.

## The rule

You may text someone **only if they gave consent** (web form, verbal on a call,
or an existing supplier/business relationship). The moment they opt out, you must
stop — and the system enforces this for you.

## The three ways someone can stop

### 1. They reply STOP by text — fully automatic

When a contact texts `STOP` (also `STOPALL`, `UNSUBSCRIBE`, `CANCEL`, `END`,
`QUIT`) to your number:

- **Telnyx** instantly sends the confirmation, adds them to its carrier
  suppression list, and blocks any further texts to that number — even if
  someone on your team tries. This is carrier-mandated and always on.
- **Our app** also notices the STOP in the inbound webhook
  (`app/api/webhooks/telnyx/message/route.ts`) and records a row in
  `sms_opt_outs`, so the dashboard stays in sync with Telnyx.

You do nothing. They can text `START` (or `UNSTOP`) to opt back in, which clears
both Telnyx's suppression and our record automatically.

### 2. They ask a person to stop — voice or in conversation

Sometimes a customer says "stop texting me" on a phone call. Telnyx never sees
this, so **a teammate must record it**:

1. Open the conversation with that contact.
2. Click the **⋮ (More options)** menu in the top-right.
3. Choose **"Mark as opted out."**

From that point, `sendMessage`/`resendMessage` refuse to text that number and
show "This contact has opted out of text messages." To reverse it (e.g. they ask
to start again), use **"Re-subscribe to texts"** in the same menu.

### 3. They opt out via email/HELP

The HELP reply and `/sms-terms` page list `contact@hourglassinvestment.com` and
`+1 210-934-8999`. If someone opts out that way, use the **"Mark as opted out"**
button (step 2 above) so it's recorded and enforced.

## What's enforced automatically

- ❌ Outbound sends to an opted-out number are blocked **in our app** before they
  ever reach Telnyx (`isOptedOut` guard in
  `app/dashboard/conversations/actions.ts`).
- ❌ Even if that guard were bypassed, **Telnyx blocks STOP'd numbers** at the
  carrier level.
- ✅ Never build a "send anyway" path around Telnyx's suppression list.

## Data

`sms_opt_outs` (see `docs/sms-opt-outs.sql`) — one row per suppressed phone.
Service-role only (RLS, no public policies). A row's presence = suppressed;
re-subscribing deletes it. This mirrors Telnyx; Telnyx remains the source of
truth for carrier-level enforcement.
