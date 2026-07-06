// Shell around the background phone iframe: forwards its PanelEvents to the
// rest of the extension, and injects PanelCommands into it.
const iframe = document.getElementById("phone")
// Match whatever origin the iframe actually loads (localhost in dev, megestic in
// prod). Hardcoding it breaks the message bridge whenever the two drift apart.
const PANEL_ORIGIN = new URL(iframe.src).origin

// Events out of the phone → broadcast to SW + side panel shell.
window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type === "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-event", payload: msg }).catch(() => {})
})

// Commands in → the phone iframe.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-command") return
  iframe.contentWindow.postMessage(message.payload, PANEL_ORIGIN)
})
