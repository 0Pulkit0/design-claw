// Scroll-and-stitch geometry — pure, no DOM, no chrome.*.
//
// The problem: chrome.tabs.captureVisibleTab only ever returns the VISIBLE
// viewport. To save one image of a selection taller than the viewport we scroll
// the page, capture a tile at each stop, and compose them into a single canvas.
//
// Two rules make that trustworthy:
//
// 1. SELECTION LIVES IN DOCUMENT COORDINATES. The user's drag is recorded as
//    {x,y,w,h} relative to the document origin, never the viewport, so scrolling
//    during the drag extends the selection instead of moving it.
//
// 2. EVERY TILE IS PLACED BY ITS *ACHIEVED* SCROLL OFFSET. We ask the page to
//    scroll to a planned offset, but we compose using the offset the page
//    actually reports. A short scroll, a clamped scroll at the document end, or
//    an overlapping tile therefore lands in the right place instead of shifting
//    the whole image. Destination edges are rounded from document coordinates,
//    so consecutive tiles share an exact edge: no duplicated rows, no seams,
//    and an overlapping tile simply overwrites the same output rows.
export const DEFAULT_LIMITS = {
  maxTiles: 20,          // bounded work: ~20 captures at >=550ms pacing
  maxPixels: 24e6,       // ~96MB RGBA backing store
  maxDim: 16384,         // conservative single-dimension canvas cap
  maxSelectionCss: 20000,// a selection taller than this is almost certainly a mis-drag
  overlapCss: 24,        // small overlap absorbs sub-pixel scroll settling
  docGrowthTolerance: 64,// document height drift we treat as benign (lazy images)
  scrollTolerance: 4,    // CSS px: how far the achieved scroll may miss the request
};

const fin = (n) => Number.isFinite(n);

// Clamp the drawn selection to what we can actually capture. Vertically we scroll,
// so the whole document height is reachable. HORIZONTALLY we never scroll sideways,
// so only the strip [scrollX, scrollX+vw] (intersected with the document) is
// reachable — a selection that extends past it (the user wheel-scrolled sideways
// mid-drag) is clipped to the reachable strip and flagged, rather than painting
// blank columns and calling the capture complete.
export function clampSelection(rect, { docW, docH, vw, scrollX = 0 }) {
  if (!rect || ![rect.x, rect.y, rect.w, rect.h].every(fin)) return null;
  if (rect.w < 2 || rect.h < 2) return null;
  const sx = fin(scrollX) ? scrollX : 0;
  const docRight = fin(docW) && docW > 0 ? docW : rect.x + rect.w;
  const visRight = fin(vw) && vw > 0 ? sx + vw : rect.x + rect.w;
  const x1 = Math.max(0, sx, rect.x);
  const x2 = Math.min(rect.x + rect.w, docRight, visRight);
  const y1 = Math.max(0, rect.y);
  const y2 = Math.min(fin(docH) && docH > 0 ? docH : rect.y + rect.h, rect.y + rect.h);
  const w = x2 - x1, h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  const clippedX = x1 > rect.x + 0.5 || x2 < rect.x + rect.w - 0.5;
  return { x: x1, y: y1, w, h, clippedX, clipped: clippedX };
}

// Plan the scroll stops needed to cover the selection. Returns the stops in
// document CSS pixels plus the reason if a bound was hit.
export function planStitch({ rect, vw, vh, docH, limits = {} }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  if (!rect || !fin(vh) || vh <= 0 || !fin(vw) || vw <= 0) return { ok: false, reason: "The page did not report a usable viewport." };
  if (rect.h > L.maxSelectionCss) return { ok: false, reason: `That selection is ${Math.round(rect.h)}px tall — longer than the ${L.maxSelectionCss}px limit for one capture. Select a smaller area.` };
  const pageH = fin(docH) && docH > 0 ? docH : vh;
  const maxScroll = Math.max(0, pageH - vh);
  const step = Math.max(1, vh - Math.max(0, L.overlapCss));
  const bottom = rect.y + rect.h;
  const stops = [];
  let y = Math.min(Math.max(0, rect.y), maxScroll);
  for (;;) {
    stops.push(Math.round(y));
    if (y + vh >= bottom - 0.5) break;        // the selection's bottom is in view
    if (y >= maxScroll - 0.5) break;          // the page cannot scroll further
    if (stops.length >= L.maxTiles) {
      return { ok: false, reason: `That area needs more than ${L.maxTiles} screenshots. Select a shorter area.`, limited: "maxTiles" };
    }
    y = Math.min(y + step, maxScroll);
  }
  // Does the reachable scroll range actually cover the selection?
  const lastStop = stops[stops.length - 1];
  const reachable = lastStop + vh;
  const shortBy = bottom - reachable;
  return {
    ok: true,
    stops,
    tiles: stops.map((scrollY) => ({ scrollY })),
    shortBy: shortBy > 0.5 ? shortBy : 0,
    step,
  };
}

// Output size in captured-image pixels, once a real tile has told us the scale.
export function planOutput({ rect, scaleX, scaleY, limits = {} }) {
  const L = { ...DEFAULT_LIMITS, ...limits };
  if (![scaleX, scaleY].every(fin) || scaleX <= 0 || scaleY <= 0) return { ok: false, reason: "The captured image scale could not be determined." };
  const w = Math.max(1, Math.round(rect.w * scaleX));
  const h = Math.max(1, Math.round(rect.h * scaleY));
  if (w > L.maxDim || h > L.maxDim) return { ok: false, reason: `The stitched image would be ${w}×${h}px — past the ${L.maxDim}px limit for one image. Select a smaller area.`, limited: "maxDim" };
  if (w * h > L.maxPixels) return { ok: false, reason: `The stitched image would be ${(w * h / 1e6).toFixed(1)} megapixels — past the ${(L.maxPixels / 1e6).toFixed(0)}MP limit. Select a smaller area.`, limited: "maxPixels" };
  return { ok: true, w, h };
}

// Map one captured viewport onto the output canvas using the scroll offset the
// page ACTUALLY reported. Returns null when none of the selection was visible.
export function placeTile({ rect, scrollX = 0, scrollY, vw, vh, imageW, imageH }) {
  if (!rect || ![scrollX, scrollY, vw, vh, imageW, imageH].every(fin)) return null;
  if (vw <= 0 || vh <= 0 || imageW <= 0 || imageH <= 0) return null;
  const scaleX = imageW / vw, scaleY = imageH / vh;
  const ix1 = Math.max(rect.x, scrollX), iy1 = Math.max(rect.y, scrollY);
  const ix2 = Math.min(rect.x + rect.w, scrollX + vw), iy2 = Math.min(rect.y + rect.h, scrollY + vh);
  if (ix2 - ix1 <= 0.5 || iy2 - iy1 <= 0.5) return null;
  // source: where this band sits inside the captured viewport image
  const sx = Math.round((ix1 - scrollX) * scaleX), sxEnd = Math.round((ix2 - scrollX) * scaleX);
  const sy = Math.round((iy1 - scrollY) * scaleY), syEnd = Math.round((iy2 - scrollY) * scaleY);
  // destination: rounded from DOCUMENT coordinates, so tiles share exact edges
  const dx = Math.round((ix1 - rect.x) * scaleX), dxEnd = Math.round((ix2 - rect.x) * scaleX);
  const dy = Math.round((iy1 - rect.y) * scaleY), dyEnd = Math.round((iy2 - rect.y) * scaleY);
  const clamp = (v, hi) => Math.max(0, Math.min(v, hi));
  const sX = clamp(sx, imageW - 1), sY = clamp(sy, imageH - 1);
  const sW = Math.max(1, Math.min(sxEnd - sx, imageW - sX));
  const sH = Math.max(1, Math.min(syEnd - sy, imageH - sY));
  return {
    sx: sX, sy: sY, sw: sW, sh: sH,
    dx, dy, dw: Math.max(1, dxEnd - dx), dh: Math.max(1, dyEnd - dy),
    scaleX, scaleY,
  };
}

// Prove the painted bands cover the whole output in BOTH dimensions before we
// persist. Tiling is vertical-only, so each band must span the full output width
// (a band narrower than the output means off-screen columns were never captured)
// and together the bands must cover the full output height. Returns the missing
// regions in output pixels; a non-empty result means "do not save".
export function coverageGaps(bands, outW, outH) {
  const valid = bands.filter((b) => b && b.dh > 0 && b.dw > 0);
  const gaps = [];
  // horizontal: any band that does not span [0, outW] leaves blank columns
  if (fin(outW) && outW > 0) {
    for (const b of valid) {
      if (b.dx > 1 || b.dx + b.dw < outW - 1) { gaps.push({ axis: "x", from: b.dx, to: b.dx + b.dw }); break; }
    }
  }
  // vertical: union of the bands must reach outH with no interior gap
  const sorted = valid.map((b) => [b.dy, b.dy + b.dh]).sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [top, bot] of sorted) {
    if (top > cursor + 1) gaps.push({ axis: "y", from: cursor, to: Math.min(top, outH) }); // >1px: ignore rounding hairlines
    cursor = Math.max(cursor, bot);
    if (cursor >= outH) break;
  }
  if (cursor < outH - 1) gaps.push({ axis: "y", from: cursor, to: outH });
  return gaps;
}
