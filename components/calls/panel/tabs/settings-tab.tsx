"use client"

import { LogOut } from "lucide-react"
import type { SerializedCallState } from "@/lib/panel-bus"
import { send } from "../panel-send"

export function SettingsTab({
  state,
  onSignOut,
}: {
  state: SerializedCallState
  onSignOut: () => void
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between rounded-lg border border-neutral-800 px-3 py-3">
        <span className="text-sm font-medium text-white">
          {state.online ? "Online — receiving calls" : "Offline"}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={state.online}
          onClick={() => send({ cmd: "set-online", online: !state.online })}
          className={`relative h-6 w-11 rounded-full transition ${
            state.online ? "bg-green-500" : "bg-neutral-700"
          }`}
        >
          <span
            className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
              state.online ? "left-5" : "left-0.5"
            }`}
          />
        </button>
      </div>

      <button
        type="button"
        onClick={() => {
          if (
            state.status !== "idle" &&
            !window.confirm("A call is in progress — signing out will end it. Continue?")
          )
            return
          onSignOut()
        }}
        className="flex items-center justify-center gap-2 rounded-lg border border-neutral-800 py-2.5 text-sm font-medium text-neutral-300 transition hover:bg-neutral-900"
      >
        <LogOut className="h-4 w-4" />
        Sign out
      </button>
    </div>
  )
}
