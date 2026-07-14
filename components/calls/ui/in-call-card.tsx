// components/calls/ui/in-call-card.tsx
import { Mic, MicOff, PhoneOff } from "lucide-react"

type Props = {
  remoteNumber: string
  duration: string
  muted: boolean
  onToggleMute: () => void
  onHangup: () => void
  // Positioning/size for the outer wrapper. Default = bottom-right corner card
  // (in-tab widget); the call window overrides this to fill its window.
  className?: string
}

export function InCallCard({
  remoteNumber,
  duration,
  muted,
  onToggleMute,
  onHangup,
  className = "fixed right-6 bottom-6 z-50 w-72",
}: Props) {
  return (
    <div
      className={`${className} overflow-hidden rounded-2xl border border-border bg-card shadow-2xl`}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-sm font-semibold tabular-nums">{remoteNumber}</span>
        <span className="text-xs font-medium text-green-600 tabular-nums dark:text-green-400">
          {duration}
        </span>
      </div>
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onToggleMute}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium transition hover:bg-muted"
        >
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={onHangup}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
        >
          <PhoneOff className="h-4 w-4" />
          Hang Up
        </button>
      </div>
    </div>
  )
}
