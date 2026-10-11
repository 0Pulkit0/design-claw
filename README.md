# Design Claw

A Chrome extension for collecting design references across websites and compiling a portable design handoff. Version 0.4.0; plain JavaScript, no build step or runtime dependencies.

## New in 0.4

- A redesigned reference studio with an image-forward board, clear capture choices, a focused brief, keyboard-accessible handoff tabs, and an original toolbar icon.
- **Open studio** gives you a wider workspace with the same reference board and a copy of the current brief. Capture from the side panel on a website; use the studio to arrange references and prepare the handoff. Brief edits in the two views are independent after opening; save a setup or collection to reuse them.
- **Name / Borrow / Avoid** in the inspector lets you specify what each reference contributes. These annotations appear in the prompt, canonical JSON, backups and offline board.
- **Structured design controls** distinguish a website, product app, dashboard, store or publication. Add an audience, primary action, required content, exclusions and implementation stack. Every edit invalidates the old output immediately. Saved setups and backups include these fields.
- **Saved collections** keep independent local snapshots of images, measurements and brief. Save under the same name to update it. Add a saved collection to the current board without removing existing references; an existing base stays in charge. Inputs apply only when your brief is empty. Rename uses the collection-name field; deleting a snapshot keeps the current board intact. Limits: 20 snapshots and 256 MiB total. Export a portable backup before moving to another installation.
- **Download captured image** in the inspector saves the actual stored PNG without requiring a compile.
- **Readiness** explains image-only captures and measured references excluded by roles before compilation. It uses the same canonical resolver and offers an explicit measured-base action; it never invents missing values.
- Every handoff includes **SYSTEM.md**, **BUILD-PLAN.md** and **REVIEW-CHECKLIST.md**. The original design guidance is informed by public Anthropic/OpenAI frontend guides, preserves measured evidence, and changes its advice for the actual interface type. The optional creative-direction call receives bounded text context, not full keyframes or images, and cannot rewrite the canonical spec.

The audit, priorities, research links, implemented acceptance checks and deferred features are documented in [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md). Better model output still needs the existing blinded evaluation; this release does not claim a measured quality gain.

## Install or update

See [docs/INSTALL.md](docs/INSTALL.md). For an existing unpacked installation, replace the files **inside the same extension folder**, then click Reload in `chrome://extensions`. Keeping the folder preserves the extension's identity and its stored references. Keep a backup before updating.

For a new installation, unzip this archive, enable Developer mode in `chrome://extensions`, and choose **Load unpacked** on the folder containing `manifest.json`.

## Use

1. Open a normal website and click the extension's toolbar icon. This grants access to that tab and opens the panel.
2. **Pick element** reads computed CSS and saves a crop. **Capture area** saves an image: drag a selection, then hold the pointer at the top or bottom edge for **2 seconds** to extend it while scrolling. Release to capture and stitch the selection. Escape cancels.
3. Collect references from other sites. Click the toolbar icon again on each new site before capturing.
4. Choose a **Base reference** when combining multiple references. Add an optional typography, color, or shape source. Pattern-only references guide the design without overriding global measurements. The reference nearest the top wins ties within the same role.
5. Write your brief and click **Compile handoff**. Inspect DESIGN.md, Prompt, or Tokens. Export the bundle and attach its reference images to the receiving coding assistant.

The base supplies layout and spacing. Typography, color, and shape sources override only their own domains. Missing values fall back to the base when available; values nobody measured are omitted from the main handoff and retained with provenance in the JSON. Legitimate CSS values such as `none` and `0px` are preserved.

Area captures are image-only. In Tokens, an image-only compilation explains how to capture measured CSS instead of listing unavailable rows. If a measured Pattern only reference is excluded by an image base, Tokens offers an explicit Use REF as base action; compile again after changing it. Capture a DOM element when you need measured styles. Failed style extraction is identified separately from deliberate image capture. No API key is needed to capture, compile, inspect, or export.

## Included

- A reference inspector with full-size image access, notes, roles, recorded measurements, and capture diagnostics.
- A compact reference collection with a persistent Compile action and keyboard-accessible output tabs.
- Local saved setups for brief/persona/run notes. Provider keys are never included in presets or exports.
- A canonical resolved spec shared by DESIGN.md, PROMPT.txt, resolved-spec.json, and mapped reference PNG files.
- A ZIP exporter using the actual stored image blobs; a missing crop stops export with an error.
- Shared Web Locks for tray changes and screenshot pacing across panel contexts; revision guards prevent stale exports.
- Optional advisory creative direction from an OpenAI-compatible endpoint configured in Settings. This may incur charges from your provider and cannot change the canonical measured values.

Source URLs in exports omit query strings and fragments. Stored metadata remains local. The Markdown handoff is a self-describing record, not a claim of compliance with Google's DESIGN.md schema.

## New workbench tools

- **Scan visible page styles** lists observed colors, font profiles, spacing and radii. Each sample can start Pick element with that element highlighted; click it to capture its image and full CSS. The scan stays separate from the global role resolver. It samples at most 500 visible top-frame elements, examines at most 3,000 nodes, and has a 250 ms scanning budget. It does not read form values or page text. Counts are sampled uses, not brand importance; shadow roots and frames are excluded.
- **Copy token CSS / Download CSS** exports resolved measured values as scoped `--dc-*` variables. Click an individual token value to copy it. CSS downloads obey the same freshness guard as JSON and the handoff.
- **Export bundle** now also contains `BOARD.html`, `tokens.css`, `reference-styles.css`, and `KIT-README.md`. Extract the entire bundle, then open BOARD.html for an offline board with full-size images and measured values. Reference CSS describes captured elements and needs your own markup; it is not a component clone. Remote resource values and unsafe stylesheet syntax are omitted from CSS while preserved in the canonical JSON.
- **Project backup & import** exports image bytes, recorded measurements, and brief/persona/run notes into a portable JSON backup. Provider settings and keys are excluded. Imports add new reference IDs, preserve the existing collection and base, validate checksums and decode PNGs before committing. Metadata is committed once; failed saves roll back new images only. If the current brief is empty, imported inputs are applied. Otherwise your existing inputs stay. Limits: 100 references, 64 MiB of encoded image bytes, 96 megapixels in total, and a 96 MiB backup file.
- **Text contrast checks** appear in the reference inspector, Tokens, JSON and offline board. They use a recorded text color and explicit background, with size/weight thresholds. Images, gradients, unsupported color spaces, transparency, filters and uncertain background evidence remain unknown. This is an advisory flat-color text check, not an accessibility certification or a full audit. Older references need a fresh element capture to record background evidence.
- **Reference search** filters by website, role or note without changing the collection or its precedence.

## Capture limits

Vertical stitching covers normal pages that scroll in the window. Nested scrollers, changing/infinite-scroll layouts, and complex fixed-position elements may require smaller selections. Capture stops when geometry changes enough to make the result unreliable. Work is bounded to 20 screenshots, 24 megapixels, and a 16,384-pixel canvas dimension. Sideways coverage is clipped explicitly rather than filled with blank columns.

## Verification

Run from this folder:

```bash
node tests/run.mjs
node tests/upgrades.mjs
node tests/studio.mjs
```

The optional [browser smoke test](tests/browser-smoke.mjs) requires Playwright and Chromium. It runs real DOM, screenshots, canvas, and IndexedDB against a **mock Chrome API bridge**. It does not establish native MV3 permissions or service-worker behavior. See [docs/VERIFICATION.md](docs/VERIFICATION.md) for executed checks and [preview/CHROME-CHECKS.md](preview/CHROME-CHECKS.md) for native Chrome checks.

The [evaluation kit](eval/cases/README.md) supplies three case briefs, prompt templates, probes, and a judging sheet. Token scoring uses rendered computed styles. Actual baseline/tool generation and blind human judgments remain unexecuted; no superiority claim is made.

The product research and next evaluation gates are in [docs/FEATURE-RESEARCH.md](docs/FEATURE-RESEARCH.md).
