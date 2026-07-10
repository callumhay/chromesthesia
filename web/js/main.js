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
  let mode = 'midi';              // 'midi' | 'mic'

  // --- visualizer ----------------------------------------------------------
  const canvas = document.getElementById('gl');
  const viz = window.createVisualizer(canvas, () => params);
  const chordEl = document.getElementById('chordname');
  const impliedEl = document.getElementById('impliedchord');
  const chord = new window.ChordReadout(chordEl, impliedEl);
  const mic = window.createMicInput();
  const micOut = { pcEnergy: new Float32Array(12), chroma: new Float32Array(12), level: 0 };

  // --- key estimator (drives note/chord spelling in both modes) ------------
  const keyEst = window.KeySpelling.createKeyEstimator();
  mic.setKeySource(() => keyEst.estimateKey());
  let estimatedKey = null;   // refreshed each frame from keyEst
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
  // mic mode: light wheel labels for the pitch classes carrying real energy.
  // An absolute floor keeps ambient noise (very low energy) from lighting
  // everything; above it, light the classes near the current peak.
  function refreshLitFromEnergy(pcEnergy) {
    let maxE = 0;
    for (let i = 0; i < 12; i++) if (pcEnergy[i] > maxE) maxE = pcEnergy[i];
    if (maxE < 1e-3) { wheelSpans.forEach((s) => s.classList.remove('lit')); return; }
    wheelSpans.forEach((s, i) => s.classList.toggle('lit', pcEnergy[i] / maxE > 0.4));
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
    notesReadout.innerHTML = window.KeySpelling.accidentalHTML(parts.join('   '));
  }

  function noteOn(midi, velocity) {
    // ignore notes played softer than the velocity cutoff (debug panel > Midi)
    if (velocity < (params.velocityCutoff || 0)) return;
    notes.set(midi, { velocity, onTime: performance.now() / 1000 });
    keyEst.addNoteOn(midi, velocity);
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
  const statusChip = document.getElementById('statusChip');
  const statusText = document.getElementById('statusText');
  function setStatus(text, connected) {
    statusText.textContent = text;
    statusChip.classList.toggle('connected', !!connected);
  }
  let midiStatus = { text: 'waiting for midi', connected: false };

  const midi = new window.MidiInput({
    onNoteOn: noteOn,
    onNoteOff: noteOff,
    onStatus: (st) => {
      if (st.connected) {
        midiStatus = { text: st.devices && st.devices[0] ? st.devices[0] : 'midi', connected: true };
      } else if (st.reason === 'no-web-midi') {
        midiStatus = { text: 'no web-midi (use keys)', connected: false };
      } else if (st.reason === 'denied') {
        midiStatus = { text: 'midi denied', connected: false };
      } else {
        midiStatus = { text: 'waiting for midi', connected: false };
      }
      if (mode === 'midi') setStatus(midiStatus.text, midiStatus.connected);
    },
  });
  midi.connect();

  const keys = new window.KeyboardInput({ onNoteOn: noteOn, onNoteOff: noteOff });
  keys.enable();

  // --- mode switch (MIDI / Mic) --------------------------------------------
  const midiBtn = document.getElementById('modeMidiBtn');
  const micBtn = document.getElementById('modeMicBtn');

  async function setMode(next) {
    if (next === mode) return;
    mode = next;
    midiBtn.classList.toggle('active', mode === 'midi');
    micBtn.classList.toggle('active', mode === 'mic');
    // clear any lingering visual/readout state from the previous mode
    chordEl.textContent = '';
    impliedEl.textContent = ''; impliedEl.style.opacity = '0';
    chord.last = null; chord.lastImplied = null;
    wheelSpans.forEach((s) => s.classList.remove('lit'));
    keyEst.reset(); estimatedKey = null;

    if (mode === 'mic') {
      keys.disable();
      setStatus('starting mic…', false);
      try {
        await mic.enable();
        setStatus('mic', true);
      } catch (e) {
        setStatus('mic denied', false);
        setMode('midi');   // fall back
      }
    } else {
      mic.disable();
      keys.enable();
      // release any held notes so they don't hang across the switch
      for (const m of [...notes.keys()]) noteOff(m);
      setStatus(midiStatus.text, midiStatus.connected);
    }
  }
  midiBtn.addEventListener('click', () => setMode('midi'));
  micBtn.addEventListener('click', () => setMode('mic'));
  setStatus(midiStatus.text, midiStatus.connected);

  // --- debug panel ---------------------------------------------------------
  const panel = new window.DebugPanel({
    container: document.getElementById('celPanel'),
    defaults: NC.DEFAULT_PARAMS,
    onChange: (p) => { params = p; },
  });
  panel.render();

  // mic + key dials: a second panel over a separate settings object, persisted
  // under its own storage key. holdMs/minConfidence live on mic.chordSettings;
  // the half-lives and margin live on keyEst.settings. onChange copies the
  // panel's params onto those live objects so changes apply immediately.
  const MIC_SECTIONS = [
    { title: 'Mic Chord', sliders: [
      ['holdMs', 'hold time (ms)', 0, 500, 5, (v) => `${Math.round(v)} ms`],
      ['minConfidence', 'min confidence', 0.4, 0.9, 0.01, (v) => `${Math.round(v * 100)}%`],
    ], toggles: [] },
    { title: 'Key', sliders: [
      ['halfLifeMidiSec', 'key half-life (midi)', 0.5, 6, 0.1, (v) => `${v.toFixed(1)} s`],
      ['halfLifeMicSec', 'key half-life (mic)', 1, 8, 0.1, (v) => `${v.toFixed(1)} s`],
      ['confidenceMargin', 'key confidence', 0.0, 0.15, 0.005, (v) => v.toFixed(3)],
    ], toggles: [] },
  ];
  const micPanel = new window.DebugPanel({
    container: document.getElementById('micPanel'),
    storageKey: 'chromesthesia.micParams',
    idPrefix: 'mic',
    defaults: {
      holdMs: mic.chordSettings.holdMs,
      minConfidence: mic.chordSettings.minConfidence,
      halfLifeMidiSec: keyEst.settings.halfLifeMidiSec,
      halfLifeMicSec: keyEst.settings.halfLifeMicSec,
      confidenceMargin: keyEst.settings.confidenceMargin,
    },
    sections: MIC_SECTIONS,
    onChange: (p) => {
      mic.chordSettings.holdMs = p.holdMs;
      mic.chordSettings.minConfidence = p.minConfidence;
      keyEst.settings.halfLifeMidiSec = p.halfLifeMidiSec;
      keyEst.settings.halfLifeMicSec = p.halfLifeMicSec;
      keyEst.settings.confidenceMargin = p.confidenceMargin;
    },
  });
  micPanel.render();

  document.getElementById('minBtn').addEventListener('click', () => {
    document.getElementById('dsp').classList.toggle('min');
  });
  document.getElementById('hintMinBtn').addEventListener('click', () => {
    document.getElementById('hint').classList.toggle('min');
  });

  // --- render loop ---------------------------------------------------------
  function frame(now) {
    const tSec = now / 1000;
    if (mode === 'mic') {
      mic.analyse(tSec, micOut);
      // feed pitch-class energy (micOut.pcEnergy is 0=A) into the estimator
      for (let pcA = 0; pcA < 12; pcA++) keyEst.addMicEnergyPc(pcA, micOut.pcEnergy[pcA]);
      keyEst.decayTo(tSec, 'mic');
      // mic chord spelling pulls the key via mic.setKeySource's callback, so
      // the estimate is read there — no need to refresh estimatedKey here.
      viz.renderMic(now, micOut.pcEnergy);
      refreshLitFromEnergy(micOut.pcEnergy);
      // stabilized (flicker-free) chord name; stabilizer ran inside analyse()
      const name = mic.estimateStableChordName();
      if (name !== chordEl.textContent) {
        chordEl.innerHTML = window.KeySpelling.accidentalHTML(name || '');
        chordEl.style.opacity = name ? '1' : '0';
      }
    } else {
      keyEst.decayTo(tSec, 'midi');
      estimatedKey = keyEst.estimateKey();
      viz.renderMidi(now, notes);
      // MIDI chord readout is driven by the EXACT held notes (no filtering)
      chord.update(notes.keys(), estimatedKey);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
