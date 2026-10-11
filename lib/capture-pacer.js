// Pacing for chrome.tabs.captureVisibleTab.
//
// Chrome rate-limits captureVisibleTab (MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND)
// per extension, so a multi-tile stitch cannot just loop: it would start failing
// part-way through, and it would also collide with a capture another side-panel
// window is taking at the same moment.
//
// Two mechanisms, both needed:
//   * a SHARED Web Lock + a SHARED last-capture timestamp (chrome.storage.local),
//     so panels in different windows queue behind each other and the minimum
//     interval is honoured across contexts, not just within one panel;
//   * retry with backoff on the rate-limit error itself, because the quota is
//     Chrome's and our clock is only an estimate of it.
//
// Everything is injected (clock, sleep, lock, storage, capture) so the policy is
// testable without a browser.
export const RATE_LIMIT_RE = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND|too many|rate ?limit|quota/i;

export function isRateLimitError(e) {
  return !!e && RATE_LIMIT_RE.test(String((e && e.message) || e));
}

export function createCapturePacer(deps) {
  // deps: capture() -> Promise<image> (default screenshot fn), withLock(fn),
  //       now() -> ms, sleep(ms), readLast() -> Promise<number>,
  //       writeLast(ms) -> Promise<void>, minIntervalMs?, maxRetries?, backoffMs?
  const minInterval = deps.minIntervalMs == null ? 600 : deps.minIntervalMs;
  const maxRetries = deps.maxRetries == null ? 4 : deps.maxRetries;
  const backoff = deps.backoffMs || ((attempt) => Math.min(4000, 400 * Math.pow(2, attempt - 1)));
  const withLock = typeof deps.withLock === "function" ? deps.withLock : (fn) => fn();
  const readLast = deps.readLast || (async () => 0);
  const writeLast = deps.writeLast || (async () => {});
  // now()/sleep() default to real time. These MUST be safe when omitted: the panel
  // wires the pacer with only withLock/readLast/writeLast, and a missing now() was
  // throwing `deps.now is not a function` on the first screenshot — aborting every
  // capture before anything could be saved (invisible to tests that always inject
  // a clock). Defaulting here fixes it at the root for every caller.
  const now = typeof deps.now === "function" ? deps.now : () => Date.now();
  const sleep = typeof deps.sleep === "function" ? deps.sleep : (ms) => new Promise((r) => setTimeout(r, ms));

  // One capture, serialized against every other panel/caller and paced to the
  // quota. `fn` is the work to run inside the shared lock — for a stitch tile it
  // also re-checks scroll around the actual screenshot (so a drift that happened
  // WHILE queued for the lock is caught). When `fn` is omitted the default
  // deps.capture(...args) screenshot runs, so existing single-shot callers are
  // unchanged. A rate-limit error is retried with backoff; anything else (an
  // access failure, or a scroll-drift abort raised inside fn) propagates at once.
  async function capture(fn, ...args) {
    const run = typeof fn === "function" ? fn : () => deps.capture(fn, ...args);
    return withLock(async () => {
      const last = await readLast().catch(() => 0);
      const since = now() - (Number(last) || 0);
      if (since < minInterval) await sleep(minInterval - since);
      let attempt = 0;
      for (;;) {
        try {
          const image = await run();
          await writeLast(now()).catch(() => {});
          return image;
        } catch (e) {
          await writeLast(now()).catch(() => {});
          if (!isRateLimitError(e) || attempt >= maxRetries) throw e;
          attempt += 1;
          await sleep(backoff(attempt));
        }
      }
    });
  }
  return { capture, minIntervalMs: minInterval };
}
