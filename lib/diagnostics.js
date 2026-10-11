// Capture-quality diagnostics derived ONLY from evidence already present in capture
// metadata and the canonical resolved spec. No invented numeric score, no font
// verification beyond what was recorded, and advisory only — these never block
// compilation (mandatory rules stay in the compiler).
//
// diagnoseCapture: per-reference issues (shown beside the reference / in its inspector).
// diagnoseResolved: resolution issues (shown in the Tokens view), each linked to a ref.

const DOMAIN_LABEL = { typography: "Typography", color: "Color", spacing: "Spacing", layout: "Layout", shape: "Shape" };
// Plain-language role names (the stored values stay "spine"/"type"/…).
const ROLE_WORD = { spine: "base reference", type: "typography source", palette: "color source", shape: "shape source", component: "pattern reference" };
const MEASURING_ROLES = ["spine", "type", "palette", "shape"];
const PICK_ACTION = { label: "Capture an element", pick: true };

export function diagnoseCapture(item, opts = {}) {
  const out = [];
  if (opts.missingCrop) out.push({ level: "error", kind: "missing-crop", message: "The image is missing from storage — capture this reference again before exporting." });
  if (item && item.clipped) out.push({ level: "warn", kind: "clipped", message: "Only the visible part was captured — scroll the whole element into view and capture it again for a complete image." });

  const measured = !!(item && item.tokens && item.tokens.computed);
  if (!measured) {
    const status = (item && item.measurement && item.measurement.status) || "image-only";
    const reason = (item && item.measurement && item.measurement.reason) || "";
    // Evidence, not intent: a failed extraction must never be presented as a
    // deliberate image-only capture.
    if (status === "failed") {
      out.push({ level: "warn", kind: "extraction-failed", action: PICK_ACTION,
        message: `Styles could not be read from this element${reason ? ` (${reason})` : ""}. It still works as visual guidance, but it supplies no measured CSS.` });
    } else {
      out.push({ level: "info", kind: "image-only", action: PICK_ACTION,
        message: "Image only — this guides the look but supplies no measured CSS. Capture a DOM element to measure type, color, shape, or the base." });
    }
    const role = item && item.role;
    if (MEASURING_ROLES.includes(role)) {
      out.push({ level: "warn", kind: "role-needs-measurement", action: PICK_ACTION,
        message: `It is set as the ${ROLE_WORD[role]}, but with no measured styles that role contributes nothing measurable — the ${role === "spine" ? "base values fall back to nothing" : "domain falls back to the base reference"}.` });
    }
  }
  return out;
}

export function diagnoseResolved(resolved) {
  if (!resolved || !resolved.tokens) return [];
  const out = [];
  for (const [domain, props] of Object.entries(resolved.tokens)) {
    if (domain === "typographyFont") continue;
    for (const [prop, rec] of Object.entries(props)) {
      if (!rec || typeof rec !== "object") continue;
      const ref = (rec.provenance && rec.provenance.ref) || null;
      const where = `${DOMAIN_LABEL[domain] || domain} · ${prop}`;
      if (rec.unavailable) out.push({ level: "warn", kind: "unavailable", refId: ref, message: `${where} is not supplied by the selected role sources. Check the reference roles or pick an element to measure it.` });
      else if (rec.kind === "fallback") out.push({ level: "info", kind: "fallback", refId: ref, message: `${where} falls back to the spine (${ref}) — the chosen source didn't measure it.` });
    }
  }
  const tf = resolved.tokens.typographyFont;
  if (tf && tf.uncertain) out.push({ level: "warn", kind: "font-uncertain", refId: (tf.provenance && tf.provenance.ref) || null, message: `Font "${tf.availabilityCandidate || tf.stack}" is a candidate from document.fonts.check — not a verified rendered face. Treat it as a hint.` });
  if (resolved.effectiveBaseNote) out.push({ level: "info", kind: "effective-base", refId: resolved.spineRefId, message: "A single source is acting as the effective base; add more references and set an explicit base for a real merge." });
  // No measurements at all: say so once, loudly, with the route to fix it.
  if (resolved.anyMeasured === false) {
    out.push({ level: "warn", kind: "no-measurements", action: PICK_ACTION,
      message: resolved.extractionFailedRefIds?.length
        ? `Nothing here was measured; style extraction failed for ${resolved.extractionFailedRefIds.join(", ")}. Capture those elements again for measured values. The handoff uses visual guidance.`
        : "Nothing here was measured — every reference is image-only, so the handoff is visual direction rather than a token set." });
  }
  return out;
}
