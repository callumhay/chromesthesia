# Centralize the chord vocabulary and naming engine

**Date:** 2026-07-15
**Status:** Approved, ready for planning
**Scope:** web front-end — `web/js/chord.js`, `web/js/mic-input.js`, `web/js/main.js`,
a new `web/js/chord-qualities.js`, and tests.

## Problem

Chord knowledge is duplicated across three hand-maintained lists:

- `chord.js` `QUALITIES` (13 chords, exact MIDI match)
- `chord.js` `IMPLIED` (the same 13 intervals again, plus `required`/`min`)
- `mic-input.js` `QUALITIES` (a stale 9-chord subset — missing `ø7`, `dim7`,
  `6`, `m6`)

Because the mic detector has its own copy, it **cannot detect half-diminished
(ø7), diminished-7 (dim7), 6, or m6 at all** — and it has never shown the slash
aliases (C6 / Am7, Bø7 / Dm6) that the MIDI path shows, because all naming logic
(aliases, key-aware spelling, root choice) lives only in `chord.js` and the mic
path reinvents naming badly (a single winner string, no aliases, its own spell
call).

Adding a chord today means editing three lists and hoping they stay in sync. They
haven't.

## Design

Unify by **centralizing functionality, not duplicating it**: one vocabulary
list, one naming engine, and reduce the mic path to a thin front-end that *calls*
the engine.

### 1. `chord-qualities.js` — the single vocabulary (new file)

One array of `{ name, ivs, required, min }` (13 chords). `ivs` are
semitones-from-root (convention-independent). `required`/`min` are the
implied-match rules (ignored by consumers that don't do partial matching).
Exported as `window.ChordQualities` / `module.exports`. There is **no**
mic-specific copy.

### 2. `chord.js` — the single naming engine

`chord.js` becomes the one place that turns notes into a display name. Its core
is re-keyed off a **pitch-class set + bass pitch class + estimated key**, not raw
MIDI notes:

```
nameFromPitchClasses(pcSet, bassPc, estimatedKey) -> "Bø7 / Dm6"
```

- All existing behaviour — exact match, implied match, alias/slash resolution
  (`chordNames`), key-aware spelling — lives behind this entry point and reads
  the shared vocabulary from `chord-qualities.js`.
- `nameFromMidiNotes(midiNotes, key)` becomes a thin wrapper: derive
  `{ pcSet, bassPc }` from the MIDI notes (bass = lowest held note's pc) and call
  `nameFromPitchClasses`.
- A parallel wrapper names a mic-detected chord (see below) through the *same*
  engine, so mic gets aliases, spelling, and dim7 root handling for free.

### 3. Mic keeps fuzzy DETECTION, delegates all NAMING (option b)

`mic-input.js`'s `detectChord` keeps its fuzzy template scoring (its strength on
noisy/partial chroma), but:

- It scores against the shared `chord-qualities.js` list, so it can now match all
  13 chords (gains ø7, dim7, 6, m6).
- It stops building a name string and stops calling the speller. Instead it
  produces the detected chord's **pitch-class set** (root + quality's `ivs`) plus
  the **bass pitch class**, and passes them to `chord.js`'s
  `nameFromPitchClasses`. So the mic readout now shows slash aliases and
  key-aware spelling identical to MIDI.
- Its local `QUALITIES`, its `spell` call, and its name assembly are deleted.

### 4. Bass pitch class for mic

The chroma folds octaves away, but the raw FFT still has low-frequency energy.
`foldBand` already walks bins low→high (`f = i * hz`). Track the **lowest-
frequency pitch class carrying significant energy** and expose it as the mic
bass pc — used for slash-alias ordering and the dim7 fallback root. (MIDI's bass
is the lowest held note's pc.)

### 5. dim7 root selection (in the engine — both paths)

dim7 is symmetric: 4 possible roots a minor third apart. Choose the display root
(the one shown first; the other three follow with slashes) by:

1. **Key known AND the key's leading tone (tonic − 1 semitone) is one of the 4
   roots** → root on the leading tone (the typical vii°7). Spelled per the key
   (e.g. A minor → **G#dim7**, sharp, not Ab).
2. **Otherwise** (no key, or none of the 4 roots is the key's leading tone) →
   **fall back to the bass** pitch class as the root shown first.

Verified: A-minor G#/B/D/F → G#dim7 first; same notes in C major → Bdim7 first
(B is C major's leading tone); C-major non-diatonic dim7 (Db/E/G/Bb, no leading
tone present) → fall back to bass.

## What this fixes

- Mic detects all 13 chords (ø7, dim7, 6, m6 included).
- Mic shows slash aliases (C6 / Am7, Bø7 / Dm6) like MIDI, via the shared engine.
- dim7 spelled on the key-typical root (leading tone) or the bass, consistently
  in both modes.
- One vocabulary list and one naming engine — adding a chord is a single row.

## Explicitly NOT changed

- Mic **detection method** stays fuzzy template scoring (option b) — no
  behavioural gamble on turning noisy chroma into a hard pc-set.
- The MIDI exact/implied matching behaviour and its existing test expectations.
- The estimator/speller (reused as-is).

## Risks / test focus

- The shared engine must accept a pc-set and produce identical output to today's
  `nameFromMidiNotes` for MIDI (regression: all existing chord tests must pass
  unchanged).
- The four newly-enabled mic chords include symmetric/duplicate cases (dim7
  symmetric; 6 = m7 inversion; ø7 = m6 inversion) — test that the mic fuzzy
  scorer picks sensible roots and the engine names the aliases correctly.
- dim7 root selection needs unit tests for all three cases above (leading-tone
  present in key, leading-tone absent → bass, no key → bass).
