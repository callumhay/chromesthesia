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

A `ChordStabilizer` sits between `mic.detectChord()` and the DOM and decides what
to *display* from the per-frame `{ name, conf }`:

- **Min-confidence gate:** a candidate with `conf < minConfidence` is treated as
  "no chord" (nothing shown).
- **Hold hysteresis (asymmetric):** a *new* candidate must persist continuously
  for `holdMs` before it replaces what is shown; the currently-shown chord stays
  until a *different* candidate wins that same hold, or until confidence stays
  below the gate for `holdMs`. Timing uses the `now` (seconds) already threaded
  through `analyse()` — no wall-clock calls.

Lives in `mic-input.js` (mic-specific). `main.js` feeds it the current frame's
detection and displays the stabilizer's committed result instead of the raw
name.

**Live dials (debug panel):**

| dial | default | range (suggested) |
|------|---------|-------------------|
| `holdMs` | **120 ms** | 0 … 500 ms |
| `minConfidence` | **0.6** | 0.4 … 0.9 |

### Piece 2 — Key-aware note spelling

New module `web/js/key-spelling.js`, two parts.

**`KeyEstimator`** — a 12-bin time-decayed pitch-class histogram.

- **Feed.** MIDI adds a fixed weight per **note-on** (once per event, so a
  long-held note does not over-anchor the key). Mic adds normalized `pcEnergy`
  per frame (bounded so a sustained chord contributes steady, not ever-growing,
  weight). Both decay on the clock toward zero.
- **Estimate.** Correlate the histogram against the 24 Krumhansl-Schmuckler key
  profiles (12 major + 12 minor). Winner = estimated key. If total weight is too
  low, or the top correlation is too weak / too close to the runner-up, report
  **undecided**.
- **Dial.** decay half-life — default **4 s** (debug panel).

**`Speller`** — a static **24×12 spelling table** generated once from the circle
of fifths. `spell(pc, key)` → note name. Diatonic degrees take the key's natural
spelling; chromatic degrees take the conventional accidental for that key. When
the estimator is **undecided**, fall back to a **flat-default** table
(Bb, Eb, Ab, Db, Gb), replacing today's all-sharps default (a better neutral
guess, since flats are statistically more common).

### Wiring

- `main.js` feeds the estimator: a note-on weight in `noteOn()`; `pcEnergy` each
  mic frame in the render loop. Each frame it reads the current estimated key and
  passes it to the readout.
- `chord.js` replaces its `PC_NAMES[...]` lookups with `Speller.spell(pc, key)`,
  so **both** the note-name readout **and** chord names respell (a Bb-major triad
  reads "Bb", not "A#"). `nameFromMidiNotes` / `chordNames` / `impliedChord` take
  the current key as a parameter.
- `mic-input.js` `detectChord` routes its root spelling through the same
  `Speller` so mic chord names match.
- The new mic dials (`holdMs`, `minConfidence`, half-life) live on a small
  mic-settings object, **separate** from the cel-shading `params` the debug panel
  currently owns, because they drive `mic-input.js` / `key-spelling.js`, not the
  visualizer. The panel gains a "Mic Chord" section (two sliders) and a "Key"
  section (one slider). These are the first mic controls in the panel.

### Data flow

```
note-on / mic pcEnergy ─► KeyEstimator (decayed histogram) ─► estimated key ─┐
                                                                             ▼
held notes / chord match ─────────────────────────────► Speller.spell(pc, key) ─► readout
mic frame ─► detectChord {name,conf} ─► ChordStabilizer(holdMs, minConf) ─► mic chord readout
```

## Testing

- **`key-spelling.test.js`** (new):
  - histogram weight halves over one half-life of elapsed time;
  - a C-major note stream estimates C major;
  - under an F-major estimate, pc 10 spells "Bb"; under B-major, pc 10 spells "A#";
  - the undecided state uses the flat-default table;
  - the generated 24×12 table uses each letter A–G at most once per key (no
    double-letter collisions).
- **`chord.test.js`** (existing): extend so a Bb-major triad names "Bb" under an
  F-major key context and never emits "A#" there.
- **ChordStabilizer** (unit test, in mic tests or its own file): a one-frame
  competing candidate does *not* flip the display; a candidate held past
  `holdMs` does; a sub-`minConfidence` candidate never shows.

## Consequences (accepted)

1. A note's *spelling* can change ~1–2 s after it is played, as key context fills
   in. Musically correct (the same pitch genuinely respells once the key is
   clear); the readout is not frozen at press-time.
2. Mic chord changes lag by up to `holdMs` (120 ms default). This is the
   anti-jitter mechanism working; `holdMs` is tunable live to trade lag against
   stability.

## Out of scope

Exact-MIDI chord *matching* logic, DSP stack, note colours, visualizer. MIDI
chord *timing* stays instant — no hysteresis on the MIDI path; only spelling can
lag as the key fills in.
