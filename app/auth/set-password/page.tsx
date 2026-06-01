'use client'

import { useActionState } from 'react'
import { setPassword } from '../actions'

export default function SetPasswordPage() {
  const [state, action, pending] = useActionState(setPassword, undefined)

  return (
    <div className="w-full max-w-md">
      {/* Brand */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-primary rounded-xl mb-4 shadow-lg shadow-primary/20">
          <svg className="w-6 h-6 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-foreground tracking-tight uppercase">Hourglass Mobile</h1>
        <p className="text-muted-foreground mt-1 text-sm">All your calls and messages, one place.</p>
      </div>

      {/* Card */}
      <div className="bg-card/60 backdrop-blur-sm border border-border/60 rounded-2xl p-8 shadow-2xl">
        <h2 className="text-lg font-semibold text-foreground mb-0.5">Set your password</h2>
        <p className="text-muted-foreground text-sm mb-6">Choose a password to finish setting up your account</p>

        <form action={action} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground/80 mb-1.5">
              New password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="new-password"
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 bg-background/80 border border-border/60 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all text-sm"
            />
          </div>

          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-foreground/80 mb-1.5">
              Confirm password
            </label>
            <input
              id="confirm"
              name="confirm"
              type="password"
              required
              autoComplete="new-password"
              placeholder="••••••••"
              className="w-full px-3.5 py-2.5 bg-background/80 border border-border/60 rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/60 transition-all text-sm"
            />
          </div>

          {state?.error && (
            <div className="flex items-start gap-2.5 bg-destructive/10 border border-destructive/20 rounded-lg px-3.5 py-3 text-sm text-destructive">
              <svg className="w-4 h-4 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full py-2.5 px-4 bg-primary hover:bg-primary/90 active:bg-primary/80 disabled:opacity-60 disabled:cursor-not-allowed text-primary-foreground font-medium rounded-lg transition-colors text-sm mt-1"
          >
            {pending ? 'Saving…' : 'Set password & continue'}
          </button>
        </form>
      </div>
    </div>
  )
}
