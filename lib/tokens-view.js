// Rows for the Tokens view, derived straight from the CANONICAL resolved spec
// (compiled.resolved) — never by re-resolving or parsing the rendered Markdown.
// Each row carries the resolved value, its status, and the source reference id so
// the UI can link a token back to the reference that produced it.
//
// status: "observed" (measured on the owning source) | "fallback" (spine stood in
// for a source that didn't measure it) | "unavailable" (nobody measured it; never
// invented) | "candidate" (font availability — unverified by construction).
const GROUPS = [
  ["Typography", "typography", [["Font family", "font-family"], ["Size", "font-size"], ["Weight", "font-weight"], ["Line height", "line-height"], ["Letter spacing", "letter-spacing"], ["Transform", "text-transform"], ["Style", "font-style"]]],
  ["Color", "color", [["Text", "color"], ["Background", "background-color"], ["Background image", "background-image"]]],
  ["Spacing & layout", "spacing", [["Padding top", "padding-top"], ["Padding right", "padding-right"], ["Padding bottom", "padding-bottom"], ["Padding left", "padding-left"], ["Margin top", "margin-top"], ["Margin bottom", "margin-bottom"], ["Gap", "gap"]]],
  ["Spacing & layout", "layout", [["Display", "display"], ["Flex direction", "flex-direction"], ["Justify", "justify-content"], ["Align", "align-items"]]],
  ["Shape", "shape", [["Radius", "border-radius"], ["Border width", "border-top-width"], ["Border style", "border-top-style"], ["Border color", "border-top-color"], ["Shadow", "box-shadow"], ["Outline color", "outline-color"]]],
];

export function tokenRows(resolved) {
  if (!resolved || !resolved.tokens) return [];
  const rows = [];
  for (const [group, domain, keys] of GROUPS) {
    for (const [key, prop] of keys) {
      const rec = resolved.tokens[domain] && resolved.tokens[domain][prop];
      if (!rec) continue;
      rows.push({
        group, key, prop,
        value: rec.unavailable ? null : rec.value,
        status: rec.unavailable ? "unavailable" : rec.kind,
        refId: (rec.provenance && rec.provenance.ref) || null,
      });
    }
  }
  const tf = resolved.tokens.typographyFont;
  if (tf) rows.push({ group: "Typography", key: "Font candidate", prop: "font-availability", value: tf.availabilityCandidate || null, status: "candidate", refId: (tf.provenance && tf.provenance.ref) || null, uncertain: true });
  // Motion / states come from the spine as whole declarations.
  const m = resolved.motion;
  if (m && ((m.transition && m.transition !== "none" && m.transition !== "all 0s ease 0s") || (m.animationName && m.animationName !== "none"))) {
    if (m.transition) rows.push({ group: "Motion & states", key: "Transition", prop: "transition", value: m.transition, status: "observed", refId: resolved.spineRefId });
    if (m.animation && m.animation !== "none") rows.push({ group: "Motion & states", key: "Animation", prop: "animation", value: m.animation, status: "observed", refId: resolved.spineRefId });
  }
  const st = resolved.states;
  if (st) for (const k of ["hover", "focus"]) if (st[k]) rows.push({ group: "Motion & states", key: k[0].toUpperCase() + k.slice(1), prop: `:${k}`, value: Object.entries(st[k]).map(([p, v]) => `${p}: ${v}`).join("; "), status: "observed", refId: resolved.spineRefId });
  return rows;
}

// Presentation is evidence-aware; it never changes resolution or infers CSS
// from pixels. The complete missing-property list remains in the JSON export.
export function tokenPresentation(resolved) {
  const rows = tokenRows(resolved);
  const available = rows.filter((r) => r.value != null);
  const missing = rows.filter((r) => r.value == null);
  const candidates = (resolved?.refs || []).filter((r) => r.usablePropertyCount > 0);
  let title, message, kind;
  if (available.length) {
    kind = "measured"; title = "Measured CSS";
    message = `${available.filter((r) => r.status !== "candidate").length} values supplied by your selected references.${missing.length ? ` ${missing.length} unmeasured values are listed below.` : ""}`;
  } else if (candidates.length) {
    kind = "roles"; title = "Measured styles need a contributing role";
    message = "Your references include measured CSS, but the chosen base and override roles supply none of it. Use a measured reference as the base, then compile again. Pattern only references provide visual guidance.";
  } else if (resolved?.extractionFailedRefIds?.length) {
    kind = "failed"; title = "Styles could not be read";
    message = `Style extraction failed for ${resolved.extractionFailedRefIds.join(", ")}. Pick those elements again to measure their CSS; their images remain saved.`;
  } else if (resolved?.anyMeasured) {
    kind = "empty"; title = "No usable CSS was returned";
    message = "The selected elements returned no usable CSS values. Try picking a visible heading, button, or container, then compile again.";
  } else {
    kind = "image-only"; title = "These references contain images, not CSS";
    message = "Capture area saves a screenshot, including extended areas. It does not measure CSS. Use Pick element on a heading, button, or container, set that reference as the base, and compile again. Your area images still guide the design.";
  }
  return { available, missing, candidates, kind, title, message };
}
