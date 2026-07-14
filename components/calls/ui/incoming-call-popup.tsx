// components/calls/ui/incoming-call-popup.tsx
import { Phone, PhoneOff } from "lucide-react"

type Props = {
  callerNumber: string
  companyLabel: string | null
  companyNumber: string | null
  busy: boolean
  onAnswer: () => void
  onReject: () => void
  // Positioning/size for the outer wrapper. Default = bottom-right corner card;
  // the call window overrides this to fill its window.
  className?: string
}

export function IncomingCallPopup({
  callerNumber,
  companyLabel,
  companyNumber,
  busy,
  onAnswer,
  onReject,
  className = "fixed right-6 bottom-6 z-50 w-72",
}: Props) {
  return (
    <div
      className={`${className} overflow-hidden rounded-2xl border border-border bg-card shadow-2xl`}
    >
      <div className="relative flex items-center gap-3 bg-green-500/10 px-4 py-3">
        <span className="relative flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
        </span>
        <span className="text-xs font-semibold tracking-widest text-green-600 uppercase dark:text-green-400">
          Incoming Call
        </span>
      </div>

      <div className="space-y-1 px-4 py-3">
        <p className="text-lg font-semibold tracking-tight tabular-nums">{callerNumber}</p>
        {companyLabel && companyNumber && (
          <p className="text-sm text-muted-foreground">
            → {companyLabel} ({companyNumber})
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onReject}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600 disabled:opacity-50"
        >
          <PhoneOff className="h-4 w-4" />
          Decline
        </button>
        <button
          onClick={onAnswer}
          disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-green-500 py-2.5 text-sm font-medium text-white transition hover:bg-green-600 disabled:opacity-50"
        >
          <Phone className="h-4 w-4" />
          Answer
        </button>
      </div>
    </div>
  )
}
