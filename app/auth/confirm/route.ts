import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/server'

/**
 * Handles the link Supabase emails to invited users (and recovery / email
 * change links). It verifies the token, which sets the auth cookies, then
 * redirects to `next` (the set-password page for invites).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  if (token_hash && type) {
    const supabase = await createClient()

    const { error } = await supabase.auth.verifyOtp({ type, token_hash })

    if (!error) {
      const redirectTo = type === "invite" ? "/auth/set-password" : next
      return NextResponse.redirect(new URL(redirectTo, request.url))
    }
  }

  // Verification failed — send them to login with an error flag.
  return NextResponse.redirect(new URL('/auth/login?error=invalid_link', request.url))
}
