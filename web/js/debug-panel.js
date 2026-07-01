// debug-panel.js
//
// Live parameter panel for the cel-shading, styled after waveloop's collapsible
// "dsp" deck. Sliders mutate a params object, persist to localStorage, and fire
// an onChange callback so the visualizer picks up changes immediately.

'use strict';

const STORAGE_KEY = 'chromesthesia.celParams';

// Slider spec: [key, label, min, max, step, toDisplay]
const SLIDERS = [
  ['bandThickness',   'band thickness',     0, 1,  0.01, (v) => `${Math.round(v * 100)}%`],
  ['coreBandRatio',   'core / band ratio',  0, 1,  0.01, (v) => `${Math.round(v * 100)}%`],
  ['octaveLow',       'low octave',         0, 8,  1,    (v) => `${v}`],
  ['octaveHigh',      'high octave',        1, 9,  1,    (v) => `${v}`],
  ['lowBright',       'low octave bright',  0, 1,  0.01, (v) => `${Math.round(v * 100)}%`],
  ['highBright',      'high octave bright', 0, 1,  0.01, (v) => `${Math.round(v * 100)}%`],
  ['accentSaturation','accent saturation',  0, 1,  0.01, (v) => `${Math.round(v * 100)}%`],
  ['octaveColourPulsePeriod',    'oct pulse period', 0.1, 4, 0.05, (v) => `${v.toFixed(2)}s`],
  ['octaveColourPulseSharpness', 'oct pulse sharp',  0,   1, 0.01, (v) => `${Math.round(v * 100)}%`],
];

class DebugPanel {
  constructor({ container, defaults, onChange } = {}) {
    this.container = container;
    this.onChange = onChange || (() => {});
    this.params = Object.assign({}, defaults, this._load());
  }

  _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }

  _save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.params)); }
    catch (e) { /* private mode: ignore */ }
  }

  render() {
    const rows = SLIDERS.map(([key, label, min, max, step, fmt]) => {
      const val = this.params[key];
      return `
        <div class="krow on">
          <span class="klabel">${label}</span>
          <input type="range" id="cel_${key}" min="${min}" max="${max}"
                 step="${step}" value="${val}">
          <span class="kval" id="celval_${key}">${fmt(val)}</span>
        </div>`;
    }).join('');

    const velChecked = this.params.velocityIntensity ? 'checked' : '';
    this.container.innerHTML = `
      <div class="sub">cel-shading // <span class="tag">octave accent</span></div>
      ${rows}
      <div class="krow on">
        <span class="klabel">velocity glow</span>
        <label class="celtoggle">
          <input type="checkbox" id="cel_velocityIntensity" ${velChecked}>
        </label>
      </div>`;

    for (const [key, , , , , fmt] of SLIDERS) {
      const input = this.container.querySelector(`#cel_${key}`);
      const out = this.container.querySelector(`#celval_${key}`);
      input.addEventListener('input', () => {
        this.params[key] = parseFloat(input.value);
        out.textContent = fmt(this.params[key]);
        this._save();
        this.onChange(this.params);
      });
    }
    const vel = this.container.querySelector('#cel_velocityIntensity');
    vel.addEventListener('change', () => {
      this.params.velocityIntensity = vel.checked;
      this._save();
      this.onChange(this.params);
    });

    this.onChange(this.params);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = DebugPanel;
if (typeof window !== 'undefined') window.DebugPanel = DebugPanel;
