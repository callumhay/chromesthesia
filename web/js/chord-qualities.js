// chord-qualities.js
//
// The single source of truth for the chord vocabulary, shared by chord.js (exact
// + implied MIDI matching) and mic-input.js (fuzzy detection). Each row carries:
//   name     - display suffix (e.g. '', 'm', 'ø7')
//   ivs      - interval set from the root in semitones (root-relative, so it is
//              pitch-class-convention independent)
//   required - the identity tones that MUST be present for an IMPLIED (partial)
//              match; ignored by consumers that only do exact/fuzzy matching
//   oneOf    - optional: intervals of which AT LEAST ONE must be present for an
//              implied match (currently only '7' uses it)
//
// Order is load-bearing: chord.js sorts implied candidates by their INDEX in this
// list (qi), so an earlier row wins a tie - that is what makes '7', which precedes
// maj7/m7, the default for a 3rd-less dominant. Reordering the rows would silently
// change implied-match tie-breaks. Adding a chord = one row here; both detectors
// pick it up.

'use strict';

const CHORD_QUALITIES = [
  // triads: identity is the 3rd (maj/min) - root + 3rd required
  { name: '',     ivs: [0, 4, 7],     required: [0, 4] },      // major
  { name: 'm',    ivs: [0, 3, 7],     required: [0, 3] },      // minor
  // dim: identity is the b5 + the min3 - root + both required (root+b5 alone is a
  // bare tritone, too ambiguous). aug is symmetric (every tone is a possible root),
  // so only name it when all three tones are present.
  { name: 'dim',  ivs: [0, 3, 6],     required: [0, 3, 6] },
  { name: 'aug',  ivs: [0, 4, 8],     required: [0, 4, 8] },
  // sus: no real 3rd, so identity rests on BOTH the sus tone and the 5th - require
  // all three (a bare root+4th/5th is an ambiguous power chord, not an implied sus)
  { name: 'sus2', ivs: [0, 2, 7],     required: [0, 2, 7] },
  { name: 'sus4', ivs: [0, 5, 7],     required: [0, 5, 7] },
  // 7th chords: the quality note is the 7th (that is what makes it a 7th chord), so
  // root + 7th are required. When the 3rd is also held it settles major vs minor;
  // when the 3rd is ABSENT the plain dominant '7' is the default (it sorts before
  // maj7/m7, so it wins the tie) - but root + b7 alone is too bare to name, so it
  // also wants the 3rd or the 5th (oneOf). maj7 and m7 additionally require their
  // own defining 3rd so they only appear when the colour that names them is present.
  { name: '7',    ivs: [0, 4, 7, 10], required: [0, 10], oneOf: [4, 7] },
  { name: 'maj7', ivs: [0, 4, 7, 11], required: [0, 4, 11] },
  { name: 'm7',   ivs: [0, 3, 7, 10], required: [0, 3, 10] },
  { name: 'ø7',   ivs: [0, 3, 6, 10], required: [0, 3, 6, 10] }, // half-diminished
  { name: 'dim7', ivs: [0, 3, 6, 9],  required: [0, 3, 6, 9] },
  { name: '6',    ivs: [0, 4, 7, 9],  required: [0, 4, 9] },
  { name: 'm6',   ivs: [0, 3, 7, 9],  required: [0, 3, 9] },
];

// Two modules now share this one array; freeze it (and the rows) so neither can
// mutate the vocabulary out from under the other.
CHORD_QUALITIES.forEach((q) => {
  Object.freeze(q.ivs);
  Object.freeze(q.required);
  if (q.oneOf) Object.freeze(q.oneOf);
  Object.freeze(q);
});
Object.freeze(CHORD_QUALITIES);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CHORD_QUALITIES };
}
if (typeof window !== 'undefined') {
  window.ChordQualities = { CHORD_QUALITIES };
}
