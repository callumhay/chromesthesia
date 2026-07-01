// note-colours.js
//
// Single source of truth for note colours is /note_colours.json at the repo
// root (shared with the Python LED app via NoteUtils.py). This module loads
// that JSON and exposes the pure mapping from a MIDI note (pitch class +
// octave + velocity) to the chromesthesia core colour and its cel-shaded
// octave accent band.
//
// Colour identity comes ONLY from the pitch class (the chromesthesia circle of
// fifths colour). Octave is expressed as a discrete brightness step on a single
// hard-edged accent band around the core. Velocity optionally scales glow
// intensity. See docs/superpowers/specs/2026-07-01-midi-waveloop-view-design.md

'use strict';

// Wheel pitch-class order, index 0 = A (12 o'clock), chromatic sharps.
// This matches waveloop's #wheel labels and pc01 convention.
const PITCH_CLASSES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

// Sharp -> chromesthesia flat spelling (mirrors NoteUtils.standardize_note_name).
const SHARP_TO_FLAT = {
  'A#': 'Bb', 'C#': 'Db', 'D#': 'Eb', 'F#': 'Gb', 'G#': 'Ab',
};

// Default cel-shading parameters. The debug panel mutates a copy of these and
// persists them to localStorage; noteToColour takes params explicitly so it
// stays a pure function (testable without the DOM).
const DEFAULT_PARAMS = {
  // Octave shading: a note's colour is its chromesthesia hue, brightness-shaded
  // for its octave relative to the reference octave (C4 = 100%). These bound the
  // shading so it never looks bad - low octaves darker but vivid, high octaves
  // brighter toward white.
  octaveLowBrightness: 0.40,   // brightness of the lowest octaves (0..1)
  octaveHighBrightness: 1.00,  // brightness of the highest octaves (1..~1.6)
  velocityIntensity: true,     // MIDI velocity drives glow intensity
  // Note plumes: angular size multiplier for each note's lobe/plume.
  plumeSize: 2.0,              // 1 = default width; larger = fatter plumes
  // MIDI: ignore note-ons whose velocity is below this cutoff (0..1).
  velocityCutoff: 0.1,        // 0 = accept all notes
};

let COLOURS = null;          // { 'A': [r,g,b], ... } flat-named, 0..1
let CIRCLE_OF_FIFTHS = null; // array of flat names

// Load the shared JSON. Returns a promise resolving to the loaded colour table.
async function loadNoteColours(url = '../note_colours.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load note colours: ${res.status}`);
  const data = await res.json();
  setNoteColours(data);
  return data;
}

// Inject a colour table directly (used by tests and by loadNoteColours).
function setNoteColours(data) {
  COLOURS = data.colours;
  CIRCLE_OF_FIFTHS = data.circle_of_fifths;
}

// MIDI note number (0..127) -> pitch class index (0 = A) matching the wheel.
// MIDI note 69 = A4. pc = (midi - 69) mod 12, and 0 -> A.
function midiToPitchClassIndex(midi) {
  return ((midi - 69) % 12 + 12) % 12;
}

// MIDI note number -> octave number (scientific pitch notation, C4 = middle C,
// MIDI 60). Matches librosa.midi_to_note octave convention used by the app.
function midiToOctave(midi) {
  return Math.floor(midi / 12) - 1;
}

// Pitch class index -> chromesthesia core colour [r,g,b] in 0..1.
function coreColourForPitchClass(pcIndex) {
  const sharp = PITCH_CLASSES[pcIndex];
  const flat = SHARP_TO_FLAT[sharp] || sharp;
  const c = COLOURS && COLOURS[flat];
  return c ? [c[0], c[1], c[2]] : [0.5, 0.5, 0.5];
}

// clamp helper
function clamp01(x) { return Math.min(1, Math.max(0, x)); }

// The pure mapping. Given a MIDI note number and its velocity (0..1), return
// the note's base chromesthesia colour, its pitch class and octave, and the
// glow intensity. The octave BRIGHTNESS shading is applied downstream in the
// visualizer's feeder (feedNotes), which knows the reference octave and the
// low/high brightness params.
//
//   core      : pure chromesthesia colour for the pitch class [r,g,b] 0..1
//   pcIndex   : pitch class index (0 = A)
//   octave    : scientific-pitch octave (C4 = 4)
//   intensity : 0..1 glow multiplier (velocity-driven if enabled)
function noteToColour(midi, velocity, params = DEFAULT_PARAMS) {
  const pc = midiToPitchClassIndex(midi);
  const octave = midiToOctave(midi);
  const core = coreColourForPitchClass(pc);
  const intensity = params.velocityIntensity ? clamp01(velocity) : 1.0;
  return { core, intensity, pcIndex: pc, octave };
}

// Export for both browser (window/global) and Node (tests).
const NoteColours = {
  PITCH_CLASSES, SHARP_TO_FLAT, DEFAULT_PARAMS,
  loadNoteColours, setNoteColours,
  midiToPitchClassIndex, midiToOctave,
  coreColourForPitchClass, noteToColour,
};

if (typeof module !== 'undefined' && module.exports) module.exports = NoteColours;
if (typeof window !== 'undefined') window.NoteColours = NoteColours;
