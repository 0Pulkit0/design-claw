// Export orchestration, extracted so the actual handler logic — not just
// buildBundle — is testable. The bug it fixes: the panel checked freshness BEFORE
// awaiting buildBundle (which reads crops asynchronously) but never re-checked
// before triggering the download, so an edit or recompile during bundling still
// produced a download of a stale result.
//
// Policy: the export binds to the output revision at begin(). If anything changes
// that revision while bundling — a recompile, an input edit (stale), OR an advisory
// enhancement — the finished bundle is NOT downloaded; the export aborts visibly and
// the button is restored. buildBundle runs against the bound snapshot (token.compiled)
// so the bytes are internally consistent regardless.
export async function exportBundle({ out, buildBundle, getBytes, download, toast, setBusy }) {
  if (!out.fresh()) { toast(out.current() ? "Recompile — inputs changed since the last compile" : "Compile first"); return { ok: false, reason: "not-fresh" }; }
  const token = out.begin();
  setBusy(true);
  try {
    const { filename, bytes } = await buildBundle(token.compiled, getBytes);
    if (!out.stillCurrent(token)) { toast("Export aborted — inputs changed since it started. Recompile, then export."); return { ok: false, reason: "stale" }; }
    download(filename, bytes);
    toast(`Exported ${filename}`);
    return { ok: true, filename };
  } catch (e) {
    toast(e.message);
    return { ok: false, reason: "error", error: e };
  } finally {
    setBusy(false);
  }
}
