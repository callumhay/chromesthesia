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

console.log(`\n${passed} passed`);
