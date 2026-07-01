// chord.js
//
// Chord detection from a 12-bin chroma vector (index 0 = A), adapted from
// waveloop. Because we feed it exact MIDI notes rather than FFT peaks, the
// readout is more accurate than the audio version. Manages the centre chord
// readout DOM (#chordname) with the same hysteresis + confidence fade.

'use strict';

const NOTE_NAMES = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];

const QUALITIES = [
  { name: '',     ivs: [0, 4, 7] },
  { name: 'm',    ivs: [0, 3, 7] },
  { name: 'dim',  ivs: [0, 3, 6] },
  { name: 'aug',  ivs: [0, 4, 8] },
  { name: 'sus4', ivs: [0, 5, 7] },
  { name: 'sus2', ivs: [0, 2, 7] },
  { name: '7',    ivs: [0, 4, 7, 10] },
  { name: 'maj7', ivs: [0, 4, 7, 11] },
  { name: 'm7',   ivs: [0, 3, 7, 10] },
];

class ChordReadout {
  constructor(nameEl) {
    this.nameEl = nameEl;
    this.shown = null;
    this.candName = null;
    this.candAt = 0;
    this.shownConf = 1;
  }

  detect(chroma) {
    let total = 0;
    for (let i = 0; i < 12; i++) total += chroma[i];
    if (total < 1e-3) return null;

    const c = new Array(12);
    for (let i = 0; i < 12; i++) c[i] = chroma[i] / total;

    let best = null, bestScore = 0;
    for (let root = 0; root < 12; root++) {
      for (const q of QUALITIES) {
        let inS = 0;
        for (let k = 0; k < q.ivs.length; k++) {
          inS += c[(root + q.ivs[k]) % 12] * (k === 0 ? 1.15 : 1);
        }
        const score = inS / Math.pow(q.ivs.length, 0.55);
        if (score > bestScore) { bestScore = score; best = { root, q }; }
      }
    }
    if (!best) return null;
    let frac = 0;
    for (const iv of best.q.ivs) frac += c[(best.root + iv) % 12];
    if (frac < 0.5) return null;
    return { name: NOTE_NAMES[best.root] + best.q.name, conf: frac };
  }

  _opacity() {
    const o = 0.3 + 0.7 * Math.min(Math.max((this.shownConf - 0.5) / 0.35, 0), 1);
    this.nameEl.style.opacity = o.toFixed(3);
  }

  update(chroma, now) {
    const det = this.detect(chroma);
    const name = det ? det.name : null;
    if (name !== this.candName) { this.candName = name; this.candAt = now; }
    const shownName = this.shown ? this.shown.name : null;
    if (now - this.candAt > 0.25 && this.candName !== shownName) {
      this.shown = det;
      if (det) this.shownConf = det.conf;
      this.nameEl.textContent = this.shown ? this.shown.name : '';
      this._opacity();
    }
    if (this.shown) {
      const live = (det && det.name === this.shown.name) ? det.conf : this.shown.conf;
      this.shownConf += (live - this.shownConf) * 0.1;
      this._opacity();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ChordReadout, NOTE_NAMES, QUALITIES };
}
if (typeof window !== 'undefined') { window.ChordReadout = ChordReadout; }
