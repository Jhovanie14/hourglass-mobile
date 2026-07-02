// Shell around the popup remote UI: relays its PanelCommands to the background
// phone, and forwards PanelEvents (state-sync etc.) into it.
const iframe = document.querySelector("iframe")
// Match whatever origin the iframe actually loads (localhost in dev, megestic in
// prod). Hardcoding it breaks the message bridge whenever the two drift apart.
const PANEL_ORIGIN = new URL(iframe.src).origin

window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type !== "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-command", payload: msg }).catch(() => {})
})

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  iframe.contentWindow.postMessage(message.payload, PANEL_ORIGIN)
})
