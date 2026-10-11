// Pick-session orchestration, as a CLASSIC script so it can be injected into the
// page as a content-script file (ES module import is unavailable there) before
// picker.js. It exposes the factory on globalThis. The test runner evaluates this
// exact file, so the tests exercise the production controller, not a copy.
//
// States: idle -> processing -> sent -> settled. Starting a capture moves to
// "processing" (which blocks repeated clicks) but cancel() stays effective in ANY
// non-settled state, and cancellation is re-checked at every async boundary
// before the commit (the DC_PICKED send).
//
// Two lifecycles, because the two captures take very different times:
//   element — one screenshot: a single short release timeout (2.5s).
//   area    — scroll-and-stitch: many screenshots over seconds. A fixed short
//     timeout would expire mid-capture, so the area lifecycle is bounded by an
//     IDLE timeout (reset by every panel message: prepare / scroll / end) plus an
//     absolute cap. Timeout protection is kept in both directions: a panel that
//     dies mid-stitch still releases the page, and a stitch that runs too long is
//     cut off instead of holding the page hostage.
(function () {
  function createPickController(host) {
    const RELEASE_MS = host.releaseMs == null ? 2500 : host.releaseMs;
    const IDLE_MS = host.stitchIdleMs == null ? 15000 : host.stitchIdleMs;
    const TOTAL_MS = host.stitchTotalMs == null ? 150000 : host.stitchTotalMs;
    let state = "idle";
    let cancelled = false;
    let mode = "element";

    function clearTimers() {
      try { host.clearReleaseTimer(); } catch (e) {}
      if (host.clearTotalTimer) { try { host.clearTotalTimer(); } catch (e) {} }
    }
    function settle() {
      if (state === "settled") return; // idempotent
      state = "settled";
      clearTimers();
      host.cleanup();
    }
    function cancel() {
      if (state === "settled") return; // late cancels after settle are harmless
      cancelled = true;
      try { host.send({ type: "DC_PICK_CANCELLED", requestId: host.requestId }); } catch (e) {}
      settle();
    }
    function release() { settle(); } // panel acked (DC_RELEASE): capture is done, restore the page
    // A timeout fired: the panel never acked in time. Treat the request as expired
    // and TELL the panel so it aborts any capture still in flight. This is distinct
    // from a silent cleanup — expiry must invalidate an already-running panel
    // capture, not merely stop future handshakes.
    function expire() {
      if (state === "settled") return;
      cancelled = true;
      try { host.send({ type: "DC_PICK_CANCELLED", requestId: host.requestId, reason: "expired" }); } catch (e) {}
      settle();
    }
    // A panel message proves the capture is still progressing: restart the idle
    // timer. The absolute cap is NOT extended.
    function touch() {
      if (state !== "sent" || mode !== "area") return;
      host.setReleaseTimer(function () { expire(); }, IDLE_MS);
    }

    function armLifecycle() {
      if (mode === "area") {
        host.setReleaseTimer(function () { expire(); }, IDLE_MS);
        if (host.setTotalTimer) host.setTotalTimer(function () { expire(); }, TOTAL_MS);
      } else {
        host.setReleaseTimer(function () { expire(); }, RELEASE_MS);
      }
    }

    function send(payload) {
      if (cancelled || state === "settled") return; // last check before commit
      state = "sent";
      armLifecycle();
      try { host.send(payload); } catch (e) { settle(); }
    }

    async function commitRect(rectCss, tokens, measurement) {
      const v = host.viewport();
      send({
        type: "DC_PICKED", requestId: host.requestId, mode: "element",
        rectCss: rectCss, viewportW: v.w, viewportH: v.h,
        sourceUrl: host.sourceUrl(), tokens: tokens || null,
        measurement: measurement || null,
      });
    }

    async function begin(getEl) {
      if (state !== "idle") return; // blocks repeated/overlapping clicks
      state = "processing";
      const el = getEl();
      if (!el) { cancel(); return; }
      host.applyPause();
      let tokens = null, failure = null;
      try { tokens = await host.extract(el); }
      catch (e) { failure = (e && e.message) || "style extraction failed"; }
      if (cancelled || state === "settled") return; // cancelled during font/extraction
      host.hideOverlays();
      await host.nextPaint();
      if (cancelled || state === "settled") return; // cancelled during paint
      // Evidence, not intent: a failed extraction is reported as a FAILURE, never
      // as a deliberate image-only capture.
      const measurement = tokens && tokens.computed
        ? { status: "measured", method: "computed-style" }
        : { status: "failed", reason: failure || "no computed styles were returned" };
      await commitRect(host.rect(el), tokens, measurement);
    }

    // Deliberate image-only capture of a drawn area, in DOCUMENT coordinates, to
    // be composed by the panel from however many screenshots it takes.
    async function beginArea(rectDoc, pageMetrics) {
      if (state !== "idle") return;
      state = "processing";
      mode = "area";
      host.applyPause();
      host.hideOverlays();
      await host.nextPaint();
      if (cancelled || state === "settled") return;
      const m = pageMetrics || (host.metrics ? host.metrics() : {});
      send({
        type: "DC_PICKED", requestId: host.requestId, mode: "area",
        rectDoc: rectDoc, viewportW: m.vw, viewportH: m.vh,
        docW: m.docW, docH: m.docH, scrollX: m.scrollX, scrollY: m.scrollY, scrolls: m.scrolls,
        sourceUrl: host.sourceUrl(), tokens: null,
        measurement: { status: "image-only", method: "area-capture" },
      });
    }

    // Single-viewport region capture (kept for callers that only need what is on
    // screen; the picker now always uses beginArea).
    async function beginRegion(rect) {
      if (state !== "idle") return;
      state = "processing";
      host.applyPause();
      host.hideOverlays();
      await host.nextPaint();
      if (cancelled || state === "settled") return;
      await commitRect(rect, null, { status: "image-only", method: "region-capture" });
    }

    // Handshake reply: proves this document/frame is alive and reports its CURRENT
    // viewport so the panel can detect a resize before it screenshots.
    function confirm() { const v = host.viewport(); return { requestId: host.requestId, w: v.w, h: v.h }; }

    return {
      begin: begin, beginArea: beginArea, beginRegion: beginRegion,
      cancel: cancel, release: release, touch: touch, confirm: confirm,
      getState: function () { return state; },
      getMode: function () { return mode; },
      isCancelled: function () { return cancelled; },
      canStart: function () { return state === "idle"; },
    };
  }
  (typeof globalThis !== "undefined" ? globalThis : self).__dcCreatePickController = createPickController;
})();
