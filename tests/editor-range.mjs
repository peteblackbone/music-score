// 2.3.1 model level: blank-measure selections (D-A9), paste replace / insert (criteria 1-5, 7-9, 11),
// effects over a selection (12-16, 21), transpose (18-21), reflow split and cascade (23-27, D-D2),
// Ctrl+Shift+Home / End (28), B10 over the new operations and E12.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-range.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { sanitizeScore } = await imp('src/sanitize.js');
const io = await imp('src/editor/model/io.js');
const C = await imp('src/editor/model/cursor.js');
const SEL = await imp('src/editor/model/selection.js');
const CMD = await imp('src/editor/model/commands.js');
const CL = await imp('src/editor/model/clip.js');
const { describe } = await imp('src/editor/announce.js');
const { EDITOR_LIMITS: L } = await imp('src/editor/model/limits.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const model = (s) => io.parseInput(s);
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tn = (duration, string, fret, flags = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const grace = (string = 2, fret = 3) => ({ type: 'grace', duration: '16th', notes: [{ string, fret }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const st = () => ({ duration: 'quarter', dots: 0, digit: null });
const P = (measure, beat) => ({ measure, beat });
const v1 = (s, ti, mi) => s.tracks[ti].measures[mi].beats ?? s.tracks[ti].measures[mi].voices[0].beats;
const ctx = (sel = null) => ({ maxFret: 24, now: 0, twoDigitDelayMs: 800, allowAppend: true, selection: sel });
const run = (name, s, c, sel = null, arg) => CMD.run(name, s, c, st(), ctx(sel), arg);
const said = (r) => describe(r.announce);
const clipText = (kind, content, extra = {}) => JSON.stringify({ type: 'music-score-clip', version: 1, kind, tracks: [{ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], [kind]: content, ...extra }] });
const parse = (t) => CL.parseClip(t).clip;
const same = (s) => sanitizeScore(s) === s;

// ---------- D-A9: blank-measure selections ----------
const blank3 = () => model({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [] }, { beats: [] }, { beats: [] }, { beats: [nt('half')] }]), tab([{ beats: [nt('whole', 2, 2)] }], { name: 'B' })] });
test('D-A9: a range over blank measures is a measures selection with no beats; only whole slices are kept; a zero-beat range inside a non-blank measure is null', () => {
  const s = blank3();
  const sel = SEL.selectionRange(s, 0, P(1, 0), P(3, 0));
  eq(sel.info, { kind: 'measures', track: 0, start: { measure: 1, beat: 0 }, end: { measure: 3, beat: 0 }, beatCount: 0, measures: [1, 3] });
  eq(sel.slices.map((x) => x.measure), [1, 2, 3]);
  eq(describe(SEL.selectionWords(s, sel)), 'Selected measures 2 to 4, no beats');
  eq(describe(SEL.selectionWords(s, SEL.selectionRange(s, 0, P(2, 0), P(2, 0)))), 'Selected measure 3, no beats');
  const tail = SEL.selectionRange(s, 0, P(3, 0), P(4, 1));
  eq([tail.info.kind, tail.info.beatCount, tail.info.measures], ['measures', 1, [3, 4]], 'with a main beat in it the 2.3.0 path applies');
  eq(SEL.selectionRange(s, 0, P(4, 1), P(4, 1)), null, 'the slot of a non-blank measure');
  const t = model({ tracks: [tab([{ beats: [nt('half')] }, { beats: [] }])] });
  const part = SEL.selectionRange(t, 0, P(0, 1), P(1, 0));
  eq([part.info.measures, part.slices.length], [[1, 1], 1], 'the slot slice of measure 1 is dropped, the blank measure 2 kept');
  ok(SEL.selectionRange(blank3(), 1, P(1, 0), P(2, 0)).info.beatCount === 0, 'columns past a short track are blank');
});
test('D-A9 / criterion 10: on a blank selection Delete says "Already rests", Ctrl+Delete "No beats to delete", Shift+Delete deletes the columns, Copy gives empty measures, F fills each measure', () => {
  const s = blank3();
  const sel = SEL.selectionRange(s, 0, P(1, 0), P(3, 0));
  const del = run('deleteNote', s, cur(0, 3, 0), sel);
  eq([del.changed, said(del)], [false, 'Already rests']);
  const rm = run('deleteBeat', s, cur(0, 3, 0), sel);
  eq([rm.changed, said(rm)], [false, 'No beats to delete']);
  const cols = run('deleteMeasure', s, cur(0, 3, 0), sel);
  eq([cols.score.tracks[0].measures.length, said(cols)], [2, 'Measures 2 to 4 deleted']);
  const clip = CL.buildClip(s, sel);
  eq([clip.kind, clip.count, JSON.parse(clip.text).tracks[0].measures], ['measures', 3, [{ beats: [] }, { beats: [] }, { beats: [] }]]);
  const f = run('fill', s, cur(0, 3, 0), sel);
  eq([v1(f.score, 0, 1), v1(f.score, 0, 3), said(f)], [[rest('whole')], [rest('whole')], 'Filled 3 measures, 3 rests added']);
  ok(same(cols.score) && same(f.score));
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-range: ${r.name}`);
    else { fail++; console.log(`FAIL editor-range: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
export { model, nt, tn, rest, grace, tab, cur, st, P, v1, ctx, run, said, clipText, parse, same, eq, ok, mulberry32 };
