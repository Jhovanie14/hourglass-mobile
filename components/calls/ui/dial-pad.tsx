// components/calls/ui/dial-pad.tsx
import { useState } from "react"
import { Delete } from "lucide-react"

type Props = {
  onDtmf: (digit: string) => void
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]
const KEY_LABELS: Record<string, string> = { "*": "Star", "#": "Pound" }

export function DialPad({ onDtmf }: Props) {
  const [digits, setDigits] = useState("")

  function press(digit: string) {
    setDigits((d) => (d.length < 20 ? d + digit : d))
    onDtmf(digit)
  }

  function backspace() {
    setDigits((d) => d.slice(0, -1))
  }

  return (
    <div className="border-t border-border px-4 py-3">
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Keypad</p>

      {/* Digit display */}
      <div className="mb-2 flex items-center gap-2">
        <div className="flex min-h-[2rem] flex-1 items-center rounded-lg border border-input bg-background px-3 py-1 font-mono text-sm tabular-nums text-foreground">
          {digits || <span className="text-muted-foreground">—</span>}
        </div>
        <button
          type="button"
          onClick={backspace}
          disabled={digits.length === 0}
          className="rounded-lg border border-input bg-background p-1.5 text-muted-foreground transition hover:bg-muted disabled:opacity-30"
          aria-label="Backspace"
        >
          <Delete className="h-4 w-4" />
        </button>
      </div>

      {/* Key grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {KEYS.map((key) => (
          <button
            type="button"
            key={key}
            onClick={() => press(key)}
            className="rounded-xl bg-muted py-2.5 text-sm font-semibold tabular-nums text-foreground transition hover:bg-muted/80 active:scale-95"
            aria-label={KEY_LABELS[key] ?? key}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  )
}
