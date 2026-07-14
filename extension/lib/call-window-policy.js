// Pure decisions for when the dedicated incoming-call window opens and closes.
// No chrome.* or DOM here so it unit-tests in plain node (mirrors widget-policy.js).

// Serialized call statuses that mean "a call session is underway".
const LIVE = new Set(["incoming", "ringing", "trying", "active"])

/**
 * Open the call window when an INBOUND call starts ringing. Edge-triggered on the
 * transition into "incoming" so repeated state-syncs don't reopen it. Outbound
 * calls never pass through "incoming", so they never pop a window.
 */
export function shouldOpenCallWindow(prevStatus, nextStatus) {
  return nextStatus === "incoming" && prevStatus !== "incoming"
}

/**
 * Close the call window when a call session ends — any live status (answered,
 * ringing, or the inbound "incoming") returning to idle. Declined/missed/hung-up
 * all land on idle. Harmless for outbound (the service worker only acts if a
 * window is actually tracked).
 */
export function shouldCloseCallWindow(prevStatus, nextStatus) {
  return nextStatus === "idle" && LIVE.has(prevStatus)
}
