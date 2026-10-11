// Service worker — thin. Opens the side panel from action.onClicked.
//
// Why not openPanelOnActionClick: that opens the panel but does NOT grant
// activeTab, so chrome.tabs.captureVisibleTab failed with "Either the
// '<all_urls>' or 'activeTab' permission is required" (Phase 0 check #2).
// Handling onClicked ourselves means the toolbar click is a recognized gesture
// that grants activeTab for that tab — captureVisibleTab then works with no
// host permissions. Cost: activeTab is per-tab and dropped on navigation, so to
// grab from a new site you click the toolbar icon on it first (that re-grants).

// Make sure the action click reaches onClicked (a previously-set
// openPanelOnActionClick:true would otherwise swallow it and reintroduce the bug).
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch (e) {
    console.error("sidePanel.open:", e);
  }
});

// Fallback capture broker. With activeTab the panel usually captures directly;
// this stays as a secondary path and to keep the spike honest about which works.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === "CAPTURE_VISIBLE_TAB") {
    const opts = { format: "png" };
    const p =
      typeof msg.windowId === "number"
        ? chrome.tabs.captureVisibleTab(msg.windowId, opts)
        : chrome.tabs.captureVisibleTab(opts);
    p.then((dataUrl) => sendResponse({ ok: true, dataUrl })).catch((e) =>
      sendResponse({ ok: false, error: String(e?.message || e) })
    );
    return true;
  }
});
