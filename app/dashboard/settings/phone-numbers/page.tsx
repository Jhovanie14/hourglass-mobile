import Link from "next/link"
import { redirect } from "next/navigation"
import { ArrowLeft, Info } from "lucide-react"
import { isAdmin } from "@/lib/auth"
import { PhoneNumbersTable } from "@/components/settings/phone-numbers-table"
import type { PhoneNumberRecord } from "@/types/conversations"
import { getPhoneNumbers } from "./actions"

export default async function PhoneNumbersPage() {
  // Admin-only — verified server-side.
  if (!(await isAdmin())) {
    redirect("/dashboard")
  }

  const data = await getPhoneNumbers()
 
  const phoneNumbers = (data ?? []) as PhoneNumberRecord[]

  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="space-y-3">
        <Link
          href="/dashboard/profile"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Profile
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Phone Numbers
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage the Telnyx phone numbers connected to your inboxes
          </p>
        </div>
      </div>

      {/* Info banner */}
      <div className="flex gap-3 rounded-lg border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-sm text-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
        <p>
          These are your Telnyx-connected phone numbers. Each number must be
          fully configured in the Telnyx portal (Messaging Profile + Call
          Control Connection) before it can send or receive calls and messages.
          Contact your developer if you need help with Telnyx portal setup.
        </p>
      </div>

      <PhoneNumbersTable phoneNumbers={phoneNumbers} />
    </div>
  )
}
