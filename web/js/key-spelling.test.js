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

test('minor keys spell via their relative major (tonic+3)', () => {
  // D minor is relative to F major, so pc 10 spells Bb
  assert.strictEqual(spell(10, { tonic: 2, mode: 'minor' }), 'Bb');
  // A minor is relative to C major, so pc 9 spells A (natural)
  assert.strictEqual(spell(9, { tonic: 9, mode: 'minor' }), 'A');
});

test('chromatic (non-diatonic) notes follow the key direction', () => {
  // pc 6 is non-diatonic in C major -> sharp side -> F#
  assert.strictEqual(spell(6, { tonic: 0, mode: 'major' }), 'F#');
  // pc 6 is non-diatonic in F major -> flat side -> Gb
  assert.strictEqual(spell(6, { tonic: 5, mode: 'major' }), 'Gb');
});

test('Gb major spells its diatonic 7th degree as Cb', () => {
  // pc 11 is the 4th... no: in Gb major pc 11 = Cb (the correct diatonic spelling)
  assert.strictEqual(spell(11, { tonic: 6, mode: 'major' }), 'Cb');
});

const { createKeyEstimator } = require('./key-spelling.js');

test('histogram weight halves over one MIDI half-life', () => {
  const est = createKeyEstimator();
  est.settings.halfLifeMidiSec = 2;
  est.decayTo(0, 'midi');                 // seed lastT=0 (first call only sets the clock)
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

test('an A-minor note stream estimates A minor', () => {
  const est = createKeyEstimator();
  const AMIN = [57, 59, 60, 62, 64, 65, 67, 69];   // A B C D E F G A
  let t = 0;
  for (let rep = 0; rep < 4; rep++) {
    for (const m of AMIN) { est.addNoteOn(m, 0.9); est.decayTo(t += 0.1, 'midi'); }
  }
  assert.deepStrictEqual(est.estimateKey(), { tonic: 9, mode: 'minor' });
});

console.log(`\n${passed} passed`);
