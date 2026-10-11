# Phase 0.5 — Articulation falsification gate

Zero-code premise test, run BEFORE any picker code. Question: does structured
articulation (A2) beat a bare screenshot paste (A1)?

- **A1** = crops only -> model blends + builds the page.
- **A2** = crops + an explicit precedence paragraph (which source is the spine +
  how conflicts resolve).
- Both also emit a `DESIGN.md` (control: the baseline can produce structure too).
- Fixed page spec in `subject.txt` (same copy/sections every time; only the
  design system differs between renders).

## Pre-registered bar (decided before seeing any results)
**A2 must win the forced "which would you ship" choice on >= 2 of 3 blends.**
If it doesn't, the superiority thesis is dead -> this becomes a convenience-layer
product (nicer workflow, persistent tray), pitched at parity. Different README,
different eval. Better to know now.

Caveat: A2 here is a hand-written paragraph — the *ceiling* of articulation, not
what a dropdown->template compiler will emit. An A2 win is necessary, not
sufficient; the Phase 1 shadow-run validates the tool as actually built.

## How this run works
Generator: **Opus 4.8**, one fresh subagent PER ARM (A1 and A2 never share
context), so neither arm is contaminated by the other. You are the blind judge.
Recorded generator + version: `claude-opus-4-8`, 2026-10-10. (Verdict is
per-model; re-run on later models — the "models can't read values off pixels"
floor erodes over time.)

## Steps
1. Capture crops -> `crops/blend-1 … blend-3` (see `blends.md`).
2. Confirm/edit the spine picks in `blends.md` (the spine is the biggest lever).
3. I generate 6 renders -> `renders/`, neutrally labelled X/Y per blend.
4. You open each, fill `scoring.csv` (coherence 1-5 + one "would ship" per blend).
5. I reveal the X/Y -> A1/A2 mapping and tally against the bar.

Don't delete anything here — it's the first Phase 4 eval case and the seed of the
README before/after grid.
