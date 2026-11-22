// 2.2.0 settings: KNOWN FAILING tests for bugs found while writing tests/editor-settings-edge*.mjs.
// NOT wired into tests/run.js. Run directly: `node tests/editor-settings-bugs.mjs` (exits 1 while the bugs exist).
// Move a test into editor-settings-edge-dom.mjs once its bug is fixed.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');

const mk = (score, raf = false) => {
  const clock = makeClock();
  if (!raf) { clock.requestAnimationFrame = null; clock.cancelAnimationFrame = null; }
  return { ed: new ScoreEditor(makeContainer(), score, { width: 900, clock }), clock };
};
const small = () => ({ title: 'x', tracks: [{ name: 'G', showTablature: true, measures: [{ beats: [] }] }] });
const results = [];
const test = (name, fn) => { try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.message }); } };

test('BUG 2 (src/editor/settings.js:84-85, _applyModel): without requestAnimationFrame the render, and so the `change` handlers, run inside scheduleRender() before _sayKept() stores the message, so a `change` handler reads the previous call\'s lastMessage (with requestAnimationFrame it is current); expected: lastMessage equals detail.message inside the handler', () => {
  const { ed } = mk(small());
  let seen;
  ed.on('change', (e) => { if (e.source === 'edit') seen = [e.message, ed.lastMessage]; });
  ed.updateScore({ title: 'New' });
  if (seen[0] !== seen[1]) throw new Error(`detail.message "${seen[0]}" but lastMessage "${seen[1]}"`);
});

let fail = 0;
for (const r of results) { if (r.ok) console.log(`PASS ${r.name}`); else { fail++; console.log(`FAIL ${r.name}\n  ${r.msg}`); } }
console.log(fail ? `\n${fail} FAILED (known bugs)` : '\nALL PASSED');
process.exit(fail ? 1 : 0);
