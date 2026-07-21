import type { SupabaseClient } from "@supabase/supabase-js"
import { isValidE164 } from "@/lib/phone"

/**
 * Shared contacts logic, mirroring lib/messaging.ts's split between business
 * logic (this file) and thin API route handlers. `Db` matches messaging.ts's
 * own alias — currently only ever called with the service-role admin client,
 * since contacts writes are API-only (see the design spec).
 */
export type Db = SupabaseClient<any, any, any>

export type UpsertContactInput = {
  phoneNumberId: string
  contactNumber: string
  name: string
  userId: string
}

export type UpsertContactResult =
  | {
      ok: true
      contact: {
        id: string
        phoneNumberId: string
        contactNumber: string
        name: string
        updatedAt: string
      }
    }
  | { ok: false; error: string }

/**
 * Create or rename the saved name for a (phoneNumberId, contactNumber) pair.
 * `created_by` is set to the current user on every write (simple
 * last-writer-wins — it's an audit-only field nothing reads, so preserving
 * the original creator on a rename isn't worth extra complexity).
 */
export async function upsertContactWithClient(
  db: Db,
  input: UpsertContactInput
): Promise<UpsertContactResult> {
  const { phoneNumberId, contactNumber, name, userId } = input

  const trimmedName = name.trim()
  if (!trimmedName) {
    return { ok: false, error: "Name is required." }
  }
  if (!isValidE164(contactNumber)) {
    return {
      ok: false,
      error: "Enter a valid phone number with country code (e.g. +12109348999).",
    }
  }

  const { data, error } = await db
    .from("contacts")
    .upsert(
      {
        phone_number_id: phoneNumberId,
        contact_number: contactNumber,
        name: trimmedName,
        created_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "phone_number_id,contact_number" }
    )
    .select("id, phone_number_id, contact_number, name, updated_at")
    .single()

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Failed to save contact." }
  }

  return {
    ok: true,
    contact: {
      id: data.id,
      phoneNumberId: data.phone_number_id,
      contactNumber: data.contact_number,
      name: data.name,
      updatedAt: data.updated_at,
    },
  }
}
