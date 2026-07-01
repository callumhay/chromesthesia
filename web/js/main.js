// main.js
//
// Wires the pieces together: loads the shared note colours, lays out the wheel
// labels, connects MIDI (with a keyboard fallback), builds the cel-shading
// debug panel, and runs the render loop that feeds active notes to the
// visualizer and updates the chord readout.

'use strict';

(async function () {
  const NC = window.NoteColours;

  // --- load the shared colour source of truth ------------------------------
  try {
    await NC.loadNoteColours('../note_colours.json');
  } catch (e) {
    console.error(e);
    document.getElementById('chordname').textContent = 'colour load failed';
    return;
  }

  // --- wheel labels: 12 pitch classes, A at 12 o'clock, clockwise ----------
  const WHEEL = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
  const wheelEl = document.getElementById('wheel');
  const wheelSpans = WHEEL.map((name) => {
    const s = document.createElement('span');
    s.textContent = name;
    wheelEl.appendChild(s);
    return s;
  });
  function layoutLabels() {
    const R = 0.455 * Math.min(innerWidth, innerHeight);
    const cx = innerWidth / 2, cy = innerHeight / 2;
    wheelSpans.forEach((s, i) => {
      const th = (i / 12) * Math.PI * 2;   // i=0 (A) -> top; clockwise
      s.style.left = (cx + R * Math.sin(th)) + 'px';
      s.style.top = (cy - R * Math.cos(th)) + 'px';
    });
  }
  layoutLabels();
  window.addEventListener('resize', layoutLabels);

  // --- active note state ---------------------------------------------------
  const notes = new Map();        // midi -> { velocity, onTime }
  let params = Object.assign({}, NC.DEFAULT_PARAMS);

  // --- visualizer ----------------------------------------------------------
  const canvas = document.getElementById('gl');
  const viz = window.createVisualizer(canvas, () => params);
  const chord = new window.ChordReadout(document.getElementById('chordname'));
  // debug hook for verification (harmless in normal use)
  window.__vizDebug = { peakEnergy: () => viz.peakEnergy(), state: () => viz.debugState(),
    sampleColour: () => viz.sampleColour() };

  function litPitchClass(pc, on) {
    // light the wheel label of any active pitch class
    wheelSpans[pc].classList.toggle('lit', on);
  }
  function refreshLit() {
    const active = new Set();
    for (const midi of notes.keys()) active.add(NC.midiToPitchClassIndex(midi));
    wheelSpans.forEach((s, i) => s.classList.toggle('lit', active.has(i)));
  }

  // live readout of active notes + the octave value driving the cel halo
  const notesReadout = document.getElementById('notesReadout');
  function refreshReadout() {
    if (notes.size === 0) { notesReadout.textContent = 'no notes'; return; }
    const parts = [];
    for (const midi of notes.keys()) {
      const m = NC.noteToColour(midi, notes.get(midi).velocity, params);
      parts.push(`${NC.PITCH_CLASSES[m.pcIndex]}${m.octave}`);
    }
    notesReadout.textContent = parts.join('   ');
  }

  function noteOn(midi, velocity) {
    notes.set(midi, { velocity, onTime: performance.now() / 1000 });
    viz.pulse();
    refreshLit();
    refreshReadout();
  }
  function noteOff(midi) {
    notes.delete(midi);
    refreshLit();
    refreshReadout();
  }

  // --- inputs: Web MIDI + keyboard fallback --------------------------------
  const midiChip = document.getElementById('midiChip');
  const midiText = document.getElementById('midiText');
  function setMidiStatus(text, connected) {
    midiText.textContent = text;
    midiChip.classList.toggle('connected', !!connected);
  }

  const midi = new window.MidiInput({
    onNoteOn: noteOn,
    onNoteOff: noteOff,
    onStatus: (st) => {
      if (st.connected) {
        setMidiStatus(st.devices && st.devices[0] ? st.devices[0] : 'midi', true);
      } else if (st.reason === 'no-web-midi') {
        setMidiStatus('no web-midi (use keys)', false);
      } else if (st.reason === 'denied') {
        setMidiStatus('midi denied', false);
      } else {
        setMidiStatus('waiting for midi', false);
      }
    },
  });
  midi.connect();

  const keys = new window.KeyboardInput({ onNoteOn: noteOn, onNoteOff: noteOff });
  keys.enable();

  // --- debug panel ---------------------------------------------------------
  const panel = new window.DebugPanel({
    container: document.getElementById('celPanel'),
    defaults: NC.DEFAULT_PARAMS,
    onChange: (p) => { params = p; },
  });
  panel.render();

  document.getElementById('minBtn').addEventListener('click', () => {
    document.getElementById('dsp').classList.toggle('min');
  });

  // --- render loop ---------------------------------------------------------
  function frame(now) {
    viz.render(now, notes);
    chord.update(viz.chroma, now / 1000);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
