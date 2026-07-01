// visualizer.js
//
// The radial pitch-class visualizer, adapted from waveloop
// (Research/waveloop.html). The WebGL engine — history ring buffers,
// amplitude-driven trail raster, and fragment shader — is reused faithfully.
// Two things are replaced:
//
//   1. The audio/FFT input (foldBand) is replaced by feedNotes(): active MIDI
//      notes deposit energy + the chromesthesia core colour into the same
//      per-angle accumulator arrays the engine already consumes.
//   2. The Oklch register colouring is replaced by chromesthesia colours: each
//      note's colour is its circle-of-fifths hue, shaded for its octave (darker
//      for low octaves, brighter/whiter for high) within a bounded range. The
//      octave-shaded colour is baked in by feedNotes, so the trail and rim just
//      carry it - no extra shader machinery.
//
// Everything downstream (raster, smoothing, trails, shader compositing) is the
// original engine, so waveloop's glow/trails come along unchanged.
//
// Depends on window.NoteColours (note-colours.js).

'use strict';

function createVisualizer(canvas, getParams) {
  const NC = window.NoteColours;
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
          || canvas.getContext('experimental-webgl');
  if (!gl) throw new Error('WebGL not available');

  // ---- angular layout (from waveloop) --------------------------------------
  const ANG = 256;
  const AOS = (Math.min(screen.width, screen.height) < 700
            || (navigator.hardwareConcurrency || 8) <= 4) ? 2 : 4;
  const ANG_TEX = ANG * AOS;

  // Octave span the rim maps over. MIDI octaves ~ -1..9; we use 0..8 as the
  // visible register range, matching the debug panel's octave sliders.
  const OCT_LO = 0, OCT_HI = 8;
  const OCT_SPAN = OCT_HI - OCT_LO;

  // Per-note display energy. waveloop's loud fundamentals feed the engine an
  // eTot in the ~1..2 range (its EMAX ceiling is 2.0); the rim-stack height
  // and trail launch speed are both tuned around that scale. A full-velocity
  // note is deposited at this peak so it blooms like a fundamental instead of
  // rendering as a sub-1% sliver.
  const NOTE_ENERGY = 1.8;

  const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

  // Fragment shader, structurally identical to waveloop's. The only change is
  // the colour source: the trail/rim carry the note's octave-shaded
  // chromesthesia colour (deposited by feedNotes), instead of waveloop's Oklch
  // register ramp. Octave lives in that colour, so no extra shader uniforms are
  // needed for it.
  const FRAG = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_level;
uniform float u_beat;
uniform sampler2D u_hist;
uniform vec4 u_pcGlow[12];   // per pitch class: rgb = octave-shaded colour, w = held weight

const float TAU = 6.28318530718;
const float ANGC = ${ANG_TEX}.0;
const float ANGN = ${ANG}.0;
const float RBINS = 256.0;
const float REGS = 4.0;
const float TROWS = RBINS * REGS;
const float R0 = 0.19;
const float RT = 0.40;
const float EMAX = 2.0;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return v;
}

vec3 bspline(float pc01, float w) {
  float pcT = pc01 * w - 0.5;
  float ip = floor(pcT);
  float f = pcT - ip;
  float f2 = f * f, f3 = f2 * f;
  float w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  float w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  float w3 = f3 / 6.0;
  float g0 = w0 + w1;
  return vec3((ip - 0.5 + w1 / g0) / w,
              (ip + 1.5 + w3 / (1.0 - g0)) / w, g0);
}

vec4 radAt(vec3 ang, float xr, float band) {
  float y = (clamp(xr, 0.0, 1.0) * (RBINS - 1.0) + 0.5 + band * RBINS) / TROWS;
  return mix(texture2D(u_hist, vec2(ang.y, y)),
             texture2D(u_hist, vec2(ang.x, y)), ang.z);
}

void main() {
  float mn = min(u_res.x, u_res.y);
  vec2 uv = (gl_FragCoord.xy - 0.5 * u_res) / mn;
  float r = length(uv);
  float pc01 = fract(atan(uv.x, uv.y) / TAU);

  vec3 ang = bspline(pc01, ANGC);
  vec3 angN = bspline(pc01, ANGN);

  vec3 phos  = vec3(0.27, 1.0, 0.78);
  vec3 cold  = vec3(0.10, 0.35, 0.50);
  vec3 col = vec3(0.012, 0.022, 0.028);

  // Background aurora, tinted by the held notes' spokes. Each pitch class i
  // sits at wheel angle i/12; every held note contributes its colour weighted
  // by angular closeness (a smooth falloff as you rotate away from its spoke)
  // and its held strength. Contributions are BLENDED (weighted average), not
  // winner-takes-all, so where two notes' wedges meet their colours mix
  // smoothly with no hard seam. When notes are held the note colour replaces
  // the dusty green; when silent it falls back to the original green aurora.
  vec3 glowSum = vec3(0.0);
  float glowW = 0.0;        // total angular weight (for the blend + green fade)
  float glowAmt = 0.0;      // peak single-note presence here (drives intensity)
  for (int i = 0; i < 12; i++) {
    float w = u_pcGlow[i].w;
    if (w <= 0.001) continue;
    float d = abs(fract(pc01 - float(i) / 12.0 + 0.5) - 0.5);  // wrapped ang dist 0..0.5
    float near = exp(-d * d * 42.0);          // smooth angular falloff along the spoke
    float amt = near * w;
    glowSum += u_pcGlow[i].rgb * amt;
    glowW += amt;
    glowAmt = max(glowAmt, amt);
  }
  vec3 glowCol = glowW > 1e-4 ? glowSum / glowW : vec3(0.0);   // blended hue
  glowCol = max(glowCol, vec3(0.02));         // never fully black where a note glows

  float n = fbm(uv * 2.4 + vec2(u_time * 0.04, -u_time * 0.025));
  float n2 = fbm(uv * 5.0 - vec2(u_time * 0.06, 0.0));
  // base green aurora, faded out where a note-coloured glow takes over
  float greenFade = 1.0 - clamp(glowAmt * 1.5, 0.0, 1.0);
  col += cold * n * (0.07 + 0.38 * u_level) * greenFade;
  col += phos * n * n2 * 0.22 * u_level * greenFade;
  // note-coloured aurora in the nearest spoke's hue
  col += glowCol * n * (0.10 + 0.55 * glowAmt);
  col += glowCol * n * n2 * 0.30 * glowAmt;

  float sectDist = abs(fract(pc01 * 12.0 + 0.5) - 0.5) / 12.0;
  float arcDist = sectDist * TAU * max(r, 0.001);
  float spoke = exp(-arcDist * arcDist * 1.2e5);
  col += phos * spoke * smoothstep(0.0, 0.04, r - (R0 + 0.01))
       * (1.0 - 0.6 * smoothstep(0.46, 0.85, r)) * 0.05;

  float r0 = R0 + 0.008 * u_beat;

  // history trails (unchanged engine): the rgb carried here is the note's
  // chromesthesia core colour, deposited by feedNotes.
  float rOut = 0.5 * length(u_res) / mn + 0.03;
  float xr = clamp((r - r0) / (rOut - r0), 0.0, 1.0);
  float trailMask = smoothstep(0.0, 0.008, r - r0);
  for (int j = 0; j < 4; j++) {
    vec4 h = radAt(ang, xr, float(j));
    float ha = h.a * h.a * EMAX;
    col += h.rgb * h.a * EMAX * (0.55 + 0.95 * ha) * trailMask;
  }

  // --- leading rim stack (waveloop's original, verbatim). The colour comes
  // from the trail's own rgb (coreRgb) which already carries the note's
  // octave-shaded chromesthesia colour, deposited by feedNotes - so octave is
  // baked into the colour and the rim just uses it. Total height is the angle's
  // energy; the stack grows outward from the ring.
  vec4 hn[4];
  float eTot = 0.0;
  vec3 coreRgb = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    hn[j] = radAt(ang, 0.0, float(j));
    eTot += hn[j].a * hn[j].a * EMAX;
    coreRgb += hn[j].rgb * hn[j].a * EMAX;
  }
  if (eTot > 1e-4) coreRgb /= eTot;             // recover the octave-shaded hue

  float s2 = eTot * eTot;
  float stackH = 0.006 + 0.30 * s2 / (s2 + 4.0);
  float xo = r - r0;
  float aa = 0.003;
  float stk = smoothstep(-aa, aa, xo) - smoothstep(stackH - aa, stackH + aa, xo);
  if (stk > 0.001) {
    float bright = 0.25 + 0.85 * min(eTot, 2.2);
    col += coreRgb * stk * bright;
  }

  float ringGlow = exp(-abs(r - r0) * 70.0);
  float occupied = clamp(eTot * 4.0, 0.0, 1.0);
  vec3 ringCol = mix(phos * (0.06 + 0.13 * u_level),
                     coreRgb * (0.5 + 0.5 * u_level), occupied);
  col += ringCol * ringGlow;

  float tickBand = smoothstep(0.0, 0.004, r - (RT + 0.012))
                 * smoothstep(0.0, 0.004, (RT + 0.028) - r);
  col += phos * exp(-arcDist * arcDist * 2.0e5) * tickBand * 0.55;

  float peak = max(col.r, max(col.g, col.b));
  if (peak > 0.82) {
    col *= (0.82 + 0.18 * (1.0 - exp((0.82 - peak) / 0.18))) / peak;
  }

  col *= 1.0 - 0.22 * smoothstep(0.75, 1.45, r);
  col += (hash(uv * 711.0 + fract(u_time)) - 0.5) * 0.025;

  gl_FragColor = vec4(col, 1.0);
}
`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog));
  }
  gl.useProgram(prog);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const locP = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(locP);
  gl.vertexAttribPointer(locP, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const name of ['u_res', 'u_time', 'u_level', 'u_beat', 'u_hist', 'u_pcGlow']) {
    U[name] = gl.getUniformLocation(prog, name);
  }

  // ---- history ring buffers + textures (from waveloop) ---------------------
  const HIST_ROWS = 256;
  const NREG = 4;
  const RBINS = 256;
  const TRAIL_SECONDS = 5;
  const ROW_DT = TRAIL_SECONDS / HIST_ROWS;
  let histHead = 0;
  let lastRowAt = 0;

  const histE = new Float32Array(NREG * ANG * HIST_ROWS);
  const histS = new Float32Array(NREG * ANG * HIST_ROWS);
  const histR = new Float32Array(NREG * ANG * HIST_ROWS);
  const histG = new Float32Array(NREG * ANG * HIST_ROWS);
  const histB = new Float32Array(NREG * ANG * HIST_ROWS);
  const colCount = new Uint16Array(NREG * ANG);

  const histTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, histTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ANG_TEX, RBINS * NREG, 0,
    gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(ANG_TEX * RBINS * NREG * 4));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.uniform1i(U.u_hist, 0);

  // ---- trail raster (verbatim from waveloop) -------------------------------
  const SPD_MIN = 0.15, SPD_MAX = 1.25, TIP_FEATHER = 4.0, E_MAX = 2.0;
  function rowSpeed(s) {
    const s3 = s * s * s;
    return SPD_MIN + (SPD_MAX - SPD_MIN) * s3 / (s3 + 0.25);
  }
  const warpLut = new Float32Array(HIST_ROWS);
  const fadeLut = new Float32Array(HIST_ROWS);
  for (let k = 0; k < HIST_ROWS; k++) {
    const age01 = k / (HIST_ROWS - 1);
    warpLut[k] = Math.pow(age01, 1 / 2.2);
    fadeLut[k] = Math.pow(1 - age01, 1.25);
  }
  const segX = new Float32Array(HIST_ROWS);
  const segV = new Float32Array(HIST_ROWS);
  const segR = new Float32Array(HIST_ROWS);
  const segG = new Float32Array(HIST_ROWS);
  const segB = new Float32Array(HIST_ROWS);
  const radCol = new Float32Array(RBINS * 4);
  const radPix = new Uint8Array(ANG_TEX * RBINS * NREG * 4);
  const radHi = new Uint16Array(NREG * ANG_TEX);
  let radTouched = true;
  const geomX = new Float32Array(ANG * HIST_ROWS);
  const geomV = new Float32Array(ANG * HIST_ROWS);
  const geomR = new Float32Array(ANG * HIST_ROWS);
  const geomG = new Float32Array(ANG * HIST_ROWS);
  const geomB = new Float32Array(ANG * HIST_ROWS);
  const colNeed = new Uint8Array(ANG);
  const colLive = new Uint8Array(ANG);

  function rasterTrails() {
    const am = ANG - 1;
    for (let jr = 0; jr < NREG; jr++) {
      const cbase = jr * ANG;
      for (let a = 0; a < ANG; a++) {
        colNeed[a] = (colCount[cbase + a] || colCount[cbase + ((a - 1) & am)]
                   || colCount[cbase + ((a + 1) & am)]) ? 1 : 0;
      }
      for (let a = 0; a < ANG; a++) {
        colLive[a] = 0;
        if (!colNeed[a]) continue;
        const hbase = (cbase + a) * HIST_ROWS;
        const sbase = a * HIST_ROWS;
        let row = histHead, any = false;
        for (let k = 0; k < HIST_ROWS; k++) {
          const o = hbase + row;
          row = row === 0 ? HIST_ROWS - 1 : row - 1;
          geomX[sbase + k] = rowSpeed(histS[o]) * warpLut[k] * (RBINS - 1);
          const v = histE[o] * fadeLut[k];
          if (v > 0.016) {
            geomV[sbase + k] = v;
            geomR[sbase + k] = histR[o] * v;
            geomG[sbase + k] = histG[o] * v;
            geomB[sbase + k] = histB[o] * v;
            any = true;
          } else {
            geomV[sbase + k] = 0;
            geomR[sbase + k] = geomG[sbase + k] = geomB[sbase + k] = 0;
          }
        }
        if (any) colLive[a] = 1;
      }
      for (let s = 0; s < ANG_TEX; s++) {
        const li = jr * ANG_TEX + s;
        const prevHi = radHi[li];
        const pCol = (s + 0.5) / AOS;
        const a0 = Math.floor(pCol) & am;
        const a1 = (a0 + 1) & am;
        if (!colLive[a0] && !colLive[a1]) {
          if (prevHi > 0) {
            radHi[li] = 0;
            radTouched = true;
            for (let b = 0; b < prevHi; b++) {
              const dst = (((jr * RBINS + b) * ANG_TEX) + s) * 4;
              radPix[dst] = radPix[dst + 1] = radPix[dst + 2] = radPix[dst + 3] = 0;
            }
          }
          continue;
        }
        const tt = pCol - Math.floor(pCol);
        const bA = a0 * HIST_ROWS, bB = a1 * HIST_ROWS;
        let hiX = 0, tipK = -1, any = false;
        for (let k = 0; k < HIST_ROWS; k++) {
          const xA = geomX[bA + k];
          const x = xA + (geomX[bB + k] - xA) * tt;
          const vA = geomV[bA + k];
          const v = vA + (geomV[bB + k] - vA) * tt;
          segX[k] = x;
          if (v > 1e-4) {
            segV[k] = v;
            const rA = geomR[bA + k], gA = geomG[bA + k], bbA = geomB[bA + k];
            segR[k] = rA + (geomR[bB + k] - rA) * tt;
            segG[k] = gA + (geomG[bB + k] - gA) * tt;
            segB[k] = bbA + (geomB[bB + k] - bbA) * tt;
            if (x > hiX) { hiX = x; tipK = k; }
            any = true;
          } else {
            segV[k] = segR[k] = segG[k] = segB[k] = 0;
          }
        }
        const hi = any ? Math.min(Math.round(hiX + TIP_FEATHER) + 1, RBINS - 1) : 0;
        if (!any && prevHi === 0) continue;
        radTouched = true;
        for (let b = 0; b <= hi; b++) {
          const ci = b * 4;
          radCol[ci] = radCol[ci + 1] = radCol[ci + 2] = radCol[ci + 3] = 0;
        }
        for (let k = 0; k + 1 < HIST_ROWS; k++) {
          const vA = segV[k], vB = segV[k + 1];
          if (vA <= 0 && vB <= 0) continue;
          const xA = segX[k], xB = segX[k + 1];
          let b0 = Math.round(Math.min(xA, xB));
          let b1 = Math.round(Math.max(xA, xB));
          if (b0 < 0) b0 = 0;
          if (b1 > hi) b1 = hi;
          const dx = xB - xA;
          const inv = Math.abs(dx) > 1e-6 ? 1 / dx : 0;
          const dv = vB - vA;
          const dR = segR[k + 1] - segR[k];
          const dG = segG[k + 1] - segG[k];
          const dB = segB[k + 1] - segB[k];
          for (let b = b0; b <= b1; b++) {
            let t = (b - xA) * inv;
            if (t < 0) t = 0; else if (t > 1) t = 1;
            const v = vA + dv * t;
            const ci = b * 4;
            if (v > radCol[ci + 3]) {
              radCol[ci + 3] = v;
              radCol[ci]     = segR[k] + dR * t;
              radCol[ci + 1] = segG[k] + dG * t;
              radCol[ci + 2] = segB[k] + dB * t;
            }
          }
        }
        if (tipK >= 0) {
          const tv = segV[tipK];
          const pr = segR[tipK] / tv, pg = segG[tipK] / tv, pb = segB[tipK] / tv;
          for (let b = Math.max(0, Math.ceil(hiX)); b <= hi; b++) {
            const t = (b - hiX) / TIP_FEATHER;
            if (t <= 0) continue;
            if (t >= 1) break;
            const v = tv * (1 - t) * Math.sqrt(1 - t);
            const ci = b * 4;
            if (v > radCol[ci + 3]) {
              radCol[ci + 3] = v;
              radCol[ci] = pr * v; radCol[ci + 1] = pg * v; radCol[ci + 2] = pb * v;
            }
          }
        }
        const top = Math.max(hi, prevHi);
        for (let b = 0; b <= top; b++) {
          const dst = (((jr * RBINS + b) * ANG_TEX) + s) * 4;
          const v = b <= hi ? radCol[b * 4 + 3] : 0;
          if (v > 1e-6) {
            const ci = b * 4;
            const vk = b === 0 ? v : v * v * v / (v * v + 0.02);
            const aEnc = Math.min(Math.sqrt(vk / E_MAX), 1);
            const cs = aEnc / v * 255;
            radPix[dst]     = Math.min(255, radCol[ci]     * cs) | 0;
            radPix[dst + 1] = Math.min(255, radCol[ci + 1] * cs) | 0;
            radPix[dst + 2] = Math.min(255, radCol[ci + 2] * cs) | 0;
            radPix[dst + 3] = (aEnc * 255) | 0;
          } else {
            radPix[dst] = radPix[dst + 1] = radPix[dst + 2] = radPix[dst + 3] = 0;
          }
        }
        radHi[li] = hi;
      }
    }
    if (radTouched) {
      radTouched = false;
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, ANG_TEX, RBINS * NREG,
        gl.RGBA, gl.UNSIGNED_BYTE, radPix);
    }
  }

  // ---- MIDI feeder (replaces foldBand) -------------------------------------
  // Per-frame accumulators, same roles as waveloop's angEnergy/angR/G/B/angW.
  const angEnergy = new Float32Array(NREG * ANG);
  const angR = new Float32Array(NREG * ANG);
  const angG = new Float32Array(NREG * ANG);
  const angB = new Float32Array(NREG * ANG);
  const angW = new Float32Array(NREG * ANG);
  // smoothed display copies (like waveloop's dispR/dispE)
  const dispE = new Float32Array(NREG * ANG);
  const dispR = new Float32Array(NREG * ANG);
  const dispG = new Float32Array(NREG * ANG);
  const dispB = new Float32Array(NREG * ANG);

  const chroma = new Float32Array(12);
  const chromaRaw = new Float32Array(12);

  // Per-pitch-class background glow: for each of the 12 pitch classes, the
  // octave-shaded colour (rgb) and a weight (w = held energy). The background
  // aurora is tinted by the nearest held note's spoke colour, so it's [r,g,b,w]
  // per pitch class. Smoothed copy is what the shader uniform reads.
  const pcGlow = new Float32Array(12 * 4);
  const dispPcGlow = new Float32Array(12 * 4);
  const pcGlowUniform = new Float32Array(12 * 4);   // staged for gl.uniform4fv

  // pitch class index (0=A) -> angular bin center. A at 12 o'clock.
  function pcToAngleBin(pc) { return (pc / 12) * ANG; }
  // octave -> register band (0..NREG-1), low octave inner.
  function octToBand(octave) {
    const o = Math.min(1, Math.max(0, (octave - OCT_LO) / OCT_SPAN));
    return Math.min(NREG - 1, (o * NREG) | 0);
  }

  // Deposit the active notes into the per-frame accumulators. notes is a Map
  // midi -> { velocity, onTime }. params comes from the debug panel.
  function feedNotes(notes, params, now) {
    angEnergy.fill(0); angR.fill(0); angG.fill(0); angB.fill(0); angW.fill(0);
    chromaRaw.fill(0); pcGlow.fill(0);

    for (const [midi, note] of notes) {
      const map = NC.noteToColour(midi, note.velocity, params);
      const pc = map.pcIndex;
      // MIDI notes are a perfectly constant (DC) signal, so with steady energy
      // every history row is identical and the trail renders frozen. Real audio
      // jitters, which is what makes waveloop's trails flow. We synthesize that
      // motion: a strong ATTACK surge on note-on that decays to a sustain, plus
      // a gentle sustain shimmer, so each note-on flings a bright pulse outward
      // through the trails and held notes keep breathing.
      const age = Math.max(0, now - (note.onTime || now));
      const attack = 1.0 + 1.4 * Math.exp(-age / 0.12);     // ~1x..2.4x, 120ms decay
      const shimmer = 1.0 + 0.06 * Math.sin(now * 7.0 + midi);
      const energy = map.intensity * attack * shimmer;      // time-varying glow
      const band = octToBand(map.octave);
      const centerBin = pcToAngleBin(pc);

      // Octave colour: the note's colour is its base chromesthesia hue, shaded
      // for its octave within a bounded brightness range so it never looks bad.
      // Relative to a reference octave (C4, MIDI octave 4): C4 = the pure base
      // hue (100%); lower octaves scale down toward OCT_MIN, higher octaves up
      // toward OCT_MAX (and lift toward white). Static - no pulsing. The colour
      // is ALWAYS present (never black, never blown out).
      const REF_OCTAVE = 4;
      const OCT_MIN = params.octaveLowBrightness;   // lowest octaves' brightness
      const OCT_MAX = params.octaveHighBrightness;  // highest octaves' brightness
      const octAmt = Math.max(-1, Math.min(1, (map.octave - REF_OCTAVE) / 3));
      let cr, cg, cb;
      if (octAmt >= 0) {
        // high octaves: scale up and lift toward white
        const scale = 1 + (OCT_MAX - 1) * octAmt;
        const white = 0.35 * octAmt;   // partial white lift for airiness up high
        cr = Math.min(1, map.core[0] * scale + white);
        cg = Math.min(1, map.core[1] * scale + white);
        cb = Math.min(1, map.core[2] * scale + white);
      } else {
        // low octaves: a darker version of the base hue, floored at OCT_MIN
        const scale = 1 + (1 - OCT_MIN) * octAmt;   // octAmt in [-1,0] -> [OCT_MIN,1]
        cr = map.core[0] * scale;
        cg = map.core[1] * scale;
        cb = map.core[2] * scale;
      }

      // paint a Gaussian around the pitch-class spoke so trails read as smooth
      // arcs, not single-column spikes (mirrors foldBand's blur). The profile
      // is NOT area-normalized: the PEAK (d=0) must equal the note's display
      // energy so the shader's rim stack towers like a fundamental. Dividing by
      // the Gaussian area (as an FFT fold would, to conserve spectral mass)
      // shrank the peak ~7x and left every note a sliver.
      // angular lobe/plume width: a spike (sig~2) is a sliver, a fat blob
      // (sig~6) swamps the trail motion. ~3.4 gives a clean petal; the
      // plumeSize debug param scales it so plumes can be made narrower/wider.
      const sig = 3.4 * (params.plumeSize || 1.0);
      const rad = Math.ceil(sig * 2.5);
      const inv2s2 = 1 / (2 * sig * sig);
      const peak = energy * NOTE_ENERGY;
      const base = Math.round(centerBin);
      for (let d = -rad; d <= rad; d++) {
        const ai = ((base + d) % ANG + ANG) % ANG;
        const g = Math.exp(-d * d * inv2s2) * peak;
        const idx = band * ANG + ai;
        angEnergy[idx] += g;
        angR[idx] += cr * g; angG[idx] += cg * g; angB[idx] += cb * g;
        angW[idx] += g;
      }
      chromaRaw[pc] += map.intensity;   // chord detection uses steady energy

      // accumulate this note's octave-shaded colour into its pitch class for
      // the background glow (keep the strongest contribution per pitch class)
      const gi = pc * 4;
      const w = map.intensity;
      if (w > pcGlow[gi + 3]) {
        pcGlow[gi] = cr; pcGlow[gi + 1] = cg; pcGlow[gi + 2] = cb; pcGlow[gi + 3] = w;
      }
    }
  }

  // Push the current smoothed frame into the history ring (like waveloop's
  // frame() history push), then rasterize.
  function pushHistory(now) {
    // smooth toward the live frame
    for (let i = 0; i < NREG * ANG; i++) {
      const w = angW[i] > 1e-6 ? angW[i] : 1;
      const tr = angR[i] / w, tg = angG[i] / w, tb = angB[i] / w;
      dispE[i] += (angEnergy[i] - dispE[i]) * (angEnergy[i] > dispE[i] ? 0.5 : 0.2);
      dispR[i] += (tr - dispR[i]) * 0.4;
      dispG[i] += (tg - dispG[i]) * 0.4;
      dispB[i] += (tb - dispB[i]) * 0.4;
    }

    if (now - lastRowAt > TRAIL_SECONDS) lastRowAt = now - ROW_DT;
    let pushed = false;
    while (now - lastRowAt >= ROW_DT) {
      lastRowAt += ROW_DT;
      pushed = true;
      histHead = (histHead + 1) % HIST_ROWS;
      for (let jr = 0; jr < NREG; jr++) {
        for (let a = 0; a < ANG; a++) {
          const src = jr * ANG + a;
          const dst = (jr * ANG + a) * HIST_ROWS + histHead;
          const e = dispE[src];
          histE[dst] = e;
          histS[dst] = e;
          histR[dst] = dispR[src];
          histG[dst] = dispG[src];
          histB[dst] = dispB[src];
          // maintain nonzero-row count per column for the raster skip
          const prev = histE[(jr * ANG + a) * HIST_ROWS
            + ((histHead + 1) % HIST_ROWS)];
          if (e > 0.016 && prev <= 0.016) colCount[src]++;
          else if (e <= 0.016 && prev > 0.016 && colCount[src] > 0) colCount[src]--;
        }
      }
    }
    if (pushed) rasterTrails();
  }

  // smooth chroma for chord detection
  function updateChroma() {
    for (let i = 0; i < 12; i++) chroma[i] += (chromaRaw[i] - chroma[i]) * 0.25;
  }

  // ---- resize + render -----------------------------------------------------
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }

  let level = 0, beat = 0, lastNow = 0;

  function render(now, notes) {
    now = now / 1000;
    const dt = Math.min(now - lastNow, 0.1);
    lastNow = now;
    const params = getParams();

    feedNotes(notes, params, now);
    updateChroma();

    // overall level (drives the aurora/backdrop) and a soft beat on onsets
    let tot = 0;
    for (const [, n] of notes) tot += n.velocity;
    level += (Math.min(tot, 1) - level) * 0.15;
    beat = Math.max(0, beat - dt * 3.2);

    resize();
    pushHistory(now);

    // smooth the per-pitch-class glow toward the live frame, and stage it into
    // the uniform buffer (colour rgb in xyz, weight in w). Weight rises fast
    // (note attack) and falls gently (glow lingers as the note releases).
    for (let i = 0; i < 12; i++) {
      const b = i * 4;
      for (let c = 0; c < 3; c++) {
        dispPcGlow[b + c] += (pcGlow[b + c] - dispPcGlow[b + c]) * 0.35;
      }
      const tw = pcGlow[b + 3];
      dispPcGlow[b + 3] += (tw - dispPcGlow[b + 3]) * (tw > dispPcGlow[b + 3] ? 0.5 : 0.12);
      pcGlowUniform[b] = dispPcGlow[b];
      pcGlowUniform[b + 1] = dispPcGlow[b + 1];
      pcGlowUniform[b + 2] = dispPcGlow[b + 2];
      pcGlowUniform[b + 3] = dispPcGlow[b + 3];
    }

    gl.uniform2f(U.u_res, canvas.width, canvas.height);
    gl.uniform1f(U.u_time, now);
    gl.uniform1f(U.u_level, level);
    gl.uniform1f(U.u_beat, beat);
    gl.uniform4fv(U.u_pcGlow, pcGlowUniform);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function pulse() { beat = 1; }

  // peak per-frame deposited energy across all angles/bands, for verification
  function peakEnergy() {
    let m = 0;
    for (let i = 0; i < angEnergy.length; i++) if (angEnergy[i] > m) m = angEnergy[i];
    return m;
  }
  function debugState() {
    let dm = 0;
    for (let i = 0; i < dispE.length; i++) if (dispE[i] > dm) dm = dispE[i];
    return { histHead, peakDispE: dm };
  }
  // normalized deposited colour at the brightest bin (for pulse verification)
  function sampleColour() {
    let bi = 0, bw = 0;
    for (let i = 0; i < angW.length; i++) if (angW[i] > bw) { bw = angW[i]; bi = i; }
    if (bw < 1e-6) return null;
    return [angR[bi] / bw, angG[bi] / bw, angB[bi] / bw].map((v) => Math.round(v * 255));
  }

  return { render, pulse, chroma, ANG, peakEnergy, debugState, sampleColour };
}

if (typeof window !== 'undefined') window.createVisualizer = createVisualizer;
