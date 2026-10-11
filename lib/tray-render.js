// Render sequencing for the reference tray.
//
// The bug this fixes: the old renderer cleared the list, then awaited each item's
// crop read and appended as it went. A newer render could complete during one of
// those awaits, and the older render would then resume and append ITS items on top
// of the newer ones — the DOM ended up holding both trays while the in-memory
// state held only the newer one.
//
// The fix is structural, not a patch: every render takes a generation number, all
// awaited crop reads happen BEFORE anything touches the DOM, and the generation is
// re-checked immediately before the single synchronous `paint`. A superseded render
// therefore cannot modify the DOM at all — not partially, not out of order.
//
// Trade-off accepted deliberately: the list paints once, after all thumbnails for
// that render resolve, instead of item-by-item. Atomicity is worth more than
// incremental paint for a list this size, and it is the only way a superseded
// render can be made inert.
//
// A crop read that REJECTS (IndexedDB failure) is caught per item and reported as a
// missing crop plus a visible issue — it never rejects the render and so never
// escapes as an unhandled rejection into the store's notification path.
export function createTrayRenderer(deps) {
  // deps: loadThumb(item) -> Promise<string|null>   (object URL, or null if absent)
  //       paint({ tray, thumbs, missing, failures }) -> void   (ONE sync DOM commit)
  //       onIssue(message) -> void                  (optional, visible failure report)
  let generation = 0;
  let latest = [];

  async function render(tray) {
    const gen = ++generation;
    const items = Array.isArray(tray) ? tray : [];
    latest = items; // the latest INTENDED state, set synchronously
    const thumbs = new Map();
    const missing = new Set();
    const failures = [];

    for (const it of items) {
      let src = null;
      try { src = await deps.loadThumb(it); }
      catch (e) { failures.push({ id: it.id, message: (e && e.message) || "crop could not be read" }); }
      if (gen !== generation) return { applied: false, superseded: true, generation: gen };
      if (src) thumbs.set(it.id, src); else missing.add(it.id);
    }
    if (gen !== generation) return { applied: false, superseded: true, generation: gen };

    try { deps.paint({ tray: items, thumbs, missing, failures }); }
    catch (e) { return { applied: false, superseded: false, generation: gen, error: (e && e.message) || "render failed" }; }

    if (failures.length && typeof deps.onIssue === "function") {
      deps.onIssue(failures.length === 1
        ? `A reference image could not be read — ${failures[0].message}`
        : `${failures.length} reference images could not be read`);
    }
    return { applied: true, superseded: false, generation: gen, failures };
  }

  return { render, state: () => latest, generation: () => generation };
}
