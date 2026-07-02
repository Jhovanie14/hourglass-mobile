"use client"

import type { SerializedCallState } from "@/lib/panel-bus"
import type { PhoneNumber } from "@/types/calls"

export function RecentTab(_props: {
  accessToken: string | undefined
  phoneNumbers: PhoneNumber[]
  state: SerializedCallState
  onCallback: (to: string) => void
}) {
  return (
    <div className="p-4 text-sm text-neutral-500">Loading recent calls…</div>
  )
}
