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
  // Each pitch class is a positioned container (wheelSlots[pc]). Naturals hold a
  // single fixed name. The 5 accidentals hold TWO stacked spans (sharp + flat)
  // that crossfade by opacity, so the label morphs to the key-correct spelling
  // (A# <-> Bb) instead of swapping abruptly. The container carries the position
  // and the `.lit` class; CSS lights whichever span is active.
  const NAT = ['A', null, 'B', 'C', null, 'D', null, 'E', 'F', null, 'G', null];
  // accidental pitch classes -> [sharp, flat] names (0 = A convention)
  const ACC = { 1: ['A#', 'Bb'], 4: ['C#', 'Db'], 6: ['D#', 'Eb'],
                9: ['F#', 'Gb'], 11: ['G#', 'Ab'] };
  const wheelEl = document.getElementById('wheel');
  const wheelSlots = [];   // indexed by pitch class (0 = A)
  // per-accidental respell state: shown = the committed spelling ('#' | 'b'),
  // pending = a target that hasn't dwelt long enough yet, pendingSince = when it
  // first appeared (seconds). sharpEl/flatEl are the two stacked spans.
  const accState = {};
  for (let pc = 0; pc < 12; pc++) {
    const slot = document.createElement('div');
    slot.className = 'wheel-slot';
    if (NAT[pc] !== null) {
      const s = document.createElement('span');
      s.textContent = NAT[pc];
      slot.appendChild(s);
    } else {
      const [sharp, flat] = ACC[pc];
      const sharpEl = document.createElement('span');
      sharpEl.textContent = sharp;
      const flatEl = document.createElement('span');
      flatEl.textContent = flat; flatEl.classList.add('alt-hidden');
      slot.append(sharpEl, flatEl);
      accState[pc] = { shown: '#', pending: null, pendingSince: 0, sharpEl, flatEl };
    }
    wheelEl.appendChild(slot);
    wheelSlots.push(slot);
  }
  function layoutLabels() {
    const R = 0.410 * Math.min(innerWidth, innerHeight);   // ~10% inward from 0.455
    const cx = innerWidth / 2, cy = innerHeight / 2;
    wheelSlots.forEach((s, i) => {
      const th = (i / 12) * Math.PI * 2;   // i=0 (A) -> top; clockwise
      s.style.left = (cx + R * Math.sin(th)) + 'px';
      s.style.top = (cy - R * Math.cos(th)) + 'px';
    });
  }
  layoutLabels();
  window.addEventListener('resize', layoutLabels);

  // Respell the accidental labels toward the estimated key with a per-label
  // dwell (0.5 s) + CSS opacity crossfade. estimateKey() is already confidence-
  // gated (returns null unless the key clearly wins), so this adds only a debounce
  // on the visible flip, not a second confidence check. When the key is null
  // (ambiguous) each label HOLDS its current spelling rather than reverting.
  const RESPELL_DWELL_SEC = 0.5;
  function updateWheelSpelling(key, nowSec) {
    if (!key) return;                          // ambiguous -> hold current spelling
    for (const pc in ACC) {
      const st = accState[pc];
      // 0=A pc -> 0=C for the speller: pcC = (pcA + 9) % 12
      const name = window.KeySpelling.spell((+pc + 9) % 12, key);
      const want = name.indexOf('b') > 0 ? 'b' : '#';   // which spelling the key wants
      if (want === st.shown) { st.pending = null; continue; }
      if (want !== st.pending) { st.pending = want; st.pendingSince = nowSec; continue; }
      if (nowSec - st.pendingSince >= RESPELL_DWELL_SEC) {
        st.shown = want; st.pending = null;
        const flat = want === 'b';
        st.flatEl.classList.toggle('alt-hidden', !flat);
        st.sharpEl.classList.toggle('alt-hidden', flat);
      }
    }
  }

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
    wheelSlots[pc].classList.toggle('lit', on);
  }
  function refreshLit() {
    const active = new Set();
    for (const midi of notes.keys()) active.add(NC.midiToPitchClassIndex(midi));
    wheelSlots.forEach((s, i) => s.classList.toggle('lit', active.has(i)));
  }
  // mic mode: light wheel labels for the pitch classes carrying real energy.
  // An absolute floor keeps ambient noise (very low energy) from lighting
  // everything; above it, light the classes near the current peak.
  function refreshLitFromEnergy(pcEnergy) {
    let maxE = 0;
    for (let i = 0; i < 12; i++) if (pcEnergy[i] > maxE) maxE = pcEnergy[i];
    if (maxE < 1e-3) { wheelSlots.forEach((s) => s.classList.remove('lit')); return; }
    wheelSlots.forEach((s, i) => s.classList.toggle('lit', pcEnergy[i] / maxE > 0.4));
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
    wheelSlots.forEach((s) => s.classList.remove('lit'));
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
      estimatedKey = keyEst.estimateKey();   // used by the wheel labels (mic chord
                                             // spelling reads its own via setKeySource)
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
    // fade the accidental wheel labels toward the key-correct spelling (both modes)
    updateWheelSpelling(estimatedKey, tSec);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
