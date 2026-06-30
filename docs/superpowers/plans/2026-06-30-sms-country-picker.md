# SMS Recipient Country-Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make outbound SMS recipient numbers always resolve to valid E.164 (via a country-picker UI + a shared validator) so Telnyx error `40310` can no longer be caused by a mistyped number.

**Architecture:** Add a small shared validator (`lib/phone.ts`) wrapping `libphonenumber-js`. Use it server-side in `sendMessage`/`resendMessage` as a hard guard before the Telnyx fetch, and client-side in the compose modal where a `react-phone-number-input` picker (default country US) produces clean E.164 and blocks invalid input before any server call.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Tailwind v4, shadcn `Input`, `react-phone-number-input` + `libphonenumber-js`.

## Global Constraints

- E.164 means `+` + country code + national number, no spaces/dashes (regex reference already in repo: `app/dashboard/settings/phone-numbers/actions.ts:8` → `/^\+[1-9]\d{7,14}$/`). Authoritative validation in this plan is `libphonenumber-js`, not the regex.
- Default picker country: **US**.
- Test runner: `npm test` (vitest). Type check: `npm run typecheck`. Build: `npm run build`.
- Test style: `import { describe, it, expect } from "vitest"` (see `lib/sms-consent.test.ts`).
- Do NOT change the in-thread reply box (`chat-view.tsx`) or the inbound webhook. The server-side guard covers the in-thread path.

---

### Task 1: Shared E.164 validator + dependencies

**Files:**
- Create: `lib/phone.ts`
- Test: `lib/phone.test.ts`
- Modify: `package.json` (add deps)

**Interfaces:**
- Consumes: `libphonenumber-js` `isValidPhoneNumber`.
- Produces: `isValidE164(value: string | null | undefined): boolean` — exported from `lib/phone.ts`. Returns `true` only for full, valid international E.164 numbers.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install react-phone-number-input libphonenumber-js
```
Expected: both added to `package.json` `dependencies`, no peer-dep errors.

- [ ] **Step 2: Write the failing test**

Create `lib/phone.test.ts`:
```ts
import { describe, it, expect } from "vitest"
import { isValidE164 } from "./phone"

describe("isValidE164", () => {
  it("accepts valid US and PH numbers in E.164", () => {
    expect(isValidE164("+12109348999")).toBe(true)
    expect(isValidE164("+639171234567")).toBe(true)
  })

  it("rejects numbers missing the + / country code", () => {
    expect(isValidE164("12109348999")).toBe(false)
    expect(isValidE164("09171234567")).toBe(false)
    expect(isValidE164("2109348999")).toBe(false)
  })

  it("rejects junk, empty, and nullish values", () => {
    expect(isValidE164("nope")).toBe(false)
    expect(isValidE164("+123")).toBe(false)
    expect(isValidE164("")).toBe(false)
    expect(isValidE164(null)).toBe(false)
    expect(isValidE164(undefined)).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- lib/phone.test.ts`
Expected: FAIL — cannot resolve `./phone` / `isValidE164` is not defined.

- [ ] **Step 4: Write minimal implementation**

Create `lib/phone.ts`:
```ts
import { isValidPhoneNumber } from "libphonenumber-js"

/**
 * Returns true only when `value` is a complete, valid international phone
 * number in E.164 form (e.g. "+12109348999"). Used by both the compose UI
 * and the server send actions so Telnyx never receives a malformed `to`
 * address (Telnyx error 40310).
 *
 * libphonenumber-js treats a string as international only when it starts
 * with "+", so national-format inputs (no "+") correctly return false.
 */
export function isValidE164(value: string | null | undefined): boolean {
  if (!value) return false
  try {
    return isValidPhoneNumber(value)
  } catch {
    return false
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- lib/phone.test.ts`
Expected: PASS (all 3 cases).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/phone.ts lib/phone.test.ts
git commit -m "feat: add isValidE164 phone validator + phone-input deps"
```

---

### Task 2: Server-side E.164 guard in send actions

**Files:**
- Modify: `app/dashboard/conversations/actions.ts` (`sendMessage` and `resendMessage`)

**Interfaces:**
- Consumes: `isValidE164` from `@/lib/phone` (Task 1).
- Produces: no new exports. `sendMessage` and `resendMessage` now return `{ ok: false, error }` when the destination number is not valid E.164, before any Telnyx fetch.

- [ ] **Step 1: Add the import**

In `app/dashboard/conversations/actions.ts`, add after the existing imports (the block ending with the `Message` type import near the top):
```ts
import { isValidE164 } from "@/lib/phone"
```

- [ ] **Step 2: Guard `sendMessage`**

In `sendMessage`, the current empty-body check is:
```ts
  const trimmed = body.trim()
  if (!trimmed) {
    return { ok: false, error: "Message body is empty." }
  }
```
Immediately AFTER that block, add:
```ts
  if (!isValidE164(to)) {
    return {
      ok: false,
      error: "Enter a valid phone number with country code (e.g. +12109348999).",
    }
  }
```

- [ ] **Step 3: Guard `resendMessage`**

In `resendMessage`, the destination is `conv.contact_number`. The current code fetches `conv` then checks opt-out:
```ts
  if (!conv) return { ok: false, error: "Conversation not found." }

  // Consent guard — never resend to someone who has opted out.
  if (await isOptedOut(conv.contact_number)) {
    return { ok: false, error: "This contact has opted out of text messages." }
  }
```
Between the `if (!conv)` line and the consent guard, insert:
```ts
  if (!isValidE164(conv.contact_number)) {
    return {
      ok: false,
      error: "Stored contact number is not a valid phone number.",
    }
  }
```

- [ ] **Step 4: Type-check**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 5: Confirm existing tests still pass**

Run: `npm test`
Expected: PASS (all existing tests + Task 1 tests; no regressions).

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/conversations/actions.ts
git commit -m "feat: reject non-E.164 numbers in sendMessage/resendMessage"
```

---

### Task 3: Country-picker in the compose modal

**Files:**
- Modify: `components/conversations/compose-modal.tsx`
- Modify: `app/globals.css` (theme overrides for the picker)

**Interfaces:**
- Consumes: `isValidE164` from `@/lib/phone` (Task 1); `PhoneInput` + `react-phone-number-input/style.css` (Task 1 dep); shadcn `Input`.
- Produces: no new exports. The recipient field now holds an E.164 string and blocks invalid input before calling `getOrCreateConversation`/`sendMessage`.

- [ ] **Step 1: Replace the recipient input and add validation**

In `components/conversations/compose-modal.tsx`:

(a) Add imports below the existing `Input` import:
```tsx
import * as React from "react"
import PhoneInput from "react-phone-number-input"
import "react-phone-number-input/style.css"
import { isValidE164 } from "@/lib/phone"
```

(b) Above the `ComposeModal` function declaration, add a shadcn-styled input adapter the picker will render:
```tsx
const PhoneTextInput = React.forwardRef<
  HTMLInputElement,
  React.ComponentProps<"input">
>((props, ref) => <Input {...props} ref={ref} />)
PhoneTextInput.displayName = "PhoneTextInput"
```

(c) In `handleSend`, replace the current recipient validation:
```tsx
    const contact = to.trim()
    if (!contact) return setError("Enter a recipient number.")
    if (!inboxId) return setError("Select an inbox to send from.")
    if (!body.trim()) return setError("Enter a message.")
```
with:
```tsx
    const contact = to.trim()
    if (!contact) return setError("Enter a recipient number.")
    if (!isValidE164(contact)) {
      return setError("Enter a valid phone number with country code.")
    }
    if (!inboxId) return setError("Select an inbox to send from.")
    if (!body.trim()) return setError("Enter a message.")
```

(d) Replace the recipient `<Input>` element:
```tsx
            <Input
              id="compose-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="+63912XXXXXXX"
              autoComplete="off"
            />
```
with:
```tsx
            <PhoneInput
              id="compose-to"
              international
              defaultCountry="US"
              value={to || undefined}
              onChange={(value) => setTo(value ?? "")}
              inputComponent={PhoneTextInput}
              className="phone-input flex items-center gap-2"
              placeholder="Enter phone number"
            />
```

- [ ] **Step 2: Add theme overrides for the picker**

Append to `app/globals.css`:
```css
/* react-phone-number-input — match app theme */
.phone-input .PhoneInputCountry {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0 0.25rem;
}
.phone-input .PhoneInputCountrySelect {
  color: var(--foreground);
  background: transparent;
}
.phone-input .PhoneInputCountrySelectArrow {
  color: var(--muted-foreground);
  opacity: 0.7;
}
.phone-input .PhoneInputInput {
  background: transparent;
}
```

- [ ] **Step 3: Type-check**

Run: `npm run typecheck`
Expected: PASS. (If TS complains about the `country`/`value` types from the library, ensure `value` is typed as `string` and `onChange` coerces `undefined` to `""` as shown.)

- [ ] **Step 4: Build to confirm the client component compiles**

Run: `npm run build`
Expected: build succeeds; the `/dashboard/conversations` route compiles with no module/CSS errors.

- [ ] **Step 5: Manual verification**

Start `npm run dev`, open the conversations page, click compose:
- Picker shows with US flag/`+1` selected by default.
- Typing `2109348999` shows formatted; value sent is `+12109348999`.
- Switch country to Philippines, type `9171234567` → value `+639171234567`.
- Clearing the field / entering an incomplete number shows the inline "valid phone number" error and does NOT create a conversation or send.
- A valid number sends and the message appears in the thread.

- [ ] **Step 6: Commit**

```bash
git add components/conversations/compose-modal.tsx app/globals.css
git commit -m "feat: country-picker recipient input in compose modal"
```

---

## Self-Review

**Spec coverage:**
- Compose modal picker (`PhoneInput`, default US) → Task 3. ✓
- Server-side guard in `sendMessage` + `resendMessage` → Task 2. ✓
- Shared validator reused client + server → Task 1 (`isValidE164`). ✓
- Styling/theme integration → Task 3 Step 2. ✓
- In-thread send unchanged, covered by server guard → Task 2 (no `chat-view.tsx` edit). ✓
- Dependencies added → Task 1 Step 1. ✓
- Testing (validator unit tests; manual modal verification) → Task 1 + Task 3 Step 5. ✓

**Placeholder scan:** No TBD/TODO; all code shown inline. ✓

**Type consistency:** `isValidE164(value: string | null | undefined): boolean` defined in Task 1 and used identically in Tasks 2 and 3. `to` state stays `string`; `onChange` coerces `undefined`→`""`. ✓
