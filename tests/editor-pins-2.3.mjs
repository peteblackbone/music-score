// 2.3.0 characterization pins, recorded on 2.2.0 before any 2.3 change: the per-track tempoAt, the tempo
// mark removeTrack loses, the exact insertMeasureAt(score, 0) output, and the renderer's tempo changes
// (the rule 2.3 makes the editor follow). The 2.3 tempo commit inverts (a) and (b) on purpose.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-pins-2.3.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const io = await imp('src/editor/model/io.js');
const SC = await imp('src/editor/model/settings/score.js');
const TS = await imp('src/editor/model/settings/tracks.js');
const M = await imp('src/editor/model/measures.js');
const { describe } = await imp('src/editor/announce.js');
const { makeContainer } = await import('./dom-shim.mjs');
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };

const model = (s) => io.parseInput(s);
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });

/** Texts of every element with class `cls` under `n`, in document order. */
export function textsOf(n, cls, out = []) {
  if ((n.getAttribute?.('class') || '').split(' ').includes(cls)) out.push(n.textContent);
  for (const c of n.children || []) textsOf(c, cls, out);
  return out;
}
/** The '= N' texts of the tempo changes the renderer draws for `score`, in document order. */
export function drawnTempos(score, width = 900) {
  const box = makeContainer();
  new MusicScoreRenderer(box, JSON.parse(JSON.stringify(score)), { width }).render();
  return textsOf(box.children[0], 'tempo-change-bpm');
}

// (a) tempoAt reads the cursor track only. Inverted on purpose in 2.3: tempoAt is score-wide.
test('pin (a), inverted in 2.3: tempoAt is score-wide: a mark on another track is in force; on the slot `here` is false', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('quarter', 1, 0, { tempo: 90 }), nt('quarter')] }, { beats: [nt('whole')] }]),
    tab([{ beats: [nt('quarter'), nt('quarter')] }, { beats: [nt('half')] }], { name: 'B' }),
  ] });
  eq(SC.tempoAt(s, cur(1, 0, 0)), { bpm: 90, unit: 'quarter', dots: 0, text: null, here: true }, 'mark on track 0, cursor on track 1 at its onset');
  eq(SC.tempoAt(s, cur(1, 1, 0)), { bpm: 90, unit: 'quarter', dots: 0, text: null, here: false });
  eq(SC.tempoAt(s, cur(0, 0, 2)), { bpm: 90, unit: 'quarter', dots: 0, text: null, here: false }, 'slot');
  eq(SC.tempoAt(s, cur(0, 0, 0)).here, true);
});

// (b) removeTrack drops a mark that only the removed track has. Inverted on purpose in 2.3: the mark moves to track 1.
test('pin (b), inverted in 2.3: removeTrack(0) moves a tempo mark that exists only on track 0 to track 1 (a beat at that onset); nothing is announced for a moved mark', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('quarter', 1, 0, { tempo: 90 }), nt('half')] }]),
    tab([{ beats: [nt('quarter'), nt('half')] }], { name: 'B' }),
  ] });
  const r = TS.removeTrack(s, cur(0, 0, 0), 0);
  eq(r.score.tracks[0].measures[0].beats[0].tempo, 90, 'moved to the remaining track');
  eq(describe(r.announce), 'Track 1 Gtr removed');
});

// (c) insertMeasureAt(score, 0)
test('pin (c): insertMeasureAt(score, 0) exact output with and without CARRY fields; identity of untouched measures', () => {
  const plain = model({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [nt('whole')], barline: 'double' }])] });
  const r1 = M.insertMeasureAt(plain, 0);
  eq(r1.tracks[0].measures, [{ beats: [] }, { beats: [nt('whole')] }, { beats: [nt('whole')], barline: 'double' }]);
  ok(r1.tracks[0].measures[1] === plain.tracks[0].measures[0], 'plain splice keeps identity');
  const carry = model({ tracks: [
    tab([{ beats: [nt('whole')], timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, clef: 'bass', barline: 'double' }, { beats: [] }]),
    tab([{ beats: [nt('whole')] }], { name: 'B' }),
  ] });
  const r2 = M.insertMeasureAt(carry, 0);
  eq(r2.tracks[0].measures, [
    { timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, clef: 'bass', beats: [] },
    { beats: [nt('whole')], barline: 'double' },
    { beats: [] },
  ]);
  eq(r2.tracks[1].measures, [{ beats: [] }, { beats: [nt('whole')] }]);
  ok(r2.tracks[0].measures[2] === carry.tracks[0].measures[1] && r2.tracks[1].measures[1] === carry.tracks[1].measures[0]);
});

// (d) the renderer's tempo changes
test('pin (d): renderer tempoChanges: voice-1 main beats of every track, hidden ones included; at one (measure, onset) the lowest track wins; graces and voice 2 ignored', () => {
  const s = { tracks: [
    tab([{ beats: [nt('half'), nt('half', 1, 0, { tempo: 70 })] }, { beats: [nt('whole')] }]),
    tab([{ beats: [nt('half', 1, 0, { tempo: 100 }), nt('half', 1, 0, { tempo: 80 })] }, { beats: [{ type: 'grace', duration: '16th', notes: [{ string: 1, fret: 1 }], tempo: 55 }, nt('whole', 1, 0, { tempo: 60 })] }], { name: 'B' }),
    { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [nt('whole')] }, { voices: [{ beats: [nt('half'), nt('half', 1, 0, { tempo: 140 })] }, { beats: [nt('whole', 1, 0, { tempo: 150 })] }] }] },
  ] };
  eq(drawnTempos(s), ['= 100', '= 70', '= 60', '= 140']);
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-pins-2.3: ${r.name}`);
    else { fail++; console.log(`FAIL editor-pins-2.3: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
