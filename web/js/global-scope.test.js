// global-scope.test.js
//
// The browser loads web/js/*.js as CLASSIC scripts (see index.html) - they all
// share ONE global scope, so two files declaring the same top-level `const` is a
// duplicate-declaration SyntaxError that kills the entire page at parse time.
//
// Node's tests cannot see this: `require` gives each file its own module scope,
// so every other suite stays green while the app is dead in the browser. This
// has already happened twice - a top-level `const KS` in both chord.js and
// mic-input.js, then a top-level `const CHORD_QUALITIES` in both
// chord-qualities.js and chord.js.
//
// So: parse the scripts the way the BROWSER does - concatenated, in index.html
// order, as one unit - and report which name collided in which files.

'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WEB_DIR = path.join(__dirname, '..');
const INDEX_HTML = path.join(WEB_DIR, 'index.html');

let passed = 0;
function test(name, fn) {
  fn();
  console.log(`  ok - ${name}`);
  passed++;
}

// The <script src="./js/*.js"> files, in the order index.html loads them. Read
// from the real HTML so this test tracks the app instead of a stale copy.
function scriptsFromIndexHtml() {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const srcs = [...html.matchAll(/<script\s+src="\.\/js\/([^"]+)"><\/script>/g)].map((m) => m[1]);
  assert.ok(srcs.length > 0, 'no <script src="./js/..."> tags found in index.html');
  return srcs;
}

// Which scripts declare `name` at top level? Used only to turn V8's bare
// "already been declared" into an actionable message. Answered by PARSING each
// file alone and re-parsing it with a leading `const <name>` - if that file
// declares the name, the combination is a duplicate-declaration error. Parsing
// (not a regex) keeps shader source and other string contents from matching:
// visualizer.js is full of GLSL `float x = ...` that only looks like JS.
function declaringScripts(srcs, name) {
  return srcs.filter((s) => {
    const source = fs.readFileSync(path.join(WEB_DIR, 'js', s), 'utf8');
    try {
      new vm.Script(`const ${name} = 0;\n${source}`, { filename: s });
      return false;
    } catch (err) {
      return /has already been declared/.test(err.message);
    }
  });
}

console.log('global-scope');

test('index.html scripts parse as one shared global scope (as the browser loads them)', () => {
  const srcs = scriptsFromIndexHtml();
  const combined = srcs
    .map((s) => fs.readFileSync(path.join(WEB_DIR, 'js', s), 'utf8'))
    .join('\n');

  // vm.Script does the same parse the browser does, without executing anything.
  try {
    new vm.Script(combined, { filename: 'concatenated-index-scripts.js' });
  } catch (err) {
    // A bare "X has already been declared" doesn't say WHICH files - work that
    // out here, because that is the whole debugging cost of this bug.
    const dup = /Identifier '([^']+)' has already been declared/.exec(err.message);
    if (dup) {
      const name = dup[1];
      const culprits = declaringScripts(srcs, name);
      assert.fail(
        `Top-level name '${name}' is declared by more than one script: ${culprits.join(', ')}.\n` +
        `  These share one global scope in the browser, so this is a SyntaxError that kills the page.\n` +
        `  Fix: keep the declaration in its owning file and have consumers read it through their\n` +
        `  namespaced import binding (e.g. CQ.CHORD_QUALITIES) or use a distinct local name.`);
    }
    assert.fail(`index.html scripts failed to parse together: ${err.message}`);
  }
});

// The collision report is the reason this test earns its keep: a bare
// "Identifier 'X' has already been declared" names no file, and these scripts
// are only ever concatenated at runtime. Prove the diagnosis works.
test('a collision reports the name and every script declaring it', () => {
  const srcs = scriptsFromIndexHtml();
  assert.deepStrictEqual(declaringScripts(srcs, 'CHORD_QUALITIES'), ['chord-qualities.js'],
    'CHORD_QUALITIES must be declared by exactly its owning file');
  assert.deepStrictEqual(declaringScripts(srcs, 'createMicInput'), ['mic-input.js']);
  assert.deepStrictEqual(declaringScripts(srcs, 'notAnIdentifierAnyoneDeclares'), []);
});

console.log(`\n${passed} passed`);
