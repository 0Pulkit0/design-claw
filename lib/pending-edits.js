// Tracks tray mutations this panel has STARTED but that have not settled yet, so
// compilation can never read a tray that is about to change under it.
//
// Why this exists: a tray edit handler marks the output stale synchronously and
// then AWAITS the storage write. During that await the in-memory tray still holds
// the pre-edit value, so a compile started in that window produced output from the
// old state and — because setCompiled() clears staleness — labelled it fresh.
//
// Two guarantees:
//  1. `count()` > 0 means "an edit of mine is unsettled" — the compile gate refuses
//     and the panel disables the button (see lib/compile-gate.js).
//  2. `epoch()` bumps on BOTH begin and settle, so an output stamped with the epoch
//     seen during an unsettled edit can never match the epoch after it settles.
//     Freshness therefore rejects any output that predates an unresolved change,
//     even if the compile slipped through the gate.
export function createPendingEdits(deps = {}) {
  let count = 0;
  let epoch = 0;
  let waiters = [];
  const changed = () => { if (typeof deps.onChange === "function") deps.onChange({ pending: count, epoch }); };

  // Returns an idempotent settle function. Callers must settle on BOTH success and
  // failure — a failed save still resolves the uncertainty (the stored state stands).
  function begin() {
    count += 1; epoch += 1; changed();
    let settled = false;
    return () => {
      if (settled) return;
      settled = true;
      count -= 1; epoch += 1; changed();
      if (count === 0) { const w = waiters; waiters = []; for (const resolve of w) resolve(); }
    };
  }

  // Run a mutation inside the pending window. Rejections propagate to the caller
  // after settling, so a handler's own error handling still runs.
  async function run(fn) {
    const done = begin();
    try { return await fn(); }
    finally { done(); }
  }

  return {
    begin, run,
    count: () => count,
    epoch: () => epoch,
    idle: () => count === 0,
    whenSettled: () => (count === 0 ? Promise.resolve() : new Promise((resolve) => waiters.push(resolve))),
  };
}
