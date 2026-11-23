// 2.3.2 edge cases for column selection, column clipboard and column range edits at model level: hidden tracks at
// the ends and between, short tracks and holes, mixed tunings, two voices, pickup, transpose all-or-nothing,
// effect skip counts, paste mapping, hostile multi-track clips.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-columns-edge.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const io = await imp('src/editor/model/io.js');
const SEL = await imp('src/editor/model/selection.js');
const COL = await imp('src/editor/model/columns.js');
const CMD = await imp('src/editor/model/commands.js');
const { describe } = await imp('src/editor/announce.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const CL = await imp('src/editor/model/clip.js');
const PA = await imp('src/editor/model/paste.js');
const PC = await imp('src/editor/model/pasteColumns.js');
const RE = await imp('src/editor/model/rangeEdit.js');

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
const hid = (n = 4) => ({ name: 'Hidden', showStandardNotation: false, measures: Array.from({ length: n }, () => ({ beats: [nt('whole')] })) });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const T = (track, measure, beat) => ({ track, measure, beat });
const st = () => ({ duration: 'quarter', dots: 0, digit: null });
const run = (name, s, c, sel, arg) => CMD.run(name, s, c, st(), { maxFret: 24, now: 0, twoDigitDelayMs: 800, allowAppend: true, selection: sel }, arg);
const said = (r) => describe(r.announce);
const v1 = (s, ti, mi) => s.tracks[ti].measures[mi]?.beats;
const same = (s) => sanitizeScore(s) === s;
const TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const BASS = ['E1', 'A1', 'D2', 'G2'];
const clipOf = (kind, tracks) => JSON.stringify({ type: 'music-score-clip', version: 1, kind, tracks });
const mclip = (tracks) => CL.parseClip(clipOf('measures', tracks)).clip;
const entry = (frets, tuning = TUNING, string = 1) => ({ tuning, measures: frets.map((f) => ({ beats: [nt('whole', string, f)] })) });
const fret = (s, ti, mi) => v1(s, ti, mi)?.[0]?.notes?.[0]?.fret;
const meta = (s) => s.tracks.map((t) => t.measures.map((m) => { const { beats, voices, ...r } = m ?? {}; return r; }));
/** visible 0, hidden 1, visible 2 (notation only), hidden 3, visible 4 (bass); 3 measures. */
const gaps = () => model({ tracks: [
  tab([{ beats: [nt('whole', 1, 1)] }, { beats: [nt('whole', 1, 2)] }, { beats: [nt('whole', 1, 3)] }]),
  hid(3),
  { name: 'Notes', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }, { beats: [rest('whole')] }, { beats: [] }] },
  hid(3),
  tab([{ beats: [nt('whole', 4, 3)] }, { beats: [nt('whole', 4, 5)] }, { beats: [nt('whole', 1, 7)] }], { name: 'Bass', showStandardNotation: false, tuning: BASS }),
] });

// ---------- selection: hidden tracks, short tracks ----------
test('hidden tracks between and at the ends: only visible ones are listed; a hidden end clamps the span; the words count hidden tracks only inside the span', () => {
  const s = gaps();
  const all = COL.columnRange(s, T(0, 0, 0), T(4, 2, 0));
  eq([all.tracks, COL.wordsOf(s, all)], [[0, 2, 4], { id: 'selectedColumns', a: 1, b: 3, t1: 1, t2: 5, hidden: 2 }]);
  eq(describe(COL.wordsOf(s, all)), 'Selected measures 1 to 3, tracks 1 to 5, 2 hidden tracks skipped');
  const fromHidden = COL.columnRange(s, T(1, 0, 0), T(4, 1, 0));
  eq([fromHidden.tracks, fromHidden.anchor.track, COL.wordsOf(s, fromHidden).hidden], [[2, 4], 1, 1], 'anchor on a hidden track: span 2..4 has one hidden track (3)');
  const toHidden = COL.columnRange(s, T(4, 0, 0), T(3, 1, 0));
  eq(toHidden.parts, undefined, 'only track 4 visible in 3..4: single-track fallback');
  eq(COL.wordsOf(s, COL.columnRange(s, T(0, 0, 0), T(2, 0, 0))), { id: 'selectedColumns', a: 1, b: 1, t1: 1, t2: 3, hidden: 1 });
  const a = COL.allTracks(s, cur(0, 0, 0));
  eq(a.cursor.track, 4);
  eq(COL.wordsOf(s, COL.selectionOf(s, a.anchor, a.cursor), true), { id: 'selectedAllTracks' });
});
test('short tracks and holes: a column over missing measures has zero-beat parts, the copy pads them with empty measures, Delete / Ctrl+Delete leave them alone, F pads them, Shift+Delete trims every track', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 1)] }, { beats: [nt('whole', 1, 2)] }, { beats: [nt('whole', 1, 3)] }, { beats: [nt('whole', 1, 4)] }]),
    tab([{ beats: [nt('whole', 2, 1)] }, null], { name: 'Short' }),
  ] });
  const sel = COL.columnRange(s, T(0, 1, 0), T(1, 3, 0));
  eq([sel.info.beatCount, sel.parts[1].info.beatCount, sel.parts[1].slices.length], [3, 0, 3]);
  const j = JSON.parse(CL.buildClip(s, sel).text);
  eq(j.tracks.map((t) => t.measures.length), [3, 3]);
  eq(j.tracks[1].measures, [{ beats: [] }, { beats: [] }, { beats: [] }]);
  const d = run('deleteNote', s, cur(1, 3, 0), sel);
  eq([said(d), d.score.tracks[1] === s.tracks[1]], ['3 beats changed to rests on 2 tracks', true], 'the short track is the same object');
  const r = run('deleteBeat', s, cur(1, 3, 0), sel);
  ok(same(r.score) && r.score.tracks[1] === s.tracks[1]);
  const f = run('fill', s, cur(1, 3, 0), sel);
  eq([said(f), f.score.tracks[1].measures.length], ['Filled 3 of 6 measures on 2 tracks, 3 rests added', 4], 'the short track is padded; full measures of track 1 are skipped and counted');
  ok(same(f.score));
  eq(run('deleteMeasure', s, cur(1, 3, 0), sel).score.tracks.map((t) => t.measures.length), [1, 1]);
});
test('pasting onto a short track pads it with empty measures, then overwrites', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [] }, { beats: [] }]), tab([{ beats: [] }], { name: 'Short' })] });
  const r = PC.pasteColumns(s, cur(0, 1, 0), null, mclip([entry([1, 2]), entry([3, 4])]));
  eq([r.announce.id, r.score.tracks.map((t) => t.measures.length), fret(r.score, 1, 1), fret(r.score, 1, 2)], ['pastedOver', [3, 3], 3, 4]);
  ok(same(r.score));
});

// ---------- tunings, voices, pickup ----------
test('mixed string counts: each mapped track gets its own tuning fit (a string-6 note is dropped on the bass, counted once); a bass clip fits guitar tracks without drops', () => {
  const s = gaps();
  const g = mclip([entry([1]), { tuning: TUNING, measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 3, fret: 2 }, { string: 6, fret: 1 }] }] }] }]);
  const r = PC.pasteColumns(s, cur(2, 2, 0), COL.columnRange(s, T(2, 2, 0), T(4, 2, 0)), g);
  eq([r.announce.tracks, r.announce.dropped, v1(r.score, 4, 2)[0].notes], [2, 1, [{ string: 3, fret: 2 }]], 'tracks 2 and 4 (hidden 3 skipped)');
  ok(r.score.tracks[3] === s.tracks[3] && r.score.tracks[1] === s.tracks[1], 'hidden tracks untouched');
  const b = mclip([entry([5], BASS, 4), entry([6], BASS, 3)]);
  const q = PC.pasteColumns(model({ tracks: [tab([{ beats: [] }]), tab([{ beats: [] }], { name: 'B' })] }), cur(0, 0, 0), null, b);
  eq([q.announce.dropped, fret(q.score, 0, 0), fret(q.score, 1, 0)], [0, 5, 6]);
});
test('two-voice measures: Delete, Ctrl+Delete, effects and transpose over a column touch voice 1 only; a column paste replaces voice 2; the copy keeps both voices', () => {
  const v = model({ tracks: [
    tab([{ voices: [{ beats: [nt('whole', 1, 1)] }, { beats: [nt('whole', 2, 2)] }] }]),
    tab([{ voices: [{ beats: [nt('whole', 1, 3)] }, { beats: [nt('whole', 2, 4)] }] }], { name: 'B' }),
  ] });
  const sel = COL.columnRange(v, T(0, 0, 0), T(1, 0, 0));
  eq(sel.info.beatCount, 2);
  for (const n of ['deleteNote', 'deleteBeat', 'palmMute']) {
    const r = run(n, v, cur(1, 0, 0), sel);
    eq(r.score.tracks.map((t) => t.measures[0].voices[1]), v.tracks.map((t) => t.measures[0].voices[1]), `${n}: voice 2 untouched`);
  }
  eq(run('transpose', v, cur(1, 0, 0), sel, 1).score.tracks.map((t) => t.measures[0].voices[1]), v.tracks.map((t) => t.measures[0].voices[1]));
  eq(JSON.parse(CL.buildClip(v, sel).text).tracks.map((t) => t.measures[0].voices.length), [2, 2]);
  const p = PC.pasteColumns(v, cur(0, 0, 0), sel, mclip([entry([8]), entry([9])]));
  eq(p.score.tracks.map((t) => [t.measures[0].voices, t.measures[0].beats.length]), [[undefined, 1], [undefined, 1]]);
});
test('pickup: overwrite keeps measure fields and the pickup flag on every mapped track; insert at measure 0 moves the carried fields to the new first measure and drops the flag; the cursor lands after the inserted measures', () => {
  const p = model({ tracks: [
    tab([{ pickup: true, timeSignature: { beats: 4, beatType: 4 }, keySignature: 2, clef: 'treble', beats: [nt('quarter', 1, 1)] }, { beats: [nt('whole', 1, 2)] }]),
    tab([{ pickup: true, timeSignature: { beats: 4, beatType: 4 }, beats: [nt('quarter', 2, 1)] }, { beats: [nt('whole', 2, 2)] }], { name: 'B' }),
  ] });
  const clip = mclip([entry([7, 8]), entry([5, 6])]);
  const sel = COL.columnRange(p, T(0, 0, 0), T(1, 0, 0));
  const ov = PC.pasteColumns(p, cur(0, 0, 0), sel, clip);
  eq([ov.announce.id, ov.announce.added, meta(ov.score)[0][0].pickup, meta(ov.score)[1][0].pickup, meta(ov.score)[0][0].keySignature], ['pastedOver', 0, true, true, 2]);
  const ins = PC.pasteColumns(p, cur(0, 0, 0), null, clip, { insert: true });
  eq([ins.score.tracks.map((t) => t.measures.length), meta(ins.score).map((m) => m.map((x) => 'pickup' in x))], [[4, 4], [[false, false, false, false], [false, false, false, false]]]);
  eq([meta(ins.score)[0][0].keySignature, meta(ins.score)[0][2].keySignature, meta(ins.score)[1][0].timeSignature], [2, undefined, { beats: 4, beatType: 4 }]);
  eq([ins.cursor, fret(ins.score, 0, 0), fret(ins.score, 0, 1)], [cur(0, 2, 0), 7, 8]);
  ok(same(ins.score));
  eq(said(run('fill', p, cur(0, 0, 0), sel)), 'Nothing to fill', 'a column fill leaves the full second measure and the pickup alone');
});

// ---------- paste mapping ----------
test('paste: a 1-track clip onto a column goes to the top track only, even with hidden tracks in the span; a multi-track clip on a single-track selection maps below it', () => {
  const s = gaps();
  const col = COL.columnRange(s, T(0, 0, 0), T(4, 1, 0));
  const one = PA.applyPaste(s, cur(4, 1, 0), col, mclip([entry([9])]));
  eq([fret(one.score, 0, 0), one.score.tracks[2] === s.tracks[2], one.score.tracks[4] === s.tracks[4], one.cursor.track], [9, true, true, 0]);
  const single = SEL.selectionRange(s, 2, { measure: 0, beat: 0 }, { measure: 0, beat: 0 });
  const r = PC.pasteColumns(s, cur(2, 0, 0), single, mclip([entry([1]), entry([2])]));
  eq([r.announce.tracks, fret(r.score, 2, 0), fret(r.score, 4, 0)], [2, 1, 2], 'notation track 2 then bass 4');
});
test('paste: more targets than clip tracks leaves the rest byte-identical; a clip wider than the visible tracks reports the dropped count', () => {
  const s = gaps();
  const r = PC.pasteColumns(s, cur(4, 2, 0), null, mclip([entry([1]), entry([2]), entry([3])]), { insert: true });
  eq([r.announce.tracks, r.announce.droppedTracks, r.score.tracks.map((t) => t.measures.length)], [1, 2, [4, 4, 4, 4, 4]]);
  eq(describe(r.announce), 'Inserted 1 measure at measure 3, 1 track, 2 clip tracks not pasted');
  const two = PC.pasteColumns(s, cur(0, 0, 0), null, mclip([entry([1]), entry([2])]), { insert: true });
  ok(two.score.tracks[1].measures.length === 4 && two.score.tracks[4] !== s.tracks[4], 'inserted columns reach every track');
  eq(v1(two.score, 4, 1), v1(s, 4, 0), 'the unmapped bass only shifted');
});
test('paste: tempo marks rehome per mapped track after all the writes; an insert paste does not rehome (the marks shift with their measures)', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole')] }, { beats: [nt('whole', 1, 0, { tempo: 90 })] }]),
    tab([{ beats: [nt('whole')] }, { beats: [nt('whole', 2, 0, { tempo: 110 })] }], { name: 'B' }),
  ] });
  const ins = PC.pasteColumns(s, cur(0, 1, 0), null, mclip([entry([1]), entry([2])]), { insert: true });
  eq([ins.announce.id, v1(ins.score, 0, 2)[0].tempo], ['pasted', 90]);
  const over = PC.pasteColumns(s, cur(0, 1, 0), COL.columnRange(s, T(0, 1, 0), T(1, 1, 0)), mclip([{ tuning: TUNING, measures: [{ beats: [nt('half', 1, 1), nt('half', 1, 2)] }] }, entry([2])]));
  eq([over.announce.tempoRemoved, v1(over.score, 0, 1)[0].tempo, v1(over.score, 1, 1)[0].tempo], [0, 90, undefined], 'track 1 keeps its onset-0 mark; track 2 had lost its own to track 1 at the same onset');
});

// ---------- range edits ----------
test('Ctrl+Delete and Shift+Delete over a column with hidden tracks: hidden tracks keep their beats for Ctrl+Delete, lose the column for Shift+Delete; deleting every column keeps one measure per track', () => {
  const s = gaps();
  const col = COL.columnRange(s, T(0, 0, 0), T(4, 2, 0));
  const r = run('deleteBeat', s, cur(4, 2, 0), col);
  eq([r.score.tracks[1] === s.tracks[1], r.score.tracks[3] === s.tracks[3], v1(r.score, 0, 0), v1(r.score, 4, 2)], [true, true, [], []]);
  const m = run('deleteMeasure', s, cur(4, 2, 0), col);
  eq(m.score.tracks.map((t) => t.measures.length), [1, 1, 1, 1, 1]);
  ok(same(m.score));
});
test('transpose over a column is all or nothing: a failing note on the last track leaves the score the same object and names that track; the first failure in track order is the one named; pitch-only notes are skipped, not failures', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 3)] }, { beats: [nt('whole', 1, 4)] }]),
    { name: 'N', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }, { beats: [nt('whole', 2, 2)] }] },
    tab([{ beats: [nt('whole', 1, 5)] }, { beats: [nt('whole', 1, 24)] }], { name: 'Last' }),
  ] });
  const sel = COL.columnRange(s, T(0, 0, 0), T(2, 1, 0));
  const bad = run('transpose', s, cur(2, 1, 0), sel, 1);
  eq([bad.changed, bad.score === s, said(bad)], [false, true, "Can't transpose, measure 2 on track 3 would go above fret 24"]);
  const down = run('transpose', s, cur(2, 1, 0), sel, -2);
  eq([down.changed, fret(down.score, 0, 0), fret(down.score, 2, 1)], [true, 1, 22]);
  const low = run('transpose', s, cur(2, 1, 0), sel, -4);
  eq([fret(low.score, 0, 0), low.score.tracks[0].measures[0].beats[0].notes[0].string, said(low)], [4, 2, 'Transposed 5 notes down 4 semitones on 3 tracks, 2 moved to another string, 1 pitch-only note skipped'], '2.3.3: below fret 0 moves to another string');
  const s6 = model({ tracks: [tab([{ beats: [nt('whole', 1, 3)] }]), tab([{ beats: [nt('whole', 6, 0)] }], { name: 'Low' })] });
  const stuck = run('transpose', s6, cur(1, 0, 0), COL.columnRange(s6, T(0, 0, 0), T(1, 0, 0)), -1);
  eq([stuck.changed, stuck.score === s6, said(stuck)], [false, true, "Can't transpose, measure 1 on track 2 would go below fret 0"]);
});
test('effects over a column: skip counts for notation-only tracks, needsTab only when no selected track has TAB, beat effects use every track', () => {
  const s = gaps();
  const sel = COL.columnRange(s, T(0, 0, 0), T(4, 1, 0));
  const x = run('ghostNote', s, cur(4, 1, 0), sel);
  eq(said(x), 'Ghost note on, 4 notes on 2 tracks, 1 track without TAB skipped');
  eq([x.announce.tracks, x.announce.skippedTracks, x.score.tracks[2] === s.tracks[2]], [2, 1, true]);
  const p = run('palmMute', s, cur(4, 1, 0), sel);
  eq([p.announce.tracks, p.announce.skippedTracks], [3, 0], 'beat effects run on notation tracks too');
  const two = model({ tracks: [{ name: 'A', measures: [{ beats: [nt('whole')] }] }, { name: 'B', measures: [{ beats: [nt('whole')] }] }, tab([{ beats: [nt('whole')] }], { name: 'C' })] });
  const none = run('slide', two, cur(1, 0, 0), COL.columnRange(two, T(0, 0, 0), T(1, 0, 0)));
  eq([none.changed, said(none)], [false, 'Needs a TAB staff']);
  const some = run('slide', two, cur(2, 0, 0), COL.columnRange(two, T(0, 0, 0), T(2, 0, 0)));
  eq([some.announce.tracks, some.announce.skippedTracks], [1, 2]);
  ok(said(some).endsWith('2 tracks without TAB skipped'), said(some));
});
test('F over a column: hidden tracks are never filled; Delete on rests only says "Already rests" and changes nothing', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter')] }]), hid(1), tab([{ beats: [] }], { name: 'C' })] });
  const sel = COL.columnRange(s, T(0, 0, 0), T(2, 0, 0));
  const f = run('fill', s, cur(2, 0, 0), sel);
  eq([said(f), f.score.tracks[1] === s.tracks[1]], ['Filled 2 measures on 2 tracks, 3 rests added', true]);
  const rests = model({ tracks: [tab([{ beats: [rest('whole')] }]), tab([{ beats: [rest('whole')] }], { name: 'B' })] });
  const d = run('deleteNote', rests, cur(1, 0, 0), COL.columnRange(rests, T(0, 0, 0), T(1, 0, 0)));
  eq([d.changed, d.score === rests, said(d)], [false, true, 'Already rests']);
});

// ---------- hostile multi-track clips ----------
test('parseClip: odd containers and entries are refused or sanitized, never thrown; the result does not alias the input; Object.prototype stays clean', () => {
  const e = (n = 1) => ({ tuning: TUNING, measures: Array.from({ length: n }, () => ({ beats: [nt('whole')] })) });
  const base = () => ({ type: 'music-score-clip', version: 1, kind: 'measures', tracks: [e(), e()] });
  const id = (x) => CL.parseClip(x).refused?.id;
  let b = base(); b.tracks = [e(), , e()]; eq(id(b), 'clipInvalid', 'sparse');
  b = base(); b.tracks = { 0: e(), 1: e(), length: 2 }; eq(id(b), 'clipInvalid', 'array-like');
  b = base(); b.tracks[1].tuning = 'E2'; eq(id(b), 'clipInvalid', 'string tuning');
  b = base(); b.tracks[1].tuning = []; eq(id(b), 'clipInvalid', 'empty tuning');
  b = base(); b.tracks[1] = { tuning: TUNING, beats: [nt('whole')] }; eq(id(b), 'clipInvalid', 'mixed kinds');
  b = base(); b.tracks[1].measures = []; eq(id(b), 'clipInvalid', 'one empty entry');
  b = base(); b.tracks.forEach((t) => { t.measures = []; }); eq(CL.parseClip(b).clip.tracks.length, 2, 'all empty is rectangular');
  eq(id(clipOf('measures', Array.from({ length: 33 }, (_, i) => e(1 + (i % 2))))), 'clipTooLarge', 'too many tracks wins over unequal lengths');
  b = base(); b.kind = 'beats'; eq(id(b), 'clipInvalid');
  b = base(); b.kind = 'bogus'; eq(id(b), 'clipInvalid');
  b = base(); b.type = 'x'; eq(id(b), 'notClip');
  b = base(); b.version = 2; ok(id(b) !== undefined, 'future version refused');
  const np = Object.create(null); Object.assign(np, e()); b = base(); b.tracks[1] = np;
  ok(CL.parseClip(b).clip || id(b), 'null-prototype entry decides without throwing');
  b = base(); b.tracks[0].extra = { constructor: { prototype: { polluted: 1 } } };
  CL.parseClip(b);
  eq({}.polluted, undefined);
  b = base();
  const r = CL.parseClip(b);
  r.clip.tracks[0].measures[0].beats[0].notes[0].fret = 99;
  eq(b.tracks[0].measures[0].beats[0].notes[0].fret, 0, 'no aliasing with the input');
  eq(id('{"type":"music-score-clip","version":1,"kind":"measures","tracks":[{"measures":[{"beats":[]}]},{"measures":[{"beats":[]}],"__proto__":{"a":1}}]}'), 'clipInvalid');
  eq(id('{"type":"music-score-clip","version":1,"kind":"measures","tracks":[{"measures":[{"beats":[]}]},{"measures":[{"beats":[{"type":"rest","duration":"whole","x":{"__proto__":1}}]}]}]}'), 'clipInvalid', 'nested in a beat');
  b = base(); Object.defineProperty(b.tracks[0], 'tuning', { enumerable: true, get() { throw new Error('g'); } });
  eq(id(b), 'clipInvalid');
  eq(id({ ...base(), tracks: new Proxy([e(), e()], { get() { throw new Error('p'); } }) }), 'clipInvalid', 'throwing proxy');
});
test('parseClip: per-entry limits are checked on each entry (notes per beat, beats per voice incl. voice 2), and 32 entries at the limit parse', () => {
  const e = (n = 1) => ({ tuning: TUNING, measures: Array.from({ length: n }, () => ({ beats: [nt('whole')] })) });
  const id = (x) => CL.parseClip(x).refused?.id;
  const last = (m) => clipOf('measures', [e(), e(), m]);
  eq(id(last({ tuning: TUNING, measures: [{ beats: Array.from({ length: 257 }, () => rest('64th')) }] })), 'clipTooLarge', 'last entry over beats per voice');
  eq(id(last({ tuning: TUNING, measures: [{ voices: [{ beats: [] }, { beats: Array.from({ length: 257 }, () => rest('64th')) }] }] })), 'clipTooLarge', 'voice 2 of the last entry');
  eq(id(last({ tuning: TUNING, measures: [{ beats: [{ type: 'note', duration: 'whole', notes: Array.from({ length: 17 }, (_, k) => ({ string: 1, fret: k })) }] }] })), 'clipTooLarge');
  ok(CL.parseClip(clipOf('measures', Array.from({ length: 32 }, () => e(2)))).clip.tracks.length === 32);
  const big = CL.parseClip(clipOf('measures', Array.from({ length: 32 }, () => e(2000))));
  ok(big.clip?.tracks.length === 32 && big.clip.tracks[31].measures.length === 2000, '32 x 2000 measures just fits in 5 MB');
});
test('column copy of 32 tracks pastes back onto a 32-track score with nothing dropped; one extra clip track on 31 tracks is dropped and counted', () => {
  const mk = (n) => model({ tracks: Array.from({ length: n }, (_, i) => tab([{ beats: [nt('whole', 1, i % 20)] }, { beats: [] }], { name: `T${i}` })) });
  const s = mk(32);
  const sel = COL.columnRange(s, T(0, 0, 0), T(31, 0, 0));
  eq(sel.tracks.length, 32);
  const clip = CL.parseClip(CL.buildClip(s, sel).text).clip;
  eq(clip.tracks.length, 32);
  const r = PC.pasteColumns(s, cur(0, 1, 0), null, clip);
  eq([r.announce.tracks, r.announce.droppedTracks, fret(r.score, 31, 1)], [32, 0, 31 % 20]);
  const r31 = PC.pasteColumns(mk(31), cur(0, 1, 0), null, clip);
  eq([r31.announce.tracks, r31.announce.droppedTracks], [31, 1]);
  ok(same(r.score) && same(r31.score));
});
test('clearParts / removeParts: the cursor is on the top track at the first filled slice; the count is the total beatCount', () => {
  const s = gaps();
  const sel = COL.columnRange(s, T(0, 1, 0), T(4, 2, 0));
  const c = RE.clearParts(s, sel);
  eq([c.cursor, c.count], [{ track: 0, measure: 1, beat: 0 }, sel.info.beatCount]);
  const r = RE.removeParts(s, sel);
  eq([r.cursor.track, r.tempoRemoved], [0, 0]);
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-columns-edge: ${r.name}`);
    else { fail++; console.log(`FAIL editor-columns-edge: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
