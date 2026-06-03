# Voicemail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When no agent answers an inbound call within 30 seconds, automatically trigger a voicemail greeting via Telnyx TTS, record the caller's message, and surface the recording in the Calls page and notification bell.

**Architecture:** A Supabase pg_cron job fires every 15 seconds, finds inbound calls still in `initiated` status older than 30 seconds, and POSTs to `/api/cron/voicemail-check`. That route answers the call via Telnyx Call Control API, speaks a per-phone-number TTS greeting, then starts recording. When recording is saved, Telnyx fires `call.recording.saved` which our voice webhook handles to save the recording URL and notify agents.

**Tech Stack:** Next.js 15, Supabase (pg_cron + pg_net), Telnyx Node SDK (`telnyx.calls.actions.*`), lucide-react, shadcn/ui Textarea

---

## File Map

| Action | File |
|---|---|
| Modify | `types/calls.ts` |
| Modify | `types/conversations.ts` |
| Modify | `types/notifications.ts` |
| Modify | `app/dashboard/settings/phone-numbers/actions.ts` |
| Modify | `app/api/webhooks/telnyx/voice/route.ts` |
| Create | `app/api/cron/voicemail-check/route.ts` |
| Modify | `components/settings/edit-phone-number-modal.tsx` |
| Modify | `components/calls/calls-table.tsx` |
| Modify | `components/notifications/notification-bell.tsx` |

---

## Task 1: Enable pg_cron + pg_net and create the cron job

These are Supabase extensions that enable scheduled SQL jobs and outbound HTTP calls from inside the database.

**Files:** Supabase SQL Editor only

- [ ] **Step 1: Enable extensions**

In Supabase dashboard → Database → Extensions, search for and enable both:
- `pg_cron`
- `pg_net`

Or run in SQL Editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

- [ ] **Step 2: Generate a CRON_SECRET**

Run this in your terminal to generate a random secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy the output. Add it to `.env.local`:

```
CRON_SECRET=<paste the value here>
```

Also add it to your Vercel environment variables (Settings → Environment Variables).

- [ ] **Step 3: Create the cron job in Supabase**

In Supabase SQL Editor, replace `YOUR_DOMAIN` with your actual deployed domain (e.g. `hourglass.vercel.app`) and `YOUR_SECRET` with the value from Step 2:

```sql
select cron.schedule(
  'voicemail-trigger',
  '15 seconds',
  $$
    select net.http_post(
      url := 'https://YOUR_DOMAIN/api/cron/voicemail-check',
      headers := '{"Content-Type": "application/json", "x-cron-secret": "YOUR_SECRET"}'::jsonb,
      body := '{}'::jsonb
    )
  $$
);
```

- [ ] **Step 4: Verify cron job was created**

```sql
select jobname, schedule, command from cron.job;
```

Expected: one row with `jobname = 'voicemail-trigger'`.

---

## Task 2: Update TypeScript types

**Files:**
- Modify: `types/calls.ts`
- Modify: `types/conversations.ts`
- Modify: `types/notifications.ts`

- [ ] **Step 1: Update `types/calls.ts`**

Replace the entire file with:

```ts
export type CallDirection = "inbound" | "outbound"

export type CallStatus =
  | "initiated"
  | "answered"
  | "missed"
  | "declined"
  | "completed"
  | "failed"
  | "voicemail"

export type Call = {
  id: string
  phone_number_id: string
  contact_number: string
  direction: CallDirection
  status: CallStatus
  duration_seconds: number
  telnyx_call_id: string | null
  started_at: string | null
  ended_at: string | null
  created_at: string
  has_voicemail: boolean
  phone_numbers?: {
    id: string
    label: string
    phone_number: string
    color: string
  }
}

export type Voicemail = {
  id: string
  call_id: string
  recording_url: string
  duration_seconds: number
  is_heard: boolean
  created_at: string
}

export type CallStats = {
  total: number
  answered: number
  missed: number
  avgDurationSeconds: number
}

export type PhoneNumber = {
  id: string
  label: string
  phone_number: string
  color: string
}

export type DateRange = "today" | "yesterday" | "7days" | "30days" | "all"
export type StatusFilter = "all" | "answered" | "missed" | "completed" | "failed" | "voicemail"
export type DirectionFilter = "all" | CallDirection
```

- [ ] **Step 2: Update `types/conversations.ts`**

Add `voicemail_greeting` to `PhoneNumber` and `PhoneNumberRecord`. Replace the entire file with:

```ts
export type PhoneNumber = {
  id: string
  label: string
  phone_number: string
  color: string
  is_active: boolean
  voicemail_greeting: string | null
}

/** Full row including timestamps — used by the admin settings page. */
export type PhoneNumberRecord = PhoneNumber & {
  created_at: string
  updated_at: string
}

export type Conversation = {
  id: string
  phone_number_id: string
  contact_number: string
  last_message_at: string | null
  last_message_text: string | null
  unread_count: number
  created_at: string
  phone_numbers?: PhoneNumber // joined
}

export type MessageDirection = "inbound" | "outbound"

export type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "delivery_failed"
  | "received"

export type Message = {
  id: string
  conversation_id: string
  phone_number_id: string
  direction: MessageDirection
  body: string | null
  media_urls: string[] | null
  status: MessageStatus
  telnyx_message_id: string | null
  sent_at: string | null
  created_at: string
}
```

- [ ] **Step 3: Update `types/notifications.ts`**

Replace the entire file with:

```ts
export type NotificationType = "missed_call" | "unread_message" | "voicemail"

export type NotificationMetadata = {
  contact_number: string
  phone_label: string
  phone_color?: string    // present on missed_call
  last_message?: string   // present on unread_message
  duration_seconds?: number // present on voicemail
}

export type Notification = {
  id: string
  type: NotificationType
  reference_id: string
  metadata: NotificationMetadata
  is_read: boolean
  created_at: string
}
```

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add types/calls.ts types/conversations.ts types/notifications.ts
git commit -m "feat: add voicemail to call status, Voicemail type, and notification types"
```

---

## Task 3: Update phone numbers server actions

The `getPhoneNumbers` query and `updatePhoneNumber` need to support `voicemail_greeting`.

**Files:**
- Modify: `app/dashboard/settings/phone-numbers/actions.ts`

- [ ] **Step 1: Update `actions.ts`**

Replace the entire file with:

```ts
"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/server"
import { isAdmin } from "@/lib/auth"

const PATH = "/dashboard/settings/phone-numbers"
const E164 = /^\+[1-9]\d{7,14}$/

type AddInput = {
  label: string
  phone_number: string
  color: string
  is_active: boolean
}

type UpdateInput = {
  label?: string
  color?: string
  is_active?: boolean
  voicemail_greeting?: string | null
}

export async function getPhoneNumbers() {
  const supabase = await createClient()
  const { data } = await supabase
    .from("phone_numbers")
    .select("id, label, phone_number, color, is_active, voicemail_greeting, created_at")
    .order("created_at", { ascending: true })

  return (data ?? []) as {
    id: string
    label: string
    phone_number: string
    color: string
    is_active: boolean
    voicemail_greeting: string | null
    created_at: string
  }[]
}

export async function addPhoneNumber(
  formData: AddInput
): Promise<{ error?: string }> {
  if (!(await isAdmin())) {
    return { error: "You do not have permission to do this." }
  }

  const label = formData.label?.trim()
  const phone = formData.phone_number?.trim()
  const color = formData.color?.trim()

  if (!label) return { error: "Label is required." }
  if (!phone || !E164.test(phone)) {
    return {
      error: "Phone number must be in E.164 format (e.g. +15551234567).",
    }
  }
  if (!color) return { error: "Color is required." }

  const supabase = await createClient()
  const { error } = await supabase.from("phone_numbers").insert({
    label,
    phone_number: phone,
    color,
    is_active: formData.is_active,
  })

  if (error) return { error: error.message }

  revalidatePath(PATH)
  return {}
}

export async function updatePhoneNumber(
  id: string,
  formData: UpdateInput
): Promise<{ error?: string }> {
  if (!(await isAdmin())) {
    return { error: "You do not have permission to do this." }
  }

  const supabase = await createClient()

  if (formData.is_active === false) {
    const { count } = await supabase
      .from("phone_numbers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)

    if ((count ?? 0) <= 1) {
      return { error: "You must have at least one active phone number." }
    }
  }

  const patch: UpdateInput = {}
  if (formData.label !== undefined) patch.label = formData.label.trim()
  if (formData.color !== undefined) patch.color = formData.color.trim()
  if (formData.is_active !== undefined) patch.is_active = formData.is_active
  if (formData.voicemail_greeting !== undefined) {
    patch.voicemail_greeting = formData.voicemail_greeting?.trim() || null
  }

  const { error } = await supabase
    .from("phone_numbers")
    .update(patch)
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath(PATH)
  return {}
}

export async function deletePhoneNumber(
  id: string
): Promise<{ error?: string }> {
  if (!(await isAdmin())) {
    return { error: "You do not have permission to do this." }
  }

  const supabase = await createClient()

  const { data: target } = await supabase
    .from("phone_numbers")
    .select("is_active")
    .eq("id", id)
    .single()

  if (target?.is_active) {
    const { count } = await supabase
      .from("phone_numbers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)

    if ((count ?? 0) <= 1) {
      return { error: "You must have at least one active phone number." }
    }
  }

  const { error } = await supabase.from("phone_numbers").delete().eq("id", id)

  if (error) return { error: error.message }

  revalidatePath(PATH)
  return {}
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/dashboard/settings/phone-numbers/actions.ts
git commit -m "feat: add voicemail_greeting to phone number actions"
```

---

## Task 4: Update voice webhook with new event handlers

Add `call.speak.ended` and `call.recording.saved` to the existing switch statement. Also extend the payload type and add the Telnyx SDK import.

**Files:**
- Modify: `app/api/webhooks/telnyx/voice/route.ts`

- [ ] **Step 1: Replace the entire file**

```ts
import crypto from "crypto"
import Telnyx from "telnyx"
import { createClient } from "@/lib/server"

export const runtime = "nodejs"

type TelnyxCallPayload = {
  call_control_id: string
  call_leg_id: string
  from: string
  to: string
  direction: "incoming" | "outgoing"
  state?: string
  hangup_cause?: string
  start_time?: string
  end_time?: string
  connection_id?: string
  // call.recording.saved fields
  recording_url?: string
  duration_ms?: number
}

type TelnyxVoiceWebhookBody = {
  data: {
    event_type: string
    payload: TelnyxCallPayload
  }
}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  timestampHeader: string | null,
  publicKeyBase64: string
): boolean {
  if (!signatureHeader || !timestampHeader) return false
  try {
    const publicKey = crypto.createPublicKey({
      key: Buffer.concat([
        ED25519_SPKI_PREFIX,
        Buffer.from(publicKeyBase64, "base64"),
      ]),
      format: "der",
      type: "spki",
    })
    return crypto.verify(
      null,
      Buffer.from(`${timestampHeader}|${rawBody}`),
      publicKey,
      Buffer.from(signatureHeader, "base64")
    )
  } catch {
    return false
  }
}

export async function POST(req: Request) {
  const rawBody = await req.text()

  const publicKey =
    process.env.TELNYX_WEBHOOK_PUBLIC_KEY ?? process.env.TELNYX_PUBLIC_KEY

  if (publicKey) {
    const valid = verifySignature(
      rawBody,
      req.headers.get("telnyx-signature-ed25519"),
      req.headers.get("telnyx-timestamp"),
      publicKey
    )
    if (!valid) {
      console.warn("⚠️ Voice webhook signature verification failed")
      return Response.json({ error: "Invalid signature" }, { status: 403 })
    }
  }

  const body = JSON.parse(rawBody) as TelnyxVoiceWebhookBody
  const { event_type, payload } = body.data
  console.log("📞 Telnyx voice event:", event_type, {
    call_control_id: payload.call_control_id,
    direction: payload.direction,
    from: payload.from,
    to: payload.to,
  })

  const supabase = await createClient()

  switch (event_type) {
    case "call.initiated":
      await handleCallInitiated(supabase, payload)
      break
    case "call.answered":
      await handleCallAnswered(supabase, payload)
      break
    case "call.hangup":
      await handleCallHangup(supabase, payload)
      break
    case "call.speak.ended":
      await handleSpeakEnded(supabase, payload)
      break
    case "call.recording.saved":
      await handleRecordingSaved(supabase, payload)
      break
    default:
      console.log("ℹ️ Ignoring voice event:", event_type)
  }

  return Response.json({ ok: true })
}

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

async function handleCallInitiated(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  if (payload.direction === "outgoing") {
    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("id")
      .eq("phone_number", payload.from)
      .eq("is_active", true)
      .maybeSingle()

    if (!phoneNumber) {
      console.warn("⚠️ No active phone number matches from:", payload.from)
      return
    }

    await supabase.from("calls").upsert(
      {
        phone_number_id: phoneNumber.id,
        contact_number: payload.to,
        direction: "outbound",
        status: "initiated",
        telnyx_call_id: payload.call_control_id,
      },
      { onConflict: "telnyx_call_id", ignoreDuplicates: true }
    )
    return
  }

  const toNumber = payload.to
  const { data: phoneNumber } = await supabase
    .from("phone_numbers")
    .select("id")
    .eq("phone_number", toNumber)
    .eq("is_active", true)
    .maybeSingle()

  if (!phoneNumber) {
    console.warn("⚠️ No active phone number matches:", toNumber)
    return
  }

  await supabase.from("calls").upsert(
    {
      phone_number_id: phoneNumber.id,
      contact_number: payload.from,
      direction: "inbound",
      status: "initiated",
      telnyx_call_id: payload.call_control_id,
    },
    { onConflict: "telnyx_call_id", ignoreDuplicates: true }
  )
}

async function handleCallAnswered(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  await supabase
    .from("calls")
    .update({
      status: "answered",
      started_at: payload.start_time ?? new Date().toISOString(),
    })
    .eq("telnyx_call_id", payload.call_control_id)
}

async function handleCallHangup(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  const { data: call } = await supabase
    .from("calls")
    .select("id, status, started_at, direction, phone_number_id")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  const wasAnswered =
    call?.status === "answered" || call?.status === "completed"
  const endedAt = payload.end_time ?? new Date().toISOString()

  let finalStatus: string
  if (wasAnswered) {
    finalStatus = "completed"
  } else if (call?.status === "voicemail") {
    finalStatus = "voicemail"
  } else if (call?.direction === "inbound") {
    finalStatus = "missed"
  } else {
    finalStatus = "failed"
  }

  let durationSeconds: number | null = null
  if (wasAnswered && call?.started_at) {
    durationSeconds = Math.round(
      (new Date(endedAt).getTime() - new Date(call.started_at).getTime()) /
        1000
    )
  }

  await supabase
    .from("calls")
    .update({
      status: finalStatus,
      ended_at: endedAt,
      ...(durationSeconds !== null && { duration_seconds: durationSeconds }),
    })
    .eq("telnyx_call_id", payload.call_control_id)

  console.log(
    `📴 Call ${payload.call_control_id} → ${finalStatus}`,
    durationSeconds != null ? `(${durationSeconds}s)` : ""
  )

  if (finalStatus === "missed" && call?.id && call?.phone_number_id) {
    const { data: phoneNumber } = await supabase
      .from("phone_numbers")
      .select("label, color")
      .eq("id", call.phone_number_id)
      .maybeSingle()

    const { error } = await supabase.from("notifications").insert({
      type: "missed_call",
      reference_id: call.id,
      metadata: {
        contact_number: payload.from,
        phone_label: phoneNumber?.label ?? "Unknown",
        phone_color: phoneNumber?.color ?? "#6b7280",
      },
    })

    if (error) {
      console.error("⚠️ Failed to insert missed_call notification:", error)
    }
  }
}

async function handleSpeakEnded(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  const { data: call } = await supabase
    .from("calls")
    .select("status")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  if (call?.status !== "voicemail") return

  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })

  try {
    await telnyx.calls.actions.recordStart(payload.call_control_id, {
      format: "mp3",
      channels: "single",
    })
    console.log(`🎙 Recording started for call ${payload.call_control_id}`)
  } catch (err) {
    console.error("⚠️ Failed to start recording:", err)
  }
}

async function handleRecordingSaved(
  supabase: SupabaseClient,
  payload: TelnyxCallPayload
) {
  const recordingUrl = payload.recording_url
  const durationMs = payload.duration_ms ?? 0

  if (!recordingUrl) {
    console.warn("⚠️ call.recording.saved has no recording_url")
    return
  }

  const { data: call } = await supabase
    .from("calls")
    .select("id, contact_number, phone_number_id, phone_numbers(label)")
    .eq("telnyx_call_id", payload.call_control_id)
    .maybeSingle()

  if (!call) {
    console.warn("⚠️ No call found for recording:", payload.call_control_id)
    return
  }

  const { error: vmError } = await supabase.from("voicemails").insert({
    call_id: call.id,
    recording_url: recordingUrl,
    duration_seconds: Math.round(durationMs / 1000),
  })

  if (vmError) {
    console.error("⚠️ Failed to insert voicemail:", vmError)
    return
  }

  await supabase
    .from("calls")
    .update({ has_voicemail: true })
    .eq("id", call.id)

  const pn = Array.isArray(call.phone_numbers)
    ? call.phone_numbers[0]
    : call.phone_numbers

  const { error: notifError } = await supabase.from("notifications").insert({
    type: "voicemail",
    reference_id: call.id,
    metadata: {
      contact_number: call.contact_number,
      phone_label: (pn as { label: string } | null)?.label ?? "Unknown",
      duration_seconds: Math.round(durationMs / 1000),
    },
  })

  if (notifError) {
    console.error("⚠️ Failed to insert voicemail notification:", notifError)
  }

  console.log(
    `📬 Voicemail saved for call ${call.id}, duration: ${Math.round(durationMs / 1000)}s`
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/webhooks/telnyx/voice/route.ts
git commit -m "feat: add call.speak.ended and call.recording.saved webhook handlers"
```

---

## Task 5: Create voicemail-check cron route

**Files:**
- Create: `app/api/cron/voicemail-check/route.ts`

- [ ] **Step 1: Create the route file**

```ts
import Telnyx from "telnyx"
import { createClient } from "@/lib/server"

export const runtime = "nodejs"

const DEFAULT_GREETING =
  "Hi, you've reached our team. We're unavailable right now. Please leave a message after the tone."

export async function POST(req: Request) {
  const secret = req.headers.get("x-cron-secret")
  if (secret !== process.env.CRON_SECRET) {
    console.warn("⚠️ voicemail-check: unauthorized request")
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const supabase = await createClient()
  const telnyx = new Telnyx({ apiKey: process.env.TELNYX_API_KEY! })

  const threshold = new Date(Date.now() - 30_000).toISOString()

  const { data: staleCalls } = await supabase
    .from("calls")
    .select("id, telnyx_call_id, phone_numbers(voicemail_greeting)")
    .eq("status", "initiated")
    .eq("direction", "inbound")
    .lt("created_at", threshold)

  if (!staleCalls || staleCalls.length === 0) {
    return Response.json({ ok: true, triggered: 0 })
  }

  let triggered = 0

  for (const call of staleCalls) {
    // Atomic guard — only proceed if this process wins the status update
    const { data: updated } = await supabase
      .from("calls")
      .update({ status: "voicemail" })
      .eq("id", call.id)
      .eq("status", "initiated")
      .select("id")
      .maybeSingle()

    if (!updated) continue

    const pn = Array.isArray(call.phone_numbers)
      ? call.phone_numbers[0]
      : call.phone_numbers
    const greeting =
      (pn as { voicemail_greeting: string | null } | null)
        ?.voicemail_greeting ?? DEFAULT_GREETING

    try {
      await telnyx.calls.actions.answer(call.telnyx_call_id, {})
      await telnyx.calls.actions.speak(call.telnyx_call_id, {
        payload: greeting,
        voice: "female",
        language: "en-US",
      })
      triggered++
      console.log(`🎙 Voicemail triggered for call ${call.id}`)
    } catch (err) {
      console.error("⚠️ Failed to trigger voicemail for call:", call.id, err)
      await supabase
        .from("calls")
        .update({ status: "missed" })
        .eq("id", call.id)
    }
  }

  return Response.json({ ok: true, triggered })
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/voicemail-check/route.ts
git commit -m "feat: add voicemail-check cron route"
```

---

## Task 6: Add greeting field to EditPhoneNumberModal

**Files:**
- Modify: `components/settings/edit-phone-number-modal.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
"use client"

import { useEffect, useState } from "react"
import { Loader2, Lock } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { updatePhoneNumber } from "@/app/dashboard/settings/phone-numbers/actions"
import { ColorPicker } from "./color-swatches"
import type { PhoneNumberRecord } from "@/types/conversations"

export function EditPhoneNumberModal({
  phoneNumber,
  open,
  onOpenChange,
  usedColors,
}: {
  phoneNumber: PhoneNumberRecord | null
  open: boolean
  onOpenChange: (open: boolean) => void
  usedColors: string[]
}) {
  const [label, setLabel] = useState("")
  const [color, setColor] = useState("")
  const [active, setActive] = useState(true)
  const [greeting, setGreeting] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (open && phoneNumber) {
      setLabel(phoneNumber.label)
      setColor(phoneNumber.color)
      setActive(phoneNumber.is_active)
      setGreeting(phoneNumber.voicemail_greeting ?? "")
      setError(null)
    }
  }, [open, phoneNumber])

  const canSubmit = Boolean(label.trim() && color.trim() && !pending)

  async function handleSubmit() {
    if (!phoneNumber) return
    setError(null)
    if (!canSubmit) return
    setPending(true)

    const res = await updatePhoneNumber(phoneNumber.id, {
      label,
      color,
      is_active: active,
      voicemail_greeting: greeting || null,
    })

    setPending(false)

    if (res.error) {
      setError(res.error)
      return
    }

    toast.success("Phone number updated successfully")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Phone Number</DialogTitle>
          <DialogDescription>
            Update the label, color, voicemail greeting, or active status.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Label */}
          <div className="space-y-1.5">
            <label htmlFor="edit-label" className="text-sm font-medium text-foreground/80">
              Label
            </label>
            <Input
              id="edit-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={30}
            />
          </div>

          {/* Phone — read only */}
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <label htmlFor="edit-phone" className="text-sm font-medium text-foreground/80">
                Phone Number
              </label>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Lock className="h-3 w-3 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent>
                  To change the phone number, delete this entry and add a new one
                </TooltipContent>
              </Tooltip>
            </div>
            <Input
              id="edit-phone"
              value={phoneNumber?.phone_number ?? ""}
              readOnly
              disabled
              className="font-mono"
            />
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <span className="text-sm font-medium text-foreground/80">Color</span>
            <ColorPicker value={color} onChange={setColor} usedColors={usedColors} />
          </div>

          {/* Voicemail Greeting */}
          <div className="space-y-1.5">
            <label htmlFor="edit-greeting" className="text-sm font-medium text-foreground/80">
              Voicemail Greeting
            </label>
            <Textarea
              id="edit-greeting"
              value={greeting}
              onChange={(e) => setGreeting(e.target.value)}
              placeholder="Hi, you've reached our team. We're unavailable right now. Please leave a message after the tone."
              rows={3}
              maxLength={300}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use the default greeting.
            </p>
          </div>

          {/* Active */}
          <div className="flex items-center justify-between rounded-lg border border-border/60 px-3.5 py-3">
            <div>
              <p className="text-sm font-medium text-foreground/80">Active</p>
              <p className="text-xs text-muted-foreground">
                Inactive numbers won&apos;t appear in conversations or calls
              </p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>

          {error && (
            <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={pending}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} className="cursor-pointer">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/settings/edit-phone-number-modal.tsx
git commit -m "feat: add voicemail greeting field to edit phone number modal"
```

---

## Task 7: Add voicemail player to CallsTable

**Files:**
- Modify: `components/calls/calls-table.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
"use client"

import { Fragment, useMemo, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { format, formatDistanceToNow } from "date-fns"
import {
  ArrowDownLeft,
  ArrowUpRight,
  MessageSquare,
  Mic,
  Phone,
  PhoneMissed,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatDuration } from "@/lib/format-duration"
import { createClient } from "@/lib/client"
import type { Call, StatusFilter, Voicemail } from "@/types/calls"

const STATUS_STYLES: Record<string, string> = {
  answered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  completed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  missed: "bg-destructive/15 text-destructive",
  voicemail: "bg-purple-500/15 text-purple-600 dark:text-purple-400",
  initiated: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  declined: "bg-muted text-muted-foreground",
  failed: "bg-muted text-muted-foreground",
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize",
        STATUS_STYLES[status] ?? "bg-muted text-muted-foreground"
      )}
    >
      {status}
    </span>
  )
}

function DirectionIcon({ direction }: { direction: string }) {
  return direction === "inbound" ? (
    <ArrowDownLeft className="h-4 w-4 text-emerald-500" aria-label="Inbound" />
  ) : (
    <ArrowUpRight className="h-4 w-4 text-blue-500" aria-label="Outbound" />
  )
}

function isMissed(call: Call) {
  return call.status === "missed"
}

function durationCell(call: Call) {
  if (call.status === "missed" || call.status === "failed") return "—"
  return formatDuration(call.duration_seconds)
}

function VoicemailPlayer({ callId }: { callId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [voicemail, setVoicemail] = useState<Voicemail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from("voicemails")
      .select("id, call_id, recording_url, duration_seconds, is_heard, created_at")
      .eq("call_id", callId)
      .maybeSingle()
      .then(({ data }) => {
        setVoicemail(data as Voicemail | null)
        setLoading(false)
        if (data && !data.is_heard) {
          supabase
            .from("voicemails")
            .update({ is_heard: true })
            .eq("call_id", callId)
        }
      })
  }, [callId, supabase])

  if (loading) return <Skeleton className="h-8 w-full max-w-sm" />
  if (!voicemail) return <span className="text-xs text-muted-foreground">No recording found</span>

  return (
    <div className="flex items-center gap-3">
      <Mic className="h-4 w-4 shrink-0 text-purple-500" />
      <audio controls className="h-8 flex-1 max-w-sm" src={voicemail.recording_url} />
      <span className="text-xs text-muted-foreground tabular-nums">
        {formatDuration(voicemail.duration_seconds)}
      </span>
    </div>
  )
}

export function CallsTable({
  calls,
  loading,
  statusFilter,
  dateFilter,
}: {
  calls: Call[]
  loading?: boolean
  statusFilter: StatusFilter
  dateFilter: string
}) {
  const router = useRouter()
  const [expanded, setExpanded] = useState<string | null>(null)

  function goToSms(call: Call) {
    router.push(
      `/dashboard/conversations?contact=${encodeURIComponent(
        call.contact_number
      )}&inbox=${call.phone_number_id}`
    )
  }

  if (loading) {
    return (
      <div className="overflow-hidden rounded-xl border border-border/60">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Contact</TableHead>
              <TableHead className="hidden md:table-cell">Inbox</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Duration</TableHead>
              <TableHead className="hidden lg:table-cell">Date &amp; Time</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                <TableCell className="hidden md:table-cell"><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-12" /></TableCell>
                <TableCell className="hidden lg:table-cell"><Skeleton className="h-4 w-24" /></TableCell>
                <TableCell className="text-right"><Skeleton className="ml-auto h-4 w-16" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (calls.length === 0) {
    let subtext = "Try adjusting your filters"
    if (statusFilter === "missed") subtext = "No missed calls. You're all caught up!"
    else if (dateFilter === "today") subtext = "No calls today yet"

    return (
      <div className="flex flex-col items-center gap-1.5 rounded-xl border border-border/60 py-20 text-center">
        <PhoneMissed className="mb-1 h-10 w-10 text-muted-foreground/40" />
        <p className="text-base font-medium text-foreground">No calls found</p>
        <p className="text-sm text-muted-foreground">{subtext}</p>
      </div>
    )
  }

  return (
    <>
      {/* Desktop / tablet table */}
      <div className="hidden overflow-hidden rounded-xl border border-border/60 sm:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Contact</TableHead>
              <TableHead className="hidden md:table-cell">Inbox</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="hidden sm:table-cell">Duration</TableHead>
              <TableHead className="hidden lg:table-cell">Date &amp; Time</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((call) => {
              const open = expanded === call.id
              const missed = isMissed(call)
              return (
                <Fragment key={call.id}>
                  <TableRow
                    onClick={() => setExpanded(open ? null : call.id)}
                    className={cn(
                      "cursor-pointer",
                      missed && "bg-destructive/5 hover:bg-destructive/10"
                    )}
                  >
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <DirectionIcon direction={call.direction} />
                        {call.has_voicemail && (
                          <Mic className="h-3 w-3 text-purple-500" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">
                        {call.contact_number}
                      </div>
                      {call.phone_numbers && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: call.phone_numbers.color }}
                          />
                          {call.phone_numbers.label}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {call.phone_numbers && (
                        <span
                          className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                          style={{ backgroundColor: call.phone_numbers.color }}
                        >
                          {call.phone_numbers.label}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={call.status} />
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      {durationCell(call)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="text-sm text-foreground">
                        {format(new Date(call.created_at), "MMM d, yyyy · p")}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(call.created_at), {
                          addSuffix: true,
                        })}
                      </div>
                    </TableCell>
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled
                              aria-label="Call back"
                            >
                              <Phone className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Voice calling coming soon</TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => goToSms(call)}
                              aria-label="Send SMS"
                            >
                              <MessageSquare className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Send SMS</TooltipContent>
                        </Tooltip>
                      </div>
                    </TableCell>
                  </TableRow>

                  {open && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={7}>
                        <div className="px-2 py-2 space-y-3">
                          {call.has_voicemail && (
                            <div>
                              <p className="mb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                Voicemail
                              </p>
                              <VoicemailPlayer callId={call.id} />
                            </div>
                          )}
                          <dl className="grid gap-x-8 gap-y-1.5 text-xs sm:grid-cols-2 lg:grid-cols-4">
                            <DetailRow label="Telnyx Call ID" value={call.telnyx_call_id ?? "—"} mono />
                            <DetailRow
                              label="Started"
                              value={
                                call.started_at
                                  ? format(new Date(call.started_at), "PPpp")
                                  : "—"
                              }
                            />
                            <DetailRow
                              label="Ended"
                              value={
                                call.ended_at
                                  ? format(new Date(call.ended_at), "PPpp")
                                  : "—"
                              }
                            />
                            <DetailRow label="Agent" value="—" />
                          </dl>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Mobile card list */}
      <div className="space-y-3 sm:hidden">
        {calls.map((call) => {
          const missed = isMissed(call)
          return (
            <div
              key={call.id}
              className={cn(
                "rounded-xl border border-border/60 bg-card p-3",
                missed && "border-destructive/30 bg-destructive/5"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <DirectionIcon direction={call.direction} />
                  <div>
                    <p className="font-medium text-foreground">
                      {call.contact_number}
                    </p>
                    {call.phone_numbers && (
                      <span
                        className="mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
                        style={{ backgroundColor: call.phone_numbers.color }}
                      >
                        {call.phone_numbers.label}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {call.has_voicemail && (
                    <Mic className="h-3.5 w-3.5 text-purple-500" />
                  )}
                  <StatusBadge status={call.status} />
                </div>
              </div>

              {call.has_voicemail && (
                <div className="mt-2">
                  <VoicemailPlayer callId={call.id} />
                </div>
              )}

              <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                <span>{format(new Date(call.created_at), "MMM d · p")}</span>
                <span className="tabular-nums">{durationCell(call)}</span>
              </div>

              <div className="mt-2 flex items-center gap-2">
                <Button variant="outline" size="sm" disabled className="flex-1">
                  <Phone className="h-4 w-4" /> Call back
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => goToSms(call)}
                  className="flex-1 cursor-pointer"
                >
                  <MessageSquare className="h-4 w-4" /> SMS
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

function DetailRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-foreground", mono && "font-mono break-all")}>
        {value}
      </dd>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/calls/calls-table.tsx
git commit -m "feat: add voicemail player to calls table row expansion"
```

---

## Task 8: Add voicemail section to NotificationBell

**Files:**
- Modify: `components/notifications/notification-bell.tsx`

- [ ] **Step 1: Replace the entire file**

```tsx
"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Bell, MessageSquare, Mic, Phone } from "lucide-react"
import { formatDistanceToNow } from "date-fns"
import { createClient } from "@/lib/client"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { formatDuration } from "@/lib/format-duration"
import type { Notification } from "@/types/notifications"

export function NotificationBell() {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    supabase
      .from("notifications")
      .select("*")
      .eq("is_read", false)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setNotifications((data as Notification[]) ?? [])
      })
  }, [supabase])

  useEffect(() => {
    const channel = supabase
      .channel("notifications-bell")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications" },
        (payload) => {
          setNotifications((prev) => [payload.new as Notification, ...prev])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase])

  const handleClick = useCallback(
    async (notification: Notification) => {
      setNotifications((prev) => prev.filter((n) => n.id !== notification.id))
      setOpen(false)

      await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notification.id)

      if (notification.type === "missed_call" || notification.type === "voicemail") {
        router.push("/dashboard/calls")
      } else {
        router.push(`/dashboard/conversations?id=${notification.reference_id}`)
      }
    },
    [supabase, router]
  )

  const missedCalls = notifications.filter((n) => n.type === "missed_call")
  const unreadMessages = notifications.filter((n) => n.type === "unread_message")
  const voicemails = notifications.filter((n) => n.type === "voicemail")
  const totalCount = notifications.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="relative p-1.5 text-muted-foreground hover:text-foreground">
          <Bell className="h-5 w-5" />
          {totalCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
              {totalCount > 9 ? "9+" : totalCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
        </div>

        {notifications.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            All caught up
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {missedCalls.length > 0 && (
              <div>
                <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Missed Calls
                </p>
                {missedCalls.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted"
                  >
                    <Phone className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {n.metadata.contact_number}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {n.metadata.phone_label} &middot;{" "}
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {voicemails.length > 0 && (
              <div>
                <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Voicemails
                </p>
                {voicemails.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted"
                  >
                    <Mic className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {n.metadata.contact_number}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {n.metadata.phone_label}
                        {n.metadata.duration_seconds
                          ? ` · ${formatDuration(n.metadata.duration_seconds)}`
                          : ""}
                        {" · "}
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {unreadMessages.length > 0 && (
              <div>
                <p className="px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Unread Messages
                </p>
                {unreadMessages.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className="flex w-full items-start gap-3 px-4 py-2.5 text-left hover:bg-muted"
                  >
                    <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {n.metadata.contact_number}
                      </p>
                      {n.metadata.last_message && (
                        <p className="truncate text-xs text-muted-foreground">
                          {n.metadata.last_message}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        {n.metadata.phone_label} &middot;{" "}
                        {formatDistanceToNow(new Date(n.created_at), {
                          addSuffix: true,
                        })}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/notifications/notification-bell.tsx
git commit -m "feat: add voicemail section to notification bell"
```

---

## Task 9: Manual end-to-end verification

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Verify greeting field appears in settings**

Open `http://localhost:3000/dashboard/settings/phone-numbers`. Click Edit on any phone number. Confirm a "Voicemail Greeting" textarea appears. Enter a custom greeting, save, re-open — confirm the greeting persisted.

- [ ] **Step 3: Seed a test voicemail in Supabase**

In Supabase SQL Editor, first get a call ID:

```sql
select id from calls where direction = 'inbound' limit 1;
```

Then seed a voicemail for it (replace `<call_id>` with the result):

```sql
insert into voicemails (call_id, recording_url, duration_seconds)
values (
  '<call_id>',
  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  42
);

update calls set has_voicemail = true, status = 'voicemail'
where id = '<call_id>';
```

- [ ] **Step 4: Verify calls page shows voicemail indicator**

Open `http://localhost:3000/dashboard/calls`. Confirm the seeded call shows a purple mic icon. Click the row — confirm it expands to show the audio player. Click play — confirm audio plays. Re-open — confirm `is_heard` was set (check in Supabase: `select is_heard from voicemails where call_id = '<call_id>'` should return `true`).

- [ ] **Step 5: Seed a voicemail notification**

```sql
insert into notifications (type, reference_id, metadata)
values (
  'voicemail',
  '<call_id>',
  '{"contact_number": "+15550001234", "phone_label": "Sales Line", "duration_seconds": 42}'
);
```

Confirm the bell badge increments live. Open the popover — confirm a "Voicemails" section appears with the contact number, duration, and relative time. Click it — confirm navigation to `/dashboard/calls` and badge clears.

- [ ] **Step 6: Test cron route directly**

```bash
curl -X POST http://localhost:3000/api/cron/voicemail-check \
  -H "x-cron-secret: <your CRON_SECRET value>" \
  -H "Content-Type: application/json"
```

Expected response: `{"ok":true,"triggered":0}` (no stale calls in dev).

Test unauthorized access:

```bash
curl -X POST http://localhost:3000/api/cron/voicemail-check \
  -H "x-cron-secret: wrongsecret"
```

Expected: `{"error":"Unauthorized"}` with status 401.
