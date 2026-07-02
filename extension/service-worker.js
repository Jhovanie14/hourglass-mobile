// Coordinator: keeps the offscreen phone alive, turns PanelEvents into
// notifications/badge, and issues Answer/Decline commands from notification
// buttons (button clicks are user gestures, so sidePanel.open is allowed).
const INCOMING_ID = "hourglass-incoming"
const AUTH_ID = "hourglass-auth"
const MIC_ID = "hourglass-mic"

async function ensureOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification:
        "Keeps the agent phone registered so calls ring and connect while the side panel is closed.",
    })
  } catch (e) {
    // "Only a single offscreen document" race — safe to ignore.
    if (!String(e).includes("single offscreen")) console.error(e)
  }
}

chrome.runtime.onInstalled.addListener(() => {
  ensureOffscreen()
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})
})
chrome.runtime.onStartup.addListener(ensureOffscreen)

async function openSidePanel() {
  const win = await chrome.windows.getLastFocused()
  try {
    await chrome.sidePanel.open({ windowId: win.id })
  } catch (e) {
    console.warn("sidePanel.open failed:", e)
  }
}

function sendCommand(cmd) {
  chrome.runtime
    .sendMessage({
      kind: "panel-command",
      payload: { source: "hourglass-panel", type: "cmd", ...cmd },
    })
    .catch(() => {})
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  ensureOffscreen()
  const evt = message.payload

  if (evt.type === "incoming") {
    chrome.notifications.create(INCOMING_ID, {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Incoming call",
      message: evt.label ? `${evt.caller} → ${evt.label}` : String(evt.caller),
      buttons: [{ title: "Answer" }, { title: "Decline" }],
      requireInteraction: true,
      priority: 2,
    })
    chrome.action.setBadgeText({ text: "●" })
    chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" })
  } else if (evt.type === "call-active") {
    chrome.notifications.clear(INCOMING_ID)
    chrome.action.setBadgeText({ text: "●" })
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" })
  } else if (evt.type === "call-ended") {
    chrome.notifications.clear(INCOMING_ID)
    chrome.action.setBadgeText({ text: "" })
  } else if (evt.type === "auth-required") {
    chrome.notifications.create(AUTH_ID, {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Sign in to receive calls",
      message: "Open the Hourglass panel and sign in — calls will not ring until you do.",
      priority: 2,
    })
    chrome.action.setBadgeText({ text: "!" })
    chrome.action.setBadgeBackgroundColor({ color: "#ef4444" })
  } else if (evt.type === "mic-blocked") {
    chrome.notifications.create(MIC_ID, {
      type: "basic",
      iconUrl: "icon128.png",
      title: "Microphone blocked",
      message: "Open the Hourglass panel and grant microphone access to take calls.",
      priority: 2,
    })
  } else if (evt.type === "state-sync") {
    if (evt.state && evt.state.signedIn) {
      chrome.notifications.clear(AUTH_ID)
      if (evt.state.status === "idle") chrome.action.setBadgeText({ text: "" })
    }
  }
})

chrome.notifications.onButtonClicked.addListener((id, buttonIndex) => {
  if (id !== INCOMING_ID) return
  if (buttonIndex === 0) {
    sendCommand({ cmd: "answer" })
    openSidePanel()
  } else {
    sendCommand({ cmd: "decline" })
  }
  chrome.notifications.clear(INCOMING_ID)
})

chrome.notifications.onClicked.addListener((id) => {
  openSidePanel()
  chrome.notifications.clear(id)
})
