// Compiler — resolves the role-tagged, ordered tray into ONE canonical resolved
// specification (with provenance), then renders DESIGN.md, the portable prompt,
// and a machine-readable JSON spec from that SAME spec, so measurements and
// precedence agree in every output. Pure and deterministic. The enhancement path
// (enrichWithLLM) only yields an advisory note and can never mutate the spec.
import { CONTRACT, CONTRACT_VERSION } from "./contract.js";
import { renderReferenceCss } from "./design-assets.js";
import { contrastCheck } from "./contrast.js";
import { normalizeGuidance, guidanceLines, referenceIntentLines, DESIGN_SYSTEM_INSTRUCTION } from "./design-guidance.js";

export const POLICY_VERSION = "1.0.0";
const ROLES = ["spine", "type", "palette", "shape", "component"];

// Which computed props each token domain owns, and which role may override it.
const DOMAINS = {
  typography: ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-transform", "font-style"],
  color: ["color", "background-color", "background-image"],
  shape: ["border-radius", "border-top-width", "border-top-style", "border-top-color", "box-shadow", "outline-color"],
  spacing: ["padding-top", "padding-right", "padding-bottom", "padding-left", "margin-top", "margin-bottom", "gap"],
  layout: ["display", "flex-direction", "justify-content", "align-items"],
};
const DOMAIN_ROLE = { typography: "type", color: "palette", shape: "shape", spacing: "spine", layout: "spine" };

const hostOf = (url) => { try { return new URL(url).host; } catch { return url || "source"; } };
export const sanitizeUrl = (url) => { try { const u = new URL(url); return u.origin + u.pathname; } catch { return String(url || "").split(/[?#]/)[0]; } };
// Safe YAML double-quoted scalar: JSON string syntax is valid YAML and escapes
// quotes, backslashes, newlines, and Unicode correctly — no ad-hoc replacement.
const y = (v) => JSON.stringify(v == null ? "" : String(v));
const present = (v) => v != null && String(v).trim() !== "";
const label = (i) => `REF-${String(i + 1).padStart(2, "0")}`;

export function needsSpine(items) {
  return items.length >= 2 && !items.some((i) => i.role === "spine");
}

export function validateItems(items) {
  if (!Array.isArray(items)) throw new Error("Compiler: items must be an array.");
  for (const it of items) {
    if (!it || typeof it !== "object") throw new Error("Compiler: a tray item is malformed (not an object).");
    if (!it.id) throw new Error("Compiler: a tray item is missing an id.");
    if (typeof it.sourceUrl !== "string" || !it.sourceUrl) throw new Error(`Compiler: item ${it.id} is missing a sourceUrl.`);
    if (it.role != null && !ROLES.includes(it.role)) throw new Error(`Compiler: item ${it.id} has unknown role "${it.role}".`);
  }
  const spines = items.filter((i) => i.role === "spine");
  if (spines.length > 1) throw new Error(`Compiler: ${spines.length} spines set — exactly one source may be the spine.`);
  if (items.length >= 2 && spines.length === 0) throw new Error("Compiler: a merge of 2+ sources needs a spine. Set one source's role to spine.");
}
function prov(refOf, source, property, kind) {
  const r = source ? refOf.get(source.id) : null;
  return { ref: r ? r.id : null, role: r ? r.role : null, property, kind };
}
function resolveProp(prop, owner, spine, refOf) {
  const ov = owner?.tokens?.computed?.[prop];
  if (present(ov)) return { value: ov, kind: "observed", provenance: prov(refOf, owner, prop, "observed") };
  if (owner !== spine) {
    const sv = spine?.tokens?.computed?.[prop];
    if (present(sv)) return { value: sv, kind: "fallback", provenance: prov(refOf, spine, prop, "fallback") };
  }
  return { unavailable: true, provenance: prov(refOf, owner || spine, prop, "unavailable") };
}

export function resolve(items) {
  validateItems(items);
  const sorted = [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const refs = sorted.map((it, i) => ({
    id: label(i), sourceId: it.id, role: it.role || "component", note: it.note || "",
    name: String(it.name || '').slice(0, 160), borrow: String(it.borrow || '').slice(0, 2000), avoid: String(it.avoid || '').slice(0, 2000),
    url: sanitizeUrl(it.sourceUrl), host: hostOf(it.sourceUrl), imageFile: `references/${label(i)}.png`,
    clipped: !!it.clipped,
    // What this reference actually contributes, from recorded evidence only.
    measured: !!(it.tokens && it.tokens.computed),
    usablePropertyCount: Object.values(DOMAINS).flat().filter((p) => present(it.tokens?.computed?.[p])).length,
    measurement: it.measurement || (it.tokens && it.tokens.computed ? { status: "measured" } : { status: "image-only" }),
    captureMode: it.mode || null,
    contrast: contrastCheck(it.tokens),
  }));
  const refOf = new Map(sorted.map((it, i) => [it.id, refs[i]]));
  let spine = sorted.find((i) => i.role === "spine") || null;
  let effectiveBaseNote = null;
  if (!spine && sorted.length === 1) {
    spine = sorted[0];
    effectiveBaseNote = `Single source ${refOf.get(spine.id).id} (stored role "${spine.role || "component"}") is used as the effective base specification; its stored role is left unchanged.`;
  }
  const byRole = {};
  for (const it of sorted) if (it.role && it.role !== "spine") (byRole[it.role] ||= []).push(it);
  const ownerFor = (domain) => {
    const role = DOMAIN_ROLE[domain];
    if (role === "spine") return spine;
    return (byRole[role] && byRole[role][0]) || spine; // highest-in-order of the role, else spine base
  };
  const warnings = [];
  const tokens = {};
  const coverage = { expected: 0, observed: 0, fallback: 0, unavailable: 0 };
  for (const [domain, props] of Object.entries(DOMAINS)) {
    const owner = ownerFor(domain);
    tokens[domain] = {};
    for (const prop of props) {
      const rec = resolveProp(prop, owner, spine, refOf);
      coverage.expected += 1;
      if (rec.unavailable) {
        coverage.unavailable += 1;
        warnings.push(sorted.some((it) => present(it.tokens?.computed?.[prop]))
          ? `${domain}.${prop} is unavailable — it was measured on another reference, but the selected roles do not contribute that value.`
          : `${domain}.${prop} is unavailable — no source measured it.`);
      }
      else if (rec.kind === "fallback") coverage.fallback += 1;
      else coverage.observed += 1;
      tokens[domain][prop] = rec;
    }
  }
  const typeOwner = ownerFor("typography");
  const f = typeOwner?.tokens?.fonts;
  tokens.typographyFont = f
    ? { stack: f.stack || "", declaredFamilies: f.families || [], availabilityCandidate: (f.availabilityCandidate ?? f.firstAvailable) || null, method: f.method || "document.fonts.check", verified: false, uncertain: true, provenance: prov(refOf, typeOwner, "font-family", "observed") }
    : null;
  const imageOnlyRefs = refs.filter((r) => !r.measured);
  return {
    policyVersion: POLICY_VERSION, contractVersion: CONTRACT_VERSION,
    refs, spineRefId: spine ? refOf.get(spine.id).id : null, effectiveBaseNote, tokens,
    motion: spine?.tokens?.motion || null, keyframes: spine?.tokens?.keyframes || "", states: spine?.tokens?.states || null,
    warnings, coverage,
    anyMeasured: refs.some((r) => r.measured),
    imageOnlyRefIds: imageOnlyRefs.map((r) => r.id),
    extractionFailedRefIds: imageOnlyRefs.filter((r) => r.measurement && r.measurement.status === "failed").map((r) => r.id),
  };
}
// ---- rendering (all three outputs share these, so they always agree) ----
function precedenceProse(resolved) {
  const spine = resolved.refs.find((r) => r.id === resolved.spineRefId);
  const byRole = {}; for (const r of resolved.refs) (byRole[r.role] ||= []).push(r);
  const dom = { type: "typography", palette: "the exported palette/color", shape: "radii, borders, and shadows" };
  const parts = [];
  if (spine) parts.push(`${spine.id} (${spine.host}) is the spine: it supplies the base measurements and governs structural layout and spacing.`);
  for (const role of ["type", "palette", "shape"]) {
    const g = byRole[role]; if (!g || !g.length) continue;
    parts.push(`${g[0].id} (${g[0].host}) overrides ${dom[role]} only${g.length > 1 ? `, winning over the lower ${role} source${g.length > 2 ? "s" : ""} by tray order` : ""}.`);
  }
  const comps = byRole.component || [];
  if (comps.length) parts.push(`${comps.map((c) => c.id).join(", ")} ${comps.length > 1 ? "are component-pattern references" : "is a component-pattern reference"} and do not override global tokens.`);
  // An override that has no measured styles cannot actually override anything.
  const emptyOverrides = resolved.refs.filter((r) => !r.measured && ["type", "palette", "shape"].includes(r.role));
  if (emptyOverrides.length) parts.push(`${emptyOverrides.map((r) => r.id).join(", ")} ${emptyOverrides.length > 1 ? "hold override roles but have" : "holds an override role but has"} no measured styles, so ${emptyOverrides.length > 1 ? "those domains" : "that domain"} falls back to the spine — use ${emptyOverrides.length > 1 ? "those images" : "that image"} as visual guidance only.`);
  parts.push("Explicit role overrides beat the spine's defaults inside their own domains; elsewhere the spine's base holds. Where a chosen source lacks a measurement, the spine's measured value is used as a recorded fallback; if nothing measured it, the value is marked unavailable, not invented.");
  return parts.join(" ");
}

function tokenYaml(resolved) {
  const { tokens, motion, keyframes, states } = resolved;
  const out = [];
  // Unmeasured properties are OMITTED, not listed as null. A reader (human or
  // model) should see what was actually captured; the complete list of missing
  // properties with provenance stays in resolved-spec.json and the Tokens view.
  const emit = (head, domain, keys, extra) => {
    const lines = [];
    for (const [k, prop] of keys) {
      const rec = tokens[domain]?.[prop];
      if (!rec || rec.unavailable) continue;
      lines.push(`  ${k}: ${y(rec.value)}${rec.kind === "fallback" ? "   # spine fallback" : ""}`);
    }
    if (extra && extra.length) lines.push(...extra);
    if (!lines.length) return; // never emit an empty domain header
    out.push(`${head}:`, ...lines);
  };
  const fontExtra = [];
  if (tokens.typographyFont && tokens.typographyFont.availabilityCandidate) {
    fontExtra.push(`  availability_candidate: ${y(tokens.typographyFont.availabilityCandidate)}   # unverified: document.fonts.check only, not a rendered-font identification`);
  }
  emit("typography", "typography", [["font_family", "font-family"], ["size", "font-size"], ["weight", "font-weight"], ["line_height", "line-height"], ["letter_spacing", "letter-spacing"], ["text_transform", "text-transform"], ["font_style", "font-style"]], fontExtra);
  emit("color", "color", [["text", "color"], ["background", "background-color"], ["background_image", "background-image"]]);
  emit("shape", "shape", [["radius", "border-radius"], ["border_width", "border-top-width"], ["border_style", "border-top-style"], ["border_color", "border-top-color"], ["shadow", "box-shadow"]]);
  emit("spacing", "spacing", [["padding_top", "padding-top"], ["padding_right", "padding-right"], ["padding_bottom", "padding-bottom"], ["padding_left", "padding-left"], ["margin_top", "margin-top"], ["margin_bottom", "margin-bottom"], ["gap", "gap"]]);
  emit("layout", "layout", [["display", "display"], ["flex_direction", "flex-direction"], ["justify_content", "justify-content"], ["align_items", "align-items"]]);
  const hasTransition = !!(motion && present(motion.transition) && motion.transition !== "all 0s ease 0s" && motion.transition !== "none");
  const hasAnim = !!(motion && motion.animationName && motion.animationName !== "none");
  if (hasTransition || hasAnim) {
    out.push("motion:   # from spine");
    if (hasTransition) out.push(`  transition: ${y(motion.transition)}`);
    if (motion.animation && motion.animation !== "none") out.push(`  animation: ${y(motion.animation)}`);
    if (keyframes) out.push(`  keyframes: ${y(keyframes)}`);
  }
  if (states && (states.hover || states.focus)) {
    out.push("states:   # from spine");
    for (const k of ["hover", "focus"]) if (states[k]) out.push(`  ${k}: ${y(Object.entries(states[k]).map(([p, v]) => `${p}: ${v}`).join("; "))}`);
  }
  return out;
}

const MEASURED_LABEL = (r) => (r.measured ? "Styles measured" : "Image only");

// One concise statement of what was and was not measured, replacing a repetitive
// per-property warning list, plus the rule the receiving assistant needs: an
// unmeasured property is unconstrained, and filling it in is a DECISION, not a
// captured fact.
function coverageLines(resolved) {
  const c = resolved.coverage || { expected: 0, observed: 0, fallback: 0, unavailable: 0 };
  const measured = c.observed + c.fallback;
  const lines = [];
  lines.push(`Measured ${measured} of ${c.expected} expected properties${c.fallback ? ` (${c.fallback} of them supplied by the spine as a recorded fallback)` : ""}.${c.unavailable ? ` ${c.unavailable} were not supplied by the selected role sources and are omitted above rather than shown as empty.` : ""}`);
  if (resolved.imageOnlyRefIds && resolved.imageOnlyRefIds.length) {
    const failed = resolved.extractionFailedRefIds || [];
    const deliberate = resolved.imageOnlyRefIds.filter((id) => !failed.includes(id));
    if (deliberate.length) lines.push(`${deliberate.join(", ")} ${deliberate.length === 1 ? "is an image-only reference" : "are image-only references"}: visual guidance only, no measured CSS.`);
    if (failed.length) lines.push(`${failed.join(", ")} ${failed.length === 1 ? "was" : "were"} meant to be measured but style extraction failed — treat ${failed.length === 1 ? "it" : "them"} as an image, and capture the element again if you need its values.`);
  }
  lines.push("Properties not listed were not measured. They are unconstrained by measurement: infer them from the reference images and ordinary craft, and present such choices as your decisions — never as captured facts. The complete list of unmeasured properties, with per-value provenance, is in resolved-spec.json.");
  return lines;
}

const SHARED_TAIL = "Treat the reference images as visual direction and present any concrete values you choose as your decisions, not captured facts. To get measured values, capture a DOM element (not an area): the picker reads real computed styles from it.";

// The handoff shown when there is no token block, distinguishing WHY there are no
// tokens: a deliberate image/area capture, a FAILED extraction (not the user's
// choice — it must say so and point at re-capture), an extraction that ran but
// returned no usable values, or a mix. Returns { heading, text } so DESIGN.md can
// title the section honestly and the prompt can use the prose.
function emptyHandoff(resolved) {
  const failed = resolved.extractionFailedRefIds || [];
  const imageOnly = resolved.imageOnlyRefIds || [];
  const deliberate = imageOnly.filter((id) => !failed.includes(id));
  // anyMeasured means a source exposed computed styles, yet the token block came
  // out empty -> the values were all blank. That is different from image-only.
  if (resolved.anyMeasured) {
    if (resolved.refs.some((r) => r.usablePropertyCount > 0)) {
      return { heading: "Visual direction only (measured references excluded by roles)",
        text: `Some references have measured CSS, but the chosen base and override roles supply no usable values. Set a measured reference as the base, or assign a measured reference to its typography, color, or shape role, then compile again. ${SHARED_TAIL}` };
    }
    return { heading: "Visual direction only (styles read, no usable values)",
      text: `The references were read for styles, but no usable values came back — nothing non-empty was recorded. ${SHARED_TAIL}` };
  }
  const parts = [];
  if (failed.length && !deliberate.length) {
    parts.push(`Style extraction FAILED for ${failed.length === 1 ? "this reference" : "every reference"} (${failed.join(", ")}), so there are no measured values — this was not a deliberate image capture.`);
    return { heading: "Visual direction only (style extraction failed)", text: `${parts.join(" ")} ${SHARED_TAIL}` };
  }
  if (deliberate.length && !failed.length) {
    parts.push("None of these references supplied measured CSS — they were captured as images.");
    return { heading: "Visual direction only (image captures)", text: `${parts.join(" ")} ${SHARED_TAIL}` };
  }
  // mix of deliberate image-only and failed extraction
  parts.push(`No measured CSS: ${deliberate.join(", ")} ${deliberate.length === 1 ? "was" : "were"} captured as ${deliberate.length === 1 ? "an image" : "images"}, and style extraction FAILED for ${failed.join(", ")} (not a deliberate image capture — re-capture ${failed.length === 1 ? "that element" : "those elements"} to measure).`);
  return { heading: "Visual direction only (nothing measured)", text: `${parts.join(" ")} ${SHARED_TAIL}` };
}
export function renderDesignMd(resolved, meta = {}) {
  const date = meta.date || new Date().toISOString().slice(0, 10);
  const lines = ["---", "generator: Design Compositor", `policy_version: ${resolved.policyVersion}`, `contract_version: ${resolved.contractVersion}`, `date: ${date}`, "references:"];
  for (const r of resolved.refs) lines.push(`  - id: ${r.id}\n    role: ${r.role}\n    url: ${y(r.url)}\n    name: ${y(r.name)}\n    note: ${y(r.note)}\n    borrow: ${y(r.borrow)}\n    avoid: ${y(r.avoid)}\n    measurement: ${r.measured ? "measured" : (r.measurement && r.measurement.status) || "image-only"}\n    image: ${r.imageFile}`);
  lines.push("---", "", "# Compiled design system", "", "> Plain self-describing markdown — NOT Google's DESIGN.md schema.", "", "## Precedence", precedenceProse(resolved), "");
  if (resolved.effectiveBaseNote) lines.push(`> ${resolved.effectiveBaseNote}`, "");
  lines.push("## References");
  for (const r of resolved.refs) lines.push(`- **${r.id}** · ${r.role} — ${r.host} — ${MEASURED_LABEL(r)}${r.note ? ` — ${r.note}` : ""}${r.clipped ? " · visible part only" : ""} → \`${r.imageFile}\``);
  lines.push("");
  const yaml = tokenYaml(resolved);
  if (yaml.length) {
    lines.push("## Tokens (measured — DOM/CSS, never vision)", "```yaml", ...yaml, "```", "");
    lines.push("_Spacing/layout are **observed** from the spine element, not a validated system scale. Font availability is a **candidate**, not a verified rendered face._", "");
    lines.push("## Coverage", ...coverageLines(resolved), "");
  } else {
    const h = emptyHandoff(resolved);
    lines.push(`## ${h.heading}`, h.text, "");
  }
  lines.push("## Build brief", (meta.brief || "").trim() || "_(no brief given)_", "", ...guidanceLines(meta.guidance), "", "## Reference intent", ...referenceIntentLines(resolved.refs), "", `## Contract (protected · v${resolved.contractVersion})`, CONTRACT, "");
  if (meta.creativeDirection) lines.push("## Creative direction (advisory — model-generated, non-canonical)", meta.creativeDirection.trim(), "");
  return lines.join("\n");
}

export function renderPrompt(resolved, meta = {}) {
  const lines = [];
  if (meta.persona?.trim()) lines.push(meta.persona.trim(), "");
  lines.push(`Build: ${(meta.brief || "").trim() || "(describe your project)"}`);
  if (meta.perRunNote?.trim()) lines.push(`For this run: ${meta.perRunNote.trim()}`);
  lines.push('', 'Product direction:', ...guidanceLines(meta.guidance), '', 'Reference intent:', ...referenceIntentLines(resolved.refs));
  lines.push("", "Design system (merged from the references below):", precedenceProse(resolved), "");
  if (resolved.effectiveBaseNote) lines.push(resolved.effectiveBaseNote, "");
  const yaml = tokenYaml(resolved);
  if (yaml.length) {
    lines.push("Measured tokens (authoritative — do not alter):", "```yaml", ...yaml, "```", "");
    lines.push(...coverageLines(resolved), "");
  } else {
    lines.push(emptyHandoff(resolved).text, "");
  }
  lines.push("References:");
  for (const r of resolved.refs) lines.push(`- ${r.id} (${r.role}) — ${r.host} — ${MEASURED_LABEL(r)}${r.note ? ` — ${r.note}` : ""}${r.clipped ? " — visible part only" : ""} — image: ${r.imageFile}`);
  lines.push("", CONTRACT, "", 'Design and implementation approach:', DESIGN_SYSTEM_INSTRUCTION, "", `Attach the ${resolved.refs.length} reference image${resolved.refs.length === 1 ? "" : "s"} from the exported references/ folder (filenames above). They are NOT inlined in this prompt.`);
  if (meta.creativeDirection) lines.push("", "Creative direction (advisory — model-generated, non-canonical; do not override measured values):", meta.creativeDirection.trim());
  return lines.join("\n");
}
export function renderSpecJson(resolved, meta = {}) {
  return JSON.stringify({
    generator: "Design Compositor", policyVersion: resolved.policyVersion, contractVersion: resolved.contractVersion,
    date: meta.date || new Date().toISOString().slice(0, 10),
    brief: (meta.brief || "").trim(), persona: (meta.persona || "").trim() || null, perRunNote: (meta.perRunNote || "").trim() || null,
    guidance: normalizeGuidance(meta.guidance),
    effectiveBaseNote: resolved.effectiveBaseNote, spineRefId: resolved.spineRefId,
    references: resolved.refs, tokens: resolved.tokens, motion: resolved.motion, keyframes: resolved.keyframes || null, states: resolved.states,
    // The concise exports omit unmeasured properties; the canonical record keeps
    // every one of them, with provenance, so nothing is lost by the omission.
    coverage: resolved.coverage, anyMeasured: resolved.anyMeasured,
    imageOnlyRefIds: resolved.imageOnlyRefIds, extractionFailedRefIds: resolved.extractionFailedRefIds,
    warnings: resolved.warnings,
    enhancement: meta.creativeDirection ? { status: "applied", authority: "advisory", creativeDirection: meta.creativeDirection } : { status: "none" },
  }, null, 2);
}

export function compile(items, brief, opts = {}) {
  const resolved = resolve(items);
  const meta = { brief, persona: opts.persona || "", perRunNote: opts.perRunNote || "", guidance: normalizeGuidance(opts.guidance), date: opts.date };
  return { resolved, meta, designMd: renderDesignMd(resolved, meta), prompt: renderPrompt(resolved, meta), specJson: renderSpecJson(resolved, meta), referenceCss: renderReferenceCss(items, resolved), refs: resolved.refs, warnings: resolved.warnings, enhanced: false };
}

// Re-render every output with an advisory creative-direction block appended. The
// canonical spec/measurements/precedence/contract are regenerated from `resolved`
// unchanged, so enhancement provably cannot mutate them.
export function withCreativeDirection(compiled, creativeDirection) {
  const meta = { ...compiled.meta, creativeDirection };
  return { ...compiled, meta, designMd: renderDesignMd(compiled.resolved, meta), prompt: renderPrompt(compiled.resolved, meta), specJson: renderSpecJson(compiled.resolved, meta), enhanced: true };
}

const DIRECTION_SYSTEM = [
  "You write a specific creative-direction note for the supplied product, audience and reference intent. State a compositional choice, a primary-action hierarchy and one concrete way to reconcile the sources. Avoid generic adjectives and invented product features.",
  "You NEVER restate, change, or invent measured values (hex, px, fonts). Output prose only — no code, YAML, or a full prompt.",
  "Distinguish operational apps from marketing pages. Respect Borrow and Avoid notes, measured fonts and role precedence. Do not impose a new aesthetic unrelated to the references.",
].join(" ");

function validateDirection(text) {
  if (typeof text !== "string") return null;
  let t = text.trim().replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  if (t.length < 8) return null;
  if (t.length > 1200) t = t.slice(0, 1200).trim();
  return t;
}

export function enhancementContext(compiled) {
  const short=(value,max)=>String(value||'').slice(0,max);
  const measures={};
  for(const [domain,props]of Object.entries(compiled.resolved.tokens)){
    if(!['typography','color','shape','spacing','layout'].includes(domain))continue;
    for(const [property,record]of Object.entries(props))if(!record.unavailable&&record.value!=null&&String(record.value).length<=600)measures[`${domain}.${property}`]={value:record.value,ref:record.provenance?.ref};
  }
  return JSON.stringify({
    context:'Text-only advisory context. Reference images are not provided to this request. Long notes and the brief are summarized; canonical exports remain complete.',
    brief:short(compiled.meta.brief,8000),guidance:normalizeGuidance(compiled.meta.guidance),persona:short(compiled.meta.persona,2000),perRunNote:short(compiled.meta.perRunNote,1000),
    references:compiled.resolved.refs.slice(0,12).map(r=>({id:r.id,role:r.role,name:r.name,note:short(r.note,300),borrow:short(r.borrow,400),avoid:short(r.avoid,400),measured:r.measured})),
    additionalReferences:Math.max(0,compiled.resolved.refs.length-12),measurements:measures,
    precedence:precedenceProse(compiled.resolved),
  },null,2);
}

// Opt-in enhancement: ask ONLY for an advisory creative-direction note; return a
// validated string. The caller assembles outputs via withCreativeDirection, so the
// canonical spec is never handed to the model to rewrite. generateText is injected.
export async function enrichWithLLM(compiled, generateText) {
  if (!compiled?.resolved) throw new Error("Nothing to enhance — compile first.");
  if (typeof generateText !== "function") throw new Error("enrichWithLLM needs a generateText function.");
  const user = ["Write a CREATIVE DIRECTION note (2-4 sentences): a specific composition, the primary user journey, and how the references should work together for this product. Prose only; do not restate or change any measured value. Do not claim to have inspected images.", "", enhancementContext(compiled)].join("\n");
  let text = "";
  try { ({ text } = await generateText(user, { system: DIRECTION_SYSTEM })); }
  catch (e) { throw new Error(`Enhancement request failed: ${e.message}`); }
  const direction = validateDirection(text);
  if (!direction) throw new Error("Enhancement returned nothing usable — keeping the deterministic output.");
  return direction;
}
