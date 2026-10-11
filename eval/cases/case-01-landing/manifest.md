# Case 01 — input manifest

Capture these four references, set the role shown, and make the first the base.
(Sites are suggestions — any page with the same character works. Capture the
specific element named; use Area only where there is no single DOM node.)

| # | Role (UI label) | Capture | Suggested source | Contributes |
|---|---|---|---|---|
| 1 | Base reference (spine) | the hero section container | a clean SaaS hero (e.g. stripe.com) | layout + spacing + base type |
| 2 | Typography source | the main H1 headline element | a product with strong headings (e.g. linear.app) | font family / size / weight |
| 3 | Color source | the primary button | any fintech brand button | palette (text + background) |
| 4 | Shape source | a rounded card / panel | any card with a clear radius + shadow | border-radius, border, shadow |

Write `brief.md` as the build brief. Export the bundle; keep `resolved-spec.json`
and `references/` beside the renders. Fill `expected.json` from `resolved-spec.json`.
