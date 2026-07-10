# Mic-mode chord stability + key-aware note spelling

**Date:** 2026-07-10
**Status:** Approved, ready for planning
**Scope:** web front-end only (`web/js/`)

## Problem

Two unrelated readout complaints, both surfacing in the centre chord/note text:

1. **Mic-mode jitter.** `main.js` writes `mic.detectChordName()` to the DOM every
   animation frame. The fuzzy estimator (`mic-input.js` `detectChord`) returns a
   best-scoring chord whenever energy clears a floor and `frac >= 0.5`, so the
   displayed name flickers frame-to-frame on noisy or ambiguous spectra — it
   reacts to noise instead of showing something the detector is confident in.
   This is a mic-only problem; MIDI mode is exact and correctly unfiltered.

2. **Context-blind spelling.** Both paths hard-code an all-sharps table
   (`chord.js` `PC_NAMES`, `mic-input.js` `NOTE_NAMES`). Pitch class 10 always
   prints "A#", never "Bb", with no key context. In most real keys that pitch is
   spelled Bb; A# only belongs in sharp-heavy keys (B major, F# minor, …). There
   is no key tracking, so every accidental defaults to a sharp regardless of the
   surrounding music.

## Design

Two independent pieces. Neither changes exact-MIDI chord *matching*, the DSP
stack, colours, or the visualizer.

### Piece 1 — Mic-mode chord confidence + hysteresis

A stabilizer sits between the fuzzy `detectChord()` estimate and the DOM and
decides what to *display* from the per-frame `{ name, conf }`:

- **Min-confidence gate:** a candidate with `conf < minConfidence` is treated as
  "no chord" (nothing shown).
- **Hold hysteresis (asymmetric):** a *new* candidate must persist continuously
  for `holdMs` before it replaces what is shown; the currently-shown chord stays
  until a *different* candidate wins that same hold, or until confidence stays
  below the gate for `holdMs`. Timing uses the `now` (seconds) already threaded
  through `analyse()` — no wall-clock calls.

**Interface (resolves the fact that `detectChord`'s `{name, conf}` is currently
private — only `detectChordName` is exposed).** The stabilizer lives *inside*
`mic-input.js` and holds its own committed-name + timer state. `analyse(now, out)`
already runs every frame and already has `now`, so it drives the stabilizer each
frame from the fresh `detectChord()` result. `createMicInput` exposes a single
`estimateStableChordName()` returning the *committed* string (replacing the
per-frame `detectChordName` call in `main.js`). The raw `conf` never crosses the
module boundary. The stabilizer's committed name and timers **reset on
`enable()`/`disable()`** so a stale chord can't reappear after a mode switch.

**Live dials (debug panel).** All four dials across both pieces:

| dial | piece | default | range (suggested) |
|------|-------|---------|-------------------|
| `holdMs` | mic chord | **120 ms** | 0 … 500 ms |
| `minConfidence` | mic chord | **0.6** | 0.4 … 0.9 |
| key half-life (MIDI) | key est. | **2 s** | 0.5 … 6 s |
| key half-life (mic) | key est. | **4 s** | 1 … 8 s |
| key-confidence threshold | key est. | *(tune in impl.)* | winner's lead over runner-up |

The two half-lives reflect evidence quality: MIDI note-ons are clean discrete
events, so the key settles (and spelling respells) faster; the mic feed is
noisier and holds a longer window. The estimator applies whichever half-life
matches the active mode. Note this affects only **spelling** latency — MIDI chord
*matching* is always instant (no hysteresis on the MIDI path; the mic
stabilizer's `holdMs` never runs in MIDI mode).

### Piece 2 — Key-aware note spelling

New module `web/js/key-spelling.js`, two parts.

**Pitch-class convention (resolves the 0=A vs 0=C clash).** `chord.js`, `main.js`,
and MIDI use **index 0 = C** (`pc = midi % 12`). `mic-input.js` and
`note-colours.js` use **index 0 = A** (`NOTE_NAMES` / `PITCH_CLASSES`,
`out.pcEnergy`). `key-spelling.js` works **internally in 0 = C** (Krumhansl
profiles, MIDI, and `chord.js` all use it; only mic is the outlier). Both mic
feeds convert before crossing in: `pcC = (pcA + 9) % 12` (0=A index 0 is A, which
sits at pc 9 in 0=C — verify: pcA 3 = C → pcC (3+9)%12 = 0 = C). This
conversion is an explicit, named step — applied to `pcEnergy` before feeding the
estimator, and to `detectChord`'s `root` (0=A) before it calls `Speller.spell`.

**`KeyEstimator`** — a 12-bin time-decayed pitch-class histogram (0 = C).

- **Feed (per-note weighting; continuous, no "which note is the bass"
  bookkeeping — every held note contributes, weighted by pitch height):**
  - **MIDI:** on each note-on, add weight = **bass-primary, velocity-secondary** —
    a lower MIDI note contributes more (bass is the strongest key evidence),
    scaled up by velocity. Once per note-on event, so a long-held note does not
    accumulate forever.
  - **Mic:** each frame, add per pitch class weight = **energy-primary,
    bass-secondary** — the pitch class's `pcEnergy` magnitude dominates, boosted
    for low-frequency content (mic bass is muddier than a clean MIDI note, so
    energy leads). The fold already computes an octave position `o` (0 = low … 1
    = high) per bin, so the low boost is `≈ (1 + k*(1-o))`. Normalized/bounded so
    a sustained chord contributes steady, not ever-growing, weight.

  Both feeds decay the whole histogram on the clock toward zero. The feeds are
  **mutually exclusive** (mode gate in `main.js`), so they never mix; the
  histogram **resets on mode switch** (matches `setMode`'s existing "clear
  lingering state" behaviour) so a stale key doesn't mis-spell the new input for
  several half-lives.
- **Estimate.** Pearson-correlate the histogram against the 24
  Krumhansl-Schmuckler key profiles (12 major + 12 minor). Winner = estimated
  key. Report **undecided** (→ flat-default spelling) when total weight is below a
  floor, or the top correlation does not lead the runner-up by the
  **key-confidence threshold** (below). Correlation is scale-invariant, so the
  threshold is feed-independent; only the low-weight floor is on the normalized
  total. Method is named `estimateKey()` (a guess, per naming rules).
- **Dials (debug panel):** decay half-life, **per mode** (MIDI default **2 s**,
  mic default **4 s** — the estimator uses the active mode's value); key-
  confidence threshold — how far ahead the winning key must lead before it is
  trusted over the flat default.

**`Speller`** — `spell(pc, estimatedKey)` → note name, `pc` in 0 = C.

- **Keyed spelling:** a static **24×12 table** generated once from the circle of
  fifths — diatonic degrees take the key's natural spelling; chromatic degrees
  take the conventional accidental for that key.
- **Undecided fallback:** a fixed 12-name default table (pc 0 = C):

  ```
  C  F  Bb  Eb  Ab  Db  Gb  B  E  A  D  G     (indexed by pitch class, 0 = C)
  ```

  This replaces today's all-sharps default. Note it is **not** pure flats: B, E,
  A, D, G stay natural; the five accidentals are all flats (pc 6 = **Gb**, not
  F#, consistent with the existing chromesthesia colour spelling in
  `note-colours.js`, which already uses Gb). Defined directly as above rather than
  derived, though it coincides with `SHARP_TO_FLAT` applied to the sharps.

- **Reuse (per "no duplication"):** the existing `SHARP_TO_FLAT` map and the
  colour `circle_of_fifths` in `note-colours.js` are a *colour* ordering
  (enharmonic-arbitrary — one name per pitch class for colour identity), **not** a
  key-spelling ordering (which needs per-key enharmonic choices, e.g. F# in G
  major vs Gb in Db major). So the keyed 24×12 table is genuinely new; only the
  undecided default overlaps the existing flat convention and is defined to match
  it.

### Wiring

- `main.js` feeds the estimator: a bass/velocity-weighted note-on weight in
  `noteOn()`; converted `pcEnergy` each mic frame in the render loop. Each frame
  it reads `estimateKey()` and passes the guess to the readout.
- `chord.js` replaces its `PC_NAMES[...]` lookups with
  `Speller.spell(pc, estimatedKey)`, so **both** the note-name readout **and**
  chord names respell (a Bb-major triad reads "Bb", not "A#").
  `nameFromMidiNotes` / `chordNames` / `impliedChord` take `estimatedKey` as a
  parameter (named to signal it is a *guess*, not ground truth).
- **`chord.js` header-contract change.** The file header currently promises "the
  readout reflects exactly what is held, instantly … NO filtering or smoothing."
  Exact-chord *matching* stays instant, but *spelling* can now lag as the key
  fills in. The header comment must be updated to say so, so the invariant isn't
  misread by the next reader.
- `mic-input.js` `detectChord` routes its root (converted 0=A → 0=C) through the
  same `Speller` so mic chord names match the note-name spelling.
- The new mic/key dials (`holdMs`, `minConfidence`, half-life, key-confidence
  threshold) live on a small settings object, **separate** from the cel-shading
  `params` the debug panel owns, because they drive `mic-input.js` /
  `key-spelling.js`, not the visualizer. To avoid touching `debug-panel.js`'s
  single-`params` core, use a **second `DebugPanel` instance** with its own
  container, `STORAGE_KEY`, and `onChange`, rendering a "Mic Chord" section
  (`holdMs`, `minConfidence`) and a "Key" section (half-life, key-confidence
  threshold). This requires making the panel's `SECTIONS` a constructor argument
  rather than a module constant, so the two instances render different controls.
  These are the first mic controls in the panel.

### Data flow

```
note-on (bass+vel wt) / mic pcEnergy (0=A→0=C) ─► KeyEstimator (decayed hist, 0=C) ─► estimateKey() ─┐
                                                                                                     ▼
held notes / chord match ──────────────────────────────────────────► Speller.spell(pc, estimatedKey) ─► readout
mic frame ─► detectChord {name,conf} ─► stabilizer(holdMs, minConf) inside mic-input ─► estimateStableChordName() ─► mic readout
```

## Testing

- **`key-spelling.test.js`** (new):
  - histogram weight halves over one half-life of elapsed time;
  - a C-major note stream estimates C major;
  - a low (bass) note-on moves the estimate more than the same-velocity note an
    octave up, and a louder note-on moves it more than a quiet one at the same
    pitch (verifies bass-primary / velocity-secondary MIDI weighting);
  - under an F-major estimate, pc 10 spells "Bb"; under B-major, pc 10 spells "A#";
  - the undecided state spells the fixed default table
    (`C F Bb Eb Ab Db Gb B E A D G`, pc 0 = C) — in particular pc 6 = "Gb";
  - each key's seven *diatonic* degrees use the seven letters A–G exactly once
    (the standard no-double-letter rule for the scale; chromatic degrees may
    reuse a letter with an accidental);
  - resetting the estimator clears the histogram (mode-switch behaviour).
- **`chord.test.js`** (existing): extend so a Bb-major triad names "Bb" under an
  F-major key context and never emits "A#" there.
- **Stabilizer** (unit test): a one-frame competing candidate does *not* flip the
  display; a candidate held past `holdMs` does; a sub-`minConfidence` candidate
  never shows; reset clears the committed name.

## Consequences (accepted)

1. A note's *spelling* can change after it is played, as key context fills in —
   sooner in MIDI (~1 s, shorter half-life) than mic (~2 s). Musically correct
   (the same pitch genuinely respells once the key is clear); the readout is not
   frozen at press-time. This is the only thing that lags in MIDI mode — chord
   *matching* stays instant.
2. Mic chord changes lag by up to `holdMs` (120 ms default). This is the
   anti-jitter mechanism working; `holdMs` is tunable live to trade lag against
   stability.

## Implementation sequencing

The two pieces share no code except the debug-panel additions, so implement and
verify **Piece 1 first** (the flicker fix — small, low-risk, needs only the
stabilizer-interface decision above) and **Piece 2 second** (the larger,
theory-heavy key estimator + speller). Piece 2's open tuning (key-confidence
threshold, mic low-frequency boost `k`) should not hold the flicker fix hostage.

## Out of scope

Exact-MIDI chord *matching* logic, DSP stack, note colours, visualizer. MIDI
chord *timing* stays instant — no hysteresis on the MIDI path; only spelling can
lag as the key fills in.
