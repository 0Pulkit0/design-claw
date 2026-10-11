// Phase 4 — color-distance utility. NOT the authoritative token-accuracy scorer.
//
// DEPRECATED FOR SCORING: this script matched a color / font / padding anywhere in
// the output HTML (substring). That is unsound — a value in a comment or an unused
// rule earns a "present" even though the browser never applied it (e.g. a stray
// "#ff0000 Playfair 24px" comment would score a perfect hit). The authoritative
// token-accuracy path is now:
//     eval/measure-rendered.mjs  (render -> getComputedStyle on named probes)
//   | eval/score.mjs             (compare measured vs expected, with tolerances)
// Use those for any reported result. The ΔE helper here (CIEDE2000 via culori, or
// CIE76 fallback) is kept and re-exported for score.mjs / ad-hoc color checks; the
// HTML-substring presence output below runs only under --unsafe-substring and is
// labelled non-authoritative so it can never be mistaken for a measured result.
//
// Usage (diagnostic only): node eval/metrics.mjs <output.html> <accentColor> --unsafe-substring
import { readFileSync } from "node:fs";

let culoriDE = null, culoriParse = null;
try {
  const culori = await import("culori");
  culoriDE = culori.differenceCiede2000();
  culoriParse = culori.parse;
} catch { /* CIE76 fallback below */ }

function parseColor(s) {
  s = String(s).trim();
  if (s[0] === "#") {
    let h = s.slice(1);
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) { const p = m[1].split(/[,\s/]+/).map(Number); return [p[0], p[1], p[2]]; }
  return null;
}
const srgbLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function toLab([r, g, b]) {
  r = srgbLin(r); g = srgbLin(g); b = srgbLin(b);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function deltaE(a, b) {
  if (culoriDE && culoriParse) { try { return culoriDE(culoriParse(a), culoriParse(b)); } catch {} }
  const la = toLab(parseColor(a)), lb = toLab(parseColor(b));
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}
function extractColors(text) {
  return [...(text.match(/#[0-9a-fA-F]{3,8}\b/g) || []), ...(text.match(/rgba?\([^)]*\)/gi) || [])];
}
const grade = (de) => (de < 2 ? "excellent" : de < 10 ? "good" : de < 25 ? "drifted" : "lost");
export { deltaE, parseColor, grade };

const isMain = process.argv[1] && process.argv[1].endsWith("metrics.mjs");
if (isMain) {
  const argv = process.argv.slice(2);
  const unsafe = argv.includes("--unsafe-substring");
  const [outPath, accent, font, padding] = argv.filter((a) => !a.startsWith("--"));
  if (!outPath) {
    console.error("usage: node eval/metrics.mjs <output.html> <accentColor> [fontName] [paddingPx] --unsafe-substring");
    console.error("NOTE: substring presence is NON-AUTHORITATIVE. For real token accuracy use measure-rendered.mjs + score.mjs.");
    process.exit(1);
  }
  const html = readFileSync(outPath, "utf8");
  const report = { output: outPath, engine: culoriDE ? "culori CIEDE2000" : "fallback CIE76", authoritative: false };
  if (accent) {
    let best = Infinity, hit = null;
    for (const c of extractColors(html)) { if (!parseColor(c)) continue; const d = deltaE(accent, c); if (d < best) { best = d; hit = c; } }
    report.palette = { source: accent, nearestInOutput: hit, deltaE: Number(best.toFixed(2)), verdict: grade(best), caveat: "nearest color found anywhere in source text, not a measured computed value" };
  }
  if (!unsafe && (font || padding)) {
    report.substringChecks = "refused — pass --unsafe-substring to run the deprecated HTML-substring font/padding presence (NON-AUTHORITATIVE; use score.mjs instead)";
  } else if (unsafe) {
    if (font) report.font = { source: font, presentInOutputText: html.toLowerCase().includes(font.toLowerCase()), caveat: "substring in source, NOT a rendered computed style" };
    if (padding) report.spacing = { source: padding, presentInOutputText: html.includes(padding), caveat: "substring in source, NOT a rendered computed style" };
  }
  console.log(JSON.stringify(report, null, 2));
}
