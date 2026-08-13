import { createClient } from "@/lib/server"
import { buildContactNameMap } from "@/lib/contact-names"
import { FollowUpsPageClient } from "@/components/follow-ups/follow-ups-page-client"
import type { Disposition } from "@/lib/dispositions"

export default async function FollowUpsPage() {
  const supabase = await createClient()

  // RLS scopes call_dispositions to the signed-in agent: this page shows the
  // agent's own follow-ups only (see the design spec).
  const { data } = await supabase
    .from("call_dispositions")
    .select("*")
    .not("follow_up_at", "is", null)
    .order("follow_up_at", { ascending: true })

  const dispositions = (data ?? []) as Disposition[]

  const numbers = Array.from(
    new Set(dispositions.map((d) => d.contact_number).filter((n): n is string => !!n))
  )
  let nameMap: Record<string, string> = {}
  if (numbers.length) {
    const { data: contactRows } = await supabase
      .from("contacts")
      .select("contact_number, name, updated_at")
      .in("contact_number", numbers)
    nameMap = buildContactNameMap(contactRows ?? [])
  }

  return <FollowUpsPageClient dispositions={dispositions} nameMap={nameMap} />
}
