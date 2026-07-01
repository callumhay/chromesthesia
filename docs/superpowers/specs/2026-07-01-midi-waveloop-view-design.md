# Design: MIDI-driven chromesthesia view of waveloop

**Date:** 2026-07-01
**Status:** Approved (pending spec review)

## 1. Summary

A new, self-contained web page that reuses the `waveloop` radial pitch-class
visualization (`Research/waveloop.html`) but is driven by **MIDI input in the
browser** instead of audio/FFT analysis, and rendered in the **chromesthesia
circle-of-fifths color scheme** instead of waveloop's native Oklch register
colors.

Each note renders with a **cel-shaded octave accent**: a pure chromesthesia
core color plus a single hard-edged accent band (fixed thickness) whose
brightness encodes the octave. A live debug panel exposes the cel-shading
parameters for real-time tuning.

The existing Python LED application is left functionally unchanged. The one
shared change is that note colors move into a single JSON file consumed by
both the Python app and the web view, so there is one source of truth.

## 2. Goals

- New web page view, an **entirely new set of files** (do not modify
  `Research/waveloop.html`; keep it as reference).
- Input: **Web MIDI API** directly in the browser (no Python bridge, no audio).
- Color: each note drawn in its **chromesthesia circle-of-fifths color**,
  keeping waveloop's chromatic wheel layout (A at 12 o'clock, semitone steps
  clockwise).
- Octave: shown as a **cel-shaded accent band** — pure core color + one
  fixed-thickness hard-edged band, brightness ramped by octave.
- **Single source of truth** for note colors, shared by Python and JS.
- **Live debug panel** to tweak cel-shading parameters.
- MIDI **velocity drives glow intensity** (toggleable in the debug panel).

## 3. Non-goals (YAGNI)

- No audio/microphone input in the new view (MIDI only).
- No Python↔browser WebSocket bridge (Web MIDI is direct).
- No changes to LED rendering logic in `chromesthesia.py` / `Animator`.
- No modification of the original `Research/waveloop.html`.
- No reordering of the wheel into circle-of-fifths layout (keep chromatic
  layout; only the colors change). Chord-detection geometry and shader spoke
  positions stay chromatic.

## 4. Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| MIDI source | Web MIDI API, direct in browser |
| Wheel layout | Keep waveloop's chromatic layout unchanged |
| Note colors | Chromesthesia circle-of-fifths colors |
| Color source | Shared `note_colours.json` at repo root |
| Octave rendering | Cel-shaded accent band: core color + one hard-edged band |
| Band thickness | Fixed for all octaves; octave = brightness only |
| Debug panel | Live sliders, waveloop `dsp`-panel style, persisted to localStorage |
| File location | New `web/` folder at repo root |
| Velocity | Drives glow intensity; toggleable in debug panel |

## 5. File layout (all new unless noted)

```
web/
  index.html          # page shell, canvas, UI, debug panel markup
  css/
    style.css         # styles (waveloop-derived, trimmed to what's used)
  js/
    midi-input.js     # Web MIDI: connect, note on/off + velocity -> events
    note-colours.js   # loads shared JSON; note->core color, octave->accent
    visualizer.js     # WebGL wheel/trail renderer (waveloop shader, adapted)
    debug-panel.js    # slider deck bound to cel-shade params + localStorage
    keyboard-input.js # computer-keyboard fallback (no MIDI device needed)
    main.js           # wires input -> note state -> visualizer render loop
note_colours.json     # SHARED source of truth (repo root)

# Modified (Python):
NoteUtils.py          # load colors from note_colours.json instead of hardcoding
```

### `note_colours.json` shape

```json
{
  "circle_of_fifths": ["A","E","B","Gb","Db","Ab","Eb","Bb","F","C","G","D"],
  "colours": {
    "A":  [1.0, 0.0,  0.0],
    "E":  [1.0, 0.35, 0.0],
    "B":  [1.0, 0.55, 0.0],
    "Gb": [1.0, 1.0,  0.0],
    "Db": [0.5, 0.65, 0.0],
    "Ab": [0.0, 1.0,  0.5],
    "Eb": [0.0, 1.0,  1.0],
    "Bb": [0.0, 0.5,  1.0],
    "F":  [0.0, 0.0,  1.0],
    "C":  [0.6, 0.0,  0.9],
    "G":  [1.0, 0.0,  1.0],
    "D":  [1.0, 0.0,  0.5]
  }
}
```

Values are identical to the current `NOTE_COLOURS` in `NoteUtils.py`, so LED
output is unchanged after the refactor.

## 6. Note-name conventions

- Chromesthesia uses **flat** spellings standardized in
  `standardize_note_name` (`C#`→`Db`, `D#`→`Eb`, `F#`→`Gb`, `G#`→`Ab`,
  `A#`→`Bb`). The JSON keys use these flat names.
- Waveloop's wheel labels use **sharp** names, index 0 = A:
  `['A','A#','B','C','C#','D','D#','E','F','F#','G','G#']`.
- `note-colours.js` maps a MIDI note number → pitch class (sharp name) →
  standardized flat name → color, so the two conventions line up. The wheel
  keeps its sharp labels; only the fill colors come from chromesthesia.

## 7. Data flow

```
MIDI device
  -> Web MIDI API (midi-input.js): note-on/off, note number, velocity
  -> note state: activeNotes = { midiNumber: {pc, octave, velocity, onTime} }
  -> per frame: MIDI feeder deposits energy per active note:
       angle  = pitch class position on the chromatic wheel
       radius = octave (low register inner, high register outer)
       color  = chromesthesia core color (note-colours.js)
       accent = octave -> brightness cel band
       energy = velocity (if velocity mode on) else fixed
  -> visualizer.js: feeds waveloop's radial trail rasterizer + shader
  -> WebGL render (trails, glow, ring, chord readout retained)
```

### Adaptation of waveloop internals

- **Replace** `foldBand()` (FFT-bins → per-angle arrays) with a **MIDI feeder**
  that fills the same `angEnergy` / `angR/G/B` / `angRim` arrays from the active
  note set. This keeps the trail rasterization (`rasterTrails`), history
  texture, and fragment shader intact, so waveloop's glow/trails are reused.
- **Replace** the Oklch `regColor()` / `REG_LUT` register coloring with the
  chromesthesia core color + cel accent. The radial *stack position* still
  encodes octave (as in waveloop); the *color* now encodes note identity, and
  the cel accent band re-adds octave as a discrete brightness step.
- **Retain** chord detection/readout — MIDI gives exact pitch classes, so the
  center chord name is more accurate than the audio version. The `chroma[]`
  array is filled directly from active MIDI notes.
- **Remove** the audio-only UI (mic button, track deck, DSP postprocessing
  panel, sync-delay). Replace the DSP panel with the cel-shade debug panel.

## 8. Cel-shading model

Each active note draws:
- **Core arc:** pure chromesthesia color, fixed angular width, inner radius set
  by octave.
- **Accent band:** single hard-edged band, fixed thickness, edge-to-edge with
  the core (no gap). Brightness = octave via a `low -> high` ramp.

`noteToColour(pc, octave, velocity, params)` is a **pure function** returning
`{ core: [r,g,b], accent: [r,g,b], intensity }`, making it unit-testable.

### Debug panel parameters (live, persisted to localStorage)

| Param | Meaning |
|---|---|
| band thickness | accent band width |
| core / band ratio | how the note's radial footprint splits between core and band |
| octave range | which octaves map to darkest -> brightest |
| low octave brightness | accent brightness floor |
| high octave brightness | accent brightness ceiling |
| accent saturation | how saturated the accent band is vs. the core |
| velocity -> intensity | toggle: MIDI velocity drives glow intensity (default on) |

Panel styled after waveloop's collapsible `dsp` deck. All sliders update the
render live.

## 9. Testing

- **Python parity:** a test asserting `NoteUtils.NOTE_COLOURS` and
  `CIRCLE_OF_FIFTHS_NOTE_NAMES`, loaded from `note_colours.json`, equal the
  pre-refactor hardcoded values (guards the shared-source refactor).
- **JS mapping:** unit tests for `noteToColour(pc, octave, velocity, params)`
  (pure function) — correct core color per note, correct octave brightness
  ramp, velocity effect. Run via a minimal test HTML page or a lightweight
  runner (no existing JS toolchain; pick the simplest that works here).
- **Manual / no-device:** `keyboard-input.js` maps computer keys to notes so
  the view is fully testable without a MIDI controller. Verify note-on/off,
  color per note, octave accent, chord readout, and debug sliders.

## 10. Risks / notes

- **Web MIDI browser support:** Chrome/Edge support Web MIDI; Firefox/Safari
  historically limited. The view targets Chromium browsers; the keyboard
  fallback covers others.
- **Shader reuse fidelity:** the waveloop shader assumes premultiplied,
  sqrt-encoded energy in its history texture. The MIDI feeder must match that
  encoding so trails render correctly. This is the main integration risk and
  will be validated early with a single hardcoded note before wiring full MIDI.
- **Note-name mapping bugs:** sharp/flat mismatch is the likely failure mode;
  covered by the JS mapping tests.
```
