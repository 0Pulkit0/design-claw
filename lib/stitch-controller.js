// Panel-side orchestration for extended (scroll-and-stitch) area capture.
//
// Sequence, with the page under our control the whole way:
//   prepare -> [scroll -> validate -> capture -> place] xN -> coverage check ->
//   validate -> compose -> persist -> finish
//
// Invariants this module is responsible for:
//   * NOTHING is persisted unless every tile landed and the painted bands cover
//     the whole selection — a partial stitch is reported, never saved.
//   * The originating document, tab, and viewport are re-validated before every
//     tile and once more after the last one, so a navigation, tab switch, resize,
//     or zoom change during the (slow, multi-second) capture aborts instead of
//     producing a sheared image.
//   * Tiles are composed from the scroll offset the page REPORTS, not the one we
//     asked for, so a clamped or short scroll cannot shift the output.
//   * `finish` runs on success, cancellation, and failure, so the page's scroll
//     position, styles, and listeners are always restored.
//   * Cancellation is honoured at every await boundary before the commit point.
import { planStitch, planOutput, placeTile, coverageGaps, clampSelection, DEFAULT_LIMITS } from "./stitch.js";

export function createStitchController(deps) {
  // deps: prepare(session,msg), scrollTo(session,msg,y), validate(session,msg,when),
  //       capture(session), makeCanvas(w,h), persist({session,msg,crop,cancelled}),
  //       finish(session,msg), progress(state), report(res), limits?
  const L = { ...DEFAULT_LIMITS, ...(deps.limits || {}) };
  const flights = new Map(); // requestId -> { cancelled, committed }

  function cancel(requestId) { const f = flights.get(requestId); if (f && !f.committed) f.cancelled = true; }
  function cancelAll() { for (const f of flights.values()) if (!f.committed) f.cancelled = true; }

  async function run(session, msg) {
    if (flights.has(msg.requestId)) return; // dedupe duplicate deliveries
    const flight = { cancelled: false, committed: false };
    flights.set(msg.requestId, flight);
    const dead = () => flight.cancelled;
    const stop = (reason) => { deps.report({ ok: false, reason }); return null; };
    try {
      let bad = await deps.validate(session, msg, "before capture");
      if (dead()) return stop("cancelled");
      if (bad) return stop(bad);

      deps.progress({ phase: "preparing" });
      const prep = await deps.prepare(session, msg);
      if (dead()) return stop("cancelled");
      if (!prep || !prep.ok) return stop((prep && prep.reason) || "The page could not be prepared for capture.");
      if (prep.unsupported) return stop(prep.reason || "This page can't be captured as one image.");

      const rect = clampSelection(msg.rectDoc, { docW: prep.docW, docH: prep.docH, vw: prep.vw, scrollX: prep.scrollX });
      if (!rect) return stop("That selection was too small or outside the page.");

      const plan = planStitch({ rect, vw: prep.vw, vh: prep.vh, docH: prep.docH, limits: L });
      if (!plan.ok) return stop(plan.reason);
      if (plan.shortBy) return stop("The page is shorter than the selected area — scroll down and select again.");

      const total = plan.tiles.length;
      let canvas = null, out = null, scale0 = null;
      const bands = [];

      for (let i = 0; i < total; i++) {
        if (dead()) return stop("cancelled");
        deps.progress({ phase: "tile", tile: i + 1, total });

        const s = await deps.scrollTo(session, msg, plan.tiles[i].scrollY);
        if (dead()) return stop("cancelled");
        if (!s || !s.ok) return stop((s && s.reason) || "The page stopped responding during capture.");
        if (s.vw !== prep.vw || s.vh !== prep.vh) return stop("The window was resized during capture — select the area again.");
        if (Math.abs(s.docH - prep.docH) > L.docGrowthTolerance) {
          return stop("The page grew while capturing (infinite scroll or lazy content). Capture a shorter area, or scroll the whole area into place first.");
        }
        const atBottom = s.scrollY >= s.maxScroll - L.scrollTolerance;
        if (Math.abs(s.scrollY - plan.tiles[i].scrollY) > L.scrollTolerance && !atBottom) {
          return stop("The page did not scroll where asked — it may use smooth or hijacked scrolling, which can't be stitched reliably.");
        }

        bad = await deps.validate(session, msg, "during capture");
        if (dead()) return stop("cancelled");
        if (bad) return stop(bad);

        // The screenshot is placed by the offset the page just reported, so the
        // page must not move between here and the actual shot — including the time
        // spent queued for the shared capture lock. deps.capture re-checks scroll
        // (both axes) around the real screenshot and throws on incompatible drift.
        const expected = { scrollX: s.scrollX || 0, scrollY: s.scrollY, vw: prep.vw, vh: prep.vh, docH: prep.docH };
        const image = await deps.capture(session, msg, expected);
        if (dead()) return stop("cancelled");
        if (!image || !image.naturalWidth) return stop("A screenshot came back empty.");

        const scaleX = image.naturalWidth / prep.vw;
        if (scale0 == null) {
          scale0 = scaleX;
          out = planOutput({ rect, scaleX, scaleY: image.naturalHeight / prep.vh, limits: L });
          if (!out.ok) return stop(out.reason);
          canvas = deps.makeCanvas(out.w, out.h);
        } else if (Math.abs(scaleX - scale0) > 0.01) {
          return stop("The page zoom changed during capture — select the area again.");
        }

        const p = placeTile({ rect, scrollX: s.scrollX || 0, scrollY: s.scrollY, vw: prep.vw, vh: prep.vh, imageW: image.naturalWidth, imageH: image.naturalHeight });
        if (p) { canvas.drawImage(image, p); bands.push(p); }
      }

      if (!canvas || !bands.length) return stop("Nothing of the selected area could be captured.");
      const gaps = coverageGaps(bands, out.w, out.h);
      if (gaps.length) {
        const horizontal = gaps.some((g) => g.axis === "x");
        return stop(horizontal
          ? "Part of the width was off-screen and never captured (the selection extends beyond one screen sideways). Nothing was saved."
          : "Part of the area was never captured, so the image would have gaps. Nothing was saved.");
      }

      bad = await deps.validate(session, msg, "after capture");
      if (dead()) return stop("cancelled");
      if (bad) return stop(bad);

      deps.progress({ phase: "composing" });
      const blob = await canvas.toBlob();
      if (dead()) return stop("cancelled");
      if (!blob) return stop("The stitched image could not be encoded.");

      deps.progress({ phase: "saving" });
      const res = await deps.persist({
        session, msg,
        crop: { blob, w: out.w, h: out.h, clipped: !!rect.clippedX, tiles: total },
        cancelled: () => flight.cancelled,
      });
      if (res && res.committed) {
        flight.committed = true;
        deps.report({ ok: true, w: out.w, h: out.h, tiles: total, clipped: !!rect.clippedX, notifyError: res.notifyError });
      } else {
        deps.report({ ok: false, reason: (res && res.reason) || "capture failed" });
      }
    } catch (e) {
      deps.report({ ok: false, reason: (e && e.message) || "capture failed" });
    } finally {
      deps.progress({ phase: "done" });
      try { await deps.finish(session, msg); } catch {}
      flights.delete(msg.requestId);
    }
  }

  return { run, cancel, cancelAll, inFlight: (id) => flights.has(id) };
}
