import { redirect } from "next/navigation"
import { isAdmin } from "@/lib/auth"
import { InviteForm } from "./invite-form"
import { Card } from "@/components/ui/card"

export default async function InvitePage() {
  // Role-based access: only admins may reach this page.
  if (!(await isAdmin())) {
    redirect("/dashboard")
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-md">
        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Invite a user
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Send an email invitation. They&apos;ll set their own password to
            join your workspace.
          </p>
        </div>

        <Card className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur-sm">
          <InviteForm />
        </Card>
      </div>
    </div>
  )
}
