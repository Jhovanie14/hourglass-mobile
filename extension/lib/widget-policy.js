// Pure decisions for where/when the call widget appears. No chrome.* here so it
// unit-tests in plain node.

const BLOCKED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge://",
  "view-source:",
  "file://",
]

const BLOCKED_HOSTS = new Set(["chromewebstore.google.com"])

/** Can a content script run on this tab URL? */
export function canInjectWidget(url) {
  if (typeof url !== "string" || url.length === 0) return false
  for (const p of BLOCKED_PREFIXES) if (url.startsWith(p)) return false
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false
  if (BLOCKED_HOSTS.has(parsed.hostname)) return false
  // Legacy webstore path lives on chrome.google.com/webstore.
  if (parsed.hostname === "chrome.google.com" && parsed.pathname.startsWith("/webstore")) {
    return false
  }
  return true
}

const LIVE = new Set(["incoming", "ringing", "trying", "active"])

/** Should the widget be visible for this serialized call status? */
export function shouldShowWidget(status) {
  return LIVE.has(status)
}
