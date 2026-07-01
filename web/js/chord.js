// chord.js
//
// Chord/note readout for the centre of the wheel, driven by the EXACT set of
// held MIDI notes. MIDI gives exact note-on/off, so - unlike a microphone/FFT
// feed - there is NO filtering or smoothing here: the readout reflects exactly
// what is held, instantly. A chord name is shown only when the held pitch
// classes exactly form a recognized chord; otherwise the held note names are
// shown; nothing is held -> blank.
//
// (An FFT/mic feed would want smoothing and fuzzy partial-match scoring, since
// it never knows the exact notes. That machinery is deliberately absent here.)

'use strict';

// Pitch-class names indexed 0 = C (standard MIDI: pc = midi % 12).
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Chord qualities as interval sets from the root (semitones). Order matters:
// earlier = preferred when two qualities share a pitch-class set (none here do
// for exact-match, but keep the common triads first).
const QUALITIES = [
  { name: '',     ivs: [0, 4, 7] },        // major
  { name: 'm',    ivs: [0, 3, 7] },        // minor
  { name: 'dim',  ivs: [0, 3, 6] },
  { name: 'aug',  ivs: [0, 4, 8] },
  { name: 'sus2', ivs: [0, 2, 7] },
  { name: 'sus4', ivs: [0, 5, 7] },
  { name: '7',    ivs: [0, 4, 7, 10] },
  { name: 'maj7', ivs: [0, 4, 7, 11] },
  { name: 'm7',   ivs: [0, 3, 7, 10] },
  { name: 'm7b5', ivs: [0, 3, 6, 10] },
  { name: 'dim7', ivs: [0, 3, 6, 9] },
  { name: '6',    ivs: [0, 4, 7, 9] },
  { name: 'm6',   ivs: [0, 3, 7, 9] },
];

// Unique pitch-class set (0..11) from a list of MIDI note numbers. Also returns
// the pitch classes ordered by the lowest MIDI note at which each appears, so
// the note-name readout is stable and order-independent (it reflects pitch, not
// the order keys were pressed) - fixing the play-order dependence.
function pitchClasses(midiNotes) {
  const lowestMidi = new Map();   // pc -> lowest midi note seen for it
  for (const m of midiNotes) {
    const pc = ((m % 12) + 12) % 12;
    if (!lowestMidi.has(pc) || m < lowestMidi.get(pc)) lowestMidi.set(pc, m);
  }
  const order = [...lowestMidi.keys()].sort((a, b) => lowestMidi.get(a) - lowestMidi.get(b));
  return { set: new Set(lowestMidi.keys()), order };
}

// Does the held pitch-class set exactly equal this chord's pitch-class set?
function exactMatch(heldSet, root, ivs) {
  if (heldSet.size !== ivs.length) return false;
  for (const iv of ivs) {
    if (!heldSet.has((root + iv) % 12)) return false;
  }
  return true;
}

// Name the exact chord formed by the held pitch classes, or null if the held
// set is not a recognized chord.
function chordName(heldSet) {
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      if (exactMatch(heldSet, root, q.ivs)) {
        return PC_NAMES[root] + q.name;
      }
    }
  }
  return null;
}

// The public readout function: exact held MIDI notes -> display string.
function nameFromMidiNotes(midiNotes) {
  const { set, order } = pitchClasses(midiNotes);
  if (set.size === 0) return '';
  const chord = chordName(set);
  if (chord) return chord;
  // not a recognized chord: show the held note names (deduped by pitch class,
  // in the order first played)
  return order.map((pc) => PC_NAMES[pc]).join(' ');
}

// Thin DOM binding: set the readout text from the current held notes. No
// hysteresis or fade - it mirrors the held set exactly.
class ChordReadout {
  constructor(nameEl) {
    this.nameEl = nameEl;
    this.last = null;
  }

  // midiNotes: array (or iterable) of currently-held MIDI note numbers.
  update(midiNotes) {
    const text = nameFromMidiNotes(Array.from(midiNotes));
    if (text !== this.last) {
      this.last = text;
      this.nameEl.textContent = text;
      this.nameEl.style.opacity = text ? '1' : '0';
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChordReadout, nameFromMidiNotes, chordName, PC_NAMES, QUALITIES };
}
if (typeof window !== 'undefined') {
  window.ChordReadout = ChordReadout;
  window.nameFromMidiNotes = nameFromMidiNotes;
}
