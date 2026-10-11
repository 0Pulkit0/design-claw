// Group one reference's OWN captured measurements (item.tokens) for the inspector.
// Pure + testable: no DOM, no recapture, no remote fetch. A null value means "not
// measured" (shown as such, never invented); the font row is always flagged
// uncertain because document.fonts.check is a hint, not a verified rendered face.
//
// "none" is a MEASUREMENT, not a gap. `box-shadow: none`, `border-style: none`,
// `text-transform: none`, `background-image: none` and `transition: none` are facts
// recorded from the element — a flat, unbordered, untransformed surface is a real
// design decision and must not be reported as "not measured". Recorded values are
// therefore preserved verbatim; rows carry `absent: true` so the view can render an
// explicit absence differently from a missing measurement.
export function groupMeasurements(item) {
  const t = (item && item.tokens) || {};
  const c = t.computed || {};
  const val = (v) => { const s = v == null ? "" : String(v).trim(); return s ? s : null; };
  const mk = (label, value, extra) => ({ label, value, absent: value != null && /^none$/i.test(value), ...extra });
  const row = (label, prop) => mk(label, val(c[prop]));

  const typography = [row("Font family", "font-family"), row("Size", "font-size"), row("Weight", "font-weight"), row("Line height", "line-height"), row("Letter spacing", "letter-spacing"), row("Transform", "text-transform"), row("Style", "font-style")];
  const fontCand = t.fonts ? (t.fonts.availabilityCandidate ?? t.fonts.firstAvailable ?? null) : null;
  typography.push(mk("Candidate", fontCand, { uncertain: true, hint: "unverified — document.fonts.check only" }));

  const colors = [row("Text", "color"), row("Background", "background-color"), row("Background image", "background-image"), row("Border color", "border-top-color"), row("Outline", "outline-color")];
  const spacing = [row("Padding top", "padding-top"), row("Padding right", "padding-right"), row("Padding bottom", "padding-bottom"), row("Padding left", "padding-left"), row("Margin top", "margin-top"), row("Margin bottom", "margin-bottom"), row("Gap", "gap"), row("Display", "display"), row("Flex direction", "flex-direction"), row("Justify", "justify-content"), row("Align", "align-items")];
  const shape = [row("Radius", "border-radius"), row("Border width", "border-top-width"), row("Border style", "border-top-style"), row("Shadow", "box-shadow")];

  const m = t.motion || {};
  const motion = [
    mk("Transition", val(m.transition)),
    mk("Animation", val(m.animation)),
    mk("Keyframes", val(t.keyframes)),
  ];
  const st = t.states || {};
  const asDecl = (o) => (o && Object.keys(o).length ? Object.entries(o).map(([p, v]) => `${p}: ${v}`).join("; ") : null);
  const states = [mk("Hover", asDecl(st.hover)), mk("Focus", asDecl(st.focus))];

  return [
    { title: "Typography", rows: typography },
    { title: "Colors", rows: colors },
    { title: "Spacing & layout", rows: spacing },
    { title: "Shape", rows: shape },
    { title: "Motion", rows: motion },
    { title: "States", rows: states },
  ];
}
