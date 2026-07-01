// midi-input.js
//
// Web MIDI API input. Connects directly to MIDI devices in the browser and
// forwards note on/off events (with velocity) to callbacks. No Python bridge:
// this view is fully self-contained. Chrome/Edge support Web MIDI; other
// browsers fall back to keyboard-input.js.

'use strict';

class MidiInput {
  constructor({ onNoteOn, onNoteOff, onStatus } = {}) {
    this.onNoteOn = onNoteOn || (() => {});
    this.onNoteOff = onNoteOff || (() => {});
    this.onStatus = onStatus || (() => {});
    this.access = null;
    this.inputs = [];
  }

  supported() {
    return typeof navigator !== 'undefined' && !!navigator.requestMIDIAccess;
  }

  async connect() {
    if (!this.supported()) {
      this.onStatus({ connected: false, reason: 'no-web-midi' });
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      this.onStatus({ connected: false, reason: 'denied', error: e });
      return false;
    }
    this.access.onstatechange = () => this._bindInputs();
    this._bindInputs();
    return true;
  }

  _bindInputs() {
    if (!this.access) return;
    this.inputs = [];
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (msg) => this._onMessage(msg);
      this.inputs.push(input);
    }
    const names = this.inputs.map((i) => i.name);
    this.onStatus({ connected: this.inputs.length > 0, devices: names });
  }

  _onMessage(msg) {
    const [status, data1, data2] = msg.data;
    const cmd = status & 0xf0;
    // note on with velocity 0 is a note off (running-status convention)
    if (cmd === 0x90 && data2 > 0) {
      this.onNoteOn(data1, data2 / 127);
    } else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
      this.onNoteOff(data1);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = MidiInput;
if (typeof window !== 'undefined') window.MidiInput = MidiInput;
