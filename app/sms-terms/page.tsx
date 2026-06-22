import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "SMS Terms & Privacy Policy | Hourglass Investments LLC",
  description:
    "SMS/text messaging terms, consent, and privacy policy for Hourglass Investments LLC.",
}

// Contact details surfaced to carriers during 10DLC review — must stay real & reachable.
const CONTACT_PHONE = "+1 210-934-8999"
const CONTACT_EMAIL = "contact@hourglassinvestment.com"

export default function SmsTermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <header className="border-b-2 border-primary pb-5">
        <h1 className="text-3xl font-bold tracking-tight">
          SMS Terms &amp; Privacy Policy
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Hourglass Investments LLC &middot; Last updated: June 22, 2026
        </p>
      </header>

      <p className="mt-8 text-lg leading-relaxed">
        Hourglass Investments LLC (&ldquo;we,&rdquo; &ldquo;us&rdquo;) sends SMS text
        messages to customers who have provided their mobile phone number and consented to
        be contacted &mdash; including verbal consent given during a phone call to our
        published business line, <strong>{CONTACT_PHONE}</strong>.
      </p>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">1. Program description</h2>
        <p className="leading-relaxed">
          This is a <strong>Customer Care</strong> messaging program. Messages include
          account and service updates, follow-ups to phone calls and voicemails, and
          responses to customer inquiries. We do not send marketing or promotional content
          through this program.
        </p>
      </section>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">2. How you opt in</h2>
        <p className="leading-relaxed">
          Consent is collected verbally during inbound calls to{" "}
          <strong>{CONTACT_PHONE}</strong>. During the call, our representative explains
          that by providing your mobile number you agree to receive these text messages,
          that message frequency varies, that message and data rates may apply, and that
          you may reply <code className="rounded bg-muted px-1.5 py-0.5">STOP</code> to opt
          out or <code className="rounded bg-muted px-1.5 py-0.5">HELP</code> for help. We
          send a one-time confirmation text after you agree.
        </p>
      </section>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">3. Message frequency &amp; rates</h2>
        <p className="leading-relaxed">
          Message frequency varies based on your account activity and inquiries.{" "}
          <strong>Message and data rates may apply.</strong> Check with your mobile carrier
          for details about your plan.
        </p>
      </section>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">4. Opt out and help</h2>
        <ul className="list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            Reply <code className="rounded bg-muted px-1.5 py-0.5">STOP</code> at any time
            to unsubscribe. You will receive one confirmation message and then no further
            texts.
          </li>
          <li>
            Reply <code className="rounded bg-muted px-1.5 py-0.5">HELP</code> for help,
            email{" "}
            <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            , or call <strong>{CONTACT_PHONE}</strong>.
          </li>
        </ul>
      </section>

      <div className="mt-8 rounded-lg border border-primary/30 border-l-4 border-l-primary bg-primary/5 p-5">
        <p className="leading-relaxed">
          <strong>
            No mobile information will be shared with third parties or affiliates for
            marketing or promotional purposes.
          </strong>{" "}
          Information sharing with subcontractors in support services, such as customer
          service, is permitted. All other use-case categories exclude text-messaging
          originator opt-in data and consent; this information will not be shared with any
          third parties.
        </p>
      </div>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">5. Privacy</h2>
        <p className="leading-relaxed">
          We collect your mobile number and consent record (date, time, and the method of
          consent) solely to operate this messaging program and provide the service you
          requested. We do not sell your information. For questions about how we handle
          your data, contact{" "}
          <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </section>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">6. Contact</h2>
        <p className="leading-relaxed">
          Hourglass Investments LLC
          <br />
          Phone: {CONTACT_PHONE}
          <br />
          Email:{" "}
          <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
        </p>
      </section>

      <footer className="mt-14 border-t border-border pt-5 text-sm text-muted-foreground">
        &copy; 2026 Hourglass Investments LLC. This page describes the terms and privacy
        practices for our SMS/text messaging program.
      </footer>
    </main>
  )
}
