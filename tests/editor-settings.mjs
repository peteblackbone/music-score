// 2.2.0 editor settings, model level: validators, INSTRUMENTS / TUNINGS, score, tempo, tuning, track
// and measure operations, getMeasureSettings, cursorInfo additions, B10 / E12 / F1 extensions.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-settings.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { sanitizeScore } = await imp('src/sanitize.js');
const { EDITOR_LIMITS } = await imp('src/editor/model/limits.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };

// ---------- LIMITS ----------
test('LIMITS: 2.2 caps (textChars, longTextChars, timeSignatureBeats, frozen beatTypes) inside the limits sanitize keeps', () => {
  const L = EDITOR_LIMITS;
  eq([L.textChars, L.longTextChars, L.timeSignatureBeats, L.beatTypes], [200, 2000, 32, [1, 2, 4, 8, 16, 32]]);
  ok(Object.isFrozen(L) && Object.isFrozen(L.beatTypes));
  for (const beatType of L.beatTypes) {
    const s = { tracks: [{ timeSignature: { beats: L.timeSignatureBeats, beatType }, measures: [] }] };
    ok(sanitizeScore(s) === s, `${L.timeSignatureBeats}/${beatType} is kept by sanitize`);
  }
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-settings: ${r.name}`);
    else { fail++; console.log(`FAIL editor-settings: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
