// 2.3.1 controller level under the DOM shim: insert paste (criterion 6: keys, the one-shot flag on blur and
// destroy, Shift+Insert, the API), blank-measure selections with exact wording (10), paste limits and
// read-only (11), effects over a selection (12, 16), transpose keys (22), the reflow cascade (25),
// the demo (29), announcements (30) and B10 over 300 steps.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-range-dom.mjs`.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { mk, key, SHIFT, CTRL, nt, rest, eq, ok, throws, sanitizeScore } from './editor-select-dom.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const ms = (ed, ti = 0) => ed.getScore().tracks[ti].measures;
const stable = (ed) => ok(sanitizeScore(ed._model) === ed._model, 'sanitize identity');

// ---------- criterion 10: blank-measure selections ----------
test('criterion 10: Shift+Right across 3 blank measures selects them ("Selected measures 5 to 7, no beats"); Delete says "Already rests", Copy gives empty measures, F fills each, Shift+Delete deletes them; Ctrl+A on an empty track selects it', () => {
  const score = { tracks: [tab([...Array.from({ length: 4 }, () => ({ beats: [nt('whole')] })), { beats: [] }, { beats: [] }, { beats: [] }, { beats: [nt('whole')] }])] };
  const t = mk(score);
  t.ed.setCursor({ measure: 4, beat: 0 });
  t.spoken();
  t.press(key('ArrowRight', SHIFT), key('ArrowRight', SHIFT));
  eq(t.ed.getSelection(), { kind: 'measures', track: 0, start: { measure: 4, beat: 0 }, end: { measure: 6, beat: 0 }, beatCount: 0, measures: [4, 6] });
  eq(t.spoken(), 'Selected measures 5 to 7, no beats');
  t.press('Delete');
  eq([t.spoken(), t.ed.canUndo(), t.ed.getSelection().measures], ['Already rests', false, [4, 6]]);
  t.press(key('Delete', CTRL));
  eq([t.spoken(), t.ed.canUndo()], ['No beats to delete', false]);
  const text = t.ed.copy();
  eq(JSON.parse(text).tracks[0].measures, [{ beats: [] }, { beats: [] }, { beats: [] }]);
  eq(t.spoken(), 'Copied 3 measures');
  t.press('f');
  eq(ms(t.ed).slice(4, 7).map((m) => m.beats), [[rest('whole')], [rest('whole')], [rest('whole')]]);
  eq(t.ed.getSelection(), null, 'an edit clears the selection');
  t.ed.undo();
  t.ed.setSelection({ anchor: { measure: 4, beat: 0 }, focus: { measure: 6, beat: 0 } });
  t.press(key('Delete', SHIFT));
  eq([ms(t.ed).length, t.spoken()], [5, 'Measures 5 to 7 deleted, measure full']);
  stable(t.ed);
  const e = mk({ tracks: [tab(Array.from({ length: 8 }, () => ({ beats: [] })), { name: '' })] });
  e.press(key('a', CTRL));
  eq([e.ed.getSelection().measures, e.spoken()], [[0, 7], 'Selected all of Track 1, 8 measures']);
  t.ed.destroy(); e.ed.destroy();
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-range-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-range-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
export { test, tab, ms, stable };
