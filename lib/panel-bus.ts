/**
 * Typed postMessage contract between the megestic /panel iframes and the
 * Chrome extension. The background phone (?mode=background) emits PanelEvents
 * and consumes PanelCommands; the remote panel UI (?mode=remote) does the
 * reverse. Extension shells relay these over chrome.runtime messages.
 *
 * `incoming`/`call-active`/`call-ended` keep the shipped v1 shape so an old
 * extension build degrades gracefully.
 */
export const PANEL_SOURCE = "hourglass-panel" as const

export type CallStatus = "idle" | "incoming" | "trying" | "ringing" | "active"

export type SerializedCallState = {
  status: CallStatus
  direction: "inbound" | "outbound" | null
  /** Inbound: the customer's number (from X-Caller-Number). */
  callerNumber: string | null
  /** Inbound: which company line was dialed. */
  companyLabel: string | null
  companyNumber: string | null
  /** Active call: the other party. */
  remoteNumber: string | null
  muted: boolean
  /** Epoch ms when the call went active; remote UI derives duration. */
  startedAt: number | null
  /** WebRTC registered and ready to place calls. */
  isReady: boolean
  online: boolean
  signedIn: boolean
  micBlocked: boolean
}

export const IDLE_STATE: SerializedCallState = {
  status: "idle",
  direction: null,
  callerNumber: null,
  companyLabel: null,
  companyNumber: null,
  remoteNumber: null,
  muted: false,
  startedAt: null,
  isReady: false,
  online: true,
  signedIn: false,
  micBlocked: false,
}

export type PanelEvent =
  | { source: typeof PANEL_SOURCE; type: "state-sync"; state: SerializedCallState }
  | { source: typeof PANEL_SOURCE; type: "incoming"; caller: string; label: string | null }
  | { source: typeof PANEL_SOURCE; type: "call-active" }
  | { source: typeof PANEL_SOURCE; type: "call-ended" }
  | { source: typeof PANEL_SOURCE; type: "auth-required" }
  | { source: typeof PANEL_SOURCE; type: "mic-blocked" }

export type PanelCommand =
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "dial"; to: string; callerId: string }
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "answer" | "decline" | "hangup" | "mute" | "unmute" }
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "dtmf"; digit: string }
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "speak"; text: string }
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "set-online"; online: boolean }
  | { source: typeof PANEL_SOURCE; type: "cmd"; cmd: "request-state" }

const EVENT_TYPES = new Set([
  "state-sync",
  "incoming",
  "call-active",
  "call-ended",
  "auth-required",
  "mic-blocked",
])

const COMMANDS = new Set([
  "dial",
  "answer",
  "decline",
  "hangup",
  "mute",
  "unmute",
  "dtmf",
  "speak",
  "set-online",
  "request-state",
])

function hasSource(msg: unknown): msg is { source: string; type: string } {
  return (
    typeof msg === "object" &&
    msg !== null &&
    (msg as { source?: unknown }).source === PANEL_SOURCE &&
    typeof (msg as { type?: unknown }).type === "string"
  )
}

export function isPanelEvent(msg: unknown): msg is PanelEvent {
  return hasSource(msg) && EVENT_TYPES.has(msg.type)
}

export function isPanelCommand(msg: unknown): msg is PanelCommand {
  return (
    hasSource(msg) &&
    msg.type === "cmd" &&
    COMMANDS.has((msg as { cmd?: unknown }).cmd as string)
  )
}
