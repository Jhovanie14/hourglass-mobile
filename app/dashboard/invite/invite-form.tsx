"use client"

import { useActionState, useEffect, useRef } from "react"
import { inviteUser } from "../actions"

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteUser, undefined)
  const formRef = useRef<HTMLFormElement>(null)

  // Clear the field after a successful invite.
  useEffect(() => {
    if (state?.message) {
      formRef.current?.reset()
    }
  }, [state?.message])

  return (
    <form ref={formRef} action={action} className="space-y-4">
      <div>
        <label
          htmlFor="email"
          className="mb-1.5 block text-sm font-medium text-foreground/80"
        >
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="off"
          placeholder="person@company.com"
          className="w-full rounded-lg border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm text-foreground transition-all placeholder:text-muted-foreground focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none"
        />
      </div>
      <div>
        <label
          htmlFor="role"
          className="mb-1.5 block text-sm font-medium text-foreground/80"
        >
          Role
        </label>
        <select name="role" defaultValue="agent" className="w-full rounded-lg border border-border/60 bg-background/80 px-3.5 py-2.5 text-sm text-foreground transition-all focus:border-primary/60 focus:ring-2 focus:ring-primary/40 focus:outline-none">
          <option value="agent">Agent</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {state?.error && (
        <div className="flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
          <svg
            className="mt-0.5 h-4 w-4 shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
          {state.error}
        </div>
      )}

      {state?.message && (
        <div className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/10 px-3.5 py-3 text-sm text-primary">
          <svg
            className="mt-0.5 h-4 w-4 shrink-0"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          {state.message}
        </div>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 active:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? "Sending invite…" : "Send invitation"}
      </button>
    </form>
  )
}
