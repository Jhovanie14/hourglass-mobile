/**
 * Reduce raw contacts rows to a { contact_number -> name } map for display in
 * call lists. A number saved under multiple phone lines can have several rows;
 * the most recently updated name wins (matches the phone app's resolution).
 */
export function buildContactNameMap(
  rows: { contact_number: string; name: string; updated_at: string }[]
): Record<string, string> {
  const latest: Record<string, { name: string; updated_at: string }> = {}
  for (const r of rows) {
    const prev = latest[r.contact_number]
    if (!prev || r.updated_at > prev.updated_at) {
      latest[r.contact_number] = { name: r.name, updated_at: r.updated_at }
    }
  }
  const map: Record<string, string> = {}
  for (const [num, v] of Object.entries(latest)) map[num] = v.name
  return map
}
