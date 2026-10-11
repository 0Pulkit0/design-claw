// Phase 4 — RENDERED computed-style measurement for the A/B evaluation.
//
// Token accuracy must be read from the LIVE rendered DOM (getComputedStyle), not
// from HTML substrings: a value in a comment or an unused rule should not count,
// and a value produced by a class / variable / shorthand should. This renders the
// candidate in headless Chrome and reports getComputedStyle for named probe
// selectors.
//
// ASSET RESOLUTION (the fix): earlier this copied the candidate HTML into an OS
// temp dir, so relative CSS / images / scripts / fonts resolved against the wrong
// base and silently failed. Instead we run a tiny local static server rooted at
// the candidate's OWN directory and serve a wrapped version of the candidate at
// its route, so every relative URL resolves exactly as it would on disk. Nothing
// is written into the user's folder, and no external network is touched.
//
// The injected probe waits for document.fonts.ready + two animation frames
// (bounded) before measuring, records which selectors matched, and collects any
// resource that failed to load, so a broken asset or a missing selector is
// reported rather than silently scored as empty.
//
// LIMITATION, stated plainly in the output: computed `font-family` is the
// DECLARED font stack the browser resolved to, NOT proof of which face actually
// rendered the glyphs (that needs font-enumeration or pixel inspection). Treat it
// as "the intended stack won", not "Playfair literally painted".
//
// Usage:
//   node eval/measure-rendered.mjs <candidate.html> <probes.json> \
//        [--width 1280] [--height 900] [--chrome <path>] [--font-timeout 1500]
// probes.json: { "heading": "h1", "cta": "button[class*=primary]", "surface": ".card" }
//
// Requires Google Chrome / Chromium on the machine. The server + wrap layer is
// unit-tested over plain fetch in tests/run.mjs (no browser); the headless render
// path needs Chrome and is NOT executed in this environment — see eval/README.md.
import { readFileSync, mkdtempSync, rmSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, basename, join, resolve, relative, isAbsolute, extname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
const execAsync = promisify(execFile);

export const PROPS = [
  "color", "background-color", "background-image", "font-family", "font-size",
  "font-weight", "line-height", "letter-spacing", "text-transform",
  "border-top-left-radius", "border-top-width", "border-top-style", "border-top-color",
  "box-shadow", "outline-color", "padding-top", "padding-left", "margin-top", "gap", "display",
];

export const FONT_CAVEAT =
  "computed font-family is the DECLARED stack the browser resolved to, not proof of which face actually rendered the glyphs";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf",
};

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
];

// Pure: produce the wrapped candidate HTML with the measuring probe injected.
export function wrap(html, { probes = {}, fontTimeoutMs = 1500 } = {}) {
  const script = `<script>
(function(){
  var failed=[], emitted=false;
  window.addEventListener('error', function(e){ if(e && e.target && e.target !== window && (e.target.src || e.target.href)){ failed.push(e.target.src || e.target.href); } }, true);
  function m(el){ if(!el) return null; var cs=getComputedStyle(el); var o={}; ${JSON.stringify(PROPS)}.forEach(function(p){o[p]=cs.getPropertyValue(p).trim();}); return o; }
  function emit(){
    if(emitted) return; emitted=true;
    var probes=${JSON.stringify(probes).replace(/</g, "\\u003c")}; var out={ viewport:{width:innerWidth,height:innerHeight}, measured:{}, missing:[], assetsFailed:failed.slice(), fontsReady:false, note:${JSON.stringify(FONT_CAVEAT)} };
    Object.keys(probes).forEach(function(k){ var el=null; try{ el=document.querySelector(probes[k]); }catch(e){} if(!el){ out.missing.push(k); out.measured[k]=null; } else { out.measured[k]=m(el); } });
    out.fontsReady = fontsDone;
    var s=document.createElement('script'); s.type='application/json'; s.id='__dc_measure'; s.textContent=JSON.stringify(out); document.body.appendChild(s);
    document.documentElement.setAttribute('data-dc-measured','1');
  }
  var fontsDone=false;
  function ready(){
    var fontsP = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    var bounded = Promise.race([ fontsP.then(function(){fontsDone=true;}), new Promise(function(r){ setTimeout(r, ${Number(fontTimeoutMs) || 1500}); }) ]);
    bounded.then(function(){
      // dump-dom may not schedule animation frames while virtual time advances.
      // A bounded timer guarantees completion in that mode; emit is idempotent.
      setTimeout(emit,100);
      requestAnimationFrame(function(){ requestAnimationFrame(emit); });
    });
  }
  if(document.readyState==='complete'){ ready(); } else { window.addEventListener('load', ready); }
})();
</script>`;
  // Register asset errors before the stylesheet/image elements start loading.
  if (/<head(?:\s[^>]*)?>/i.test(html)) return html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + script);
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, script + "</body>") : script + html;
}

function send(res, status, body, type) {
  res.writeHead(status, { "content-type": type || "text/plain; charset=utf-8", "cache-control": "no-store" });
  res.end(body);
}

// Start a static server rooted at the candidate's directory. The candidate route
// returns the WRAPPED html; every other path serves the real file beside it, so
// relative assets resolve exactly as on disk. Returns { url, port, close }.
export function serveCandidate(candidatePath, opts = {}) {
  const absolute = realpathSync(resolve(candidatePath));
  const root = dirname(absolute);
  const name = basename(absolute);
  const wrapped = wrap(readFileSync(absolute, "utf8"), opts);
  const server = createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); } catch { return send(res, 400, "bad url"); }
    const rel = pathname.replace(/^\/+/, "");
    if (rel === "" || rel === name) return send(res, 200, wrapped, MIME[".html"]);
    let full;
    try { full = realpathSync(resolve(root, rel)); } catch { return send(res, 404, "not found"); }
    const inside = relative(root, full);
    if (inside === ".." || inside.startsWith(".." + (process.platform === "win32" ? "\\" : "/")) || isAbsolute(inside)) return send(res, 403, "forbidden");
    let data; try { data = readFileSync(full); } catch { return send(res, 404, "not found"); }
    send(res, 200, data, MIME[extname(full).toLowerCase()] || "application/octet-stream");
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ port, url: `http://127.0.0.1:${port}/${encodeURIComponent(name)}`, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) });
    });
  });
}

function findChrome(explicit) {
  if (explicit) return explicit;
  for (const c of CHROME_CANDIDATES) {
    try { execFileSync(c, ["--version"], { stdio: "ignore" }); return c; } catch { /* next */ }
  }
  throw new Error("Could not find Chrome/Chromium. Pass --chrome <path>.");
}

// Full measurement: serve + render + parse. Chrome-gated (not run in this env).
export async function measure(candidatePath, probes, opts = {}) {
  const width = opts.width || 1280, height = opts.height || 900;
  const srv = await serveCandidate(candidatePath, { probes, fontTimeoutMs: opts.fontTimeoutMs });
  const profile = mkdtempSync(join(tmpdir(), "dc-chrome-"));
  try {
    // Chrome must run asynchronously: a synchronous child would block this
    // process's HTTP server and prevent Chrome from loading the candidate.
    const { stdout: dom } = await execAsync(findChrome(opts.chrome), [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
      "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`, "--force-device-scale-factor=1",
      "--virtual-time-budget=4000", "--run-all-compositor-stages-before-draw",
      "--dump-dom", srv.url,
    ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 45000 });
    const m = dom.match(/<script type="application\/json" id="__dc_measure">([\s\S]*?)<\/script>/);
    if (!m) throw new Error("No measurement block in the rendered DOM — the page may have errored on load.");
    return { requestedViewport: { width, height }, ...JSON.parse(m[1]) };
  } finally {
    await srv.close();
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// CLI (import-guarded so tests can import the pure/server halves without running it)
const isMain = process.argv[1] && process.argv[1].endsWith("measure-rendered.mjs");
if (isMain) {
  const args = process.argv.slice(2);
  const pos = args.filter((a) => !a.startsWith("--"));
  const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
  const [candidate, probesFile] = pos;
  if (!candidate || !probesFile) {
    console.error("Usage: node eval/measure-rendered.mjs <candidate.html> <probes.json> [--width 1280] [--height 900] [--chrome <path>] [--font-timeout 1500]");
    process.exit(2);
  }
  const probes = JSON.parse(readFileSync(probesFile, "utf8"));
  measure(candidate, probes, {
    width: Number(flag("width", 1280)), height: Number(flag("height", 900)),
    chrome: flag("chrome"), fontTimeoutMs: Number(flag("font-timeout", 1500)),
  }).then((out) => console.log(JSON.stringify(out, null, 2))).catch((e) => { console.error(e.message); process.exit(1); });
}
