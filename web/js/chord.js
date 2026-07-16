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
// Local alias, NOT a bare `const CHORD_QUALITIES`: classic scripts share one
// global scope, so that collides with chord-qualities.js (see global-scope.test.js).
const QUALITIES = CQ.CHORD_QUALITIES;

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

// All exact names for the held pitch-class set (chord aliases), with the info a
// display needs to decide whether the lead name stands alone. Returns:
//   { names, symmetric, rootConfident }
//   names         - every valid (root, quality) name, preferred interpretation
//                   first (see below), then root ascending; [] if not a chord
//   symmetric     - true when the chord is one whose roots are interval-equal
//                   (dim7's 4, aug's 3), so the alternatives are true synonyms
//                   rather than an inversion the bass disambiguates
//   rootConfident - true when the lead root was chosen for a real reason (the
//                   bass note, or a dim7's key leading tone) rather than falling
//                   out of the ascending sort
// bassPc may be undefined -> no interpretation is preferred (names come back
// root-ascending, rootConfident false).
function chordNamesDetailed(heldSet, bassPc, estimatedKey) {
  const matches = [];
  for (let root = 0; root < 12; root++) {
    for (const q of QUALITIES) {
      if (exactMatch(heldSet, root, q.ivs)) {
        matches.push({ root, quality: q.name, name: KS.spell(root, estimatedKey) + q.name });
      }
    }
  }
  if (matches.length === 0) return { names: [], symmetric: false, rootConfident: false };

  // Which interpretation leads. Normally the bass-rooted one. A dim7 is the
  // exception: it is symmetric, so all four roots are equal by interval math -
  // but musically the diatonic function is the vii°7, rooted on the key's
  // leading tone (tonic - 1; in minor this is the harmonic-minor leading tone,
  // which is precisely where the vii°7 comes from - natural minor's flat 7th is
  // a subtonic and forms no dim7). Prefer that when the key supplies it;
  // otherwise fall back to the bass like every other chord. dim7-only: aug is
  // symmetric too but has no leading-tone function.
  let preferredRoot = bassPc;
  let rootConfident = bassPc !== undefined && bassPc !== null;
  if (estimatedKey && matches.some((m) => m.quality === 'dim7')) {
    const leadingTone = ((estimatedKey.tonic - 1) % 12 + 12) % 12;
    if (matches.some((m) => m.root === leadingTone && m.quality === 'dim7')) {
      preferredRoot = leadingTone;
      rootConfident = true;
    }
  }
  matches.sort((a, b) => {
    const ap = a.root === preferredRoot ? -1 : 0, bp = b.root === preferredRoot ? -1 : 0;
    return (ap - bp) || (a.root - b.root);
  });

  // Symmetric = every alias is the same quality (dim7/dim7/dim7/dim7 or
  // aug/aug/aug), i.e. rotations of one shape, so the others are synonyms of the
  // lead. C6/Am7 is NOT symmetric: they are different qualities, a genuine
  // either-reading the bass settles.
  const symmetric = matches.length > 1 && matches.every((m) => m.quality === matches[0].quality);
  return { names: matches.map((m) => m.name), symmetric, rootConfident };
}

// Just the alias names (preferred first), for callers that only need the list.
function chordNames(heldSet, bassPc, estimatedKey) {
  return chordNamesDetailed(heldSet, bassPc, estimatedKey).names;
}

// Do the held pitch classes exactly form a recognized chord? Spelling is
// irrelevant to the answer, so no bass/key is passed - only the count matters.
function isExactChord(heldSet) {
  return chordNames(heldSet).length > 0;
}

// --- implied chords (supplementary) ---------------------------------------
// When the held notes are NOT an exact chord but strongly imply one, name it.
// Each quality gates on two fields: `required` - the identity tones that must ALL
// sound (the root plus what defines the quality: the 3rd for maj/min, the altered
// 5th for dim/aug, the 7th for a dominant) - and the optional `oneOf`, at least
// one of which must sound. No held note may fall outside the quality's tones.
// If more than one quality is implied for the same root, or the same coverage is
// reached by different roots, it is ambiguous -> no suggestion.

// Name the chord implied by the held pitch classes, or null. Returns null when
// the notes already form an EXACT chord (that is the main readout's job) and
// when the implication is ambiguous. lowestPc breaks ties toward the bass note.
function impliedChord(midiNotes, estimatedKey) {
  const { set, order } = pitchClasses(midiNotes);
  if (set.size < 2) return null;
  if (isExactChord(set)) return null;         // exact -> not "implied"

  const lowestPc = order[0];
  const candidates = [];
  for (let root = 0; root < 12; root++) {
    for (let qi = 0; qi < QUALITIES.length; qi++) {
      const q = QUALITIES[qi];
      // every required (identity) tone must be present
      if (!q.required.every((iv) => set.has((root + iv) % 12))) continue;
      // count how many of the quality's tones are held (coverage)
      const present = q.ivs.filter((iv) => set.has((root + iv) % 12)).length;
      // at least one of these tones must sound (only the dominant '7' needs this:
      // root + b7 alone is too bare to name a dominant - it wants the 3rd or 5th)
      if (q.oneOf && !q.oneOf.some((iv) => set.has((root + iv) % 12))) continue;
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

  // tie-break: prefer simpler quality (earlier in the vocabulary = smaller/commoner),
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

// Name a pitch-class SET (0 = C) -> display string. bassPc: the bass pitch class
// (may be undefined); orderedPcs: pitch classes ordered bass-first for the
// note-name fallback (defaults to numeric order when omitted).
function nameFromPitchClasses(pcSet, bassPc, estimatedKey, orderedPcs) {
  if (pcSet.size === 0) return '';
  // exact chord(s): show every valid name (aliases), bass-note interpretation
  // first, joined with " / " (C E G A -> "C6 / Am7")
  const names = chordNames(pcSet, bassPc, estimatedKey);
  if (names.length) return names.join(' / ');
  // not a recognized chord: show the note names
  const order = orderedPcs || [...pcSet].sort((a, b) => a - b);
  return order.map((pc) => KS.spell(pc, estimatedKey)).join(' ');
}

// Name a pitch-class SET (0 = C) for the split display -> { main, synonyms }.
//   main     - the string for the top display
//   synonyms - names for the dimmed sub-display ([] when there are none)
// A symmetric chord (dim7's 4 roots, aug's 3) with a CONFIDENT root - a real
// bass, or a dim7's key leading tone - shows that one rooted name as `main` and
// moves its interval-equal synonyms to `synonyms`. Every other case keeps the
// single-line behaviour (aliases slash-joined in `main`, `synonyms` empty):
// non-symmetric aliases like C6/Am7 where the bass picks a genuine reading, and
// symmetric chords with no root to stand on.
function displayFromPitchClasses(pcSet, bassPc, estimatedKey, orderedPcs) {
  if (pcSet.size === 0) return { main: '', synonyms: [] };
  const { names, symmetric, rootConfident } = chordNamesDetailed(pcSet, bassPc, estimatedKey);
  if (names.length) {
    if (symmetric && rootConfident) return { main: names[0], synonyms: names.slice(1) };
    return { main: names.join(' / '), synonyms: [] };
  }
  const order = orderedPcs || [...pcSet].sort((a, b) => a - b);
  return { main: order.map((pc) => KS.spell(pc, estimatedKey)).join(' '), synonyms: [] };
}

// The MIDI readout: exact held MIDI notes -> display string.
function nameFromMidiNotes(midiNotes, estimatedKey) {
  const { set, order } = pitchClasses(midiNotes);
  return nameFromPitchClasses(set, order[0], estimatedKey, order);
}

// The MIDI split readout: exact held MIDI notes -> { main, synonyms }. The bass
// is the lowest held note - always present in MIDI, so a symmetric chord always
// gets its rooted lead in `main` and its synonyms in `synonyms`.
function displayFromMidiNotes(midiNotes, estimatedKey) {
  const { set, order } = pitchClasses(midiNotes);
  return displayFromPitchClasses(set, order[0], estimatedKey, order);
}

// Thin DOM binding: set the readout text from the current held notes. No
// hysteresis or fade - it mirrors the held set exactly. The dimmed sub-display
// (impliedEl, if provided) shows one of two things, never both at once: the
// synonyms of a symmetric chord whose root is known (e.g. Cdim7's other three
// roots), or - when the held notes are not an exact chord - the chord they imply.
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
    const { main, synonyms } = displayFromMidiNotes(notes, estimatedKey);
    if (main !== this.last) {
      this.last = main;
      this.nameEl.innerHTML = KS.readoutHTML(main);
      this.nameEl.style.opacity = main ? '1' : '0';
    }
    if (this.impliedEl) {
      // sub-display: the symmetric chord's synonyms if we split one out,
      // otherwise the implied chord when the main readout is bare note names.
      // Synonyms render as break-after-separator units so a long list wraps by
      // width; the implied chord is a single name.
      const implied = synonyms.length ? '' :
        (main.includes(' ') ? (impliedChord(notes, estimatedKey) || '') : '');
      const sub = synonyms.length ? synonyms.join(' · ') : implied;
      if (sub !== this.lastImplied) {
        this.lastImplied = sub;
        this.impliedEl.innerHTML = synonyms.length
          ? KS.synonymsHTML(synonyms)
          : KS.accidentalHTML(implied);
        this.impliedEl.style.opacity = sub ? '1' : '0';
      }
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChordReadout, nameFromMidiNotes, nameFromPitchClasses, impliedChord,
    displayFromPitchClasses, displayFromMidiNotes, chordNamesDetailed };
}
// One namespace object, like key-spelling.js and chord-qualities.js.
if (typeof window !== 'undefined') {
  window.Chord = { ChordReadout, nameFromMidiNotes, nameFromPitchClasses };
}
