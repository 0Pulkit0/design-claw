// Shared mutual-exclusion for tray mutations across EVERY producer.
//
// In the extension this is backed by the browser's Web Locks API. A Web Lock is
// owned by the browser, not by any one page, and is held across all same-origin
// contexts — every side-panel window plus the service worker share the extension
// origin, so `navigator.locks.request("design-compositor-tray", …)` grants the lock
// to exactly one context at a time. Holding it across the WHOLE read→compute→write
// means two panels can never both read the tray, compute, and write — the lost
// update the per-panel serializer could not prevent.
//
// Why Web Locks and not a service-worker queue: chrome.runtime messaging serializes
// with a JSON-ish algorithm, so a crop Blob cannot be shipped to an SW writer; an
// MV3 SW is also killed when idle, which complicates a durable in-SW queue. Web
// Locks is browser-managed, purpose-built for cross-context mutual exclusion, needs
// no messaging, and adds no dependency or storage migration. Crop blobs are written
// under per-op unique keys (no cross-panel collision), so only the shared metadata
// array needs the lock.
//
// Fallback policy: production must NOT silently drop to a per-context mutex when the
// Web Locks API is missing — that would let two windows overwrite each other. Instead
// createTrayMutex returns an UNSUPPORTED mutex whose withLock rejects with an
// actionable error, so every mutation fails safely (and the panel disables capture +
// shows the message). The in-memory mutex stays exported for EXPLICIT test injection
// and for the preview fixtures — never as createTrayMutex's automatic fallback.

export function webLocksMutex(name) {
  return {
    kind: "web-locks",
    withLock: (fn) => navigator.locks.request(name, { mode: "exclusive" }, fn),
  };
}

export function inMemoryMutex() {
  let tail = Promise.resolve();
  return {
    kind: "in-memory",
    withLock(fn) {
      const result = tail.then(() => fn()); // wait for the current holder, then run fn
      tail = result.then(() => {}, () => {}); // release regardless of fn's outcome
      return result;
    },
  };
}

export const UNSUPPORTED_MESSAGE =
  "This browser can't coordinate reference changes safely (the Web Locks API is unavailable). " +
  "Changes are blocked to avoid overwriting another window — update your browser or reopen the panel.";

export function unsupportedMutex() {
  return { kind: "unsupported", withLock: () => Promise.reject(new Error(UNSUPPORTED_MESSAGE)) };
}

export function locksAvailable() {
  try { return typeof navigator !== "undefined" && !!navigator.locks && typeof navigator.locks.request === "function"; }
  catch { return false; }
}

export function createTrayMutex(name = "design-compositor-tray") {
  return locksAvailable() ? webLocksMutex(name) : unsupportedMutex();
}

