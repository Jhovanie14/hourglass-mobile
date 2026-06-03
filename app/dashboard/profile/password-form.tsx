"use client"

import { useActionState, useEffect, useRef } from "react"
import { changePassword } from "../actions"

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (state?.message) {
      formRef.current?.reset()
    }
  }, [state?.message])

  return (
    <form ref={formRef} action={action} className="max-w-sm space-y-4">
      <div>
        <label
          htmlFor="password"
          className="mb-1.5 block text-sm font-medium text-foreground/80"
        >
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="new-password"
          placeholder="••••••••"
          className="w-full rounded-lg border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm text-foreground transition-all placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      <div>
        <label
          htmlFor="confirm"
          className="mb-1.5 block text-sm font-medium text-foreground/80"
        >
          Confirm new password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          autoComplete="new-password"
          placeholder="••••••••"
          className="w-full rounded-lg border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm text-foreground transition-all placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>

      {state?.error && (
        <p className="rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-sm text-destructive">
          {state.error}
        </p>
      )}

      {state?.message && (
        <p className="rounded-lg border border-primary/20 bg-primary/10 px-3.5 py-2.5 text-sm text-primary">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Updating…" : "Update password"}
      </button>
    </form>
  )
}
