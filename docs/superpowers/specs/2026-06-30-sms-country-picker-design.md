# SMS Recipient Country-Picker — Design

**Date:** 2026-06-30
**Status:** Approved

## Problem

Outbound SMS sends fail with Telnyx error `40310` ("Invalid 'to' address — should be a
single valid number") whenever the recipient number is not in clean E.164 format. The
compose modal currently passes whatever the user typed (only `.trim()` applied) straight
to `sendMessage`, which forwards it to Telnyx with no normalization or validation. A
forgotten `+`, a missing country code, or a local format like `09171234567` silently
produces a failed message.

Confirmed in production: a US number sent only after manually prefixing `+1`. E.164 (the
`+`, country code, then number, no spaces) is mandatory for Telnyx.

## Goal

Make recipient numbers always resolve to valid E.164 before reaching Telnyx, so a
mistyped number cannot cause a `40310` failure. Provide an explicit country selector so
users never have to remember dial codes.

## Approach

Use `react-phone-number-input` (peer dependency `libphonenumber-js`) in the compose
modal. It renders a searchable flag + dial-code dropdown, formats the number as the user
types, and outputs a clean E.164 string. It also exports `isValidPhoneNumber()` for
validation. Add a server-side E.164 guard as defense-in-depth.

Default country: **United States (`+1`)**.

## Components & Changes

### 1. `components/conversations/compose-modal.tsx`
- Replace the plain recipient `<Input>` with `<PhoneInput defaultCountry="US">` from
  `react-phone-number-input`.
- `to` state now holds an E.164 string directly (the library's value format). Remove the
  `.trim()` parsing.
- Pass a custom `inputComponent` that wraps the shadcn `Input` so the field matches the
  rest of the form.
- Before send: guard with `isValidPhoneNumber(to)`. If invalid, set the inline error and
  do **not** call `getOrCreateConversation` / `sendMessage`.

### 2. `app/dashboard/conversations/actions.ts`
- Add a server-side E.164 validation guard near the top of `sendMessage` (after the empty-
  body check) and in `resendMessage` (the `to` there is `conv.contact_number`). Use
  `isValidPhoneNumber` from `libphonenumber-js`. Return `{ ok: false, error }` with a clear
  message if the number is not valid E.164, before any Telnyx fetch.

### 3. Styling
- Import the library's base CSS once (e.g. in the modal or a global import) and override to
  match the existing theme tokens (border, background, dark/light). The custom
  `inputComponent` handles most of the visual integration.

## What Does NOT Change
- The in-thread reply box (`chat-view.tsx`) sends to `selected.contact_number`, which is
  already stored as E.164 (from the inbound webhook, or from a now-validated compose flow).
  No UI change there; the new server-side guard in `sendMessage` covers it regardless.
- The inbound webhook and `phone_numbers` settings are untouched.

## Data Flow

```
PhoneInput (defaultCountry US)
  → E.164 string (e.g. +15551234567)
  → getOrCreateConversation + sendMessage
  → server-side isValidPhoneNumber guard
  → Telnyx /v2/messages
```

Contact numbers stay consistently E.164 in the DB.

## Error Handling
- Invalid number in compose: inline error in the modal, no server call.
- Invalid number reaching the server (UI bypassed): `sendMessage`/`resendMessage` return a
  clear error, no Telnyx call.

## Testing
- Unit-test the server-side validation guard: valid US (`+15551234567`) and PH
  (`+639171234567`) pass; local format (`09171234567`), missing `+`, and junk are rejected.
- Verify the compose modal builds and renders the picker with the US default.

## Dependencies
- `react-phone-number-input`
- `libphonenumber-js` (peer)
