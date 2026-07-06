import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy | Hourglass Call Panel",
  description:
    "Privacy policy for the Hourglass Call Panel Chrome extension — what data it handles, how it is used, and how to contact us.",
}

const CONTACT_PHONE = "+1 210-934-8999"
const CONTACT_EMAIL = "contact@hourglassinvestment.com"

export default function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-foreground">
      <header className="border-b-2 border-primary pb-5">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Hourglass Call Panel (Chrome Extension) &middot; Hourglass Investments LLC
          &middot; Last updated: July 6, 2026
        </p>
      </header>

      <p className="mt-8 text-lg leading-relaxed">
        This policy describes how the <strong>Hourglass Call Panel</strong> Chrome
        extension (&ldquo;the extension&rdquo;), published by Hourglass Investments LLC
        (&ldquo;we,&rdquo; &ldquo;us&rdquo;), handles information. The extension is an
        internal tool that gives our agents an in-browser panel to place and receive
        phone calls tied to their Hourglass account.
      </p>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">1. Information we handle</h2>
        <ul className="list-disc space-y-2 pl-6 leading-relaxed">
          <li>
            <strong>Account &amp; authentication data.</strong> When an agent signs in,
            we process their account credentials and session token so the panel can
            connect to their Hourglass account.
          </li>
          <li>
            <strong>Call information.</strong> Phone numbers dialed or received, the
            caller ID used, call timestamps, status, and duration, so the panel can place
            calls, show recent-call history, and enable callbacks.
          </li>
          <li>
            <strong>Microphone audio.</strong> During an active call, audio from the
            microphone is transmitted in real time to complete the call. Call audio is not
            recorded or stored by the extension.
          </li>
          <li>
            <strong>Local settings.</strong> Panel state and preferences are stored
            locally in the browser to keep the panel working across pages.
          </li>
        </ul>
      </section>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">2. How we use it</h2>
        <p className="leading-relaxed">
          We use this information solely to provide the calling features of the extension:
          authenticating the agent, placing and receiving calls, displaying call history,
          and delivering incoming-call notifications. We do not use it for advertising, and
          we do not sell it.
        </p>
      </section>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">3. Data flow &amp; service providers</h2>
        <p className="leading-relaxed">
          The panel interface is served from{" "}
          <a className="text-primary underline" href="https://www.megestic.com">
            www.megestic.com
          </a>
          . To carry calls and manage accounts we rely on trusted infrastructure providers
          (including our telephony and authentication vendors). These providers process
          data only to deliver the service on our behalf. Information is transmitted over
          encrypted connections.
        </p>
      </section>

      <div className="mt-8 rounded-lg border border-primary/30 border-l-4 border-l-primary bg-primary/5 p-5">
        <p className="leading-relaxed">
          <strong>
            We do not sell your data or share it with third parties for marketing or
            promotional purposes.
          </strong>{" "}
          Data is shared only with service providers who help us operate the calling
          features, and only as needed to provide those features.
        </p>
      </div>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">4. Permissions</h2>
        <p className="leading-relaxed">
          The extension requests only the browser permissions needed to function:
          notifications (to alert you to incoming calls), microphone and background audio
          (to carry calls), local storage (to remember panel state), and access to the
          Hourglass panel host so the call interface can load. It does not read or collect
          the content of the web pages you browse.
        </p>
      </section>

      <section className="mt-9 space-y-3">
        <h2 className="text-xl font-semibold">5. Data retention</h2>
        <p className="leading-relaxed">
          Local settings remain in your browser until you remove the extension or clear its
          data. Account and call records associated with your Hourglass account are retained
          as part of that account and handled under our standard data practices.
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
        &copy; 2026 Hourglass Investments LLC. This page describes the privacy practices of
        the Hourglass Call Panel Chrome extension.
      </footer>
    </main>
  )
}
