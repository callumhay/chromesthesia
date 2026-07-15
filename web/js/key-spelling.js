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

// Tonic letter for each minor key, by tonic pc (0 = C). Needed because a minor
// key's letter is not always its relative major's: Eb minor and D# minor are the
// same pitches spelled differently, and the common choice decides the letter.
const MINOR_LETTERS = {
  0: 'C', 1: 'C', 2: 'D', 3: 'E', 4: 'E', 5: 'F',
  6: 'F', 7: 'G', 8: 'G', 9: 'A', 10: 'B', 11: 'B',
};

// Spelling table for an estimated key. A minor key borrows its relative major's
// table - that is the NATURAL minor scale, which has no leading tone. The raised
// 7th must therefore be patched in: it is the letter below the tonic's, raised
// to hit tonic-1 (D minor -> C#, never Db; a flat 7th is a subtonic that resolves
// down, not a leading tone). Without this the relative major's flat signature
// spells the leading tone as a flat in D/G/C#/F#/G# minor.
function tableForKey(key) {
  if (!key) return DEFAULT_SPELLING;
  const tonic = ((key.tonic % 12) + 12) % 12;
  if (key.mode !== 'minor') return buildMajorTable(tonic);

  const table = buildMajorTable((tonic + 3) % 12).slice();
  const letter = LETTERS[(LETTERS.indexOf(MINOR_LETTERS[tonic]) + 6) % 7];
  const leadingTonePc = (tonic + 11) % 12;
  const name = accidental(letter, deltaToPc(letter, leadingTonePc));
  // A double accidental (G# minor's F##) is a theoretical extreme; leave the
  // borrowed spelling rather than show it, matching buildMajorTable's fallback.
  if (!/##|bb/.test(name)) table[leadingTonePc] = name;
  return table;
}

// spell(pc, key) -> note name. pc is 0 = C; key = { tonic, mode } or null.
function spell(pc, key) {
  return tableForKey(key)[((pc % 12) + 12) % 12];
}

// Render a note/chord readout string as HTML, wrapping each accidental (the `#`
// or `b` right after a note letter A-G) in <span class="acc"> so it can be
// styled as a raised, slightly-smaller mark (VT323 lacks the ♯/♭ glyphs, so we
// keep the ASCII characters and style them instead). Input is a known-safe note
// string (letters, #, b, digits, spaces, '/'); it is HTML-escaped defensively so
// the helper stays safe if ever fed arbitrary text.
function accidentalHTML(text) {
  const escaped = String(text).replace(/[&<>]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  // a #/b counts as an accidental only when it directly follows a note letter
  return escaped.replace(/([A-G])([#b]+)/g,
    (_, letter, marks) => `${letter}<span class="acc">${marks}</span>`);
}

// Krumhansl-Schmuckler key profiles (major, minor), rotated so index 0 = tonic.
const KS_MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const KS_MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

// Pearson correlation of two length-12 vectors.
function corr(a, b) {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    const xa = a[i] - ma, xb = b[i] - mb;
    num += xa * xb; da += xa * xa; db += xb * xb;
  }
  const den = Math.sqrt(da * db);
  return den < 1e-12 ? 0 : num / den;
}

// Time-decayed pitch-class histogram (0 = C) + KS key estimate. Feeds:
//   addNoteOn(midi, velocity)      MIDI: bass-primary, velocity-secondary weight
//   addMicEnergyPc(pcA, energy)    mic:  energy-primary; pcA is 0=A, converted
//   decayTo(now, mode)             exponential decay to `now` using mode's half-life
//   estimateKey()                  -> { tonic, mode } or null (undecided)
function createKeyEstimator() {
  const hist = new Float32Array(12);           // 0 = C
  let lastT = 0;
  let seeded = false;                          // false => decayTo hasn't set the clock yet
  const settings = { halfLifeMidiSec: 2, halfLifeMicSec: 4, confidenceMargin: 0.03 };
  const MIN_TOTAL = 0.5;                        // below this => undecided

  // bass-primary weight: lower MIDI notes count more (linear falloff over the
  // 88-key range), times velocity. One deposit per note-on.
  function addNoteOn(midi, velocity) {
    const pc = ((midi % 12) + 12) % 12;
    const bass = Math.max(0.2, 1 - (midi - 21) / 87);   // ~1.0 at A0 .. ~0.2 top
    hist[pc] += bass * Math.max(velocity, 0.05);
  }
  // mic: energy dominates; pcA is 0=A, convert to 0=C. (Bass boost is applied by
  // the caller via per-bin octave position; here we take already-weighted energy.)
  function addMicEnergyPc(pcA, energy) {
    const pc = ((pcA + 9) % 12 + 12) % 12;      // 0=A -> 0=C (A is pc 9)
    hist[pc] += energy;
  }
  function decayTo(now, mode) {
    console.assert(mode === 'mic' || mode === 'midi', 'decayTo: unknown mode', mode);
    if (!seeded) { seeded = true; lastT = now; return; }   // seed clock on first call; no decay yet
    const hl = mode === 'mic' ? settings.halfLifeMicSec : settings.halfLifeMidiSec;
    const dt = Math.max(now - lastT, 0);
    lastT = now;
    if (dt > 0 && hl > 0) {
      const f = Math.pow(0.5, dt / hl);
      for (let i = 0; i < 12; i++) hist[i] *= f;
    }
  }
  function estimateKey() {
    let total = 0;
    for (let i = 0; i < 12; i++) total += hist[i];
    if (total < MIN_TOTAL) return null;
    let best = null, bestScore = -2, second = -2;
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const [mode, prof] of [['major', KS_MAJOR], ['minor', KS_MINOR]]) {
        const rot = new Array(12);
        for (let i = 0; i < 12; i++) rot[i] = prof[(i - tonic + 12) % 12];
        const s = corr(hist, rot);
        if (s > bestScore) { second = bestScore; bestScore = s; best = { tonic, mode }; }
        else if (s > second) { second = s; }
      }
    }
    if (bestScore - second < settings.confidenceMargin) return null;   // ambiguous
    return best;
  }
  function reset() { hist.fill(0); lastT = 0; seeded = false; }
  function _weightForTest(pc) { return hist[pc]; }
  return { addNoteOn, addMicEnergyPc, decayTo, estimateKey, reset, settings, _weightForTest };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { spell, DEFAULT_SPELLING, tableForKey, buildMajorTable, createKeyEstimator, accidentalHTML };
}
if (typeof window !== 'undefined') {
  window.KeySpelling = { spell, DEFAULT_SPELLING, createKeyEstimator, accidentalHTML };
}
