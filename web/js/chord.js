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

// --- implied chords (supplementary) ---------------------------------------
// When the held notes are NOT an exact chord but strongly imply one, name it.
// Each quality lists the intervals that MUST be present for it to be implied -
// the root (0) plus the identity-defining tone(s) - and a coverage minimum
// (how many of the quality's tones must sound). Following 4-part-harmony rules
// with mild relaxation: a triad needs the root + its identity tone (the 3rd,
// or the altered 5th for dim/aug); a 7th chord needs root + 3rd + 7th and 3 of
// its 4 tones. If more than one quality is implied for the same root, or the
// same coverage is reached by different roots, it is ambiguous -> no suggestion.
const IMPLIED = [
  // triads: identity is the 3rd (maj/min) - root + 3rd required, 2 of 3 tones
  { name: '',     ivs: [0, 4, 7],     required: [0, 4],    min: 2 },
  { name: 'm',    ivs: [0, 3, 7],     required: [0, 3],    min: 2 },
  // dim: identity is the b5 + the min3 - root + both required (root+b5 alone is
  // a bare tritone, too ambiguous). aug is symmetric (every tone is a possible
  // root), so only name it when all three tones are present.
  { name: 'dim',  ivs: [0, 3, 6],     required: [0, 3, 6], min: 3 },
  { name: 'aug',  ivs: [0, 4, 8],     required: [0, 4, 8], min: 3 },
  // sus: no real 3rd, so identity rests on BOTH the sus tone and the 5th -
  // require all three tones (a bare root+4th/5th is an ambiguous power chord,
  // not an implied sus)
  { name: 'sus2', ivs: [0, 2, 7],     required: [0, 2, 7], min: 3 },
  { name: 'sus4', ivs: [0, 5, 7],     required: [0, 5, 7], min: 3 },
  // 7th chords: the quality note is the 7th (that is what makes it a 7th
  // chord), so root + 7th are required. When the 3rd is also held it settles
  // major vs minor; when the 3rd is ABSENT the plain dominant '7' is the
  // default (it sorts before maj7/m7 below, so it wins the tie). maj7 and m7
  // additionally require their own defining 3rd so they only appear when the
  // colour that names them is actually present.
  { name: '7',    ivs: [0, 4, 7, 10], required: [0, 10],     min: 3 },
  { name: 'maj7', ivs: [0, 4, 7, 11], required: [0, 4, 11],  min: 3 },
  { name: 'm7',   ivs: [0, 3, 7, 10], required: [0, 3, 10],  min: 3 },
  { name: 'm7b5', ivs: [0, 3, 6, 10], required: [0, 3, 6, 10], min: 3 },
  { name: 'dim7', ivs: [0, 3, 6, 9],  required: [0, 3, 6, 9],  min: 4 },
  { name: '6',    ivs: [0, 4, 7, 9],  required: [0, 4, 9],   min: 3 },
  { name: 'm6',   ivs: [0, 3, 7, 9],  required: [0, 3, 9],   min: 3 },
];

// Name the chord implied by the held pitch classes, or null. Returns null when
// the notes already form an EXACT chord (that is the main readout's job) and
// when the implication is ambiguous. lowestPc breaks ties toward the bass note.
function impliedChord(midiNotes) {
  const { set, order } = pitchClasses(midiNotes);
  if (set.size < 2) return null;
  if (chordName(set)) return null;            // exact -> not "implied"

  const lowestPc = order[0];
  const candidates = [];
  for (let root = 0; root < 12; root++) {
    for (let qi = 0; qi < IMPLIED.length; qi++) {
      const q = IMPLIED[qi];
      // every required (identity) tone must be present
      if (!q.required.every((iv) => set.has((root + iv) % 12))) continue;
      // count how many of the quality's tones are held (coverage)
      const present = q.ivs.filter((iv) => set.has((root + iv) % 12)).length;
      if (present < q.min) continue;
      // no held note may fall outside the chord's tones (else it's a different
      // harmony, not this chord implied)
      let allInside = true;
      for (const pc of set) {
        if (!q.ivs.some((iv) => (root + iv) % 12 === pc)) { allInside = false; break; }
      }
      if (!allInside) continue;
      candidates.push({ root, qi, name: PC_NAMES[root] + q.name, present, size: q.ivs.length });
    }
  }
  if (candidates.length === 0) return null;

  // tie-break: prefer simpler quality (earlier in IMPLIED = smaller/commoner),
  // then the candidate rooted on the lowest held note, then more tones present.
  candidates.sort((a, b) =>
    a.size - b.size || a.qi - b.qi ||
    (a.root === lowestPc ? -1 : 0) - (b.root === lowestPc ? -1 : 0) ||
    b.present - a.present
  );
  // ambiguous if the top two are genuinely different chords at equal preference
  if (candidates.length > 1) {
    const a = candidates[0], b = candidates[1];
    const equalPref = a.size === b.size && a.qi === b.qi &&
      (a.root === lowestPc) === (b.root === lowestPc) && a.present === b.present;
    if (equalPref && a.name !== b.name) return null;
  }
  return candidates[0].name;
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
// hysteresis or fade - it mirrors the held set exactly. When the held notes are
// note names (not an exact chord) but imply a chord, the implied name is shown
// smaller/dimmer on impliedEl (if provided).
class ChordReadout {
  constructor(nameEl, impliedEl) {
    this.nameEl = nameEl;
    this.impliedEl = impliedEl || null;
    this.last = null;
    this.lastImplied = null;
  }

  // midiNotes: array (or iterable) of currently-held MIDI note numbers.
  update(midiNotes) {
    const notes = Array.from(midiNotes);
    const text = nameFromMidiNotes(notes);
    if (text !== this.last) {
      this.last = text;
      this.nameEl.textContent = text;
      this.nameEl.style.opacity = text ? '1' : '0';
    }
    if (this.impliedEl) {
      // only suggest when the main readout is note names (not already a chord)
      const implied = text.includes(' ') ? (impliedChord(notes) || '') : '';
      if (implied !== this.lastImplied) {
        this.lastImplied = implied;
        this.impliedEl.textContent = implied;
        this.impliedEl.style.opacity = implied ? '1' : '0';
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChordReadout, nameFromMidiNotes, impliedChord, chordName, PC_NAMES, QUALITIES };
}
if (typeof window !== 'undefined') {
  window.ChordReadout = ChordReadout;
  window.nameFromMidiNotes = nameFromMidiNotes;
}
