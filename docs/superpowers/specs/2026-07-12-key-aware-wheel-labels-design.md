# Key-aware wheel labels with fading respell

**Date:** 2026-07-12
**Status:** Approved, ready to implement
**Scope:** web front-end — `web/js/main.js` + `web/css/style.css`

## Problem

The 12 pitch-class labels around the wheel are fixed strings, with every
accidental spelled as a sharp (A#, C#, D#, F#, G#). The centre readout already
spells notes/chords per the estimated key (Bb vs A#), but the wheel labels don't
follow. They should respell to match the key — and the change must **fade**
smoothly, not swap abruptly, or a wheel of 12 labels flipping text looks messy.

## Design

Only the **5 accidental** positions ever change (A#/Bb, C#/Db, D#/Eb, F#/Gb,
G#/Ab); the 7 naturals never do. So only those 5 get the crossfade machinery.

### Stacked spans (the crossfade mechanism)

Each accidental slot holds **two overlapping `<span>`s** in the same wheel
position: one showing the sharp name, one the flat name. Exactly one is active
(opacity 1) at a time; the other is opacity 0. CSS `transition: opacity 0.6s` on
the spans turns any active↔inactive switch into a smooth 0.6 s crossfade — the
label never fully disappears, it morphs. Naturals stay a single plain span,
unchanged.

### Driving the spelling (per label, each frame)

- Compute the key-correct spelling for the accidental's pitch class:
  `target = KS.spell(pc, estimatedKey)`, but **only when `estimatedKey` is
  non-null**.
- When `estimatedKey` is `null` (ambiguous / not enough evidence): **hold** the
  current spelling — do not revert to a default. Snapping back to default sharps
  on every ambiguous moment would be the messy behaviour we're avoiding.
- **Debounce (0.5 s dwell), per label:** if `target` differs from the label's
  currently-shown spelling, run a timer; only once `target` has stayed different
  for 0.5 s do we commit the flip (swap which stacked span is active → CSS
  crossfades). Each of the 5 accidentals has its own independent timer.

### Why no extra confidence gate

`estimateKey()` already returns `null` unless the winning key clears both the
`MIN_TOTAL` evidence floor and the `confidenceMargin` lead over the runner-up,
and the pitch-class histogram is time-decayed (per-mode half-life). So the key
only resolves when it's genuinely confident. The 0.5 s dwell is a **display-flip
debounce only** — a safety against a brief blip right at a confidence boundary
kicking off a fade — not a second confidence layer. Do NOT add an
N-consecutive-frames confidence check on top.

### Timing

0.5 s dwell + 0.6 s crossfade → a respell completes in ~1.1 s. Calm, never
twitchy, clearly connected to what's being played.

### Wiring details

- The existing `.lit` class (highlighting a label when its pitch class sounds) is
  currently toggled per span. For an accidental slot's two stacked spans, light
  the **slot** (both spans together), so lighting still works regardless of which
  spelling is active. `refreshLit` / `litPitchClass` / `refreshLitFromEnergy`
  index labels by pitch class (0 = A); they must resolve to the slot, not a
  single span.
- Labels are positioned by `layoutLabels()` (pitch-class index → angle). Both
  stacked spans of an accidental share the same position.
- The respell update runs in the render loop (where `estimatedKey` is already
  refreshed each frame) — no new estimator/speller code; reuse `KS.spell` and
  `estimatedKey`.

## Out of scope

The 7 natural labels (never change). The centre chord/note readout (already
key-aware). The estimator/speller logic (reused as-is).
