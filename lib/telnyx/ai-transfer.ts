// Pure helpers for the AI assistant's transfer-to-human tool. No SDK, DB, or
// env access at module scope so it unit-tests in plain node (mirrors the other
// lib/telnyx pure modules).

import type { ReachableAgent } from "./ring-all"

/** Cap on how many agents we hand the assistant. Not configurable: the
 *  assistant picks one target anyway, so a longer list only bloats the
 *  payload and slows the webhook. */
export const MAX_TRANSFER_TARGETS = 5

export type TransferTarget = {
  to: string
  name: string
}

export type TransferVariables = {
  agents_available: boolean
  targets: TransferTarget[]
}

/** The state every failure path returns: the assistant tells the caller nobody
 *  is available and takes a message, which is exactly today's behaviour. */
export const FAIL_SAFE_VARIABLES: TransferVariables = {
  agents_available: false,
  targets: [],
}

/**
 * Online agents → the dynamic variables the assistant's transfer tool needs.
 * `agents_available` is what the instructions branch on; `targets` is what
 * `{{ targets }}` resolves to. Agents without a usable SIP username are
 * dropped rather than emitted as a malformed URI the transfer would fail on.
 */
export function transferVariables(agents: ReachableAgent[]): TransferVariables {
  const targets = agents
    .filter((a) => a.sipUsername.trim() !== "")
    .slice(0, MAX_TRANSFER_TARGETS)
    .map((a, index) => ({
      to: `sip:${a.sipUsername.trim()}@sip.telnyx.com`,
      // Deliberately generic: the caller may hear this, and it must not leak a
      // real agent's identity. Telnyx does not report which target it chose, so
      // this is a label only (see the spec's Known limitations).
      name: `Agent ${index + 1}`,
    }))
  return { agents_available: targets.length > 0, targets }
}

/** Telnyx silently ignores a flat response and falls back to assistant
 *  defaults, so every response goes through this wrapper. Generic because the
 *  route composes transfer variables with others (e.g. pricing) before
 *  wrapping. */
export function wrapDynamicVariables<T>(vars: T): { dynamic_variables: T } {
  return { dynamic_variables: vars }
}
