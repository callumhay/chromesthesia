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
  // mic could not detect half-diminished AT ALL before this refactor.
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
