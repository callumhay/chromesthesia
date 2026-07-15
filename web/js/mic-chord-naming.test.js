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

// The next three pin the bass handling. They all use the C6 == Am7 chroma,
// whose two names are ordered SOLELY by the bass - so the assertions can only
// pass if the bass really reaches the engine. Note the detector's own winning
// root here is A, so a test that sets bass=A proves nothing (it matches the root
// either way); C is the bass that actually moves the answer.
test('a chord-tone frame bass drives the alias ordering', () => {
  const mic = createMicInput();
  // C6 == Am7 = C E G A. In 0=A: C=3, E=7, G=10, A=0.
  mic._setChromaForTest(chromaFor([3, 7, 10, 0]));
  mic._setBassPcForTest(3);                      // 0=A pc3 = C, a chord tone != the detected root
  const det = mic._detectChordForTest();
  assert.ok(det, 'expected a detection');
  // Bass C names it from C. Ignoring the bass would give "Am7 / C6" instead.
  assert.strictEqual(det.name, 'C6 / Am7', `bass C must lead with C6, got "${det.name}"`);
});

test('a non-chord-tone frame bass is ignored (falls back to the detected root)', () => {
  const mic = createMicInput();
  mic._setChromaForTest(chromaFor([3, 7, 10, 0]));  // C6 == Am7
  mic._setBassPcForTest(1);                         // 0=A pc1 = A#/Bb - NOT a chord tone
  const det = mic._detectChordForTest();
  assert.ok(det, 'expected a detection');
  // Falls back to the detected root (A) -> Am7 leads. Feeding the bogus bass
  // through would spell a Bb-rooted name that is not in this chord at all.
  assert.strictEqual(det.name, 'Am7 / C6', `non-chord bass must not lead, got "${det.name}"`);
});

// The unset bass is the sentinel -1, and (-1 + 9) % 12 === 8 - so dropping the
// `bassPcA >= 0` guard invents an Ab bass. This MUST use a chord containing Ab:
// on any other chord the chord-tone guard rejects the phantom anyway and the bug
// hides. Fm7 == Ab6 contains Ab and is bass-ordered, so the phantom surfaces.
test('an unset frame bass invents no bass note', () => {
  const mic = createMicInput();
  // Fm7 == Ab6 = F Ab C Eb. In 0=A: F=8, Ab=11, C=3, Eb=6. Bass left unset (-1).
  mic._setChromaForTest(chromaFor([8, 11, 3, 6]));
  const det = mic._detectChordForTest();
  assert.ok(det, 'expected a detection');
  assert.strictEqual(det.name, 'Fm7 / Ab6',
    `unset bass must fall back to the detected root, not a phantom Ab, got "${det.name}"`);
});

console.log(`\n${passed} passed`);
