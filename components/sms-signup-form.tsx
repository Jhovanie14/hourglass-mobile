"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type FieldErrors = Partial<Record<"name" | "phone" | "consent", string>>

export function SmsSignupForm() {
  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setErrors({})
    setFormError(null)

    try {
      const res = await fetch("/api/sms-opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, consent }),
      })

      if (res.ok) {
        setDone(true)
        return
      }

      const data = await res.json().catch(() => ({}))
      if (res.status === 422 && data.errors) {
        setErrors(data.errors as FieldErrors)
      } else {
        setFormError(data.error ?? "Something went wrong. Please try again.")
      }
    } catch {
      setFormError("Network error. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="rounded-lg border border-primary/30 border-l-4 border-l-primary bg-primary/5 p-6">
        <h2 className="text-lg font-semibold">You&apos;re signed up</h2>
        <p className="mt-2 leading-relaxed">
          Thanks, {name.trim() || "there"}. We&apos;ve recorded your consent to
          receive text messages from Hourglass Investments LLC. You can reply{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">STOP</code> at any
          time to opt out, or{" "}
          <code className="rounded bg-muted px-1.5 py-0.5">HELP</code> for help.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6" noValidate>
      <div className="space-y-1.5">
        <label htmlFor="name" className="text-sm font-medium">
          Full name
        </label>
        <Input
          id="name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!errors.name}
          required
        />
        {errors.name && (
          <p className="text-sm text-destructive">{errors.name}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="phone" className="text-sm font-medium">
          Mobile phone number
        </label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="(210) 934-8999"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={!!errors.phone}
          required
        />
        {errors.phone && (
          <p className="text-sm text-destructive">{errors.phone}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="flex gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            name="consent"
            className="mt-1 size-4 shrink-0 accent-primary"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            aria-invalid={!!errors.consent}
            required
          />
          <span>
            By checking this box and providing my phone number, I agree to
            receive recurring SMS text messages (account and service updates and
            two-way customer-care conversations) from Hourglass Investments LLC
            at the number provided, including messages sent by an automated
            system. Consent is not a condition of any purchase. Message
            frequency varies. Message and data rates may apply. Reply{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">STOP</code> to opt
            out, <code className="rounded bg-muted px-1.5 py-0.5">HELP</code> for
            help. See our{" "}
            <a className="text-primary underline" href="/sms-terms">
              SMS Terms &amp; Privacy Policy
            </a>
            .
          </span>
        </label>
        {errors.consent && (
          <p className="text-sm text-destructive">{errors.consent}</p>
        )}
      </div>

      <p className="text-sm text-muted-foreground">
        Your mobile information will not be sold or shared with third parties or
        affiliates for marketing or promotional purposes. See our{" "}
        <a className="text-primary underline" href="/sms-terms">
          SMS Terms &amp; Privacy Policy
        </a>
        .
      </p>

      {formError && <p className="text-sm text-destructive">{formError}</p>}

      <Button type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Sign up for text messages"}
      </Button>
    </form>
  )
}
