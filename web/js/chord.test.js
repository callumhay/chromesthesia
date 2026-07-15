// Unit tests for chord.js exact-MIDI chord naming. Runs on plain Node:
//   node web/js/chord.test.js
//
// The detector takes the EXACT set of held MIDI notes (no smoothing/filtering,
// since MIDI gives exact note-on/off) and returns a display string:
//   - a chord name when the held pitch classes exactly form a recognized chord
//   - otherwise the held note names
//   - '' when nothing is held

'use strict';
const assert = require('assert');
const { nameFromMidiNotes } = require('./chord.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// --- the reported bugs ----------------------------------------------------

// BUG: C + F (two notes) was showing "Csus4". Csus4 = C F G; with only C+F
// held it must NOT be named a chord - it should show the two note names.
test('C + F held shows note names, not Csus4', () => {
  assert.strictEqual(nameFromMidiNotes([60, 65]), 'C F');   // C4, F4
});

// BUG: order dependence. C-then-F and F-then-C are the same held SET, so the
// result must be identical regardless of order (the function takes a set).
test('order independence: {C,F} == {F,C}', () => {
  assert.strictEqual(nameFromMidiNotes([60, 65]), nameFromMidiNotes([65, 60]));
});

// BUG: stale readout. Releasing back to a single note must immediately reflect
// just that note - no lingering chord.
test('releasing to a single note shows that note only', () => {
  assert.strictEqual(nameFromMidiNotes([60]), 'C');
});

test('releasing everything shows nothing', () => {
  assert.strictEqual(nameFromMidiNotes([]), '');
});

// --- real chords ARE named (all tones present) ----------------------------

test('C major triad (C E G) is named C', () => {
  assert.strictEqual(nameFromMidiNotes([60, 64, 67]), 'C');
});

test('C minor (C Eb G) is named Cm', () => {
  assert.strictEqual(nameFromMidiNotes([60, 63, 67]), 'Cm');
});

// Csus4 (C F G) and Fsus2 (F G C) are the same three notes - a real alias, so
// both names show, bass (C) first.
test('actual Csus4 (C F G) is named "Csus4 / Fsus2" (sus alias)', () => {
  assert.strictEqual(nameFromMidiNotes([60, 65, 67]), 'Csus4 / Fsus2');
});

test('C7 (C E G Bb) is named C7', () => {
  assert.strictEqual(nameFromMidiNotes([60, 64, 67, 70]), 'C7');
});

test('chord recognised regardless of octave spread (C3 E4 G5)', () => {
  assert.strictEqual(nameFromMidiNotes([48, 64, 79]), 'C');
});

test('duplicate pitch classes across octaves still name the chord (C3 C4 E4 G4)', () => {
  assert.strictEqual(nameFromMidiNotes([48, 60, 64, 67]), 'C');
});

// --- non-chords show note names -------------------------------------------

test('two random notes show note names (C + Gb)', () => {
  assert.strictEqual(nameFromMidiNotes([60, 66]), 'C Gb');
});

test('unrecognised cluster shows note names (C Db D)', () => {
  assert.strictEqual(nameFromMidiNotes([60, 61, 62]), 'C Db D');
});

// note names are de-duplicated by pitch class and shown once
test('same pitch class in two octaves shows once (C3 + C5)', () => {
  assert.strictEqual(nameFromMidiNotes([48, 72]), 'C');
});

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

// --- pitch-class-set entry point (shared by MIDI + mic) -------------------
const { nameFromPitchClasses } = require('./chord.js');

test('nameFromPitchClasses matches nameFromMidiNotes for a chord', () => {
  // C E G = C major; pcSet {0,4,7}, bass 0 (0=C convention)
  assert.strictEqual(nameFromPitchClasses(new Set([0, 4, 7]), 0, null), 'C');
});

test('nameFromPitchClasses shows slash aliases (C E G A -> C6 / Am7)', () => {
  assert.strictEqual(nameFromPitchClasses(new Set([0, 4, 7, 9]), 0, null), 'C6 / Am7');
});

test('nameFromPitchClasses half-diminished (B D F A -> Bø7 / Dm6), bass B', () => {
  const r = nameFromPitchClasses(new Set([11, 2, 5, 9]), 11, null);
  assert.ok(r.startsWith('Bø7'), `expected Bø7 first, got "${r}"`);
});

test('nameFromPitchClasses of an unknown set returns the spelled note names', () => {
  // C + F# (0,6) is not a chord -> note names in pc order (bass first)
  assert.strictEqual(nameFromPitchClasses(new Set([0, 6]), 0, null), 'C Gb');
});

test('nameFromPitchClasses: orderedPcs drives the note-name fallback order', () => {
  // Same set + bass, different explicit order -> different output. This pins the
  // 4th param, which exists so the MIDI path can preserve PITCH order (a pc set
  // cannot express it). Without this, ignoring orderedPcs entirely still passes.
  assert.strictEqual(nameFromPitchClasses(new Set([0, 6]), 6, null, [6, 0]), 'Gb C');
  assert.strictEqual(nameFromPitchClasses(new Set([0, 6]), 6, null, [0, 6]), 'C Gb');
});

test('nameFromPitchClasses: bassPc drives the alias ordering', () => {
  // Same pc set, different bass -> the bass-rooted reading leads. This is exactly
  // what mic mode will exercise when it passes its own detected bass.
  assert.strictEqual(nameFromPitchClasses(new Set([0, 4, 7, 9]), 0, null), 'C6 / Am7');
  assert.strictEqual(nameFromPitchClasses(new Set([0, 4, 7, 9]), 9, null), 'Am7 / C6');
});

console.log(`\n${passed} tests passed.`);
