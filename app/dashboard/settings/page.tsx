import Link from "next/link"
import { UserPlus } from "lucide-react"
import { getCurrentUser, getCurrentRole } from "@/lib/auth"
import { ThemeToggle } from "@/components/theme-toggle"
import { PasswordForm } from "./password-form"

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-sm backdrop-blur-sm">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description && (
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-4">{children}</div>
    </section>
  )
}

export default async function SettingsPage() {
  const user = await getCurrentUser()
  const role = await getCurrentRole()
  const isAdmin = role === "admin"

  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your account and preferences.
          </p>
        </div>

        {/* Shared: everyone (admin + agent) sees these */}
        <Section title="Account" description="Your signed-in account.">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="text-foreground">{user?.email as string}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="capitalize text-foreground">{role ?? "—"}</dd>
            </div>
          </dl>
        </Section>

        <Section title="Appearance" description="Choose how the app looks.">
          <ThemeToggle />
        </Section>

        <Section
          title="Password"
          description="Change the password you use to sign in."
        >
          <PasswordForm />
        </Section>

        {/* Admin-only extras */}
        {isAdmin && (
          <Section
            title="Admin"
            description="Tools available to administrators only."
          >
            <Link
              href="/dashboard/invite"
              className="inline-flex items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <UserPlus className="h-4 w-4" />
              Invite a user
            </Link>
          </Section>
        )}
      </div>
    </div>
  )
}
