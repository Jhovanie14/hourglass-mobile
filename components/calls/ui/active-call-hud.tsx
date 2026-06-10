// components/calls/ui/active-call-hud.tsx
import { Mic, MicOff, PhoneOff } from "lucide-react"
import { DialPad } from "./dial-pad"

type Props = {
  callState: string
  duration: string
  remoteNumber: string
  muted: boolean
  speakText: string
  speaking: boolean
  onHangup: () => void
  onToggleMute: () => void
  onSpeakTextChange: (text: string) => void
  onSpeak: () => void
  onDtmf: (digit: string) => void
}

export function ActiveCallHud({
  callState,
  duration,
  remoteNumber,
  muted,
  speakText,
  speaking,
  onHangup,
  onToggleMute,
  onSpeakTextChange,
  onSpeak,
  onDtmf,
}: Props) {
  return (
    <div className="fixed right-6 top-6 z-50 w-80 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between bg-green-500/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
          <span className="text-xs font-semibold tracking-widest text-green-600 uppercase dark:text-green-400">
            {callState === "active"
              ? "Active Call"
              : callState === "ringing"
                ? "Ringing…"
                : "Calling…"}
          </span>
        </div>
        {callState === "active" && (
          <span className="font-mono text-sm text-muted-foreground tabular-nums">
            {duration}
          </span>
        )}
      </div>

      {/* Remote number */}
      <div className="px-4 py-3">
        <p className="text-base font-semibold">{remoteNumber}</p>
      </div>

      {/* Dialpad — intentionally shown before "active" so users can pre-dial IVR menus the moment a call connects */}
      <DialPad onDtmf={onDtmf} />

      {/* TTS speak section — active calls only */}
      {callState === "active" && (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Speak on call (TTS)</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={speakText}
              onChange={(e) => onSpeakTextChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSpeak()}
              placeholder="Type message…"
              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              onClick={onSpeak}
              disabled={!speakText.trim() || speaking}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
            >
              {speaking ? "…" : "Speak"}
            </button>
          </div>
        </div>
      )}

      {/* Call controls */}
      <div className="flex gap-2 border-t border-border px-4 py-3">
        <button
          onClick={onToggleMute}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium transition ${
            muted
              ? "bg-yellow-500 text-white hover:bg-yellow-600"
              : "bg-muted text-foreground hover:bg-muted/80"
          }`}
        >
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {muted ? "Unmute" : "Mute"}
        </button>
        <button
          onClick={onHangup}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-500 py-2.5 text-sm font-medium text-white transition hover:bg-red-600"
        >
          <PhoneOff className="h-4 w-4" />
          Hang up
        </button>
      </div>
    </div>
  )
}
