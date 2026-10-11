# Design Claw 0.4 — implementation plan

## Product goal
Turn useful parts of real websites into an intentional, portable build brief. The core loop is capture → explain what to borrow → resolve measured styles → hand off images, constraints and a build plan. It is a reference tool, not a website clone generator or a font-identification service.

## Audit findings and priorities

| Priority | Finding | Implemented response | Acceptance check |
|---|---|---|---|
| P0 | Area screenshots contain no DOM styles; the distinction is easy to miss. | Explain Element versus Area at capture time; readiness summary gives a measured-element action, while image-only handoffs remain useful. | Area-only compile has an honest visual-guidance state; no invented CSS. |
| P0 | A long form, dense diagnostics and raw Markdown compete with the reference board. | Rebuild the panel as a compact studio with visual reference cards, a clear brief and a separate handoff surface; add a wide studio view. | Inspect real DOM at 320/400/480 and desktop widths; all existing workflows still pass. |
| P1 | Generic persona and three-line enhancement guidance do little to define composition. | Structured audience/task/content/stack fields; product-specific design guidance; a deterministic build plan and review checklist in the export. | Guidance round-trips through JSON, presets and backup; advisory enhancement leaves canonical tokens unchanged. |
| P1 | “Reference” does not say which characteristics to reuse. | Human names plus Borrow and Avoid annotations, edited through the existing shared mutation authority. | Simultaneous detail edits preserve unrelated data; all exported reference records agree. |
| P1 | Reference reuse requires downloading and re-importing a file. | Named local collections with independent image snapshots; add a collection to the current board without deleting existing references. | Saved collection survives removal from the current board; corrupt images cannot be imported. |
| P1 | Placeholder D damages the first impression. | Original capture-frame mark, SVG master and pixel-sized PNGs declared in the manifest. | Every manifest icon exists, decodes, and has its declared dimensions. |
| P2 | Review and implementation instructions are buried in prose. | SYSTEM.md, BUILD-PLAN.md and REVIEW-CHECKLIST.md included alongside the existing canonical files, CSS and offline board. | ZIP integrity and reference mapping checks; measured values remain authoritative. |

## Research translated into product decisions

Sources: [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design), [OpenAI frontend guidance](https://developers.openai.com/blog/designing-delightful-frontends-with-gpt-5-4), [OpenAI frontend-app-builder](https://github.com/openai/plugins/tree/main/plugins/build-web-apps/skills/frontend-app-builder), [CSS Peeper](https://csspeeper.com/), [Are.na collections](https://help.are.na/docs/getting-started/channels), [Linear](https://linear.app/features).

Adapted principles, written specifically for this product: ground design in audience and primary task; choose a coherent composition before decoration; distinguish an operational app from a marketing page; use real content and visible states; preserve measured evidence; use references deliberately; verify with screenshots and keyboard interaction. Reference collections and compact inspection inspired the reuse workflow. No third-party skill is installed or copied wholesale, and no claim of improved model output is made without evaluation.

The extension's visual direction is a calm, image-forward design workbench: ink navigation, teal actions, a clean canvas, compact cards and clear labels. It avoids another decorative paper/serif or neon terminal theme. The icon represents collecting and framing a visual fragment.

## Scope and compatibility

Keep the existing capture lifecycle, 2-second edge hold, pacing, locks, stale-output guards, PNG validation and crop database unchanged. Add library snapshots in a separate IndexedDB database. Preserve stored roles, API configuration and previous backups. No runtime packages, remote fonts, paid API calls or new manifest permissions. Existing collections and persona remain usable.

## Deferred work

Cloud sync, Figma export, automatic raster-to-CSS inference, AI page generation inside the extension, site-wide crawling and arbitrary nested-scroll stitching are outside this release. They need stronger permissions, additional product decisions or evidence of demand. Real unpacked-extension Chrome validation and the three-blend blind evaluation remain release checks on a user's Chrome; a simulated API bridge is not a substitute for them.

## Verification approach

Run existing production-module regression suites, then add tests for structured inputs, annotations, library concurrency/limits/failures and export consistency. Exercise real DOM, dialogs, IndexedDB, canvas and downloads through the existing browser bridge; explicitly label Chrome APIs as simulated. Inspect screenshots and overflow at narrow and wide widths. Verify syntax, manifest, PNGs and the final ZIP from an extracted copy. Record exact executed results in VERIFICATION.md.
