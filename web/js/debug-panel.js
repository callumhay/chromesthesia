// debug-panel.js
//
// Live parameter panel, styled after waveloop's collapsible "dsp" deck. Sliders
// (and a toggle) mutate a params object, persist to localStorage, and fire an
// onChange callback so the visualizer picks up changes immediately. Controls
// are grouped into titled sections.

'use strict';

const STORAGE_KEY = 'chromesthesia.celParams';

const pct = (v) => `${Math.round(v * 100)}%`;

// Each section: { title, sliders: [[key,label,min,max,step,fmt], ...],
//                 toggles: [[key,label], ...] }
const SECTIONS = [
  {
    title: 'Octave Colouration',
    sliders: [
      ['octaveLowBrightness',  'low octave bright',  0.2, 1.0, 0.01, pct],
      ['octaveHighBrightness', 'high octave bright', 1.0, 1.8, 0.01, pct],
    ],
    toggles: [
      ['velocityIntensity', 'velocity glow'],
    ],
  },
  {
    title: 'Note Plumes',
    sliders: [
      ['plumeSize', 'plume size', 0.3, 3.0, 0.01, (v) => `${v.toFixed(2)}x`],
    ],
    toggles: [],
  },
  {
    title: 'Midi',
    sliders: [
      ['velocityCutoff', 'velocity cutoff', 0.0, 1.0, 0.01, (v) => `${Math.round(v * 100)}%`],
    ],
    toggles: [],
  },
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
    const html = SECTIONS.map((sec) => {
      const rows = sec.sliders.map(([key, label, min, max, step, fmt]) => {
        const val = this.params[key];
        return `
          <div class="krow on">
            <span class="klabel">${label}</span>
            <input type="range" id="cel_${key}" min="${min}" max="${max}"
                   step="${step}" value="${val}">
            <span class="kval" id="celval_${key}">${fmt(val)}</span>
          </div>`;
      }).join('');
      const toggles = sec.toggles.map(([key, label]) => {
        const checked = this.params[key] ? 'checked' : '';
        return `
          <div class="krow on">
            <span class="klabel">${label}</span>
            <label class="celtoggle">
              <input type="checkbox" id="cel_${key}" ${checked}>
            </label>
          </div>`;
      }).join('');
      return `<div class="sub"><span class="tag">${sec.title}</span></div>${rows}${toggles}`;
    }).join('');

    this.container.innerHTML = html;

    for (const sec of SECTIONS) {
      for (const [key, , , , , fmt] of sec.sliders) {
        const input = this.container.querySelector(`#cel_${key}`);
        const out = this.container.querySelector(`#celval_${key}`);
        input.addEventListener('input', () => {
          this.params[key] = parseFloat(input.value);
          out.textContent = fmt(this.params[key]);
          this._save();
          this.onChange(this.params);
        });
      }
      for (const [key] of sec.toggles) {
        const box = this.container.querySelector(`#cel_${key}`);
        box.addEventListener('change', () => {
          this.params[key] = box.checked;
          this._save();
          this.onChange(this.params);
        });
      }
    }

    this.onChange(this.params);
  }
}

if (typeof module !== 'undefined' && module.exports) module.exports = DebugPanel;
if (typeof window !== 'undefined') window.DebugPanel = DebugPanel;
