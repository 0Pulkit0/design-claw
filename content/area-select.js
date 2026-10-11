// Area-selection state machine with edge-hold scrolling. A CLASSIC script (like
// content/pick-controller.js) so it can be injected as a content-script file and
// still be loaded verbatim by the test runner — the tests drive this exact code.
//
// Behaviour:
//   * The drag anchor and the live corner are kept in DOCUMENT coordinates, so
//     scrolling mid-drag EXTENDS the selection instead of dragging it along.
//   * Holding the pointer within `edgeZone` of the bottom edge for `holdMs`
//     (2s) starts scrolling down; the same at the top scrolls up. A countdown is
//     reported every tick so the overlay can show it.
//   * Leaving the edge zone stops scrolling AND resets the countdown, so a
//     pointer that dips into the zone briefly does nothing.
//   * Wheel/trackpad scrolling is handled by the same recompute path: the anchor
//     is a document point, so it never moves.
//   * Escape cancels at every stage; releasing the pointer completes.
(function () {
  function createAreaSelector(host) {
    const EDGE = host.edgeZone == null ? 56 : host.edgeZone;
    const HOLD = host.holdMs == null ? 2000 : host.holdMs;
    const STEP = host.stepPerTick == null ? 18 : host.stepPerTick;
    const MIN = host.minSize == null ? 5 : host.minSize;

    let dragging = false, settled = false;
    let anchor = null;              // {x,y} document coords
    let pointer = { x: 0, y: 0 };   // last client coords
    let holdDir = 0, holdStart = 0, scrolling = false, atEnd = false;
    let countdown = null;           // seconds remaining, or 0 while scrolling

    const scroll = () => host.getScroll();
    const docPoint = () => { const s = scroll(); return { x: pointer.x + s.x, y: pointer.y + s.y }; };

    function rectDoc() {
      if (!anchor) return null;
      const p = docPoint();
      return { x: Math.min(anchor.x, p.x), y: Math.min(anchor.y, p.y), w: Math.abs(p.x - anchor.x), h: Math.abs(p.y - anchor.y) };
    }
    function paint() {
      if (!dragging) return;
      host.draw({ rectDoc: rectDoc(), scroll: scroll(), countdown, scrolling, atEnd });
    }
    function resetHold() { holdDir = 0; holdStart = 0; scrolling = false; atEnd = false; countdown = null; }

    function edgeDir(clientY) {
      const vh = host.getViewport().h;
      if (clientY >= vh - EDGE) return 1;
      if (clientY <= EDGE) return -1;
      return 0;
    }

    function down(clientX, clientY) {
      if (settled || dragging) return false;
      pointer = { x: clientX, y: clientY };
      anchor = docPoint();
      dragging = true;
      resetHold();
      paint();
      return true;
    }

    function move(clientX, clientY) {
      if (!dragging || settled) return;
      pointer = { x: clientX, y: clientY };
      const dir = edgeDir(clientY);
      if (dir !== holdDir) {           // entered a different zone, or left the zone
        resetHold();
        if (dir) { holdDir = dir; holdStart = host.now(); countdown = Math.ceil(HOLD / 1000); }
      }
      paint();
    }

    // Called from requestAnimationFrame (or a timer in tests).
    function tick() {
      if (!dragging || settled || !holdDir) return;
      if (!scrolling) {
        const left = HOLD - (host.now() - holdStart);
        countdown = Math.max(0, Math.ceil(left / 1000));
        if (left > 0) { paint(); return; }
        scrolling = true; countdown = 0;
      }
      const before = scroll().y;
      host.scrollBy(holdDir * STEP);
      const after = scroll().y;
      atEnd = after === before;        // hit the top or the bottom of the document
      paint();                         // the doc point under a still pointer moved
    }

    // Wheel / trackpad / programmatic scroll during the drag.
    function onScroll() { if (dragging && !settled) paint(); }

    function up() {
      if (!dragging || settled) return null;
      const r = rectDoc();
      dragging = false;
      resetHold();
      if (!r || r.w < MIN || r.h < MIN) { host.clear(); anchor = null; return null; } // a click, not a drag
      settled = true;
      host.onComplete(r);
      return r;
    }

    function cancel(reason) {
      if (settled) return;
      settled = true; dragging = false; resetHold(); anchor = null;
      host.clear();
      host.onCancel(reason || "cancelled");
    }

    return {
      down, move, up, tick, onScroll, cancel,
      isDragging: () => dragging,
      state: () => ({ dragging, settled, scrolling, countdown, holdDir, atEnd, anchor: anchor && { ...anchor }, rect: rectDoc() }),
    };
  }
  (typeof globalThis !== "undefined" ? globalThis : self).__dcCreateAreaSelector = createAreaSelector;
})();
