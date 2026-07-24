"use client"

import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import type { PhoneNumber } from "@/types/conversations"

/** Loose E.164: leading +, 8–15 digits. Server-side validation is authoritative. */
const E164 = /^\+[1-9]\d{7,14}$/

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-1.5 border-b border-neutral-800 px-2 py-1.5">
      <button
        type="button"
        onClick={onBack}
        className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-white"
        aria-label="Back to conversations"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <span className="text-xs text-neutral-200">New message</span>
    </div>
  )
}

export function ComposeView({
  phoneNumbers,
  onBack,
  onSubmit,
}: {
  phoneNumbers: PhoneNumber[]
  onBack: () => void
  onSubmit: (input: {
    phoneNumberId: string
    contactNumber: string
    body: string
  }) => void
}) {
  const [to, setTo] = useState("")
  const [lineId, setLineId] = useState(phoneNumbers[0]?.id ?? "")
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)

  function submit() {
    const number = to.trim()
    if (!E164.test(number)) {
      setError("Enter a number like +15550104477.")
      return
    }
    if (!body.trim()) {
      setError("Message can't be empty.")
      return
    }
    setError(null)
    onSubmit({ phoneNumberId: lineId, contactNumber: number, body: body.trim() })
  }

  if (phoneNumbers.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <Header onBack={onBack} />
        <p className="p-4 text-center text-xs text-neutral-500">
          No phone lines are set up for your account yet.
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <Header onBack={onBack} />
      <div className="flex-1 space-y-2 overflow-y-auto p-2">
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-neutral-500">To</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="+15550104477"
            className="w-full rounded bg-neutral-900 px-2 py-1 text-xs text-white outline-none placeholder:text-neutral-600"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[10px] text-neutral-500">From</span>
          <select
            value={lineId}
            onChange={(e) => setLineId(e.target.value)}
            className="w-full rounded bg-neutral-900 px-2 py-1 text-xs text-white outline-none"
          >
            {phoneNumbers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Message…"
          rows={3}
          className="w-full resize-none rounded bg-neutral-900 px-2 py-1 text-xs text-white outline-none placeholder:text-neutral-600"
        />
        {error && <p className="text-[10px] text-red-400">{error}</p>}
        <button
          type="button"
          onClick={submit}
          className="w-full rounded bg-sky-600 py-1.5 text-xs font-medium text-white"
        >
          Send
        </button>
      </div>
    </div>
  )
}
