// Shell around the remote panel UI: relays its PanelCommands to the
// background phone, and forwards PanelEvents (state-sync etc.) into it.
const PANEL_ORIGIN = "https://www.megestic.com"
const iframe = document.querySelector("iframe")

// Commands out of the panel UI → broadcast (offscreen shell injects them).
window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type !== "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-command", payload: msg }).catch(() => {})
})

// Events from the background phone → into the panel UI iframe.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  iframe.contentWindow.postMessage(message.payload, PANEL_ORIGIN)
})
