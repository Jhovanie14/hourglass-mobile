chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch(() => {})
})

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id)
})
