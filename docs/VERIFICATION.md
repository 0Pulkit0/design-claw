# Verification — Design Claw 0.4.0

## Executed on the release source

| Check | Result | Boundary |
|---|---|---|
| `node tests/run.mjs` | 157 passed, 0 failed | Production compiler, capture/stitch orchestration, serialization, role policy, locks, persistence rollback, pending edits, stale guards and renderer races; Chrome APIs mocked. |
| `node tests/upgrades.mjs` | 14 passed | CSS export, offline board, contrast, PNG checksums, import atomicity and concurrent capture/import. |
| `node tests/studio.mjs` | 22 passed | Structured guidance, annotations, presets/backups, advisory isolation and bounded context, collection conflicts/limits/failures/concurrency, export additions and PNG icon dimensions. |
| Combined module suites | 193 checks passed | No paid API calls; enhancement responses are stubs. |
| `tests/browser-smoke.mjs` | 25 scenarios passed in Chromium 155.0.8059.39 | Real renderer, DOM, pointer/keyboard events, canvas, PNG encoding/decoding, IndexedDB, dialogs, downloads and Web Locks. Chrome APIs use an explicit simulated bridge. |
| JavaScript syntax | 47 JS/MJS files pass `node --check` | Includes content scripts, background, UI, libraries, tests and evaluator. |
| Manifest and icons | Parsed; PNGs decoded at 16/32/48/128; declared files exist | Permissions unchanged. No runtime package or remote UI font. |
| Handoff ZIP | CRC passes; mapped PNGs equal the stored blobs byte for byte | Same buildBundle code used by the panel. |
| Extension ZIP | CRC and expected entry paths pass; module suites rerun from extraction | Source, instructions, tests and review materials included. |

## Browser paths exercised

- Visible computed-style scan, exclusion of private form values and highlighting a sample for the ordinary picker.
- Element capture, actual font-size reaching its canonical Tokens row, conservative captured-background contrast check.
- The 2-second area edge hold, multi-tile PNG persistence, full-size inspector access, panel reopening and direct byte-identical PNG download.
- Image-only Tokens explanation, empty/missing collapse, an explicit measured-base repair, pending role writes and keyboard output tabs.
- Canonical CSS and prompt downloads, stale download refusal, reference search, ZIP reference mapping and offline board with no network requests.
- Cancellation during a pending screenshot, page-style restoration and two browser-panel convergence.
- Actual annotation edits, structured brief invalidation, tailored prompt/build plan and preset round trip.
- Backup/import with real PNG bytes, existing-base preservation, checksums and actual decoder rejection of a truncated image.
- Saved collection independence after live image deletion, reopening, add-to-board with new IDs, annotation/input restoration, rename synchronization and snapshot deletion without live crop deletion.
- Studio opening, brief transfer through session storage and temporary draft cleanup, shared board, desktop layout and website-panel-only capture.
- Settings layout and password visibility.

## Visual inspection

Inspected the actual panel HTML/CSS at 320/400/480 pixels and the wide studio at 1280 pixels. Checks cover empty/populated boards, long values, compiled output, token groups and the inspector. The new visual-reference fixture uses original synthetic local pages to give the thumbnails representative content; those screenshots are UI inspection examples, not customer captures or model-quality results. `preview/visual-sources.html` identifies them explicitly. Output tabs support arrow keys; dialogs use the browser's native modal focus behavior; reduced motion and visible focus styles are retained.

## Runtime and evaluation limits

This environment cannot run a native unpacked MV3 extension: regular Chrome exits when its required Unix socket is denied. Headless Chromium and the bridge establish real rendering, orchestration and storage behavior, but do not establish native activeTab grants, side-panel opening, service-worker lifetime or actual captureVisibleTab quotas. The native acceptance checklist remains unexecuted in `preview/CHROME-CHECKS.md`. Run INSTALL.md's quick check after updating on your machine.

No live provider calls or three-case baseline/tool generation were performed. The existing evaluator and blind judging kit are preserved; the prior evaluator fixture check is not a new output-quality result. The new guidance is source-informed and tested for context and consistency, but its visual-quality benefit has not been established by blinded evaluation.

## Compatibility and operating limits

Existing crop database, storage names, roles and backup version remain compatible. New collections use a separate atomic IndexedDB repository and a separate same-origin Web Lock. Missing locks block unsafe mutations. Local snapshots are limited to 20 and 256 MiB; per-project backup limits remain 100 references, 64 MiB encoded image bytes and 96 megapixels. Area stitching retains the 20-shot, 24-megapixel and 16,384-pixel canvas limits. Nested scrollers and changing/infinite layouts may need smaller selections.

Everything remained local. No push, deployment or paid API request was made.
