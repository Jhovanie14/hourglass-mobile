'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/server'

export type AuthState =
  | { error?: string; message?: string }
  | undefined

export async function login(_state: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) {
    return { error: error.message }
  }

  redirect('/dashboard')
}

export async function setPassword(_state: AuthState, formData: FormData): Promise<AuthState> {
  const password = formData.get('password') as string
  const confirm = formData.get('confirm') as string

  if (!password || password.length < 8) {
    return { error: 'Password must be at least 8 characters.' }
  }

  if (password !== confirm) {
    return { error: 'Passwords do not match.' }
  }

  // The invited user already has a session at this point (created by the
  // /auth/confirm route after verifying the invite link).
  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    return { error: error.message }
  }

  redirect('/dashboard')
}
