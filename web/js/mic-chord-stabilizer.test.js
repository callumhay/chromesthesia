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
