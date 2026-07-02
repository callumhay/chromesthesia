// Regenerate the EMBEDDED_NOTE_COLOURS fallback in web/js/note-colours.js from
// note_colours.json (the single source of truth). Run after editing colours:
//   node scripts/embed-note-colours.js
//
// The embedded copy lets the web view load as a file:// URL, where fetch of the
// JSON is blocked. This keeps the two copies in sync automatically so they
// can't drift. note-colours.test.js also asserts they match.

'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const jsonPath = path.join(root, 'note_colours.json');
const jsPath = path.join(root, 'web', 'js', 'note-colours.js');

const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

// Format the object to match the file's style: two-space indented, one colour
// per line, arrays inline.
const cof = JSON.stringify(data.circle_of_fifths);
const colourLines = Object.keys(data.colours)
  .map((k) => `    ${JSON.stringify(k)}: ${JSON.stringify(data.colours[k])}`)
  .join(',\n');
const block =
  '/* BEGIN EMBEDDED_NOTE_COLOURS (generated from note_colours.json) */\n' +
  'const EMBEDDED_NOTE_COLOURS = {\n' +
  `  "circle_of_fifths": ${cof},\n` +
  '  "colours": {\n' +
  colourLines + '\n' +
  '  }\n' +
  '};\n' +
  '/* END EMBEDDED_NOTE_COLOURS */';

const js = fs.readFileSync(jsPath, 'utf8');
const re = /\/\* BEGIN EMBEDDED_NOTE_COLOURS[\s\S]*?\/\* END EMBEDDED_NOTE_COLOURS \*\//;
if (!re.test(js)) {
  console.error('Could not find the EMBEDDED_NOTE_COLOURS markers in', jsPath);
  process.exit(1);
}
const updated = js.replace(re, block);

if (updated === js) {
  console.log('note-colours.js embedded colours already up to date.');
} else {
  fs.writeFileSync(jsPath, updated);
  console.log('Regenerated EMBEDDED_NOTE_COLOURS in web/js/note-colours.js from note_colours.json.');
}
