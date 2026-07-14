// Shell around the incoming-call window: bridges the panel card's PanelCommands
// out to the background phone and forwards PanelEvents in — same contract as
// popup.js. On load it parks the window in the top-right corner of the primary
// display (geometry the service worker can't see).
const iframe = document.querySelector("iframe")
// Match whatever origin the iframe loads (localhost in dev, megestic in prod).
const PANEL_ORIGIN = new URL(iframe.src).origin

async function parkTopRight() {
  try {
    const win = await chrome.windows.getCurrent()
    const margin = 16
    const availLeft = window.screen.availLeft ?? 0
    const availTop = window.screen.availTop ?? 0
    const width = win.width ?? 360
    const left = Math.round(availLeft + window.screen.availWidth - width - margin)
    const top = Math.round(availTop + margin)
    await chrome.windows.update(win.id, { left, top, focused: true })
  } catch (e) {
    console.warn("call-window park failed:", e)
  }
}
parkTopRight()

// Commands out of the card → background phone (via offscreen doc).
window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel" || msg.type !== "cmd") return
  chrome.runtime.sendMessage({ kind: "panel-command", payload: msg }).catch(() => {})
})

// Events in → the card iframe.
chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  iframe.contentWindow.postMessage(message.payload, PANEL_ORIGIN)
})
