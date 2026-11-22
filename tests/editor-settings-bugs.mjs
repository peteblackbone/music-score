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

test('BUG 1 (src/editor/settings.js:60): the size check measures the model JSON, but getScore() adds `"schemaVersion":1` (18 chars), so a score the editor accepts at the limit cannot be reloaded from its own getScore(); expected: a settings call that succeeds leaves a score that loadScore(getScore()) accepts', () => {
  const L = ScoreEditor.LIMITS.jsonChars;
  const len0 = JSON.stringify(mk({ ...small(), pad: '' }).ed._model).length;
  const target = L - 49; // a title of 50 characters instead of 1 adds 49
  const { ed } = mk({ ...small(), pad: 'p'.repeat(target - len0) });
  if (JSON.stringify(ed._model).length !== target) throw new Error('fixture size is off');
  if (ed.updateScore({ title: 'x'.repeat(50) }) !== true) throw new Error('the call was refused (fine: then the bug is fixed)');
  if (JSON.stringify(ed._model).length !== L) throw new Error('fixture size is off');
  ed.loadScore(ed.getScore()); // throws "Score too large: 5242898 characters of JSON (limit 5242880)"
});

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
