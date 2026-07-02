// Shell around the remote panel UI: relays its PanelCommands to the
// background phone, and forwards PanelEvents (state-sync etc.) into it.
const iframe = document.querySelector("iframe")
// Match whatever origin the iframe actually loads (localhost in dev, megestic in
// prod). Hardcoding it breaks the message bridge whenever the two drift apart.
const PANEL_ORIGIN = new URL(iframe.src).origin

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
