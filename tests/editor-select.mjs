// 2.3.0 selection, range edits, fill / reflow and the clip format, model level: insertMeasuresAt, deleteColumns
// (against repeated single deletes), fixTiesIn, selection math and select commands, clearRange / removeRange /
// deleteSelectedColumns, fill, reflow, buildClip / parseClip security cases, applyPaste, B10 and E12 extensions.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-select.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { sanitizeScore } = await imp('src/sanitize.js');
const io = await imp('src/editor/model/io.js');
const M = await imp('src/editor/model/measures.js');
const TI = await imp('src/editor/model/ties.js');
const C = await imp('src/editor/model/cursor.js');

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
const v1 = (s, ti, mi) => s.tracks[ti].measures[mi].beats ?? s.tracks[ti].measures[mi].voices[0].beats;

// ---------- insertMeasuresAt / deleteColumns / fixTiesIn ----------
test('insertMeasuresAt: n empty measures in every track; before measure 1 the carried fields go first and pickup is dropped; insertMeasureAt is n = 1', () => {
  const s = model({ tracks: [
    tab([{ beats: [tn('whole', 1, 0, { tieStart: true })], timeSignature: { beats: 3, beatType: 4 }, pickup: true }, { beats: [tn('whole', 1, 0, { tieEnd: true })] }]),
    tab([{ beats: [nt('whole')] }], { name: 'B' }),
  ] });
  const r = M.insertMeasuresAt(s, 0, 3);
  eq(r.tracks[0].measures.map((m) => Object.keys(m).sort().join()), ['beats,timeSignature', 'beats', 'beats', 'beats', 'beats']);
  eq(r.tracks[0].measures[3].beats[0].notes[0], { string: 1, fret: 0, tieStart: true }, 'the tie inside the moved measures stays');
  eq(r.tracks[1].measures.length, 4);
  const mid = M.insertMeasuresAt(s, 1, 2);
  eq(mid.tracks[0].measures.length, 4);
  eq([mid.tracks[0].measures[0].beats[0].notes[0], mid.tracks[0].measures[3].beats[0].notes[0]], [{ string: 1, fret: 0 }, { string: 1, fret: 0 }], 'the tie across the new measures is broken');
  eq(mid.tracks[1].measures, [{ beats: [nt('whole')] }, { beats: [] }, { beats: [] }], 'a short track is padded up to the index first');
  eq(M.insertMeasureAt(s, 1), M.insertMeasuresAt(s, 1, 1));
  ok(sanitizeScore(r) === r && sanitizeScore(mid) === mid);
});
const DURS = ['whole', 'half', 'quarter', '8th'];
const TIMES = [{ beats: 3, beatType: 4 }, { beats: 6, beatType: 8 }, { beats: 4, beatType: 4 }];
function randomColumns(rnd) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const cols = 1 + Math.floor(rnd() * 6);
  return model({ tracks: Array.from({ length: 1 + Math.floor(rnd() * 3) }, (_, ti) => tab(Array.from({ length: ti === 0 ? cols : Math.floor(rnd() * (cols + 1)) }, () => {
    if (rnd() < 0.12) return null;
    const m = { beats: Array.from({ length: Math.floor(rnd() * 3) }, () => nt(pick(DURS), 1 + Math.floor(rnd() * 6), Math.floor(rnd() * 5))) };
    if (rnd() < 0.3) m.timeSignature = pick(TIMES);
    if (rnd() < 0.3) m.keySignature = Math.floor(rnd() * 5) - 2;
    if (rnd() < 0.25) m.clef = pick(['bass', 'treble', 'alto']);
    if (rnd() < 0.2) m.barline = 'double';
    if (rnd() < 0.15) m.pickup = true;
    return m;
  }), { name: `T${ti}` })) });
}
test('deleteColumns(a, b) equals deleting the measures one at a time (300 random scores with carried fields, holes, short tracks, every range including all columns)', () => {
  const rnd = mulberry32(23004);
  let all = 0;
  for (let i = 0; i < 300; i++) {
    const s = randomColumns(rnd);
    const n = s.tracks.reduce((x, t) => Math.max(x, t.measures.length), 1);
    const a = Math.floor(rnd() * n);
    const b = a + Math.floor(rnd() * (n - a));
    let one = s;
    for (let k = a; k <= b; k++) one = M.deleteMeasure(one, cur(0, a, 0)).score ?? one;
    const r = M.deleteColumns(s, a, b);
    eq(r, one, `run ${i}: ${a}..${b} of ${n}`);
    ok(sanitizeScore(r) === r);
    if (a === 0 && b === n - 1) all++;
  }
  ok(all > 20, `${all} all-column runs`);
});
test('deleteColumns: ties at the seam repaired; an already cleared single measure is no change (same score)', () => {
  const s = model({ tracks: [tab([{ beats: [tn('whole', 1, 0, { tieStart: true })] }, { beats: [tn('whole', 1, 0, { tieEnd: true })] }, { beats: [nt('whole')] }])] });
  const r = M.deleteColumns(s, 1, 1);
  eq([r.tracks[0].measures[0].beats[0].notes[0], r.tracks[0].measures[1].beats[0].notes[0]], [{ string: 1, fret: 0 }, { string: 1, fret: 0 }]);
  const empty = model({ tracks: [tab([{ beats: [] }])] });
  ok(M.deleteColumns(empty, 0, 0) === empty);
});
test('fixTiesIn: half ties in measures m0 - 1 .. m1 + 1 of one track are removed, pairs kept, graces skipped; other tracks and measures untouched', () => {
  const s = model({ tracks: [
    tab([
      { beats: [tn('half', 1, 0, { tieEnd: true }), tn('half', 1, 0, { tieStart: true })] },
      { beats: [grace(), tn('half', 1, 0, { tieEnd: true }), tn('half', 2, 0, { tieStart: true })] },
      { beats: [tn('whole', 1, 0, { tieEnd: true })] },
      { beats: [] },
      { beats: [tn('whole', 1, 0, { tieEnd: true, tieStart: true })] },
    ]),
    tab([{ beats: [tn('whole', 1, 0, { tieStart: true })] }], { name: 'B' }),
  ] });
  const r = TI.fixTiesIn(s, 0, 2, 2);
  eq(v1(r, 0, 0)[0].notes[0], { string: 1, fret: 0, tieEnd: true }, 'measure 0 is outside m0 - 1');
  eq(v1(r, 0, 1)[1].notes[0], { string: 1, fret: 0, tieEnd: true }, 'pair across the barline kept (grace skipped)');
  eq(v1(r, 0, 1)[2].notes[0], { string: 2, fret: 0 }, 'tieStart with no partner on string 2');
  eq(v1(r, 0, 2)[0].notes[0], { string: 1, fret: 0 }, 'tieEnd with no partner');
  eq(v1(r, 0, 4)[0].notes[0], { string: 1, fret: 0, tieEnd: true, tieStart: true }, 'measure 4 is past m1 + 1');
  ok(r.tracks[1] === s.tracks[1]);
  ok(TI.fixTiesIn(r, 0, 0, 4) !== r, 'a full pass also repairs measure 0 and 4');
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-select: ${r.name}`);
    else { fail++; console.log(`FAIL editor-select: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
