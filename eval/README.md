# Rendered evaluation

Compare three separate outcomes: capture fidelity, preservation of chosen measurements, and blind human visual preference. No combined quality score and no completed A/B results are claimed.

The [three-case kit](cases/README.md) contains landing, dashboard, and article briefs, manifests, baseline/tool prompt templates, probes, expected-value templates, and a judging sheet permitting ties. Use the same reference images, brief, model/version, and generation budget in both isolated arms. The tool arm additionally receives the compiled handoff.

## Measure a render

From the project root, after generating a candidate and filling the expected values from the captured spec:

```bash
node eval/measure-rendered.mjs eval/cases/case-01-landing/arm-tool.html eval/cases/case-01-landing/probes.json --width 1280 --height 900 > tool-measured.json
node eval/score.mjs tool-measured.json eval/cases/case-01-landing/expected.json --deltaE 10 --px 2
```

Use `--chrome /absolute/path/to/chrome` if the browser is not discovered automatically. Use identical viewport settings for both arms; measurement reports the actual viewport as well as the requested one. Candidates and their local assets should reside in the candidate directory or its subdirectories. The server binds only to loopback and refuses files outside that directory.

The browser waits for page load and bounded font/layout readiness. Missing selectors fail their expected properties. Failed resources and font-readiness timeouts mark the score invalid for comparison. Incomplete expected-value templates produce an actionable error rather than misleading scores. Names beginning with `_` are metadata, not probes.

Color tolerance defaults to Delta E <= 10. If the optional eval-only `culori` dependency is present, scoring uses CIEDE2000; otherwise it uses the documented CIE76 fallback. Use the same engine for both arms. Different opacity does not earn a color match. Pixel lengths default to +/-2px; unsupported units require conversion to computed pixels or an exact supported keyword. Font scoring matches whole declared family names, not arbitrary substrings. Computed font-family records the declared stack, not proof of the painted face.

`metrics.mjs` is retained only as a non-authoritative historical source-text diagnostic. Do not use its nearest-source-color or substring results for the comparison.

## Executed harness checks

The renderer was run in Chromium against `cases/_assets-check/index.html`, including its external stylesheet and image. Measured heading color was rgb(26,26,26), font size 32px, and CTA background rgb(47,76,139). The comment decoy did not affect those values. These are synthetic harness checks, not evidence that the product improves generated designs.

Actual three-case captures, model generation, and blinded judging remain pending. Record exact model versions and disclose small sample size and single-judge limitations.
