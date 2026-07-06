// First-run tab. Login + mic grant both happen INSIDE the embedded panel
// (correct origin/partition); a real tab is the only surface where the mic
// prompt can show. setup.js is glue: relay the bridge, nudge a re-probe, and
// treat the panel's own state-sync as the source of truth that setup is done.
const iframe = document.getElementById("panel")
const PANEL_ORIGIN = new URL(iframe.src).origin
const statusEl = document.getElementById("mic-status")
let completed = false

// Relay panel commands out and panel events in, like the other shells, so login
// and the online toggle round-trip while the agent is here.
window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type !== "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-command", payload: msg }).catch(() => {})
})

chrome.runtime.onMessage.addListener(async (message) => {
  if (!message || message.kind !== "panel-event") return
  const evt = message.payload
  iframe.contentWindow.postMessage(evt, PANEL_ORIGIN)
  if (
    !completed &&
    evt &&
    evt.type === "state-sync" &&
    evt.state &&
    evt.state.signedIn &&
    !evt.state.micBlocked
  ) {
    completed = true
    await chrome.storage.local.set({ "hg-setup-complete": true })
    chrome.runtime.sendMessage({ kind: "setup-complete" }).catch(() => {})
    statusEl.textContent =
      "Signed in + microphone ready — setup complete. You can close this tab."
  }
})

// Button nudges the panel to re-probe the mic (its request-state handler calls
// probeMic). If the mic is still blocked, the in-panel "grant access" button is
// what actually shows the prompt.
document.getElementById("enable-mic").addEventListener("click", () => {
  statusEl.textContent =
    "If prompted, choose Allow. If a red 'grant access' button shows in the panel, click it."
  iframe.contentWindow.postMessage(
    { source: "hourglass-panel", type: "cmd", cmd: "request-state" },
    PANEL_ORIGIN
  )
})
