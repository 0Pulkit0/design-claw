// Focused regression checks for the reliability pass. Run: node tests/run.mjs
// Pure Node — no browser, no network. Imports the real lib modules.
import assert from "node:assert/strict";
import fs from "node:fs";
import { compile, withCreativeDirection, enrichWithLLM, resolve, sanitizeUrl } from "../lib/compiler.js";
import { buildBundle } from "../lib/bundle.js";
import { planCrop } from "../lib/crop.js";
import { newSession, acceptCapture, confirmActive } from "../lib/capture-session.js";
import { createCaptureController } from "../lib/capture-controller.js";
import { createTrayStore } from "../lib/tray-store.js";
import { createTrayMutex, inMemoryMutex, unsupportedMutex } from "../lib/tray-lock.js";
import { createOutputState } from "../lib/output-state.js";
import { createPendingEdits } from "../lib/pending-edits.js";
import { createCompileGate } from "../lib/compile-gate.js";
import { createTrayRenderer } from "../lib/tray-render.js";
import { createInspectorController } from "../lib/inspector-controller.js";
import { planStitch, planOutput, placeTile, coverageGaps, clampSelection } from "../lib/stitch.js";
import { createStitchController } from "../lib/stitch-controller.js";
import { createStitchDeps } from "../lib/panel-stitch.js";
import { createRawCapture } from "../lib/raw-capture.js";
import { wrap as wrapMeasure, serveCandidate, measure, PROPS as MEASURE_PROPS, FONT_CAVEAT } from "../eval/measure-rendered.mjs";
import { scoreProp, scoreAll, colorDeltaE } from "../eval/score.mjs";
import { createCapturePacer, isRateLimitError } from "../lib/capture-pacer.js";
import { createCaptureDeps } from "../lib/panel-capture.js";
import { exportBundle } from "../lib/export-flow.js";
import { tokenRows, tokenPresentation } from "../lib/tokens-view.js";
import { diagnoseResolved, diagnoseCapture } from "../lib/diagnostics.js";
import { groupMeasurements } from "../lib/inspector-data.js";
import { createPresetStore } from "../lib/presets.js";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

let pass = 0, fail = 0;
process.on("unhandledRejection", (e) => { fail++; console.log("FAIL - unhandled promise rejection\n     ", (e && e.message) || e); });
const ok = (name, fn) => { try { fn(); pass++; console.log("ok   -", name); } catch (e) { fail++; console.log("FAIL -", name, "\n     ", e.message); } };
const okA = async (name, fn) => { try { await fn(); pass++; console.log("ok   -", name); } catch (e) { fail++; console.log("FAIL -", name, "\n     ", e.message); } };
const mk = (id, role, order, computed, extra = {}) => ({ id, sourceUrl: `https://${id}.example.com/p?q=1#f`, role, note: "", order, tokens: { computed, fonts: extra.fonts, motion: extra.motion, keyframes: extra.keyframes, states: extra.states } });
const yamlOf = (md) => (md.match(/```yaml\n([\s\S]*?)```/) || ["", ""])[1];

await (async () => {
  // 1 — square spine + rounded shape override => one consistent radius everywhere
  ok("shape override wins radius, consistent across outputs", () => {
    const c = compile([mk("spine", "spine", 0, { "border-radius": "0px", "box-shadow": "none" }), mk("shaper", "shape", 1, { "border-radius": "24px", "box-shadow": "0 2px 4px #000" })], "b");
    assert.equal(c.resolved.tokens.shape["border-radius"].value, "24px");
    assert.equal(c.resolved.tokens.shape["border-radius"].provenance.role, "shape");
    assert.ok(c.designMd.includes('radius: "24px"') && c.prompt.includes('radius: "24px"'));
    assert.ok(/overrides radii, borders, and shadows only/.test(c.designMd));
    assert.ok(!/resolve every conflict in favor of the spine/i.test(c.designMd));
  });

  // 2 — tray order decides the winner within a role
  ok("tray order picks winning palette source", () => {
    const spine = mk("s", "spine", 0, { color: "#000" });
    const a = mk("pa", "palette", 1, { "background-color": "rgb(1, 2, 3)" });
    const b = mk("pb", "palette", 2, { "background-color": "rgb(9, 9, 9)" });
    assert.equal(compile([spine, a, b], "b").resolved.tokens.color["background-color"].value, "rgb(1, 2, 3)");
    b.order = 0.5; // move pb above pa
    assert.equal(compile([spine, a, b], "b").resolved.tokens.color["background-color"].value, "rgb(9, 9, 9)");
  });

  // 3 — single default-role source keeps its measurements, role unchanged
  ok("single component source is the effective base", () => {
    const only = mk("solo", "component", 0, { "font-size": "18px", "padding-top": "12px" });
    const c = compile([only], "b");
    assert.ok(c.resolved.effectiveBaseNote);
    assert.equal(c.resolved.tokens.typography["font-size"].value, "18px");
    assert.equal(c.resolved.tokens.spacing["padding-top"].value, "12px");
    assert.equal(only.role, "component"); // stored role not mutated
  });

  // 4 — missing measurement => recorded spine fallback, or unavailable + warning
  ok("fallback provenance and unavailable warning", () => {
    const spine = mk("s", "spine", 0, { "letter-spacing": "0.5px" }); // no gap anywhere
    const type = mk("t", "type", 1, { "font-size": "20px" }); // no letter-spacing on type
    const c = compile([spine, type], "b");
    assert.equal(c.resolved.tokens.typography["letter-spacing"].kind, "fallback");
    assert.equal(c.resolved.tokens.typography["letter-spacing"].provenance.role, "spine");
    assert.equal(c.resolved.tokens.spacing.gap.unavailable, true);
    assert.ok(c.resolved.warnings.some((w) => w.includes("spacing.gap")));
  });

  // 5 — full values (incl. long shadow) survive both outputs untruncated
  ok("long shadow + typography survive both outputs", () => {
    const shadow = "0 20px 40px -12px rgba(80, 70, 200, 0.35), 0 4px 12px rgba(80, 70, 200, 0.15), inset 0 0 0 1px #fff";
    const c = compile([mk("s", "spine", 0, { "box-shadow": shadow, "font-size": "72px", "font-weight": "700", "line-height": "1.04", "letter-spacing": "-1px", "padding-top": "24px", gap: "16px", "border-top-width": "3px", "border-radius": "0px" })], "b");
    for (const out of [c.designMd, c.prompt, c.specJson]) assert.ok(out.includes(shadow), "shadow truncated in an output");
    for (const v of ["72px", "700", "16px", "3px"]) assert.ok(c.designMd.includes(v) && c.prompt.includes(v));
  });

  // 6 — quotes / backslashes / newlines / unicode serialize and parse safely
  ok("hostile values serialize safely and round-trip", () => {
    const weird = 'a"b\\c\ndé x';
    const c = compile([mk("s", "spine", 0, { "box-shadow": weird })], "b");
    assert.equal(JSON.parse(c.specJson).tokens.shape["box-shadow"].value, weird); // exact round-trip
    assert.ok(c.designMd.includes(JSON.stringify(weird))); // escaped, no raw newline breaking YAML
    assert.ok(!c.designMd.includes("\n" + weird)); // the raw multiline form is not embedded
  });

  // 7 — font availability stays a candidate, never a verified face
  ok("font availability is an unverified candidate, preserved in both outputs", () => {
    const c = compile([mk("s", "spine", 0, { "font-size": "16px" }, { fonts: { stack: '"Playfair Display", serif', availabilityCandidate: "Playfair Display", verified: false, uncertain: true } })], "b");
    const tf = c.resolved.tokens.typographyFont;
    assert.equal(tf.uncertain, true);
    assert.equal(tf.verified, false);
    assert.equal(tf.availabilityCandidate, "Playfair Display");
    assert.ok(c.designMd.includes("unverified") && c.designMd.includes("Playfair Display"));
    assert.equal(JSON.parse(c.specJson).tokens.typographyFont.verified, false);
    const legacy = compile([mk("s2", "spine", 0, { "font-size": "16px" }, { fonts: { stack: "Inter", firstAvailable: "Inter", uncertain: true } })], "b");
    assert.equal(legacy.resolved.tokens.typographyFont.availabilityCandidate, "Inter");
    assert.equal(legacy.resolved.tokens.typographyFont.verified, false);
  });

  // 8 — enhancement cannot mutate canonical sections
  ok("creative direction leaves canonical spec unchanged", () => {
    const c = compile([mk("s", "spine", 0, { "border-radius": "0px" }), mk("sh", "shape", 1, { "border-radius": "24px" })], "b");
    const e = withCreativeDirection(c, "Calm, confident, one accent used sparingly.");
    assert.equal(yamlOf(e.designMd), yamlOf(c.designMd)); // token block identical
    assert.equal(JSON.parse(e.specJson).tokens.shape["border-radius"].value, "24px");
    assert.ok(e.designMd.includes("Creative direction (advisory"));
    assert.ok(e.prompt.includes("Creative direction (advisory"));
  });

  // 9 — empty / malformed / failed enhancement preserves the deterministic result
  await okA("bad enhancement responses are rejected", async () => {
    const c = compile([mk("s", "spine", 0, { color: "#000" })], "b");
    await assert.rejects(enrichWithLLM(c, async () => ({ text: "" })));
    await assert.rejects(enrichWithLLM(c, async () => ({ text: "   " })));
    await assert.rejects(enrichWithLLM(c, async () => { throw new Error("boom"); }));
    const good = await enrichWithLLM(c, async () => ({ text: "A calm, confident system; one accent, lots of air." }));
    assert.ok(typeof good === "string" && good.length > 8);
    const fenced = await enrichWithLLM(c, async () => ({ text: "```\nRestraint and clear hierarchy throughout.\n```" }));
    assert.ok(!fenced.includes("```"));
  });

  // 10 — stale enhancement guard (mirrors the sidepanel.js seq check)
  ok("stale enhancement guard logic", () => {
    const applies = (reqSeq, curSeq, stale) => reqSeq === curSeq && !stale;
    assert.equal(applies(1, 1, false), true);
    assert.equal(applies(1, 2, false), false); // newer compile landed
    assert.equal(applies(1, 1, true), false); // inputs went stale
  });

  // 11/12 — bundle: real bytes + mapped names; missing crop fails usefully
  await okA("bundle contains mapped files + actual bytes; missing crop fails", async () => {
    const c = compile([mk("s", "spine", 0, { color: "#000" }), mk("p", "palette", 1, { "background-color": "#111" })], "b");
    assert.equal(c.resolved.refs[0].imageFile, "references/REF-01.png");
    const refBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3, 4, 5]);
    const bundle = await buildBundle(c, async () => refBytes);
    assert.ok(bundle.filename.endsWith(".zip") && bundle.bytes.length > 100);
    fs.writeFileSync("/tmp/_dc_bundle.zip", bundle.bytes);
    fs.writeFileSync("/tmp/_dc_ref_expected.bin", refBytes);
    await assert.rejects(buildBundle(c, async () => null), /Missing crop for REF-01/);
  });

  // 13 — exported URLs drop query strings and fragments
  ok("exported urls are sanitized", () => {
    assert.equal(sanitizeUrl("https://x.com/a/b?q=1&r=2#frag"), "https://x.com/a/b");
    const c = compile([mk("s", "spine", 0, { color: "#000" })], "b");
    assert.ok(!c.resolved.refs[0].url.includes("?") && !c.resolved.refs[0].url.includes("#"));
  });

  // validation errors surface in the compiler itself
  ok("compiler validates bad inputs", () => {
    assert.throws(() => compile([mk("a", "spine", 0, {}), mk("b", "spine", 1, {})], "b"), /spines/);
    assert.throws(() => compile([mk("a", "component", 0, {}), mk("b", "component", 1, {})], "b"), /needs a spine/);
    assert.throws(() => resolve([{ id: "x", sourceUrl: "https://x.com", role: "bogus" }]), /unknown role/);
    assert.throws(() => resolve([{ sourceUrl: "https://x.com" }]), /missing an id/);
  });

  // 14 — capture identity binds to the originating tab/window/request
  ok("capture identity binds to tab/window/request + dedupes", () => {
    const sess = newSession({ id: 7, windowId: 2, url: "https://a.com/x" }, "element");
    const msg = { requestId: sess.requestId };
    const sender = { tab: { id: 7, windowId: 2 }, url: "https://a.com/x" };
    const handled = new Set();
    assert.equal(acceptCapture({ session: sess, msg, sender, handled }).accept, true);
    assert.equal(acceptCapture({ session: sess, msg, sender: { tab: { id: 8, windowId: 2 } }, handled }).accept, false); // wrong tab
    assert.equal(acceptCapture({ session: sess, msg, sender: { tab: { id: 7, windowId: 9 } }, handled }).accept, false); // wrong window
    assert.equal(acceptCapture({ session: sess, msg: { requestId: "old" }, sender, handled }).accept, false); // obsolete
    assert.equal(acceptCapture({ session: null, msg, sender, handled }).accept, false); // no session
    handled.add(sess.requestId);
    assert.equal(acceptCapture({ session: sess, msg, sender, handled }).accept, false); // duplicate
  });

  // 15 — confirmActive rejects tab switch, navigation, closed tab
  ok("confirmActive rejects switch / navigation / closed tab", () => {
    const sess = newSession({ id: 7, windowId: 2, url: "https://a.com/x" }, "element");
    assert.equal(confirmActive({ session: sess, activeTab: { id: 7, windowId: 2, url: "https://a.com/x" }, senderUrl: "https://a.com/x" }).ok, true);
    assert.equal(confirmActive({ session: sess, activeTab: { id: 8, windowId: 2 }, senderUrl: "https://a.com/x" }).ok, false);
    assert.equal(confirmActive({ session: sess, activeTab: { id: 7, windowId: 2, url: "https://a.com/y" }, senderUrl: "https://a.com/x" }).ok, false);
    assert.equal(confirmActive({ session: sess, activeTab: undefined, senderUrl: "https://a.com/x" }).ok, false);
  });

  // 16 — crop geometry: every edge, offscreen, invalid, scaled
  ok("planCrop intersects all edges and rejects invalid rects", () => {
    let p = planCrop({ x: 10, y: 20, w: 100, h: 50 }, 1000, 800, 2000, 1600);
    assert.deepEqual([p.sx, p.sy, p.sw, p.sh, p.clipped], [20, 40, 200, 100, false]); // 2x scale, no double-scaling
    p = planCrop({ x: -20, y: 10, w: 100, h: 40 }, 1000, 800, 1000, 800);
    assert.equal(p.sx, 0); assert.equal(p.sw, 80); assert.equal(p.clipped, true); // left: visible 80 not 100
    p = planCrop({ x: 960, y: 0, w: 100, h: 10 }, 1000, 800, 1000, 800);
    assert.equal(p.sw, 40); assert.equal(p.clipped, true); // right
    p = planCrop({ x: 0, y: -30, w: 10, h: 100 }, 1000, 800, 1000, 800);
    assert.equal(p.sy, 0); assert.equal(p.sh, 70); // top
    p = planCrop({ x: 0, y: 760, w: 10, h: 100 }, 1000, 800, 1000, 800);
    assert.equal(p.sh, 40); // bottom
    assert.equal(planCrop({ x: -200, y: 0, w: 100, h: 10 }, 1000, 800, 1000, 800), null); // offscreen left
    assert.equal(planCrop({ x: 0, y: 900, w: 10, h: 10 }, 1000, 800, 1000, 800), null); // offscreen bottom
    assert.equal(planCrop({ x: 0, y: 0, w: 0, h: 10 }, 1000, 800, 1000, 800), null); // zero
    assert.equal(planCrop({ x: NaN, y: 0, w: 10, h: 10 }, 1000, 800, 1000, 800), null); // non-finite
    assert.equal(planCrop({ x: 0, y: 0, w: 10, h: 10 }, 0, 800, 1000, 800), null); // bad viewport
  });

  // 17 — multi-reference bundle: real PNG bytes + Unicode brief
  await okA("multi-ref bundle carries real PNG bytes + Unicode text", async () => {
    const png = fs.readFileSync(new URL("../phase-0.5-gate/_smoketest/components/card-soft-saas.png", import.meta.url));
    assert.ok(png.length > 2000, "need a realistically sized PNG");
    const c = compile([mk("s", "spine", 0, { color: "#000" }), mk("p", "palette", 1, { "background-color": "rgb(217, 138, 31)" })], 'Café façade “日本語” brief');
    assert.equal(c.resolved.refs.length, 2);
    assert.ok(c.specJson.includes("日本語") && c.designMd.includes("日本語"));
    const map = { [c.resolved.refs[0].sourceId]: new Uint8Array(png), [c.resolved.refs[1].sourceId]: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]) };
    const bundle = await buildBundle(c, async (sid) => map[sid] || null);
    fs.writeFileSync("/tmp/_dc_multi.zip", bundle.bytes);
    fs.writeFileSync("/tmp/_dc_png_expected.bin", png);
  });

  // ---- orchestration: production controllers + controlled promises + mocked host/deps ----
  const pcSrc = fs.readFileSync(new URL("../content/pick-controller.js", import.meta.url), "utf8");
  const pcCtx = {}; vm.runInNewContext(pcSrc, pcCtx); // runs the ACTUAL injected content script
  const createPickController = pcCtx.__dcCreatePickController;
  const defer = () => { let resolve; const promise = new Promise((r) => (resolve = r)); return { promise, resolve }; };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const mockHost = (over = {}) => Object.assign({
    requestId: "R", releaseMs: 2500, send: () => {}, extract: async () => ({}),
    rect: () => ({ x: 0, y: 0, w: 10, h: 10 }), viewport: () => ({ w: 1000, h: 800 }), sourceUrl: () => "https://x.com/",
    applyPause: () => {}, hideOverlays: () => {}, nextPaint: async () => {}, setReleaseTimer: () => {}, clearReleaseTimer: () => {}, cleanup: () => {},
  }, over);

  ok("pick-controller loads as the production classic script", () => assert.equal(typeof createPickController, "function"));

  await okA("Escape during extraction => no capture, cleanup ran (the reviewer bug)", async () => {
    const d = defer(); const sent = []; let cleaned = 0;
    const c = createPickController(mockHost({ requestId: "R1", extract: () => d.promise, send: (m) => sent.push(m), cleanup: () => cleaned++ }));
    const p = c.begin(() => ({})); // click -> processing
    c.cancel();                    // Escape mid-extraction (used to be ignored)
    d.resolve({}); await p;
    assert.ok(!sent.some((m) => m.type === "DC_PICKED"));
    assert.ok(sent.some((m) => m.type === "DC_PICK_CANCELLED"));
    assert.equal(cleaned, 1); assert.equal(c.getState(), "settled");
  });

  await okA("cancel during paint-wait => no capture", async () => {
    const paint = defer(); const sent = [];
    const c = createPickController(mockHost({ requestId: "R2", nextPaint: () => paint.promise, send: (m) => sent.push(m) }));
    const p = c.begin(() => ({})); await tick(); c.cancel(); paint.resolve(); await p;
    assert.ok(!sent.some((m) => m.type === "DC_PICKED"));
  });

  await okA("repeated clicks during extraction => at most one capture", async () => {
    const d = defer(); const sent = []; let extracts = 0;
    const c = createPickController(mockHost({ requestId: "R3", extract: () => { extracts++; return d.promise; }, send: (m) => sent.push(m) }));
    c.begin(() => ({})); c.begin(() => ({})); c.begin(() => ({}));
    assert.equal(extracts, 1); d.resolve({}); await tick();
    assert.equal(sent.filter((m) => m.type === "DC_PICKED").length, 1);
  });

  await okA("happy path sends DC_PICKED; confirm reports current viewport", async () => {
    const sent = []; const c = createPickController(mockHost({ requestId: "R4", send: (m) => sent.push(m), viewport: () => ({ w: 1234, h: 777 }) }));
    await c.begin(() => ({}));
    const dc = sent.find((m) => m.type === "DC_PICKED");
    assert.ok(dc && dc.requestId === "R4" && dc.viewportW === 1234);
    const cf = c.confirm(); assert.equal(cf.requestId, "R4"); assert.equal(cf.w, 1234); assert.equal(cf.h, 777);
  });

  ok("cleanup is idempotent across cancel/release", () => {
    let cleaned = 0; const c = createPickController(mockHost({ cleanup: () => cleaned++ }));
    c.cancel(); c.cancel(); c.release(); assert.equal(cleaned, 1);
  });

  const mockDeps = (over = {}) => Object.assign({
    confirm: async (s, m) => ({ requestId: m.requestId, w: m.viewportW, h: m.viewportH }),
    capture: async () => ({ naturalWidth: 1000, naturalHeight: 800 }),
    plan: () => ({ sx: 0, sy: 0, sw: 10, sh: 10, clipped: false }),
    draw: async () => ({ blob: { size: 9 }, w: 10, h: 10, clipped: false }),
    persist: async () => ({ committed: true, w: 10, h: 10, clipped: false }), release: () => {}, report: () => {},
  }, over);
  const SESS = { requestId: "Q", windowId: 1, tabId: 1, url: "https://x.com/" };
  const MSG = (id = "Q") => ({ requestId: id, viewportW: 1000, viewportH: 800, rectCss: { x: 0, y: 0, w: 10, h: 10 } });

  await okA("capture: happy path commits exactly once", async () => {
    let persisted = 0; const reports = [];
    const ctl = createCaptureController(mockDeps({ persist: async () => { persisted++; return { committed: true, w: 10, h: 10, clipped: false }; }, report: (r) => reports.push(r) }));
    await ctl.run(SESS, MSG());
    assert.equal(persisted, 1); assert.equal(reports.at(-1).ok, true);
  });

  await okA("capture: cancel during screenshot => no commit", async () => {
    const cap = defer(); let persisted = 0; const reports = [];
    const ctl = createCaptureController(mockDeps({ capture: () => cap.promise, persist: async () => { persisted++; }, report: (r) => reports.push(r) }));
    const p = ctl.run(SESS, MSG("Q1")); await tick(); ctl.cancel("Q1"); cap.resolve({ naturalWidth: 1000, naturalHeight: 800 }); await p;
    assert.equal(persisted, 0); assert.equal(reports.at(-1).ok, false);
  });

  await okA("capture: cancel during crop/decode => no commit", async () => {
    const drw = defer(); let persisted = 0;
    const ctl = createCaptureController(mockDeps({ draw: () => drw.promise, persist: async () => { persisted++; } }));
    const p = ctl.run(SESS, MSG("Q2")); await tick(); ctl.cancel("Q2"); drw.resolve({ blob: { size: 9 }, w: 10, h: 10 }); await p;
    assert.equal(persisted, 0);
  });

  await okA("capture: viewport changed before shot => abort, no commit", async () => {
    let persisted = 0; const reports = [];
    const ctl = createCaptureController(mockDeps({ confirm: async (s, m) => ({ requestId: m.requestId, w: m.viewportW + 50, h: m.viewportH }), persist: async () => { persisted++; }, report: (r) => reports.push(r) }));
    await ctl.run(SESS, MSG());
    assert.equal(persisted, 0); assert.match(reports.at(-1).reason, /viewport/);
  });

  await okA("capture: document reloaded / released (confirm null) => abort", async () => {
    let persisted = 0; const reports = [];
    const ctl = createCaptureController(mockDeps({ confirm: async () => null, persist: async () => { persisted++; }, report: (r) => reports.push(r) }));
    await ctl.run(SESS, MSG());
    assert.equal(persisted, 0); assert.match(reports.at(-1).reason, /replaced or reloaded/);
  });

  await okA("capture: a newer pick cancels an older in-flight (old acks inert)", async () => {
    const cap = defer(); let persisted = 0;
    const ctl = createCaptureController(mockDeps({ capture: () => cap.promise, persist: async () => { persisted++; } }));
    const p = ctl.run(SESS, MSG("OLD")); await tick();
    ctl.cancelAllExcept("NEW"); cap.resolve({ naturalWidth: 1000, naturalHeight: 800 }); await p;
    assert.equal(persisted, 0);
  });

  // ---- gap 1: release-timeout expiry must invalidate an in-flight capture ----
  await okA("pick-controller: release timeout expires + notifies the panel (distinct from ack)", async () => {
    let timerFn = null; const sent = []; let cleaned = 0;
    const c = createPickController(mockHost({ requestId: "E", send: (m) => sent.push(m), setReleaseTimer: (fn) => { timerFn = fn; }, cleanup: () => cleaned++ }));
    await c.begin(() => ({}));                                   // -> "sent"; arms the release timer
    assert.ok(sent.some((m) => m.type === "DC_PICKED"));
    assert.equal(sent.filter((m) => m.type === "DC_PICK_CANCELLED").length, 0); // nothing yet
    timerFn();                                                  // the release timeout fires
    assert.ok(sent.some((m) => m.type === "DC_PICK_CANCELLED" && m.reason === "expired"));
    assert.equal(cleaned, 1); assert.equal(c.getState(), "settled");
  });

  await okA("pick-controller: a panel ack (release) settles WITHOUT notifying the panel", async () => {
    let timerFn = null; const sent = [];
    const c = createPickController(mockHost({ requestId: "A", send: (m) => sent.push(m), setReleaseTimer: (fn) => { timerFn = fn; } }));
    await c.begin(() => ({}));
    c.release();                                                // panel acked after committing
    assert.equal(sent.filter((m) => m.type === "DC_PICK_CANCELLED").length, 0);
    assert.equal(c.getState(), "settled");
  });

  await okA("capture: expiry while the screenshot is pending => no commit; late resolve inert", async () => {
    const cap = defer(); let persisted = 0; const reports = [];
    const ctl = createCaptureController(mockDeps({ capture: () => cap.promise, persist: async () => { persisted++; return { committed: true }; }, report: (r) => reports.push(r) }));
    const p = ctl.run(SESS, MSG("EX")); await tick();
    ctl.cancel("EX");                                           // the picker's expiry message routes here
    cap.resolve({ naturalWidth: 1000, naturalHeight: 800 }); await p;
    assert.equal(persisted, 0); assert.equal(reports.at(-1).ok, false);
  });

  // ---- gap 2: document / tab / viewport changes DURING the awaited screenshot ----
  const confirmThenBad = (bad) => { let n = 0; return async (s, m) => { n++; if (n === 1) return { requestId: m.requestId, w: m.viewportW, h: m.viewportH }; if (typeof bad === "function") return bad(s, m); return bad; }; };

  await okA("capture: same-URL reload during the shot => post-capture handshake null => abort", async () => {
    const cap = defer(); let persisted = 0; const reports = [];
    const ctl = createCaptureController(mockDeps({ confirm: confirmThenBad(null), capture: () => cap.promise, persist: async () => { persisted++; return { committed: true }; }, report: (r) => reports.push(r) }));
    const p = ctl.run(SESS, MSG("G2a")); await tick(); cap.resolve({ naturalWidth: 1000, naturalHeight: 800 }); await p;
    assert.equal(persisted, 0); assert.match(reports.at(-1).reason, /during capture/);
  });

  await okA("capture: tab switch / navigation during the shot => confirm throws => abort", async () => {
    const cap = defer(); let persisted = 0; const reports = [];
    const ctl = createCaptureController(mockDeps({ confirm: confirmThenBad(() => { throw new Error("the originating tab is no longer active"); }), capture: () => cap.promise, persist: async () => { persisted++; return { committed: true }; }, report: (r) => reports.push(r) }));
    const p = ctl.run(SESS, MSG("G2b")); await tick(); cap.resolve({ naturalWidth: 1000, naturalHeight: 800 }); await p;
    assert.equal(persisted, 0); assert.match(reports.at(-1).reason, /no longer active/);
  });

  await okA("capture: viewport resize during the shot => post-capture mismatch => abort", async () => {
    const cap = defer(); let persisted = 0; const reports = [];
    const ctl = createCaptureController(mockDeps({ confirm: confirmThenBad((s, m) => ({ requestId: m.requestId, w: m.viewportW, h: m.viewportH + 120 })), capture: () => cap.promise, persist: async () => { persisted++; return { committed: true }; }, report: (r) => reports.push(r) }));
    const p = ctl.run(SESS, MSG("G2c")); await tick(); cap.resolve({ naturalWidth: 1000, naturalHeight: 800 }); await p;
    assert.equal(persisted, 0); assert.match(reports.at(-1).reason, /viewport changed during capture/);
  });

  // ---- bug 4 + persistence: lib/tray-store.js runs read->compute->write under a shared lock ----
  const trayRig = (over = {}) => {
    const crops = new Map(); let meta = []; const calls = { put: [], del: [], load: 0, save: 0 };
    const deps = Object.assign({
      putCrop: async (id, b) => { calls.put.push(id); crops.set(id, b); },
      deleteCrop: async (id) => { calls.del.push(id); crops.delete(id); },
      loadMeta: async () => { calls.load++; return meta.slice(); },
      saveMeta: async (t) => { calls.save++; meta = t.slice(); },
      withLock: inMemoryMutex().withLock, // exercise the production lock path (one context)
      onChange: () => {},
    }, over);
    return { store: createTrayStore(deps), crops, calls, meta: () => meta };
  };

  await okA("tray-store: add writes crop then metadata and commits once", async () => {
    const r = trayRig();
    const res = await r.store.add({ item: { id: "c1", role: "component" }, blob: { size: 9 }, cancelled: () => false });
    assert.equal(res.committed, true); assert.ok(r.crops.has("c1")); assert.equal(r.meta().length, 1);
  });

  await okA("tray-store: crop stored then cancelled before metadata => orphan removed, no item", async () => {
    const r = trayRig();
    const res = await r.store.add({ item: { id: "c2", role: "component" }, blob: { size: 9 }, cancelled: () => true });
    assert.equal(res.committed, false); assert.match(res.reason, /cancelled/);
    assert.ok(!r.crops.has("c2")); assert.equal(r.meta().length, 0); assert.deepEqual(r.calls.del, ["c2"]);
  });

  await okA("tray-store: cancellation WHILE crop storage is pending => rolled back", async () => {
    const putD = defer(); let cancel = false;
    const r = trayRig({ putCrop: async () => { await putD.promise; } });
    const p = r.store.add({ item: { id: "c3", role: "component" }, blob: { size: 9 }, cancelled: () => cancel });
    cancel = true; putD.resolve(); const res = await p;
    assert.equal(res.committed, false); assert.deepEqual(r.calls.del, ["c3"]); assert.equal(r.meta().length, 0);
  });
  await okA("tray-store: crop-storage failure => no item, nothing visible", async () => {
    const r = trayRig({ putCrop: async () => { throw new Error("quota exceeded"); } });
    const res = await r.store.add({ item: { id: "c4", role: "component" }, blob: { size: 9 }, cancelled: () => false });
    assert.equal(res.committed, false); assert.match(res.reason, /crop image/); assert.equal(r.meta().length, 0);
  });

  await okA("tray-store: metadata-storage failure => rollback crop, no item pointing at a missing crop", async () => {
    const r = trayRig({ saveMeta: async () => { throw new Error("storage full"); } });
    const res = await r.store.add({ item: { id: "c5", role: "component" }, blob: { size: 9 }, cancelled: () => false });
    assert.equal(res.committed, false); assert.match(res.reason, /save the collection/);
    assert.ok(!r.crops.has("c5")); assert.equal(r.meta().length, 0); assert.deepEqual(r.calls.del, ["c5"]);
  });

  await okA("tray-store: capture-add overlapping remove(A) never resurrects A with a missing crop", async () => {
    const r = trayRig();
    await r.store.add({ item: { id: "A", role: "component" }, blob: { size: 1 }, cancelled: () => false });
    // Both kicked off before awaiting: the shared serializer orders them either way.
    const pB = r.store.add({ item: { id: "B", role: "component" }, blob: { size: 1 }, cancelled: () => false });
    const pRem = r.store.remove("A");
    await Promise.all([pB, pRem]);
    assert.deepEqual(r.meta().map((i) => i.id), ["B"]); // A gone, B present, no stale resurrection
    assert.ok(!r.crops.has("A") && r.crops.has("B"));
  });

  await okA("tray-store: role/note/move build from latest state (single spine, reorder)", async () => {
    const r = trayRig();
    await r.store.add({ item: { id: "A", role: "component" }, blob: { size: 1 }, cancelled: () => false });
    await r.store.add({ item: { id: "B", role: "component" }, blob: { size: 1 }, cancelled: () => false });
    await r.store.setRole("A", "spine");
    await r.store.setRole("B", "spine"); // single spine: A reverts to component
    assert.equal(r.meta().find((i) => i.id === "B").role, "spine");
    assert.equal(r.meta().find((i) => i.id === "A").role, "component");
    await r.store.setNote("A", "hero");
    assert.equal(r.meta().find((i) => i.id === "A").note, "hero");
    await r.store.move("A", 1);
    assert.deepEqual(r.store.get().map((i) => i.id), ["B", "A"]);
  });

  // ---- cross-panel coordination: ONE shared lock across stores (models the browser Web Lock) ----
  // Two store instances share a single mutex + one storage, exactly as two side panels share one
  // navigator.locks lock + one chrome.storage. Overlap is forced with controlled promises.
  const twoPanel = () => {
    const crops = new Map(); let meta = []; const calls = { del: [], load: 0, save: 0 };
    let saveGate = null; // when set, the FIRST save awaits it (to pin panel 1 inside the lock)
    const mutex = createTrayMutex("dc-test-" + Math.random().toString(36).slice(2)); // real Web Lock here (shared name)
    const mk = () => createTrayStore({
      putCrop: async (id, b) => crops.set(id, b),
      deleteCrop: async (id) => { calls.del.push(id); crops.delete(id); },
      loadMeta: async () => { calls.load++; return meta.slice(); },
      saveMeta: async (t) => { calls.save++; if (saveGate) { const g = saveGate; saveGate = null; await g; } meta = t.slice(); },
      withLock: mutex.withLock, onChange: () => {},
    });
    return { mk, crops, meta: () => meta, calls, gateFirstSave: (p) => { saveGate = p; } };
  };
  const addOp = (id) => ({ item: { id, role: "component" }, blob: { size: 1 }, cancelled: () => false });

  await okA("coordination: two panels add concurrently => BOTH refs + crops kept (no lost update)", async () => {
    const h = twoPanel(); const p1 = h.mk(), p2 = h.mk();
    const [r1, r2] = await Promise.all([p1.add(addOp("A")), p2.add(addOp("B"))]); // both kicked off before awaiting
    assert.ok(r1.committed && r2.committed);
    assert.deepEqual(h.meta().map((i) => i.id).sort(), ["A", "B"]);
    assert.ok(h.crops.has("A") && h.crops.has("B"));
  });

  await okA("coordination: a second panel's read waits for the first panel to release the lock", async () => {
    const h = twoPanel(); const p1 = h.mk(), p2 = h.mk();
    const gate = defer(); h.gateFirstSave(gate.promise);
    const a1 = p1.add(addOp("A")); // acquires lock, reads [], parks in saveMeta on the gate
    await tick();
    assert.equal(h.calls.load, 1); // only panel 1 has read
    const a2 = p2.add(addOp("B")); // blocked on the shared lock
    await tick();
    assert.equal(h.calls.load, 1); // panel 2 has NOT read yet -> serialized by the lock
    gate.resolve(); await Promise.all([a1, a2]);
    assert.equal(h.calls.load, 2); // panel 2 read only AFTER panel 1 released
    assert.deepEqual(h.meta().map((i) => i.id).sort(), ["A", "B"]);
  });
  // CONC-MARKER-2
  await okA("coordination: concurrent add + remove(existing) preserve unrelated state", async () => {
    const h = twoPanel();
    await h.mk().add(addOp("A")); await h.mk().add(addOp("B")); // seed [A,B]
    const p1 = h.mk(), p2 = h.mk();
    await Promise.all([p1.add(addOp("C")), p2.remove("A")]);
    assert.deepEqual(h.meta().map((i) => i.id).sort(), ["B", "C"]); // A gone, C added, B untouched
    assert.ok(!h.crops.has("A") && h.crops.has("B") && h.crops.has("C"));
  });

  await okA("coordination: concurrent reorder + note edit both land", async () => {
    const h = twoPanel();
    await h.mk().add(addOp("A")); await h.mk().add(addOp("B")); // [A,B]
    const p1 = h.mk(), p2 = h.mk();
    await Promise.all([p1.move("A", 1), p2.setNote("B", "hello")]);
    const m = h.meta();
    assert.equal(m.find((i) => i.id === "B").note, "hello"); // edit preserved
    assert.deepEqual(m.slice().sort((x, y) => x.order - y.order).map((i) => i.id), ["B", "A"]); // reorder applied
  });

  await okA("coordination: concurrent spine assignments leave EXACTLY one spine", async () => {
    const h = twoPanel();
    await h.mk().add(addOp("A")); await h.mk().add(addOp("B"));
    const p1 = h.mk(), p2 = h.mk();
    await Promise.all([p1.setRole("A", "spine"), p2.setRole("B", "spine")]);
    assert.equal(h.meta().filter((i) => i.role === "spine").length, 1); // last writer wins; one spine
  });
  // CONC-MARKER-3
  await okA("coordination: cancellation DURING the metadata read => no write, staged crop removed", async () => {
    const loadGate = defer(); let cancel = false;
    const h = trayRig({ loadMeta: async () => { await loadGate.promise; return []; } });
    const p = h.store.add({ item: { id: "X", role: "component" }, blob: { size: 1 }, cancelled: () => cancel });
    await tick(); // putCrop done; lock held; parked awaiting loadMeta
    cancel = true; loadGate.resolve();
    const res = await p;
    assert.equal(res.committed, false); assert.match(res.reason, /cancelled/);
    assert.equal(h.calls.save, 0);                              // NO metadata write
    assert.ok(!h.crops.has("X")); assert.deepEqual(h.calls.del, ["X"]); // staged crop removed
  });

  await okA("coordination: metadata-read failure cleans up the staged crop; the next op still succeeds", async () => {
    let failRead = true;
    const h = trayRig({ loadMeta: async () => { if (failRead) { failRead = false; throw new Error("read boom"); } return []; } });
    const r1 = await h.store.add({ item: { id: "Y", role: "component" }, blob: { size: 1 }, cancelled: () => false });
    assert.equal(r1.committed, false); assert.match(r1.reason, /read the collection/);
    assert.ok(!h.crops.has("Y")); assert.deepEqual(h.calls.del, ["Y"]); assert.equal(h.calls.save, 0);
    const r2 = await h.store.add({ item: { id: "Z", role: "component" }, blob: { size: 1 }, cancelled: () => false });
    assert.equal(r2.committed, true); assert.ok(h.crops.has("Z")); assert.deepEqual(h.meta().map((i) => i.id), ["Z"]);
  });

  await okA("coordination: a save failure resolves {ok:false} (no unhandled rejection); the queue survives", async () => {
    const crops = new Map(); let meta = []; let failSave = true; const mutex = inMemoryMutex();
    const store = createTrayStore({
      putCrop: async (id, b) => crops.set(id, b), deleteCrop: async (id) => crops.delete(id),
      loadMeta: async () => meta.slice(), saveMeta: async (t) => { if (failSave) throw new Error("disk full"); meta = t.slice(); },
      withLock: mutex.withLock, onChange: () => {},
    });
    const r1 = await store.add({ item: { id: "A", role: "component" }, blob: { size: 1 }, cancelled: () => false });
    assert.equal(r1.committed, false); assert.match(r1.reason, /save the collection/); assert.ok(!crops.has("A"));
    failSave = false;
    const r2 = await store.add({ item: { id: "B", role: "component" }, blob: { size: 1 }, cancelled: () => false });
    assert.equal(r2.committed, true); assert.deepEqual(meta.map((i) => i.id), ["B"]);
  });

  ok("tray-lock: createTrayMutex returns a usable shared mutex (Web Locks when present, else unsupported)", () => {
    const m = createTrayMutex("t");
    assert.equal(typeof m.withLock, "function");
    assert.ok(m.kind === "web-locks" || m.kind === "unsupported");
  });

  await okA("tray-lock: an unsupported environment blocks mutations safely (no write, staged crop rolled back)", async () => {
    const crops = new Map(); let meta = []; const del = [];
    const store = createTrayStore({
      putCrop: async (id, b) => crops.set(id, b), deleteCrop: async (id) => { del.push(id); crops.delete(id); },
      loadMeta: async () => meta.slice(), saveMeta: async (t) => { meta = t.slice(); },
      withLock: unsupportedMutex().withLock, onChange: () => {},
    });
    const res = await store.add({ item: { id: "A", role: "component" }, blob: { size: 1 }, cancelled: () => false });
    assert.equal(res.ok, false); assert.ok(!res.committed); assert.match(res.reason, /Web Locks|coordinate/);
    assert.equal(meta.length, 0);                       // no metadata written
    assert.ok(!crops.has("A")); assert.deepEqual(del, ["A"]); // staged crop rolled back
    const r2 = await store.setRole("A", "spine");       // other mutations reject safely too
    assert.equal(r2.ok, false); assert.match(r2.reason, /Web Locks|coordinate/);
  });

  await okA("tray-lock: the production mutex serializes two 'panels' sharing one lock name", async () => {
    const name = "dc-serialize-" + Math.random().toString(36).slice(2);
    const m1 = createTrayMutex(name), m2 = createTrayMutex(name); // two producers, one shared lock
    const log = []; const g = defer();
    const a = m1.withLock(async () => { log.push("a-start"); await g.promise; log.push("a-end"); });
    await tick();
    const b = m2.withLock(async () => { log.push("b"); });
    await tick();
    assert.deepEqual(log, ["a-start"]); // b waits for the shared lock to release
    g.resolve(); await Promise.all([a, b]);
    assert.deepEqual(log, ["a-start", "a-end", "b"]);
  });

  await okA("tray-lock: the in-memory fallback serializes overlapping critical sections", async () => {
    const m = inMemoryMutex(); const log = []; const g = defer();
    const a = m.withLock(async () => { log.push("a-start"); await g.promise; log.push("a-end"); return 1; });
    const b = m.withLock(async () => { log.push("b"); return 2; });
    await tick(); assert.deepEqual(log, ["a-start"]);     // b is held off
    g.resolve(); const [ra, rb] = await Promise.all([a, b]);
    assert.deepEqual(log, ["a-start", "a-end", "b"]); assert.equal(ra, 1); assert.equal(rb, 2);
  });
  // ---- bug 1: release dependency interface (production panel-capture deps) ----
  const captureEnv = (over = {}) => {
    const sent = []; let current = null;
    const chrome = { tabs: {
      query: async () => [{ id: 1, windowId: 1, url: "https://x.com/" }],
      sendMessage: async (tabId, m, opts) => { sent.push({ tabId, m, opts }); return { requestId: m.requestId, w: 1000, h: 800 }; },
    } };
    const env = Object.assign({
      chrome, confirmActive: () => ({ ok: true }),
      captureImage: async () => ({ naturalWidth: 1000, naturalHeight: 800 }),
      planCrop: () => ({ sx: 0, sy: 0, sw: 10, sh: 10 }), drawCrop: async () => ({ blob: { size: 9 }, w: 10, h: 10, clipped: false }),
      store: { add: async () => ({ ok: true, committed: true }) },
      getSession: () => current, setSession: (s) => { current = s; },
      addThumb: () => {}, markStale: () => {}, toast: () => {},
    }, over);
    return { deps: createCaptureDeps(env), sent, get: () => current, set: (s) => { current = s; } };
  };

  ok("release: sends DC_RELEASE to the originating tab/frame and clears the current session", () => {
    const r = captureEnv(); r.set({ requestId: "R", tabId: 7, frameId: 0 });
    r.deps.release({ tabId: 7, frameId: 0, url: "https://x.com/" }, { requestId: "R" });
    const rel = r.sent.find((s) => s.m.type === "DC_RELEASE");
    assert.ok(rel && rel.tabId === 7 && rel.m.requestId === "R"); assert.deepEqual(rel.opts, { frameId: 0 });
    assert.equal(r.get(), null);
  });

  ok("release: an older completion does not clear a newer session", () => {
    const r = captureEnv(); r.set({ requestId: "NEW", tabId: 9 });
    r.deps.release({ tabId: 7 }, { requestId: "OLD" });
    assert.deepEqual(r.get(), { requestId: "NEW", tabId: 9 });
  });

  await okA("release: a failed DC_RELEASE delivery does not reject and still clears", async () => {
    const r = captureEnv({ chrome: { tabs: { query: async () => [], sendMessage: async () => { throw new Error("no receiver"); } } } });
    r.set({ requestId: "R", tabId: 7 });
    r.deps.release({ tabId: 7 }, { requestId: "R" });
    await tick();
    assert.equal(r.get(), null);
  });

  await okA("capture deps: happy path persists via the tray-store, marks stale, reports success", async () => {
    let added = 0, staled = 0; const toasts = [];
    const r = captureEnv({ store: { add: async () => { added++; return { ok: true, committed: true }; } }, markStale: () => { staled++; }, toast: (m) => toasts.push(m) });
    const res = await r.deps.persist({ session: { url: "https://x.com/", tabId: 1 }, msg: { requestId: "R", tokens: null }, crop: { blob: { size: 9 }, w: 10, h: 10, clipped: false }, cancelled: () => false });
    assert.equal(added, 1); assert.equal(res.committed, true); assert.equal(res.w, 10); assert.equal(staled, 1);
    r.deps.report({ ok: true, w: 10, h: 10, clipped: false });
    assert.ok(toasts.some((t) => /Added 10×10/.test(t)));
  });
  // ---- bug 2 + bug 3: output-state revision + export-flow (production handlers) ----
  await okA("output-state: reset/input change marks stale; fresh() gates copy/download/enhance/export", async () => {
    const o = createOutputState();
    o.setCompiled({ designMd: "d", prompt: "p", specJson: "{}", resolved: { refs: [] } });
    assert.equal(o.fresh(), true);
    o.markStale(); // the persona-reset path now calls this synchronously (was the bug)
    assert.equal(o.fresh(), false);
    o.setCompiled({ designMd: "d2", prompt: "p2", specJson: "{}", resolved: { refs: [] } });
    assert.equal(o.fresh(), true); // a fresh compile clears it
  });

  const compiledStub = () => ({ designMd: "d", prompt: "p", specJson: "{}", resolved: { refs: [] } });
  const exportRig = (buildBundle) => {
    const o = createOutputState(); o.setCompiled(compiledStub());
    const downloads = []; const toasts = []; const busy = [];
    const run = () => exportBundle({ out: o, buildBundle,
      getBytes: async () => new Uint8Array([1]), download: (f) => downloads.push(f), toast: (m) => toasts.push(m), setBusy: (b) => busy.push(b) });
    return { o, run, downloads, toasts, busy };
  };

  await okA("export-flow: clean export downloads and restores the button", async () => {
    const r = exportRig(async () => ({ filename: "bundle.zip", bytes: new Uint8Array([1, 2]) }));
    const res = await r.run();
    assert.equal(res.ok, true); assert.deepEqual(r.downloads, ["bundle.zip"]); assert.deepEqual(r.busy, [true, false]);
  });

  await okA("export-flow: an input edit mid-bundle aborts the download (button restored)", async () => {
    const d = defer();
    const r = exportRig(async () => { await d.promise; return { filename: "bundle.zip", bytes: new Uint8Array([1]) }; });
    const p = r.run(); await tick(); r.o.markStale(); d.resolve(); const res = await p;
    assert.equal(res.ok, false); assert.equal(res.reason, "stale"); assert.equal(r.downloads.length, 0); assert.deepEqual(r.busy, [true, false]);
  });

  await okA("export-flow: an enhancement mid-bundle invalidates the pending export", async () => {
    const d = defer();
    const r = exportRig(async () => { await d.promise; return { filename: "bundle.zip", bytes: new Uint8Array([1]) }; });
    const p = r.run(); await tick(); r.o.applyEnhancement(compiledStub()); d.resolve(); const res = await p;
    assert.equal(res.ok, false); assert.equal(res.reason, "stale"); assert.equal(r.downloads.length, 0);
  });

  await okA("export-flow: a buildBundle failure surfaces and restores the button", async () => {
    const r = exportRig(async () => { throw new Error("Missing crop for REF-01"); });
    const res = await r.run();
    assert.equal(res.ok, false); assert.match(r.toasts.at(-1), /Missing crop/); assert.deepEqual(r.busy, [true, false]);
  });

  // ---- B3: named run presets (production createPresetStore) ----
  const presetRig = () => {
    let storage = []; const flags = { failSave: false, failLoad: false }; const calls = { save: 0, load: 0 }; let saveGate = null;
    const base = {
      load: async () => { calls.load++; if (flags.failLoad) throw new Error("read fail"); return storage.slice(); },
      save: async (a) => { calls.save++; if (flags.failSave) throw new Error("storage full"); if (saveGate) { const g = saveGate; saveGate = null; await g; } storage = a.slice(); },
    };
    return { mk: (mutex) => createPresetStore({ ...base, withLock: mutex.withLock }), get: () => storage, flags, calls, gateFirstSave: (p) => { saveGate = p; } };
  };

  await okA("presets: save stores inputs only; survives reopen; apply returns them", async () => {
    const h = presetRig(); const m = inMemoryMutex();
    const r = await h.mk(m).save("Landing", { brief: "b", persona: "p", perRunNote: "n" });
    assert.equal(r.ok, true); assert.equal(r.updated, false);
    assert.deepEqual(Object.keys(h.get()[0]).sort(), ["brief", "name", "perRunNote", "persona", "updatedAt"]); // no keys/provider/tray/output
    const reopened = await h.mk(m).list(); // a fresh store over the same storage = reopen
    assert.deepEqual(reopened.map((p) => p.name), ["Landing"]);
    const ap = await h.mk(m).apply("landing"); // case-insensitive
    assert.equal(ap.ok, true); assert.deepEqual(ap.preset, { brief: "b", persona: "p", perRunNote: "n" });
  });

  await okA("presets: duplicate name updates in place; rename conflict + unknown handled; apply-missing clear", async () => {
    const h = presetRig(); const m = inMemoryMutex(); const ps = h.mk(m);
    await ps.save("Landing", { brief: "b1" });
    const up = await ps.save("Landing", { brief: "b2" });
    assert.equal(up.updated, true); assert.equal(h.get().length, 1); assert.equal(h.get()[0].brief, "b2");
    await ps.save("Other", { brief: "o" });
    const rc = await ps.rename("Other", "landing"); assert.equal(rc.ok, false); assert.match(rc.reason, /already exists/);
    assert.equal((await ps.rename("ghost", "x")).ok, false);
    assert.equal((await ps.apply("ghost")).ok, false);
  });

  await okA("presets: save failure and read failure resolve {ok:false} with a useful message", async () => {
    const h = presetRig(); const m = inMemoryMutex();
    h.flags.failSave = true;
    const rs = await h.mk(m).save("X", { brief: "x" }); assert.equal(rs.ok, false); assert.match(rs.reason, /full|storage/i);
    assert.equal(h.get().length, 0);
    h.flags.failSave = false; h.flags.failLoad = true;
    assert.equal((await h.mk(m).save("Y", {})).ok, false); // read fails before write
  });
  // PARTB-MARKER-2
  await okA("presets: two panels saving different presets under one shared lock keep both", async () => {
    const h = presetRig(); const m = createTrayMutex("dc-presets-" + Math.random().toString(36).slice(2));
    const p1 = h.mk(m), p2 = h.mk(m);
    const [r1, r2] = await Promise.all([p1.save("A", { brief: "a" }), p2.save("B", { brief: "b" })]);
    assert.ok(r1.ok && r2.ok);
    assert.deepEqual(h.get().map((x) => x.name).sort(), ["A", "B"]); // neither overwrote the other
  });

  await okA("presets: a second panel's save waits for the first (shared lock serializes read→write)", async () => {
    const h = presetRig(); const m = createTrayMutex("dc-presets-" + Math.random().toString(36).slice(2));
    const gate = defer(); h.gateFirstSave(gate.promise);
    const a = h.mk(m).save("A", { brief: "a" }); // acquires lock, parks in save on the gate
    await tick();
    assert.equal(h.calls.load, 1); // only the first op has read
    const b = h.mk(m).save("B", { brief: "b" }); // blocked on the shared lock
    await tick();
    assert.equal(h.calls.load, 1); // second op hasn't read yet -> serialized
    gate.resolve(); await Promise.all([a, b]);
    assert.deepEqual(h.get().map((x) => x.name).sort(), ["A", "B"]);
  });

  await okA("presets: applying a preset programmatically invalidates compiled output", async () => {
    const h = presetRig(); const m = inMemoryMutex(); const ps = h.mk(m);
    await ps.save("Landing", { brief: "b", persona: "p", perRunNote: "n" });
    const o = createOutputState();
    o.setCompiled({ designMd: "d", prompt: "p", specJson: "{}", resolved: { refs: [] } });
    assert.equal(o.fresh(), true);
    const ap = await ps.apply("Landing");           // panel sets inputs from ap.preset then marks stale
    assert.equal(ap.ok, true);
    o.markStale();                                   // the apply handler's synchronous invalidation
    assert.equal(o.fresh(), false);                  // copy/download/enhance/export now refuse until recompile
  });
  // PARTB-MARKER-3
  // ---- B2: Tokens view rows derive from the SAME canonical spec as resolved-spec.json ----
  ok("tokens-view: rows match the canonical resolved spec (values, provenance, unavailable)", () => {
    const c = compile([
      mk("s", "spine", 0, { "font-size": "18px", "border-radius": "4px", color: "#000" }),
      mk("p", "palette", 1, { "background-color": "rgb(1, 2, 3)" }),
    ], "b");
    const rows = tokenRows(c.resolved);
    const json = JSON.parse(c.specJson);
    const bg = rows.find((r) => r.prop === "background-color");
    assert.equal(bg.value, json.tokens.color["background-color"].value);              // same value, not re-derived
    assert.equal(bg.refId, json.tokens.color["background-color"].provenance.ref);      // same provenance
    assert.equal(bg.status, "observed");
    const gap = rows.find((r) => r.prop === "gap");
    assert.equal(gap.value, null); assert.equal(gap.status, "unavailable");            // never invented
    assert.equal(json.tokens.spacing.gap.unavailable, true);
    // every row that has a value exists verbatim in the canonical spec (no fabrication)
    for (const r of rows) if (r.value != null && r.prop !== "font-availability" && !r.prop.startsWith(":") && !["transition", "animation"].includes(r.prop)) {
      const found = Object.values(json.tokens).some((d) => d && d[r.prop] && d[r.prop].value === r.value);
      assert.ok(found, `row ${r.prop} not found verbatim in spec`);
    }
  });

  // ---- B4: diagnostics derive only from recorded evidence ----
  ok("diagnostics: capture issues reflect clipped / missing-crop / no-measurements", () => {
    assert.deepEqual(diagnoseCapture({ clipped: true, tokens: { computed: {} } }, {}).map((i) => i.kind), ["clipped"]);
    const miss = diagnoseCapture({ tokens: { computed: {} } }, { missingCrop: true });
    assert.ok(miss.some((i) => i.kind === "missing-crop" && i.level === "error"));
    assert.ok(diagnoseCapture({ tokens: null }, {}).some((i) => i.kind === "image-only"));
    assert.equal(diagnoseCapture({ tokens: { computed: { color: "#000" } } }, {}).length, 0); // clean capture, no noise
  });

  ok("diagnostics: resolution issues report unavailable / fallback / font-uncertainty with refs", () => {
    const c = compile([
      mk("s", "spine", 0, { "font-size": "18px" }),
      mk("t", "type", 1, {}, { fonts: { availabilityCandidate: "Inter", verified: false, uncertain: true } }),
    ], "b");
    const d = diagnoseResolved(c.resolved);
    assert.ok(d.some((x) => x.kind === "unavailable"));                 // e.g. gap
    const fb = d.find((x) => x.kind === "fallback"); assert.ok(fb && fb.refId); // type falls back to the spine
    assert.ok(d.some((x) => x.kind === "font-uncertain"));
    assert.ok(!d.some((x) => x.level === "error")); // advisory only — never blocks compilation
  });

  // ---- B1: inspector grouping is faithful (missing shown as null; font always uncertain) ----
  ok("inspector-data: groups measurements, marks missing null, flags the font candidate uncertain", () => {
    const g = groupMeasurements({ tokens: { computed: { "font-size": "18px", color: "#000", "background-color": "none" }, fonts: { availabilityCandidate: "Inter" } } });
    const typ = g.find((x) => x.title === "Typography");
    assert.equal(typ.rows.find((r) => r.label === "Size").value, "18px");
    assert.ok(typ.rows.some((r) => r.uncertain && r.value === "Inter"));
    const colors = g.find((x) => x.title === "Colors");
    assert.equal(colors.rows.find((r) => r.label === "Background").value, "none");   // recorded "none" is a measurement
    assert.equal(colors.rows.find((r) => r.label === "Background").absent, true);    // ...flagged as an explicit absence
    assert.equal(colors.rows.find((r) => r.label === "Outline").value, null);        // never recorded => not measured
    assert.equal(colors.rows.find((r) => r.label === "Text").value, "#000");
  });

  // ======================================================================
  // PASS 8 — integration races reproduced against the production modules.
  // Every case below drives the REAL controller/store/gate with controlled
  // promises; nothing here re-implements the logic under test.
  // ======================================================================

  // ---- C1: overlapping tray renders (lib/tray-render.js) ----
  const trayItem = (id, over = {}) => Object.assign({ id, sourceUrl: `https://${id}.test/p`, role: "component", note: "", order: 0, tokens: { computed: { color: "#000" } } }, over);
  const renderRig = (over = {}) => {
    const painted = [], issues = [], gates = new Map();
    const r = createTrayRenderer(Object.assign({
      loadThumb: async (it) => { const g = gates.get(it.id); return g ? g.promise : "url:" + it.id; },
      paint: ({ tray, thumbs, missing }) => painted.push({ ids: tray.map((i) => i.id), thumbs: [...thumbs.keys()], missing: [...missing] }),
      onIssue: (m) => issues.push(m),
    }, over));
    return { r, painted, issues, gates };
  };

  await okA("tray-render: a render superseded during its crop read never touches the DOM", async () => {
    const rig = renderRig(); const gA = defer(); rig.gates.set("A", gA);
    const pA = rig.r.render([trayItem("A")]);          // parks on A's crop read
    await tick();
    assert.equal(rig.painted.length, 0);               // nothing committed yet
    await rig.r.render([trayItem("B")]);               // a NEWER render completes first
    assert.deepEqual(rig.painted.map((p) => p.ids), [["B"]]);
    gA.resolve("url:A");
    const resA = await pA;                             // the stale render resumes LAST
    assert.equal(resA.applied, false); assert.equal(resA.superseded, true);
    assert.deepEqual(rig.painted.map((p) => p.ids), [["B"]]); // still only B — no B+A list
    assert.deepEqual(rig.r.state().map((i) => i.id), ["B"]);  // state and DOM agree
  });

  await okA("tray-render: supersession is checked between items, mid-list", async () => {
    const rig = renderRig(); const g2 = defer(); rig.gates.set("A2", g2);
    const p = rig.r.render([trayItem("A1"), trayItem("A2")]); // A1 read ok, A2 parks
    await tick();
    await rig.r.render([trayItem("B")]);
    g2.resolve("url:A2");
    assert.equal((await p).superseded, true);
    assert.deepEqual(rig.painted.map((p2) => p2.ids), [["B"]]);
  });

  await okA("tray-render: a rejected crop read is visible, not fatal, and not an unhandled rejection", async () => {
    const rig = renderRig({ loadThumb: async () => { throw new Error("IndexedDB unavailable"); } });
    const res = await rig.r.render([trayItem("A")]);
    assert.equal(res.applied, true);                        // the list still renders
    assert.deepEqual(rig.painted[0].missing, ["A"]);        // flagged as a missing crop
    assert.equal(res.failures.length, 1);
    assert.match(rig.issues[0], /IndexedDB unavailable/);   // surfaced to the user
  });

  await okA("tray-render: a paint failure is returned, so the store can report it", async () => {
    const rig = renderRig({ paint: () => { throw new Error("DOM detached"); } });
    const res = await rig.r.render([trayItem("A")]);
    assert.equal(res.applied, false); assert.match(res.error, /DOM detached/);
  });

  // ---- C2: inspector targets removed / switched mid-read (lib/inspector-controller.js) ----
  const inspRig = (initial, over = {}) => {
    let tray = initial.slice(); let open = false; let focused = "opener";
    const gates = new Map(), paints = [], restored = [];
    const ctl = createInspectorController(Object.assign({
      getItem: (id) => tray.find((x) => x.id === id),
      loadThumb: async (it) => { const g = gates.get(it.id); return g ? g.promise : "url:" + it.id; },
      paint: ({ item, thumb, missing, thumbFailed }) => paints.push({ id: item.id, note: item.note, thumb, missing, thumbFailed }),
      show: () => { open = true; }, close: () => { open = false; }, isOpen: () => open,
      activeElement: () => focused, restoreFocus: (el) => restored.push(el),
    }, over));
    return { ctl, paints, gates, restored, isOpen: () => open, setTray: (t) => { tray = t; }, focus: (f) => { focused = f; } };
  };

  await okA("inspector: a reference removed while its crop read is pending does NOT open", async () => {
    const rig = inspRig([trayItem("A")]); const gA = defer(); rig.gates.set("A", gA);
    const p = rig.ctl.open("A"); await tick();
    assert.equal(rig.isOpen(), false);
    rig.setTray([]);                                   // removal commits; the empty tray renders
    gA.resolve("url:A");                               // ...and only then does the crop arrive
    const res = await p;
    assert.equal(res.opened, false); assert.equal(res.reason, "removed");
    assert.equal(rig.isOpen(), false); assert.equal(rig.paints.length, 0);
    assert.equal(rig.ctl.isOpen(), false);
  });

  await okA("inspector: switching reference mid-read commits only the newest, never mixed", async () => {
    const rig = inspRig([trayItem("A"), trayItem("B")]); const gA = defer(); rig.gates.set("A", gA);
    const pA = rig.ctl.open("A"); await tick();
    const rB = await rig.ctl.open("B");
    gA.resolve("url:A");
    const rA = await pA;
    assert.equal(rB.opened, true); assert.equal(rA.opened, false); assert.equal(rA.reason, "superseded");
    assert.deepEqual(rig.paints.map((p) => p.id), ["B"]); // one commit, B only
    assert.equal(rig.ctl.currentId(), "B");
  });

  await okA("inspector: closing during a pending read voids that open", async () => {
    const rig = inspRig([trayItem("A")]); const gA = defer(); rig.gates.set("A", gA);
    const p = rig.ctl.open("A"); await tick();
    rig.ctl.close();
    gA.resolve("url:A");
    const res = await p;
    assert.equal(res.opened, false); assert.equal(rig.paints.length, 0); assert.equal(rig.isOpen(), false);
  });

  await okA("inspector: a removal while the dialog is OPEN closes it instead of showing a stale reference", async () => {
    const rig = inspRig([trayItem("A")]);
    assert.equal((await rig.ctl.open("A")).opened, true);
    assert.equal(rig.isOpen(), true);
    rig.setTray([]);                                   // the tray render then refreshes the inspector
    const res = await rig.ctl.refresh();
    assert.equal(res.opened, false); assert.equal(rig.isOpen(), false); assert.equal(rig.ctl.currentId(), null);
  });

  await okA("inspector: an edit while open repaints from the CURRENT item", async () => {
    const rig = inspRig([trayItem("A", { note: "old" })]);
    await rig.ctl.open("A");
    rig.setTray([trayItem("A", { note: "new" })]);     // store committed the note edit
    await rig.ctl.refresh();
    assert.deepEqual(rig.paints.map((p) => p.note), ["old", "new"]);
    assert.equal(rig.isOpen(), true);
  });

  await okA("inspector: focus returns to the opener captured before the read, not to later focus", async () => {
    const rig = inspRig([trayItem("A")]); const gA = defer(); rig.gates.set("A", gA);
    rig.focus("thumb-A");
    const p = rig.ctl.open("A");
    rig.focus("something-else");                        // focus moves during the async read
    gA.resolve("url:A"); await p;
    rig.focus("note-input");
    await rig.ctl.refresh();                            // a refresh must NOT re-capture the opener
    rig.ctl.closed();                                   // dialog dismissed
    assert.deepEqual(rig.restored, ["thumb-A"]);
  });

  await okA("inspector: a failed crop read still opens, flagged, without rejecting", async () => {
    const rig = inspRig([trayItem("A")], { loadThumb: async () => { throw new Error("read failed"); } });
    const res = await rig.ctl.open("A");
    assert.equal(res.opened, true); assert.equal(res.thumbFailed, true);
    assert.equal(rig.paints[0].missing, true); assert.equal(rig.paints[0].thumbFailed, true);
  });

  // ---- C3: compiling across an unsettled tray edit (lib/compile-gate + pending-edits) ----
  await okA("compile gate: a note edit awaiting storage blocks compilation; the settled state compiles", async () => {
    let meta = [{ id: "A", sourceUrl: "https://a.test/p", role: "spine", note: "old", order: 0, tokens: { computed: { color: "#000", "font-size": "16px" } } }];
    const saveGate = defer();
    const store = createTrayStore({
      putCrop: async () => {}, deleteCrop: async () => {},
      loadMeta: async () => meta.map((m) => ({ ...m })),
      saveMeta: async (t) => { await saveGate.promise; meta = t.map((m) => ({ ...m })); },
      withLock: inMemoryMutex().withLock, onChange: () => {},
    });
    await store.load();
    const pending = createPendingEdits();
    const o = createOutputState({ epoch: () => pending.epoch(), settled: () => pending.idle() });
    const refused = [];
    const gate = createCompileGate({
      pending, out: o, compile,
      getItems: () => store.get(),
      getInputs: () => ({ brief: "a landing page", persona: "", perRunNote: "" }),
      onCompiled: () => {}, onRefuse: (m) => refused.push(m),
    });

    // exactly what the panel's mutate() does: invalidate, then hold the window open
    const done = pending.begin();
    const write = store.setNote("A", "new");
    await tick();
    assert.equal(gate.canCompile(), false);               // the button is disabled in this window
    const r1 = gate.run();                                 // ...and a forced click is refused
    assert.equal(r1.ok, false);
    assert.match(refused[0], /Saving your last edit/);
    assert.equal(o.current(), null);                       // nothing was compiled from the old note
    assert.equal(meta[0].note, "old");                     // the write really was still in flight

    saveGate.resolve(); await write; done();
    assert.equal(gate.canCompile(), true);
    const r2 = gate.run();
    assert.equal(r2.ok, true);
    assert.equal(o.fresh(), true);
    assert.equal(r2.compiled.resolved.refs[0].note, "new"); // compiled from the SETTLED state
  });

  ok("output-state: output compiled during an unsettled edit is never fresh, before or after it settles", () => {
    const pending = createPendingEdits();
    const o = createOutputState({ epoch: () => pending.epoch(), settled: () => pending.idle() });
    const fake = { designMd: "d", prompt: "p", specJson: "{}", resolved: { refs: [] } };
    o.setCompiled(fake);
    assert.equal(o.fresh(), true);                      // settled compile: fresh
    const token = o.begin();
    const done = pending.begin();
    assert.equal(o.fresh(), false);                     // an edit started -> last compile is suspect
    assert.equal(o.stillCurrent(token), false);         // a long export bound earlier must abort
    o.setCompiled(fake);                                // a compile that slipped the gate...
    assert.equal(o.fresh(), false);                     // ...is rejected immediately
    done();
    assert.equal(o.fresh(), false);                     // and still rejected after settlement
    o.setCompiled(fake);
    assert.equal(o.fresh(), true);                      // only a recompile over settled state is fresh
  });

  ok("output-state: a failed save still settles, and the epoch guard survives it", () => {
    const pending = createPendingEdits();
    const o = createOutputState({ epoch: () => pending.epoch(), settled: () => pending.idle() });
    o.setCompiled({ designMd: "d", prompt: "p", specJson: "{}", resolved: { refs: [] } });
    const done = pending.begin();
    done(); done();                                      // settle is idempotent
    assert.equal(pending.idle(), true);
    assert.equal(o.fresh(), false);                      // the edit happened: recompile required
  });

  await okA("pending-edits: run() settles on rejection and releases whenSettled waiters", async () => {
    const seen = [];
    const pending = createPendingEdits({ onChange: (s) => seen.push(s.pending) });
    let settledFlag = false;
    const p = pending.run(async () => { await tick(); throw new Error("save exploded"); });
    assert.equal(pending.idle(), false);                 // the window is open while the write runs
    const waiter = pending.whenSettled().then(() => { settledFlag = true; });
    await assert.rejects(p, /save exploded/);
    await waiter;
    assert.equal(pending.idle(), true); assert.equal(settledFlag, true);
    assert.deepEqual(seen, [1, 0]);                      // the panel re-enables Compile exactly once
  });

  await okA("export-flow: an unsettled tray edit mid-bundle aborts the download", async () => {
    const pending = createPendingEdits();
    const o = createOutputState({ epoch: () => pending.epoch(), settled: () => pending.idle() });
    o.setCompiled(compiledStub());
    const d = defer(); const downloads = []; const toasts = []; const busy = [];
    const p = exportBundle({
      out: o, buildBundle: async () => { await d.promise; return { filename: "bundle.zip", bytes: new Uint8Array([1]) }; },
      getBytes: async () => new Uint8Array([1]), download: (f) => downloads.push(f), toast: (m) => toasts.push(m), setBusy: (b) => busy.push(b),
    });
    await tick();
    const done = pending.begin();        // the user edits a reference while the zip is building
    d.resolve();
    const res = await p;
    assert.equal(res.ok, false); assert.equal(res.reason, "stale");
    assert.equal(downloads.length, 0); assert.deepEqual(busy, [true, false]);
    assert.match(toasts.at(-1), /Export aborted/);
    done();
  });

  // ---- C4: a recorded "none" is a measurement (lib/inspector-data.js) ----
  ok("inspector-data: recorded \"none\" values are preserved, not reported as unmeasured", () => {
    const g = groupMeasurements({ tokens: {
      computed: { "box-shadow": "none", "border-top-style": "none", "text-transform": "none", "background-image": "none", color: "#000" },
      motion: { transition: "none" },
    } });
    const grp = (t) => g.find((x) => x.title === t);
    const rowOf = (t, label) => grp(t).rows.find((r) => r.label === label);
    assert.equal(rowOf("Shape", "Shadow").value, "none");
    assert.equal(rowOf("Shape", "Shadow").absent, true);                // explicit absence
    assert.equal(rowOf("Shape", "Border style").value, "none");
    assert.equal(rowOf("Typography", "Transform").value, "none");
    assert.equal(rowOf("Colors", "Background image").value, "none");
    assert.equal(rowOf("Motion", "Transition").value, "none");
    assert.equal(rowOf("Shape", "Radius").value, null);                  // genuinely not measured
    assert.equal(rowOf("Shape", "Radius").absent, false);
    assert.ok(grp("Shape").rows.some((r) => r.value != null));           // the group is no longer hidden as empty
    // the inspector and the exported spec now report the SAME fact
    const c = compile([mk("s", "spine", 0, { "box-shadow": "none", "text-transform": "none" })], "b");
    assert.ok(c.designMd.includes('shadow: "none"'));
    assert.equal(JSON.parse(c.specJson).tokens.shape["box-shadow"].value, "none");
  });

  // ---- C5: view-notification failure after a committed write (lib/tray-store.js) ----
  await okA("tray-store: a render failure after a committed add keeps the reference AND its crop", async () => {
    const r = trayRig({ onChange: () => { throw new Error("render exploded"); } });
    const res = await r.store.add({ item: { id: "N1", role: "component" }, blob: { size: 5 }, cancelled: () => false });
    assert.equal(res.ok, true); assert.equal(res.committed, true);   // persistence is established first
    assert.match(res.notifyError, /render exploded/);                 // reported separately, not as failure
    assert.ok(r.crops.has("N1"));                                     // crop NOT rolled back
    assert.equal(r.meta().length, 1);
    assert.deepEqual(r.calls.del, []);                                // nothing deleted
    assert.equal(r.meta().every((m) => r.crops.has(m.id)), true);      // no metadata pointing at a missing image
  });

  await okA("tray-store: an async (rejecting) renderer behaves the same and never leaks a rejection", async () => {
    const r = trayRig({ onChange: async () => { throw new Error("async render failed"); } });
    const res = await r.store.add({ item: { id: "N2", role: "component" }, blob: { size: 5 }, cancelled: () => false });
    assert.equal(res.committed, true); assert.match(res.notifyError, /async render failed/);
    assert.ok(r.crops.has("N2")); assert.equal(r.meta().length, 1);
    await tick(); // an unhandled rejection here would fail the suite
  });

  await okA("tray-store: notification failure does not block the NEXT mutation", async () => {
    let boom = true;
    const r = trayRig({ onChange: () => { if (boom) throw new Error("render exploded"); } });
    await r.store.add({ item: { id: "N3", role: "component" }, blob: { size: 5 }, cancelled: () => false });
    boom = false;
    const res2 = await r.store.add({ item: { id: "N4", role: "component" }, blob: { size: 5 }, cancelled: () => false });
    assert.equal(res2.committed, true); assert.equal(res2.notifyError, undefined);
    assert.deepEqual(r.meta().map((m) => m.id), ["N3", "N4"]);
    assert.equal(r.store.get().length, 2);
  });

  await okA("tray-store: remove still deletes the crop when the redraw fails", async () => {
    let boom = false;
    const r = trayRig({ onChange: () => { if (boom) throw new Error("render exploded"); } });
    await r.store.add({ item: { id: "R1", role: "component" }, blob: { size: 5 }, cancelled: () => false });
    boom = true;
    const res = await r.store.remove("R1");
    assert.equal(res.ok, true); assert.equal(res.removed, true); assert.match(res.notifyError, /render exploded/);
    assert.equal(r.meta().length, 0); assert.ok(!r.crops.has("R1")); // metadata first, then the crop
  });

  await okA("capture: a committed add whose redraw fails is reported as added, not cancelled", async () => {
    const toasts = [];
    const crops = new Map(); let meta = [];
    const store = createTrayStore({
      putCrop: async (id, b) => crops.set(id, b), deleteCrop: async (id) => crops.delete(id),
      loadMeta: async () => meta.map((m) => ({ ...m })), saveMeta: async (t) => { meta = t.map((m) => ({ ...m })); },
      withLock: inMemoryMutex().withLock,
      onChange: () => { throw new Error("render exploded"); },
    });
    const env = captureEnv({ store, toast: (m) => toasts.push(m) });
    const ctl = createCaptureController(env.deps);
    env.set({ requestId: "NE", windowId: 1, tabId: 1, url: "https://x.com/", frameId: 0 });
    await ctl.run({ requestId: "NE", windowId: 1, tabId: 1, url: "https://x.com/", frameId: 0 }, MSG("NE"));
    assert.equal(meta.length, 1);                                   // the reference persisted
    assert.equal(crops.size, 1);                                    // with its crop intact
    assert.ok(toasts.some((t) => /^Added 10×10/.test(t)), `unexpected toasts: ${JSON.stringify(toasts)}`);
    assert.ok(toasts.some((t) => /list not refreshed/.test(t)));    // the redraw failure is still disclosed
    assert.ok(!toasts.some((t) => /cancelled/i.test(t)));
  });

  // ======================================================================
  // PASS 9 — extended area capture (edge-hold scrolling + scroll-and-stitch)
  // and honest handling of unmeasured properties.
  // ======================================================================

  // ---- D1: the edge-hold selection state machine (content/area-select.js) ----
  const asSrc = fs.readFileSync(new URL("../content/area-select.js", import.meta.url), "utf8");
  const asCtx = {}; vm.runInNewContext(asSrc, asCtx); // runs the ACTUAL injected content script
  const createAreaSelector = asCtx.__dcCreateAreaSelector;

  const selRig = (over = {}) => {
    let t = 0; let maxY = over.maxY == null ? 5000 : over.maxY;
    const scroll = { x: 0, y: over.startY || 0 };
    const vp = { w: 1000, h: 800 };
    const completed = [], cancels = [], draws = [];
    const sel = createAreaSelector(Object.assign({
      now: () => t,
      getScroll: () => ({ ...scroll }),
      getViewport: () => ({ ...vp }),
      scrollBy: (dy) => { scroll.y = Math.max(0, Math.min(maxY, scroll.y + dy)); },
      draw: (s) => draws.push(s),
      clear: () => {},
      onComplete: (r) => completed.push(r),
      onCancel: (r) => cancels.push(r),
      edgeZone: 50, holdMs: 2000, stepPerTick: 20, minSize: 5,
    }, over));
    return { sel, scroll, completed, cancels, draws, advance: (ms) => { t += ms; } };
  };

  ok("area select: the bottom edge needs a full 2s hold, counting down, before it scrolls", () => {
    const r = selRig();
    r.sel.down(100, 100);
    r.sel.move(400, 790);                       // inside the bottom edge zone
    r.sel.tick();
    assert.equal(r.sel.state().countdown, 2);
    r.advance(1000); r.sel.tick();
    assert.equal(r.sel.state().countdown, 1);
    assert.equal(r.sel.state().scrolling, false);
    assert.equal(r.scroll.y, 0);                // nothing has scrolled yet
    r.advance(1000); r.sel.tick();              // 2s reached
    assert.equal(r.sel.state().scrolling, true);
    assert.equal(r.scroll.y, 20);               // one step
    r.sel.tick();
    assert.equal(r.scroll.y, 40);               // keeps going while held
  });

  ok("area select: leaving the edge stops scrolling and resets the countdown", () => {
    const r = selRig();
    r.sel.down(100, 100); r.sel.move(400, 790);
    r.advance(2000); r.sel.tick();
    assert.equal(r.sel.state().scrolling, true);
    const y = r.scroll.y;
    r.sel.move(400, 400);                       // out of the zone
    assert.equal(r.sel.state().scrolling, false);
    assert.equal(r.sel.state().countdown, null);
    r.advance(5000); r.sel.tick();
    assert.equal(r.scroll.y, y);                // definitely stopped
    r.sel.move(400, 795); r.sel.tick();         // back in: a FRESH 2s, not an instant resume
    assert.equal(r.sel.state().countdown, 2);
    assert.equal(r.sel.state().scrolling, false);
    assert.equal(r.scroll.y, y);
  });

  ok("area select: the top edge scrolls the other way under the same rule", () => {
    const r = selRig({ startY: 1000 });
    r.sel.down(100, 400);
    r.sel.move(400, 10);                        // top zone
    r.sel.tick(); assert.equal(r.sel.state().countdown, 2);
    assert.equal(r.scroll.y, 1000);
    r.advance(2000); r.sel.tick();
    assert.equal(r.sel.state().holdDir, -1);
    assert.equal(r.scroll.y, 980);              // scrolled UP
  });

  ok("area select: the anchor is a document point, so wheel scrolling extends the selection", () => {
    const r = selRig();
    r.sel.down(100, 100);
    // the selector runs in a vm realm, so compare plain copies, not prototypes
    assert.deepEqual({ ...r.sel.state().anchor }, { x: 100, y: 100 });
    r.sel.move(300, 300);
    assert.deepEqual({ ...r.sel.state().rect }, { x: 100, y: 100, w: 200, h: 200 });
    r.scroll.y = 600;                           // trackpad scroll mid-drag
    r.sel.onScroll();
    assert.deepEqual({ ...r.sel.state().rect }, { x: 100, y: 100, w: 200, h: 800 }); // anchor held, height grew
    const out = r.sel.up();
    assert.deepEqual({ ...out }, { x: 100, y: 100, w: 200, h: 800 });
    assert.equal(r.completed.length, 1);
  });

  ok("area select: auto-scrolling extends the selection and stops at the document end", () => {
    const r = selRig({ maxY: 300 });
    r.sel.down(0, 0); r.sel.move(500, 790);
    r.advance(2000);
    for (let i = 0; i < 40; i++) r.sel.tick();
    assert.equal(r.scroll.y, 300);              // clamped at the bottom
    assert.equal(r.sel.state().atEnd, true);
    assert.equal(r.sel.state().rect.h, 1090);   // 790 (client) + 300 (scrolled)
  });

  ok("area select: Escape cancels at every stage and nothing moves afterwards", () => {
    const r = selRig();
    r.sel.down(10, 10); r.sel.move(400, 790);
    r.advance(2000); r.sel.tick();
    const y = r.scroll.y;
    r.sel.cancel("escape");
    assert.deepEqual(r.cancels, ["escape"]);
    r.advance(2000); r.sel.tick();
    assert.equal(r.scroll.y, y);                // inert
    assert.equal(r.sel.up(), null);
    assert.equal(r.completed.length, 0);
  });

  ok("area select: a click (sub-minimum drag) completes nothing", () => {
    const r = selRig();
    r.sel.down(10, 10); r.sel.move(12, 12);
    assert.equal(r.sel.up(), null);
    assert.equal(r.completed.length, 0); assert.equal(r.cancels.length, 0);
  });

  // ---- D2: tile geometry (lib/stitch.js) ----
  ok("stitch plan: stops cover the selection, overlap applies, the page end clamps", () => {
    const p = planStitch({ rect: { x: 0, y: 100, w: 800, h: 2000 }, vw: 1000, vh: 800, docH: 5000, limits: { overlapCss: 0 } });
    assert.deepEqual(p.stops, [100, 900, 1700]);
    const o = planStitch({ rect: { x: 0, y: 100, w: 800, h: 2000 }, vw: 1000, vh: 800, docH: 5000, limits: { overlapCss: 24 } });
    assert.deepEqual(o.stops, [100, 876, 1652]);                       // 24px overlap per step
    const end = planStitch({ rect: { x: 0, y: 4000, w: 500, h: 900 }, vw: 1000, vh: 800, docH: 4900, limits: { overlapCss: 0 } });
    assert.deepEqual(end.stops, [4000, 4100]);                         // clamped to maxScroll
    assert.equal(end.shortBy, 0);
  });

  ok("stitch plan: bounded work and image size, each with an explanation", () => {
    const many = planStitch({ rect: { x: 0, y: 0, w: 100, h: 19000 }, vw: 1000, vh: 800, docH: 30000, limits: { maxTiles: 5, overlapCss: 0 } });
    assert.equal(many.ok, false); assert.match(many.reason, /more than 5 screenshots/);
    const tall = planStitch({ rect: { x: 0, y: 0, w: 100, h: 25000 }, vw: 1000, vh: 800, docH: 30000 });
    assert.equal(tall.ok, false); assert.match(tall.reason, /20000px limit/);
    assert.equal(planOutput({ rect: { w: 400, h: 1700 }, scaleX: 2, scaleY: 2 }).w, 800);
    const huge = planOutput({ rect: { w: 9000, h: 9000 }, scaleX: 2, scaleY: 2 });
    assert.equal(huge.ok, false); assert.match(huge.reason, /16384px limit/);
    const mp = planOutput({ rect: { w: 4000, h: 4000 }, scaleX: 2, scaleY: 2 });
    assert.equal(mp.ok, false); assert.match(mp.reason, /MP limit/);
  });

  ok("stitch geometry: tiles use the captured scale, share exact edges, and leave no gaps", () => {
    const rect = { x: 50, y: 100, w: 400, h: 1700 };
    const common = { rect, vw: 1000, vh: 800, imageW: 2000, imageH: 1600 }; // DPR 2
    const t1 = placeTile({ ...common, scrollY: 100 });
    const t2 = placeTile({ ...common, scrollY: 900 });
    const t3 = placeTile({ ...common, scrollY: 1700 });
    assert.deepEqual([t1.sx, t1.sy, t1.sw, t1.sh], [100, 0, 800, 1600]);  // scaled by 2, x offset kept
    assert.deepEqual([t1.dx, t1.dy, t1.dw, t1.dh], [0, 0, 800, 1600]);
    assert.equal(t2.dy, t1.dy + t1.dh);                                    // exact shared edge
    assert.equal(t3.dy, t2.dy + t2.dh);
    assert.equal(t3.dh, 200);                                              // final partial tile
    const out = planOutput({ rect, scaleX: 2, scaleY: 2 });
    assert.equal(out.h, 3400);
    assert.deepEqual(coverageGaps([t1, t2, t3], out.w, out.h), []);        // no gaps, no duplicated rows
  });

  ok("stitch geometry: overlapping tiles overwrite the same rows instead of duplicating", () => {
    const rect = { x: 0, y: 0, w: 500, h: 1600 };
    const common = { rect, vw: 1000, vh: 800, imageW: 1000, imageH: 800 }; // DPR 1
    const a = placeTile({ ...common, scrollY: 0 });
    const b = placeTile({ ...common, scrollY: 776 });   // 24px overlap
    const c = placeTile({ ...common, scrollY: 1552 });
    assert.ok(b.dy < a.dy + a.dh, "overlap should start before the previous band ends");
    assert.deepEqual(coverageGaps([a, b, c], 500, 1600), []);
    // the overlap is only 24 CSS px: no band is skipped and the output is contiguous
    assert.equal(a.dy, 0); assert.equal(b.dy, 776); assert.equal(c.dy, 1552);
  });

  ok("stitch geometry: a short scroll is placed by the ACHIEVED offset, not the request", () => {
    const rect = { x: 0, y: 100, w: 400, h: 1700 };
    const t = placeTile({ rect, scrollY: 850, vw: 1000, vh: 800, imageW: 2000, imageH: 1600 });
    assert.equal(t.dy, (850 - 100) * 2);  // 1500 — where the page actually was
    assert.equal(t.sy, 0);
    assert.equal(placeTile({ rect: { x: 0, y: 0, w: 10, h: 10 }, scrollY: 5000, vw: 1000, vh: 800, imageW: 1000, imageH: 800 }), null);
  });

  ok("stitch geometry: vertical AND horizontal gaps are detected; selections clamp to the page", () => {
    const full = (dy, dh) => ({ dx: 0, dw: 400, dy, dh });
    const vgap = coverageGaps([full(0, 100), full(300, 100)], 400, 400);
    assert.deepEqual(vgap, [{ axis: "y", from: 100, to: 300 }]);
    assert.deepEqual(coverageGaps([full(0, 400)], 400, 400), []);
    // a band narrower than the output width = off-screen columns were never captured
    assert.ok(coverageGaps([{ dx: 0, dw: 100, dy: 0, dh: 400 }], 200, 400).some((g) => g.axis === "x"));
    const c = clampSelection({ x: -20, y: -10, w: 1400, h: 9000 }, { docW: 1200, docH: 4000, vw: 1000 });
    assert.equal(c.x, 0); assert.equal(c.y, 0);
    assert.equal(c.w, 1000); assert.equal(c.clippedX, true);  // one viewport wide, and it says so
    assert.equal(c.h, 4000);                                  // clamped into the document
    assert.equal(clampSelection({ x: 0, y: 0, w: 1, h: 1 }, { docW: 100, docH: 100, vw: 100 }), null);
    // defect 3 repro: a selection sitting partly off-screen to the right is CLIPPED
    // to the reachable strip and flagged — never painted as blank columns.
    const off = clampSelection({ x: 900, y: 100, w: 200, h: 300 }, { docW: 2000, docH: 5000, vw: 1000, scrollX: 0 });
    assert.equal(off.x, 900); assert.equal(off.w, 100); assert.equal(off.clippedX, true);
  });

  // ---- D3: capture pacing + multi-panel coordination (lib/capture-pacer.js) ----
  await okA("capture pacer: honours the minimum interval across two panels sharing one lock", async () => {
    let t = 1000, shared = 0; const calls = [];
    const lock = inMemoryMutex(); // stands in for the shared Web Lock
    const mk = () => createCapturePacer({
      capture: async () => { calls.push(t); return "img"; },
      withLock: lock.withLock, now: () => t, sleep: async (ms) => { t += ms; },
      readLast: async () => shared, writeLast: async (v) => { shared = v; },
      minIntervalMs: 600,
    });
    const p1 = mk(), p2 = mk();
    await p1.capture();
    await p2.capture();                      // a different panel, the same Chrome quota
    assert.deepEqual(calls, [1000, 1600]);   // the second waited out the interval
    const [a, b] = await Promise.all([p1.capture(), p2.capture()]); // overlapping requests
    assert.equal(a, "img"); assert.equal(b, "img");
    assert.deepEqual(calls, [1000, 1600, 2200, 2800]); // serialized and still paced
  });

  await okA("capture pacer: retries the rate-limit error, surfaces anything else", async () => {
    let t = 0, n = 0;
    const pacer = createCapturePacer({
      capture: async () => { n += 1; if (n < 3) throw new Error("Exceeded MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND quota"); return "img"; },
      now: () => t, sleep: async (ms) => { t += ms; }, minIntervalMs: 0, maxRetries: 4,
    });
    assert.equal(await pacer.capture(), "img");
    assert.equal(n, 3);                        // two retries, then success
    assert.equal(isRateLimitError(new Error("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND")), true);
    assert.equal(isRateLimitError(new Error("tab closed")), false);
    let m = 0;
    const hard = createCapturePacer({ capture: async () => { m += 1; throw new Error("tab closed"); }, now: () => t, sleep: async () => {}, minIntervalMs: 0 });
    await assert.rejects(hard.capture(), /tab closed/);
    assert.equal(m, 1);                        // not retried
  });

  // ---- D4: stitch orchestration (lib/stitch-controller.js) ----
  const AMSG = (id, rect) => ({ requestId: id, mode: "area", rectDoc: rect || { x: 0, y: 100, w: 400, h: 1700 }, viewportW: 1000, viewportH: 800 });
  const stitchRig = (over = {}) => {
    const page = { scrollY: 0, vw: 1000, vh: 800, docH: 5000 };
    const log = [], reports = [], progress = [];
    let persisted = null;
    const deps = Object.assign({
      validate: async () => null,
      prepare: async () => ({ ok: true, vw: page.vw, vh: page.vh, docW: 1000, docH: page.docH, maxScroll: page.docH - page.vh, scrolls: true }),
      scrollTo: async (s, m, y) => {
        page.scrollY = Math.max(0, Math.min(y, page.docH - page.vh));
        log.push("scroll:" + page.scrollY);
        return { ok: true, scrollY: page.scrollY, scrollX: 0, vw: page.vw, vh: page.vh, docH: page.docH, maxScroll: page.docH - page.vh };
      },
      capture: async () => { log.push("capture"); return { naturalWidth: 2000, naturalHeight: 1600 }; },
      makeCanvas: (w, h) => ({ w, h, draws: [], drawImage(img, p) { this.draws.push(p); }, toBlob: async () => ({ size: 999 }) }),
      persist: async (args) => { persisted = args; log.push("persist"); return { ok: true, committed: true }; },
      finish: async () => { log.push("finish"); },
      progress: (s) => progress.push(s.phase + (s.tile ? `:${s.tile}/${s.total}` : "")),
      report: (r) => reports.push(r),
    }, over);
    return { ctl: createStitchController(deps), page, log, reports, progress, persisted: () => persisted };
  };

  await okA("stitch: three tiles compose one image, persisted once, page always restored", async () => {
    const r = stitchRig();
    await r.ctl.run(SESS, AMSG("S1"));
    assert.equal(r.reports.at(-1).ok, true);
    assert.equal(r.reports.at(-1).tiles, 3);
    assert.equal(r.reports.at(-1).w, 800); assert.equal(r.reports.at(-1).h, 3400);
    assert.equal(r.persisted().crop.h, 3400);
    assert.equal(r.persisted().crop.tiles, 3);
    assert.deepEqual(r.log, ["scroll:100", "capture", "scroll:876", "capture", "scroll:1652", "capture", "persist", "finish"]);
    assert.ok(r.progress.includes("tile:2/3") && r.progress.includes("composing") && r.progress.at(-1) === "done");
  });

  await okA("stitch: a failed screenshot persists nothing and still restores the page", async () => {
    const r = stitchRig({ capture: async () => { throw new Error("capture blew up"); } });
    await r.ctl.run(SESS, AMSG("S2"));
    assert.equal(r.persisted(), null);
    assert.match(r.reports.at(-1).reason, /capture blew up/);
    assert.ok(r.log.includes("finish"));
  });

  await okA("stitch: cancelling mid-capture persists nothing and restores the page", async () => {
    const gate = defer();
    const r = stitchRig({ capture: async () => { await gate.promise; return { naturalWidth: 2000, naturalHeight: 1600 }; } });
    const p = r.ctl.run(SESS, AMSG("S3"));
    await tick();
    r.ctl.cancel("S3");
    gate.resolve(); await p;
    assert.equal(r.persisted(), null);
    assert.equal(r.reports.at(-1).reason, "cancelled");
    assert.ok(r.log.includes("finish"));
  });

  await okA("stitch: resize, page growth, hijacked scroll and nested scrollers each abort with a reason", async () => {
    let n = 0;
    const resized = stitchRig({ scrollTo: async () => { n += 1; return { ok: true, scrollY: n === 1 ? 100 : 900, vw: 1000, vh: n === 1 ? 800 : 700, docH: 5000, maxScroll: 4200 }; } });
    await resized.ctl.run(SESS, AMSG("S4"));
    assert.match(resized.reports.at(-1).reason, /resized/);
    assert.equal(resized.persisted(), null);

    let g = 0;
    const grew = stitchRig({ scrollTo: async (s, m, y) => { g += 1; return { ok: true, scrollY: y, vw: 1000, vh: 800, docH: g === 1 ? 5000 : 9000, maxScroll: 4200 }; } });
    await grew.ctl.run(SESS, AMSG("S5"));
    assert.match(grew.reports.at(-1).reason, /grew while capturing/);

    const hijacked = stitchRig({ scrollTo: async () => ({ ok: true, scrollY: 0, vw: 1000, vh: 800, docH: 5000, maxScroll: 4200 }) });
    await hijacked.ctl.run(SESS, AMSG("S6"));
    assert.match(hijacked.reports.at(-1).reason, /did not scroll where asked/);

    const nested = stitchRig({ prepare: async () => ({ ok: true, unsupported: true, reason: "This page doesn't scroll in the window" }) });
    await nested.ctl.run(SESS, AMSG("S7"));
    assert.match(nested.reports.at(-1).reason, /doesn't scroll in the window/);
    assert.equal(nested.persisted(), null);
  });

  await okA("stitch: zoom change, empty screenshot and a coverage gap all refuse to save", async () => {
    let z = 0;
    const zoomed = stitchRig({ capture: async () => { z += 1; return { naturalWidth: z === 1 ? 2000 : 3000, naturalHeight: z === 1 ? 1600 : 2400 }; } });
    await zoomed.ctl.run(SESS, AMSG("S8"));
    assert.match(zoomed.reports.at(-1).reason, /zoom changed/);

    const empty = stitchRig({ capture: async () => ({ naturalWidth: 0, naturalHeight: 0 }) });
    await empty.ctl.run(SESS, AMSG("S9"));
    assert.match(empty.reports.at(-1).reason, /came back empty/);

    // the page reports it cannot scroll at all (maxScroll 0), so every tile lands
    // at the same offset: the composed image would have a hole -> nothing is saved
    const stuck = stitchRig({ scrollTo: async () => ({ ok: true, scrollY: 0, vw: 1000, vh: 800, docH: 5000, maxScroll: 0 }) });
    await stuck.ctl.run(SESS, AMSG("S10"));
    assert.match(stuck.reports.at(-1).reason, /never captured/);
    assert.equal(stuck.persisted(), null);
  });

  await okA("stitch: validation failures before and during capture abort cleanly", async () => {
    const pre = stitchRig({ validate: async (s, m, when) => (when === "before capture" ? "the picked document was replaced or reloaded before capture" : null) });
    await pre.ctl.run(SESS, AMSG("S11"));
    assert.match(pre.reports.at(-1).reason, /replaced or reloaded before capture/);
    assert.ok(!pre.log.includes("capture"));

    let c = 0;
    const mid = stitchRig({ validate: async (s, m, when) => { if (when === "during capture") { c += 1; if (c === 2) return "the viewport changed during capture — re-pick"; } return null; } });
    await mid.ctl.run(SESS, AMSG("S12"));
    assert.match(mid.reports.at(-1).reason, /during capture/);
    assert.equal(mid.persisted(), null);
    assert.ok(mid.log.includes("finish"));
  });

  // ---- D5: capture metadata records evidence, and the area lifecycle is bounded ----
  await okA("pick-controller: measured, failed, and image-only are recorded as different facts", async () => {
    const sent1 = [];
    const good = createPickController(mockHost({ send: (m) => sent1.push(m), extract: async () => ({ computed: { color: "#000" } }) }));
    await good.begin(() => ({}));
    const g = sent1.find((m) => m.type === "DC_PICKED");
    assert.equal(g.measurement.status, "measured");
    assert.equal(g.mode, "element");

    const sent2 = [];
    const broken = createPickController(mockHost({ send: (m) => sent2.push(m), extract: async () => { throw new Error("CSP blocked getComputedStyle"); } }));
    await broken.begin(() => ({}));
    const b = sent2.find((m) => m.type === "DC_PICKED");
    assert.equal(b.measurement.status, "failed");          // never relabelled as intentional
    assert.match(b.measurement.reason, /CSP blocked/);
    assert.equal(b.tokens, null);
  });

  await okA("pick-controller: area capture sends document coords and a bounded multi-tile lifecycle", async () => {
    const sent = [], timers = [];
    let idleFn = null;
    const c = createPickController(mockHost({
      send: (m) => sent.push(m),
      setReleaseTimer: (fn, ms) => { idleFn = fn; timers.push(ms); },
      setTotalTimer: (fn, ms) => timers.push("total:" + ms),
      metrics: () => ({ vw: 1000, vh: 800, docW: 1000, docH: 5000, scrollX: 0, scrollY: 120, scrolls: true }),
    }));
    await c.beginArea({ x: 10, y: 200, w: 300, h: 2400 });
    const dc = sent.find((m) => m.type === "DC_PICKED");
    assert.equal(dc.mode, "area");
    assert.deepEqual(dc.rectDoc, { x: 10, y: 200, w: 300, h: 2400 });
    assert.equal(dc.measurement.status, "image-only");
    assert.equal(dc.docH, 5000); assert.equal(dc.scrolls, true);
    assert.deepEqual(timers, [15000, "total:150000"]); // idle + absolute cap, not the 2.5s single-shot timeout
    timers.length = 0;
    c.touch();                                          // a panel message during the stitch
    assert.deepEqual(timers, [15000]);                  // idle restarted, cap untouched
    idleFn();                                           // the panel went away mid-stitch
    assert.ok(sent.some((m) => m.type === "DC_PICK_CANCELLED" && m.reason === "expired"));
  });

  await okA("pick-controller: element mode keeps the short single-shot release timeout", async () => {
    const timers = [];
    const c = createPickController(mockHost({ setReleaseTimer: (fn, ms) => timers.push(ms), setTotalTimer: (fn, ms) => timers.push("total:" + ms) }));
    await c.beginRegion({ x: 0, y: 0, w: 10, h: 10 });
    assert.deepEqual(timers, [2500]); // no idle/absolute pair: one screenshot, one short timeout
  });

  // ---- D6: image-only vs extraction-failed, with a route to measurement ----
  ok("diagnostics: image-only and extraction-failed are different facts, each actionable", () => {
    const io = diagnoseCapture({ tokens: null, measurement: { status: "image-only" }, role: "component" }, {});
    assert.ok(io.some((i) => i.kind === "image-only" && i.level === "info"));
    assert.ok(!io.some((i) => i.kind === "extraction-failed"));
    assert.ok(io.some((i) => i.action && i.action.pick));                  // obvious route to measure
    assert.ok(io.some((i) => /no measured CSS/.test(i.message)));          // says what it still provides

    const failed = diagnoseCapture({ tokens: null, measurement: { status: "failed", reason: "CSP" }, role: "component" }, {});
    assert.ok(failed.some((i) => i.kind === "extraction-failed" && /CSP/.test(i.message)));
    assert.ok(!failed.some((i) => i.kind === "image-only"));               // not described as intentional

    const asBase = diagnoseCapture({ tokens: null, measurement: { status: "image-only" }, role: "spine" }, {});
    assert.ok(asBase.some((i) => i.kind === "role-needs-measurement" && i.level === "warn"));
    const asPalette = diagnoseCapture({ tokens: null, measurement: { status: "image-only" }, role: "palette" }, {});
    assert.ok(asPalette.some((i) => /color source/.test(i.message)));      // plain language
  });

  // ---- D7: concise exports, complete JSON ----
  const imgRef = (id, role, order, measurement) => ({ id, sourceUrl: `https://${id}.test/p`, role, note: "", order, tokens: null, measurement: measurement || { status: "image-only" }, mode: "area" });

  ok("output: unmeasured properties are omitted from the exports but kept in the JSON", () => {
    const c = compile([mk("s", "spine", 0, { "font-size": "18px", color: "#000", "box-shadow": "none", "border-radius": "0px", "text-transform": "normal", "background-color": "transparent" })], "b");
    const yaml = yamlOf(c.designMd);
    assert.ok(yaml.includes('size: "18px"'));
    assert.ok(yaml.includes('shadow: "none"'));          // legitimate CSS values survive
    assert.ok(yaml.includes('radius: "0px"'));
    assert.ok(yaml.includes('text_transform: "normal"'));
    assert.ok(yaml.includes('background: "transparent"'));
    assert.ok(!/unavailable/.test(yaml) && !/null/.test(yaml)); // no empty rows
    assert.ok(!/^spacing:/m.test(yaml) && !/^layout:/m.test(yaml)); // no empty domain headers
    assert.ok(!c.designMd.includes("## Warnings"));      // no repetitive warning list
    assert.match(c.designMd, /## Coverage/);
    assert.match(c.designMd, /unconstrained by measurement/);
    assert.match(c.prompt, /unconstrained by measurement/);
    assert.match(c.designMd, /Measured \d+ of 27 expected properties/);

    const json = JSON.parse(c.specJson);                 // the canonical record loses nothing
    assert.equal(json.coverage.expected, 27);
    assert.ok(json.coverage.unavailable > 0);
    assert.equal(json.tokens.spacing.gap.unavailable, true);
    assert.ok(json.warnings.some((w) => w.includes("spacing.gap")));
    assert.equal(json.tokens.shape["box-shadow"].value, "none"); // and agrees with the concise view
    assert.equal(json.anyMeasured, true);
  });

  ok("output: an all-image-only merge emits a visual handoff, not an empty token schema", () => {
    const c = compile([imgRef("a", "spine", 0), imgRef("b", "palette", 1)], "a pricing page");
    assert.ok(!c.designMd.includes("```yaml"));          // no skeleton of nulls
    assert.ok(!c.prompt.includes("```yaml"));
    assert.match(c.designMd, /Visual direction only/);
    assert.match(c.designMd, /visual direction/i);
    assert.match(c.prompt, /captured as images/);
    assert.match(c.prompt, /as your decisions/);
    assert.ok(!/# unavailable/.test(c.prompt));          // and no per-property empty rows
    assert.match(c.designMd, /REF-01.*Image only/);
    const json = JSON.parse(c.specJson);
    assert.equal(json.anyMeasured, false);
    assert.deepEqual(json.imageOnlyRefIds, ["REF-01", "REF-02"]);
    assert.equal(json.coverage.unavailable, 27);         // still fully recorded
    assert.ok(json.warnings.length >= 27);
  });

  ok("output: references are labelled by evidence, and a failed extraction is called out", () => {
    const c = compile([mk("s", "spine", 0, { "font-size": "16px" }), imgRef("b", "palette", 1, { status: "failed", reason: "CSP" })], "b");
    assert.match(c.designMd, /\*\*REF-01\*\*.*Styles measured/);
    assert.match(c.designMd, /\*\*REF-02\*\*.*Image only/);
    assert.match(c.designMd, /REF-02 was meant to be measured but style extraction failed/);
    assert.match(c.designMd, /holds an override role but has no measured styles/);
    assert.match(c.prompt, /REF-02 .*Image only/);
    const json = JSON.parse(c.specJson);
    assert.deepEqual(json.extractionFailedRefIds, ["REF-02"]);
    assert.equal(json.references[1].measured, false);
    assert.equal(json.references[0].measured, true);
  });

  ok("output: concise omission never contradicts the canonical spec", () => {
    const c = compile([
      mk("s", "spine", 0, { "font-size": "18px", "padding-top": "12px", color: "rgb(1, 2, 3)" }),
      mk("p", "palette", 1, { "background-color": "rgb(9, 9, 9)" }),
    ], "b");
    const yaml = yamlOf(c.designMd);
    const json = JSON.parse(c.specJson);
    // every value shown in the concise YAML exists verbatim in the canonical spec
    for (const m of yaml.matchAll(/^\s{2}(\w+): (".*?")(\s|$)/gm)) {
      if (["availability_candidate", "transition", "animation", "keyframes", "hover", "focus"].includes(m[1])) continue; // not per-property records
      const val = JSON.parse(m[2]);
      const found = Object.values(json.tokens).some((d) => d && Object.values(d).some((rec) => rec && rec.value === val));
      assert.ok(found, `concise value ${val} is not in the canonical spec`);
    }
    // and nothing marked unavailable in the spec appears in the concise view
    for (const [, domain] of Object.entries(json.tokens)) {
      if (!domain || typeof domain !== "object") continue;
      for (const [prop, rec] of Object.entries(domain)) {
        if (rec && rec.unavailable) assert.ok(!yaml.includes(`${prop}:`), `${prop} is unavailable but was emitted`);
      }
    }
  });

  // ======================================================================
  // PASS 10 — five more integration defects, each against production code.
  // ======================================================================

  // ---- E1: Escape cancels the whole lifecycle, incl. after mouseup (pick-controller) ----
  await okA("pick-controller: cancel() after an area selection aborts the running stitch", async () => {
    const sent = [];
    const c = createPickController(mockHost({ send: (m) => sent.push(m), metrics: () => ({ vw: 1000, vh: 800, docW: 1000, docH: 5000, scrollX: 0, scrollY: 0, scrolls: true }) }));
    await c.beginArea({ x: 0, y: 0, w: 300, h: 2000 });           // mouseup -> stitch underway (state "sent")
    assert.equal(c.getState(), "sent");
    c.cancel();                                                    // Escape during the stitch
    assert.equal(c.getState(), "settled");
    assert.equal(c.isCancelled(), true);
    assert.ok(sent.some((m) => m.type === "DC_PICK_CANCELLED"));   // the panel is told to abort
  });

  ok("picker key handler: after mouseup, Escape routes to controller.cancel (not the settled selector)", () => {
    // Mirrors content/picker.js onKey: a settled selector's cancel() is a no-op, so
    // Escape must hit the controller directly or the stitch would ignore it.
    const calls = [];
    const selector = { state: () => ({ dragging: false }), cancel: () => calls.push("selector") };
    const controller = { cancel: () => calls.push("controller") };
    const onEscape = () => { if (selector && selector.state().dragging) selector.cancel("escape"); else controller.cancel(); };
    onEscape();
    assert.deepEqual(calls, ["controller"]);                       // stitch phase -> controller cancelled
    const calls2 = [];
    const dragging = { state: () => ({ dragging: true }), cancel: () => calls2.push("selector") };
    const onEscape2 = () => { if (dragging && dragging.state().dragging) dragging.cancel("escape"); else controller.cancel(); };
    onEscape2();
    assert.deepEqual(calls2, ["selector"]);                        // mid-selection -> selector cancels
  });

  // ---- E2 + E4: shared capture coordination, scroll-drift, quota (panel-stitch/pacer) ----
  const defScroll = { ok: true, scrollX: 0, scrollY: 100, vw: 1000, vh: 800, docH: 5000 };
  const driftRig = (over = {}) => {
    const scrollState = { ...defScroll };
    const chrome = {
      tabs: {
        query: async () => [{ id: 1, windowId: 1, url: "https://x.com/" }],
        sendMessage: async (_tabId, m) => (m.type === "DC_CONFIRM_SCROLL" ? { ...scrollState } : { ok: true }),
      },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    };
    const pacer = createCapturePacer({ withLock: over.lock || ((fn) => fn()), now: () => 0, sleep: async () => {}, readLast: async () => 0, writeLast: async () => {}, minIntervalMs: 0, maxRetries: 2 });
    const deps = createStitchDeps({
      chrome, confirmActive: () => ({ ok: true }),
      screenshot: over.screenshot || (async () => ({ naturalWidth: 2000, naturalHeight: 1600 })),
      capturePacer: pacer, store: { add: async () => ({ ok: true, committed: true }) },
      getSession: () => null, setSession: () => {}, addThumb: () => {}, markStale: () => {}, toast: () => {},
    });
    return { deps, scrollState };
  };
  const SESS2 = { tabId: 1, windowId: 1, frameId: 0 };
  const EXP = { scrollX: 0, scrollY: 100, vw: 1000, vh: 800, docH: 5000 };

  await okA("stitch capture: a still page returns the screenshot", async () => {
    const img = await driftRig().deps.capture(SESS2, { requestId: "C0" }, EXP);
    assert.equal(img.naturalWidth, 2000);
  });

  await okA("stitch capture: movement WHILE QUEUED for the lock aborts (both axes)", async () => {
    const gate = defer();
    const rig = driftRig({ lock: (fn) => gate.promise.then(fn) }); // hold the shared lock = queued
    const p = rig.deps.capture(SESS2, { requestId: "C1" }, EXP);
    await tick();
    rig.scrollState.scrollY = 350;    // the user scrolled while we waited for the lock
    gate.resolve();
    await assert.rejects(p, /scrolled while queued/);
    const gateX = defer();
    const rigX = driftRig({ lock: (fn) => gateX.promise.then(fn) });
    const pX = rigX.deps.capture(SESS2, { requestId: "C1x" }, EXP);
    await tick(); rigX.scrollState.scrollX = 120; gateX.resolve();
    await assert.rejects(pX, /scrolled while queued/); // horizontal drift caught too
  });

  await okA("stitch capture: movement WHILE the screenshot is pending aborts", async () => {
    const g = defer();
    const rig = driftRig({ screenshot: async () => { await g.promise; return { naturalWidth: 2000, naturalHeight: 1600 }; } });
    const p = rig.deps.capture(SESS2, { requestId: "C2" }, EXP);
    await tick();                     // first (queued) check passed: scroll still 100
    rig.scrollState.scrollY = 300;    // moved while the shot was pending
    g.resolve();
    await assert.rejects(p, /while the screenshot was taken/);
  });

  await okA("capture coordination: element and area share ONE lock+pacer; quota is retried", async () => {
    let active = 0, maxActive = 0, shots = 0;
    const mutex = inMemoryMutex();
    const lock = (fn) => mutex.withLock(async () => { active++; maxActive = Math.max(maxActive, active); try { return await fn(); } finally { active--; } });
    const pacer = createCapturePacer({ withLock: lock, now: () => 0, sleep: async () => {}, readLast: async () => 0, writeLast: async () => {}, minIntervalMs: 0, maxRetries: 3 });
    const screenshot = async () => { shots++; if (shots === 1) throw new Error("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND"); return { naturalWidth: 1000, naturalHeight: 800 }; };
    // element path through the production createCaptureDeps
    const elDeps = createCaptureDeps({ chrome: {}, confirmActive: () => ({ ok: true }), screenshot, capturePacer: pacer, store: {}, getSession: () => null, setSession: () => {}, addThumb: () => {}, markStale: () => {}, toast: () => {} });
    // area path through the production createStitchDeps (scroll never drifts)
    const chrome = { tabs: { sendMessage: async (_t, m) => (m.type === "DC_CONFIRM_SCROLL" ? { ...defScroll } : { ok: true }) }, storage: { local: { get: async () => ({}), set: async () => {} } } };
    const arDeps = createStitchDeps({ chrome, confirmActive: () => ({ ok: true }), screenshot, capturePacer: pacer, store: { add: async () => ({ ok: true, committed: true }) }, getSession: () => null, setSession: () => {}, addThumb: () => {}, markStale: () => {}, toast: () => {} });
    const [el, ar] = await Promise.all([
      elDeps.capture({ windowId: 1 }),
      arDeps.capture(SESS2, { requestId: "CO" }, EXP),
    ]);
    assert.equal(el.naturalWidth, 1000); assert.equal(ar.naturalWidth, 1000); // same mock screenshot for both paths
    assert.equal(maxActive, 1, "the shared lock must serialize element + area captures");
    assert.ok(shots >= 3, "the quota rejection should have been retried, not surfaced");
  });

  // ---- E4: the raw screenshot wrapper preserves quota, reserves the grant message ----
  const rawRig = (over) => {
    const calls = { direct: 0, broker: 0 };
    const raw = createRawCapture({
      captureVisibleTab: async () => { calls.direct++; if (over.direct) return over.direct(); throw over.directErr; },
      sendMessage: async () => { calls.broker++; return over.broker ? over.broker() : { ok: false }; },
      toImage: async (d) => ({ img: d }),
    });
    return { raw, calls };
  };

  await okA("raw-capture: a quota error is rethrown for the pacer, with NO duplicate broker shot", async () => {
    const r = rawRig({ directErr: new Error("MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND") });
    await assert.rejects(r.raw(1), /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/);
    assert.equal(r.calls.direct, 1); assert.equal(r.calls.broker, 0); // did not double up
  });

  await okA("raw-capture: an access failure falls back to the broker once, then explains the grant", async () => {
    const ok = rawRig({ directErr: new Error("Cannot access contents of the page"), broker: () => ({ ok: true, dataUrl: "d" }) });
    assert.deepEqual(await ok.raw(1), { img: "d" });
    assert.equal(ok.calls.broker, 1);
    const denied = rawRig({ directErr: new Error("Cannot access contents of the page"), broker: () => ({ ok: false, error: "no activeTab" }) });
    await assert.rejects(denied.raw(1), /click the toolbar icon/);
    // a broker that itself hits the quota surfaces as quota, so the pacer can retry
    const brokerQuota = rawRig({ directErr: new Error("Cannot access contents of the page"), broker: () => ({ ok: false, error: "MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND" }) });
    await assert.rejects(brokerQuota.raw(1), /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/);
  });

  await okA("raw-capture: the happy path never touches the broker", async () => {
    const r = rawRig({ direct: () => "shot" });
    assert.deepEqual(await r.raw(1), { img: "shot" });
    assert.equal(r.calls.broker, 0);
  });

  // ---- E3: horizontal coverage — a selection off-screen sideways never saves blank columns ----
  await okA("stitch: a selection extending past one screen sideways is clipped + flagged, not blanked", async () => {
    // rectDoc spans x:[900,1100] but only [0,1000) is visible (scrollX 0, vw 1000)
    const page = { vw: 1000, vh: 800, docW: 2000, docH: 2000, scrollX: 0 };
    const log = []; const reports = []; let persisted = null;
    const ctl = createStitchController({
      validate: async () => null,
      prepare: async () => ({ ok: true, vw: page.vw, vh: page.vh, docW: page.docW, docH: page.docH, scrollX: 0, maxScroll: 0, scrolls: false }),
      scrollTo: async (s, m, y) => ({ ok: true, scrollY: 0, scrollX: 0, vw: page.vw, vh: page.vh, docH: page.docH, maxScroll: 0 }),
      capture: async () => ({ naturalWidth: 2000, naturalHeight: 1600 }),
      makeCanvas: (w, h) => ({ w, h, drawImage() {}, toBlob: async () => ({ size: 9 }) }),
      persist: async (a) => { persisted = a; return { ok: true, committed: true }; },
      finish: async () => { log.push("finish"); }, progress: () => {}, report: (r) => reports.push(r),
    });
    await ctl.run(SESS, { requestId: "H1", mode: "area", rectDoc: { x: 900, y: 100, w: 200, h: 300 }, viewportW: 1000, viewportH: 800 });
    assert.equal(reports.at(-1).ok, true);              // the visible 100px strip is saved...
    assert.equal(reports.at(-1).w, 200);                // 100 CSS px * DPR 2
    assert.equal(reports.at(-1).clipped, true);         // ...and flagged clipped, not silently blanked
    assert.ok(persisted && persisted.crop.clipped === true);
    assert.ok(log.includes("finish"));
  });

  // ---- E5: all-extraction-failed vs image-only vs no-usable-values handoffs ----
  ok("output: a failed extraction is not described as a deliberate image capture", () => {
    const c = compile([imgRef("x", "spine", 0, { status: "failed", reason: "CSP blocked getComputedStyle" })], "b");
    assert.ok(!c.designMd.includes("```yaml"));
    assert.match(c.designMd, /style extraction failed/i);
    assert.match(c.designMd, /REF-01/);
    assert.ok(!/captured as images/.test(c.designMd));   // the key distinction
    assert.match(c.prompt, /extraction FAILED/i);
    assert.match(c.prompt, /as your decisions/);
    const json = JSON.parse(c.specJson);
    assert.deepEqual(json.extractionFailedRefIds, ["REF-01"]);
    assert.equal(json.anyMeasured, false);
  });

  ok("output: deliberate image-only, failed, and no-usable-values read differently", () => {
    const imageOnly = compile([imgRef("a", "spine", 0, { status: "image-only" })], "b");
    assert.match(imageOnly.designMd, /image captures|captured as images/i);
    assert.ok(!/extraction failed/i.test(imageOnly.designMd));

    const mixed = compile([imgRef("a", "spine", 0, { status: "image-only" }), imgRef("b", "palette", 1, { status: "failed", reason: "CSP" })], "b");
    assert.match(mixed.designMd, /captured as (an )?image/i);
    assert.match(mixed.designMd, /extraction FAILED/i);
    assert.match(mixed.designMd, /REF-02/);

    // styles were READ but every value was blank -> "no usable values", not image-only
    const empty = compile([mk("s", "spine", 0, { "font-size": "", color: "", "box-shadow": "" })], "b");
    assert.ok(!empty.designMd.includes("```yaml"));
    assert.match(empty.designMd, /no usable values/i);
    assert.ok(!/captured as images/.test(empty.designMd));
    assert.equal(JSON.parse(empty.specJson).anyMeasured, true);
  });

  // ======================================================================
  // PASS 11 — ROOT CAUSE of "extended area capture never saves".
  // The panel builds the shared pacer with only withLock/readLast/writeLast
  // (no now/sleep). createCapturePacer called deps.now()/deps.sleep() directly,
  // so the FIRST screenshot threw "deps.now is not a function" and every capture
  // aborted before persistence — element AND area. Mocked tests never hit it
  // because every rig injected a clock. These checks reproduce the panel wiring.
  // ======================================================================
  await okA("capture pacer: a capture completes when wired like the panel (no now/sleep injected)", async () => {
    let stored = 0;
    const pacer = createCapturePacer({                 // EXACTLY the panel's shape
      withLock: (fn) => fn(),
      readLast: async () => stored,
      writeLast: async (t) => { stored = t; },
    });
    const img = await pacer.capture(async () => ({ naturalWidth: 10, naturalHeight: 10 }));
    assert.equal(img.naturalWidth, 10);                // regression: previously threw "deps.now is not a function"
    const img2 = await pacer.capture(async () => ({ naturalWidth: 20, naturalHeight: 20 })); // second shot paces off the default clock
    assert.equal(img2.naturalWidth, 20);
  });

  await okA("stitch end-to-end: the panel-wired pacer saves crop + metadata, and it survives a re-read", async () => {
    const crops = new Map(); let meta = [];
    const mkStore = (onChange) => createTrayStore({
      putCrop: async (id, b) => crops.set(id, b), deleteCrop: async (id) => crops.delete(id),
      loadMeta: async () => meta.map((m) => ({ ...m })), saveMeta: async (t) => { meta = t.map((m) => ({ ...m })); },
      withLock: inMemoryMutex().withLock, onChange: onChange || (() => {}),
    });
    const store = mkStore();
    await store.load();
    // the shared capture coordinator built EXACTLY like sidepanel.js (no now/sleep)
    const pacer = createCapturePacer({ withLock: (fn) => fn(), readLast: async () => 0, writeLast: async () => {} });
    const page = { vw: 1000, vh: 800, docH: 3000 };
    const liveScroll = { scrollY: 0 };
    const sess = { tabId: 1, windowId: 1, frameId: 0, url: "https://x.com/" };
    const chrome = {
      tabs: {
        query: async () => [{ id: 1, windowId: 1, url: "https://x.com/" }],
        sendMessage: async (_t, m) => {
          if (m.type === "DC_CONFIRM") return { requestId: m.requestId, w: page.vw, h: page.vh };
          if (m.type === "DC_CONFIRM_SCROLL") return { ok: true, scrollX: 0, scrollY: liveScroll.scrollY, vw: page.vw, vh: page.vh, docH: page.docH };
          return { ok: true };
        },
      },
      storage: { local: { get: async () => ({}), set: async () => {} } },
    };
    let staled = 0, thumbed = null;
    const sdeps = createStitchDeps({
      chrome, confirmActive: () => ({ ok: true }),
      screenshot: async () => ({ naturalWidth: 2000, naturalHeight: 1600 }),
      capturePacer: pacer, store,
      getSession: () => sess, setSession: () => {}, addThumb: (id) => { thumbed = id; }, markStale: () => { staled++; }, toast: () => {},
    });
    const reports = [];
    const ctl = createStitchController({
      ...sdeps,
      prepare: async () => ({ ok: true, vw: page.vw, vh: page.vh, docW: 1000, docH: page.docH, scrollX: 0, maxScroll: page.docH - page.vh, scrolls: true }),
      scrollTo: async (_s, _m, y) => { liveScroll.scrollY = Math.min(y, page.docH - page.vh); return { ok: true, scrollX: 0, scrollY: liveScroll.scrollY, vw: page.vw, vh: page.vh, docH: page.docH, maxScroll: page.docH - page.vh }; },
      makeCanvas: (w, h) => ({ w, h, drawImage() {}, toBlob: async () => ({ size: 4242 }) }), // document/canvas unavailable in node
      report: (r) => reports.push(r),
    });
    await ctl.run(sess, { requestId: "E2E", mode: "area", rectDoc: { x: 0, y: 0, w: 400, h: 1600 }, viewportW: 1000, viewportH: 800 });
    assert.equal(reports.at(-1).ok, true, "capture should save: " + (reports.at(-1).reason || ""));
    assert.equal(staled, 1); assert.ok(thumbed);                 // marked stale + thumb cached only after commit
    assert.equal(meta.length, 1); assert.ok(crops.has(meta[0].id)); // crop + metadata both persisted
    // reopen: a fresh store reads the metadata and the crop is still retrievable
    const reopened = await mkStore().load();
    assert.equal(reopened.tray.length, 1);
    assert.ok(crops.has(reopened.tray[0].id), "crop must survive a panel reopen");
  });

  await okA("stitch end-to-end: a storage failure reports an error and leaves NO dangling metadata", async () => {
    let meta = [];
    const store = createTrayStore({
      putCrop: async () => { throw new Error("QuotaExceededError"); }, // IndexedDB write fails
      deleteCrop: async () => {}, loadMeta: async () => meta.map((m) => ({ ...m })),
      saveMeta: async (t) => { meta = t.map((m) => ({ ...m })); }, withLock: inMemoryMutex().withLock, onChange: () => {},
    });
    const pacer = createCapturePacer({ withLock: (fn) => fn(), readLast: async () => 0, writeLast: async () => {} });
    const sess = { tabId: 1, windowId: 1, frameId: 0, url: "https://x.com/" };
    const chrome = { tabs: { query: async () => [{ id: 1, windowId: 1, url: "https://x.com/" }], sendMessage: async (_t, m) => (m.type === "DC_CONFIRM" ? { requestId: m.requestId, w: 1000, h: 800 } : m.type === "DC_CONFIRM_SCROLL" ? { ok: true, scrollX: 0, scrollY: 0, vw: 1000, vh: 800, docH: 2000 } : { ok: true }) }, storage: { local: { get: async () => ({}), set: async () => {} } } };
    const reports = [];
    const sdeps = createStitchDeps({ chrome, confirmActive: () => ({ ok: true }), screenshot: async () => ({ naturalWidth: 2000, naturalHeight: 1600 }), capturePacer: pacer, store, getSession: () => sess, setSession: () => {}, addThumb: () => {}, markStale: () => {}, toast: () => {} });
    const ctl = createStitchController({
      ...sdeps,
      prepare: async () => ({ ok: true, vw: 1000, vh: 800, docW: 1000, docH: 2000, scrollX: 0, maxScroll: 1200, scrolls: true }),
      scrollTo: async (_s, _m, y) => ({ ok: true, scrollX: 0, scrollY: Math.min(y, 1200), vw: 1000, vh: 800, docH: 2000, maxScroll: 1200 }),
      makeCanvas: (w, h) => ({ w, h, drawImage() {}, toBlob: async () => ({ size: 1 }) }),
      report: (r) => reports.push(r),
    });
    await ctl.run(sess, { requestId: "E3", mode: "area", rectDoc: { x: 0, y: 0, w: 400, h: 300 }, viewportW: 1000, viewportH: 800 });
    assert.equal(reports.at(-1).ok, false);                      // surfaced, not silently dropped
    assert.match(reports.at(-1).reason, /crop image/i);
    assert.equal(meta.length, 0);                                // no metadata pointing at a missing crop
  });

  // ---- Part C: the rendered-measurement wrapper is well-formed (pure half) ----
  ok("eval measure-rendered: wrap injects a computed-style probe before </body>", () => {
    const out = wrapMeasure("<html><body><h1>Hi</h1></body></html>", { probes: { heading: "h1", cta: "button.primary" } });
    assert.ok(out.includes("__dc_measure"));                 // the DOM slot the CLI reads back
    assert.ok(out.indexOf("__dc_measure") < out.indexOf("</body>")); // injected inside body
    assert.ok(out.includes("getComputedStyle"));             // reads RENDERED styles, not substrings
    assert.ok(out.includes("fonts") && out.includes("requestAnimationFrame")); // bounded font + layout wait
    assert.ok(out.includes('"h1"') && out.includes('"button.primary"')); // the probe selectors
    assert.ok(MEASURE_PROPS.includes("font-family") && MEASURE_PROPS.includes("color"));
    assert.ok(/declared stack/i.test(FONT_CAVEAT));          // the font-family limitation is stated
    assert.ok(wrapMeasure("<div>x</div>", { probes: { x: "div" } }).includes("__dc_measure")); // no </body> -> appended
  });

  // ---- Part C: the local server preserves the candidate's asset base (the fix) ----
  await okA("eval measure-rendered: serveCandidate serves wrapped HTML + resolves sibling assets", async () => {
    const candidate = fileURLToPath(new URL("../eval/cases/_assets-check/index.html", import.meta.url));
    const srv = await serveCandidate(candidate, { probes: { heading: "h1", cta: "button.primary", surface: ".card" } });
    try {
      const page = await (await fetch(srv.url)).text();
      assert.ok(page.includes("__dc_measure"));              // the candidate route returns the WRAPPED html
      assert.ok(page.includes('href="style.css"'));          // relative asset refs are untouched (same base)
      const cssRes = await fetch(`http://127.0.0.1:${srv.port}/style.css`);
      assert.equal(cssRes.status, 200);
      assert.match(cssRes.headers.get("content-type"), /text\/css/);
      assert.match(await cssRes.text(), /--brand:\s*#2f4c8b/);// the REAL sibling CSS is served, not a temp-dir miss
      const svgRes = await fetch(`http://127.0.0.1:${srv.port}/logo.svg`);
      assert.equal(svgRes.status, 200); assert.match(svgRes.headers.get("content-type"), /svg/);
      assert.equal((await fetch(`http://127.0.0.1:${srv.port}/missing.css`)).status, 404); // honest about a missing asset
      // a traversal attempt must not leak a file outside the root (403 refused, or
      // 404 once the URL layer has already collapsed the dot-segments) — never 200.
      const esc = await fetch(`http://127.0.0.1:${srv.port}/..%2f..%2f..%2fetc%2fpasswd`);
      assert.ok(esc.status === 403 || esc.status === 404, "traversal status was " + esc.status);
    } finally { await srv.close(); }
  });

  // ---- Part C: authoritative scoring compares MEASURED values, with tolerances ----
  ok("eval score: measured-vs-expected with color ΔE, px tolerance, declared font stack", () => {
    assert.equal(scoreProp("color", "#2f4c8b", "rgb(47, 76, 139)", {}).ok, true);        // same color, different notation
    assert.equal(scoreProp("color", "#2f4c8b", "rgb(200, 20, 20)", {}).ok, false);       // far color fails
    assert.equal(scoreProp("border-top-left-radius", "10px", "11px", { px: 2 }).ok, true); // within tolerance
    assert.equal(scoreProp("border-top-left-radius", "10px", "40px", { px: 2 }).ok, false);
    assert.equal(scoreProp("font-family", "Inter", 'Inter, system-ui, sans-serif', {}).ok, true); // declared stack contains it
    assert.equal(scoreProp("font-family", "Playfair Display", 'Inter, sans-serif', {}).ok, false);
    assert.equal(scoreProp("display", "flex", "block", {}).ok, false);                   // exact for the rest
    assert.equal(scoreProp("color", "#2f4c8b", null, {}).ok, false);                     // a missing measurement never passes
    assert.ok(colorDeltaE("#000000", "#000000") < 1 && colorDeltaE("#000", "#fff") > 50);
  });

  ok("eval score: a value only present as source text (never measured) cannot score — unlike substring matching", () => {
    // measure-rendered reads getComputedStyle, so the decoy comment "#ff0000 Playfair 72px"
    // in the fixture is invisible here; score only sees MEASURED values.
    const measured = { measured: { heading: { "font-family": "Inter, system-ui, sans-serif", color: "rgb(26, 26, 26)" } } };
    const expected = { heading: { "font-family": "Playfair Display", color: "#ff0000" } };
    const r = scoreAll(measured, expected, {});
    assert.equal(r.pass, 0); assert.equal(r.fail, 2);        // the decoy earns nothing
    assert.match(r.note, /declared stack/);
    const good = scoreAll({ measured: { heading: { "font-family": "Inter", color: "rgb(26,26,26)" } } }, { heading: { "font-family": "Inter", color: "#1a1a1a" } }, {});
    assert.equal(good.pass, 2);
  });


  await okA("eval server: relative paths resolve sibling CSS", async () => {
    const srv = await serveCandidate("eval/cases/_assets-check/index.html");
    try { assert.equal((await fetch(new URL("style.css", srv.url))).status, 200); } finally { await srv.close(); }
  });
  await okA("eval renderer: child process can fetch from the parent HTTP server", async () => {
    if (process.platform === "win32") return;
    const { tmpdir } = await import("node:os"), { join } = await import("node:path");
    const dir = fs.mkdtempSync(join(tmpdir(), "dc-child-test-")), executable = join(dir, "chrome-stub");
    fs.writeFileSync(executable, `#!/usr/bin/env node\n(async()=>{const u=process.argv.at(-1);const h=await(await fetch(u)).text();if(!h.includes('getComputedStyle')||(await fetch(new URL('style.css',u))).status!==200)process.exit(2);console.log('<script type="application/json" id="__dc_measure">'+JSON.stringify({measured:{heading:{color:'rgb(26,26,26)'}},assetsFailed:[],fontsReady:true})+'</script>');})();\n`);
    fs.chmodSync(executable, 0o700);
    try { const result=await measure("eval/cases/_assets-check/index.html", {heading:"h1"}, {chrome:executable}); assert.equal(result.measured.heading.color,"rgb(26,26,26)"); }
    finally { fs.rmSync(dir,{recursive:true,force:true}); }
  });
  ok("eval scorer: units, family names, opacity, templates, and asset failures are handled honestly", () => {
    assert.equal(scoreProp("font-size","1em","1px").ok,false);
    assert.equal(scoreProp("font-family","Arial",'"Arial Black", serif').ok,false);
    assert.equal(scoreProp("background-color","#000000","rgba(0,0,0,0)").ok,false);
    assert.equal(scoreProp("color","#fff","rgb(255 255 255)").ok,true);
    assert.equal(scoreProp("gap","normal","normal").ok,true);
    assert.throws(()=>scoreProp("gap","2px","2px",{px:-1}),/Tolerances/);
    assert.throws(()=>scoreAll({measured:{}},{heading:{color:"<fill from spec>"}}),/Fill the expected/);
    const expected={_note:"metadata",heading:{color:"#fff"}};
    assert.equal(scoreAll({measured:{heading:{color:"#fff"}}},expected).total,1);
    assert.equal(scoreAll({measured:{heading:{color:"#fff"}},assetsFailed:["broken.css"]},expected).valid,false);
  });
  await okA("raw capture: decode and non-permission errors never trigger duplicate screenshots", async () => {
    let broker=0;
    const raw=createRawCapture({captureVisibleTab:async()=>"png",sendMessage:async()=>{broker++;},toImage:async()=>{throw Error("decode failed");}});
    await assert.rejects(raw(1),/decode failed/);assert.equal(broker,0);
    const failed=createRawCapture({captureVisibleTab:async()=>{throw Error("No window with id 123");},sendMessage:async()=>{broker++;},toImage:async()=>{}});
    await assert.rejects(failed(123),/No window/);assert.equal(broker,0);
  });
  function databaseRig(mode) {
    let closed=0,activeTx;
    const db={close(){closed++;},transaction(){
      const t={error:null,objectStore(){return {
        put(){queueMicrotask(()=>t.onabort());return {};},delete(){queueMicrotask(()=>t.onabort());return {};},
        get(){const r={};queueMicrotask(()=>{r.result="stored-value";r.onsuccess();if(mode==="abort")queueMicrotask(()=>t.onabort());});return r;}
      };}};activeTx=t;return t;
    }};
    const ctx={indexedDB:{open(){const r={};queueMicrotask(()=>{r.result=db;r.onsuccess();});return r;}},queueMicrotask,Promise,Error};vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(new URL("../lib/db.js",import.meta.url),"utf8").replace(/export /g,"")+"\nglobalThis.api={putCrop,getCrop,deleteCrop};",ctx);
    return {api:ctx.api,closed:()=>closed,transaction:()=>activeTx};
  }
  for(const op of ["putCrop","getCrop","deleteCrop"]) await okA(`database: ${op} rejects transaction abort and closes its connection`,async()=>{
    const rig=databaseRig("abort");
    await assert.rejects(Promise.race([rig.api[op]("id","blob"),new Promise((_,r)=>setTimeout(()=>r(Error("test deadline")),100))]),/transaction was aborted/);
    assert.equal(rig.closed(),1);
  });
  await okA("database: read waits for transaction completion",async()=>{
    const rig=databaseRig("hold");let settled=false;const read=rig.api.getCrop("id").then(v=>{settled=true;return v;});
    await new Promise(r=>setImmediate(r));assert.equal(settled,false);rig.transaction().oncomplete();assert.equal(await read,"stored-value");assert.equal(rig.closed(),1);
  });

  await okA("capture persistence: an unencoded image never creates metadata",async()=>{
    let adds=0;const deps=createCaptureDeps({chrome:{},store:{add:async()=>{adds++;}},addThumb(){},markStale(){}});
    const r=await deps.persist({session:{},msg:{},crop:{blob:null,w:10,h:10}});
    assert.equal(r.committed,false);assert.match(r.reason,/encoded/);assert.equal(adds,0);
  });
  ok("tokens: image-only area has an actionable empty view and preserves missing JSON", () => {
    const c = compile([{id:"area",role:"component",sourceUrl:"https://example.com",mode:"area",tokens:null,measurement:{status:"image-only"}}], "b");
    const view = tokenPresentation(c.resolved);
    assert.equal(view.kind,"image-only"); assert.equal(view.available.length,0);
    assert.match(view.message,/Pick element/); assert.ok(view.missing.length>20);
    assert.equal(JSON.parse(c.specJson).tokens.typography["font-size"].unavailable,true);
  });
  ok("tokens: measured CSS excluded by roles is diagnosed without silently changing precedence", () => {
    const measured=mk("measured","component",1,{"font-size":"32px",color:"rgb(1, 2, 3)"});
    const area={id:"area",role:"spine",order:0,sourceUrl:"https://example.com",tokens:null};
    const c=compile([area,measured],"b"),view=tokenPresentation(c.resolved);
    assert.equal(view.kind,"roles");assert.equal(view.candidates[0].sourceId,"measured");
    assert.equal(c.resolved.tokens.typography["font-size"].unavailable,true);
    assert.match(c.prompt,/chosen base and override roles supply no usable values/); assert.ok(c.resolved.warnings.some(w=>w.includes("measured on another reference")));
    area.role="component";measured.role="spine";
    assert.equal(tokenPresentation(compile([area,measured],"b").resolved).available.find(r=>r.prop==="font-size").value,"32px");
  });
  ok("tokens: failed extraction is distinguished from a saved area image", () => {
    const c=compile([{id:"failed",sourceUrl:"https://example.com",tokens:null,measurement:{status:"failed",reason:"denied"}}],"b");
    assert.equal(tokenPresentation(c.resolved).kind,"failed");
  });
  ok("tokens: blank computed styles do not offer a useless base candidate", () => {
    const view=tokenPresentation(compile([mk("blank","component",0,{"font-size":" "})],"b").resolved);
    assert.equal(view.kind,"empty");assert.deepEqual(view.candidates,[]);
  });
  ok("tokens: measured none and zero survive the available-values filter", () => {
    const view=tokenPresentation(compile([mk("m","component",0,{"box-shadow":"none","padding-top":"0px"})],"b").resolved);
    assert.equal(view.kind,"measured");assert.equal(view.available.find(r=>r.prop==="box-shadow").value,"none");
    assert.equal(view.available.find(r=>r.prop==="padding-top").value,"0px");
    assert.ok(view.missing.length>0);
  });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
