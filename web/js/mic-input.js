// mic-input.js
//
// Microphone audio-analysis pipeline, ported faithfully from the waveloop
// WebGL visualizer (Research/waveloop.html). This is a self-contained PORT of
// proven DSP code, NOT a redesign: the dual-resolution FFT, adaptive makeup
// gain, six-layer DSP stack (drum cut, phon weight, gate, whiten, overtone
// cut, peak focus), pitch-class fold, and fuzzy chord estimator are copied
// straight across.
//
// The one intentional difference from waveloop: the fold no longer paints the
// Oklch per-register colour accumulators (angR/angG/angB) or the rim register
// histogram. Those are a waveloop rendering concern. Here the fold just sums
// energy per pitch class into a caller-supplied `out` object, and the caller
// applies its own colour per pitch class (see note-colours.js).
//
// Every constant and helper this module needs is copied IN so it depends on no
// waveloop globals. Ported waveloop identifiers keep their original spelling;
// new comments/names use Canadian spelling (colour).
//
// Usage:
//   const mic = createMicInput();
//   await mic.enable();
//   const out = { pcEnergy: new Float32Array(12),
//                 chroma:   new Float32Array(12),
//                 level: 0 };
//   // each animation frame:
//   mic.analyse(performance.now() / 1000, out);
//   const chord = mic.estimateStableChordName();   // committed name inside analyse(); '' = none
//   // ...
//   mic.disable();

'use strict';

// Shared chord vocabulary + naming engine, so the mic readout gets the same
// chords, aliases, and spelling as the MIDI readout instead of its own copy.
// Key-aware spelling now happens inside the engine, so this file no longer
// touches the speller directly.
const CHORD = (typeof require !== 'undefined')
  ? require('./chord.js')
  : (typeof window !== 'undefined' ? window.Chord : null);
// Local alias. Distinct from chord.js's own `QUALITIES` alias for this same
// array: classic scripts share one global scope, so both files using the bare
// name would collide (see global-scope.test.js).
const MIC_QUALITIES = (typeof require !== 'undefined')
  ? require('./chord-qualities.js').CHORD_QUALITIES
  : (typeof window !== 'undefined' && window.ChordQualities ? window.ChordQualities.CHORD_QUALITIES : null);
// Hard dependencies: chord-qualities.js and chord.js must load BEFORE this file.
if (!MIC_QUALITIES) throw new Error('mic-input.js: chord-qualities.js must load first');
if (!CHORD || !CHORD.nameFromPitchClasses) throw new Error('mic-input.js: chord.js must load first');

// Confidence gate + asymmetric hold hysteresis over the fuzzy per-frame chord
// estimate, so the mic readout does not flicker. getSettings() returns live
// { holdMs, minConfidence } so debug-panel changes take effect immediately.
// update(now, name, conf) -> the committed display string ('' = show nothing);
// now is in SECONDS.
function createChordStabilizer(getSettings) {
  let shown = '';            // currently displayed name ('' = nothing)
  let cand = null;           // candidate we're timing toward ('' = the "clear" candidate)
  let candSince = 0;         // when `cand` first appeared (seconds)

  function update(now, name, conf) {
    const { holdMs, minConfidence } = getSettings();
    // sub-confidence => no candidate this frame; '' is the "clear" candidate
    const frame = (name && conf >= minConfidence) ? name : '';
    if (frame !== cand) { cand = frame; candSince = now; }
    if (cand !== shown && (now - candSince) * 1000 >= holdMs) shown = cand;
    return shown;
  }
  function reset() { shown = ''; cand = null; candSince = 0; }
  return { update, reset };
}

function createMicInput() {
  // ------------------------------------------------------------- constants
  // (ported from waveloop; identifiers preserved verbatim)

  const ANG = 256;                          // angular analysis bins around the circle
  const F_LO = 20, F_HI = 20000;            // full audible band
  const OCT_SPAN = Math.log2(F_HI / F_LO);  // ~9.97 octaves
  const SPLIT_HZ = 1000;                     // long FFT below, short FFT above
  const EMAX = 2.0;                          // display-energy ceiling (waveloop's E_MAX/EMAX)

  // adaptive makeup gain ceilings/targets
  const MAKEUP_MAX_MIC = 10;    // +20 dB
  const MAKEUP_TARGET = 1.0;    // raw spectral total the tuning assumes

  // overtone-suppression peak table
  const PEAK_CAP = 80;

  // DSP presets; the Melodic preset is the default (Raw zeroes every knob,
  // making the whole DSP stage a no-op).
  const DSP_PRESETS = {
    raw:     { overtone: 0,    whiten: 0,    phon: 0,    focus: 0,    gate: 0,    drums: 0 },
    melodic: { overtone: 0.35, whiten: 0.35, phon: 0.35, focus: 0.3,  gate: 0.25, drums: 0.3 },
  };

  // exposed so a debug panel can tweak the six DSP knobs live
  const dsp = Object.assign({}, DSP_PRESETS.melodic);

  // mic chord readout stabilizer settings (mutated live by the debug panel)
  const chordSettings = { holdMs: 100, minConfidence: 0.55 };

  // supplies the current estimated key (0=C convention) for chord-name spelling;
  // set by the host (main.js). null => neutral default spelling.
  let getEstimatedKey = () => null;
  function setKeySource(fn) { getEstimatedKey = fn || (() => null); }
  const stabilizer = createChordStabilizer(() => chordSettings);
  let lastStableName = '';

  // ----------------------------------------------------------------- state
  // per-frame accumulators and smoothed chroma for the chord detector
  const chromaRaw = new Float32Array(12);   // 12-bin chroma, filled by the fold's peak pick
  const chroma = new Float32Array(12);      // smoothed chroma, index 0 = A
  let bassPcA = -1;         // lowest-frequency strong pitch class this frame (0 = A); -1 = none

  // overtone-suppression scratch
  const peakIdx = new Int32Array(PEAK_CAP);
  const peakBand = new Uint8Array(PEAK_CAP);

  // level AGC + beat state (ported from waveloop's shared state)
  const state = { level: 0, beat: 0 };
  let totalAgc = 1e-9, bassAgc = 1e-9, chromaAgc = 1e-6;
  let bassAvg = 0, lastBeatAt = 0;

  // adaptive makeup gain trackers
  let makeupEnv = 0;    // loudness envelope: fast attack, slow release
  let makeupNoise = 1;  // noise-floor estimate; starts high, falls fast
  let makeupGain = 1;

  // live audio graph (built by enable(), torn down by disable())
  let micCtx = null, micAna = null, micStream = null;

  // ---------------------------------------------------------------- helpers
  // (ported from waveloop; logic unchanged)

  // dB -> linear magnitude over a band's used range (plus one guard bin each
  // side for the peak tests); bins under the -85 dB floor become exact zeros.
  // Returns the band's total magnitude, which feeds the makeup-gain tracker.
  function toMag(db, mag, i0, i1) {
    let total = 0;
    for (let i = i0 - 1; i <= i1 + 1; i++) {
      const d = db[i];
      const m = d < -85 ? 0 : Math.pow(10, d / 20);
      mag[i] = m;
      if (i >= i0 && i <= i1) total += m;
    }
    return total;
  }

  // A-weighting-style amplitude gain, normalized near its 1 kHz reference. Not
  // a calibrated SPL meter; an optional perceptual tilt for the energy units.
  function aWeightGain(f) {
    const f2 = f * f;
    const ra = (12200 * 12200 * f2 * f2)
      / ((f2 + 20.6 * 20.6)
      * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9))
      * (f2 + 12200 * 12200));
    const db = 20 * Math.log10(Math.max(ra, 1e-12)) + 2.0;
    return Math.pow(10, db / 20);
  }

  // constant-Q-ish envelope: forward+backward one-pole whose window grows
  // proportionally with bin index (frac of centre frequency), floored at wMin.
  function smoothEnvCQ(mag, env, i0, i1, frac, wMin) {
    let acc = mag[i0];
    for (let i = i0; i <= i1; i++) {
      acc += (mag[i] - acc) / Math.max(frac * i, wMin);
      env[i] = acc;
    }
    acc = env[i1];
    for (let i = i1; i >= i0; i--) {
      acc += (env[i] - acc) / Math.max(frac * i, wMin);
      env[i] = acc;
    }
  }

  // overtone suppression: every local spectral peak is a candidate fundamental,
  // processed in ascending frequency; energy near its integer multiples is
  // attenuated by however much of that harmonic the fundamental can explain
  // (cap falls off as k^0.6). Lower fundamentals are handled first, so a
  // harmonic that gets cut down explains less of ITS multiples in turn.
  function suppressOvertones(bands, fmax) {
    const floor = fmax * 0.004;   // ~-48 dB below frame peak
    if (floor <= 0) return;
    let np = 0;
    for (let bi = 0; bi < 2 && np < PEAK_CAP; bi++) {
      const { mag, i0, i1 } = bands[bi];
      for (let i = i0; i <= i1 && np < PEAK_CAP; i++) {
        const m = mag[i];
        if (m > floor && m > mag[i - 1] && m >= mag[i + 1]) {
          peakIdx[np] = i; peakBand[np] = bi; np++;
        }
      }
    }
    const amt = dsp.overtone;
    for (let p = 0; p < np; p++) {
      const b = bands[peakBand[p]];
      const i = peakIdx[p];
      const mf = b.mag[i];          // current value: may itself have been cut
      if (mf <= 0) continue;
      const f = i * b.hz;
      for (let k = 2; k <= 12; k++) {
        const fk = f * k;
        if (fk > F_HI) break;
        const tb = fk < SPLIT_HZ ? bands[0] : bands[1];
        const ci = Math.round(fk / tb.hz);
        // tolerance window for stretch/inharmonicity, ~0.8% of the harmonic
        const tol = Math.min(Math.max(fk * 0.008 / tb.hz, 1.5), 8);
        const r = Math.ceil(tol);
        if (ci + r < tb.i0 || ci - r > tb.i1) continue;
        const cap = mf / Math.pow(k, 0.6);
        const inv = 1 / (2 * tol * tol);
        for (let d = -r; d <= r; d++) {
          const j = ci + d;
          if (j < tb.i0 || j > tb.i1) continue;
          const mh = tb.mag[j];
          if (mh <= 0) continue;
          const conf = Math.min(cap / mh, 1);
          tb.mag[j] = mh * (1 - amt * conf * Math.exp(-d * d * inv));
        }
      }
    }
  }

  function dspActive() {
    return dsp.overtone > 0 || dsp.whiten > 0 || dsp.phon > 0 || dsp.focus > 0
        || dsp.gate > 0 || dsp.drums > 0;
  }

  // Six independent layers between FFT and fold, all knob-controlled. Order:
  // drum cut (needs raw temporal stats) -> phon weight -> gate -> whiten ->
  // overtone cut -> peak focus. Runs on the linear magnitude arrays per band.
  function dspApply(ana, dt) {
    const bands = ana.bands;

    // drum cut: bins jumping far above their own ~300 ms average get pulled
    // back toward it - broadband attacks (kicks, snares) fade, held notes pass.
    // The EMA always tracks the RAW magnitudes so the stats stay honest.
    const emaK = 1 - Math.exp(-dt / 0.3);
    for (const b of bands) {
      const { mag, ema, i0, i1 } = b;
      for (let i = i0; i <= i1; i++) {
        const m = mag[i], e = ema[i];
        if (dsp.drums > 0 && m > e * 1.8) {
          mag[i] = m * Math.pow((e * 1.8 + 1e-12) / m, dsp.drums);
        }
        ema[i] = e + (m - e) * emaK;
      }
    }

    // phon weighting: morph from raw magnitude to A-weighted perceived
    // loudness. Clamp the gain so this stays musical, not a bassline punisher.
    if (dsp.phon > 0) {
      for (const b of bands) {
        const { mag, phon, i0, i1 } = b;
        for (let i = i0; i <= i1; i++) {
          mag[i] *= Math.pow(Math.min(Math.max(phon[i], 0.06), 1.25), dsp.phon);
        }
      }
    }

    // frame peak across both bands, shared by gate and overtone cut
    let fmax = 0;
    for (const b of bands) {
      for (let i = b.i0; i <= b.i1; i++) if (b.mag[i] > fmax) fmax = b.mag[i];
    }

    // soft noise gate: knob maps the knee from -72 dB to -32 dB below frame peak
    if (dsp.gate > 0 && fmax > 0) {
      const thr = fmax * Math.pow(10, (-72 + 40 * dsp.gate) / 20);
      const t2 = thr * thr;
      for (const b of bands) {
        const { mag } = b;
        for (let i = b.i0; i <= b.i1; i++) {
          const m2 = mag[i] * mag[i];
          mag[i] *= m2 / (m2 + t2);
        }
      }
    }

    // whitening: divide by a ~half-octave-wide envelope so the broadband tilt
    // flattens; boost capped at 6x so the noise floor can't take over
    if (dsp.whiten > 0) {
      let ref = 0, cnt = 0;
      for (const b of bands) {
        smoothEnvCQ(b.mag, b.env, b.i0, b.i1, 0.5, 8);
        for (let i = b.i0; i <= b.i1; i++) ref += b.env[i];
        cnt += b.i1 - b.i0 + 1;
      }
      ref = ref / cnt + 1e-12;
      for (const b of bands) {
        const { mag, env } = b;
        for (let i = b.i0; i <= b.i1; i++) {
          const g = Math.pow(ref / (env[i] + 0.05 * ref), dsp.whiten);
          mag[i] *= Math.min(g, 6);
        }
      }
    }

    if (dsp.overtone > 0) suppressOvertones(bands, fmax);

    // peak focus: spectral contrast against a ~semitone-wide local mean -
    // peaks rise, the smear between them sinks
    if (dsp.focus > 0) {
      for (const b of bands) {
        smoothEnvCQ(b.mag, b.env, b.i0, b.i1, 0.06, 4);
        const { mag, env } = b;
        for (let i = b.i0; i <= b.i1; i++) {
          if (env[i] <= 0) continue;
          const g = Math.pow(mag[i] / env[i], dsp.focus * 1.5);
          mag[i] *= Math.min(g, 4);
        }
      }
    }
  }

  // adaptive makeup gain: when the source runs quiet, magnitudes are boosted by
  // up to maxGain so soft material still reaches the working range. Guards keep
  // this from normalizing silence: hard cap (never "scale to full"), and the
  // boost is only granted to signal standing clear of a tracked noise-floor
  // estimate - inside the floor the gain fades back to unity.
  function updateMakeup(total, dt, maxGain) {
    makeupEnv += (total - makeupEnv)
      * (1 - Math.exp(-dt / (total > makeupEnv ? 0.06 : 2.0)));
    makeupNoise += (total - makeupNoise)
      * (1 - Math.exp(-dt / (total < makeupNoise ? 0.4 : 30)));
    let g = Math.min(Math.max(MAKEUP_TARGET / Math.max(makeupEnv, 1e-6), 1), maxGain);
    const snr = makeupEnv / (3 * Math.max(makeupNoise, 1e-6));
    if (snr < 1) g = 1 + (g - 1) * snr * snr * snr * snr;
    makeupGain += (g - makeupGain)
      * (1 - Math.exp(-dt / (g < makeupGain ? 0.15 : 0.6)));
    return makeupGain;
  }

  // level AGC + bass beat detection (ported from waveloop's trackEnergy).
  // Fills state.level (surfaced as out.level); state.beat is kept internal for
  // fidelity but is not exposed - beat visuals are a caller concern.
  function trackEnergy(total, bass, now) {
    totalAgc = Math.max(totalAgc * 0.995, total, 1e-9);
    state.level += (Math.min(total / totalAgc * 1.1, 1) - state.level) * 0.12;

    bassAgc = Math.max(bassAgc * 0.995, bass, 1e-9);
    bassAvg += (bass - bassAvg) * 0.04;
    if (bass > bassAvg * 1.35 && bass > 0.2 * bassAgc && now - lastBeatAt > 0.24) {
      state.beat = 1;
      lastBeatAt = now;
    }
  }

  // Fold a real FFT band onto the pitch-class circle. angle = fract(log2(f/440))
  // so 0 = A. Unlike waveloop, this does NOT deposit Oklch register colours or
  // a rim histogram; it just sums each bin's (post-DSP) magnitude into
  // out.pcEnergy[pc], and keeps waveloop's peak pick that fills chromaRaw for
  // the chord detector.
  //
  // pc = round(fract(log2(f/440)) * 12) % 12 gives index 0 = A (same convention
  // as waveloop's chromaRaw peak pick).
  //
  // NOTE: the bassPcA capture below assumes foldBand is called in ASCENDING band
  // order (low band first), so the lowest-frequency partial wins.
  function foldBand(b, out) {
    const { mag, hz, i0, i1 } = b;
    let total = 0;
    for (let i = i0; i <= i1; i++) {
      const m = mag[i];
      if (m <= 0) continue;
      const f = i * hz;
      total += m;

      const lg = Math.log2(f / 440);
      const frac = lg - Math.floor(lg);
      const o = Math.min(Math.max(Math.log2(f / F_LO) / OCT_SPAN, 0), 1);

      // deposit the bin's energy into its pitch class (index 0 = A). The wide
      // angular Gaussian footprint waveloop paints is a rendering detail; for
      // per-pitch-class energy we accumulate the bin's magnitude directly.
      const pc = ((Math.round(frac * 12) % 12) + 12) % 12;
      out.pcEnergy[pc] += m;

      // Bass = the lowest-frequency pitch class carrying a real partial. Bins are
      // walked low->high, so the first hit wins. This must be a LOCAL PEAK, not
      // merely above the floor: a bare threshold would let broadband rumble (HVAC,
      // a kick's noise floor) claim the bass. Same peak test + floor the chroma
      // peak-pick below uses; no f < 2200 bound here (that is an upper limit for
      // the chroma pick, meaningless when hunting the LOWEST partial).
      if (bassPcA < 0 && m > 3.2e-4 && m > mag[i - 1] && m >= mag[i + 1]) bassPcA = pc;

      // 3.2e-4 is the old -70 dB peak threshold in linear magnitude
      if (f < 2200 && m > mag[i - 1] && m >= mag[i + 1] && m > 3.2e-4) {
        const cpc = Math.round(frac * 12) % 12;
        chromaRaw[cpc] += Math.sqrt(m) * (1 - 0.35 * o);
      }
    }
    return total;
  }

  // dual-resolution analyser pair (ported from waveloop's makeAnalysers)
  function makeAnalysers(ctx, src) {
    const harm = ctx.createAnalyser();
    harm.fftSize = 16384;              // ~2.9 Hz bins: separates semitones down to ~G1
    harm.smoothingTimeConstant = 0.35; // window is long already; light extra smoothing
    const fast = ctx.createAnalyser();
    fast.fftSize = 4096;               // ~85 ms window: highs and beats stay snappy
    fast.smoothingTimeConstant = 0.4;
    src.connect(harm);
    src.connect(fast);
    const rate = ctx.sampleRate;
    // per-band fold ranges plus scratch for the DSP stage (linear magnitudes,
    // per-bin temporal EMA for the drum cut, envelope for whiten/focus)
    const mkBand = (a, data, lo, hi) => {
      const n = a.frequencyBinCount, hz = rate / 2 / n;
      return {
        data, hz,
        i0: Math.max(2, Math.ceil(lo / hz)),
        i1: Math.min(n - 2, Math.floor(hi / hz)),
        mag: new Float32Array(n),
        ema: new Float32Array(n),
        env: new Float32Array(n),
        phon: (() => {
          const w = new Float32Array(n);
          for (let i = 0; i < n; i++) w[i] = aWeightGain(Math.max(i * hz, 1));
          return w;
        })(),
      };
    };
    const harmData = new Float32Array(harm.frequencyBinCount);
    const fastData = new Float32Array(fast.frequencyBinCount);
    return {
      harm, fast, harmData, fastData, rate, lastT: 0,
      bands: [mkBand(harm, harmData, F_LO, SPLIT_HZ),
              mkBand(fast, fastData, SPLIT_HZ, F_HI)],
    };
  }

  // ----------------------------------------------------------- public API

  // getUserMedia + build the dual-resolution analysers (ports enableMic +
  // makeAnalysers). Echo cancellation / noise suppression / AGC are all off so
  // the DSP stack sees the raw spectrum.
  async function enable() {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
    micAna = makeAnalysers(micCtx, micCtx.createMediaStreamSource(micStream));
    stabilizer.reset(); lastStableName = '';
  }

  // stop the stream, close the context, and clear references (ports disableMic;
  // leaves no leaked tracks or contexts).
  function disable() {
    if (micStream) micStream.getTracks().forEach((t) => t.stop());
    if (micCtx) micCtx.close();
    micCtx = micAna = micStream = null;
    stabilizer.reset(); lastStableName = '';
  }

  // Read the FFT, run the DSP stack, fold into per-pitch-class energy, and fill
  // the caller-supplied `out` (ports waveloop's liveFrame). `out` must provide:
  //   out.pcEnergy : Float32Array(12)  energy per pitch class, index 0 = A
  //   out.chroma   : Float32Array(12)  smoothed chroma for chord detection
  //   out.level    : number 0..1       overall smoothed energy
  //
  // The chroma smoothing lerp (waveloop runs it in its render loop just after
  // liveFrame) is folded in here so the module owns the whole chroma pipeline.
  function analyse(now, out) {
    if (!micAna) return;
    const ana = micAna;
    const dt = Math.min(Math.max(now - ana.lastT, 0.001), 0.1);
    ana.lastT = now;
    ana.harm.getFloatFrequencyData(ana.harmData);
    ana.fast.getFloatFrequencyData(ana.fastData);

    out.pcEnergy.fill(0);
    chromaRaw.fill(0);
    bassPcA = -1;

    let raw = 0;
    for (const b of ana.bands) raw += toMag(b.data, b.mag, b.i0, b.i1);
    const g = updateMakeup(raw, dt, MAKEUP_MAX_MIC);
    if (g > 1.001) {
      for (const b of ana.bands) {
        for (let i = b.i0 - 1; i <= b.i1 + 1; i++) b.mag[i] *= g;
      }
    }
    if (dspActive()) dspApply(ana, dt);
    const total = foldBand(ana.bands[0], out) + foldBand(ana.bands[1], out);

    // bass for the beat detector comes off the short FFT so kicks register
    // within a frame or two instead of smeared across the long window; it reads
    // the raw dB data so the DSP layers never starve the beat
    let bass = 0;
    const fastHz = ana.bands[1].hz;
    const bTop = Math.min(Math.floor(150 / fastHz), ana.fast.frequencyBinCount - 1);
    for (let i = 1; i <= bTop; i++) {
      const db = ana.fastData[i];
      if (db > -85) bass += Math.pow(10, db / 20);
    }

    trackEnergy(total, bass, now);

    // smooth the raw chroma toward the peak pick (waveloop's render-loop lerp)
    for (let i = 0; i < 12; i++) chroma[i] += (chromaRaw[i] - chroma[i]) * 0.07;
    out.chroma.set(chroma);
    out.level = state.level;

    // gate the fuzzy chord estimate so the readout does not flicker
    const det = detectChord();
    lastStableName = stabilizer.update(now, det ? det.name : null, det ? det.conf : 0);
  }

  // Fuzzy chord ESTIMATE from the smoothed chroma. Scores every root x quality
  // (shared vocabulary) by partial match, biased toward the root, then hands the
  // winning chord's pitch classes + bass to the shared naming engine so the mic
  // readout gets the SAME aliasing, key-aware spelling, and dim7 root handling as
  // the MIDI readout. Returns { name, conf } or null.
  function detectChord() {
    let total = 0;
    for (let i = 0; i < 12; i++) total += chroma[i];
    chromaAgc = Math.max(chromaAgc * 0.995, total, 1e-6);
    if (total < 0.15 * chromaAgc || chromaAgc < 1e-3) return null;

    const c = new Array(12);
    for (let i = 0; i < 12; i++) c[i] = chroma[i] / total;

    let best = null, bestScore = 0;
    for (let root = 0; root < 12; root++) {
      for (const q of MIC_QUALITIES) {
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
    if (frac < 0.5) return null;   // too much energy outside the chord tones

    // 0=A -> 0=C (+9), then name it through the shared engine. The frame bass is
    // the lowest strong pc in the whole spectrum, not necessarily a tone of this
    // chord - trust it only when it is one, else use the detected root. The -1
    // sentinel must be checked BEFORE converting: (-1 + 9) % 12 === 8 would
    // invent an Ab bass.
    const pcSetC = new Set(best.q.ivs.map((iv) => ((best.root + iv) % 12 + 9) % 12));
    const rootC = (best.root + 9) % 12;
    const bassCandidateC = bassPcA >= 0 ? (bassPcA + 9) % 12 : -1;
    const bassC = pcSetC.has(bassCandidateC) ? bassCandidateC : rootC;
    const name = CHORD.nameFromPitchClasses(pcSetC, bassC, getEstimatedKey());
    return { name, conf: frac };   // conf = fraction of energy on chord tones
  }

  // committed, flicker-free chord name for display (updated each analyse())
  function estimateStableChordName() { return lastStableName; }

  return {
    enable,
    disable,
    analyse,
    estimateStableChordName,  // stabilized name for the readout
    dsp,
    chordSettings,
    setKeySource,             // host supplies the current estimated key for spelling
    // test seam: drive detectChord from a synthetic chroma (no live FFT needed)
    _setChromaForTest: (arr) => { for (let i = 0; i < 12; i++) chroma[i] = arr[i]; },
    _setBassPcForTest: (pcA) => { bassPcA = pcA; },
    _detectChordForTest: () => detectChord(),
  };
}

if (typeof window !== 'undefined') window.createMicInput = createMicInput;
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createMicInput, createChordStabilizer };
}
