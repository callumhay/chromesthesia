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
  bandThickness: 0.4,   // accent band width (fraction of the note footprint)
  coreBandRatio: 0.55,  // split of footprint between core (this) and band
  octaveLow: 1,         // octave mapped to the darkest accent
  octaveHigh: 7,        // octave mapped to the brightest accent
  lowBright: 0.25,      // accent brightness floor (at/below octaveLow)
  highBright: 1.0,      // accent brightness ceiling (at/above octaveHigh)
  accentSaturation: 0.7,// how much of the core hue the accent keeps (vs white)
  velocityIntensity: true, // MIDI velocity drives glow intensity
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

// Map an octave to an accent brightness in [0,1] via the low->high ramp.
function octaveBrightness(octave, params) {
  const lo = params.octaveLow, hi = params.octaveHigh;
  let t;
  if (hi <= lo) t = 1;
  else t = (octave - lo) / (hi - lo);
  t = Math.min(1, Math.max(0, t));
  return params.lowBright + (params.highBright - params.lowBright) * t;
}

// clamp helper
function clamp01(x) { return Math.min(1, Math.max(0, x)); }

// The pure mapping. Given a MIDI note number, its velocity (0..1), and the cel
// params, return the core colour, the octave-accent band colour, and the glow
// intensity. Colours are [r,g,b] in 0..1.
//
//   core      : pure chromesthesia colour for the pitch class
//   accent    : core hue scaled toward the octave brightness, desaturated
//               toward white by (1 - accentSaturation); this is the single
//               hard-edged cel band around the core
//   intensity : 0..1 glow multiplier (velocity-driven if enabled)
function noteToColour(midi, velocity, params = DEFAULT_PARAMS) {
  const pc = midiToPitchClassIndex(midi);
  const octave = midiToOctave(midi);
  const core = coreColourForPitchClass(pc);
  const bright = octaveBrightness(octave, params);

  // Accent = core hue scaled by octave brightness, then lifted toward white by
  // (1 - accentSaturation) so higher octaves read as a brighter, slightly
  // whiter rim while still carrying the note's hue.
  const s = params.accentSaturation;
  const whiteLift = (1 - s) * bright;
  const accent = [
    clamp01(core[0] * bright + whiteLift),
    clamp01(core[1] * bright + whiteLift),
    clamp01(core[2] * bright + whiteLift),
  ];

  const intensity = params.velocityIntensity ? clamp01(velocity) : 1.0;

  return { core, accent, intensity, pcIndex: pc, octave, brightness: bright };
}

// Export for both browser (window/global) and Node (tests).
const NoteColours = {
  PITCH_CLASSES, SHARP_TO_FLAT, DEFAULT_PARAMS,
  loadNoteColours, setNoteColours,
  midiToPitchClassIndex, midiToOctave,
  coreColourForPitchClass, octaveBrightness, noteToColour,
};

if (typeof module !== 'undefined' && module.exports) module.exports = NoteColours;
if (typeof window !== 'undefined') window.NoteColours = NoteColours;
