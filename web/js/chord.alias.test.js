// Tests for chord aliases: when a held pitch-class set has more than one valid
// exact name (same notes, different root/quality), the main readout shows them
// all, bass-note first, joined with " / ".
//   node web/js/chord.alias.test.js

'use strict';
const assert = require('assert');
const { nameFromMidiNotes, displayFromMidiNotes, displayFromPitchClasses } = require('./chord.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// --- the headline case: C6 == Am7 (C E G A) -------------------------------

// C in the bass -> C6 first
test('C E G A with C in bass -> "C6 / Am7"', () => {
  assert.strictEqual(nameFromMidiNotes([60, 64, 67, 69]), 'C6 / Am7');  // C4 E4 G4 A4
});

// A in the bass -> Am7 first
test('same notes with A in bass -> "Am7 / C6"', () => {
  assert.strictEqual(nameFromMidiNotes([57, 60, 64, 67]), 'Am7 / C6');  // A3 C4 E4 G4
});

// --- ø7 == m6 : Aø7 (A C Eb G) == Cm6 (C Eb G A) --------------------------
// half-diminished is written with the slashed-o symbol (Aø7), not "Am7b5"

test('A C Eb G with A in bass -> "Aø7 / Cm6"', () => {
  assert.strictEqual(nameFromMidiNotes([57, 60, 63, 67]), 'Aø7 / Cm6'); // A3 C4 Eb4 G4
});

test('same notes with C in bass -> "Cm6 / Aø7"', () => {
  assert.strictEqual(nameFromMidiNotes([60, 63, 67, 69]), 'Cm6 / Aø7'); // C4 Eb4 G4 A4
});

// --- symmetric aug: C E G# = 3 names --------------------------------------

test('C E G# (augmented) shows all three names, bass first', () => {
  // C in bass -> Caug first, then the other two rotations
  const r = nameFromMidiNotes([60, 64, 68]);  // C4 E4 G#4
  assert.ok(r.startsWith('Caug'), `expected Caug first, got "${r}"`);
  assert.ok(r.includes('Eaug') && r.includes('Abaug'), `expected all three: "${r}"`);
});

// --- symmetric dim7: C Eb Gb A = 4 names ----------------------------------

test('C Eb Gb A (dim7) shows four names, bass first', () => {
  const r = nameFromMidiNotes([60, 63, 66, 69]); // C Eb Gb A
  assert.ok(r.startsWith('Cdim7'), `expected Cdim7 first, got "${r}"`);
  assert.strictEqual(r.split(' / ').length, 4, `expected 4 names: "${r}"`);
});

// --- plain chords with a single name are unchanged ------------------------

test('C major (single name) has no alias', () => {
  assert.strictEqual(nameFromMidiNotes([60, 64, 67]), 'C');
});

test('C7 (single name) has no alias', () => {
  assert.strictEqual(nameFromMidiNotes([60, 64, 67, 70]), 'C7');
});

// non-chords still show note names (unchanged)
test('non-chord still shows note names', () => {
  assert.strictEqual(nameFromMidiNotes([60, 66]), 'C Gb');
});

// --- MIDI split display: symmetric chord's synonyms move to the sub-display ---
// The main readout shows the single rooted name; the interval-equal synonyms go
// to the dimmed sub-display instead of onto a slash-joined line. MIDI always has
// a bass (the lowest held note), so the root is always confident here.

test('dim7 with bass C, no key -> main "Cdim7", synonyms in sub', () => {
  const { main, synonyms } = displayFromMidiNotes([60, 63, 66, 69], null); // C Eb Gb A
  assert.strictEqual(main, 'Cdim7');
  assert.deepStrictEqual(synonyms, ['Ebdim7', 'Gbdim7', 'Adim7']);
});

test('dim7 roots on the key leading tone, bass demoted to a synonym', () => {
  // A minor vii°7 = G# B D F, played with D in the bass. The leading tone G#
  // leads the main display; the bass-rooted Ddim7 becomes one of the synonyms.
  const { main, synonyms } = displayFromMidiNotes([62, 65, 68, 71], { tonic: 9, mode: 'minor' });
  assert.strictEqual(main, 'G#dim7');
  assert.deepStrictEqual(synonyms, ['Ddim7', 'Fdim7', 'Bdim7']);
});

test('augmented (also symmetric) splits: main "Caug", two synonyms', () => {
  const { main, synonyms } = displayFromMidiNotes([60, 64, 68], null); // C E G#
  assert.strictEqual(main, 'Caug');
  assert.deepStrictEqual(synonyms, ['Eaug', 'Abaug']);
});

// --- what must NOT split ---------------------------------------------------

test('non-symmetric alias C6/Am7 stays slash-joined, no synonyms', () => {
  const { main, synonyms } = displayFromMidiNotes([60, 64, 67, 69], null); // C E G A, bass C
  assert.strictEqual(main, 'C6 / Am7');
  assert.deepStrictEqual(synonyms, []);
});

test('a plain single-name chord has an empty sub-display', () => {
  const { main, synonyms } = displayFromMidiNotes([60, 64, 67], null);
  assert.strictEqual(main, 'C');
  assert.deepStrictEqual(synonyms, []);
});

test('a symmetric chord with NO confident root keeps the slash line', () => {
  // No bass (undefined) and no key -> nothing to root on, so fall back to the
  // slash-joined line rather than pick a lead arbitrarily.
  const { main, synonyms } = displayFromPitchClasses(new Set([0, 3, 6, 9]), undefined, null);
  assert.strictEqual(main, 'Cdim7 / Ebdim7 / Gbdim7 / Adim7');
  assert.deepStrictEqual(synonyms, []);
});

console.log(`\n${passed} tests passed.`);
