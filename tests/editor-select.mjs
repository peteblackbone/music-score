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

// ---------- selection math and select commands ----------
const SEL = await imp('src/editor/model/selection.js');
const CMD = await imp('src/editor/model/commands.js');
const { describe } = await imp('src/editor/announce.js');
const selFixture = () => model({ tracks: [
  tab([
    { beats: [nt('quarter'), grace(), nt('quarter'), nt('half')] },
    { beats: [nt('quarter'), nt('quarter'), grace()] },
    { beats: [] },
    { beats: [nt('whole')] },
  ]),
  tab([{ beats: [nt('whole')] }], { name: 'Short' }),
] });
const P = (measure, beat) => ({ measure, beat });
test('rangeSlices: both ends inclusive in either order; graces go with their main beat; a range to the end of a measure takes its trailing graces; a start on the slot takes nothing there', () => {
  const s = selFixture();
  eq(SEL.rangeSlices(s, 0, P(0, 2), P(0, 2)), [{ measure: 0, from: 1, to: 3, first: false, last: false }], 'one beat with its grace');
  eq(SEL.rangeSlices(s, 0, P(1, 1), P(0, 2)), [
    { measure: 0, from: 1, to: 4, first: false, last: true },
    { measure: 1, from: 0, to: 2, first: true, last: false },
  ], 'reverse order; the last main beat of a full measure takes everything after it');
  eq(SEL.rangeSlices(s, 0, P(1, 3), P(3, 0)), [
    { measure: 1, from: 3, to: 3, first: false, last: true },
    { measure: 2, from: 0, to: 0, first: true, last: true },
    { measure: 3, from: 0, to: 1, first: true, last: true },
  ], 'from the slot: nothing in that measure (its trailing grace stays); an empty measure is whole');
  eq(SEL.rangeSlices(s, 0, P(1, 0), P(1, 3)), [{ measure: 1, from: 0, to: 3, first: true, last: true }], 'to the slot: trailing graces included');
  eq(SEL.rangeSlices(s, 1, P(0, 0), P(2, 0)).map((x) => [x.from, x.to, x.first, x.last]), [[0, 1, true, true], [0, 0, true, true], [0, 0, true, true]], 'measures past a short track are empty (slot)');
});
test('selectionRange: info shape, kinds, beat counts, null without a main beat; selectionInfo copies', () => {
  const s = selFixture();
  const a = SEL.selectionRange(s, 0, P(0, 2), P(1, 1));
  eq(a.info, { kind: 'beats', track: 0, start: { measure: 0, beat: 2 }, end: { measure: 1, beat: 1 }, beatCount: 4, measures: [0, 1] });
  const m = SEL.selectionRange(s, 0, P(0, 0), P(3, 0));
  eq([m.info.kind, m.info.beatCount, m.info.measures], ['measures', 6, [0, 3]]);
  eq(SEL.selectionRange(s, 0, P(1, 3), P(2, 0)).info, { kind: 'measures', track: 0, start: { measure: 2, beat: 0 }, end: { measure: 2, beat: 0 }, beatCount: 0, measures: [2, 2] }, '2.3.1: slot to empty measure: the empty measure, no beats');
  eq(SEL.selectionRange(s, 0, P(1, 3), P(1, 3)), null, 'a zero-beat range inside a non-blank measure is still null');
  eq(SEL.selectionRange(s, 0, P(2, 0), P(3, 0)).info.measures, [2, 3], 'a measures range keeps its first measure even with no beat in it');
  eq(SEL.selectionRange(s, 0, P(1, 3), P(3, 0)).info.measures, [3, 3], 'a beats range spans its selected beats only');
  const info = SEL.selectionInfo(a);
  info.start.measure = 9; info.measures[0] = 9;
  eq(a.info.start.measure, 0, 'a copy');
  eq(SEL.selectionInfo(null), null);
});
test('select commands: Left / Right like the moves (Right never appends), measure start / end, previous / next measure boundary, Select all to the last position', () => {
  const s = selFixture();
  const go = (name, c) => CMD.run(name, s, c, st(), { allowAppend: true });
  eq(go('selectRight', cur(0, 3, 0)), { score: s, cursor: cur(0, 3, 0), state: st(), changed: false, moved: false, announce: { id: 'endOfScore' }, coalesce: false });
  eq(go('selectRight', cur(0, 0, 0)).cursor, cur(0, 0, 2), 'over the grace');
  eq(go('selectLeft', cur(0, 1, 0)).cursor, cur(0, 0, 3));
  eq([go('selectMeasureStart', cur(0, 0, 3)).cursor.beat, go('selectMeasureEnd', cur(0, 1, 0)).cursor.beat], [0, 3]);
  eq(go('selectPrevMeasure', cur(0, 1, 1)).cursor, cur(0, 1, 0));
  eq(go('selectPrevMeasure', cur(0, 1, 0)).cursor, cur(0, 0, 0));
  eq(go('selectPrevMeasure', cur(0, 0, 0)).announce, { id: 'startOfScore' });
  eq(go('selectNextMeasure', cur(0, 0, 0)).cursor, cur(0, 0, 3));
  eq(go('selectNextMeasure', cur(0, 0, 3)).cursor, cur(0, 1, 3), 'the next measure\'s last position is its slot');
  eq(go('selectNextMeasure', cur(0, 3, 0)).announce, { id: 'endOfScore' });
  eq(go('selectAll', cur(0, 1, 1)).cursor, cur(0, 3, 0));
  eq(SEL.startOf(s, cur(0, 2, 0)), P(0, 0));
  ok(Object.entries(CMD.COMMANDS).filter(([, d]) => d.kind === 'select').length === 7 && CMD.COMMANDS.selectAll.fromStart);
});
test('selection words: across measures, in one measure, one beat, measures (one / several), Select all (with and without a name)', () => {
  const s = selFixture();
  const say = (a, f, all) => describe(SEL.selectionWords(s, SEL.selectionRange(s, 0, a, f), all));
  eq(say(P(0, 2), P(1, 1)), 'Selected measure 1 beat 2 to measure 2 beat 2, 4 beats');
  eq(say(P(0, 0), P(0, 2)), 'Selected measure 1 beat 1 to beat 2, 2 beats');
  eq(say(P(0, 3), P(0, 3)), 'Selected measure 1 beat 3, 1 beat');
  eq(say(P(3, 0), P(3, 0)), 'Selected measure 4, 1 beat');
  eq(say(P(0, 0), P(1, 3)), 'Selected measures 1 to 2, 5 beats');
  eq(say(P(0, 0), P(3, 0), true), 'Selected all of Track 1 Gtr, 4 measures');
  const anon = model({ tracks: [{ showTablature: true, measures: [{ beats: [nt('whole')] }] }] });
  eq(describe(SEL.selectionWords(anon, SEL.selectionRange(anon, 0, P(0, 0), P(0, 0)), true)), 'Selected all of Track 1, 1 measure');
});

// ---------- range edits ----------
const RE = await imp('src/editor/model/rangeEdit.js');
const rangeFixture = () => model({ tracks: [
  tab([
    { beats: [tn('quarter', 1, 1, { tieStart: true }), tn('quarter', 1, 1, { tieEnd: true }), grace(), nt('quarter', 2, 2, { tempo: 80, palmMute: true, zz: 1 }), rest('quarter')] },
    { beats: [tn('half', 3, 3, { tieStart: true }), tn('half', 3, 3, { tieEnd: true })] },
    { beats: [nt('whole', 1, 0, { tempo: 100 })] },
  ]),
  tab([{ beats: [nt('whole')] }, { beats: [nt('whole', 1, 0, { tempo: 60 })] }], { name: 'B' }),
] });
const run = (name, s, c, sel) => CMD.run(name, s, c, st(), { selection: sel, allowAppend: true });
test('clearRange (Delete with a selection): graces removed, notes become rests keeping length, effects, unknown fields and tempo; rests untouched; edge ties repaired; cursor on the first beat; one result', () => {
  const s = rangeFixture();
  const sel = SEL.selectionRange(s, 0, P(0, 1), P(1, 0));
  const r = run('deleteNote', s, cur(0, 1, 0), sel);
  eq(v1(r.score, 0, 0), [tn('quarter', 1, 1), rest('quarter'), rest('quarter', { tempo: 80, palmMute: true, zz: 1 }), rest('quarter')]);
  eq(v1(r.score, 0, 1), [rest('half'), tn('half', 3, 3)], 'the tie into the cleared beat lost both ends');
  eq(r.cursor, cur(0, 0, 1));
  eq(describe(r.announce), '4 beats changed to rests');
  eq(CMD.undoLabel('deleteNote', r.announce), 'clear beats');
  ok(sanitizeScore(r.score) === r.score);
  const rests = model({ tracks: [tab([{ beats: [rest('half'), rest('half')] }])] });
  ok(run('deleteNote', rests, cur(0, 0, 0), SEL.selectionRange(rests, 0, P(0, 0), P(0, 1))).changed === false, 'only rests: no change');
  eq(describe(run('deleteNote', rests, cur(0, 0, 0), SEL.selectionRange(rests, 0, P(0, 0), P(0, 0))).announce), 'Already rests');
});
test('eachSlice (exported for 2.3.1): maps each slice\'s beats on one track, repairs ties, keeps the score when no slice has beats', () => {
  const s = rangeFixture();
  const sel = SEL.selectionRange(s, 0, P(0, 3), P(1, 0));
  const out = RE.eachSlice(s, 0, sel.slices, (part) => part.map((b) => ({ ...b, zz: 2 })));
  eq([v1(out, 0, 0).map((b) => b.zz ?? 0), v1(out, 0, 1).map((b) => b.zz ?? 0)], [[0, 0, 2, 2, 2], [2, 0]]);
  ok(out.tracks[1] === s.tracks[1] && sanitizeScore(out) === out);
  ok(RE.eachSlice(s, 0, [{ measure: 0, from: 2, to: 2 }], () => []) === s);
});
test('removeRange (Ctrl+Delete with a selection): beats and graces spliced out across measures, ties repaired, drawn tempo marks counted, cursor on what follows', () => {
  const s = rangeFixture();
  const sel = SEL.selectionRange(s, 0, P(0, 3), P(2, 0));
  const r = run('deleteBeat', s, cur(0, 2, 0), sel);
  eq(v1(r.score, 0, 0), [tn('quarter', 1, 1, { tieStart: true }), tn('quarter', 1, 1, { tieEnd: true })], 'grace before beat 3 went with it');
  eq([v1(r.score, 0, 1), v1(r.score, 0, 2)], [[], []]);
  eq(describe(r.announce), '5 beats deleted, 2 tempo marks removed');
  eq(CMD.undoLabel('deleteBeat', r.announce), 'delete beats');
  eq(r.cursor, cur(0, 0, 2), 'the slot after the remaining beats');
  ok(sanitizeScore(r.score) === r.score);
  const shadow = model({ tracks: [tab([{ beats: [nt('whole', 1, 0, { tempo: 50 })] }]), tab([{ beats: [nt('whole', 1, 0, { tempo: 70 })] }], { name: 'B' })] });
  eq(describe(run('deleteBeat', shadow, cur(1, 0, 0), SEL.selectionRange(shadow, 1, P(0, 0), P(0, 0))).announce), '1 beat deleted', 'a shadowed (undrawn) mark is not counted');
});
test('deleteSelectedColumns (Shift+Delete): refused for a beats selection; deletes whole measures from every track with the carried fields; every measure leaves one; drawn tempo marks counted', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole')] }, { beats: [nt('whole', 1, 0, { tempo: 90 })], timeSignature: { beats: 3, beatType: 4 } }, { beats: [nt('half')] }, { beats: [nt('whole')] }]),
    tab([{ beats: [nt('whole')] }, { beats: [nt('whole', 1, 0, { tempo: 91 })] }], { name: 'B' }),
  ] });
  const beats = SEL.selectionRange(s, 0, P(1, 0), P(2, 0));
  eq(beats.info.kind, 'beats');
  const no = run('deleteMeasure', s, cur(0, 2, 0), beats);
  eq([no.changed, describe(no.announce)], [false, 'Select whole measures first']);
  const sel = SEL.selectionRange(s, 0, P(1, 0), P(2, 1));
  const r = run('deleteMeasure', s, cur(0, 2, 1), sel);
  eq(r.score.tracks[0].measures, [{ beats: [nt('whole')] }, { beats: [nt('whole')], timeSignature: { beats: 3, beatType: 4 } }]);
  eq(r.score.tracks[1].measures, [{ beats: [nt('whole')] }]);
  eq(describe(r.announce), 'Measures 2 to 3 deleted, 1 tempo mark removed');
  eq(CMD.undoLabel('deleteMeasure', r.announce), 'delete measures');
  eq(r.cursor, cur(0, 1, 0), 'the measure after the range');
  const all = run('deleteMeasure', s, cur(0, 3, 0), SEL.selectionRange(s, 0, P(0, 0), P(3, 0)));
  eq(describe(all.announce), 'All measures deleted, 1 empty measure left, 1 tempo mark removed');
  eq(all.score.tracks.map((t) => t.measures), [[{ timeSignature: { beats: 3, beatType: 4 }, beats: [] }], []]);
  eq(describe(run('deleteMeasure', s, cur(0, 3, 0), SEL.selectionRange(s, 0, P(3, 0), P(3, 0))).announce), 'Measure 4 deleted');
  eq(CMD.undoLabel('deleteMeasure'), 'delete measure', 'without a selection: the 2.0 label');
});

// ---------- fill and reflow ----------
const RF = await imp('src/editor/model/reflow.js');
const { EDITOR_LIMITS } = await imp('src/editor/model/limits.js');
const one = (beats, extra = {}) => model({ ...extra, tracks: [tab([{ beats }, { beats: [nt('whole')] }])] });
const loc0 = { track: 0, measure: 0 };
test('fillPlan: largest plain duration that fits and divides the onset (4/4 dotted quarter -> eighth, half); empty, 3/4, 6/8; full, overfull, pickup, unfinished triplet refused', () => {
  eq(RF.fillPlan(one([nt('quarter', 1, 0, { dots: 1 })]), loc0), { rests: ['8th', 'half'] });
  eq(RF.fillPlan(one([]), loc0), { rests: ['whole'] });
  eq(RF.fillPlan(one([], { timeSignature: { beats: 3, beatType: 4 } }), loc0), { rests: ['half', 'quarter'] });
  eq(RF.fillPlan(one([nt('quarter')], { timeSignature: { beats: 6, beatType: 8 } }), loc0), { rests: ['quarter', 'quarter'] });
  eq(RF.fillPlan(one([nt('16th'), nt('quarter')]), loc0), { rests: ['16th', '8th', 'half'] });
  eq(RF.fillPlan(one([nt('whole')]), loc0), { refused: 'fillFull' });
  eq(RF.fillPlan(one([nt('whole'), nt('8th')]), loc0), { refused: 'fillOver' });
  eq(RF.fillPlan(one([nt('8th', 1, 0, { tuplet: 3 })]), loc0), { refused: 'fillTuplet' });
  eq(RF.fillPlan(one([nt('8th', 1, 0, { tuplet: 3 }), nt('8th', 1, 0, { tuplet: 3 }), nt('8th', 1, 0, { tuplet: 3 })]), loc0), { rests: ['quarter', 'half'] }, 'a finished triplet is on the grid');
  const p = model({ tracks: [tab([{ beats: [nt('quarter')], pickup: true }, { beats: [] }])] });
  eq([RF.fillPlan(p, loc0), RF.fillPlan(p, { track: 0, measure: 1 })], [{ refused: 'fillPickup' }, { rests: ['whole'] }]);
});
test('fill: rests appended after trailing graces, the seam repaired (a tie into the next measure is broken), one result; the 256-beat cap refuses', () => {
  const s = model({ tracks: [tab([{ beats: [tn('half', 1, 0, { tieStart: true }), grace()] }, { beats: [tn('whole', 1, 0, { tieEnd: true })] }])] });
  const r = run('fill', s, cur(0, 0, 2), null);
  eq(v1(r.score, 0, 0), [tn('half', 1, 0), grace(), rest('half')]);
  eq(v1(r.score, 0, 1)[0].notes[0], { string: 1, fret: 0 });
  eq(describe(r.announce), 'Added 1 rest: half');
  eq(CMD.undoLabel('fill'), 'fill');
  ok(sanitizeScore(r.score) === r.score);
  const big = model({ timeSignature: { beats: 32, beatType: 4 }, tracks: [tab([{ beats: Array.from({ length: 255 }, () => nt('64th')) }])] });
  eq(describe(run('fill', big, cur(0, 0, 0), null).announce), 'The score would be too large');
  eq(describe(run('fill', one([nt('8th', 1, 0, { tuplet: 3 })]), cur(0, 0, 0), null).announce), 'Finish the tuplet first');
});
test('fill with a selection: each measure all or nothing, refused ones skipped and counted; nothing fillable is refused', () => {
  const s = model({ tracks: [tab([{ beats: [nt('half')] }, { beats: [nt('whole')] }, { beats: [nt('8th', 1, 0, { tuplet: 3 })] }, { beats: [nt('quarter')] }])] });
  const sel = SEL.selectionRange(s, 0, P(0, 0), P(3, 1));
  const r = run('fill', s, cur(0, 3, 1), sel);
  eq(describe(r.announce), 'Filled 2 of 4 measures, 3 rests added');
  eq([v1(r.score, 0, 0).length, v1(r.score, 0, 1).length, v1(r.score, 0, 2).length, v1(r.score, 0, 3).length], [2, 1, 1, 3]);
  const s2 = model({ tracks: [tab([{ beats: [] }, { beats: [nt('half')] }])] });
  eq(describe(run('fill', s2, cur(0, 1, 0), SEL.selectionRange(s2, 0, P(0, 0), P(1, 1))).announce), 'Filled 2 measures, 2 rests added');
  const full = model({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }])] });
  const no = run('fill', full, cur(0, 1, 0), SEL.selectionRange(full, 0, P(0, 0), P(1, 0)));
  eq([no.changed, describe(no.announce)], [false, 'Nothing to fill']);
  eq(describe(run('fill', full, cur(0, 0, 0), SEL.selectionRange(full, 0, P(0, 0), P(0, 0))).announce), 'Measure already full', 'one measure: the refusal');
});
test('reflow: beats at or past the barline (with their graces) move to the start of the next measure; the last measure adds one; a crossing beat stays; cursor follows its beat; ties repaired; tempo stays; nothing to move', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('half'), nt('half', 1, 0, { notes: [{ string: 1, fret: 0, tieStart: true }] }), grace(), nt('quarter', 1, 0, { tempo: 99, notes: [{ string: 1, fret: 0, tieEnd: true }] }), nt('8th')] }, { beats: [nt('half')] }]),
    tab([{ beats: [nt('whole')] }], { name: 'B' }),
  ] });
  const r = run('reflow', s, cur(0, 0, 3), null);
  eq(v1(r.score, 0, 0).length, 2);
  eq(v1(r.score, 0, 1).map((b) => b.type + b.duration), ['grace16th', 'notequarter', 'note8th', 'notehalf']);
  eq([v1(r.score, 0, 0)[1].notes[0].tieStart, v1(r.score, 0, 1)[1].notes[0].tieEnd], [true, true], 'the tie still pairs across the new barline (the grace is skipped)');
  eq(v1(r.score, 0, 1)[1].tempo, 99);
  eq(r.cursor, cur(0, 1, 1), 'the cursor follows its beat');
  eq(describe(r.announce), 'Moved 2 beats to measure 2');
  eq(CMD.undoLabel('reflow'), 'reflow');
  ok(sanitizeScore(r.score) === r.score);
  const last = model({ tracks: [tab([{ beats: [nt('whole'), nt('quarter')] }]), tab([{ beats: [] }], { name: 'B' })] });
  const r2 = run('reflow', last, cur(0, 0, 0), null);
  eq([r2.score.tracks[0].measures.length, r2.score.tracks[1].measures.length, describe(r2.announce)], [2, 2, 'Measure 2 added, moved 1 beat to it']);
  eq(r2.cursor, cur(0, 0, 0));
  const cross = model({ tracks: [tab([{ beats: [nt('half'), nt('half', 1, 0, { dots: 1 }), nt('quarter')] }])] });
  eq(describe(run('reflow', cross, cur(0, 0, 0), null).announce), 'Measure 2 added, moved 1 beat to it, beat 2 crosses the barline and stays');
  const only = model({ tracks: [tab([{ beats: [nt('half'), nt('half', 1, 0, { dots: 1 })] }, { beats: [] }])] });
  eq(describe(run('reflow', only, cur(0, 0, 0), null).announce), 'Beat 2 crosses the barline and stays');
  eq(describe(run('reflow', one([nt('half')]), cur(0, 0, 0), null).announce), 'Nothing to reflow');
});
test('reflow: two-voice measures move voice 1 only; the 2000-measure and 256-beat limits refuse', () => {
  const s = model({ tracks: [tab([{ voices: [{ beats: [nt('whole'), nt('half')] }, { beats: [nt('whole', 3, 3)] }] }, { voices: [{ beats: [nt('half')] }, { beats: [nt('whole', 3, 4)] }] }])] });
  const r = run('reflow', s, cur(0, 0, 0), null);
  eq(r.score.tracks[0].measures.map((m) => [m.voices[0].beats.length, m.voices[1].beats.length]), [[1, 1], [2, 1]]);
  const max = model({ tracks: [tab(Array.from({ length: EDITOR_LIMITS.measuresPerTrack }, (_, i) => ({ beats: i === EDITOR_LIMITS.measuresPerTrack - 1 ? [nt('whole'), nt('half')] : [] })))] });
  eq(describe(run('reflow', max, cur(0, EDITOR_LIMITS.measuresPerTrack - 1, 0), null).announce), 'The score would be too large');
  const full = model({ tracks: [tab([{ beats: [nt('whole'), nt('half')] }, { beats: Array.from({ length: 256 }, () => nt('64th')) }])] });
  eq(describe(run('reflow', full, cur(0, 0, 0), null).announce), 'The score would be too large');
});

// ---------- clip format: buildClip / parseClip ----------
const CL = await imp('src/editor/model/clip.js');
const PA = await imp('src/editor/model/paste.js');
const L = EDITOR_LIMITS;
const SEVEN = ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const clipText = (kind, content, extra = {}) => JSON.stringify({ type: 'music-score-clip', version: 1, kind, tracks: [{ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], [kind]: content, ...extra }] });
const refusedId = (x) => CL.parseClip(x).refused?.id;
test('buildClip: beats clip = the slices\' beats with graces, deep clones without tempo, the track tuning; measures clip = beats or voices per measure, holes empty, no measure fields; cursorRange is null on the slot', () => {
  const s = model({ tracks: [tab([
    { beats: [nt('quarter', 1, 1, { tempo: 90 }), grace(), nt('quarter', 2, 2, { zz: 1 }), nt('half')], timeSignature: { beats: 4, beatType: 4 }, barline: 'double', pickup: true },
    null,
    { voices: [{ beats: [nt('whole', 1, 0, { tempo: 70 })], vz: 1 }, { beats: [grace(), nt('whole', 3, 3)] }], segno: true },
  ], { tuning: SEVEN })] });
  const b = CL.buildClip(s, SEL.selectionRange(s, 0, P(0, 0), P(0, 2)));
  eq([b.kind, b.count], ['beats', 2]);
  eq(JSON.parse(b.text), { type: 'music-score-clip', version: 1, kind: 'beats', tracks: [{ tuning: SEVEN, beats: [nt('quarter', 1, 1), grace(), nt('quarter', 2, 2, { zz: 1 })] }] });
  const m = CL.buildClip(s, SEL.selectionRange(s, 0, P(0, 0), P(2, 0)));
  eq([m.kind, m.count], ['measures', 3]);
  eq(JSON.parse(m.text).tracks[0].measures, [
    { beats: [nt('quarter', 1, 1), grace(), nt('quarter', 2, 2, { zz: 1 }), nt('half')] },
    { beats: [] },
    { voices: [{ beats: [nt('whole', 1, 0)] }, { beats: [grace(), nt('whole', 3, 3)] }] },
  ], 'a voice keeps only its beats');
  ok(s.tracks[0].measures[0].beats[0].tempo === 90, 'the model is untouched');
  eq(CL.cursorRange(s, cur(0, 0, 2)).slices, [{ measure: 0, from: 1, to: 3, first: false, last: false }], 'the cursor beat with its leading grace');
  eq(CL.cursorRange(s, cur(0, 1, 0)), null);
  eq(CL.parseClip(b.text), { clip: { kind: 'beats', tuning: SEVEN, beats: JSON.parse(b.text).tracks[0].beats } }, 'round trip');
  eq(CL.parseClip(JSON.parse(m.text)).clip.measures, JSON.parse(m.text).tracks[0].measures, 'an object works too');
});
test('parseClip security: malformed JSON, wrong type or version, a bare array, __proto__ at any depth, more than 5 MB, every LIMITS dimension, deep nesting, a cycle, non-string input, a bad tuning, not exactly one track: refused, never thrown, nothing polluted', () => {
  eq(refusedId('{'), 'clipInvalid');
  eq(refusedId(''), 'clipInvalid');
  eq(refusedId('{"type":"other","version":1}'), 'notClip');
  eq(refusedId('{"version":1}'), 'notClip');
  eq(refusedId(clipText('beats', []).replace('"version":1', '"version":2')), 'clipVersion');
  eq(refusedId(clipText('beats', []).replace('"version":1', '"version":"1"')), 'clipVersion');
  eq(refusedId('[]'), 'clipInvalid');
  eq(refusedId(`[${clipText('beats', [])}]`), 'clipInvalid');
  eq(refusedId(clipText('beats', [nt('quarter')]).replace('"type":"note"', '"__proto__":{"polluted":1},"type":"note"')), 'clipInvalid');
  eq(refusedId('{"__proto__":{"x":1},"type":"music-score-clip","version":1,"kind":"beats","tracks":[{"beats":[]}]}'), 'clipInvalid');
  eq(refusedId(clipText('beats', [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 0, deep: { a: { b: JSON.parse('{"__proto__":1}') } } }] }])), 'clipInvalid', 'an own __proto__ key in an object input is refused too');
  eq(refusedId(clipText('beats', [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 0 }] }]).replace('"fret":0', '"fret":0,"x":{"y":{"__proto__":{"z":1}}}')), 'clipInvalid', 'deep __proto__');
  eq(refusedId(' '.repeat(L.jsonChars + 1)), 'clipTooLarge');
  eq(refusedId(clipText('beats', [nt('quarter')]) + ' '.repeat(L.jsonChars)), 'clipTooLarge');
  eq(refusedId(clipText('beats', Array.from({ length: L.beatsPerVoice + 1 }, () => nt('64th')))), 'clipTooLarge', 'beats');
  eq(refusedId(clipText('beats', [{ type: 'note', duration: 'quarter', notes: Array.from({ length: L.notesPerBeat + 1 }, (_, i) => ({ string: 1, fret: i })) }])), 'clipTooLarge', 'notes');
  eq(refusedId(clipText('measures', Array.from({ length: L.measuresPerTrack + 1 }, () => ({ beats: [] })))), 'clipTooLarge', 'measures');
  eq(refusedId(clipText('measures', [{ voices: Array.from({ length: L.voicesPerMeasure + 1 }, () => ({ beats: [] })) }])), 'clipTooLarge', 'voices');
  eq(refusedId(clipText('measures', [{ voices: [{ beats: Array.from({ length: L.beatsPerVoice + 1 }, () => nt('64th')) }] }])), 'clipTooLarge', 'beats in a voice');
  eq(refusedId(clipText('beats', [], { tuning: Array.from({ length: L.tuningStrings + 1 }, () => 'E2') })), 'clipInvalid', 'tuning strings');
  let deep = '1';
  for (let i = 0; i < 20000; i++) deep = `{"a":${deep}}`;
  const d = CL.parseClip(clipText('beats', [nt('quarter')]).replace('"fret":0', `"fret":0,"deep":${deep}`));
  ok(d.refused || sanitizeScore({ tracks: [{ measures: [{ beats: d.clip.beats }] }] }), 'deep nesting: refused or a clean clip, never a throw');
  const cyc = { type: 'music-score-clip', version: 1, kind: 'beats', tracks: [{ beats: [] }] };
  cyc.tracks[0].self = cyc;
  eq(refusedId(cyc), 'clipInvalid', 'a cycle');
  for (const x of [undefined, null, 5, true, () => 1, Symbol('x'), 10n]) eq(refusedId(x), 'clipInvalid', String(typeof x));
  for (const tuning of [[], ['H2'], ['E2', 5], 'E2', [null]]) eq(refusedId(clipText('beats', [], { tuning })), 'clipInvalid', JSON.stringify(tuning));
  eq(refusedId(JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'beats', tracks: [{ beats: [] }, { beats: [] }] })), 'clipInvalid', 'two tracks');
  eq(refusedId(JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'beats', tracks: [] })), 'clipInvalid', 'no track');
  eq(refusedId(JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'beats', tracks: [[]] })), 'clipInvalid');
  eq(refusedId(JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'notes', tracks: [{ beats: [] }] })), 'clipInvalid', 'kind');
  eq(refusedId(JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'beats', tracks: [{ measures: [] }] })), 'clipInvalid', 'beats missing');
  eq(refusedId(clipText('measures', [{ beats: [] }, 3])), 'clipInvalid', 'a measure that is not an object');
  ok(({}).polluted === undefined && ({}).z === undefined && ({}).x === undefined);
  eq(CL.looksLikeClip('{"type":"music-score-clip"}'), true);
  eq([CL.looksLikeClip('hello'), CL.looksLikeClip('music-score-clip'), CL.looksLikeClip(null), CL.looksLikeClip('["music-score-clip"]')], [false, false, false, false]);
});
test('parseClip cleans: tempo removed everywhere, measures reduced to beats or voices (no column or settings fields), the content sanitized', () => {
  const p = CL.parseClip(clipText('measures', [
    { beats: [nt('whole', 1, 0, { tempo: 60 })], timeSignature: { beats: 3, beatType: 4 }, barline: 'final', pickup: true, clef: 'bass', ending: 1 },
    { voices: [{ beats: [grace(), nt('whole', 1, 0, { tempo: 61 })] }], beats: [nt('half')] },
  ]));
  eq(p.clip.measures, [{ beats: [nt('whole')] }, { voices: [{ beats: [grace(), nt('whole')] }] }]);
  eq(CL.parseClip(clipText('beats', [{ ...grace(), tempo: 70 }, nt('quarter', 1, 0, { tempo: 71 })])).clip.beats, [grace(), nt('quarter')]);
  eq(CL.parseClip(clipText('measures', [{ voices: [{ tempo: 90, zz: 1, beats: [nt('whole')] }, null] }])).clip.measures, [{ voices: [{ beats: [nt('whole')] }, { beats: [] }] }], 'voice-level tempo and other voice fields are dropped');
  const vs = model({ tracks: [tab([{ voices: [{ tempo: 90, beats: [nt('whole', 1, 0, { tempo: 80 })] }, { beats: [] }] }])] });
  ok(!CL.buildClip(vs, SEL.selectionRange(vs, 0, P(0, 0), P(0, 0))).text.includes('tempo'), 'buildClip drops a voice-level tempo too');
});

// ---------- applyPaste ----------
const six = (measures) => model({ tracks: [tab(measures), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
const parse = (text) => CL.parseClip(text).clip;
test('applyPaste beats: before the cursor beat and its graces; on the slot; over a selection (replaced); cursor after the pasted beats; overflow stays; one sanitize-stable result', () => {
  const s = six([{ beats: [nt('half'), grace(), nt('half')] }, { beats: [nt('half')] }]);
  const clip = parse(clipText('beats', [nt('quarter', 3, 3), nt('quarter', 4, 4)]));
  const r = PA.applyPaste(s, cur(0, 0, 2), null, clip);
  eq(v1(r.score, 0, 0).map((b) => b.type + b.duration), ['notehalf', 'notequarter', 'notequarter', 'grace16th', 'notehalf']);
  eq(r.cursor, cur(0, 0, 4), 'still on the original beat');
  eq(describe(r.announce), 'Pasted 2 beats');
  ok(sanitizeScore(r.score) === r.score);
  const slot = PA.applyPaste(s, cur(0, 1, 1), null, clip);
  eq([v1(slot.score, 0, 1).length, slot.cursor.beat], [3, 3]);
  const sel = SEL.selectionRange(s, 0, P(0, 0), P(0, 2));
  const over = PA.applyPaste(s, cur(0, 0, 2), sel, clip);
  eq(v1(over.score, 0, 0).map((b) => b.duration), ['quarter', 'quarter']);
  eq(describe(over.announce), 'Pasted 2 beats, replaced 2');
  eq(over.cursor, cur(0, 0, 2));
  // a drawn tempo mark on a replaced beat is counted, like a range delete
  const withTempo = { ...s, tracks: [{ ...s.tracks[0], measures: [{ ...s.tracks[0].measures[0], beats: s.tracks[0].measures[0].beats.map((b, i) => (i === 0 ? { ...b, tempo: 90 } : b)) }, ...s.tracks[0].measures.slice(1)] }, ...s.tracks.slice(1)] };
  const overT = PA.applyPaste(withTempo, cur(0, 0, 2), SEL.selectionRange(withTempo, 0, P(0, 0), P(0, 2)), clip);
  eq(describe(overT.announce), 'Pasted 2 beats, replaced 2, 1 tempo mark removed');
});
test('applyPaste fits the clip to the track: 7 strings into 6 drops (counted, an emptied beat becomes a rest), a different tuning drops pitch from string+fret notes, a stray tieEnd is removed, no tempo arrives', () => {
  const s = six([{ beats: [nt('half')] }]);
  const seven = clipText('beats', [{ type: 'note', duration: 'quarter', notes: [{ string: 7, fret: 2 }, { string: 1, fret: 1, tieEnd: true }] }, { type: 'note', duration: 'quarter', notes: [{ string: 7, fret: 0 }], tempo: 50 }], { tuning: SEVEN });
  const r = PA.applyPaste(s, cur(0, 0, 0), null, parse(seven));
  eq(v1(r.score, 0, 0).slice(0, 2), [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 1 }] }, { type: 'rest', duration: 'quarter' }]);
  eq(describe(r.announce), 'Pasted 2 beats, 2 notes on missing strings dropped');
  const drop = clipText('beats', [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 0, pitch: 'F4' }, { string: 2, fret: 1, pitch: 'C4' }] }], { tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'F4'] });
  eq(v1(PA.applyPaste(s, cur(0, 0, 0), null, parse(drop)).score, 0, 0)[0].notes, [{ string: 1, fret: 0 }, { string: 2, fret: 1, pitch: 'C4' }], 'only the retuned string loses pitch');
  ok(!JSON.stringify(r.score).includes('tempo'));
});
test('applyPaste measures: inserted before the cursor measure (the selection\'s first with the insert option) in every track, other tracks get empty measures, no measure fields, carried fields at measure 1 kept; cursor on the original measure', () => {
  const s = model({ tracks: [tab([{ beats: [nt('whole')], timeSignature: { beats: 3, beatType: 4 } }, { beats: [nt('half')] }]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  const clip = parse(clipText('measures', [{ beats: [nt('half', 2, 2)] }, { voices: [{ beats: [nt('whole', 3, 3)] }, { beats: [nt('whole', 4, 4)] }] }]));
  const r = PA.applyPaste(s, cur(0, 0, 0), null, clip);
  eq(r.score.tracks[0].measures, [{ timeSignature: { beats: 3, beatType: 4 }, beats: [nt('half', 2, 2)] }, { voices: [{ beats: [nt('whole', 3, 3)] }, { beats: [nt('whole', 4, 4)] }] }, { beats: [nt('whole')] }, { beats: [nt('half')] }]);
  eq(r.score.tracks[1].measures, [{ beats: [] }, { beats: [] }, { beats: [nt('whole')] }]);
  eq([r.cursor, describe(r.announce)], [cur(0, 2, 0), 'Inserted 2 measures at measure 1'], '2.3.1: the insert wording; the cursor on the first position after the pasted measures');
  ok(sanitizeScore(r.score) === r.score);
  const sel = SEL.selectionRange(s, 0, P(1, 0), P(0, 0));
  const ins = PA.applyPaste(s, cur(0, 0, 0), sel, clip, { insert: true });
  eq([ins.announce.id, ins.announce.at, ins.cursor], ['pasted', 1, cur(0, 2, 0)], 'before the selection\'s first measure');
});
test('applyPaste limits: 256 beats in a measure and 2000 measures are refused; an empty clip pastes nothing', () => {
  const s = six([{ beats: Array.from({ length: 255 }, () => nt('64th')) }]);
  eq(PA.applyPaste(s, cur(0, 0, 0), null, parse(clipText('beats', [nt('quarter'), nt('quarter')]))), { refused: { id: 'tooLarge' } });
  ok(PA.applyPaste(s, cur(0, 0, 0), null, parse(clipText('beats', [nt('quarter')]))).score, '256 is fine');
  const big = model({ tracks: [tab(Array.from({ length: L.measuresPerTrack - 1 }, () => ({ beats: [] })))] });
  eq(PA.applyPaste(big, cur(0, 0, 0), null, parse(clipText('measures', [{ beats: [] }, { beats: [] }])), { insert: true }), { refused: { id: 'tooLarge' } });
  eq(PA.applyPaste(s, cur(0, 0, 0), null, parse(clipText('beats', []))), { refused: { id: 'nothingToPaste' } });
});

// ---------- B10 / E12 extensions ----------
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');
const { leadSoloF } = await imp('examples/lead-solo-f.js');
const { defaultScore } = await imp('src/editor/model/defaultScore.js');
const B10_START = () => [
  ['default', defaultScore()], ['lead-riff', model(leadRiff)], ['lead-solo-f', model(leadSoloF)], ['example-score', model(exampleScore)],
  ['rich', model({ tracks: [tab([{ beats: [nt('quarter'), grace(), tn('quarter', 2, 2, { tieStart: true }), rest('quarter', { hidden: true }), nt('quarter')] },
    { voices: [{ beats: [grace(), tn('half', 2, 2, { tieEnd: true }), nt('half', 1, 0, { tempo: 80 })] }, { beats: [nt('whole', 4, 0)] }] }, { beats: [{ type: 'note', duration: 'whole', slash: true }] }, null]),
  { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [] }] }] })],
  ['mixed', model({ timeSignature: { beats: 3, beatType: 4 }, tracks: [{ name: 'Notes', measures: [{ beats: [{ type: 'note', duration: 'half', notes: [{ pitch: 'C4' }, { pitch: 'E4' }] }] }] }, tab([{ beats: [] }], { tuning: ['E1', 'A1', 'D2', 'G2'], showStandardNotation: false })] })],
];
const NAVS = ['moveLeft', 'moveRight', 'moveRight', 'moveUp', 'moveDown', 'prevMeasure', 'nextMeasure', 'measureStart', 'measureEnd', 'scoreStart', 'scoreEnd', 'prevTrack', 'nextTrack'];
const EDITS = ['digit', 'digit', 'digit', 'deleteNote', 'deleteBeat', 'deleteMeasure', 'toggleRest', 'toggleTie', 'shorter', 'longer', 'cycleDots', 'toggleTriplet', 'insertBeat', 'insertMeasureAfter', 'insertMeasureBefore', 'fill', 'fill', 'reflow', 'reflow', 'vibrato', 'palmMute'];
const SELECTS = ['selectLeft', 'selectRight', 'selectRight', 'selectMeasureStart', 'selectMeasureEnd', 'selectPrevMeasure', 'selectNextMeasure', 'selectAll'];
test('B10 (2.3): 6 start scores x 2000 random steps mixing commands, selection, fill, reflow, ranged deletes, cut and pastes keep sanitizeScore(model) === model and a valid cursor and selection; undo all restores the start, redo all the end', () => {
  const rnd = mulberry32(20261123);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  for (const [label, start] of B10_START()) {
    let s = start;
    let c = C.clampCursor(s, cur(0, 0, 0));
    let state = st();
    let sel = null;
    let clipboard = null;
    const history = [];
    let pastes = 0;
    let ranged = 0;
    for (let i = 0; i < 2000; i++) {
      const r0 = rnd();
      const before = { s, c };
      let next = null;
      if (r0 < 0.25) {
        const name = pick(SELECTS);
        const anchor = CMD.COMMANDS[name].fromStart ? SEL.startOf(s, c) : sel?.anchor ?? { measure: c.measure, beat: c.beat };
        const r = CMD.run(name, s, c, state, { allowAppend: false });
        c = r.cursor; state = r.state;
        sel = SEL.selectionRange(s, c.track, anchor, c);
      } else if (r0 < 0.33) {
        const range = sel ?? CL.cursorRange(s, c);
        if (range) clipboard = CL.buildClip(s, range).text;
      } else if (r0 < 0.40) {
        if (clipboard) {
          const r = PA.applyPaste(s, c, sel, CL.parseClip(clipboard).clip);
          if (!r.refused && io.exportedLength(r.score) <= L.jsonChars) { next = r; pastes++; }
          sel = null;
        }
      } else if (r0 < 0.43) {
        const range = sel ?? CL.cursorRange(s, c);
        if (range) { const r = RE.clearSlices(s, range); if (r.score !== s) next = { score: r.score, cursor: { ...c, ...r.cursor } }; }
        sel = null;
      } else {
        const name = rnd() < 0.4 ? pick(NAVS) : pick(EDITS);
        const r = CMD.run(name, s, c, state, { maxFret: 24, now: i * 1000, twoDigitDelayMs: 800, allowAppend: true, selection: sel }, Math.floor(rnd() * 10));
        state = r.state;
        if (r.changed) { next = r; if (sel && ['deleteNote', 'deleteBeat', 'deleteMeasure', 'fill'].includes(name)) ranged++; } else c = r.cursor;
        if (r.changed && sel && CMD.COMMANDS[name].keepsSelection) sel = SEL.selectionRange(r.score, sel.track, sel.anchor, sel.focus); // 2.3.1: re-derived
        else if (r.changed || CMD.COMMANDS[name].kind === 'nav') sel = null;
      }
      if (next) {
        s = next.score;
        c = C.clampCursor(s, next.cursor ?? c);
        state = C.syncDuration(s, c, state);
        history.push({ before, after: { s, c } });
      }
      ok(sanitizeScore(s) === s, `${label} step ${i}: sanitize identity`);
      eq(C.clampCursor(s, c), c, `${label} step ${i}: valid cursor`);
      if (sel) eq(SEL.selectionRange(s, sel.track, sel.anchor, sel.focus)?.info, sel.info, `${label} step ${i}: valid selection`);
    }
    ok(pastes > 20 && ranged > 10 && history.length > 300, `${label}: ${pastes} pastes, ${ranged} ranged edits, ${history.length} steps`);
    const end = s;
    for (let k = history.length - 1; k >= 0; k--) { ok(history[k].after.s === s); s = history[k].before.s; }
    ok(s === start, `${label}: undo all restores the start`);
    for (const h of history) s = h.after.s;
    ok(s === end, `${label}: redo all reaches the end`);
  }
});
test('E12 (2.3): unknown fields at score, track, measure, voice, beat and note level survive range edits, fill, reflow and pastes that do not own them; pasted beats carry theirs', () => {
  const x = { keep: [1, { deep: true }] };
  const s0 = model({ x, tracks: [
    { x, name: 'A', showTablature: true, measures: [
      { x, beats: [{ x, type: 'note', duration: 'quarter', notes: [{ x, string: 1, fret: 2 }] }, { x, type: 'rest', duration: 'quarter' }, { x, type: 'note', duration: 'whole', notes: [{ x, string: 2, fret: 1 }] }] },
      { x, voices: [{ x, beats: [{ x, type: 'note', duration: 'half', notes: [{ x, string: 2, fret: 1 }] }] }, { x, beats: [] }] },
      { x, beats: [] },
    ] },
    { x, name: 'B', showTablature: true, measures: [{ x, beats: [] }, { x, beats: [] }, { x, beats: [] }] },
  ] });
  const count = (v) => (Array.isArray(v) ? v.reduce((a, y) => a + count(y), 0) : v && typeof v === 'object' ? (JSON.stringify(v.x) === JSON.stringify(x) ? 1 : 0) + Object.values(v).reduce((a, y) => a + count(y), 0) : 0);
  const n0 = count(s0);
  const sel = SEL.selectionRange(s0, 0, P(0, 0), P(0, 1));
  eq(count(run('deleteNote', s0, cur(0, 0, 1), sel).score), n0 - 1, 'clear: only the removed note\'s own field goes');
  eq(count(run('fill', s0, cur(0, 1, 1), null).score), n0);
  eq(count(run('reflow', s0, cur(0, 0, 0), null).score), n0);
  const clip = CL.parseClip(CL.buildClip(s0, sel).text).clip;
  eq(count(PA.applyPaste(s0, cur(0, 2, 0), null, clip).score), n0 + 3, 'two pasted beats and a note bring theirs');
  const mclip = CL.parseClip(CL.buildClip(s0, SEL.selectionRange(s0, 0, P(1, 0), P(1, 1))).text).clip;
  eq(mclip.kind, 'measures');
  eq(count(PA.applyPaste(s0, cur(0, 0, 0), null, mclip).score), n0 + 2, 'a measures clip keeps beat and note fields, never the measure\'s or a voice\'s');
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
