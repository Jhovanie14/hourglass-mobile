// Shell around the widget UI iframe. Relays its PanelCommands out and forwards
// PanelEvents in, over chrome.runtime — same contract as the popup shell.
const iframe = document.querySelector("iframe")
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
