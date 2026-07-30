import { createRequestScopedClient } from "@/lib/auth"

export const runtime = "nodejs"

/**
 * Permanently delete a conversation. Its messages go with it via the
 * messages→conversations FK cascade. Opt-out suppression (sms_opt_outs, keyed
 * by phone) is deliberately left untouched so a deleted contact stays
 * suppressed — same rule as the dashboard's deleteConversation server action.
 *
 * Uses the caller's own RLS-scoped client on purpose — never the admin client.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createRequestScopedClient(req)
  if (!supabase) return Response.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  // `.select()` returns the rows actually removed — see the sibling message
  // route: without it an RLS-blocked delete looks identical to a successful one.
  const { data, error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", id)
    .select("id")
  if (error) return Response.json({ error: error.message }, { status: 422 })
  if (!data?.length) return Response.json({ error: "Conversation not found." }, { status: 404 })

  return Response.json({ ok: true })
}
