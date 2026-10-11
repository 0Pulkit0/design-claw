# Three-case evaluation kit

A ready-to-run A/B comparing **baseline** (brief + reference images) against
**tool** (same brief + images **+** the compiled handoff). Everything here is a
TEMPLATE — no runs have happened, and `expected.json` / the judging sheet are
intentionally empty until a human executes the cases with real captures and their
own model key. No paid calls are made by anything in this repo.

## Layout

```
_templates/baseline.txt     prompt template: brief + attached images only
_templates/tool.txt         prompt template: brief + images + compiled handoff
_assets-check/              a tiny local-asset page used by the harness test (not a case)
case-01-landing/            SaaS landing page
case-02-dashboard/          analytics dashboard
case-03-article/            editorial reading page
  brief.md                  the one brief used for BOTH arms
  manifest.md               which references to capture + the role each gets
  probes.json               name -> CSS selector in the generated render
  expected.json             name -> {property: expected value}  (FILL from resolved-spec.json)
../scoring-ab.csv           blind judging sheet (ties allowed)
```

## Run one case (human steps — nothing below is automated here)

1. **Capture** the references in `manifest.md` with the extension (element where a
   DOM node exists; area for a region). Set the roles exactly as the manifest says,
   set the base reference, write the case `brief.md` verbatim as the build brief,
   and **Export bundle** → you get `DESIGN.md`, `PROMPT.txt`, `resolved-spec.json`,
   `references/REF-NN.png`.
2. **Fill `expected.json`** from `resolved-spec.json`: for each probe, the measured
   value its role should contribute (palette color, type font, shape radius, base
   padding). These are the ground truth your clicks defined.
3. **Generate both arms** with the SAME model + version + length budget, each in a
   fresh/isolated chat:
   - baseline: `_templates/baseline.txt` with the brief + the exported images.
   - tool: `_templates/tool.txt` with the brief + images + `PROMPT.txt`.
   Save each render as `arm-baseline.html` / `arm-tool.html` in the case folder.
4. **Capture accuracy** (separate metric): eyeball the exported `references/*.png`
   vs the live sites; note clipped/partial ones (the tool already flags these).
5. **Token accuracy** (measured, not substrings):
   ```bash
   node eval/measure-rendered.mjs eval/cases/case-01-landing/arm-tool.html eval/cases/case-01-landing/probes.json > /tmp/tool.json
   node eval/score.mjs /tmp/tool.json eval/cases/case-01-landing/expected.json --deltaE 10 --px 2
   ```
   Repeat for `arm-baseline.html`. Record pass/total per arm.
6. **Visual preference** (separate metric): shuffle the two renders to X/Y, strip
   labels, judge blind, fill a row in `../scoring-ab.csv` (ties allowed), then
   reveal X/Y → arm and tally.

Keep the three numbers separate — capture accuracy, token accuracy, visual
preference — and never blend them into one score.

## Honesty notes

- `measure-rendered.mjs` reports computed `font-family` = the **declared stack** the
  browser resolved to, not proof of which face painted the glyphs.
- The harness's own checks (in `tests/run.mjs`) are synthetic and live separately
  from these cases; they establish the scripts work, not that the tool wins.
- Single judge / small-n: state it in any writeup. Re-run on each new model.
