# Chromesthesia

Robust musical note-to-colour conversion, driven by MIDI and/or microphone
input. Notes are mapped to colours using a circle-of-fifths palette (a
modernized Scriabin-style mapping).

There are two front-ends that share the same colour scheme:

- **Python LED app** (`chromesthesia.py`) — lights a physical NeoPixel LED
  strip from a MIDI keyboard and/or microphone.
- **Web view** (`web/`) — a browser visualization (a radial pitch-class wheel
  with trails, adapted from `Research/waveloop.html`) driven by Web MIDI or the
  microphone.

Both read note colours from a single source of truth: **`note_colours.json`**
at the repo root. Editing a colour there updates the LEDs and the web view.

## Requirements

- Python 3 (tested with 3.9+)
- A modern browser for the web view — **Chrome or Edge** for MIDI (Web MIDI is
  not supported in Safari/Firefox); any browser works with the on-screen
  keyboard.
- Node.js — only needed to run the JavaScript tests.

## Web view

The web view is self-contained (no build step). Serving it over HTTP is
recommended so it reads the shared `note_colours.json`. From the repo root:

```sh
python3 -m http.server 8199
```

Then open **http://localhost:8199/web/** in Chrome or Edge.

It also works opened directly as a `file://` URL (double-clicking
`web/index.html`): fetching `note_colours.json` is blocked there, so it falls
back to a copy of the colours embedded in `web/js/note-colours.js`.

### Modes

- **MIDI** (default) — plug in a MIDI device (the browser will prompt for MIDI
  permission), or play the on-screen keyboard.
- **Mic** — click **Mic** in the header to visualize live audio from the
  microphone (prompts for mic permission).

Switch modes with the MIDI/Mic toggle in the header.

### On-screen keyboard (MIDI mode)

- White keys: `a s d f g h j k l` (C D E F G A B C D E)
- Black keys: `w e t y u o p`
- Octave down / up: `z` / `x`

The centre readout names the chord being held. When held notes imply but don't
complete a chord, the implied chord is shown smaller beneath the note names
(e.g. `E B D` shows `E7`). Chords with more than one name show all of them,
bass note first (e.g. `C6 / Am7`).

## Python LED app

Install dependencies (a virtualenv is recommended):

```sh
pip install -r requirements.txt
```

Note: `requirements.txt` includes packages for MIDI (`mido`, `python-rtmidi`)
and microphone/pitch detection (`PyAudio`, `librosa`). The NeoPixel hardware
libraries (`board`, `neopixel_spi`) are only imported when running on real
hardware — use `--no-hw` to run without them.

Run without LED hardware (prints colours to the console):

```sh
python3 chromesthesia.py --no-hw --print-colours
```

Run on hardware (e.g. a Raspberry Pi with a NeoPixel strip):

```sh
python3 chromesthesia.py --num-leds 19 --brightness 1.0
```

Useful flags:

- `--no-hw` — don't drive LEDs; print debug output instead.
- `--midi-port-name NAME` — MIDI port to connect to (default `USB MIDI Interface`).
- `--num-leds N` — number of LEDs in the strip (default 19).
- `--brightness B` — LED brightness in `[0, 1]` (default 1.0).
- `--no-midi-priority` — don't let MIDI override the mic when both are active.
- `--print-colours` / `--print-events` — debug output.

## Note colours

`note_colours.json` holds the circle-of-fifths note ordering and the RGB
colour per note. It is the single source of truth:

- `NoteUtils.py` loads it for the LED app.
- The web view fetches it at startup (with an embedded fallback for `file://`).

After editing `note_colours.json`, regenerate the web view's embedded fallback
so it stays in sync:

```sh
node scripts/embed-note-colours.js
```

## Tests

Python (note-colour parity with the shared JSON):

```sh
python3 -m unittest test_note_utils
```

JavaScript (chord detection, aliases, implied chords, colour mapping) — plain
Node, no toolchain:

```sh
node web/js/chord.test.js
node web/js/chord.implied.test.js
node web/js/chord.alias.test.js
node web/js/note-colours.test.js
```
