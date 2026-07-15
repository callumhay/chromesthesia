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

// Embedded copy of note_colours.json, used as a fallback when the fetch is
// blocked (e.g. the page opened as a file:// URL, where browsers deny fetch of
// local files). note_colours.json remains the single source of truth when
// served; this copy must mirror it exactly. It is regenerated from the JSON by
// `node scripts/embed-note-colours.js` and guarded by note-colours.test.js, so
// it can't silently drift. Do not hand-edit the block between the markers.
/* BEGIN EMBEDDED_NOTE_COLOURS (generated from note_colours.json) */
const EMBEDDED_NOTE_COLOURS = {
  "circle_of_fifths": ["A","E","B","Gb","Db","Ab","Eb","Bb","F","C","G","D"],
  "colours": {
    "A": [1,0,0],
    "E": [1,0.35,0],
    "B": [1,0.55,0],
    "Gb": [1,1,0],
    "Db": [0.5,0.65,0],
    "Ab": [0,1,0.5],
    "Eb": [0,1,1],
    "Bb": [0,0.5,1],
    "F": [0,0,1],
    "C": [0.6,0,0.9],
    "G": [1,0,1],
    "D": [1,0,0.5]
  }
};
/* END EMBEDDED_NOTE_COLOURS */

// Where note_colours.json sits relative to index.html depends on how the app is
// served: beside it when web/ is the site root (GitHub Pages, which copies the
// file in - see .github/workflows), one level up when the repo root is served.
// Try both rather than pick one and 404 on the other.
const NOTE_COLOURS_URLS = ['./note_colours.json', '../note_colours.json'];

// Load the shared colour table (the source of truth when served over HTTP),
// trying each candidate URL in order. Falls back to the embedded copy if none
// resolve - most commonly on a file:// URL, where browsers deny fetch outright.
// Returns the loaded colour table.
async function loadNoteColours(urls = NOTE_COLOURS_URLS) {
  // './' and '../' resolve to the SAME URL when the page is already at the site
  // root, so drop duplicates rather than fetch (and log) the same 404 twice.
  const seen = new Set();
  for (const url of [].concat(urls)) {
    const resolved = (typeof URL === 'function' && typeof location !== 'undefined')
      ? new URL(url, location.href).href : url;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    try {
      const res = await fetch(resolved);
      if (!res.ok) continue;
      const data = await res.json();
      setNoteColours(data);
      return data;
    } catch (e) {
      // unreachable/blocked/malformed - try the next candidate
    }
  }
  setNoteColours(EMBEDDED_NOTE_COLOURS);
  return EMBEDDED_NOTE_COLOURS;
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
  PITCH_CLASSES, SHARP_TO_FLAT, DEFAULT_PARAMS, EMBEDDED_NOTE_COLOURS,
  loadNoteColours, setNoteColours,
  midiToPitchClassIndex, midiToOctave,
  coreColourForPitchClass, noteToColour,
};

if (typeof module !== 'undefined' && module.exports) module.exports = NoteColours;
if (typeof window !== 'undefined') window.NoteColours = NoteColours;
