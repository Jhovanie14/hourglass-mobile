"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/server"
import { isAdmin } from "@/lib/auth"

const PATH = "/dashboard/settings/phone-numbers"
const E164 = /^\+[1-9]\d{7,14}$/

type AddInput = {
  label: string
  phone_number: string
  color: string
  is_active: boolean
}

type UpdateInput = {
  label?: string
  color?: string
  is_active?: boolean
  voicemail_greeting?: string | null
}

export async function getPhoneNumbers() {
  const supabase = await createClient()
  const { data } = await supabase
    .from("phone_numbers")
    .select("id, label, phone_number, color, is_active, voicemail_greeting, created_at")
    .order("created_at", { ascending: true })

  return (data ?? []) as {
    id: string
    label: string
    phone_number: string
    color: string
    is_active: boolean
    voicemail_greeting: string | null
    created_at: string
  }[]
}

export async function addPhoneNumber(
  formData: AddInput
): Promise<{ error?: string }> {
  if (!(await isAdmin())) {
    return { error: "You do not have permission to do this." }
  }

  const label = formData.label?.trim()
  const phone = formData.phone_number?.trim()
  const color = formData.color?.trim()

  if (!label) return { error: "Label is required." }
  if (!phone || !E164.test(phone)) {
    return {
      error: "Phone number must be in E.164 format (e.g. +15551234567).",
    }
  }
  if (!color) return { error: "Color is required." }

  const supabase = await createClient()
  const { error } = await supabase.from("phone_numbers").insert({
    label,
    phone_number: phone,
    color,
    is_active: formData.is_active,
  })

  if (error) return { error: error.message }

  revalidatePath(PATH)
  return {}
}

export async function updatePhoneNumber(
  id: string,
  formData: UpdateInput
): Promise<{ error?: string }> {
  if (!(await isAdmin())) {
    return { error: "You do not have permission to do this." }
  }

  const supabase = await createClient()

  if (formData.is_active === false) {
    const { count } = await supabase
      .from("phone_numbers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)

    if ((count ?? 0) <= 1) {
      return { error: "You must have at least one active phone number." }
    }
  }

  const patch: UpdateInput = {}
  if (formData.label !== undefined) patch.label = formData.label.trim()
  if (formData.color !== undefined) patch.color = formData.color.trim()
  if (formData.is_active !== undefined) patch.is_active = formData.is_active
  if (formData.voicemail_greeting !== undefined) {
    patch.voicemail_greeting = formData.voicemail_greeting?.trim() || null
  }

  const { error } = await supabase
    .from("phone_numbers")
    .update(patch)
    .eq("id", id)

  if (error) return { error: error.message }

  revalidatePath(PATH)
  return {}
}

export async function deletePhoneNumber(
  id: string
): Promise<{ error?: string }> {
  if (!(await isAdmin())) {
    return { error: "You do not have permission to do this." }
  }

  const supabase = await createClient()

  const { data: target } = await supabase
    .from("phone_numbers")
    .select("is_active")
    .eq("id", id)
    .single()

  if (target?.is_active) {
    const { count } = await supabase
      .from("phone_numbers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)

    if ((count ?? 0) <= 1) {
      return { error: "You must have at least one active phone number." }
    }
  }

  const { error } = await supabase.from("phone_numbers").delete().eq("id", id)

  if (error) return { error: error.message }

  revalidatePath(PATH)
  return {}
}
