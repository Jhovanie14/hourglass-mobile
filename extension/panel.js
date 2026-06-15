const PANEL_ORIGIN = "https://www.megestic.com"

function setActiveBadge() {
  chrome.action.setBadgeText({ text: "●" })
  chrome.action.setBadgeBackgroundColor({ color: "#22c55e" })
}

window.addEventListener("message", (event) => {
  if (event.origin !== PANEL_ORIGIN) return
  const msg = event.data
  if (!msg || msg.source !== "hourglass-panel") return

  if (msg.type === "incoming") {
    chrome.notifications.create("hourglass-incoming", {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Incoming call",
      message: msg.label ? `${msg.caller} → ${msg.label}` : String(msg.caller),
      priority: 2,
    })
    setActiveBadge()
  } else if (msg.type === "call-active") {
    setActiveBadge()
  } else if (msg.type === "call-ended") {
    chrome.action.setBadgeText({ text: "" })
    chrome.notifications.clear("hourglass-incoming")
  }
})
