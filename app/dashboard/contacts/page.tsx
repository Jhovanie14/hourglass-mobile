import { createClient } from "@/lib/server"
import {
  ContactsPageClient,
  type ContactRow,
} from "@/components/contacts/contacts-page-client"
import type { PhoneNumber } from "@/types/calls"

export default async function ContactsPage() {
  const supabase = await createClient()

  const [phoneNumbersRes, contactsRes] = await Promise.all([
    supabase
      .from("phone_numbers")
      .select("id, label, phone_number, color")
      .eq("is_active", true)
      .order("created_at", { ascending: true }),
    // Team-wide RLS read policy (same one the calls page relies on).
    supabase
      .from("contacts")
      .select("id, phone_number_id, contact_number, name, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1000),
  ])

  return (
    <ContactsPageClient
      phoneNumbers={(phoneNumbersRes.data ?? []) as PhoneNumber[]}
      contacts={(contactsRes.data ?? []) as ContactRow[]}
    />
  )
}
