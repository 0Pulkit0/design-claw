// Production dependencies for extended (scroll-and-stitch) area capture, kept
// next to lib/panel-capture.js so the panel stays thin wiring and the policy is
// testable with a mocked chrome + store.
//
// It reuses createCaptureDeps for the parts that are identical to a single-shot
// capture (the document/tab handshake, the transactional persist, releasing the
// page) and adds the stitch-specific plumbing: page preparation, scrolling,
// paced screenshots, canvas composition, and restoration.
//
// Screenshots go through the SAME extension-wide capture coordinator (one shared
// Web Lock + shared timestamp, injected as env.capturePacer) used by element
// capture, so element and area captures can never collide on Chrome's per-
// extension captureVisibleTab quota.
import { createCaptureDeps } from "./panel-capture.js";
import { makeValidator } from "./capture-controller.js";

export function createStitchDeps(env) {
  // env: chrome, confirmActive, screenshot(windowId)->image, capturePacer, store,
  //      getSession, setSession, addThumb, markStale, toast, progress(state),
  //      scrollTolerance?
  const { chrome } = env;
  const base = createCaptureDeps(env);
  const tol = env.scrollTolerance == null ? 4 : env.scrollTolerance;

  // Ask the originating frame to do something, with the requestId it validates.
  const ask = (sess, msg, payload) =>
    chrome.tabs.sendMessage(sess.tabId, { ...payload, requestId: msg.requestId }, sess.frameId != null ? { frameId: sess.frameId } : undefined);

  // Re-read the live scroll offset + geometry from the page and abort if it has
  // drifted from where the tile was planned. Checked once after the shared lock is
  // acquired (catching movement that happened WHILE queued) and once after the
  // screenshot (catching movement WHILE the shot was pending). Both axes.
  async function assertStill(sess, msg, expected, when) {
    let r;
    try { r = await ask(sess, msg, { type: "DC_CONFIRM_SCROLL" }); }
    catch { throw new Error("the page stopped responding during capture"); }
    if (!r || r.ok === false) throw new Error("the page stopped responding during capture");
    if (Math.abs((r.scrollY || 0) - expected.scrollY) > tol || Math.abs((r.scrollX || 0) - expected.scrollX) > tol) {
      throw new Error(`the page scrolled ${when} — nothing was saved`);
    }
    if (r.vw !== expected.vw || r.vh !== expected.vh) throw new Error(`the window was resized ${when} — nothing was saved`);
    if (expected.docH != null && Math.abs((r.docH || 0) - expected.docH) > 64) throw new Error(`the page changed size ${when} — nothing was saved`);
  }

  return {
    validate: makeValidator(base.confirm),
    persist: base.persist,
    progress: (state) => { if (env.progress) env.progress(state); },

    // One paced tile screenshot, bracketed by scroll re-checks inside the shared
    // lock. A scroll-drift aborts (not a rate-limit, so the pacer does not retry
    // it); a quota error from the screenshot propagates to the pacer for retry.
    capture: (sess, msg, expected) => env.capturePacer.capture(async () => {
      await assertStill(sess, msg, expected, "while queued for the screenshot");
      const img = await env.screenshot(sess.windowId);
      await assertStill(sess, msg, expected, "while the screenshot was taken");
      return img;
    }),

    // Freeze the page: instant scrolling, paused animations, overlays hidden,
    // user scrolling blocked, fixed/sticky elements neutralised so they appear
    // once instead of in every tile. Returns the page metrics the plan uses.
    prepare: async (sess, msg) => {
      let r;
      try { r = await ask(sess, msg, { type: "DC_PREPARE_STITCH" }); }
      catch { return { ok: false, reason: "The page stopped responding before capture — pick the area again." }; }
      if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || "The page could not be prepared for capture." };
      // A page that does not scroll in the window cannot be stitched beyond one
      // screen: its content scrolls inside a container we cannot drive safely.
      const needsScroll = msg.rectDoc && msg.rectDoc.h > r.vh + 2;
      if (needsScroll && !r.scrolls) {
        return { ok: true, ...r, unsupported: true, reason: "This page doesn't scroll in the window — its content scrolls inside a panel, which can't be stitched into one image. Capture what's on screen instead." };
      }
      // A page too large to scan exhaustively may still have fixed elements we
      // did not neutralise: say so rather than let the user wonder.
      if (r.scanLimited) env.toast("Large page — a fixed element may repeat in the image");
      return { ok: true, ...r };
    },

    scrollTo: async (sess, msg, y) => {
      try {
        const r = await ask(sess, msg, { type: "DC_SCROLL_TO", y });
        if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || "The page would not scroll." };
        return r;
      } catch { return { ok: false, reason: "The page stopped responding during capture." }; }
    },

    // Always runs: restore scroll position, styles, user-scroll listeners, then
    // let the picker settle. Failures here are swallowed — the page may be gone.
    finish: async (sess, msg) => {
      try { await ask(sess, msg, { type: "DC_END_STITCH" }); } catch {}
      try { base.release(sess, msg); } catch {}
    },

    makeCanvas: (w, h) => {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      return {
        drawImage: (image, p) => ctx.drawImage(image, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh),
        toBlob: () => new Promise((res) => canvas.toBlob(res, "image/png")),
      };
    },

    report: (res) => {
      if (!res.ok) return env.toast(res.reason === "cancelled" ? "Area capture cancelled" : `Area capture stopped — ${res.reason}`);
      const from = res.tiles > 1 ? ` from ${res.tiles} screenshots` : "";
      env.toast(`Added ${res.w}×${res.h}${from}${res.clipped ? " (clipped sideways)" : ""}${res.notifyError ? " — list not refreshed" : ""}`);
    },
  };
}
