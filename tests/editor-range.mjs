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

// ---------- A. paste replace and insert ----------
const PA = await imp('src/editor/model/paste.js');
const A = await imp('src/editor/model/access.js');
const whole = (f) => ({ beats: [nt('whole', 1, f)] });
const copyOf = (s, ti, a, b) => parse(CL.buildClip(s, SEL.selectionRange(s, ti, P(a, 0), P(b, 0))).text);
test('criterion 1: Ctrl+V with no selection on blank measures overwrites them: the score keeps its 8 measures, the other track is unchanged (same object), one result', () => {
  const s = model({ tracks: [tab([...[1, 2, 3, 4].map(whole), ...Array.from({ length: 4 }, () => ({ beats: [] }))]), tab(Array.from({ length: 8 }, (_, i) => whole(i)), { name: 'B' })] });
  const clip = copyOf(s, 0, 0, 3);
  eq(clip.measures.length, 4);
  const r = PA.applyPaste(s, cur(0, 4, 0), null, clip);
  eq(r.score.tracks[0].measures.map((m) => m.beats[0]?.notes[0].fret ?? null), [1, 2, 3, 4, 1, 2, 3, 4]);
  eq([r.score.tracks[0].measures.length, r.score.tracks[1].measures.length], [8, 8]);
  ok(r.score.tracks[1] === s.tracks[1], 'the other track keeps its identity');
  eq([r.cursor, said(r)], [cur(0, 7, 1), 'Pasted 4 measures over measures 5 to 8'], 'no measure after: the end of the last written one');
  ok(same(r.score));
});
test('criterion 2: the overwrite length follows the clip, not the selection', () => {
  const s = model({ tracks: [tab(Array.from({ length: 8 }, (_, i) => whole(i)))] });
  const two = parse(clipText('measures', [whole(20), whole(21)]));
  const three = parse(clipText('measures', [whole(20), whole(21), whole(22)]));
  const frets = (r) => r.score.tracks[0].measures.map((m) => m.beats[0].notes[0].fret);
  const a = PA.applyPaste(s, cur(0, 3, 0), SEL.selectionRange(s, 0, P(2, 0), P(3, 0)), two);
  eq([frets(a), said(a), a.cursor], [[0, 1, 20, 21, 4, 5, 6, 7], 'Pasted 2 measures over measures 3 to 4', cur(0, 4, 0)]);
  const b = PA.applyPaste(s, cur(0, 5, 0), SEL.selectionRange(s, 0, P(2, 0), P(5, 0)), two);
  eq(frets(b), [0, 1, 20, 21, 4, 5, 6, 7], 'the rest of the selection is left as it was');
  ok(b.score.tracks[0].measures[4] === s.tracks[0].measures[4]);
  const c = PA.applyPaste(s, cur(0, 2, 0), SEL.selectionRange(s, 0, P(2, 0), P(2, 0)), three);
  eq([frets(c), said(c)], [[0, 1, 20, 21, 22, 5, 6, 7], 'Pasted 3 measures over measures 3 to 5']);
});
test('criteria 3 / 4: past the end the overwrite appends columns to every track with no trailing empty measure; from the slot of an underfull last measure it goes after it', () => {
  const s = model({ tracks: [tab([whole(1), whole(2), whole(3), { beats: [] }]), tab([whole(9)], { name: 'B' })] });
  const three = parse(clipText('measures', [whole(20), whole(21), whole(22)]));
  const r = PA.applyPaste(s, cur(0, 3, 0), null, three);
  eq([r.score.tracks[0].measures.length, r.score.tracks[1].measures.length], [6, 6]);
  eq(r.score.tracks[0].measures.map((m) => m.beats[0].notes[0].fret), [1, 2, 3, 20, 21, 22]);
  eq(r.score.tracks[1].measures.slice(1), Array.from({ length: 5 }, () => ({ beats: [] })), 'the short track is padded, then appended');
  eq([said(r), r.cursor], ['Pasted 3 measures over measure 4, 2 measures added', cur(0, 5, 1)]);
  const u = model({ tracks: [tab([whole(1), { beats: [nt('half', 1, 5)] }])] });
  const two = parse(clipText('measures', [whole(20), { beats: [nt('half', 1, 21)] }]));
  const end = PA.applyPaste(u, cur(0, 1, 1), null, two);
  eq(end.score.tracks[0].measures.map((m) => m.beats.map((b) => b.notes[0].fret)), [[1], [5], [20], [21]], 'appended after the measure, nothing empty left');
  eq([said(end), end.cursor], ['Pasted 2 measures at the end, measures 3 to 4', cur(0, 3, 1)]);
  eq(said(PA.applyPaste(u, cur(0, 1, 1), null, parse(clipText('measures', [whole(20)])))), 'Pasted 1 measure at the end, measure 3');
  ok(same(r.score) && same(end.score));
});
test('criterion 5: with no selection, a blank target but a non-blank next measure: the clip inserts and says so; a grace or a voice-2 note makes a measure non-blank, hidden rests do not', () => {
  const s = model({ tracks: [tab([whole(1), { beats: [] }, whole(3)])] });
  const two = parse(clipText('measures', [whole(20), whole(21)]));
  const r = PA.applyPaste(s, cur(0, 1, 0), null, two);
  eq(r.score.tracks[0].measures.map((m) => m.beats[0]?.notes[0].fret ?? null), [1, 20, 21, null, 3]);
  eq([said(r), r.cursor], ['Inserted 2 measures at measure 2', cur(0, 3, 0)]);
  ok(A.isBlankMeasure(model({ tracks: [tab([{ beats: [rest('half', { hidden: true }), rest('half')] }])] }), 0, 0), 'rests only');
  ok(!A.isBlankMeasure(model({ tracks: [tab([{ beats: [grace()] }])] }), 0, 0), 'a grace counts as a note');
  ok(!A.isBlankMeasure(model({ tracks: [tab([{ voices: [{ beats: [rest('whole')] }, { beats: [nt('whole')] }] }])] }), 0, 0), 'voice 2');
  ok(A.isBlankMeasure(s, 0, 9) && A.isBlankMeasure(model({ tracks: [tab([null, whole(1)])] }), 0, 0), 'past the end, a hole');
});
test('criterion 6 (model): insert paste: a measures clip always inserts before the target (the selection\'s first measure); a beats clip inserts before the selection start and keeps the selected beats', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 2), grace(), nt('quarter', 1, 3), nt('quarter', 1, 4)] }, { beats: [] }])] });
  const two = parse(clipText('measures', [whole(20), whole(21)]));
  const ins = PA.applyPaste(s, cur(0, 1, 0), null, two, { insert: true });
  eq([ins.score.tracks[0].measures.length, said(ins), ins.cursor], [4, 'Inserted 2 measures at measure 2', cur(0, 3, 0)]);
  const sel = SEL.selectionRange(s, 0, P(0, 3), P(0, 4));
  eq(PA.applyPaste(s, cur(0, 0, 4), sel, two, { insert: true }).announce.at, 1);
  const beats = parse(clipText('beats', [nt('8th', 1, 9), nt('8th', 1, 8)]));
  const b = PA.applyPaste(s, cur(0, 0, 4), sel, beats, { insert: true });
  eq(v1(b.score, 0, 0).map((x) => x.notes[0].fret), [1, 2, 9, 8, 3, 3, 4], 'before the leading grace of the start beat; nothing removed');
  eq([said(b), b.cursor], ['Pasted 2 beats', cur(0, 0, 5)]);
  const blank = SEL.selectionRange(s, 0, P(1, 0), P(1, 0));
  const z = PA.applyPaste(s, cur(0, 1, 0), blank, beats);
  eq([v1(z.score, 0, 1).length, said(z)], [2, 'Pasted 2 beats'], 'a beats clip on a blank selection: no "replaced"');
  ok(same(ins.score) && same(b.score) && same(z.score));
});
test('criteria 7 / 8: a measures clip on a beats selection is refused; an overwrite keeps the measure fields and replaces both voices', () => {
  const s = model({ tracks: [tab([
    { beats: [nt('half'), nt('half')], pickup: true, timeSignature: { beats: 3, beatType: 4 } },
    { voices: [{ beats: [nt('half', 1, 1)] }, { beats: [nt('half', 4, 4)] }], barline: 'repeatEnd', repeatCount: 2, ending: [1], section: 'A' },
  ])] });
  const clip = parse(clipText('measures', [whole(20), { voices: [{ beats: [nt('quarter', 2, 2)] }, { beats: [nt('quarter', 5, 5)] }] }]));
  eq(PA.applyPaste(s, cur(0, 0, 0), SEL.selectionRange(s, 0, P(0, 0), P(0, 0)), clip), { refused: { id: 'pasteNeedsMeasures' } });
  eq(describe({ id: 'pasteNeedsMeasures' }), 'Select whole measures to paste measures');
  const both = SEL.selectionRange(s, 0, P(0, 0), P(1, 1));
  eq(both.info.kind, 'measures');
  const r = PA.applyPaste(s, cur(0, 1, 1), both, parse(clipText('measures', [whole(20), whole(21)])));
  eq(r.score.tracks[0].measures, [
    { pickup: true, timeSignature: { beats: 3, beatType: 4 }, beats: [nt('whole', 1, 20)] },
    { barline: 'repeatEnd', repeatCount: 2, ending: [1], section: 'A', beats: [nt('whole', 1, 21)] },
  ], 'measure fields kept, voice 2 gone with the old content');
  const v = PA.applyPaste(s, cur(0, 1, 1), both, clip);
  eq(v.score.tracks[0].measures[1].voices, [{ beats: [nt('quarter', 2, 2)] }, { beats: [nt('quarter', 5, 5)] }]);
  ok(same(r.score) && same(v.score));
});
test('criterion 9: tempo marks on overwritten beats move to the pasted beat at that onset, else to the lowest other track with a beat there (hidden included), else they are dropped and counted', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('quarter', 1, 0, { tempo: 90 }), nt('quarter', 1, 0, { tempo: 100 }), nt('quarter'), nt('8th', 1, 0, { tempo: 110 }), nt('8th', 1, 0, { tempo: 120 })] }, whole(1)]),
    { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [nt('half'), nt('quarter'), nt('quarter')] }] },
    tab([{ beats: [nt('quarter'), nt('quarter'), nt('half')] }], { name: 'C' }),
  ] });
  const clip = parse(clipText('measures', [{ beats: [nt('half', 1, 7), nt('half', 1, 8)] }]));
  const r = PA.applyPaste(s, cur(0, 0, 0), SEL.selectionRange(s, 0, P(0, 0), P(0, 4)), clip);
  eq(v1(r.score, 0, 0).map((b) => b.tempo ?? null), [90, null], 'onset 0: the pasted beat');
  eq(v1(r.score, 1, 0).map((b) => b.tempo ?? null), [null, null, 110], 'onset 3/4: the hidden track 2 first');
  eq(v1(r.score, 2, 0).map((b) => b.tempo ?? null), [null, 100, null], 'onset 1/4: track 3');
  eq(said(r), 'Pasted 1 measure over measure 1, 1 tempo mark removed', 'onset 7/8: no beat anywhere');
  ok(same(r.score));
});
test('criterion 11 (model): the 2000-measure limit counts the appended columns; an empty measures clip pastes nothing; a slot after graces only stays in its measure', () => {
  const big = model({ tracks: [tab(Array.from({ length: L.measuresPerTrack - 1 }, () => ({ beats: [] })))] });
  const two = parse(clipText('measures', [{ beats: [] }, { beats: [] }]));
  ok(PA.applyPaste(big, cur(0, L.measuresPerTrack - 3, 0), null, two).score, 'overwrites inside the score');
  eq(PA.applyPaste(big, cur(0, L.measuresPerTrack - 2, 0), null, two).score.tracks[0].measures.length, L.measuresPerTrack, 'one appended: 2000');
  const full = model({ tracks: [tab(Array.from({ length: L.measuresPerTrack }, () => ({ beats: [] })))] });
  eq(PA.applyPaste(full, cur(0, L.measuresPerTrack - 1, 0), null, two), { refused: { id: 'tooLarge' } });
  eq(PA.applyPaste(big, cur(0, 0, 0), null, { kind: 'measures', tuning: null, measures: [] }), { refused: { id: 'nothingToPaste' } });
  eq(PA.targetMeasure(model({ tracks: [tab([{ beats: [grace()] }])] }), cur(0, 0, 1)), 0);
});

// ---------- B. effects over a selection ----------
const q4 = (extra = {}) => ({ beats: [1, 2, 3, 4].map((f) => nt('quarter', 1, f, extra)) });
test('criterion 12: P on 8 selected beats turns palm mute on for all, again off; on a mixed selection on for all; undo label palm mute', () => {
  const s = model({ tracks: [tab([q4(), q4()])] });
  const sel = SEL.selectionRange(s, 0, P(0, 0), P(1, 3));
  const on = run('palmMute', s, cur(0, 1, 3), sel);
  eq([on.score.tracks[0].measures.flatMap((m) => m.beats.map((b) => b.palmMute ?? null)), said(on)], [Array(8).fill(true), 'Palm mute on, 8 beats']);
  const off = run('palmMute', on.score, cur(0, 1, 3), SEL.selectionRange(on.score, 0, P(0, 0), P(1, 3)));
  eq([off.score.tracks[0].measures.flatMap((m) => m.beats.map((b) => b.palmMute ?? null)), said(off)], [Array(8).fill(null), 'Palm mute off, 8 beats']);
  eq(off.score.tracks[0].measures, s.tracks[0].measures, 'off deletes the key, never writes false');
  const mixed = model({ tracks: [tab([{ beats: [nt('half', 1, 0, { palmMute: true }), nt('half')] }])] });
  const m = run('palmMute', mixed, cur(0, 0, 1), SEL.selectionRange(mixed, 0, P(0, 0), P(0, 1)));
  eq(m.score.tracks[0].measures[0].beats.map((b) => b.palmMute), [true, true]);
  eq([CMD.undoLabel('palmMute', on.announce), CMD.COMMANDS.palmMute.keepsSelection], ['palm mute', true]);
  ok(same(on.score) && same(off.score));
});
test('criterion 13: dynamics mf, mf, f with D all become mf; all mf with D become f; a rest takes a dynamic (onRest); the noNotation suffix once on a TAB-only track', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 1, 0, { dynamic: 'mf' }), nt('quarter', 1, 0, { dynamic: 'mf' }), nt('quarter', 1, 0, { dynamic: 'f' }), rest('quarter')] }])] });
  const sel = SEL.selectionRange(s, 0, P(0, 0), P(0, 3));
  const r = run('louder', s, cur(0, 0, 3), sel);
  eq([r.score.tracks[0].measures[0].beats.map((b) => b.dynamic), said(r)], [['mf', 'mf', 'mf', 'mf'], 'Dynamic mf, 4 beats']);
  const r2 = run('louder', r.score, cur(0, 0, 3), SEL.selectionRange(r.score, 0, P(0, 0), P(0, 3)));
  eq(r2.score.tracks[0].measures[0].beats.map((b) => b.dynamic), ['f', 'f', 'f', 'f']);
  const t = model({ tracks: [tab([q4()], { showStandardNotation: false })] });
  eq(said(run('louder', t, cur(0, 0, 3), SEL.selectionRange(t, 0, P(0, 0), P(0, 3)))), 'Dynamic mf, 4 beats, not shown on TAB only');
  eq(said(run('accent', t, cur(0, 0, 3), SEL.selectionRange(t, 0, P(0, 0), P(0, 3)))), 'Accent, 4 beats, not shown on TAB only');
  eq(said(run('accent', s, cur(0, 0, 3), sel)), 'Accent, 3 beats', 'a beat row without onRest skips the rest');
});
test('criteria 14 / 15: H over chords puts hammerPull on every note and removes slide (no link suffix for a range); X toggles mute on the existing notes only and never adds one', () => {
  const chord = (f) => ({ type: 'note', duration: 'half', notes: [{ string: 1, fret: f, slide: true }, { string: 3, fret: f }] });
  const s = model({ tracks: [tab([{ beats: [chord(1), chord(2)] }])] });
  const sel = SEL.selectionRange(s, 0, P(0, 0), P(0, 1));
  const h = run('hammerPull', s, cur(0, 0, 1), sel);
  eq(h.score.tracks[0].measures[0].beats.map((b) => b.notes), [[{ string: 1, fret: 1, hammerPull: true }, { string: 3, fret: 1, hammerPull: true }], [{ string: 1, fret: 2, hammerPull: true }, { string: 3, fret: 2, hammerPull: true }]]);
  eq(said(h), 'Hammer-on/pull-off on, 4 notes', 'no "no next note" suffix');
  const x = model({ tracks: [tab([{ beats: [nt('quarter', 2, 5), rest('quarter'), { type: 'note', duration: 'half', notes: [{ string: 1, fret: 0, harmonic: 'natural' }, { string: 4, fret: 2 }] }] }])] });
  const xs = run('deadNote', x, cur(0, 0, 2), SEL.selectionRange(x, 0, P(0, 0), P(0, 2)));
  eq(xs.score.tracks[0].measures[0].beats, [nt('quarter', 2, 5, {}), rest('quarter'), { type: 'note', duration: 'half', notes: [{ string: 1, fret: 0 }, { string: 4, fret: 2 }] }].map((b, i) => (i === 1 ? b : { ...b, notes: b.notes.map((n) => ({ ...n, mute: true })) })), 'mute on the 3 notes, harmonic removed (exclusive), the rest stays a rest');
  eq(said(xs), 'Dead note on, 3 notes');
});
test('criterion 16: a note row over rests only says "No notes in the selection" and an onRest beat row over no beat "No beats in the selection" (nothing changes); a note row on a track without TAB says needsTab', () => {
  const s = model({ tracks: [tab([{ beats: [rest('half'), rest('half')] }, { beats: [] }])] });
  const r = run('vibrato', s, cur(0, 0, 1), SEL.selectionRange(s, 0, P(0, 0), P(0, 1)));
  eq([r.changed, said(r)], [false, 'No notes in the selection']);
  eq(said(run('hammerPull', s, cur(0, 0, 1), SEL.selectionRange(s, 0, P(0, 0), P(0, 1)))), 'No notes in the selection');
  const b = run('palmMute', s, cur(0, 1, 0), SEL.selectionRange(s, 0, P(1, 0), P(1, 0)));
  eq([b.changed, said(b)], [false, 'No beats in the selection'], 'a blank selection');
  const n = model({ tracks: [{ name: 'N', measures: [q4()] }] });
  eq(said(run('slide', n, cur(0, 0, 1), SEL.selectionRange(n, 0, P(0, 0), P(0, 1)))), 'Needs a TAB staff');
  const v = run('vibrato', n, cur(0, 0, 1), SEL.selectionRange(n, 0, P(0, 0), P(0, 1)));
  eq(said(v), 'Vibrato, 2 beats', 'beat rows work on notation-only tracks');
});
test('criterion 21 (effects): graces, voice 2, pitch-only notes (note rows need a string) and ties are untouched', () => {
  const s = model({ tracks: [tab([{ voices: [{ beats: [grace(), tn('half', 1, 3, { tieStart: true }), { type: 'note', duration: 'half', notes: [{ pitch: 'C4' }, { string: 2, fret: 1 }] }] }, { beats: [nt('whole', 4, 4)] }] }, { beats: [tn('whole', 1, 3, { tieEnd: true })] }])] });
  const sel = SEL.selectionRange(s, 0, P(0, 1), P(0, 2));
  const g = run('ghostNote', s, cur(0, 0, 2), sel);
  const m = g.score.tracks[0].measures[0];
  eq(m.voices[0].beats[0], grace(), 'grace untouched');
  eq(m.voices[1], s.tracks[0].measures[0].voices[1], 'voice 2 untouched');
  eq([m.voices[0].beats[1].notes[0], m.voices[0].beats[2].notes], [{ string: 1, fret: 3, tieStart: true, ghost: true }, [{ pitch: 'C4' }, { string: 2, fret: 1, ghost: true }]]);
  eq(said(g), 'Ghost note on, 2 notes');
  ok(g.score.tracks[0].measures[1] === s.tracks[0].measures[1] && same(g.score), 'the tie partner outside is untouched');
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
