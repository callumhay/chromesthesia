// chord.js
//
// Chord/note readout for the centre of the wheel, driven by the EXACT set of
// held MIDI notes. Chord *matching* is exact and instant: a chord name shows
// only when the held pitch classes exactly form a recognized chord; otherwise
// the held note names show; nothing held -> blank. There is no smoothing or
// hysteresis on the matching.
//
// The one thing that is NOT frozen at press-time is *spelling*: which accidental
// name a pitch gets (Bb vs A#) depends on the current estimated key, passed in
// as `estimatedKey` (may be null -> a neutral flat-preferring default). As the
// key estimate fills in, a just-played note can respell a moment later. This is
// deliberate and musically correct.
//
// (An FFT/mic feed would want smoothing and fuzzy partial-match scoring, since
// it never knows the exact notes. That machinery is deliberately absent here.)

'use strict';

const KS = (typeof require !== 'undefined')
  ? require('./key-spelling.js')
  : (typeof window !== 'undefined' ? window.KeySpelling : null);

const CQ = (typeof require !== 'undefined')
  ? require('./chord-qualities.js')
  : (typeof window !== 'undefined' ? window.ChordQualities : null);
// Hard dependency: chord-qualities.js must load BEFORE this file (see index.html
// script order). Assert rather than dying later on a confusing null-property read.
if (!CQ || !CQ.CHORD_QUALITIES) throw new Error('chord.js: chord-qualities.js must load first');
const QUALITIES = CQ.CHORD_QUALITIES;   // exact-match reads name + ivs
const IMPLIED = CQ.CHORD_QUALITIES;     // implied-match reads name + ivs + required + min

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

// All exact names for the held pitch-class set (chord aliases), ordered so the
// interpretation rooted on the bass note comes first, then by root ascending.
// The same notes can name more than one chord (C6 == Am7, symmetric aug/dim7),
// so this returns every valid (root, quality) match. Empty if not a chord.
// bassPc: the pitch class of the lowest held note (may be null).
function chordNames(heldSet, bassPc, estimatedKey) {
  const matches = [];
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      if (exactMatch(heldSet, root, q.ivs)) {
        matches.push({ root, name: KS.spell(root, estimatedKey) + q.name });
      }
    }
  }
  matches.sort((a, b) => {
    const ab = a.root === bassPc ? -1 : 0, bb = b.root === bassPc ? -1 : 0;
    return (ab - bb) || (a.root - b.root);
  });
  return matches.map((m) => m.name);
}

// Convenience: the single primary exact name, or null. Used where only a
// yes/no "is this an exact chord" answer is needed (e.g. implied-chord guard).
function chordName(heldSet) {
  const names = chordNames(heldSet);
  return names.length ? names[0] : null;
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

// Name the chord implied by the held pitch classes, or null. Returns null when
// the notes already form an EXACT chord (that is the main readout's job) and
// when the implication is ambiguous. lowestPc breaks ties toward the bass note.
function impliedChord(midiNotes, estimatedKey) {
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
      candidates.push({ root, qi, name: KS.spell(root, estimatedKey) + q.name, present, size: q.ivs.length });
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
function nameFromMidiNotes(midiNotes, estimatedKey) {
  const { set, order } = pitchClasses(midiNotes);
  if (set.size === 0) return '';
  // exact chord(s): show every valid name (aliases), bass-note interpretation
  // first, joined with " / " (C E G A -> "C6 / Am7")
  const names = chordNames(set, order[0], estimatedKey);
  if (names.length) return names.join(' / ');
  // not a recognized chord: show the held note names (deduped by pitch class,
  // ordered by pitch)
  return order.map((pc) => KS.spell(pc, estimatedKey)).join(' ');
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
  // estimatedKey: { tonic, mode } or null -> spells names per the estimated key.
  update(midiNotes, estimatedKey) {
    const notes = Array.from(midiNotes);
    const text = nameFromMidiNotes(notes, estimatedKey);
    if (text !== this.last) {
      this.last = text;
      this.nameEl.innerHTML = KS.accidentalHTML(text);
      this.nameEl.style.opacity = text ? '1' : '0';
    }
    if (this.impliedEl) {
      // only suggest when the main readout is note names (not already a chord)
      const implied = text.includes(' ') ? (impliedChord(notes, estimatedKey) || '') : '';
      if (implied !== this.lastImplied) {
        this.lastImplied = implied;
        this.impliedEl.innerHTML = KS.accidentalHTML(implied);
        this.impliedEl.style.opacity = implied ? '1' : '0';
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChordReadout, nameFromMidiNotes, impliedChord, chordName, QUALITIES };
}
if (typeof window !== 'undefined') {
  window.ChordReadout = ChordReadout;
  window.nameFromMidiNotes = nameFromMidiNotes;
}
