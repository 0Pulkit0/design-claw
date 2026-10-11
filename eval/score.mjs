// Authoritative token-accuracy scoring: compare MEASURED computed styles (from
// eval/measure-rendered.mjs) against EXPECTED values on named target elements,
// with explicit tolerances. This REPLACES the old HTML-substring presence check
// in metrics.mjs, which scored a value found anywhere in the source — even inside
// a comment that never applied. Here a value counts only if the browser actually
// computed it on the probed element.
//
// Comparators by property kind:
//   color      — CIEDE2000 ΔE (culori if installed, else CIE76 Lab) ≤ deltaE
//   length(px) — |measured - expected| ≤ px
//   font-family — the DECLARED stack contains the expected family (case-insensitive).
//                 This proves the intended stack won, NOT which face painted (see
//                 FONT_CAVEAT in measure-rendered.mjs); documented, not asserted away.
//   other      — exact string match (display, text-transform, border-style, …)
//
// Usage:
//   node eval/score.mjs <measured.json> <expected.json> [--deltaE 10] [--px 2]
// expected.json mirrors the probe names:
//   { "heading": { "font-family": "Playfair Display", "color": "#1A1A1A" },
//     "cta": { "background-color": "#2F4C8B", "border-top-left-radius": "10px" } }
import { readFileSync } from "node:fs";

let culoriDE = null, culoriParse = null;
try { const c = await import("culori"); culoriDE = c.differenceCiede2000(); culoriParse = c.parse; } catch { /* CIE76 fallback */ }

const COLOR_PROPS = new Set(["color", "background-color", "border-top-color", "outline-color"]);
const LENGTH_PROPS = new Set(["font-size", "line-height", "letter-spacing", "border-top-left-radius", "border-top-width", "padding-top", "padding-left", "margin-top", "gap"]);

function srgbToLab(r, g, b) {
  const f = (v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
  const [R, G, B] = [f(r), f(g), f(b)];
  let X = R * 0.4124 + G * 0.3576 + B * 0.1805, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = R * 0.0193 + G * 0.1192 + B * 0.9505;
  X /= 0.95047; Z /= 1.08883;
  const g2 = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * g2(Y) - 16, 500 * (g2(X) - g2(Y)), 200 * (g2(Y) - g2(Z))];
}
function parseColor(s) {
  if (!s) return null;
  if (culoriParse) { const p = culoriParse(s); if (p) return p; }
  if (String(s).trim().toLowerCase() === "transparent") return { __rgb: [0, 0, 0], alpha: 0 };
  const m = String(s).match(/^rgba?\(([^)]+)\)$/i);
  if (m) {
    const parts = m[1].trim().split(/\s*[,/]\s*|\s+/).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const rgb = parts.slice(0, 3).map((v) => parseFloat(v) * (v.endsWith("%") ? 2.55 : 1));
    const alpha = parts[3] == null ? 1 : parseFloat(parts[3]) / (parts[3].endsWith("%") ? 100 : 1);
    if (rgb.some((v) => !Number.isFinite(v) || v < 0 || v > 255) || !Number.isFinite(alpha) || alpha < 0 || alpha > 1) return null;
    return { __rgb: rgb, alpha };
  }
  const h = String(s).trim().match(/^#([0-9a-f]{3,8})$/i);
  if (h && [3, 4, 6, 8].includes(h[1].length)) {
    const hex = h[1].length < 5 ? h[1].split("").map((v) => v + v).join("") : h[1];
    const n = parseInt(hex.slice(0, 6), 16);
    return { __rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], alpha: hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1 };
  }
  return null;
}
export function colorDeltaE(a, b) {
  const ca = parseColor(a), cb = parseColor(b);
  if (!ca || !cb) return Infinity;
  // Opacity is part of a measured color. A transparent surface must not get
  // perfect credit for an opaque surface with the same RGB channels.
  if (Math.abs((ca.alpha ?? 1) - (cb.alpha ?? 1)) > 0.01) return Infinity;
  if (culoriDE && !ca.__rgb && !cb.__rgb) return culoriDE(ca, cb);
  const rgb = (c) => c.__rgb || [c.r * 255, c.g * 255, c.b * 255];
  const [l1, a1, b1] = srgbToLab(...rgb(ca)), [l2, a2, b2] = srgbToLab(...rgb(cb));
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2); // CIE76
}
const px = (s) => { const v = String(s).trim(); return /^(?:-?(?:\d+(?:\.\d*)?|\.\d+)px|0)$/.test(v) ? parseFloat(v) : NaN; };
const families = (s) => String(s).split(",").map((v) => v.trim().replace(/^["']|["']$/g, "").toLowerCase());

// Score one property. Returns { prop, expected, measured, ok, metric, delta? }.
export function scoreProp(prop, expected, measured, tol = {}) {
  const deltaE = tol.deltaE == null ? 10 : tol.deltaE;
  const pxTol = tol.px == null ? 2 : tol.px;
  if (![deltaE, pxTol].every((v) => Number.isFinite(v) && v >= 0)) throw new Error("Tolerances must be finite, non-negative numbers.");
  if (measured == null) return { prop, expected, measured: null, ok: false, metric: "missing" };
  if (COLOR_PROPS.has(prop)) { const d = colorDeltaE(expected, measured); return { prop, expected, measured, ok: d <= deltaE, metric: "deltaE", delta: Number.isFinite(d) ? +d.toFixed(2) : null }; }
  if (LENGTH_PROPS.has(prop)) {
    if (["normal", "auto"].includes(String(expected).trim())) return { prop, expected, measured, ok: String(expected).trim() === String(measured).trim(), metric: "exact" };
    const d = Math.abs(px(expected) - px(measured)); return { prop, expected, measured, ok: Number.isFinite(d) && d <= pxTol, metric: "px", delta: Number.isFinite(d) ? +d.toFixed(2) : null };
  }
  if (prop === "font-family") { const want = families(expected), got = families(measured); return { prop, expected, measured, ok: want.length === 1 ? got.includes(want[0]) : JSON.stringify(want) === JSON.stringify(got), metric: "declared-family" }; }
  return { prop, expected, measured, ok: String(expected).trim() === String(measured).trim(), metric: "exact" };
}

// Score every expected property on every probe. measuredJson is the output of
// measure-rendered.mjs ({ measured: { probe: {prop:value} }, missing, ... }).
export function scoreAll(measuredJson, expected, tol = {}) {
  const measured = (measuredJson && measuredJson.measured) || {};
  const rows = [];
  for (const [probe, props] of Object.entries(expected)) {
    if (probe.startsWith("_")) continue;
    if (!props || typeof props !== "object" || Array.isArray(props)) throw new Error(`Expected values for ${probe} must be an object.`);
    for (const [prop, want] of Object.entries(props)) {
      if (typeof want !== "string" || /<[^>]+>/.test(want)) throw new Error(`Fill the expected ${probe}.${prop} from your captured resolved-spec.json before scoring.`);
      rows.push({ probe, ...scoreProp(prop, want, measured[probe] ? measured[probe][prop] : null, tol) });
    }
  }
  const pass = rows.filter((r) => r.ok).length;
  if (!rows.length) throw new Error("Provide at least one expected measured property.");
  const invalid = [];
  if (measuredJson?.assetsFailed?.length) invalid.push("Candidate assets failed to load.");
  if (measuredJson?.fontsReady === false) invalid.push("Font readiness timed out.");
  return { valid: invalid.length === 0, invalid, total: rows.length, pass, fail: rows.length - pass, rows, note: "font-family = declared stack, not the painted face" };
}

const isMain = process.argv[1] && process.argv[1].endsWith("score.mjs");
if (isMain) {
  const args = process.argv.slice(2); const pos = args.filter((a) => !a.startsWith("--"));
  const flag = (n, d) => { const i = args.indexOf("--" + n); return i >= 0 ? +args[i + 1] : d; };
  const [measuredFile, expectedFile] = pos;
  if (!measuredFile || !expectedFile) { console.error("Usage: node eval/score.mjs <measured.json> <expected.json> [--deltaE 10] [--px 2]"); process.exit(2); }
  const out = scoreAll(JSON.parse(readFileSync(measuredFile, "utf8")), JSON.parse(readFileSync(expectedFile, "utf8")), { deltaE: flag("deltaE", 10), px: flag("px", 2) });
  console.log(JSON.stringify(out, null, 2));
  process.exit(out.fail || !out.valid ? 1 : 0);
}
