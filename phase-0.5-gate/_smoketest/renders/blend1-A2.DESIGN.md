# Atlas — Blended Design System (`blend1-A2`)

Three sources, one spine. The **brutalist nav** governs all structure; the
**editorial hero** lends only its *type character*; the **soft-SaaS card** lends
only its *palette*. Every conflict resolves to the spine:
**density beats air, hard edges beat softness.**

## tokens

```yaml
color:
  paper:         "#ffffff"   # base surface — spine B/W (editorial cream rejected)
  ink:           "#0b0b0c"   # structure, borders, headings — spine
  ink-2:         "#4a4a55"   # body / muted — SaaS slate reused as neutral text
  accent-violet: "#6a4cf2"   # PRIMARY accent  (SaaS palette)
  violet-deep:   "#4b2fd1"   # violet pressed / hover
  accent-gold:   "#f4c33e"   # SECONDARY accent (SaaS sparkle, recolored)
  lavender:      "#ecebfc"   # accent tint zones (SaaS palette)

border:
  width:        2px          # standard divider
  width-thick:  3px          # frame + major section dividers
  radius:       0            # SQUARE everywhere — spine (SaaS rounding dropped)
  shadow-soft:  none         # SaaS soft drop-shadow dropped entirely
  shadow-hard:  "5px 5px 0 #0b0b0c"   # zero-blur offset only (brutalist device)

space:                       # dense, grid-snapped — spine rhythm (4px base)
  xs: 8   sm: 12   md: 16   lg: 24   xl: 32
  section: ~38-52px          # NOT the 96-120px of airy SaaS — density beats air

type:
  display: "Playfair Display"   # EDITORIAL type character — headings only
  ui:      "Space Grotesk"      # nav / labels / buttons — UPPERCASE, letterspaced
  body:    "Inter"              # paragraph copy
  scale:
    h1:    "76px / 1.02"        # serif display, leading snapped tight to spine
    h3:    "24px / 1.12"        # serif card titles
    price: "58px / 1.0"         # serif numerals
    body:  "17-19px / 1.5"
    label: "12-13px / .14-.22em tracking / UPPERCASE"

motif:
  - framed sheet, 3px ink border
  - full-height cells divided by borders (nav, footer, feature row, tiers)
  - pipe-divider link rows (nav + footer) = brutalist vertical rules
  - section index numerals (01 / 02 / 03)
  - square flat accent tiles (violet / gold / ink) in place of SaaS rounded gradient icon
```

## precedence decisions

1. **Spine = brutalist nav.** The whole page is one bordered sheet, subdivided by
   hard 3px (major) / 2px (sub) rules. Spacing, density, square corners and the
   boxed-brand + pipe-divider + solid-cell-button vocabulary all derive from the nav.

2. **Type character only, from the editorial hero.** Playfair Display drives the
   H1, card titles and prices (high-contrast serif display). Its *airy* editorial
   spacing was **not** inherited — leading is snapped to the spine (H1 line-height
   1.02, tight margins, ~52px sections). Its cream background was treated as
   palette, not character, and rejected; the base stays spine white.

3. **Palette only, from the soft-SaaS card.** Violet (primary), gold (secondary)
   and lavender (tint zones: hero aside, pricing strip) appear strictly as
   **accents over a B/W base**. The SaaS *form* was stripped: rounded corners →
   `radius 0`; soft shadows → removed; pill button → square; rounded gradient icon
   → square flat tile. The only shadow permitted is a zero-blur hard offset.

4. **Conflicts → spine.**
   - *density beats air*: SaaS/editorial whitespace compressed to the nav's dense grid.
   - *hard edges beat softness*: no radius, no blur, no soft gradients anywhere.
   - *color never softens structure*: accents fill square cells; all borders stay ink.

## section map
`nav` (spine cells) · `hero` (serif H1 + violet CTA + square accent grid) ·
`features` (3 bordered cells, serif titles, square accent icons) ·
`pricing` (lavender accent zone, bordered tiers, Plus = violet-emphasized) ·
`footer` (spine cells, pipe-divider links).
