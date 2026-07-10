// Tests for chord aliases: when a held pitch-class set has more than one valid
// exact name (same notes, different root/quality), the main readout shows them
// all, bass-note first, joined with " / ".
//   node web/js/chord.alias.test.js

'use strict';
const assert = require('assert');
const { nameFromMidiNotes } = require('./chord.js');

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

// --- m7b5 == m6 : Am7b5 (A C Eb G) == Cm6 (C Eb G A) ----------------------

test('A C Eb G with A in bass -> "Am7b5 / Cm6"', () => {
  assert.strictEqual(nameFromMidiNotes([57, 60, 63, 67]), 'Am7b5 / Cm6'); // A3 C4 Eb4 G4
});

test('same notes with C in bass -> "Cm6 / Am7b5"', () => {
  assert.strictEqual(nameFromMidiNotes([60, 63, 67, 69]), 'Cm6 / Am7b5'); // C4 Eb4 G4 A4
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

console.log(`\n${passed} tests passed.`);
