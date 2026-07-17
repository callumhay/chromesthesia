// Unit tests for key-spelling.js. Runs on plain Node:
//   node web/js/key-spelling.test.js
//
// Pitch classes are index 0 = C throughout. spell(pc, key) returns a note name;
// key = { tonic, mode } (tonic 0..11, 0 = C) or null (undecided => flat default).
'use strict';
const assert = require('assert');
const { spell, DEFAULT_SPELLING, accidentalHTML } = require('./key-spelling.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok -', name); }

const C = 0, F = 5, Bb = 10, B = 11;

test('undecided (null key) uses the fixed default table', () => {
  const expect = ['C','F','Bb','Eb','Ab','Db','Gb','B','E','A','D','G'];
  // DEFAULT_SPELLING is indexed by pitch class 0 = C:
  const byPc = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  for (let pc = 0; pc < 12; pc++) assert.strictEqual(spell(pc, null), byPc[pc]);
  // pc 6 must be Gb, not F#, and pc 10 must be Bb, not A#
  assert.strictEqual(spell(6, null), 'Gb');
  assert.strictEqual(spell(10, null), 'Bb');
  // (expect kept for reference: it is byPc reordered around the circle)
  void expect;
});

test('pc 10 spells Bb in F major, A# in B major', () => {
  assert.strictEqual(spell(Bb, { tonic: F, mode: 'major' }), 'Bb');
  assert.strictEqual(spell(Bb, { tonic: B, mode: 'major' }), 'A#');
});

test('C major spells the natural white keys naturally', () => {
  const cmaj = { tonic: C, mode: 'major' };
  assert.strictEqual(spell(0, cmaj), 'C');
  assert.strictEqual(spell(2, cmaj), 'D');
  assert.strictEqual(spell(4, cmaj), 'E');
  assert.strictEqual(spell(11, cmaj), 'B');
});

test('each key spells its 7 diatonic degrees with letters A-G exactly once', () => {
  const MAJOR = [0,2,4,5,7,9,11];
  const letters = (s) => s[0];
  for (let tonic = 0; tonic < 12; tonic++) {
    const key = { tonic, mode: 'major' };
    const used = MAJOR.map((iv) => letters(spell((tonic + iv) % 12, key)));
    const uniq = new Set(used);
    assert.strictEqual(uniq.size, 7,
      `major tonic ${tonic}: diatonic letters not unique -> ${used.join(',')}`);
  }
});

test('minor keys spell via their relative major (tonic+3)', () => {
  // D minor is relative to F major, so pc 10 spells Bb
  assert.strictEqual(spell(10, { tonic: 2, mode: 'minor' }), 'Bb');
  // A minor is relative to C major, so pc 9 spells A (natural)
  assert.strictEqual(spell(9, { tonic: 9, mode: 'minor' }), 'A');
});

// A minor key borrows its relative major's table, which is the NATURAL minor
// scale - it has no leading tone. The raised 7th (tonic-1) must still be spelled
// as a raised 7th, never as a flat 2nd: D minor's is C#, and "Db" would be a note
// that resolves DOWN to the tonic instead of up to it. Before this was fixed,
// D/G/C#/F# minor all spelled it flat, because their relative majors carry flat
// signatures - and the dim7 readout showed "Dbdim7" for D minor's vii°7.
test('minor keys spell the raised 7th as a leading tone, not a flat 2nd', () => {
  // Derived from theory rather than a hardcoded table: the leading tone takes the
  // letter BELOW the tonic's letter, with whatever accidental reaches tonic-1.
  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const NATURAL_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const TONIC_LETTER = { 0:'C', 1:'C', 2:'D', 3:'E', 4:'E', 5:'F', 6:'F', 7:'G', 8:'G', 9:'A', 10:'B', 11:'B' };

  for (let tonic = 0; tonic < 12; tonic++) {
    const leadingTonePc = (tonic + 11) % 12;
    const letter = LETTERS[(LETTERS.indexOf(TONIC_LETTER[tonic]) + 6) % 7];
    let delta = ((leadingTonePc - NATURAL_PC[letter]) % 12 + 12) % 12;
    if (delta > 6) delta -= 12;
    const want = delta === 0 ? letter : letter + (delta > 0 ? '#'.repeat(delta) : 'b'.repeat(-delta));
    // G# minor's leading tone is F##; double accidentals are a theoretical
    // extreme this module declines to print, so it keeps the borrowed spelling.
    if (/##|bb/.test(want)) continue;

    const got = spell(leadingTonePc, { tonic, mode: 'minor' });
    assert.strictEqual(got, want,
      `minor tonic ${tonic}: leading tone (pc ${leadingTonePc}) spelled "${got}", want "${want}"`);
  }
});

test('the leading-tone fix does not disturb the rest of a minor key', () => {
  // D minor still borrows F major elsewhere: pc 10 is Bb, and the natural 7th
  // (pc 0, C) is untouched - only the RAISED 7th (pc 1) was ever wrong.
  const dMinor = { tonic: 2, mode: 'minor' };
  assert.strictEqual(spell(10, dMinor), 'Bb');
  assert.strictEqual(spell(0, dMinor), 'C');
  assert.strictEqual(spell(1, dMinor), 'C#');
});

test('chromatic (non-diatonic) notes follow the key direction', () => {
  // pc 6 is non-diatonic in C major -> sharp side -> F#
  assert.strictEqual(spell(6, { tonic: 0, mode: 'major' }), 'F#');
  // pc 6 is non-diatonic in F major -> flat side -> Gb
  assert.strictEqual(spell(6, { tonic: 5, mode: 'major' }), 'Gb');
});

test('Gb major spells its diatonic 7th degree as Cb', () => {
  // pc 11 is the 4th... no: in Gb major pc 11 = Cb (the correct diatonic spelling)
  assert.strictEqual(spell(11, { tonic: 6, mode: 'major' }), 'Cb');
});

const { createKeyEstimator } = require('./key-spelling.js');

test('histogram weight halves over one MIDI half-life', () => {
  const est = createKeyEstimator();
  est.settings.halfLifeMidiSec = 2;
  est.decayTo(0, 'midi');                 // seed lastT=0 (first call only sets the clock)
  est.addNoteOn(60, 1.0);                 // C4, full velocity, at t=0
  const w0 = est._weightForTest(0);       // pc 0 (C) weight right after
  est.decayTo(2.0, 'midi');               // advance one half-life
  const w1 = est._weightForTest(0);
  assert.ok(Math.abs(w1 / w0 - 0.5) < 0.02, `expected halving, got ${w1 / w0}`);
});

test('a C-major note stream estimates C major', () => {
  const est = createKeyEstimator();
  const CMAJ = [60, 62, 64, 65, 67, 69, 71, 72];   // C D E F G A B C
  let t = 0;
  for (let rep = 0; rep < 4; rep++) {
    for (const m of CMAJ) { est.addNoteOn(m, 0.9); est.decayTo(t += 0.1, 'midi'); }
  }
  const key = est.estimateKey();
  assert.deepStrictEqual(key, { tonic: 0, mode: 'major' });
});

// A single chord's 3-4 notes correlate best with SOME key, but that is not
// enough evidence to declare one - and if it did, the key would respell the very
// chord that produced it (a fresh Bmaj7 read as Eb minor spells B as Cb). The key
// stays undecided until enough distinct pitch classes have sounded.
test('one freshly-held chord does not establish a key', () => {
  const est = createKeyEstimator();
  // Bmaj7 = B D# F# A# - the reported case; alone it correlates with Eb minor.
  let t = 0;
  for (const m of [71, 75, 78, 82]) { est.addNoteOn(m, 0.9); est.decayTo(t += 0.03, 'midi'); }
  assert.strictEqual(est.estimateKey(), null, 'four notes of one chord must not decide a key');
});

test('a held chord stays undecided even as it sustains (no delayed flip)', () => {
  const est = createKeyEstimator();
  let t = 0;
  for (const m of [71, 75, 78, 82]) { est.addNoteOn(m, 0.9); est.decayTo(t += 0.03, 'midi'); }
  for (let i = 0; i < 20; i++) est.decayTo(t += 0.1, 'midi');   // hold ~2s
  assert.strictEqual(est.estimateKey(), null, 'holding one chord must never resolve a key');
});

test('enough distinct pitch classes DO decide (two triads a fourth apart)', () => {
  const est = createKeyEstimator();
  let t = 0;
  for (const m of [60, 64, 67, 65, 69, 72]) { est.addNoteOn(m, 0.9); est.decayTo(t += 0.05, 'midi'); }
  // C major + F major triads = C E G F A -> 5 distinct pcs, clears the gate
  assert.notStrictEqual(est.estimateKey(), null, 'five distinct pitch classes should decide a key');
});

test('a low bass note-on outweighs the same-velocity note an octave up', () => {
  const est = createKeyEstimator();
  est.addNoteOn(36, 0.8);   // low C
  const wLow = est._weightForTest(0);
  est.reset();
  est.addNoteOn(72, 0.8);   // high C, same velocity
  const wHigh = est._weightForTest(0);
  assert.ok(wLow > wHigh, `bass ${wLow} should outweigh treble ${wHigh}`);
});

test('a louder note-on outweighs a quiet one at the same pitch', () => {
  const est = createKeyEstimator();
  est.addNoteOn(60, 1.0); const loud = est._weightForTest(0);
  est.reset();
  est.addNoteOn(60, 0.2); const quiet = est._weightForTest(0);
  assert.ok(loud > quiet, `loud ${loud} should outweigh quiet ${quiet}`);
});

test('reset clears the histogram (mode-switch behaviour)', () => {
  const est = createKeyEstimator();
  est.addNoteOn(60, 1.0);
  est.reset();
  assert.strictEqual(est._weightForTest(0), 0);
  assert.strictEqual(est.estimateKey(), null);   // empty => undecided
});

test('mic energy on A (0=A pc 0) lands on pitch class 9 (A) internally', () => {
  const est = createKeyEstimator();
  est.addMicEnergyPc(0, 1.0);   // 0=A convention pc 0 == A == 0=C pc 9
  assert.ok(est._weightForTest(9) > 0);
  assert.strictEqual(est._weightForTest(0), 0);
});

test('an A-minor note stream estimates A minor', () => {
  const est = createKeyEstimator();
  const AMIN = [57, 59, 60, 62, 64, 65, 67, 69];   // A B C D E F G A
  let t = 0;
  for (let rep = 0; rep < 4; rep++) {
    for (const m of AMIN) { est.addNoteOn(m, 0.9); est.decayTo(t += 0.1, 'midi'); }
  }
  assert.deepStrictEqual(est.estimateKey(), { tonic: 9, mode: 'minor' });
});

// --- accidentalHTML: wrap #/b after a note letter for raised-mark styling -----

test('accidentalHTML wraps a sharp and a flat, leaves naturals alone', () => {
  assert.strictEqual(accidentalHTML('A#'), 'A<span class="acc">#</span>');
  assert.strictEqual(accidentalHTML('Bb'), 'B<span class="acc">b</span>');
  assert.strictEqual(accidentalHTML('C'), 'C');
});

test('accidentalHTML does NOT wrap chord-suffix letters or octave digits', () => {
  // the maj7's letters and the 7 stay inline; only the F# accidental is wrapped
  assert.strictEqual(accidentalHTML('F#maj7'), 'F<span class="acc">#</span>maj7');
  // octave digit after an accidental note stays inline
  assert.strictEqual(accidentalHTML('A#3'), 'A<span class="acc">#</span>3');
});

test('accidentalHTML handles aliases and spaced note lists', () => {
  assert.strictEqual(accidentalHTML('C6 / Am7'), 'C6 / Am7');
  assert.strictEqual(accidentalHTML('Bb D F'), 'B<span class="acc">b</span> D F');
});

test('accidentalHTML escapes HTML metacharacters (defensive)', () => {
  assert.strictEqual(accidentalHTML('<b>'), '&lt;b&gt;');
});

// --- readout wrapping: long alias lists break onto more lines ----------------

const { wrapReadoutLines, readoutHTML, MAX_READOUT_CHARS } = require('./key-spelling.js');

test('a short readout stays on one line', () => {
  assert.deepStrictEqual(wrapReadoutLines('C'), ['C']);
  assert.deepStrictEqual(wrapReadoutLines('C6 / Am7'), ['C6 / Am7']);
});

test('a four-root dim7 wraps, and every break lands AFTER a slash', () => {
  // 31 chars - the worst real case, and the reason this exists.
  const lines = wrapReadoutLines('Cdim7 / Ebdim7 / Gbdim7 / Adim7');
  assert.ok(lines.length > 1, `expected a wrap, got ${JSON.stringify(lines)}`);
  // every line but the last ends with the slash it broke at
  for (const line of lines.slice(0, -1)) {
    assert.ok(line.endsWith('/'), `line must end with its slash: "${line}"`);
  }
  assert.ok(!lines[lines.length - 1].endsWith('/'), 'last line must not dangle a slash');
  // no line starts with a slash - that is the break-BEFORE mistake
  for (const line of lines) assert.ok(!line.startsWith('/'), `line starts with a slash: "${line}"`);
});

test('wrapping preserves the names and their order exactly', () => {
  const text = 'C#dim7 / Edim7 / Gdim7 / Bbdim7';
  const rejoined = wrapReadoutLines(text).join(' ').replace(/\s+/g, ' ');
  assert.strictEqual(rejoined, text, 'wrapped lines must rejoin to the original readout');
});

test('every line stays within the character budget', () => {
  for (const text of [
    'Cdim7 / Ebdim7 / Gbdim7 / Adim7',
    'C#dim7 / Edim7 / Gdim7 / Bbdim7',
    'Caug / Eaug / Abaug',
    'Bø7 / Dm6',
  ]) {
    for (const line of wrapReadoutLines(text)) {
      assert.ok(line.length <= MAX_READOUT_CHARS,
        `"${line}" is ${line.length} chars, over the ${MAX_READOUT_CHARS} budget (from "${text}")`);
    }
  }
});

test('a single name longer than the budget is never split mid-name', () => {
  // No real chord name is this long, but splitting one would be worse than
  // overflowing: "Cdi / m7" is not a chord.
  const lines = wrapReadoutLines('Cmaj7#11b13sus4add9', 5);
  assert.deepStrictEqual(lines, ['Cmaj7#11b13sus4add9']);
});

test('readoutHTML joins the lines with <br> and still styles accidentals', () => {
  const html = readoutHTML('Cdim7 / Ebdim7 / Gbdim7 / Adim7');
  assert.ok(html.includes('<br>'), `expected a line break: ${html}`);
  assert.ok(html.includes('<span class="acc">b</span>'), `expected styled accidentals: ${html}`);
  // the slash before a break stays on the line it belongs to
  assert.ok(html.includes('/<br>'), `break must follow the slash: ${html}`);
  assert.ok(!html.includes('<br>/'), `break must not precede a slash: ${html}`);
});

test('readoutHTML leaves a short readout unbroken', () => {
  assert.strictEqual(readoutHTML('C6 / Am7'), 'C6 / Am7');
});

// --- synonymsHTML: the sub-display list wraps by width, only between names -----

const { synonymsHTML } = require('./key-spelling.js');

test('synonymsHTML is empty for no synonyms', () => {
  assert.strictEqual(synonymsHTML([]), '');
});

test('synonymsHTML glues each middot to its name in one nowrap unit', () => {
  const html = synonymsHTML(['Ebdim7', 'Gbdim7', 'Adim7']);
  // one .syn unit per name - CSS makes these nowrap, so a break can only fall
  // BETWEEN units (after a middot), never inside a name
  assert.strictEqual((html.match(/class="syn"/g) || []).length, 3);
  // the middot lives INSIDE a unit, not in the joining space, so it can never
  // start a wrapped line
  assert.ok(/·<\/span>/.test(html), `middot must be inside a unit: ${html}`);
  assert.ok(!/·\s*<span/.test(html.replace(/·<\/span>/g, '')),
    'no middot should sit between units');
  // last name carries no trailing middot
  assert.ok(/Adim7<\/span>$/.test(html), `last unit must be the bare name: ${html}`);
});

test('synonymsHTML still styles accidentals inside each unit', () => {
  const html = synonymsHTML(['Ebdim7', 'Gbdim7']);
  assert.ok(html.includes('E<span class="acc">b</span>dim7'), html);
  assert.ok(html.includes('G<span class="acc">b</span>dim7'), html);
});

test('synonymsHTML of a single synonym is one bare unit, no middot', () => {
  const html = synonymsHTML(['Ebdim7']);
  assert.strictEqual((html.match(/class="syn"/g) || []).length, 1);
  assert.ok(!html.includes('·'), `single synonym needs no separator: ${html}`);
});

console.log(`\n${passed} passed`);
