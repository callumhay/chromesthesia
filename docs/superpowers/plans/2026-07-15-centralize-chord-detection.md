# Centralize Chord Vocabulary + Naming Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared chord vocabulary and one naming engine, so mic mode detects all 13 chords, shows slash aliases, and spells dim7 roots correctly — by *calling* the engine, not duplicating it.

**Architecture:** New `chord-qualities.js` holds the single `{name, ivs, required, min}` list. `chord.js` becomes the naming engine keyed off a pitch-class set + bass pc + key (`nameFromPitchClasses`), with `nameFromMidiNotes` as a thin wrapper; it also owns dim7 leading-tone/bass root selection. `mic-input.js` keeps fuzzy detection but deletes its own quality list + naming and delegates to the engine, passing a converted (0=A→0=C) pc-set + bass pc.

**Tech Stack:** Plain browser JS, no build. Tests run with `node web/js/<name>.test.js` (built-in `assert`, inline `test()` helper). Convention: `chord.js`/`key-spelling.js` use pitch class index 0 = C; `mic-input.js` uses 0 = A and converts with `pcC = (pcA + 9) % 12`.

---

## File Structure

- **Create `web/js/chord-qualities.js`** — the single vocabulary: one array of `{name, ivs, required, min}` (13 chords). Exported `window.ChordQualities` / `module.exports`. No behaviour, just data.
- **Create `web/js/chord-qualities.test.js`** — sanity tests for the vocabulary (13 entries, all fields present, no duplicate ivs-sets, half-dim/dim7 present).
- **Modify `web/js/chord.js`** — read qualities from `chord-qualities.js`; delete the two inline lists; add `nameFromPitchClasses(pcSet, bassPc, estimatedKey)`; make `nameFromMidiNotes` a wrapper; add dim7 leading-tone/bass root ordering in `chordNames`; export `nameFromPitchClasses`.
- **Modify `web/js/chord.test.js`, `chord.alias.test.js`, `chord.implied.test.js`** — must pass unchanged (regression guard); add dim7-root tests.
- **Modify `web/js/mic-input.js`** — track the bass pitch class in `foldBand`; `detectChord` delegates naming to `window.ChordQualities`-scored detection + `chord.js`'s engine; delete local `QUALITIES` and the `spell`-based name assembly.
- **Modify `web/index.html`** — add `<script src="./js/chord-qualities.js">` before `chord.js` and `mic-input.js`.

**Sequencing:** vocabulary first (Task 1), then the engine refactor with regression guard (Tasks 2–3), then dim7 root (Task 4), then mic bass (Task 5) and mic delegation (Task 6), then wiring (Task 7).

---

## Task 1: The shared vocabulary `chord-qualities.js`

**Files:**
- Create: `web/js/chord-qualities.js`
- Test: `web/js/chord-qualities.test.js`

- [ ] **Step 1: Write the failing test**

Create `web/js/chord-qualities.test.js`:

```javascript
// Tests for the shared chord vocabulary. Runs on plain Node:
//   node web/js/chord-qualities.test.js
'use strict';
const assert = require('assert');
const { CHORD_QUALITIES } = require('./chord-qualities.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

test('has all 13 chord qualities', () => {
  assert.strictEqual(CHORD_QUALITIES.length, 13);
});

test('every entry has name, ivs, required, min', () => {
  for (const q of CHORD_QUALITIES) {
    assert.ok(typeof q.name === 'string', `name missing: ${JSON.stringify(q)}`);
    assert.ok(Array.isArray(q.ivs) && q.ivs.length >= 3, `ivs bad: ${q.name}`);
    assert.ok(Array.isArray(q.required), `required missing: ${q.name}`);
    assert.ok(typeof q.min === 'number', `min missing: ${q.name}`);
    assert.strictEqual(q.ivs[0], 0, `ivs must start at root 0: ${q.name}`);
  }
});

test('includes the previously-mic-missing chords', () => {
  const names = CHORD_QUALITIES.map((q) => q.name);
  for (const n of ['ø7', 'dim7', '6', 'm6']) {
    assert.ok(names.includes(n), `missing quality: ${n}`);
  }
});

// NOTE: this catches two rows with the IDENTICAL interval list. It is NOT a
// pitch-class-set uniqueness guarantee - different roots can share a pc set by
// design (C6 == Am7, Bø7 == Dm6); that aliasing is a feature, surfaced as slashes.
test('no two qualities share the same interval list', () => {
  const seen = new Set();
  for (const q of CHORD_QUALITIES) {
    const key = q.ivs.join(',');
    assert.ok(!seen.has(key), `duplicate ivs: ${q.name} (${key})`);
    seen.add(key);
  }
});

test('half-diminished and diminished-7 intervals are correct', () => {
  const byName = Object.fromEntries(CHORD_QUALITIES.map((q) => [q.name, q.ivs]));
  assert.deepStrictEqual(byName['ø7'], [0, 3, 6, 10]);
  assert.deepStrictEqual(byName['dim7'], [0, 3, 6, 9]);
});

test('the shared vocabulary is frozen (two modules share it)', () => {
  assert.ok(Object.isFrozen(CHORD_QUALITIES), 'array not frozen');
  assert.ok(Object.isFrozen(CHORD_QUALITIES[0]), 'rows not frozen');
  assert.ok(Object.isFrozen(CHORD_QUALITIES[0].ivs), 'ivs not frozen');
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node web/js/chord-qualities.test.js`
Expected: FAIL — `Cannot find module './chord-qualities.js'`.

- [ ] **Step 3: Create the vocabulary file**

Create `web/js/chord-qualities.js`:

```javascript
// chord-qualities.js
//
// The single source of truth for the chord vocabulary, shared by chord.js (exact
// + implied MIDI matching) and mic-input.js (fuzzy detection). Each row carries:
//   name     - display suffix (e.g. '', 'm', 'ø7')
//   ivs      - interval set from the root in semitones (root-relative, so it is
//              pitch-class-convention independent)
//   required - the identity tones that MUST be present for an IMPLIED (partial)
//              match; ignored by consumers that only do exact/fuzzy matching
//   min      - minimum number of the quality's tones held for an implied match
//
// Order matters where two qualities can co-match: earlier = preferred (common
// triads first). Adding a chord = one row here; both detectors pick it up.

'use strict';

const CHORD_QUALITIES = [
  { name: '',     ivs: [0, 4, 7],     required: [0, 4],       min: 2 },  // major
  { name: 'm',    ivs: [0, 3, 7],     required: [0, 3],       min: 2 },  // minor
  { name: 'dim',  ivs: [0, 3, 6],     required: [0, 3, 6],    min: 3 },
  { name: 'aug',  ivs: [0, 4, 8],     required: [0, 4, 8],    min: 3 },
  { name: 'sus2', ivs: [0, 2, 7],     required: [0, 2, 7],    min: 3 },
  { name: 'sus4', ivs: [0, 5, 7],     required: [0, 5, 7],    min: 3 },
  { name: '7',    ivs: [0, 4, 7, 10], required: [0, 10],      min: 3 },
  { name: 'maj7', ivs: [0, 4, 7, 11], required: [0, 4, 11],   min: 3 },
  { name: 'm7',   ivs: [0, 3, 7, 10], required: [0, 3, 10],   min: 3 },
  { name: 'ø7',   ivs: [0, 3, 6, 10], required: [0, 3, 6, 10], min: 3 }, // half-diminished
  { name: 'dim7', ivs: [0, 3, 6, 9],  required: [0, 3, 6, 9],  min: 4 },
  { name: '6',    ivs: [0, 4, 7, 9],  required: [0, 4, 9],    min: 3 },
  { name: 'm6',   ivs: [0, 3, 7, 9],  required: [0, 3, 9],    min: 3 },
];

// Two modules now share this one array; freeze it (and the rows) so neither can
// mutate the vocabulary out from under the other.
CHORD_QUALITIES.forEach((q) => { Object.freeze(q.ivs); Object.freeze(q.required); Object.freeze(q); });
Object.freeze(CHORD_QUALITIES);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHORD_QUALITIES };
}
if (typeof window !== 'undefined') {
  window.ChordQualities = { CHORD_QUALITIES };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node web/js/chord-qualities.test.js`
Expected: PASS — `6 passed`.

- [ ] **Step 5: Commit**

```bash
git add web/js/chord-qualities.js web/js/chord-qualities.test.js
git commit -m "feat: centralize the chord vocabulary in chord-qualities.js"
```

---

## Task 2: `chord.js` reads the shared vocabulary (regression-safe)

**Files:**
- Modify: `web/js/chord.js` (import vocabulary, delete the two inline lists)
- Verify: `web/js/chord.test.js`, `chord.alias.test.js`, `chord.implied.test.js` (must stay green)

This task ONLY swaps the data source — no behaviour change. `QUALITIES` and `IMPLIED` were identical intervals; both now come from `CHORD_QUALITIES` (exact match ignores `required`/`min`; implied uses them).

- [ ] **Step 1: Import the vocabulary at the top of `chord.js`**

After the existing `KS` import (around line 22), add:

```javascript
const CQ = (typeof require !== 'undefined')
  ? require('./chord-qualities.js')
  : (typeof window !== 'undefined' ? window.ChordQualities : null);
// Hard dependency: chord-qualities.js must load BEFORE this file (see index.html
// script order). Assert rather than dying later on a confusing null-property read.
if (!CQ || !CQ.CHORD_QUALITIES) throw new Error('chord.js: chord-qualities.js must load first');
const QUALITIES = CQ.CHORD_QUALITIES;   // exact-match reads name + ivs
const IMPLIED = CQ.CHORD_QUALITIES;     // implied-match reads name + ivs + required + min
```

- [ ] **Step 2: Delete the two inline lists**

Delete the entire `const QUALITIES = [ ... ];` block (lines ~24-41) and the entire
`const IMPLIED = [ ... ];` block (lines ~103-130), INCLUDING their explanatory
comments. The names `QUALITIES` and `IMPLIED` are now the aliases defined in
Step 1, so every existing reference keeps working. (Keep the `// --- implied
chords ---` section header comment above where IMPLIED was, minus the list.)

- [ ] **Step 3: Update the module.exports**

The export at the bottom lists `QUALITIES`. Keep it — it still resolves to the
shared array:

```javascript
module.exports = { ChordReadout, nameFromMidiNotes, impliedChord, chordName, QUALITIES };
```

**Carried forward from the Task 1 review — a pre-existing quirk to DECIDE here, not
silently fix:** `ø7` has `required: [0,3,6,10]` (all four tones) with `min: 3`.
Since all four are required, `present` is always 4, so **`min: 3` is dead** — it can
never bind. Every comparable row disagrees: `dim`/`aug`/`sus2`/`sus4` use
`min == ivs.length`, and `dim7` uses `min: 4`. This is copied faithfully from the
original `chord.js:126`, so it is NOT a regression and Task 1 deliberately left it
alone. Setting it to `min: 4` would make the table self-consistent but is a
behaviour change to implied matching. Do NOT change it as part of this task's
no-op swap. If you want to change it, do so as a SEPARATE commit after Step 4's
regression run is green, and confirm `chord.implied.test.js` still passes — if it
does, the change is provably inert and worth taking for consistency; if it does
not, leave it and report.

- [ ] **Step 4: Verify all chord tests pass UNCHANGED**

Run: `node web/js/chord.test.js && node web/js/chord.alias.test.js && node web/js/chord.implied.test.js`
Expected: PASS — 15, 9, 16. If any FAIL, the vocabulary order or intervals differ
from the originals; reconcile `chord-qualities.js` to match the original chord.js
lists exactly (order matters for tie-breaks). Do NOT change the tests here.

Also run `node web/js/chord-qualities.test.js` (6 passed) to confirm the shared
file still loads.

- [ ] **Step 5: Commit**

```bash
git add web/js/chord.js
git commit -m "refactor: chord.js reads the shared chord vocabulary"
```

---

## Task 3: `nameFromPitchClasses` engine entry point

**Files:**
- Modify: `web/js/chord.js` (add `nameFromPitchClasses`; make `nameFromMidiNotes` a wrapper; export it)
- Test: `web/js/chord.test.js` (add pc-set-entry tests)

The engine must name from a pitch-class set + bass pc + key, so the mic path can
call it. `nameFromMidiNotes` becomes a thin wrapper. Output must be byte-identical
to today for MIDI.

- [ ] **Step 1: Write the failing test (append to `web/js/chord.test.js`)**

Before the final summary line:

```javascript
// --- pitch-class-set entry point (shared by MIDI + mic) -------------------
const { nameFromPitchClasses } = require('./chord.js');

test('nameFromPitchClasses matches nameFromMidiNotes for a chord', () => {
  // C E G = C major; pcSet {0,4,7}, bass 0 (0=C convention)
  assert.strictEqual(nameFromPitchClasses(new Set([0, 4, 7]), 0, null), 'C');
});

test('nameFromPitchClasses shows slash aliases (C E G A -> C6 / Am7)', () => {
  // C E G A = {0,4,7,9}, bass C(0)
  assert.strictEqual(nameFromPitchClasses(new Set([0, 4, 7, 9]), 0, null), 'C6 / Am7');
});

test('nameFromPitchClasses half-diminished (B D F A -> Bø7 / Dm6), bass B', () => {
  // B D F A = {11,2,5,9}, bass B(11)
  const r = nameFromPitchClasses(new Set([11, 2, 5, 9]), 11, null);
  assert.ok(r.startsWith('Bø7'), `expected Bø7 first, got "${r}"`);
});

test('nameFromPitchClasses of an unknown set returns the spelled note names', () => {
  // C + F# (0,6) is not a chord -> note names in pc order (bass first)
  assert.strictEqual(nameFromPitchClasses(new Set([0, 6]), 0, null), 'C Gb');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node web/js/chord.test.js`
Expected: FAIL — `nameFromPitchClasses is not a function`.

- [ ] **Step 3: Add `nameFromPitchClasses` and rewrite `nameFromMidiNotes` as a wrapper**

`chordNames` and `chordName` already take a pc set. The only MIDI-coupled piece is
`nameFromMidiNotes` (it derives the set + order from MIDI notes). Add a pc-set
entry point and make the MIDI function delegate.

Replace the existing `nameFromMidiNotes` (lines ~180-190) with:

```javascript
// Name a pitch-class SET (0 = C) -> display string. bassPc: the bass pitch class
// (may be null); orderedPcs: pitch classes ordered bass-first for the note-name
// fallback (defaults to numeric order when omitted). Shared by the MIDI readout
// and the mic detector so both get identical aliasing + spelling.
function nameFromPitchClasses(pcSet, bassPc, estimatedKey, orderedPcs) {
  if (pcSet.size === 0) return '';
  const names = chordNames(pcSet, bassPc, estimatedKey);
  if (names.length) return names.join(' / ');
  const order = orderedPcs || [...pcSet].sort((a, b) => a - b);
  return order.map((pc) => KS.spell(pc, estimatedKey)).join(' ');
}

// The MIDI readout: exact held MIDI notes -> display string. Thin wrapper that
// derives the pitch-class set + bass + pitch-order from the notes, then names it
// via the shared engine.
function nameFromMidiNotes(midiNotes, estimatedKey) {
  const { set, order } = pitchClasses(midiNotes);
  return nameFromPitchClasses(set, order[0], estimatedKey, order);
}
```

- [ ] **Step 4: Export `nameFromPitchClasses`**

Update both export blocks:

```javascript
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChordReadout, nameFromMidiNotes, nameFromPitchClasses, impliedChord, chordName, QUALITIES };
}
if (typeof window !== 'undefined') {
  window.ChordReadout = ChordReadout;
  window.nameFromMidiNotes = nameFromMidiNotes;
  window.nameFromPitchClasses = nameFromPitchClasses;
}
```

- [ ] **Step 5: Run to verify all pass**

Run: `node web/js/chord.test.js && node web/js/chord.alias.test.js && node web/js/chord.implied.test.js`
Expected: PASS (new tests + all existing, unchanged). The MIDI output must be
identical — `nameFromMidiNotes` now routes through `nameFromPitchClasses` but the
note-name fallback passes `order` so pitch-order is preserved.

- [ ] **Step 6: Commit**

```bash
git add web/js/chord.js web/js/chord.test.js
git commit -m "feat: nameFromPitchClasses engine entry point (MIDI now wraps it)"
```

---

## Task 4: dim7 root selection (leading-tone-first, else bass)

**Files:**
- Modify: `web/js/chord.js` (`chordNames` orders symmetric-dim7 names by key leading tone, else bass)
- Test: `web/js/chord.test.js` (dim7 root tests)

dim7 is symmetric — `chordNames` already emits all 4 enharmonic names. This task
sets which comes FIRST: the key's leading tone (tonic − 1) if it is one of the 4
roots, otherwise the bass. Spelled per the key.

**`chordName`'s contract (intentional, do not "fix"):** `chordName(heldSet)` at
chord.js:89-92 calls `chordNames(heldSet)` with NEITHER `bassPc` NOR
`estimatedKey`. Under the new body that means `preferredRoot === undefined`
(matches no root) and the `estimatedKey` guard short-circuits, so the sort
degrades to root-ascending — exactly today's behaviour. That is fine and
deliberate: `chordName` is only a yes/no "is this an exact chord" guard for
`impliedChord`; its returned string is never displayed. Do not add arguments to
it.

- [ ] **Step 1: Write the failing test (append to `web/js/chord.test.js`)**

```javascript
// --- dim7 root: key leading-tone first, else bass -------------------------
// G# B D F = a fully-diminished 7 (pcs 8,11,2,5). In A minor the leading tone is
// G# (pc 8) -> G#dim7 first, spelled sharp.
test('dim7 roots on the key leading tone (A minor -> G#dim7 first)', () => {
  const aMinor = { tonic: 9, mode: 'minor' };
  const r = nameFromPitchClasses(new Set([8, 11, 2, 5]), 2 /*bass D*/, aMinor);
  assert.ok(r.startsWith('G#dim7'), `expected G#dim7 first, got "${r}"`);
});

// Same notes, C major: leading tone B (pc 11) is one of the roots -> Bdim7 first.
test('dim7 roots on the key leading tone (C major -> Bdim7 first)', () => {
  const cMajor = { tonic: 0, mode: 'major' };
  const r = nameFromPitchClasses(new Set([8, 11, 2, 5]), 2 /*bass D*/, cMajor);
  assert.ok(r.startsWith('Bdim7'), `expected Bdim7 first, got "${r}"`);
});

// No key: fall back to the bass. Bass = F (pc 5) -> Fdim7 first.
test('dim7 with no key falls back to the bass (bass F -> Fdim7 first)', () => {
  const r = nameFromPitchClasses(new Set([8, 11, 2, 5]), 5 /*bass F*/, null);
  assert.ok(r.startsWith('Fdim7'), `expected Fdim7 first, got "${r}"`);
});

// Key present but none of the 4 roots is its leading tone -> fall back to bass.
// Db E G Bb (pcs 1,4,7,10) in C major: leading tone B(11) not a root; bass E(4).
test('dim7 with key but no leading-tone root falls back to bass (E -> Edim7)', () => {
  const cMajor = { tonic: 0, mode: 'major' };
  const r = nameFromPitchClasses(new Set([1, 4, 7, 10]), 4 /*bass E*/, cMajor);
  assert.ok(r.startsWith('Edim7'), `expected Edim7 first, got "${r}"`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node web/js/chord.test.js`
Expected: FAIL — dim7 currently orders by bass-then-ascending, so the A-minor and
C-major leading-tone cases won't put the leading-tone root first.

- [ ] **Step 3: Add leading-tone-aware ordering to `chordNames`**

`chordNames` currently sorts matches by (bass-first, then root ascending). Add a
higher-priority key: for dim7 matches, the key's leading tone outranks the bass.
Replace the `chordNames` function body's sort with a preferred-root computation.

Replace `chordNames` (lines ~71-85) with:

```javascript
function chordNames(heldSet, bassPc, estimatedKey) {
  const matches = [];
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      if (exactMatch(heldSet, root, q.ivs)) {
        matches.push({ root, quality: q.name, name: KS.spell(root, estimatedKey) + q.name });
      }
    }
  }
  // Preferred root shown first. For a symmetric dim7 the diatonic function is the
  // vii°7 rooted on the key's leading tone (tonic - 1); when the key is unknown or
  // its leading tone is not one of the four roots, fall back to the bass. For all
  // other chords the bass-rooted interpretation leads (unchanged behaviour).
  let preferredRoot = bassPc;
  const hasDim7 = matches.some((m) => m.quality === 'dim7');
  if (hasDim7 && estimatedKey) {
    const lead = ((estimatedKey.tonic - 1) % 12 + 12) % 12;
    if (matches.some((m) => m.root === lead && m.quality === 'dim7')) preferredRoot = lead;
  }
  matches.sort((a, b) => {
    const ap = a.root === preferredRoot ? -1 : 0, bp = b.root === preferredRoot ? -1 : 0;
    return (ap - bp) || (a.root - b.root);
  });
  return matches.map((m) => m.name);
}
```

- [ ] **Step 4: Run to verify all pass**

Run: `node web/js/chord.test.js && node web/js/chord.alias.test.js && node web/js/chord.implied.test.js`
Expected: PASS — the 4 new dim7 tests plus all existing. NOTE: the existing alias
tests use non-dim7 chords (C6/Am7, Aø7/Cm6), whose ordering is still bass-first,
so they stay green. If an existing test breaks, the `preferredRoot = bassPc`
default was not preserved for non-dim7 — re-check.

- [ ] **Step 5: Commit**

```bash
git add web/js/chord.js web/js/chord.test.js
git commit -m "feat: dim7 names root on the key leading tone, else the bass"
```

---

## Task 5: Track the bass pitch class in the mic pipeline

**Files:**
- Modify: `web/js/mic-input.js` (`foldBand` records the lowest-frequency strong pc; expose it)

The mic detector needs a bass pc for alias ordering + dim7 fallback. The chroma
folds octaves away, but `foldBand` walks FFT bins low→high, so the first
significant pitch class encountered is the bass.

- [ ] **Step 1: Add bass-pc tracking state**

Near the chroma state (around line 116-117), add:

```javascript
  let bassPcA = -1;         // lowest-frequency strong pitch class this frame (0 = A); -1 = none
```

- [ ] **Step 2: Capture the bass pc in `foldBand`**

`foldBand` (around line 361) already computes `pc` and iterates bins in ascending
frequency. The lowest-frequency **local spectral peak** above the floor sets the
bass pc — a real partial, not the first bin of broadband rumble. Only set
`bassPcA` if not yet set this frame. Inside the `for` loop, after
`out.pcEnergy[pc] += m;`, add:

```javascript
      // Bass = the lowest-frequency pitch class carrying a real partial. Bins are
      // walked low->high, so the first hit wins. This must be a LOCAL PEAK, not
      // merely above the floor: a bare threshold would let broadband rumble (HVAC,
      // a kick's noise floor) claim the bass. Same peak test + floor the chroma
      // peak-pick below uses; no f < 2200 bound here (that is an upper limit for
      // the chroma pick, meaningless when hunting the LOWEST partial).
      if (bassPcA < 0 && m > 3.2e-4 && m > mag[i - 1] && m >= mag[i + 1]) bassPcA = pc;
```

**Note the band-order dependence.** `analyse` calls
`foldBand(bands[0], out) + foldBand(bands[1], out)` — band 0 is the low band and
is evaluated first, so it gets first claim on the bass. That relies on JS
left-to-right evaluation of the `+`. Add a comment at the top of `foldBand`
recording it:

```javascript
  // NOTE: bassPcA capture below assumes foldBand is called in ASCENDING band
  // order (low band first), so the lowest-frequency partial wins.
```

Caveat to be aware of (not fixed here): `makeupGain` scales magnitudes up to 10x
before the fold, so this absolute floor is effectively lower on quiet input and
the bass pc gets noisier. The existing chroma peak-pick has the same property, so
this is not a regression — and Task 6's chord-tone guard is the real safety net.

Reset it at the start of `analyse` where the per-frame accumulators are cleared.
Find `out.pcEnergy.fill(0);` / `chromaRaw.fill(0);` in `analyse` (around line 466)
and add:

```javascript
    bassPcA = -1;
```
BEFORE the `foldBand` calls (so it is fresh each frame; band 0 runs first and
wins the lowest frequency).

- [ ] **Step 3: Verify the module still loads**

Run: `node -e "require('./web/js/mic-input.js'); console.log('loads ok')"`
Expected: prints `loads ok`. (No behaviour change yet — `bassPcA` is computed but
unused until Task 6.)

- [ ] **Step 4: Commit**

```bash
git add web/js/mic-input.js
git commit -m "feat: track the mic bass pitch class (lowest-frequency strong pc)"
```

---

## Task 6: Mic delegates naming to the shared engine

**Files:**
- Modify: `web/js/mic-input.js` (`detectChord` scores the shared vocabulary, names via `nameFromPitchClasses`; delete local `QUALITIES` + spell-based name)

Mic keeps its fuzzy scoring but stops naming. It converts the detected chord to a
0=C pitch-class set + bass pc and calls `chord.js`'s engine — so mic gains all 13
chords, slash aliases, and dim7 root handling.

**Comment correction (deliberate — do not restore the old wording):** the current
comment at mic-input.js:505-506 claims detection "biases toward the bassier root."
It does not. The `k === 0 ? 1.15 : 1` weight biases toward the chord's OWN root
tone, not the bass. The replacement comment below says "biased toward the root",
which is accurate. Keep the new wording.

- [ ] **Step 1: Import the engine + vocabulary at the top of `mic-input.js`**

Alongside the existing `KEY_SPELLING` import near the top of the file, add:

```javascript
const CHORD = (typeof require !== 'undefined')
  ? require('./chord.js')
  : (typeof window !== 'undefined' ? window : null);
const CHORD_Q = (typeof require !== 'undefined')
  ? require('./chord-qualities.js').CHORD_QUALITIES
  : (typeof window !== 'undefined' && window.ChordQualities ? window.ChordQualities.CHORD_QUALITIES : null);
// Hard dependencies: chord-qualities.js and chord.js must load BEFORE this file.
if (!CHORD_Q) throw new Error('mic-input.js: chord-qualities.js must load first');
if (!CHORD || !CHORD.nameFromPitchClasses) throw new Error('mic-input.js: chord.js must load first');
```

(In the browser `chord.js` puts `nameFromPitchClasses` on `window`, so
`CHORD.nameFromPitchClasses` resolves in both Node and browser.)

- [ ] **Step 2: Delete the local mic `QUALITIES`**

Remove the entire `const QUALITIES = [ ... ];` block in `createMicInput` (around
lines 82-92). Its scoring loop will use `CHORD_Q` instead.

- [ ] **Step 3: Rewrite `detectChord` to score the shared vocabulary and delegate naming**

Replace the `detectChord` function (around lines 507-540) with:

```javascript
  // Fuzzy chord ESTIMATE from the smoothed chroma. Scores every root x quality
  // (shared vocabulary) by partial match, biased toward the root, then hands the
  // winning chord's pitch classes + bass to the shared naming engine so the mic
  // readout gets the SAME aliasing, key-aware spelling, and dim7 root handling as
  // the MIDI readout. Returns { name, conf } or null.
  function detectChord() {
    let total = 0;
    for (let i = 0; i < 12; i++) total += chroma[i];
    chromaAgc = Math.max(chromaAgc * 0.995, total, 1e-6);
    if (total < 0.15 * chromaAgc || chromaAgc < 1e-3) return null;

    const c = new Array(12);
    for (let i = 0; i < 12; i++) c[i] = chroma[i] / total;

    let best = null, bestScore = 0;
    for (let root = 0; root < 12; root++) {
      for (const q of CHORD_Q) {
        let inS = 0;
        for (let k = 0; k < q.ivs.length; k++) {
          inS += c[(root + q.ivs[k]) % 12] * (k === 0 ? 1.15 : 1);
        }
        const score = inS / Math.pow(q.ivs.length, 0.55);
        if (score > bestScore) { bestScore = score; best = { root, q }; }
      }
    }
    if (!best) return null;
    let frac = 0;
    for (const iv of best.q.ivs) frac += c[(best.root + iv) % 12];
    if (frac < 0.5) return null;   // too much energy outside the chord tones

    // Convert the detected chord to a 0=C pitch-class set + bass pc, then name it
    // through the shared engine. best.root and bassPcA are 0=A; add 9 for 0=C.
    //
    // The frame bass (bassPcA) is the lowest strong pitch class in the WHOLE
    // spectrum - a bass guitar, a kick's rumble, anything down there - so it is
    // not necessarily one of this chord's tones. Only trust it when it IS a chord
    // tone; otherwise a non-chord bass would silently degrade the alias ordering
    // to root-ascending and, worse, make the dim7 bass fallback prefer a root that
    // is not in the chord (arbitrary name first). Fall back to the detected root.
    const pcSetC = new Set(best.q.ivs.map((iv) => ((best.root + iv) % 12 + 9) % 12));
    const rootC = (best.root + 9) % 12;
    const bassCandidate = bassPcA >= 0 ? (bassPcA + 9) % 12 : -1;
    const bassC = pcSetC.has(bassCandidate) ? bassCandidate : rootC;
    const name = CHORD.nameFromPitchClasses(pcSetC, bassC, getEstimatedKey());
    return { name, conf: frac };
  }
```

Note: `detectChord`'s old return also had `root`/`pcs` (0=A) fields — grep for any
consumer. The only caller is `analyse` (`det.name`, `det.conf`), so dropping
`root`/`pcs` is safe. Verify in Step 5.

- [ ] **Step 4: Confirm the caller only uses name + conf**

The `analyse` call is `stabilizer.update(now, det ? det.name : null, det ? det.conf : 0)`
— uses only `name` and `conf`. No change needed there. Grep to be sure:
`grep -n "\.pcs\|det\.root\|detectChord" web/js/mic-input.js` — the only uses are
the definition and the analyse call.

- [ ] **Step 5: Expose the detector + chroma for testing**

The 0=A -> 0=C conversion above is the single most bug-prone line in this refactor
and is currently untestable (detectChord is private and needs a live FFT). Expose
it, plus a way to inject a chroma, so the conversion can be tested headlessly.

Add to the object returned by `createMicInput`:

```javascript
    // test seam: drive detectChord from a synthetic chroma (no live FFT needed)
    _setChromaForTest: (arr) => { for (let i = 0; i < 12; i++) chroma[i] = arr[i]; },
    _setBassPcForTest: (pcA) => { bassPcA = pcA; },
    _detectChordForTest: () => detectChord(),
```

No AGC seeding is needed. `detectChord` assigns
`chromaAgc = Math.max(chromaAgc * 0.995, total, 1e-6)` **before** the gate
`if (total < 0.15 * chromaAgc || chromaAgc < 1e-3) return null;` reads it — so on
the very first call `chromaAgc >= total`, both gate conditions are false, and a
synthetic chroma passes on feed 1. (Verified: feed 1 and feed 2 return identical
results.) A single feed per test is enough.

**Tradeoff, deliberate:** these three `_*ForTest` methods are public API that
exists only for tests, which brushes CLAUDE.md's "don't add unused functions". It
is justified here: the 0=A -> 0=C conversion is the highest-risk line in this
refactor, it was previously untestable, and the alternative is browser-only
"verified by inspection" — exactly the unfalsifiable claim this plan avoids.

- [ ] **Step 6: Write the conversion test**

Create `web/js/mic-chord-naming.test.js`:

```javascript
// Tests that the mic detector names chords through the SHARED engine, and that
// its 0=A -> 0=C pitch-class conversion is right. Runs on plain Node:
//   node web/js/mic-chord-naming.test.js
'use strict';
const assert = require('assert');
const { createMicInput } = require('./mic-input.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// chroma index 0 = A. Build one with energy on the given 0=A pitch classes.
function chromaFor(pcsA) {
  const c = new Array(12).fill(0.001);
  for (const pc of pcsA) c[pc] = 1.0;
  return c;
}

test('mic names a C major triad as "C" (0=A -> 0=C conversion)', () => {
  const mic = createMicInput();
  // C major = C E G. In 0=A: C=3, E=7, G=10.
  mic._setChromaForTest(chromaFor([3, 7, 10]));
  const det = mic._detectChordForTest();
  assert.ok(det, 'expected a detection');
  assert.strictEqual(det.name, 'C', `expected "C", got "${det.name}"`);
});

test('mic names a half-diminished through the shared engine (with alias)', () => {
  const mic = createMicInput();
  // Bø7 = B D F A. In 0=A: B=2, D=5, F=8, A=0.
  mic._setChromaForTest(chromaFor([2, 5, 8, 0]));
  const det = mic._detectChordForTest();
  assert.ok(det, 'expected a detection');
  // The engine emits slash aliases; ø7 must be one of the names (mic could not
  // detect half-diminished at all before this refactor).
  assert.ok(det.name.includes('ø7'), `expected a ø7 name, got "${det.name}"`);
  assert.ok(det.name.includes('/'), `expected a slash alias, got "${det.name}"`);
});

// The next two pin the chord-tone bass guard from BOTH sides. Without the
// positive case, `const bassC = rootC;` (ignoring the bass entirely) would still
// pass the negative case - the test could not tell "guard rejected the bad bass"
// from "bass never used".
test('a chord-tone frame bass drives the alias ordering', () => {
  const mic = createMicInput();
  // C6 == Am7 = C E G A. In 0=A: C=3, E=7, G=10, A=0. Bass A -> Am7 first.
  mic._setChromaForTest(chromaFor([3, 7, 10, 0]));
  mic._setBassPcForTest(0);                     // 0=A pc0 = A, IS a chord tone
  const det = mic._detectChordForTest();
  assert.ok(det, 'expected a detection');
  assert.ok(det.name.startsWith('Am7'), `expected Am7 first, got "${det.name}"`);
});

test('a non-chord-tone frame bass is ignored (falls back to the detected root)', () => {
  const mic = createMicInput();
  mic._setChromaForTest(chromaFor([3, 7, 10]));  // C major
  mic._setBassPcForTest(1);                      // 0=A pc1 = A#/Bb - NOT a C-major tone
  const det = mic._detectChordForTest();
  assert.ok(det, 'expected a detection');
  assert.strictEqual(det.name, 'C', `non-chord bass must not change the name, got "${det.name}"`);
});

console.log(`\n${passed} passed`);
```

- [ ] **Step 7: Run the tests**

Run: `node web/js/mic-chord-naming.test.js`
Expected: PASS — `4 passed`.
Run: `node -e "require('./web/js/chord-qualities.js'); require('./web/js/key-spelling.js'); require('./web/js/chord.js'); require('./web/js/mic-input.js'); console.log('all load')"` → `all load`.
Run: `node web/js/mic-chord-stabilizer.test.js` (7 passed — unaffected).

If the C-major test fails naming something else, the fuzzy scorer picked a
different quality from the now-larger vocabulary — report it rather than forcing
the test; that is real signal about enabling all 13 chords for mic.

- [ ] **Step 8: Commit**

```bash
git add web/js/mic-input.js web/js/mic-chord-naming.test.js
git commit -m "feat: mic detection delegates naming to the shared chord engine"
```

---

## Task 7: Wire the script + browser verification

**Files:**
- Modify: `web/index.html` (script order)

- [ ] **Step 1: Add the script tag**

`chord-qualities.js` must load before `chord.js` AND `mic-input.js` (both require
`window.ChordQualities`). In `web/index.html`, add it just before `chord.js`:

```html
<script src="./js/note-colours.js"></script>
<script src="./js/key-spelling.js"></script>
<script src="./js/chord-qualities.js"></script>
<script src="./js/chord.js"></script>
```
(key-spelling.js already precedes chord.js. mic-input.js loads later, after these.)

- [ ] **Step 2: Full test sweep**

Run: `node web/js/chord-qualities.test.js && node web/js/chord.test.js && node web/js/chord.alias.test.js && node web/js/chord.implied.test.js && node web/js/key-spelling.test.js && node web/js/mic-chord-stabilizer.test.js && node web/js/mic-chord-naming.test.js && node web/js/note-colours.test.js`
Expected: all PASS.

- [ ] **Step 3: Browser verification (MIDI + mic)**

Serve the repo root and open the app. Confirm:
- **MIDI mode** unchanged: play C-E-G-A → "C6 / Am7"; play B-D-F-A → "Bø7 / Dm6";
  play a dim7 in a minor key → leading-tone root shown first.
- **Mic mode** (needs a mic or a fake audio stream): play/feed a half-diminished
  and a dim7 → they now DETECT (previously never did) and show slash aliases; a
  dim7 with a known key shows the leading-tone root; note the chord names match
  the MIDI readout for the same notes.

The mic naming path (including the 0=A -> 0=C conversion) is covered headlessly by
`mic-chord-naming.test.js` (Task 6), so this browser step is about the real
end-to-end feel: that mic actually detects the new chords off live audio and the
readout matches MIDI for the same notes. If you cannot drive a mic, say so
plainly and rely on that test plus the load checks — do NOT claim a manual mic
result you did not observe.

**This step must actually be performed, not assumed.** `chord-qualities.js` is now
a hard dependency of BOTH `chord.js` and `mic-input.js`: if the script tag is
missing or out of order, both die at parse time and the app renders blank. The
load check in Step 2 catches the Node path; only opening the page catches the
browser script-order path.

- [ ] **Step 4: Commit**

```bash
git add web/index.html
git commit -m "feat: load chord-qualities.js before the chord detectors"
```

---

## Self-Review Notes

- **Spec coverage:** vocabulary centralized (T1), chord.js reads it (T2), engine pc-set entry point (T3), dim7 leading-tone/bass root (T4), mic bass pc (T5), mic delegates naming so it gains all 13 chords + aliases + spelling (T6), wiring + verify (T7). All spec sections map to a task.
- **Regression guard:** T2 and T3 require the existing chord/alias/implied tests to pass UNCHANGED — the MIDI output must be byte-identical. This is the main risk (the pc-set refactor must preserve note-order for the note-name fallback; T3 passes `order` for exactly this).
- **0=A vs 0=C:** the mic path converts with `+9` at the single seam in T6 (`detectChord`), consistent with the existing conversion it replaces.
- **Mic detection method unchanged (option b):** T6 keeps the fuzzy scoring loop verbatim; only the vocabulary source and the naming call change. No behavioural gamble on mic detection.
- **dim7 tie-break:** T4 only overrides ordering when a dim7 match exists and the key's leading tone is one of its roots; every other chord keeps bass-first ordering, so alias tests stay green.

## Revisions from plan review (2026-07-15)

- **[Critical] Mic frame-bass constrained to chord tones (T6).** `bassPcA` is the
  lowest strong pc of the WHOLE spectrum and need not be a tone of the detected
  chord. Feeding it raw to the engine would degrade alias ordering to
  root-ascending and make the dim7 bass fallback prefer a root not in the chord.
  Now: use it only if it is in the chord's pc set, else fall back to the detected
  root. (Verified: a `preferredRoot` matching no root silently sorts
  root-ascending.)
- **[Critical] Bass capture requires a local spectral peak (T5),** not a bare
  -70 dB floor, so broadband rumble cannot claim the bass. Dropped the chroma
  pick's `f < 2200` bound (an upper limit, meaningless when hunting the lowest
  partial). Documented the ascending-band-order dependence and the makeupGain
  caveat.
- **[Important] `chordName`'s no-args contract documented (T4)** — it passes
  neither `bassPc` nor `estimatedKey` on purpose; the degrade to root-ascending is
  today's behaviour and its output is a yes/no guard, never displayed.
- **[Important] `detectChord` exposed for testing (T6)** with a synthetic-chroma
  seam, and a new `mic-chord-naming.test.js` that actually tests the 0=A -> 0=C
  conversion (the most bug-prone line here) plus the non-chord-bass guard. This
  replaces the old self-contradicting "harness or inspection?" paragraph in T7.
- **[Important] Root-bias comment correction flagged (T6)** so the implementer
  does not restore the inaccurate "biases toward the bassier root" wording.
- **Object.freeze on the shared vocabulary (T1)** + a freeze test — two modules
  share one array; CLAUDE.md asks for defensive assertions on shared state.
- **Import asserts (T2, T6)** turn a missing/out-of-order script into a named
  error instead of a null-property mystery.
- **T7 Step 3 must actually be performed** — `chord-qualities.js` is now a hard
  parse-time dependency of both detectors; only opening the page catches a broken
  script order.
- **Minor:** the vocabulary "no duplicate ivs" test is documented as catching
  identical interval LISTS, not pc-set uniqueness (C6==Am7 aliasing is a feature).

## Revisions from re-review (2026-07-15)

- **Dropped the double-feed AGC ceremony (T6).** I had claimed a synthetic chroma
  must be fed twice to settle `chromaAgc`. Traced it: `chromaAgc` is assigned
  `Math.max(..., total, ...)` BEFORE the gate reads it, so feed 1 already passes
  (verified — feed 1 and feed 2 return identical results). The seeding call and
  its explanation were dead ceremony resting on a misreading; both removed.
- **Added the positive bass-guard test (T6).** The negative test alone could not
  distinguish "the guard rejected a non-chord bass" from "the bass is never used"
  — `const bassC = rootC;` would pass it. The new test asserts a chord-tone bass
  DOES reorder the aliases (C6/Am7 with bass A -> "Am7" first), pinning the guard
  from both sides. (Verified against the real engine: A-lowest gives "Am7 / C6",
  C-lowest gives "C6 / Am7".)
- **Named the test-seam tradeoff (T6)** so the three `_*ForTest` methods read as a
  deliberate choice against unfalsifiable browser-only verification, not an
  oversight.
- **Minor:** stale "5 passed" at T2 Step 4 -> 6; `mic-chord-naming.test.js` added
  to T7's full sweep so it keeps running after T6.
