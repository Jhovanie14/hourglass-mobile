import type { Metadata } from "next"
import { SmsSignupForm } from "@/components/sms-signup-form"

export const metadata: Metadata = {
  title: "SMS Sign-Up | Hourglass Investments LLC",
  description:
    "Opt in to receive SMS text messages from Hourglass Investments LLC.",
}

const CONTACT_PHONE = "+1 210-934-8999"
const CONTACT_EMAIL = "contact@hourglassinvestment.com"

export default function SmsSignupPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16 text-foreground">
      <header className="border-b-2 border-primary pb-5">
        <h1 className="text-3xl font-bold tracking-tight">
          Sign up for text messages
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Hourglass Investments LLC
        </p>
      </header>

      <p className="mt-8 leading-relaxed">
        Enter your mobile number to receive account and service updates and to
        have two-way customer-care conversations with Hourglass Investments LLC
        over text. This is a <strong>Customer Care</strong> program — we do not
        send marketing or promotional content through it.
      </p>

      <div className="mt-9">
        <SmsSignupForm />
      </div>

      <footer className="mt-14 border-t border-border pt-5 text-sm text-muted-foreground">
        Questions? Email{" "}
        <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>
          {CONTACT_EMAIL}
        </a>{" "}
        or call {CONTACT_PHONE}. Read our{" "}
        <a className="text-primary underline" href="/sms-terms">
          SMS Terms &amp; Privacy Policy
        </a>
        .
      </footer>
    </main>
  )
}
