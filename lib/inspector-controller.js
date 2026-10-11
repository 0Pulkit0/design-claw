// Reference-inspector lifecycle: which reference the user asked to see, and whether
// that request is still valid by the time its crop read resolves.
//
// The bug this fixes: the old handler looked the item up, wrote the dialog title,
// cleared the body, then awaited the crop read. If the reference was REMOVED during
// that await (or another reference was opened), the handler resumed anyway and
// called showModal() — the inspector opened for a reference that no longer existed,
// and two overlapping opens could append their fields into the same body.
//
// Every open therefore carries a token. The token is invalidated by a later open, by
// close(), and by the dialog being dismissed. Before the single synchronous paint we
// re-check BOTH the token and that the reference still exists in the current tray;
// a reference removed mid-read closes the dialog instead of populating it. Because
// the body is committed in one synchronous paint from a snapshot, the contents of
// two opens can never interleave.
//
// Focus restoration captures the opener BEFORE the first await (afterwards the
// focused element may already have changed) and only for an open that is actually
// going to raise the dialog — a refresh of an already-open dialog keeps the original
// opener, so dismissing it returns focus where the user came from.
export function createInspectorController(deps) {
  // deps: getItem(id) -> item|undefined        (from the CURRENT authoritative tray)
  //       loadThumb(item) -> Promise<string|null>
  //       paint({ item, thumb, missing, thumbFailed }) -> void   (ONE sync commit)
  //       show() / close() / isOpen()
  //       activeElement() -> el|null ; restoreFocus(el)
  let seq = 0;
  let intent = null;   // { id, token } while a reference is on screen or being opened
  let opener = null;   // element focus returns to when the dialog is dismissed

  const invalidate = () => { seq += 1; };
  function dismiss() {
    invalidate();
    intent = null;
    if (deps.isOpen()) deps.close(); // the dialog's own close event calls closed()
  }

  async function open(id) {
    const token = ++seq;
    const existing = deps.getItem(id);
    if (!existing) { dismiss(); return { opened: false, reason: "not-found" }; }

    const wasOpen = deps.isOpen();
    if (!wasOpen) opener = typeof deps.activeElement === "function" ? deps.activeElement() : null;
    intent = { id, token };

    let thumb = null, thumbFailed = false;
    try { thumb = await deps.loadThumb(existing); }
    catch { thumbFailed = true; }

    if (token !== seq) return { opened: false, reason: "superseded" };   // newer open / closed meanwhile
    const item = deps.getItem(id);
    if (!item) { dismiss(); return { opened: false, reason: "removed" }; } // gone during the read

    try { deps.paint({ item, thumb, missing: !thumb, thumbFailed }); }
    catch (e) { return { opened: false, reason: "paint-failed", error: (e && e.message) || "could not render the inspector" }; }
    if (!deps.isOpen()) deps.show();
    return { opened: true, id, thumbFailed };
  }

  // Re-populate an open inspector after the tray changed (role/note/removal).
  function refresh() {
    if (!intent) return Promise.resolve({ opened: false, reason: "closed" });
    return open(intent.id);
  }

  // Called from the dialog's native close event: the user dismissed it, so any
  // pending open for it is void and focus goes back to the opener.
  function closed() {
    invalidate();
    intent = null;
    const o = opener; opener = null;
    if (o && typeof deps.restoreFocus === "function") deps.restoreFocus(o);
  }

  return { open, refresh, close: dismiss, closed, isOpen: () => !!intent, currentId: () => (intent ? intent.id : null) };
}
