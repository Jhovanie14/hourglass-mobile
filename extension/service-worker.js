// Coordinator: keeps the offscreen phone alive, turns PanelEvents into
// notifications/badge, drives the per-tab call widget, and opens/closes the
// dedicated incoming-call popup window as call state changes.
import { canInjectWidget, shouldShowWidget } from "./lib/widget-policy.js"
import { needsSetup } from "./lib/setup-policy.js"
import { shouldOpenCallWindow, shouldCloseCallWindow } from "./lib/call-window-policy.js"

const AUTH_ID = "hourglass-auth"
const MIC_ID = "hourglass-mic"

// Latest serialized call status from the offscreen engine; drives the widget.
let lastStatus = "idle"

// The dedicated incoming-call popup window, if one is open.
let callWindowId = null

async function openCallWindow() {
  // Reuse an existing window if it's still around (guards repeated state-syncs
  // and create races).
  if (callWindowId !== null) {
    try {
      await chrome.windows.get(callWindowId)
      return
    } catch {
      callWindowId = null
    }
  }
  try {
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL("call-window.html"),
      type: "popup",
      focused: true,
      width: 360,
      height: 250,
    })
    callWindowId = win.id ?? null
  } catch (e) {
    console.error("openCallWindow failed:", e)
  }
}

async function closeCallWindow() {
  if (callWindowId === null) return
  const id = callWindowId
  callWindowId = null
  try {
    await chrome.windows.remove(id)
  } catch {}
}

// If the agent closes the window by hand, forget it (closing does NOT decline —
// the call keeps ringing; the server records a missed call if unanswered).
chrome.windows.onRemoved.addListener((id) => {
  if (id === callWindowId) callWindowId = null
})

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

chrome.runtime.onInstalled.addListener(async () => {
  ensureOffscreen()
  // First install (no persisted grant) → walk the agent through the setup tab,
  // the only surface where the mic prompt can show.
  if (needsSetup({ signedIn: false, micGranted: await isSetupComplete() })) {
    openSetup()
  }
})
chrome.runtime.onStartup.addListener(ensureOffscreen)

async function openSidePanel() {
  // Notifications/answer actions are user gestures, so we can open the popup.
  try {
    await chrome.action.openPopup()
  } catch (e) {
    console.warn("openPopup failed:", e)
  }
}

async function openSetup() {
  await chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") })
}

async function isSetupComplete() {
  const { "hg-setup-complete": done } = await chrome.storage.local.get(
    "hg-setup-complete"
  )
  return Boolean(done)
}

// Push the widget's show/hide state to the active tab (if it can host it).
async function updateActiveTabWidget() {
  const show = shouldShowWidget(lastStatus)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || !tab.id || !canInjectWidget(tab.url || "")) return
  chrome.tabs
    .sendMessage(tab.id, { kind: "widget-visibility", show })
    .catch(() => {})
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.kind !== "panel-event") return
  ensureOffscreen()
  const evt = message.payload

  if (evt.type === "incoming") {
    // The dedicated call window (opened from the state-sync handler below) is now
    // the incoming-call UI; no OS notification toast. Badge still marks the ring.
    chrome.action.setBadgeText({ text: "●" })
    chrome.action.setBadgeBackgroundColor({ color: "#3b82f6" })
  } else if (evt.type === "call-active") {
    chrome.action.setBadgeText({ text: "●" })
    chrome.action.setBadgeBackgroundColor({ color: "#22c55e" })
  } else if (evt.type === "call-ended") {
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
    if (evt.state) {
      const prevStatus = lastStatus
      const nextStatus = evt.state.status
      lastStatus = nextStatus
      updateActiveTabWidget()
      if (shouldOpenCallWindow(prevStatus, nextStatus)) openCallWindow()
      if (shouldCloseCallWindow(prevStatus, nextStatus)) closeCallWindow()
      if (evt.state.signedIn) {
        chrome.notifications.clear(AUTH_ID)
        if (nextStatus === "idle") chrome.action.setBadgeText({ text: "" })
      }
    }
  }
})

// A freshly-injected/focused content script says hello → tell it whether a call
// is live so the widget follows the agent across tabs mid-call.
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.kind !== "widget-hello") return
  if (!sender.tab || !sender.tab.id) return
  if (!canInjectWidget(sender.tab.url || "")) return
  chrome.tabs
    .sendMessage(sender.tab.id, {
      kind: "widget-visibility",
      show: shouldShowWidget(lastStatus),
    })
    .catch(() => {})
})

chrome.tabs.onActivated.addListener(() => updateActiveTabWidget())

// Setup finished in the setup tab → recreate the offscreen engine so it re-reads
// the fresh session + mic grant cleanly.
chrome.runtime.onMessage.addListener(async (message) => {
  if (!message || message.kind !== "setup-complete") return
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument()
  } catch {}
  ensureOffscreen()
})

chrome.notifications.onClicked.addListener((id) => {
  openSidePanel()
  chrome.notifications.clear(id)
})
