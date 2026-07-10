# Chord Stability + Key-Aware Spelling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop mic-mode chord-name flicker, and spell note/chord accidentals per an estimated key (Bb vs A#) instead of always sharp.

**Architecture:** Two independent pieces. (1) A confidence + hold-hysteresis stabilizer inside `mic-input.js` that gates the fuzzy chord estimate before it reaches the DOM. (2) A new `key-spelling.js` module: a time-decayed pitch-class histogram (Krumhansl-Schmuckler key estimate) feeding a circle-of-fifths speller; both `chord.js` and `mic-input.js` route note/root spelling through it. All new tunables are live dials in a second `DebugPanel` instance.

**Tech Stack:** Plain browser JS (no build, no framework). Tests are plain Node scripts run with `node web/js/<name>.test.js` using the built-in `assert` module and a tiny inline `test()` helper (see existing `web/js/chord.test.js`). Pitch-class convention: `key-spelling.js` works internally in **index 0 = C**; the mic feed (0 = A) converts with `pcC = (pcA + 9) % 12` (0=A index 0 is A = pc 9 in 0=C).

---

## File Structure

- **Create `web/js/key-spelling.js`** — `createKeyEstimator()` (decayed histogram + `estimateKey()`) and `spell(pc, estimatedKey)` + `DEFAULT_SPELLING`. Internal convention 0 = C. No DOM, no globals; exported for both Node tests and the browser.
- **Create `web/js/key-spelling.test.js`** — Node tests for decay, key estimate, weighting, spelling, reset.
- **Create `web/js/mic-chord-stabilizer.test.js`** — Node tests for the stabilizer's hysteresis/confidence gate (the stabilizer itself lives in `mic-input.js` but is exported for testing).
- **Modify `web/js/mic-input.js`** — add the stabilizer (fed inside `analyse`, exposed as `estimateStableChordName()`); route `detectChord`'s root through `spell()`; export the stabilizer factory for tests.
- **Modify `web/js/chord.js`** — thread `estimatedKey` through `nameFromMidiNotes`/`chordNames`/`impliedChord`/`ChordReadout.update`; replace `PC_NAMES[...]` display lookups with `spell()`; update the header contract comment.
- **Modify `web/js/chord.test.js`** — add a key-context spelling test.
- **Modify `web/js/debug-panel.js`** — make `SECTIONS` a constructor argument (defaulting to the existing cel sections) so a second instance can render different controls.
- **Modify `web/js/main.js`** — build the key estimator; feed it (note-on weight in `noteOn`, converted `pcEnergy` per mic frame); pass the key guess to the readout; reset estimator + stabilizer on mode switch; add the second `DebugPanel` for mic/key dials.
- **Modify `web/index.html`** — add the two `<script>` tags (`key-spelling.js`) and a container for the second panel.

**Sequencing:** Piece 1 (Tasks 1–2) first — it is the flicker fix and is fully independent. Piece 2 (Tasks 3–8) second.

---

## PIECE 1 — Mic-mode chord stabilizer

### Task 1: Chord stabilizer (confidence gate + asymmetric hold hysteresis)

**Files:**
- Modify: `web/js/mic-input.js` (add `createChordStabilizer`, export it)
- Test: `web/js/mic-chord-stabilizer.test.js` (create)

The stabilizer takes a per-frame `(now, name, conf)` where `now` is seconds, `name` is the raw estimate (or `null`), and `conf` is 0..1. It returns the *committed* name string (or `''`). Rules:
- A candidate with `conf < minConfidence` counts as `null` (no candidate this frame).
- The **shown** name only changes to a new candidate after that same candidate has been the frame candidate continuously for `holdMs`. Clearing (to `''`) also requires the candidate to have been `null` continuously for `holdMs`.
- `settings` (`{ holdMs, minConfidence }`) is read live each call so the dials take effect immediately.
- `reset()` clears shown name and timers.

- [ ] **Step 1: Write the failing test**

Create `web/js/mic-chord-stabilizer.test.js`:

```javascript
// Unit tests for the mic-mode chord stabilizer. Runs on plain Node:
//   node web/js/mic-chord-stabilizer.test.js
//
// The stabilizer gates the fuzzy per-frame chord estimate so the readout does
// not flicker: a candidate must hold for holdMs before it is shown, and the
// shown chord only clears after holdMs of no candidate. Sub-minConfidence
// candidates are treated as no candidate.
'use strict';
const assert = require('assert');
const { createChordStabilizer } = require('./mic-input.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// holdMs 100 => a candidate must persist 0.1s before showing.
function mk() {
  const settings = { holdMs: 100, minConfidence: 0.6 };
  return { s: createChordStabilizer(() => settings), settings };
}

test('nothing shown before holdMs elapses', () => {
  const { s } = mk();
  assert.strictEqual(s.update(0.00, 'C', 0.9), '');   // t=0 candidate appears
  assert.strictEqual(s.update(0.05, 'C', 0.9), '');   // 50ms < 100ms
});

test('candidate held past holdMs is shown', () => {
  const { s } = mk();
  s.update(0.00, 'C', 0.9);
  assert.strictEqual(s.update(0.12, 'C', 0.9), 'C');  // 120ms >= 100ms
});

test('a one-frame competing candidate does NOT flip the display', () => {
  const { s } = mk();
  s.update(0.00, 'C', 0.9);
  s.update(0.12, 'C', 0.9);                            // C now shown
  assert.strictEqual(s.update(0.13, 'G', 0.9), 'C');   // G appears for 1 frame
  assert.strictEqual(s.update(0.14, 'C', 0.9), 'C');   // back to C: never flipped
});

test('a genuinely-held new candidate replaces the shown one after holdMs', () => {
  const { s } = mk();
  s.update(0.00, 'C', 0.9); s.update(0.12, 'C', 0.9);  // C shown
  s.update(0.13, 'G', 0.9);                            // G candidate starts
  assert.strictEqual(s.update(0.20, 'G', 0.9), 'C');   // 70ms of G < 100ms
  assert.strictEqual(s.update(0.24, 'G', 0.9), 'G');   // 110ms of G >= 100ms
});

test('a sub-minConfidence candidate never shows', () => {
  const { s } = mk();
  s.update(0.00, 'C', 0.4);
  assert.strictEqual(s.update(0.30, 'C', 0.4), '');    // conf 0.4 < 0.6
});

test('shown chord clears only after holdMs of no candidate', () => {
  const { s } = mk();
  s.update(0.00, 'C', 0.9); s.update(0.12, 'C', 0.9);  // C shown
  s.update(0.13, null, 0);                             // candidate gone
  assert.strictEqual(s.update(0.20, null, 0), 'C');    // 70ms gone < 100ms
  assert.strictEqual(s.update(0.24, null, 0), '');     // 110ms gone >= 100ms
});

test('reset clears the committed name', () => {
  const { s } = mk();
  s.update(0.00, 'C', 0.9); s.update(0.12, 'C', 0.9);  // C shown
  s.reset();
  assert.strictEqual(s.update(0.13, null, 0), '');
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/js/mic-chord-stabilizer.test.js`
Expected: FAIL — `createChordStabilizer is not a function` (not yet exported).

- [ ] **Step 3: Implement `createChordStabilizer` in `mic-input.js`**

Add this factory at module scope in `web/js/mic-input.js` (above `createMicInput`, or just below the `'use strict';` line):

```javascript
// Confidence gate + asymmetric hold hysteresis over the fuzzy per-frame chord
// estimate, so the mic readout does not flicker. getSettings() returns live
// { holdMs, minConfidence } so debug-panel changes take effect immediately.
// update(now, name, conf) -> the committed display string ('' = show nothing);
// now is in SECONDS.
function createChordStabilizer(getSettings) {
  let shown = '';            // currently displayed name ('' = nothing)
  let cand = null;           // candidate we're timing toward ('' = the "clear" candidate)
  let candSince = 0;         // when `cand` first appeared (seconds)

  function update(now, name, conf) {
    const { holdMs, minConfidence } = getSettings();
    // sub-confidence => no candidate this frame; '' is the "clear" candidate
    const frame = (name && conf >= minConfidence) ? name : '';
    if (frame !== cand) { cand = frame; candSince = now; }
    if (cand !== shown && (now - candSince) * 1000 >= holdMs) shown = cand;
    return shown;
  }
  function reset() { shown = ''; cand = null; candSince = 0; }
  return { update, reset };
}
```

Then export it. Update the bottom-of-file exports:

```javascript
if (typeof window !== 'undefined') window.createMicInput = createMicInput;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createMicInput, createChordStabilizer };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node web/js/mic-chord-stabilizer.test.js`
Expected: PASS — `7 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/js/mic-input.js web/js/mic-chord-stabilizer.test.js
git commit -m "feat: mic chord stabilizer (confidence gate + hold hysteresis)"
```

---

### Task 2: Wire the stabilizer into the mic pipeline + expose the committed name

**Files:**
- Modify: `web/js/mic-input.js` (instantiate stabilizer, drive it in `analyse`, add `estimateStableChordName`, reset on enable/disable, accept a settings source)
- Modify: `web/js/main.js` (create mic settings object; call `estimateStableChordName()` instead of `detectChordName()`; reset handled by mode switch in Task 8)

`createMicInput` gains a `chordSettings` object (defaults `{ holdMs: 120, minConfidence: 0.6 }`) exposed like `dsp`, so the debug panel can mutate it live. `analyse` runs `detectChord()` and feeds `{now, name, conf}` to the stabilizer each frame; `estimateStableChordName()` returns the committed string.

- [ ] **Step 1: Add stabilizer state + settings to `createMicInput`**

In `web/js/mic-input.js`, near the `dsp` declaration (around line 76), add:

```javascript
  // mic chord readout stabilizer settings (mutated live by the debug panel)
  const chordSettings = { holdMs: 120, minConfidence: 0.6 };
  const stabilizer = createChordStabilizer(() => chordSettings);
  let lastStableName = '';
```

- [ ] **Step 2: Drive the stabilizer inside `analyse`**

In `analyse(now, out)`, after `out.level = state.level;` (end of the function, around line 458), add:

```javascript
    // gate the fuzzy chord estimate so the readout does not flicker
    const det = detectChord();
    lastStableName = stabilizer.update(now, det ? det.name : null, det ? det.conf : 0);
```

- [ ] **Step 3: Add `estimateStableChordName`, reset on enable/disable, export settings**

Reset the stabilizer in `enable()` (after `micAna = ...`) and `disable()` (after clearing refs):

```javascript
    stabilizer.reset(); lastStableName = '';
```

Replace the public wrapper `detectChordName` region and the returned object so it exposes the stable name and settings. Change the return of `createMicInput` to:

```javascript
  // committed, flicker-free chord name for display (updated each analyse())
  function estimateStableChordName() { return lastStableName; }

  return {
    enable,
    disable,
    analyse,
    detectChordName,          // raw per-frame estimate (kept; used by nothing UI now)
    estimateStableChordName,  // stabilized name for the readout
    dsp,
    chordSettings,
  };
```

(Leave `detectChord`/`detectChordName` as-is; `detectChordName` is still exported for completeness but `main.js` will stop using it.)

- [ ] **Step 4: Use the stable name in `main.js`**

In `web/js/main.js`, in the render loop's mic branch (lines 193-198), replace:

```javascript
      // mic chord is a fuzzy ESTIMATE from the smoothed spectrum
      const name = mic.detectChordName();
      if (name !== chordEl.textContent) {
        chordEl.textContent = name || '';
        chordEl.style.opacity = name ? '1' : '0';
      }
```

with:

```javascript
      // stabilized (flicker-free) chord name; stabilizer ran inside analyse()
      const name = mic.estimateStableChordName();
      if (name !== chordEl.textContent) {
        chordEl.textContent = name || '';
        chordEl.style.opacity = name ? '1' : '0';
      }
```

- [ ] **Step 5: Verify existing tests still pass and the app loads**

Run: `node web/js/mic-chord-stabilizer.test.js`
Expected: PASS — `7 passed` (unchanged).

Manual check (mic-input.js has no DOM-free entry for `analyse`, so this is a load check): open `web/index.html` served locally, switch to Mic, confirm the chord readout no longer flickers frame-to-frame and settles within ~120ms. (Serve with `python3 -m http.server` from `web/` or open the deployed Pages URL.)

- [ ] **Step 6: Commit**

```bash
git add web/js/mic-input.js web/js/main.js
git commit -m "feat: use stabilized mic chord name in the readout"
```

---

## PIECE 2 — Key-aware note spelling

### Task 3: `key-spelling.js` — the speller (24×12 keyed table + fixed default)

**Files:**
- Create: `web/js/key-spelling.js`
- Test: `web/js/key-spelling.test.js` (create)

Pitch classes are **0 = C** throughout this module. A "key" is `{ tonic, mode }` where `tonic` is 0..11 (0 = C) and `mode` is `'major'` or `'minor'`; `null` key means undecided → the fixed default table.

The keyed table is generated from each key's **key signature**: walk the seven letters from the tonic letter, spelling each diatonic degree with the accidental that brings its letter to the degree's pitch class. Chromatic (non-diatonic) notes take the conventional directional spelling — sharps in sharp keys, flats in flat keys — rather than letter-adjacency (which would yield ugly `Cb`/`B#`/double accidentals). A whole-key fallback to the plain directional table guards the rare theoretical keys where a diatonic degree would need a double accidental. This generator is **verified** against the Step-1 contract (see below); ship it as written.

- [ ] **Step 1: Write the failing test**

Create `web/js/key-spelling.test.js`:

```javascript
// Unit tests for key-spelling.js. Runs on plain Node:
//   node web/js/key-spelling.test.js
//
// Pitch classes are index 0 = C throughout. spell(pc, key) returns a note name;
// key = { tonic, mode } (tonic 0..11, 0 = C) or null (undecided => flat default).
'use strict';
const assert = require('assert');
const { spell, DEFAULT_SPELLING } = require('./key-spelling.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const C = 0, F = 5, Bb = 10, B = 11;

test('undecided (null key) uses the fixed default table', () => {
  const expect = ['C','F','Bb','Eb','Ab','Db','Gb','B','E','A','D','G'];
  // DEFAULT_SPELLING is indexed by pitch class 0 = C:
  const byPc = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  for (let pc = 0; pc < 12; pc++) assert.strictEqual(spell(pc, null), byPc[pc]);
  // pc 6 must be Gb, not F#, and pc 10 must be Bb, not A#
  assert.strictEqual(spell(6, null), 'Gb');
  assert.strictEqual(spell(10, null), 'Bb');
  // (expect kept for reference: it is byPc reordered around the circle)
  void expect;
});

test('pc 10 spells Bb in F major, A# in B major', () => {
  assert.strictEqual(spell(Bb, { tonic: F, mode: 'major' }), 'Bb');
  assert.strictEqual(spell(Bb, { tonic: B, mode: 'major' }), 'A#');
});

test('C major spells the natural white keys naturally', () => {
  const cmaj = { tonic: C, mode: 'major' };
  assert.strictEqual(spell(0, cmaj), 'C');
  assert.strictEqual(spell(2, cmaj), 'D');
  assert.strictEqual(spell(4, cmaj), 'E');
  assert.strictEqual(spell(11, cmaj), 'B');
});

test('each key spells its 7 diatonic degrees with letters A-G exactly once', () => {
  const MAJOR = [0,2,4,5,7,9,11];
  const letters = (s) => s[0];
  for (let tonic = 0; tonic < 12; tonic++) {
    const key = { tonic, mode: 'major' };
    const used = MAJOR.map((iv) => letters(spell((tonic + iv) % 12, key)));
    const uniq = new Set(used);
    assert.strictEqual(uniq.size, 7,
      `major tonic ${tonic}: diatonic letters not unique -> ${used.join(',')}`);
  }
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/js/key-spelling.test.js`
Expected: FAIL — `Cannot find module './key-spelling.js'`.

- [ ] **Step 3: Implement the speller in `web/js/key-spelling.js`**

Create `web/js/key-spelling.js`:

```javascript
// key-spelling.js
//
// Key estimation (Krumhansl-Schmuckler) and key-aware note spelling. Pitch
// classes are index 0 = C throughout this module (pc = midi % 12). The mic feed
// uses 0 = A elsewhere and must convert with pcC = (pcA + 9) % 12 before calling
// in.
//
// spell(pc, key) -> note name. key = { tonic (0..11, 0=C), mode } or null.
// null (undecided) uses DEFAULT_SPELLING, a fixed neutral table that prefers
// flats for the five accidentals (pc 6 = Gb, pc 10 = Bb), matching the
// chromesthesia colour spelling in note-colours.js.

'use strict';

// Fixed default spelling, indexed by pitch class (0 = C). Not pure flats:
// B,E,A,D,G stay natural; the five accidentals are flats.
const DEFAULT_SPELLING =
  ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Plain directional tables, indexed by pc (0 = C): sharps for sharp keys, flats
// for flat keys. Used for chromatic (non-diatonic) notes and as a whole-key
// fallback for theoretical extremes.
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Each major key by its tonic pitch class (0 = C): tonic letter + key signature
// (number of sharps > 0 / flats < 0). pc 6 defaults to Gb (6 flats), matching
// the chromesthesia colour spelling; B major (5 sharps) still spells pc 10 as A#.
const MAJOR_KEYS = {
  0:  { L: 'C', sig: 0 },   7:  { L: 'G', sig: 1 },   2:  { L: 'D', sig: 2 },
  9:  { L: 'A', sig: 3 },   4:  { L: 'E', sig: 4 },   11: { L: 'B', sig: 5 },
  6:  { L: 'G', sig: -6 },  5:  { L: 'F', sig: -1 },  10: { L: 'B', sig: -2 },
  3:  { L: 'E', sig: -3 },  8:  { L: 'A', sig: -4 },  1:  { L: 'D', sig: -5 },
};

// Signed semitone offset (in [-6,6]) from a natural letter to a target pc.
function deltaToPc(letter, pc) {
  let d = ((pc - NATURAL_PC[letter]) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}
// Apply n sharps (n>0) / flats (n<0) to a letter name.
function accidental(letter, n) {
  return n === 0 ? letter : letter + (n > 0 ? '#'.repeat(n) : 'b'.repeat(-n));
}

// Build the 12-entry spelling table (indexed by pc, 0 = C) for the major key
// whose tonic is `tonicPc`. Diatonic degrees walk the seven letters from the
// tonic letter; chromatic notes take the plain directional spelling. If any
// diatonic degree needs a double accidental (theoretical extreme), fall back to
// the plain directional table for the whole key.
function buildMajorTable(tonicPc) {
  const { L, sig } = MAJOR_KEYS[tonicPc];
  const STEPS = [0, 2, 4, 5, 7, 9, 11];
  const li = LETTERS.indexOf(L);
  const table = new Array(12).fill(null);
  for (let d = 0; d < 7; d++) {
    const letter = LETTERS[(li + d) % 7];
    const degreePc = (tonicPc + STEPS[d]) % 12;
    table[degreePc] = accidental(letter, deltaToPc(letter, degreePc));
  }
  const chrom = sig >= 0 ? SHARP : FLAT;
  for (let pc = 0; pc < 12; pc++) if (!table[pc]) table[pc] = chrom[pc];
  for (let pc = 0; pc < 12; pc++) if (/##|bb/.test(table[pc])) return chrom.slice();
  return table;
}

// Spelling table for an estimated key (minor maps to its relative major).
function tableForKey(key) {
  if (!key) return DEFAULT_SPELLING;
  const majorTonic = key.mode === 'minor' ? (key.tonic + 3) % 12 : key.tonic;
  return buildMajorTable(((majorTonic % 12) + 12) % 12);
}

// spell(pc, key) -> note name. pc is 0 = C; key = { tonic, mode } or null.
function spell(pc, key) {
  return tableForKey(key)[((pc % 12) + 12) % 12];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spell, DEFAULT_SPELLING, tableForKey, buildMajorTable };
}
if (typeof window !== 'undefined') {
  window.KeySpelling = { spell, DEFAULT_SPELLING };
}
```

This generator is verified: `spell(10, F major)='Bb'`, `spell(10, B major)='A#'`,
`spell(6, null)='Gb'`, and the seven diatonic degrees of every major key use
letters A–G exactly once. F major spells `… A Bb B`, B major `… A A# B`, Gb major
keeps its proper `… Bb Cb`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node web/js/key-spelling.test.js`
Expected: PASS — `4 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/js/key-spelling.js web/js/key-spelling.test.js
git commit -m "feat: key-aware note speller (24x12 keyed table + flat default)"
```

---

### Task 4: `key-spelling.js` — the key estimator (decayed histogram + Krumhansl)

**Files:**
- Modify: `web/js/key-spelling.js` (add `createKeyEstimator`)
- Test: `web/js/key-spelling.test.js` (extend)

`createKeyEstimator()` returns `{ addNoteOn(midi, velocity), addMicEnergyPc(pcA, energy), decayTo(now), estimateKey(), reset(), settings }`. Pitch classes are 0 = C internally; `addMicEnergyPc` takes a **0 = A** pc and converts. `settings` holds `{ halfLifeMidiSec, halfLifeMicSec, confidenceMargin }`; the caller sets which half-life is active per mode via `decayTo`'s mode arg. `estimateKey()` Pearson-correlates the histogram against the 24 KS profiles and returns `{ tonic, mode }` or `null` when weak/ambiguous.

- [ ] **Step 1: Write the failing tests (append to `web/js/key-spelling.test.js`)**

Add before the final `console.log`:

```javascript
const { createKeyEstimator } = require('./key-spelling.js');

test('histogram weight halves over one MIDI half-life', () => {
  const est = createKeyEstimator();
  est.settings.halfLifeMidiSec = 2;
  est.addNoteOn(60, 1.0);                 // C4, full velocity, at t=0
  const w0 = est._weightForTest(0);       // pc 0 (C) weight right after
  est.decayTo(2.0, 'midi');               // advance one half-life
  const w1 = est._weightForTest(0);
  assert.ok(Math.abs(w1 / w0 - 0.5) < 0.02, `expected halving, got ${w1 / w0}`);
});

test('a C-major note stream estimates C major', () => {
  const est = createKeyEstimator();
  const CMAJ = [60, 62, 64, 65, 67, 69, 71, 72];   // C D E F G A B C
  let t = 0;
  for (let rep = 0; rep < 4; rep++) {
    for (const m of CMAJ) { est.addNoteOn(m, 0.9); est.decayTo(t += 0.1, 'midi'); }
  }
  const key = est.estimateKey();
  assert.deepStrictEqual(key, { tonic: 0, mode: 'major' });
});

test('a low bass note-on outweighs the same-velocity note an octave up', () => {
  const est = createKeyEstimator();
  est.addNoteOn(36, 0.8);   // low C
  const wLow = est._weightForTest(0);
  est.reset();
  est.addNoteOn(72, 0.8);   // high C, same velocity
  const wHigh = est._weightForTest(0);
  assert.ok(wLow > wHigh, `bass ${wLow} should outweigh treble ${wHigh}`);
});

test('a louder note-on outweighs a quiet one at the same pitch', () => {
  const est = createKeyEstimator();
  est.addNoteOn(60, 1.0); const loud = est._weightForTest(0);
  est.reset();
  est.addNoteOn(60, 0.2); const quiet = est._weightForTest(0);
  assert.ok(loud > quiet, `loud ${loud} should outweigh quiet ${quiet}`);
});

test('reset clears the histogram (mode-switch behaviour)', () => {
  const est = createKeyEstimator();
  est.addNoteOn(60, 1.0);
  est.reset();
  assert.strictEqual(est._weightForTest(0), 0);
  assert.strictEqual(est.estimateKey(), null);   // empty => undecided
});

test('mic energy on A (0=A pc 0) lands on pitch class 9 (A) internally', () => {
  const est = createKeyEstimator();
  est.addMicEnergyPc(0, 1.0);   // 0=A convention pc 0 == A == 0=C pc 9
  assert.ok(est._weightForTest(9) > 0);
  assert.strictEqual(est._weightForTest(0), 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/js/key-spelling.test.js`
Expected: FAIL — `createKeyEstimator is not a function`.

- [ ] **Step 3: Implement `createKeyEstimator` in `key-spelling.js`**

Add above the exports block:

```javascript
// Krumhansl-Schmuckler key profiles (major, minor), rotated so index 0 = tonic.
const KS_MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const KS_MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

// Pearson correlation of two length-12 vectors.
function corr(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den < 1e-12 ? 0 : num / den;
}

// Time-decayed pitch-class histogram (0 = C) + KS key estimate. Feeds:
//   addNoteOn(midi, velocity)      MIDI: bass-primary, velocity-secondary weight
//   addMicEnergyPc(pcA, energy)    mic:  energy-primary; pcA is 0=A, converted
//   decayTo(now, mode)             exponential decay to `now` using mode's half-life
//   estimateKey()                  -> { tonic, mode } or null (undecided)
function createKeyEstimator() {
  const hist = new Float32Array(12);           // 0 = C
  let lastT = 0;
  const settings = { halfLifeMidiSec: 2, halfLifeMicSec: 4, confidenceMargin: 0.03 };
  const MIN_TOTAL = 0.5;                        // below this => undecided

  // bass-primary weight: lower MIDI notes count more (linear falloff over the
  // 88-key range), times velocity. One deposit per note-on.
  function addNoteOn(midi, velocity) {
    const pc = ((midi % 12) + 12) % 12;
    const bass = Math.max(0.2, 1 - (midi - 21) / 87);   // ~1.0 at A0 .. ~0.2 top
    hist[pc] += bass * Math.max(velocity, 0.05);
  }
  // mic: energy dominates; pcA is 0=A, convert to 0=C. (Bass boost is applied by
  // the caller via per-bin octave position; here we take already-weighted energy.)
  function addMicEnergyPc(pcA, energy) {
    const pc = ((pcA + 9) % 12 + 12) % 12;      // 0=A -> 0=C (A is pc 9)
    hist[pc] += energy;
  }
  function decayTo(now, mode) {
    const hl = mode === 'mic' ? settings.halfLifeMicSec : settings.halfLifeMidiSec;
    const dt = Math.max(now - lastT, 0);
    lastT = now;
    if (dt > 0 && hl > 0) {
      const f = Math.pow(0.5, dt / hl);
      for (let i = 0; i < 12; i++) hist[i] *= f;
    }
  }
  function estimateKey() {
    let total = 0;
    for (let i = 0; i < 12; i++) total += hist[i];
    if (total < MIN_TOTAL) return null;
    let best = null, bestScore = -2, second = -2;
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const [mode, prof] of [['major', KS_MAJOR], ['minor', KS_MINOR]]) {
        const rot = new Array(12);
        for (let i = 0; i < 12; i++) rot[i] = prof[(i - tonic + 12) % 12];
        const s = corr(hist, rot);
        if (s > bestScore) { second = bestScore; bestScore = s; best = { tonic, mode }; }
        else if (s > second) { second = s; }
      }
    }
    if (bestScore - second < settings.confidenceMargin) return null;   // ambiguous
    return best;
  }
  function reset() { hist.fill(0); lastT = 0; }
  function _weightForTest(pc) { return hist[pc]; }
  return { addNoteOn, addMicEnergyPc, decayTo, estimateKey, reset, settings, _weightForTest };
}
```

Add `createKeyEstimator` to both exports:

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spell, DEFAULT_SPELLING, tableForKey, buildMajorTable, createKeyEstimator };
}
if (typeof window !== 'undefined') {
  window.KeySpelling = { spell, DEFAULT_SPELLING, createKeyEstimator };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node web/js/key-spelling.test.js`
Expected: PASS — all tests (`10 passed`).

- [ ] **Step 5: Commit**

```bash
git add web/js/key-spelling.js web/js/key-spelling.test.js
git commit -m "feat: Krumhansl key estimator (decayed histogram, per-mode half-life)"
```

---

### Task 5: Thread `estimatedKey` through `chord.js` spelling

**Files:**
- Modify: `web/js/chord.js` (add `estimatedKey` param to `chordNames`, `nameFromMidiNotes`, `impliedChord`, `ChordReadout.update`; replace `PC_NAMES[...]` *display* lookups with `spell`; update header comment)
- Modify: `web/js/chord.test.js` (add key-context test)

`chord.js` runs in both Node (tests) and the browser. Import `spell` in a way that works for both: `const KS = (typeof require !== 'undefined') ? require('./key-spelling.js') : window.KeySpelling;`. Every place a name is emitted for display uses `KS.spell(pc, estimatedKey)`. When `estimatedKey` is omitted (undefined), `spell` receives `null` → default table (preserves current behaviour except sharps→the flat default). NOTE: `PC_NAMES` turns out to be used ONLY for display (interval matching is numeric via `QUALITIES`/`exactMatch`), so once all display lookups move to `KS.spell` it is dead and should be removed along with its export — do not keep it "for interval math" (it was never used that way).

- [ ] **Step 1: Write the failing test (append to `web/js/chord.test.js`)**

Add before the final summary line:

```javascript
// --- key-aware spelling ---------------------------------------------------
const F_MAJOR = { tonic: 5, mode: 'major' };

test('Bb major triad names "Bb" (not "A#") under an F-major key', () => {
  // Bb D F = midi 58,62,65
  const name = nameFromMidiNotes([58, 62, 65], F_MAJOR);
  assert.ok(name.startsWith('Bb'), `expected Bb..., got "${name}"`);
  assert.ok(!name.includes('A#'), `must not contain A#: "${name}"`);
});

test('loose notes respell to flats by default (A# -> Bb)', () => {
  // Bb + C held (not a chord) => note names; default table => "Bb C"
  assert.strictEqual(nameFromMidiNotes([58, 60]), 'Bb C');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/js/chord.test.js`
Expected: FAIL — the default `PC_NAMES` prints "A#", so `nameFromMidiNotes([58,60])` returns `'A# C'`, and the Bb-major test fails on `A#`.

- [ ] **Step 3: Implement key-aware spelling in `chord.js`**

At the top of `web/js/chord.js`, after `'use strict';`, add the import:

```javascript
const KS = (typeof require !== 'undefined')
  ? require('./key-spelling.js')
  : (typeof window !== 'undefined' ? window.KeySpelling : null);
```

Change `chordNames` to take and use `estimatedKey` for the root name:

```javascript
function chordNames(heldSet, bassPc, estimatedKey) {
  const matches = [];
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      if (exactMatch(heldSet, root, q.ivs)) {
        matches.push({ root, name: KS.spell(root, estimatedKey) + q.name });
      }
    }
  }
  matches.sort((a, b) => {
    const ab = a.root === bassPc ? -1 : 0, bb = b.root === bassPc ? -1 : 0;
    return (ab - bb) || (a.root - b.root);
  });
  return matches.map((m) => m.name);
}
```

Update `chordName` (single-name helper) — it only needs yes/no, so key is irrelevant, leave its call `chordNames(heldSet)` as-is (undefined key → default table; the *name string* it returns is only used by `impliedChord` as a guard, not displayed).

Change `nameFromMidiNotes` to accept and thread `estimatedKey`:

```javascript
function nameFromMidiNotes(midiNotes, estimatedKey) {
  const { set, order } = pitchClasses(midiNotes);
  if (set.size === 0) return '';
  const names = chordNames(set, order[0], estimatedKey);
  if (names.length) return names.join(' / ');
  return order.map((pc) => KS.spell(pc, estimatedKey)).join(' ');
}
```

Change `impliedChord` to accept `estimatedKey` and spell its result with it. Update the signature and the two `PC_NAMES[root]` uses:

```javascript
function impliedChord(midiNotes, estimatedKey) {
```

and replace `name: PC_NAMES[root] + q.name` (the one inside the candidate push) with:

```javascript
      candidates.push({ root, qi, name: KS.spell(root, estimatedKey) + q.name, present, size: q.ivs.length });
```

Change `ChordReadout.update` to accept and pass the key:

```javascript
  update(midiNotes, estimatedKey) {
    const notes = Array.from(midiNotes);
    const text = nameFromMidiNotes(notes, estimatedKey);
    if (text !== this.last) {
      this.last = text;
      this.nameEl.textContent = text;
      this.nameEl.style.opacity = text ? '1' : '0';
    }
    if (this.impliedEl) {
      const implied = text.includes(' ') ? (impliedChord(notes, estimatedKey) || '') : '';
      if (implied !== this.lastImplied) {
        this.lastImplied = implied;
        this.impliedEl.textContent = implied;
        this.impliedEl.style.opacity = implied ? '1' : '0';
      }
    }
  }
```

Update the file header comment (lines 3-11) so the "exact/instant, no filtering" contract reflects that *spelling* now depends on an estimated key. Replace the header paragraph with:

```javascript
// chord.js
//
// Chord/note readout for the centre of the wheel, driven by the EXACT set of
// held MIDI notes. Chord *matching* is exact and instant: a chord name shows
// only when the held pitch classes exactly form a recognized chord; otherwise
// the held note names show; nothing held -> blank. There is no smoothing or
// hysteresis on the matching.
//
// The one thing that is NOT frozen at press-time is *spelling*: which accidental
// name a pitch gets (Bb vs A#) depends on the current estimated key, passed in
// as `estimatedKey` (may be null -> a neutral flat-preferring default). As the
// key estimate fills in, a just-played note can respell a moment later. This is
// deliberate and musically correct.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node web/js/chord.test.js`
Expected: PASS — including the two new tests.

- [ ] **Step 5: Run the sibling chord tests (they call the same functions)**

Run: `node web/js/chord.alias.test.js && node web/js/chord.implied.test.js`
Expected: PASS. These pass no key, so names now use the flat default. **If any assertion hard-codes "A#"/"C#"/etc.**, update the expected string to the flat spelling (e.g. "A#"→"Bb") — that is the intended new behaviour, not a regression. Show the diff in the commit.

- [ ] **Step 6: Commit**

```bash
git add web/js/chord.js web/js/chord.test.js web/js/chord.alias.test.js web/js/chord.implied.test.js
git commit -m "feat: spell chord/note names per estimated key in chord.js"
```

---

### Task 6: Route the mic chord root through the speller

**Files:**
- Modify: `web/js/mic-input.js` (`detectChord` uses `spell` for its root name; convert 0=A→0=C)

`detectChord` currently builds `NOTE_NAMES[best.root] + best.q.name` where `best.root` is 0 = A. Convert to 0 = C and spell with the current estimated key. The estimator lives in `main.js`, so pass the key into `analyse`/detection. Simplest: give `createMicInput` a `getEstimatedKey` callback (defaulting to `() => null`) set by `main.js`.

- [ ] **Step 1: Add a key source to `createMicInput`**

In `mic-input.js`, add near `chordSettings`:

```javascript
  // supplies the current estimated key (0=C convention) for chord-name spelling;
  // set by the host (main.js). null => neutral default spelling.
  let getEstimatedKey = () => null;
  function setKeySource(fn) { getEstimatedKey = fn || (() => null); }
```

- [ ] **Step 2: Spell the detected root via the shared speller**

Import the speller at the top of `mic-input.js` (after `'use strict';`):

```javascript
const KS_SPELL = (typeof require !== 'undefined')
  ? require('./key-spelling.js')
  : (typeof window !== 'undefined' ? window.KeySpelling : null);
```

In `detectChord`, replace the returned `name`:

```javascript
    return {
      name: NOTE_NAMES[best.root] + best.q.name,
```

with a spelled root (convert 0=A root to 0=C, then `spell`):

```javascript
    const rootPcC = (best.root + 9) % 12;               // 0=A -> 0=C (A is pc 9)
    return {
      name: KS_SPELL.spell(rootPcC, getEstimatedKey()) + best.q.name,
```

- [ ] **Step 3: Export `setKeySource`**

Add `setKeySource` to the returned object from `createMicInput`:

```javascript
  return {
    enable, disable, analyse,
    detectChordName, estimateStableChordName,
    dsp, chordSettings, setKeySource,
  };
```

- [ ] **Step 4: Verify mic tests still pass**

Run: `node web/js/mic-chord-stabilizer.test.js`
Expected: PASS — `7 passed` (unaffected).

There is no Node test that calls `detectChord` directly (it needs a live FFT), so verification is manual in Task 8. Confirm `require('./mic-input.js')` still loads without throwing:

Run: `node -e "require('./web/js/mic-input.js'); console.log('loads ok')"`
Expected: prints `loads ok`.

- [ ] **Step 5: Commit**

```bash
git add web/js/mic-input.js
git commit -m "feat: spell mic chord root via the shared key-aware speller"
```

---

### Task 7: Make `DebugPanel` sections injectable

**Files:**
- Modify: `web/js/debug-panel.js` (accept `sections` + `storageKey` in the constructor; default to existing cel sections)

Currently `SECTIONS` and `STORAGE_KEY` are module constants and `render()` reads the module `SECTIONS`. To let a second instance render different controls into a different container with its own persistence, pass them in.

- [ ] **Step 1: Parameterize the constructor and render**

In `web/js/debug-panel.js`, rename the module `const SECTIONS` to `const CEL_SECTIONS` (leave its contents unchanged). Change the constructor and `render()`:

```javascript
class DebugPanel {
  constructor({ container, defaults, onChange, sections, storageKey } = {}) {
    this.container = container;
    this.onChange = onChange || (() => {});
    this.sections = sections || CEL_SECTIONS;
    this.storageKey = storageKey || STORAGE_KEY;
    this.params = Object.assign({}, defaults, this._load());
  }

  _load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  _save() {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.params)); }
    catch (e) { /* private mode: ignore */ }
  }
```

In `render()`, replace both `for (const sec of SECTIONS)` and the `SECTIONS.map` with `this.sections`:

```javascript
    const html = this.sections.map((sec) => {
```

and

```javascript
    for (const sec of this.sections) {
```

- [ ] **Step 2: Verify existing panel still works**

Run: `node -e "require('./web/js/debug-panel.js'); console.log('loads ok')"`
Expected: prints `loads ok`.

Manual: load `web/index.html`, confirm the existing cel-shading sliders still render and persist (change a slider, reload, value retained).

- [ ] **Step 3: Commit**

```bash
git add web/js/debug-panel.js
git commit -m "refactor: DebugPanel accepts injectable sections + storageKey"
```

---

### Task 8: Wire the estimator, dials, and mode-switch reset into `main.js` + `index.html`

**Files:**
- Modify: `web/index.html` (script tag for `key-spelling.js`; container for the mic/key panel)
- Modify: `web/js/main.js` (create estimator; feed it; pass key to MIDI readout and mic; second DebugPanel; reset on mode switch)

- [ ] **Step 1: Add the script tag and panel container to `index.html`**

In `web/index.html`, add `key-spelling.js` **before** `chord.js` (chord.js references `window.KeySpelling`) in the script list (around line 56-57):

```html
<script src="./js/note-colours.js"></script>
<script src="./js/key-spelling.js"></script>
<script src="./js/chord.js"></script>
```

Add a container for the second panel next to the existing `#celPanel` (inside the same `#dsp` panel div; match existing markup):

```html
<div id="micPanel"></div>
```

- [ ] **Step 2: Create and feed the key estimator in `main.js`**

In `web/js/main.js`, after the mic/readout setup (around line 55), add:

```javascript
  // --- key estimator (drives note/chord spelling in both modes) ------------
  const keyEst = window.KeySpelling.createKeyEstimator();
  mic.setKeySource(() => keyEst.estimateKey());
  let estimatedKey = null;   // refreshed each frame from keyEst
```

In `noteOn(midi, velocity)` (after `notes.set(...)`), feed the estimator:

```javascript
    keyEst.addNoteOn(midi, velocity);
```

- [ ] **Step 3: Feed mic energy + refresh the key each frame**

In the render loop `frame(now)`, mic branch, after `mic.analyse(...)` add the energy feed + decay; in both branches refresh `estimatedKey`. Replace the whole `frame` body branches:

```javascript
  function frame(now) {
    const tSec = now / 1000;
    if (mode === 'mic') {
      mic.analyse(tSec, micOut);
      // feed pitch-class energy (micOut.pcEnergy is 0=A) into the estimator
      for (let pcA = 0; pcA < 12; pcA++) keyEst.addMicEnergyPc(pcA, micOut.pcEnergy[pcA]);
      keyEst.decayTo(tSec, 'mic');
      estimatedKey = keyEst.estimateKey();
      viz.renderMic(now, micOut.pcEnergy);
      refreshLitFromEnergy(micOut.pcEnergy);
      const name = mic.estimateStableChordName();
      if (name !== chordEl.textContent) {
        chordEl.textContent = name || '';
        chordEl.style.opacity = name ? '1' : '0';
      }
    } else {
      keyEst.decayTo(tSec, 'midi');
      estimatedKey = keyEst.estimateKey();
      viz.renderMidi(now, notes);
      chord.update(notes.keys(), estimatedKey);
    }
    requestAnimationFrame(frame);
  }
```

- [ ] **Step 4: Reset the estimator on mode switch**

In `setMode(next)`, in the state-clearing block (around line 148, with the other resets), add:

```javascript
    keyEst.reset(); estimatedKey = null;
```

- [ ] **Step 5: Add the second DebugPanel for mic/key dials**

After the existing `panel.render();` (around line 178), add:

```javascript
  // mic + key dials: a second panel over a separate settings object, persisted
  // under its own storage key. holdMs/minConfidence live on mic.chordSettings;
  // the half-lives and margin live on keyEst.settings. onChange copies the
  // panel's params onto those live objects so changes apply immediately.
  const MIC_SECTIONS = [
    { title: 'Mic Chord', sliders: [
      ['holdMs', 'hold time (ms)', 0, 500, 5, (v) => `${Math.round(v)} ms`],
      ['minConfidence', 'min confidence', 0.4, 0.9, 0.01, (v) => `${Math.round(v * 100)}%`],
    ], toggles: [] },
    { title: 'Key', sliders: [
      ['halfLifeMidiSec', 'key half-life (midi)', 0.5, 6, 0.1, (v) => `${v.toFixed(1)} s`],
      ['halfLifeMicSec', 'key half-life (mic)', 1, 8, 0.1, (v) => `${v.toFixed(1)} s`],
      ['confidenceMargin', 'key confidence', 0.0, 0.15, 0.005, (v) => v.toFixed(3)],
    ], toggles: [] },
  ];
  const micPanel = new window.DebugPanel({
    container: document.getElementById('micPanel'),
    storageKey: 'chromesthesia.micParams',
    defaults: {
      holdMs: mic.chordSettings.holdMs,
      minConfidence: mic.chordSettings.minConfidence,
      halfLifeMidiSec: keyEst.settings.halfLifeMidiSec,
      halfLifeMicSec: keyEst.settings.halfLifeMicSec,
      confidenceMargin: keyEst.settings.confidenceMargin,
    },
    sections: MIC_SECTIONS,
    onChange: (p) => {
      mic.chordSettings.holdMs = p.holdMs;
      mic.chordSettings.minConfidence = p.minConfidence;
      keyEst.settings.halfLifeMidiSec = p.halfLifeMidiSec;
      keyEst.settings.halfLifeMicSec = p.halfLifeMicSec;
      keyEst.settings.confidenceMargin = p.confidenceMargin;
    },
  });
  micPanel.render();
```

- [ ] **Step 6: Verify the whole thing loads and runs**

Run: `node web/js/chord.test.js && node web/js/key-spelling.test.js && node web/js/mic-chord-stabilizer.test.js && node web/js/chord.alias.test.js && node web/js/chord.implied.test.js && node web/js/note-colours.test.js`
Expected: all PASS.

Manual (serve `web/` and open in a browser):
- MIDI mode: play a Bb-major triad → reads "Bb" not "A#". Play a run in a sharp key (e.g. B major scale) for a couple seconds → accidentals settle to sharps.
- Switch MIDI→Mic → the wheel/readout clears (estimator reset); no stale chord.
- Mic mode: play a sustained chord → the name is stable (no per-frame flicker), settles within ~120ms; the mic/key sliders in the panel change behaviour live.

- [ ] **Step 7: Commit**

```bash
git add web/index.html web/js/main.js
git commit -m "feat: wire key estimator, mic/key dials, and mode-switch reset"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** stabilizer (T1–2), 0=A→0=C conversion (T3 speller, T4 estimator `addMicEnergyPc`, T6 root), bass/velocity MIDI weighting + energy mic weighting (T4), fixed default `C F Bb Eb Ab Db Gb B E A D G` (T3), per-mode half-life dials + key-confidence + holdMs + minConfidence (T4, T8), reset on mode switch (T8), `chord.js` header contract (T5), reuse note re `SHARP_TO_FLAT` (default defined to match, T3), second DebugPanel via injectable sections (T7). All spec sections map to a task.
- **The riskiest task is T3** (the keyed spelling table generator). Its implementer note authorizes replacing the generator with explicit per-key tables if generation fights the tests — the tests are the contract. Do not leave a half-working generator.
- **Sibling chord tests (T5 step 5):** expect to flip hard-coded sharp spellings to flats; that is intended.
- **No network/DOM in Node tests:** all `.test.js` run headless; browser-only behaviour (mic FFT, panel rendering) is verified manually in T2/T7/T8.
