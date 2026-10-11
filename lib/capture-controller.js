// Production orchestration for the PANEL side of a capture, extracted so the
// async pipeline (handshake -> screenshot -> crop -> re-handshake -> commit) and its
// cancellation are testable with controlled promises + mocked Chrome/db. The panel
// wires real deps; tests wire mocks.
//
// The COMMIT POINT is deps.persist — nothing is added to the tray before it, and
// cancellation is re-checked at every boundary up to it. Because screenshot + crop
// are awaited, we re-validate the document/tab/viewport AFTER them (a pre-capture
// handshake alone does not prove the page held still across the awaited screenshot).
// The picker's release-timeout also routes a cancel here, so an expired request can
// no longer commit. deps.persist owns the committing/committed boundary and reports
// back whether it committed; a cancel after that is inert (the flight is gone).

// Validate that the originating document/tab is still alive and its viewport
// unchanged. confirm() throws (tab switched / navigated), returns null (document
// gone / picker released), or reports a different viewport — any of which aborts.
// Shared with the stitch controller so both captures apply the SAME rule.
export function makeValidator(confirm) {
  return async function validate(session, msg, when) {
    const resp = await confirm(session, msg);
    if (!resp || resp.requestId !== msg.requestId) return `the picked document was replaced or reloaded ${when}`;
    if (resp.w !== msg.viewportW || resp.h !== msg.viewportH) return `the viewport changed ${when} — re-pick`;
    return null;
  };
}

export function createCaptureController(deps) {
  const flights = new Map(); // requestId -> { cancelled, committed }

  function cancel(requestId) { const f = flights.get(requestId); if (f && !f.committed) f.cancelled = true; }
  function cancelAllExcept(keepId) { for (const [id, f] of flights) if (id !== keepId && !f.committed) f.cancelled = true; }

  const validate = makeValidator(deps.confirm);

  async function run(session, msg) {
    if (flights.has(msg.requestId)) return; // dedupe duplicate deliveries
    const flight = { cancelled: false, committed: false };
    flights.set(msg.requestId, flight);
    const stop = (reason) => { deps.report({ ok: false, reason }); };
    const dead = () => flight.cancelled;
    try {
      // Before the shot: tab-active + document-alive + viewport.
      let bad = await validate(session, msg, "before capture");
      if (dead()) return stop("cancelled");
      if (bad) return stop(bad);

      const image = await deps.capture(session);
      if (dead()) return stop("cancelled");
      const plan = deps.plan(msg.rectCss, msg.viewportW, msg.viewportH, image);
      if (!plan) return stop("selection was off-screen or invalid");
      const crop = await deps.draw(image, plan);
      if (dead()) return stop("cancelled");

      // After the shot: the awaited capture/draw gave the page time to reload,
      // navigate, switch tab, resize, or let the picker expire. Re-validate before
      // committing anything.
      bad = await validate(session, msg, "during capture");
      if (dead()) return stop("cancelled");
      if (bad) return stop(bad);

      // ---- COMMIT POINT ---- persist owns the committing/committed boundary and
      // rolls back a partial write; it returns { committed } so a mid-persist cancel
      // (newer pick / expiry) can roll back the crop before metadata lands.
      const res = await deps.persist({ session, msg, crop, cancelled: () => flight.cancelled });
      if (res && res.committed) {
        flight.committed = true;
        // notifyError (if any) means the add COMMITTED but the view could not be
        // redrawn — reported alongside success, never as a failure.
        deps.report({ ok: true, w: res.w, h: res.h, clipped: res.clipped, notifyError: res.notifyError });
      } else {
        deps.report({ ok: false, reason: (res && res.reason) || "capture failed" });
      }
    } catch (e) {
      deps.report({ ok: false, reason: (e && e.message) || "capture failed" });
    } finally {
      try { deps.release(session, msg); } catch {}
      flights.delete(msg.requestId);
    }
  }

  return { run, cancel, cancelAllExcept, inFlight: (id) => flights.has(id) };
}
