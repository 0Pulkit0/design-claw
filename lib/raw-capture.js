// One raw screenshot, with the right failure semantics for the shared pacer.
//
// Chrome's captureVisibleTab can fail two very different ways, and the old inline
// wrapper conflated them: on ANY error it immediately fired a second screenshot
// through the background broker and then replaced the message with "click the
// toolbar icon". That (a) doubled the quota pressure on a rate-limit error and
// (b) hid the quota error from the pacer, which could then neither pace nor retry.
//
// Here a quota / rate-limit error is PRESERVED and rethrown so the pacer paces and
// retries it, with NO duplicate fallback attempt. The background broker is used
// only for a genuine access failure (activeTab not granted on this tab), and the
// toolbar-grant message is shown only then; if the broker itself reports a quota
// error, that is rethrown too so the pacer handles it.
//
// Pure and injectable (captureVisibleTab / sendMessage / toImage) so it is tested
// against the real control flow without a browser.
import { isRateLimitError } from "./capture-pacer.js";
const isAccessError = (e) => /activeTab|<all_urls>|permission|cannot access|access.*(?:denied|not allowed)/i.test(String(e?.message || e || ""));

export function createRawCapture(deps) {
  // deps: captureVisibleTab(windowId) -> Promise<dataUrl>,
  //       sendMessage(windowId) -> Promise<{ok,dataUrl?,error?}>  (background broker),
  //       toImage(dataUrl) -> Promise<image>
  return async function rawCapture(windowId) {
    let dataUrl;
    try {
      dataUrl = await deps.captureVisibleTab(windowId);
    } catch (e) {
      if (isRateLimitError(e)) throw e; // quota: let the pacer pace + retry, no duplicate shot
      if (!isAccessError(e)) throw e;
      const r = await deps.sendMessage(windowId); // likely an access failure: broker once
      if (r && r.ok) dataUrl = r.dataUrl;
      else {
        if (r?.error && (isRateLimitError(r.error) || !isAccessError(r.error))) throw new Error(r.error);
        throw new Error("Capture failed — click the toolbar icon on this tab to grant access.");
      }
    }
    // Decode errors aren't permission errors and must never trigger a second shot.
    return deps.toImage(dataUrl);
  };
}
