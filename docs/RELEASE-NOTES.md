# Design Claw 0.4.0

This release turns the existing capture-and-export tool into a reference studio. It keeps the capture lifecycle, stored roles, crop database, shared locks and stale-output protections.

## Shipped

- New studio layout and matching settings, plus an original icon at 16/32/48/128 pixels.
- A wide workspace that receives the current brief when opened and uses the shared board. Website capture stays in the side panel.
- Named references with Borrow/Avoid intent, preserved through all handoffs and backups.
- Structured product type, audience, primary action, required content, exclusions and stack; saved setups include them.
- Independent local collections with atomic metadata/snapshot transactions, a shared mutation lock, bounded storage and non-destructive add-to-board behavior.
- Direct PNG download in the inspector, independent of compile freshness.
- Pre-compile readiness and an explicit measured-base repair for image-only role selection.
- Tailored build plan, system guidance and review checklist in each ZIP. Optional enhancement is text-only, bounded and advisory; full canonical exports remain intact.

Area capture is still image-only. Measuring CSS requires Pick element. Missing measurements are explained rather than fabricated. A screenshot cannot establish the painted font face, an exact design-system scale or complete accessibility conformance.

## Compatibility

No new runtime dependencies, build step, remote fonts or manifest permissions. Existing captures and backups remain usable. Saved collections use a separate database. Update inside the same unpacked-extension folder to preserve the extension origin and storage; do not uninstall first.

## Evidence and limits

The exact tests and runtime boundary are in VERIFICATION.md. Native Chrome grants, side-panel opening, real screenshot quotas and service-worker lifetime still require the manual checklist. The three-blend blinded model evaluation remains unexecuted; no numerical or “10/10” quality claim is made.
