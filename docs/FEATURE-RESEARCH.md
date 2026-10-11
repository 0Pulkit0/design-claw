# Product direction — researched October 11, 2026

Design Claw should help turn collected references into a usable design handoff.
Feature count alone cannot establish output quality or a 10/10 rating.

## Sources and decisions

- [CSS Peeper](https://csspeeper.com/) already offers color and typography inspection and export. Competing on a basic inspector alone is a weak distinction. This release adds a bounded visible-page inventory, then connects samples to normal measured element capture and the existing multi-reference resolver.
- [CSS custom properties](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Cascading_variables/Using_custom_properties) let reusable values be declared once and consumed with `var()`. This release exports measured canonical values as custom properties with source comments, plus scoped element declarations. It does not label arbitrary captured defaults as a complete semantic design system.
- [W3C text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum/) specifies 4.5:1 for normal text and 3:1 for large text. This release checks supported opaque text/background pairs with recorded size/weight. Transparency, image/gradient backgrounds, unsupported color spaces, and uncertain compositing stay unknown. It is not a full accessibility audit.
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) supports executing a function under existing scripting and activeTab permissions. The style scan uses these existing permissions; no background crawl, new broad host access, external server or account is introduced.
- [Design Tokens Format Module 2025.10](https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/) provides an interoperability format. A conforming typed export is a possible later step. The current resolved JSON is a provenance record and is not presented as DTCG compliant.

## Delivered in 0.3.0

1. Visible-page computed-style inventory, with sample highlighting in the picker.
2. Canonical token CSS and scoped per-reference CSS exports.
3. Offline reference board included in the handoff ZIP.
4. Portable project backup/import with actual PNGs, measurements, checksums, decoder validation, and an atomic metadata commit.
5. Conservative, reference-specific text contrast checks.
6. Reference search and click-to-copy token values.

Backup/import makes references portable between local installations; the board
makes the handoff reviewable without a model; CSS makes measurements consumable
by a real implementation. These are product decisions inferred from the workflow,
not claims that the sources prove Design Claw's superiority.

## Next gates before calling it production-ready

- Execute the native Chrome checklist on ordinary sites, long pages and multiple windows. Renderer tests with an API bridge do not prove native permissions, service-worker behavior, or Chrome screenshot quotas.
- Run the existing three-case baseline/tool evaluation, including blind human judgments. Measure whether the handoff improves fidelity and reduces iteration; do not infer quality from passing unit tests.
- Use real sessions to prioritize the next capture mode: nested scrollers, frames/shadow roots, and responsive comparisons address genuine current limits. Each needs geometry and lifecycle work, not an unchecked toggle.
- Add conforming typed design-token export only with schema/format validation and explicit omission of unsupported CSS values.
- Consider named project collections and version comparison after backup/import has field use. Keep keys out of shared projects; avoid automatic cloud sync until there is a concrete collaboration need.

Whole-site cloning, automatic "perfect design" claims, indiscriminate asset grabs,
and a numeric quality score would create claims this evidence does not support.
