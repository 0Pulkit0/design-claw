// Pure capture-session logic (NO DOM, NO chrome) so the identity + lifecycle
// decisions are unit-testable. The side panel is a thin wiring layer over this.
// Identity comes from the Chrome-provided MessageSender, never from a sourceUrl
// string in the message body.

let counter = 0;

export function newSession(tab, mode) {
  if (!tab || tab.id == null || tab.windowId == null) return null;
  counter += 1;
  return {
    requestId: `req-${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`,
    tabId: tab.id,
    windowId: tab.windowId,
    url: tab.url || null,
    mode,
    createdAt: Date.now(),
  };
}

// Should this panel accept an incoming DC_PICKED? Validates request freshness and
// that the sender tab/window is the session's originating one. `handled` is a Set
// of already-processed requestIds (dedupe).
export function acceptCapture({ session, msg, sender, handled }) {
  if (!session) return { accept: false, reason: "no active picking session" };
  if (!msg || msg.requestId == null) return { accept: false, reason: "message missing requestId" };
  if (msg.requestId !== session.requestId) return { accept: false, reason: "obsolete or foreign request" };
  if (handled && handled.has(msg.requestId)) return { accept: false, reason: "duplicate request" };
  const t = sender && sender.tab;
  if (!t || t.id !== session.tabId) return { accept: false, reason: "sender is not the originating tab" };
  if (t.windowId !== session.windowId) return { accept: false, reason: "sender is not this panel's window" };
  if (session.documentId && sender.documentId && sender.documentId !== session.documentId) return { accept: false, reason: "message from a replaced document (reload)" };
  if (session.frameId != null && sender.frameId != null && sender.frameId !== session.frameId) return { accept: false, reason: "message from an unexpected frame" };
  return { accept: true };
}

// Immediately before capture: the originating tab must still be the active tab in
// its window and must not have navigated away from the frame that picked.
export function confirmActive({ session, activeTab, senderUrl }) {
  if (!session) return { ok: false, reason: "picking session ended" };
  if (!activeTab || activeTab.id !== session.tabId) return { ok: false, reason: "the originating tab is no longer active" };
  if (activeTab.windowId !== session.windowId) return { ok: false, reason: "the window changed" };
  if (senderUrl && activeTab.url && activeTab.url !== senderUrl) return { ok: false, reason: "the tab navigated before capture" };
  return { ok: true };
}
