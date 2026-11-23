// 2.3.2 column selection, column clipboard and column range edits at model level: the selection model
// (criteria 1-5), multi-track clips and their parsing (8, 10), pasteColumns (11-16), range edits over a
// column (17-22), B10 over the column operations and E12.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-columns.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const io = await imp('src/editor/model/io.js');
const SEL = await imp('src/editor/model/selection.js');
const COL = await imp('src/editor/model/columns.js');
const C = await imp('src/editor/model/cursor.js');
const CMD = await imp('src/editor/model/commands.js');
const { describe } = await imp('src/editor/announce.js');
const { sanitizeScore } = await imp('src/sanitize.js');

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
const rest = (duration, extra = {}) => ({ type: 'rest', duration, ...extra });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const T = (track, measure, beat) => ({ track, measure, beat });
const st = () => ({ duration: 'quarter', dots: 0, digit: null });
const run = (name, s, c, sel, arg) => CMD.run(name, s, c, st(), { maxFret: 24, now: 0, twoDigitDelayMs: 800, allowAppend: true, selection: sel }, arg);
const said = (r) => describe(r.announce);
const v1 = (s, ti, mi) => s.tracks[ti].measures[mi].beats;
const same = (s) => sanitizeScore(s) === s;
const BASS = ['E1', 'A1', 'D2', 'G2'];
/** 4 tracks: 0 TAB + notation, 1 hidden, 2 notation only, 3 a 4-string TAB-only bass; 4 measures each. */
const four = () => model({ tracks: [
  tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 2, 2), nt('half', 3, 3)] }, { beats: [nt('whole', 1, 4)] }, { beats: [] }, { beats: [nt('half', 2, 5), nt('half', 2, 6)] }]),
  { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [nt('whole')] }, { beats: [nt('whole')] }, { beats: [] }, { beats: [] }] },
  { name: 'Notes', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }, { beats: [nt('half', 2, 1), nt('half', 2, 3)] }, { beats: [] }, { beats: [rest('whole')] }] },
  tab([{ beats: [nt('whole', 4, 3)] }, { beats: [nt('whole', 4, 5)] }, { beats: [] }, { beats: [nt('whole', 1, 7)] }], { name: 'Bass', showStandardNotation: false, tuning: BASS }),
] });
const three = () => model({ tracks: [
  tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 2), nt('half', 1, 3)] }, { beats: [nt('quarter', 1, 4), nt('quarter', 1, 5), nt('half', 1, 6)] }, { beats: [nt('whole', 1, 7)] }]),
  tab([{ beats: [nt('half', 2, 1), nt('half', 2, 2)] }, { beats: [nt('half', 2, 3), nt('quarter', 2, 4), nt('quarter', 2, 5)] }, { beats: [nt('whole', 2, 6)] }], { name: 'B' }),
  tab([{ beats: [nt('whole', 3, 1)] }, { beats: [nt('whole', 3, 2)] }, { beats: [nt('whole', 3, 3)] }], { name: 'C' }),
] });

// ---------- selection model (criteria 1-5) ----------
test('columnRange: two ends on different tracks select measures min..max on every visible track between them; info shape; parts are whole-measure single-track ranges', () => {
  const s = three();
  const sel = COL.columnRange(s, T(0, 1, 1), T(1, 1, 2));
  eq(Object.keys(sel), ['track', 'tracks', 'anchor', 'focus', 'parts', 'info']);
  eq(sel.info, { kind: 'measures', track: 0, start: { measure: 1, beat: 0 }, end: { measure: 1, beat: 0 }, beatCount: 6, measures: [1, 1], tracks: [0, 1] });
  eq([sel.track, sel.tracks, sel.anchor, sel.focus], [0, [0, 1], T(0, 1, 1), T(1, 1, 2)], 'the ends keep their tracks and beats');
  eq(sel.parts.map((p) => p.info), [SEL.selectionRange(s, 0, { measure: 1, beat: 0 }, { measure: 1, beat: 2 }).info, SEL.selectionRange(s, 1, { measure: 1, beat: 0 }, { measure: 1, beat: 2 }).info]);
  eq(sel.parts.map((p) => p.info.kind), ['measures', 'measures']);
  const up = COL.columnRange(s, T(2, 2, 0), T(0, 0, 1));
  eq([up.tracks, up.info.measures, up.info.beatCount, up.track], [[0, 1, 2], [0, 2], 7 + 6 + 3, 0], 'either order');
  ok(!('slices' in up), 'no top-level slices');
});
test('selectionOf: one track is the 2.3.1 selectionRange (same object shape, no tracks field), two tracks a column; going back to one track restores the beat range', () => {
  const s = three();
  const one = COL.selectionOf(s, T(0, 1, 1), T(0, 1, 2));
  eq(one, SEL.selectionRange(s, 0, { measure: 1, beat: 1 }, { measure: 1, beat: 2 }));
  ok(!('tracks' in one.info) && !one.parts);
  const col = COL.selectionOf(s, T(0, 1, 1), T(1, 1, 1));
  eq(col.info.kind, 'measures');
  const back = COL.selectionOf(s, COL.anchorOf(col), T(0, 1, 1));
  eq([back.info.kind, back.info.start, back.info.beatCount], ['beats', { measure: 1, beat: 1 }, 1]);
});
test('anchorOf / focusOf carry the track: a single-track selection takes sel.track, a column its own ends; null without a selection', () => {
  const s = three();
  eq(COL.anchorOf(SEL.selectionRange(s, 1, { measure: 0, beat: 1 }, { measure: 1, beat: 0 })), T(1, 0, 1));
  eq(COL.focusOf(SEL.selectionRange(s, 1, { measure: 0, beat: 1 }, { measure: 1, beat: 0 })), T(1, 1, 0));
  const col = COL.columnRange(s, T(2, 0, 0), T(0, 1, 2));
  eq([COL.anchorOf(col), COL.focusOf(col)], [T(2, 0, 0), T(0, 1, 2)]);
  eq([COL.anchorOf(null), COL.focusOf(null)], [null, null]);
});
test('criterion 2: hidden tracks are skipped and not listed; visibleBetween in either order; fewer than 2 visible tracks between the ends is the single-track range on the focus track', () => {
  const s = four();
  eq([COL.visibleBetween(s, 0, 3), COL.visibleBetween(s, 3, 0), COL.visibleBetween(s, 1, 1), COL.visibleBetween(s, -4, 99)], [[0, 2, 3], [0, 2, 3], [], [0, 2, 3]]);
  const sel = COL.columnRange(s, T(0, 0, 0), T(3, 1, 0));
  eq([sel.tracks, sel.info.beatCount], [[0, 2, 3], 4 + 3 + 2]);
  const hiddenEnd = COL.columnRange(s, T(1, 0, 0), T(0, 0, 1));
  eq([hiddenEnd.parts, hiddenEnd.info], [undefined, SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 0, beat: 1 }).info]);
  eq(COL.wordsOf(s, sel), { id: 'selectedColumns', a: 1, b: 2, t1: 1, t2: 4, hidden: 1 });
});
test('blank and empty measures in a column: zero-beat parts count 0, the column still covers them; a column of blank measures has beatCount 0', () => {
  const s = four();
  const sel = COL.columnRange(s, T(0, 2, 0), T(3, 2, 0));
  eq([sel.info.beatCount, sel.parts.map((p) => p.info.beatCount), sel.parts.map((p) => p.slices.length)], [0, [0, 0, 0], [1, 1, 1]]);
  const rests = COL.columnRange(s, T(2, 3, 0), T(3, 3, 0));
  eq(rests.info.beatCount, 1 + 1);
});
test('criterion 3: column moves: columnPrev / columnNext move the focus by a whole measure (first / last position), at the edges Start / End of score; columnStay changes nothing', () => {
  const s = three();
  eq(COL.columnNext(s, cur(1, 0, 0)), { cursor: cur(1, 1, 2) });
  eq(COL.columnPrev(s, cur(1, 2, 0)), { cursor: cur(1, 1, 0) });
  eq(COL.columnPrev(s, cur(1, 0, 1)), { announce: { id: 'startOfScore' } });
  eq(COL.columnNext(s, cur(1, 2, 0)), { announce: { id: 'endOfScore' } });
  eq(COL.columnStay(s, cur(1, 2, 0)), {});
  const col = COL.columnRange(s, T(0, 0, 0), T(1, 0, 1));
  const f = COL.columnar(() => 'single', () => 'column');
  eq([f(s, cur(0, 0, 0), st(), { selection: col }), f(s, cur(0, 0, 0), st(), { selection: SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 0, beat: 1 }) }), f(s, cur(0, 0, 0), st(), {}), f(s, cur(0, 0, 0), st())], ['column', 'single', 'single', 'single']);
});
test('criterion 4: coversTrack is kind measures over every measure; allTracks anchors on the first visible track start and moves the cursor to the last visible track\'s last position; null with one visible track; the words say all tracks only when everything is covered', () => {
  const s = four();
  eq(COL.coversTrack(s, SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 3, beat: 1 })), true);
  eq(COL.coversTrack(s, SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 2, beat: 0 })), false);
  eq(COL.coversTrack(s, SEL.selectionRange(s, 0, { measure: 0, beat: 1 }, { measure: 3, beat: 1 })), false, 'beats');
  eq(COL.coversTrack(s, null), false);
  const all = COL.allTracks(s, cur(0, 1, 0, 3));
  eq(all, { anchor: T(0, 0, 0), cursor: cur(3, 3, 0, 3) });
  const sel = COL.selectionOf(s, all.anchor, all.cursor);
  eq([sel.tracks, sel.info.measures, COL.coversTrack(s, sel)], [[0, 2, 3], [0, 3], true]);
  eq([COL.wordsOf(s, sel, true), COL.wordsOf(s, sel, false).id], [{ id: 'selectedAllTracks' }, 'selectedColumns']);
  const part = COL.columnRange(s, T(0, 0, 0), T(2, 3, 0));
  eq(COL.wordsOf(s, part, true).id, 'selectedColumns', 'not every visible track');
  eq(COL.allTracks(model({ tracks: [tab([{ beats: [] }]), { showStandardNotation: false, measures: [{ beats: [] }] }] }), cur(0, 0, 0)), null);
  eq(COL.wordsOf(s, SEL.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 3, beat: 1 }), true).id, 'selectedAll', 'single-track words unchanged');
});
test('criterion 5 (model): a column selection is re-derived identically from its ends after a model change that keeps its tracks', () => {
  const s = three();
  const col = COL.columnRange(s, T(0, 0, 2), T(2, 1, 0));
  const again = COL.selectionOf(s, COL.anchorOf(col), COL.focusOf(col));
  eq(again, col);
  ok(C.clampCursor(s, cur(col.focus.track, col.focus.measure, col.focus.beat)).track === 2);
});

// ---------- range edits over a column (criteria 17-22) ----------
test('criterion 17: Delete turns the beats of every selected track into rests (graces go), hidden tracks untouched, the cursor on the top track; all rests already: "Already rests"', () => {
  const s = four();
  const sel = COL.columnRange(s, T(0, 0, 0), T(3, 1, 0));
  const r = run('deleteNote', s, cur(3, 1, 0), sel);
  eq(said(r), '9 beats changed to rests on 3 tracks');
  eq([r.announce, CMD.undoLabel('deleteNote', r.announce)], [{ id: 'rangeCleared', count: 9, tracks: 3 }, 'clear beats']);
  for (const ti of [0, 2, 3]) for (const mi of [0, 1]) ok(v1(r.score, ti, mi).every((b) => b.type === 'rest'), `track ${ti} measure ${mi}`);
  eq(r.score.tracks[1], s.tracks[1], 'the hidden track is the same object');
  eq([v1(r.score, 0, 3), v1(r.score, 3, 3)], [v1(s, 0, 3), v1(s, 3, 3)], 'measures outside the column untouched');
  eq(r.cursor, cur(0, 0, 0), 'the top track start');
  ok(same(r.score));
  const again = run('deleteNote', r.score, cur(3, 1, 0), COL.columnRange(r.score, T(0, 0, 0), T(3, 1, 0)));
  eq([again.changed, said(again)], [false, 'Already rests']);
});
test('criterion 18: Ctrl+Delete leaves the measures empty on every selected track, the measure count unchanged; winning tempo marks counted on the original score; no beats at all: "No beats to delete"', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 1, { tempo: 90 })] }, { beats: [nt('whole')] }, { beats: [nt('whole')] }]),
    tab([{ beats: [nt('half', 2, 2), nt('half', 2, 3, { tempo: 100 })] }, { beats: [nt('whole')] }, { beats: [nt('whole')] }], { name: 'B' }),
  ] });
  const r = run('deleteBeat', s, cur(1, 1, 0), COL.columnRange(s, T(0, 0, 0), T(1, 1, 0)));
  eq(said(r), '5 beats deleted on 2 tracks, 2 tempo marks removed');
  eq([r.announce.tracks, CMD.undoLabel('deleteBeat', r.announce)], [2, 'delete beats']);
  eq(r.score.tracks.map((t) => t.measures.map((m) => m.beats.length)), [[0, 0, 1], [0, 0, 1]]);
  eq(r.cursor, cur(0, 0, 0));
  ok(same(r.score));
  const blank = model({ tracks: [tab([{ beats: [] }]), tab([{ beats: [] }], { name: 'B' })] });
  eq(said(run('deleteBeat', blank, cur(1, 0, 0), COL.columnRange(blank, T(0, 0, 0), T(1, 0, 0)))), 'No beats to delete');
});
test('criterion 19: Shift+Delete on a column deletes those columns from every track, hidden ones too', () => {
  const s = four();
  const r = run('deleteMeasure', s, cur(3, 1, 0), COL.columnRange(s, T(0, 0, 0), T(3, 1, 0)));
  eq([said(r), r.score.tracks.map((t) => t.measures.length)], ['Measures 1 to 2 deleted', [2, 2, 2, 2]]);
  eq(CMD.undoLabel('deleteMeasure', r.announce), 'delete measures');
});
test('criterion 20: F fills every measure of every selected track (cells counted), refused ones skipped and counted; one measure on 2 tracks is 2 cells; criterion 21: Shift+F ignores the column', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('quarter')] }, { beats: [nt('whole')] }]),
    tab([{ beats: [] }, { beats: [nt('half')] }], { name: 'B' }),
    tab([{ beats: [nt('half')] }, { beats: [nt('quarter')] }], { name: 'C' }),
  ] });
  const r = run('fill', s, cur(2, 1, 0), COL.columnRange(s, T(0, 0, 0), T(2, 1, 0)));
  eq(said(r), 'Filled 5 of 6 measures on 3 tracks, 7 rests added');
  eq([r.announce.tracks, r.announce.total, r.announce.count], [3, 6, 5]);
  eq(r.score.tracks.map((t) => t.measures.map((m) => m.beats.length)), [[3, 1], [1, 2], [2, 3]]);
  ok(same(r.score));
  const one = run('fill', s, cur(1, 0, 0), COL.columnRange(s, T(0, 0, 0), T(1, 0, 0)));
  eq(said(one), 'Filled 2 measures on 2 tracks, 3 rests added');
  const full = model({ tracks: [tab([{ beats: [nt('whole')] }]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  eq(said(run('fill', full, cur(1, 0, 0), COL.columnRange(full, T(0, 0, 0), T(1, 0, 0)))), 'Nothing to fill');
  const over = model({ tracks: [tab([{ beats: [nt('whole'), nt('half')] }, { beats: [] }]), tab([{ beats: [nt('whole'), nt('whole')] }, { beats: [] }], { name: 'B' })] });
  const rf = run('reflow', over, cur(1, 0, 0), COL.columnRange(over, T(0, 0, 0), T(1, 0, 0)));
  eq([v1(rf.score, 0, 0).length, v1(rf.score, 1, 0).length, said(rf)], [2, 1, 'Moved 1 beat to measure 2'], 'Shift+F on the cursor track only');
});
test('criterion 22: a beat effect follows the toggle rule across all selected tracks; note effects skip notation-only tracks and count them; needsTab only when no selected track has TAB', () => {
  const s = four();
  const sel = COL.columnRange(s, T(0, 0, 0), T(3, 1, 0));
  const p = run('palmMute', s, cur(3, 1, 0), sel);
  eq(said(p), 'Palm mute on, 9 beats on 3 tracks');
  eq(p.announce.skippedTracks, 0);
  for (const ti of [0, 2, 3]) ok(v1(p.score, ti, 0).every((b) => b.palmMute === true), `track ${ti}`);
  eq(p.score.tracks[1], s.tracks[1], 'hidden track untouched');
  const off = run('palmMute', p.score, cur(3, 1, 0), COL.columnRange(p.score, T(0, 0, 0), T(3, 1, 0)));
  eq(said(off), 'Palm mute off, 9 beats on 3 tracks');
  const mixed = run('palmMute', s, cur(3, 1, 0), COL.columnRange(s, T(0, 0, 0), T(3, 0, 0)));
  const p2 = run('palmMute', mixed.score, cur(3, 1, 0), sel);
  eq(said(p2), 'Palm mute on, 9 beats on 3 tracks', 'mixed steps all go to the start step');
  const x = run('deadNote', s, cur(3, 1, 0), sel);
  eq(said(x), 'Dead note on, 6 notes on 2 tracks, 1 track without TAB skipped');
  eq(v1(x.score, 2, 1), v1(s, 2, 1), 'the notation-only track untouched');
  const notes = model({ tracks: [{ name: 'N', measures: [{ beats: [nt('whole')] }] }, { name: 'M', measures: [{ beats: [nt('whole')] }] }] });
  eq(said(run('deadNote', notes, cur(1, 0, 0), COL.columnRange(notes, T(0, 0, 0), T(1, 0, 0)))), 'Needs a TAB staff');
  ok(CMD.COMMANDS.palmMute.keepsSelection && same(x.score));
});
test('criterion 22: transpose covers every selected track (TAB or not), all or nothing; the first misfit in track then measure order is named with its track; ties survive only between transposed notes of the same track', () => {
  const tied = (fret, flag) => ({ type: 'note', duration: 'whole', notes: [{ string: 1, fret, [flag]: true }] });
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 3)] }, { beats: [nt('whole', 1, 22)] }]),
    { name: 'Notes', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }, { string: 2, fret: 1 }] }] }, { beats: [nt('whole', 2, 23)] }] },
    tab([{ beats: [tied(1, 'tieStart')] }, { beats: [tied(1, 'tieEnd')] }], { name: 'C' }),
  ] });
  const all = COL.columnRange(s, T(0, 0, 0), T(2, 1, 0));
  const up = run('transpose', s, cur(2, 1, 0), all, 1);
  eq(said(up), 'Transposed 6 notes up 1 semitone on 3 tracks, 1 pitch-only note skipped');
  eq([v1(up.score, 0, 1)[0].notes[0].fret, v1(up.score, 1, 0)[0].notes, v1(up.score, 2, 0)[0].notes[0]], [23, [{ pitch: 'C4' }, { string: 2, fret: 2 }], { string: 1, fret: 2, tieStart: true }]);
  ok(same(up.score));
  const bad = run('transpose', s, cur(2, 1, 0), all, 3);
  eq([bad.changed, said(bad)], [false, "Can't transpose, measure 2 on track 1 would go above fret 24"]);
  const second = run('transpose', s, cur(2, 1, 0), COL.columnRange(s, T(1, 0, 0), T(2, 1, 0)), 2);
  eq(said(second), "Can't transpose, measure 2 on track 2 would go above fret 24", 'track numbers count from 1');
  const half = run('transpose', s, cur(2, 1, 0), COL.columnRange(s, T(0, 0, 0), T(2, 0, 0)), 1);
  eq([v1(half.score, 2, 0)[0].notes[0], v1(half.score, 2, 1)[0].notes[0]], [{ string: 1, fret: 2 }, { string: 1, fret: 1 }], 'a tie to an untransposed note goes on both sides');
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-columns: ${r.name}`);
    else { fail++; console.log(`FAIL editor-columns: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
