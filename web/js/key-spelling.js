// key-spelling.js
//
// Key estimation (Krumhansl-Schmuckler) and key-aware note spelling. Pitch
// classes are index 0 = C throughout this module (pc = midi % 12). The mic feed
// uses 0 = A elsewhere and must convert with pcC = (pcA + 9) % 12 before calling
// in.
//
// spell(pc, key) -> note name. key = { tonic (0..11, 0=C), mode } or null.
// null (undecided) uses DEFAULT_SPELLING, a fixed neutral table that prefers
// flats for the five accidentals (pc 6 = Gb, pc 10 = Bb), matching the
// chromesthesia colour spelling in note-colours.js.

'use strict';

// Fixed default spelling, indexed by pitch class (0 = C). Not pure flats:
// B,E,A,D,G stay natural; the five accidentals are flats.
const DEFAULT_SPELLING =
  ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

// Plain directional tables, indexed by pc (0 = C): sharps for sharp keys, flats
// for flat keys. Used for chromatic (non-diatonic) notes and as a whole-key
// fallback for theoretical extremes.
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Each major key by its tonic pitch class (0 = C): tonic letter + key signature
// (number of sharps > 0 / flats < 0). pc 6 defaults to Gb (6 flats), matching
// the chromesthesia colour spelling; B major (5 sharps) still spells pc 10 as A#.
const MAJOR_KEYS = {
  0:  { L: 'C', sig: 0 },   7:  { L: 'G', sig: 1 },   2:  { L: 'D', sig: 2 },
  9:  { L: 'A', sig: 3 },   4:  { L: 'E', sig: 4 },   11: { L: 'B', sig: 5 },
  6:  { L: 'G', sig: -6 },  5:  { L: 'F', sig: -1 },  10: { L: 'B', sig: -2 },
  3:  { L: 'E', sig: -3 },  8:  { L: 'A', sig: -4 },  1:  { L: 'D', sig: -5 },
};

// Signed semitone offset (in [-6,6]) from a natural letter to a target pc.
function deltaToPc(letter, pc) {
  let d = ((pc - NATURAL_PC[letter]) % 12 + 12) % 12;
  if (d > 6) d -= 12;
  return d;
}
// Apply n sharps (n>0) / flats (n<0) to a letter name.
function accidental(letter, n) {
  return n === 0 ? letter : letter + (n > 0 ? '#'.repeat(n) : 'b'.repeat(-n));
}

// Build the 12-entry spelling table (indexed by pc, 0 = C) for the major key
// whose tonic is `tonicPc`. Diatonic degrees walk the seven letters from the
// tonic letter; chromatic notes take the plain directional spelling. If any
// diatonic degree needs a double accidental (theoretical extreme), fall back to
// the plain directional table for the whole key.
function buildMajorTable(tonicPc) {
  const { L, sig } = MAJOR_KEYS[tonicPc];
  const STEPS = [0, 2, 4, 5, 7, 9, 11];
  const li = LETTERS.indexOf(L);
  const table = new Array(12).fill(null);
  for (let d = 0; d < 7; d++) {
    const letter = LETTERS[(li + d) % 7];
    const degreePc = (tonicPc + STEPS[d]) % 12;
    table[degreePc] = accidental(letter, deltaToPc(letter, degreePc));
  }
  const chrom = sig >= 0 ? SHARP : FLAT;
  for (let pc = 0; pc < 12; pc++) if (!table[pc]) table[pc] = chrom[pc];
  for (let pc = 0; pc < 12; pc++) if (/##|bb/.test(table[pc])) return chrom.slice();
  return table;
}

// Spelling table for an estimated key (minor maps to its relative major).
function tableForKey(key) {
  if (!key) return DEFAULT_SPELLING;
  const majorTonic = key.mode === 'minor' ? (key.tonic + 3) % 12 : key.tonic;
  return buildMajorTable(((majorTonic % 12) + 12) % 12);
}

// spell(pc, key) -> note name. pc is 0 = C; key = { tonic, mode } or null.
function spell(pc, key) {
  return tableForKey(key)[((pc % 12) + 12) % 12];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spell, DEFAULT_SPELLING, tableForKey, buildMajorTable };
}
if (typeof window !== 'undefined') {
  window.KeySpelling = { spell, DEFAULT_SPELLING };
}
