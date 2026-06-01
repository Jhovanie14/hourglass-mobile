"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/server"
import { createAdminClient } from "@/lib/admin"

export type ActionState = { error?: string; message?: string } | undefined

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/auth/login")
}

export async function changePassword(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const password = formData.get("password") as string
  const confirm = formData.get("confirm") as string

  if (!password || password.length < 8) {
    return { error: "Password must be at least 8 characters." }
  }

  if (password !== confirm) {
    return { error: "Passwords do not match." }
  }

  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()

  if (!data?.claims) {
    return { error: "You must be signed in." }
  }

  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    return { error: error.message }
  }

  return { message: "Password updated successfully." }
}

export async function inviteUser(
  _state: ActionState,
  formData: FormData
): Promise<ActionState> {
  const email = (formData.get("email") as string)?.trim()
  const role = formData.get("role") as string

  if (!email) {
    return { error: "Email is required." }
  }

  if (role !== "agent" && role !== "admin") {
    return { error: "Invalid role selected." }
  }

  // 1. Make sure the caller is logged in.
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const caller = claimsData?.claims

  if (!caller) {
    return { error: "You must be signed in to invite users." }
  }

  // 2. Make sure the caller is an admin (profiles.role === 'admin').
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", caller.sub)
    .single()

  if (profileError || profile?.role !== "admin") {
    return { error: "You do not have permission to invite users." }
  }

  // 3. Send the invite using the admin (secret key) client.
  const origin = (await headers()).get("origin")
  const admin = createAdminClient()

  const { error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/confirm?next=/auth/set-password`,
    data: { role }, // ← add this line
  })

  if (error) {
    return { error: error.message }
  }

  return { message: `Invitation sent to ${email}.` }
}
