// Injected on normal web pages. Owns a single floating iframe that hosts the
// call widget (call-widget.html, an extension page). The service worker tells us
// when to show/hide it via chrome.runtime messages. The widget carries no call
// state itself — it's the offscreen engine's remote.
const WIDGET_ID = "hourglass-call-widget"

function ensureFrame() {
  let frame = document.getElementById(WIDGET_ID)
  if (frame) return frame
  frame = document.createElement("iframe")
  frame.id = WIDGET_ID
  frame.src = chrome.runtime.getURL("call-widget.html")
  frame.allow = "microphone; autoplay"
  // The React card positions itself (fixed, bottom-right); this host frame just
  // needs to float above the page and pass clicks through its transparent area.
  frame.style.cssText = [
    "position:fixed",
    "right:0",
    "bottom:0",
    "width:340px",
    "height:220px",
    "border:0",
    "z-index:2147483647",
    "background:transparent",
    "color-scheme:normal",
  ].join(";")
  document.documentElement.appendChild(frame)
  return frame
}

function setVisible(show) {
  if (!show) {
    const frame = document.getElementById(WIDGET_ID)
    if (frame) frame.remove()
    return
  }
  ensureFrame()
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "widget-visibility") return
  setVisible(Boolean(message.show))
})

// On (re)injection into a freshly-focused tab, ask the SW whether a call is live
// so we re-show the widget when the agent switches tabs mid-call.
chrome.runtime.sendMessage({ kind: "widget-hello" }).catch(() => {})
