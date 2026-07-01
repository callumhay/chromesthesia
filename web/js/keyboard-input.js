// keyboard-input.js
//
// Computer-keyboard fallback so the view is testable without a MIDI device.
// Maps two rows of keys to a piano-style layout (white keys on the middle row,
// black keys on the top row), following the common tracker/DAW convention.
// Emits the same {midi, velocity} note on/off callbacks as midi-input.js.

'use strict';

// Base octave starts at C4 (MIDI 60). Keys map chromatically from there.
// White row (a s d f g h j k l ;) and black row (w e   t y u   o p).
const KEY_TO_SEMITONE = {
  // white keys: C D E F G A B C D E
  'a': 0, 's': 2, 'd': 4, 'f': 5, 'g': 7, 'h': 9, 'j': 11, 'k': 12, 'l': 14, ';': 16,
  // black keys: C# D#   F# G# A#   C# D#
  'w': 1, 'e': 3, 't': 6, 'y': 8, 'u': 10, 'o': 13, 'p': 15,
};

class KeyboardInput {
  constructor({ onNoteOn, onNoteOff, baseMidi = 60, velocity = 0.8 } = {}) {
    this.onNoteOn = onNoteOn || (() => {});
    this.onNoteOff = onNoteOff || (() => {});
    this.baseMidi = baseMidi;
    this.velocity = velocity;
    this.held = new Set();          // keys currently down (dedupe key-repeat)
    this._down = (e) => this._onKeyDown(e);
    this._up = (e) => this._onKeyUp(e);
    this._panic = () => this.releaseAll();
  }

  enable() {
    window.addEventListener('keydown', this._down);
    window.addEventListener('keyup', this._up);
    // if the window/tab loses focus mid-press, keyup never arrives and the
    // note would hang on forever - release everything on blur / visibility loss
    window.addEventListener('blur', this._panic);
    document.addEventListener('visibilitychange', this._panic);
  }

  disable() {
    window.removeEventListener('keydown', this._down);
    window.removeEventListener('keyup', this._up);
    window.removeEventListener('blur', this._panic);
    document.removeEventListener('visibilitychange', this._panic);
    this.releaseAll();
  }

  // release every currently-held note (focus loss, disable, panic)
  releaseAll() {
    for (const midi of this.held) this.onNoteOff(midi);
    this.held.clear();
  }

  _midiForKey(key) {
    const semi = KEY_TO_SEMITONE[key];
    return semi === undefined ? null : this.baseMidi + semi;
  }

  _onKeyDown(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    // octave shift with z / x
    if (key === 'z') { this.baseMidi = Math.max(0, this.baseMidi - 12); return; }
    if (key === 'x') { this.baseMidi = Math.min(108, this.baseMidi + 12); return; }
    const midi = this._midiForKey(key);
    if (midi === null || this.held.has(midi)) return;
    this.held.add(midi);
    this.onNoteOn(midi, this.velocity);
  }

  _onKeyUp(e) {
    const key = e.key.toLowerCase();
    const midi = this._midiForKey(key);
    if (midi === null || !this.held.has(midi)) return;
    this.held.delete(midi);
    this.onNoteOff(midi);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = KeyboardInput;
if (typeof window !== 'undefined') window.KeyboardInput = KeyboardInput;
