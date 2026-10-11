# Atlas — Blended Design System
### "Ledger": editorial-brutalist fintech on warm paper, with soft violet moments

Blended from three source components (each a different website):
- **nav-brutalist** -> structure & chrome: heavy ink rules, mono uppercase labels, hard-edged solid button with `↗`, boxed wordmark, vertical dividers, sharp corners.
- **hero-editorial** -> canvas & voice: warm paper background, high-contrast serif display headline, mono eyebrow label, hairline rules, generous whitespace, one italic word.
- **card-soft-saas** -> content surfaces: rounded white cards, soft diffuse shadows, violet gradient icon tiles, pill CTA.

## Tokens

```yaml
color:
  paper:       "#F3EFE6"   # canvas (editorial cream)
  paper-2:     "#ECE6D9"
  surface:     "#FFFFFF"   # cards (soft-saas)
  ink:         "#17140F"   # warm near-black: text, buttons, Plus card (brutalist/editorial)
  ink-muted:   "#6E6557"   # taupe body / secondary (editorial)
  ink-faint:   "#A49B8B"
  hairline:    "#D9D1C1"   # thin rules on paper (editorial)
  rule-heavy:  "#17140F"   # 3px brutalist borders (nav, footer)
  violet:      "#6C4CF1"   # accent (soft-saas)
  violet-2:    "#8E78FF"   # gradient top stop
  violet-tint: "#ECEBFB"

type:
  display: "Fraunces"      # serif: hero H1, section H2s, prices (editorial)
  mono:    "Space Mono"    # eyebrows, nav/footer links, tier names, /mo, (c) (brutalist)
  body:    "Inter"         # subhead, body, card titles, pill button (soft-saas bridge)
  scale:
    h1:      "82px / 1.0 / -0.025em / 600  (one word italic 500)"
    h2:      "34px / 600  (serif section heads)"
    price:   "62px / 600  (serif)"
    card-h3: "22px / 700  (Inter)"
    body:    "21px hero - 16px card / 1.6"
    label:   "12-13px mono - uppercase - 0.12-0.22em tracking"

radius:
  chrome: 0px      # nav, brand box, ink buttons stay sharp (brutalist)
  soft:   24px     # feature + pricing cards (soft-saas)
  tile:   18px     # gradient icon tiles
  pill:   999px    # violet accent button

shadow:
  card:    "0 26px 50px -30px rgba(23,20,15,.5)"
  card-sm: "0 12px 26px -18px rgba(23,20,15,.4)"
  violet:  "0 14px 26px -12px rgba(108,76,241,.55)"

border:
  heavy:   "3px solid ink"    # nav bottom / footer top
  box:     "2.5px solid ink"  # brand badge
  divider: "1.5px solid ink"  # between mono links

layout:
  content-width: 1200px
  gutter: 32px
  section-rhythm: "~76px vertical"
```

## Component rules
- **Buttons, two roles.** `btn-ink` (solid ink, square, mono-uppercase, `↗`) is the brand default — nav, hero, Free tier. `btn-violet` (gradient pill, Inter bold) is reserved for the premium/upsell action — the Plus tier only.
- **Brand mark.** Serif "Atlas" set inside a hard brutalist box — the single clearest fusion of editorial + brutalist.
- **Bookends.** Nav and footer share one brutalist grammar: a 3px ink rule plus mono uppercase links split by 1.5px vertical dividers.
- **Feature cards** are pure soft-saas: white, 24px radius, soft shadow, violet gradient icon tile, subtle hover lift.
- **Pricing** uses the full range: Free = light soft card with ink outline + ink button; Plus = brutalist solid-ink block with a serif price and a violet pill, tying all three languages together.

## Coherence principle
One governing rule unifies three clashing aesthetics: **structure is hard, content is soft.** Chrome (nav, footer, brand, primary buttons) is sharp, mono, ink-on-paper (brutalist + editorial); content surfaces (cards, tiles) are rounded, shadowed, violet-accented (soft-saas). The warm paper canvas and the serif + mono type pairing carry across both zones, so the page reads as one system rather than three stitched-together parts.
