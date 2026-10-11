// The compile decision, extracted so the rule "never compile across an unsettled
// tray edit" is production code the tests can drive, not a condition buried in a
// DOM click handler.
//
// A tray edit (role / note / order / removal) marks the output stale synchronously
// and then awaits a storage write. Compiling inside that window read the pre-edit
// tray and then cleared staleness — presenting output built from superseded input
// as fresh. The gate refuses while any local edit is unsettled; the panel also
// disables the button, and output-state's epoch stamp rejects the result if a
// compile ever slips through. Three layers, because the failure is silent.
export function createCompileGate(deps) {
  // deps: pending (lib/pending-edits), out (lib/output-state), compile(items, brief, opts),
  //       getItems() -> items, getInputs() -> {brief, persona, perRunNote},
  //       onCompiled(compiled), onRefuse(message)
  const refuse = (message) => { if (typeof deps.onRefuse === "function") deps.onRefuse(message); return { ok: false, reason: message }; };

  function canCompile() { return deps.pending.idle(); }

  function run() {
    if (!deps.pending.idle()) {
      return refuse(deps.pending.count() === 1
        ? "Saving your last edit — compile again in a moment"
        : "Saving your last edits — compile again in a moment");
    }
    const inputs = deps.getInputs();
    let compiled;
    try { compiled = deps.compile(deps.getItems(), inputs.brief, { persona: inputs.persona, perRunNote: inputs.perRunNote, guidance: inputs.guidance }); }
    catch (e) { return refuse((e && e.message) || "Could not compile"); }
    deps.out.setCompiled(compiled);
    if (typeof deps.onCompiled === "function") deps.onCompiled(compiled);
    return { ok: true, compiled };
  }

  return { run, canCompile };
}
