// Production capture dependencies for the side panel, extracted so the success
// path — DC_RELEASE delivery, session cleanup, and the persist->tray-store commit —
// is testable with a mocked chrome + store instead of only through mockDeps.
//
// createCaptureController(createCaptureDeps(env)) is exactly what the panel wires;
// tests build env from fakes and assert the real behavior.
export function createCaptureDeps(env) {
  // env: chrome, confirmActive, captureImage(windowId)->image, planCrop, drawCrop,
  //      store (tray-store), getSession()->session|null, setSession(s|null),
  //      addThumb(id, blob), markStale(), toast(msg)
  const { chrome } = env;

  function buildItem(sess, msg, crop) {
    return {
      id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sourceUrl: sess.url || msg.sourceUrl || "",
      tabId: sess.tabId,
      role: "component",
      note: "",
      w: crop.w, h: crop.h,
      clipped: !!crop.clipped,
      bytes: crop.blob?.size ?? 0,
      createdAt: Date.now(),
      tokens: msg.tokens || null,
      // How this reference was captured, and what that means for measurement.
      // Recorded from evidence the picker reported — an extraction FAILURE is
      // never relabelled as a deliberate image-only capture.
      mode: msg.mode === "area" ? "area" : "element",
      measurement: msg.measurement || null,
      tiles: crop.tiles || null,
    };
  }

  return {
    confirm: async (sess, msg) => {
      const [activeNow] = await chrome.tabs.query({ active: true, windowId: sess.windowId });
      const chk = env.confirmActive({ session: sess, activeTab: activeNow, senderUrl: sess.url });
      if (!chk.ok) throw new Error(chk.reason);
      try { return await chrome.tabs.sendMessage(sess.tabId, { type: "DC_CONFIRM", requestId: msg.requestId }, sess.frameId != null ? { frameId: sess.frameId } : undefined); }
      catch { return null; } // originating frame/document gone (e.g. reload) -> controller aborts
    },
    // Element capture goes through the SAME shared capture coordinator as area
    // capture when one is injected (env.capturePacer): one Web Lock + shared
    // timestamp pacing + quota retry across every panel. Falls back to a direct
    // screenshot only when no pacer is wired (older callers / unit tests).
    capture: (sess) => (env.capturePacer
      ? env.capturePacer.capture(() => (env.screenshot || env.captureImage)(sess.windowId))
      : env.captureImage(sess.windowId)),
    plan: (rectCss, vw, vh, image) => env.planCrop(rectCss, vw, vh, image.naturalWidth, image.naturalHeight),
    draw: (image, plan) => env.drawCrop(image, plan),
    persist: async ({ session: sess, msg, crop, cancelled }) => {
      if (!crop?.blob) return { ok: false, committed: false, reason: "The captured image could not be encoded. Capture the reference again." };
      const item = buildItem(sess, msg, crop);
      const res = await env.store.add({ item, blob: crop.blob, cancelled });
      if (res.committed) { env.addThumb(item.id, crop.blob); env.markStale(); }
      return { ...res, w: crop.w, h: crop.h, clipped: crop.clipped };
    },    // Positional (sess, msg) — matches how the controller calls deps.release(session, msg).
    // Sends DC_RELEASE so the picker settles on acknowledgement (not after the 2.5s
    // expiry), swallows a delivery rejection (picker already gone), and clears the
    // panel session ONLY when the completing request is still the current one, so an
    // older completion cannot clear a newer pick's session.
    release: (sess, msg) => {
      try {
        const r = chrome.tabs.sendMessage(sess.tabId, { type: "DC_RELEASE", requestId: msg.requestId }, sess.frameId != null ? { frameId: sess.frameId } : undefined);
        if (r && typeof r.catch === "function") r.catch(() => {});
      } catch {}
      const s = env.getSession();
      if (s && s.requestId === msg.requestId) env.setSession(null);
    },
    // A committed add whose view refresh failed is still a success: the reference is
    // persisted and its crop is kept, so report both facts rather than a failure.
    report: (res) => {
      if (!res.ok) return env.toast(`Capture cancelled — ${res.reason}`);
      env.toast(`Added ${res.w}×${res.h}${res.clipped ? " (visible part only)" : ""}${res.notifyError ? " — list not refreshed, reopen the panel" : ""}`);
    },
  };
}
