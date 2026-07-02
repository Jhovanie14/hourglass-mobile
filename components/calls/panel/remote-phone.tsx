"use client"

import type { PhoneNumber } from "@/types/calls"

// Full implementation lands in the next task (remote-control panel UI).
export function RemotePhone(_props: {
  phoneNumbers: PhoneNumber[]
  onSignOut: () => void
}) {
  return <div className="p-4 text-sm text-muted-foreground">Connecting…</div>
}
