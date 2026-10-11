// Output / staleness / revision state for the panel, extracted so the compile,
// enhance, copy, download, and export handlers share ONE source of truth that is
// testable without a DOM.
//
// `seq` is a monotonic revision that bumps on every change to the compiled output
// — a fresh compile AND an advisory enhancement. `stale` flips the moment a
// compilation input changes (brief / per-run note / persona / reset / any tray
// mutation) and is cleared only by a fresh compile. Long async handoffs (export)
// bind to a revision via begin()/stillCurrent() so a result produced against an
// older revision is never silently downloaded.
//
// An optional `deps.epoch()` + `deps.settled()` (lib/pending-edits) close the one
// gap a boolean `stale` cannot: a compile that ran WHILE a tray edit was still
// unsettled cleared staleness and so looked fresh, even though its input was
// already superseded. Output is therefore NOT fresh while any edit is unsettled,
// and the epoch seen at compile time is stamped on the result — the epoch moves on
// both the start and the settlement of every edit, so such an output can never
// match the current epoch again. Freshness rejects it without needing to know what
// changed, and every consumer (copy / download / enhance / export) inherits the
// guard for free.
export function createOutputState(deps = {}) {
  let compiled = null;
  let seq = 0;
  let stale = false;
  let compiledEpoch = 0;

  const epochNow = () => (typeof deps.epoch === "function" ? deps.epoch() : 0);
  const settledNow = () => (typeof deps.settled === "function" ? !!deps.settled() : true);
  const isStale = () => !!compiled && (stale || !settledNow() || compiledEpoch !== epochNow());

  return {
    setCompiled(c) { compiled = c; seq += 1; stale = false; compiledEpoch = epochNow(); return seq; }, // a fresh compile
    applyEnhancement(c) { compiled = c; seq += 1; },                        // advisory re-render: same compile, new revision
    markStale() { if (compiled) stale = true; },                           // an input changed
    current() { return compiled; },
    seq() { return seq; },
    isStale,
    fresh() { return !!compiled && !isStale(); },
    begin() { return { seq, compiled }; },                                 // bind a long async op to this revision
    stillCurrent(token) { return !!token && token.seq === seq && !isStale(); },
  };
}
