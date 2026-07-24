import { createRequestScopedClient } from "@/lib/auth"

export const runtime = "nodejs"

/**
 * Delete one message. Mirrors the dashboard's deleteMessage server action, but
 * reachable from the extension panel, which is cross-origin and sends a Bearer
 * token instead of cookies.
 *
 * Uses the caller's own RLS-scoped client on purpose — never the admin client,
 * which would let any authenticated agent delete anyone's messages.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createRequestScopedClient(req)
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const { error } = await supabase.from("messages").delete().eq("id", id)
  if (error) return Response.json({ error: error.message }, { status: 422 })

  return Response.json({ ok: true })
}
