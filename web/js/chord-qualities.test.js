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

// Structural invariant rather than a row-by-row restatement of the table: this
// catches a typo in any row (and any row added later) without duplicating the data.
test('every required interval is one of the quality own tones, and min is reachable', () => {
  for (const q of CHORD_QUALITIES) {
    for (const iv of q.required) {
      assert.ok(q.ivs.includes(iv), `${q.name}: required ${iv} not in ivs ${q.ivs}`);
    }
    assert.ok(q.required.includes(0), `${q.name}: root must be required`);
    assert.ok(q.min <= q.ivs.length, `${q.name}: min ${q.min} exceeds ${q.ivs.length} tones`);
  }
});

console.log(`\n${passed} passed`);
