"use client"

import { Phone } from "lucide-react"
import type { SerializedCallState } from "@/lib/panel-bus"
import type { PhoneNumber } from "@/types/calls"
import { send } from "../panel-send"

export function DialpadTab({
  phoneNumbers,
  state,
  to,
  setTo,
  phoneNumberId,
  setPhoneNumberId,
}: {
  phoneNumbers: PhoneNumber[]
  state: SerializedCallState
  to: string
  setTo: (v: string) => void
  phoneNumberId: string
  setPhoneNumberId: (v: string) => void
}) {
  const selectedId = phoneNumberId || phoneNumbers[0]?.id || ""
  const selectedPhone = phoneNumbers.find((p) => p.id === selectedId)
  const inCall = state.status !== "idle" && state.status !== "incoming"

  function handleCall() {
    if (!state.isReady || inCall) return
    if (!to.trim() || !selectedPhone) return
    send({ cmd: "dial", to: to.trim(), callerId: selectedPhone.phone_number })
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="pt-2 text-center text-lg font-semibold text-white">
        Make a call
      </h2>

      {state.micBlocked && (
        <button
          type="button"
          onClick={() =>
            navigator.mediaDevices
              .getUserMedia({ audio: true })
              .then((s) => s.getTracks().forEach((t) => t.stop()))
              .catch(() => {})
          }
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-left text-sm text-red-400"
        >
          Microphone blocked — click to grant access
        </button>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-from" className="text-xs font-medium text-neutral-400">
          From
        </label>
        <select
          id="panel-from"
          value={selectedId}
          onChange={(e) => setPhoneNumberId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1 text-sm text-white focus:ring-1 focus:ring-neutral-500 focus:outline-none"
        >
          {phoneNumbers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} · {p.phone_number}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="panel-to" className="text-xs font-medium text-neutral-400">
          To
        </label>
        <input
          id="panel-to"
          type="tel"
          placeholder="Contact name, phone number or agent"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCall()}
          className="flex h-11 w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 text-sm text-white placeholder:text-neutral-500 focus:ring-1 focus:ring-neutral-500 focus:outline-none"
        />
      </div>

      <button
        type="button"
        onClick={handleCall}
        disabled={!state.isReady || inCall || !to.trim() || !selectedPhone}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-green-500 py-3 text-sm font-semibold text-white transition hover:bg-green-600 disabled:opacity-50"
      >
        <Phone className="h-4 w-4" />
        {!state.isReady ? "Connecting…" : "Call"}
      </button>
    </div>
  )
}
