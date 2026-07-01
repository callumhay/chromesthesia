// Unit tests for note-colours.js. Runs on plain Node, no toolchain:
//   node web/js/note-colours.test.js
//
// Covers the pure mapping: correct chromesthesia core colour per pitch class,
// the sharp/flat name reconciliation, the octave brightness ramp, and the
// velocity-intensity toggle.

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const NC = require('./note-colours.js');

// Load the real shared JSON so the test also guards the JS<->JSON contract.
const jsonPath = path.join(__dirname, '..', '..', 'note_colours.json');
const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
NC.setNoteColours(data);

function approx(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }
function colourEq(actual, expected, msg) {
  assert.ok(
    approx(actual[0], expected[0]) && approx(actual[1], expected[1]) && approx(actual[2], expected[2]),
    `${msg}: got [${actual}] expected [${expected}]`
  );
}

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

// MIDI 69 = A4 -> pitch class A (index 0) -> red
test('A4 maps to red (chromesthesia A)', () => {
  const r = NC.noteToColour(69, 1.0);
  assert.strictEqual(r.pcIndex, 0);
  colourEq(r.core, [1, 0, 0], 'A core');
});

// MIDI 60 = C4 -> C -> [0.6, 0, 0.9] purple
test('C4 maps to chromesthesia C purple', () => {
  const r = NC.noteToColour(60, 1.0);
  assert.strictEqual(NC.PITCH_CLASSES[r.pcIndex], 'C');
  colourEq(r.core, [0.6, 0, 0.9], 'C core');
  assert.strictEqual(r.octave, 4);
});

// Sharp/flat reconciliation: MIDI 61 = C#4 -> flat Db -> [0.5, 0.65, 0]
test('C#4 resolves via flat spelling Db', () => {
  const r = NC.noteToColour(61, 1.0);
  assert.strictEqual(NC.PITCH_CLASSES[r.pcIndex], 'C#');
  colourEq(r.core, [0.5, 0.65, 0], 'Db core');
});

// The base core colour is the note's identity and does NOT change with octave
// (octave brightness shading is applied downstream in the visualizer feeder).
test('same note different octave: identical core colour', () => {
  const low = NC.noteToColour(48, 1.0);   // C3
  const high = NC.noteToColour(84, 1.0);  // C6
  colourEq(low.core, high.core, 'core identical across octaves');
  assert.strictEqual(low.octave, 3);
  assert.strictEqual(high.octave, 6);
});

// Velocity toggle
test('velocity drives intensity when enabled', () => {
  const soft = NC.noteToColour(60, 0.2);
  const hard = NC.noteToColour(60, 1.0);
  assert.ok(hard.intensity > soft.intensity, 'harder = brighter');
});

test('velocity ignored when velocityIntensity off', () => {
  const params = Object.assign({}, NC.DEFAULT_PARAMS, { velocityIntensity: false });
  const soft = NC.noteToColour(60, 0.2, params);
  assert.strictEqual(soft.intensity, 1.0, 'fixed intensity');
});

// Every pitch class must resolve to a colour present in the JSON.
test('all 12 pitch classes resolve to a colour', () => {
  for (let midi = 60; midi < 72; midi++) {
    const r = NC.noteToColour(midi, 1.0);
    assert.ok(r.core.every(v => v >= 0 && v <= 1), `pc ${midi} valid colour`);
  }
});

// Octave numbering matches scientific pitch (MIDI 69 = A4).
test('MIDI octave numbering (A4 = 69, C-1 = 0)', () => {
  assert.strictEqual(NC.midiToOctave(69), 4);
  assert.strictEqual(NC.midiToOctave(60), 4);
  assert.strictEqual(NC.midiToOctave(0), -1);
});

console.log(`\n${passed} tests passed.`);
