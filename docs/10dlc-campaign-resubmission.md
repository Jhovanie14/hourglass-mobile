# 10DLC Campaign Resubmission — Copy to paste into Telnyx

Campaign: HOURGLASS INVESTMENTS LLC · Use case **Customer Care** ·
Campaign ID `4b30019e-d230-4517-6587-d5b30f554cfd` · TCR `C8TSFXL` ·
Number `+1 210-934-8999`.

This addresses every point in the latest Telnyx rejection:

1. Message flow now references a **verifiable web opt-in form URL** plus the
   literal verbal script.
2. The opt-in form (`https://www.megestic.com/sms-signup`) has a **phone field**,
   a **required SMS-consent checkbox**, full opt-in language, and a privacy link.
3. Inline privacy disclosure on the form + link to the compliant SMS privacy
   policy at `https://www.megestic.com/sms-terms`.
4. HELP reply uses a **real contact** instead of a placeholder.

**Before resubmitting ($15):** deploy this branch and confirm both
`https://www.megestic.com/sms-signup` and `https://www.megestic.com/sms-terms`
load in a private window. Take a screenshot of the sign-up form (showing the
phone field + checked consent box) to attach if Telnyx asks.

---

## Message Flow / CTA field

> End users opt in to Hourglass Investments LLC's Customer Care SMS program in
> one of two ways:
>
> 1. **Web form (primary):** Users visit
>    https://www.megestic.com/sms-signup and enter their full name and mobile
>    phone number, then check a required, un-checked-by-default consent box that
>    reads: "By checking this box and providing my phone number, I agree to
>    receive recurring SMS text messages (account and service updates and
>    two-way customer-care conversations) from Hourglass Investments LLC at the
>    number provided, including messages sent by an automated system. Consent is
>    not a condition of any purchase. Message frequency varies. Message and data
>    rates may apply. Reply STOP to opt out, HELP for help." The form links to
>    our SMS Terms & Privacy Policy at https://www.megestic.com/sms-terms and
>    states that mobile information is never sold or shared with third parties or
>    affiliates for marketing or promotional purposes.
>
> 2. **Verbal (secondary):** During an inbound call to +1 210-934-8999, the
>    representative reads this script: "Would you like to receive text messages
>    from Hourglass Investments LLC about your account and service at this mobile
>    number? Message frequency varies and message and data rates may apply. You
>    can reply STOP at any time to opt out, or HELP for help. Do I have your
>    consent to text you at this number?" Consent is recorded only if the
>    customer says yes.
>
> No mobile opt-in information is shared with third parties or affiliates for
> marketing or promotional purposes. After opt-in, the subscriber receives a
> one-time confirmation message.

## Opt-in confirmation message (sent once after sign-up)

> Hourglass Investments LLC: You're signed up for account & customer-care texts.
> Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to
> cancel.

## HELP keyword reply

> Hourglass Investments LLC SMS support. For help, email
> contact@hourglassinvestment.com or call +1 210-934-8999. Msg & data rates may
> apply. Reply STOP to unsubscribe.

## STOP keyword reply

> You have been unsubscribed from Hourglass Investments LLC messages and will
> receive no further texts. Reply START to opt back in.

## Sample messages

1. > Hourglass Investments LLC: Hi Jane, following up on your call earlier today
   > about your account. Let me know if you have any questions. Reply STOP to opt
   > out.
2. > Hourglass Investments LLC: Your requested document is ready. Reply here and
   > we'll help you with the next steps. Msg & data rates may apply. Reply STOP
   > to opt out.
3. > Hourglass Investments LLC: We missed you on a call. Is now a good time to
   > talk, or would you prefer we text? Reply STOP to opt out.
