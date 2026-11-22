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

// ---------- C. transpose ----------
test('criterion 18: the cursor note moves one fret up (pitch removed, mute and harmonic kept, harmonicFret shifted, ties removed on both sides) or an octave down; the slot, a rest or an empty string say "No note here"; needsTab without TAB', () => {
  const s = model({ tracks: [tab([{ beats: [
    { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5, pitch: 'A4', mute: true, tieStart: true }, { string: 2, fret: 12, harmonic: 'natural', harmonicFret: 12 }] },
    tn('quarter', 1, 5, { tieEnd: true }), tn('quarter', 3, 14), rest('quarter'),
  ] }, { beats: [nt('half')] }])] });
  const up = run('transpose', s, cur(0, 0, 0, 1), null, 1);
  eq(v1(up.score, 0, 0)[0].notes[0], { string: 1, fret: 6, mute: true });
  eq(v1(up.score, 0, 0)[1].notes[0], { string: 1, fret: 5 }, 'the partner loses tieEnd');
  eq([said(up), CMD.undoLabel('transpose')], ['Fret 6, up 1 semitone', 'transpose']);
  const h = run('transpose', s, cur(0, 0, 0, 2), null, 1);
  eq(v1(h.score, 0, 0)[0].notes[1], { string: 2, fret: 13, harmonic: 'natural', harmonicFret: 13 });
  const oct = run('transpose', s, cur(0, 0, 2, 3), null, -12);
  eq([v1(oct.score, 0, 0)[2].notes[0].fret, said(oct)], [2, 'Fret 2, down an octave']);
  for (const c of [cur(0, 0, 3, 1), cur(0, 0, 2, 1), cur(0, 1, 1, 1)]) eq(said(run('transpose', s, c, null, 1)), 'No note here');
  const n = model({ tracks: [{ name: 'N', measures: [q4()] }] });
  eq(said(run('transpose', n, cur(0, 0, 0), null, 1)), 'Needs a TAB staff');
  ok(same(up.score) && same(h.score) && same(oct.score));
});
test('criterion 19: all or nothing: a selection with fret 0 and Ctrl+Down, fret 24 at maxFret 24 and Ctrl+Up, or a harmonicFret leaving the range are refused naming the first measure; nothing changes', () => {
  const s = model({ tracks: [tab([q4(), { beats: [tn('whole', 1, 0)] }, { beats: [tn('whole', 1, 24)] }])] });
  const all = SEL.selectionRange(s, 0, P(0, 0), P(2, 0));
  const down = run('transpose', s, cur(0, 2, 0), all, -1);
  eq([down.changed, said(down)], [false, "Can't transpose, measure 2 would go below fret 0"]);
  const upr = run('transpose', s, cur(0, 2, 0), all, 1);
  eq([upr.changed, said(upr)], [false, "Can't transpose, measure 3 would go above fret 24"]);
  eq(said(run('transpose', s, cur(0, 2, 0), null, 1)), "Can't transpose, measure 3 would go above fret 24", 'the cursor note too');
  const hf = model({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 1, fret: 3, harmonic: 'natural', harmonicFret: 24 }] }] }])] });
  eq(run('transpose', hf, cur(0, 0, 0), SEL.selectionRange(hf, 0, P(0, 0), P(0, 0)), 1).changed, false);
  const ok12 = run('transpose', s, cur(0, 2, 0), SEL.selectionRange(s, 0, P(0, 0), P(0, 3)), 12);
  eq([v1(ok12.score, 0, 0).map((b) => b.notes[0].fret), said(ok12)], [[13, 14, 15, 16], 'Transposed 4 notes up an octave']);
});
test('criterion 20: a tie inside the selection is kept; a tie whose other note is outside (across the barline too) or is pitch-only loses both flags; ties on graces are left alone', () => {
  const s = model({ tracks: [tab([
    { beats: [tn('quarter', 1, 3, { tieStart: true }), tn('quarter', 1, 3, { tieEnd: true, tieStart: true }), tn('half', 1, 3, { tieEnd: true, tieStart: true })] },
    { beats: [tn('whole', 1, 3, { tieEnd: true })] },
  ])] });
  const r = run('transpose', s, cur(0, 0, 2), SEL.selectionRange(s, 0, P(0, 0), P(0, 2)), 2);
  eq(v1(r.score, 0, 0).map((b) => b.notes[0]), [{ string: 1, fret: 5, tieStart: true }, { string: 1, fret: 5, tieEnd: true, tieStart: true }, { string: 1, fret: 5, tieEnd: true }]);
  eq(v1(r.score, 0, 1)[0].notes[0], { string: 1, fret: 3 }, 'the partner outside loses tieEnd');
  const left = run('transpose', s, cur(0, 1, 0), SEL.selectionRange(s, 0, P(0, 2), P(1, 0)), 1);
  eq([v1(left.score, 0, 0)[1].notes[0], v1(left.score, 0, 0)[2].notes[0], v1(left.score, 0, 1)[0].notes[0]], [{ string: 1, fret: 3, tieEnd: true }, { string: 1, fret: 4, tieStart: true }, { string: 1, fret: 4, tieEnd: true }]);
  const g = model({ tracks: [tab([{ beats: [{ type: 'grace', duration: '16th', notes: [{ string: 1, fret: 2, tieStart: true }] }, tn('whole', 1, 2, { tieEnd: true })] }])] });
  const gr = run('transpose', g, cur(0, 0, 1), SEL.selectionRange(g, 0, P(0, 1), P(0, 1)), 1);
  eq(v1(gr.score, 0, 0).map((b) => b.notes[0]), [{ string: 1, fret: 3, tieStart: true }, { string: 1, fret: 3 }], 'the grace comes with its main beat and keeps its flag; the main beat has no main partner, so its tieEnd goes');
  ok(same(r.score) && same(left.score));
});
test('criterion 21 (transpose): pitch-only notes and voice 2 are unchanged and pitch-only notes counted; graces included; a selection needs no TAB staff; nothing fretted is refused', () => {
  const s = model({ tracks: [tab([{ voices: [{ beats: [grace(2, 3), { type: 'note', duration: 'half', notes: [{ pitch: 'C4' }, { string: 2, fret: 1 }] }, rest('half')] }, { beats: [nt('whole', 4, 4)] }] }])] });
  const r = run('transpose', s, cur(0, 0, 2), SEL.selectionRange(s, 0, P(0, 1), P(0, 2)), 1);
  const m = r.score.tracks[0].measures[0];
  eq([m.voices[0].beats[0].notes[0].fret, m.voices[0].beats[1].notes], [4, [{ pitch: 'C4' }, { string: 2, fret: 2 }]]);
  ok(m.voices[1] === s.tracks[0].measures[0].voices[1], 'voice 2 untouched');
  eq(said(r), 'Transposed 2 notes up 1 semitone, 1 pitch-only note skipped');
  const n = model({ tracks: [{ name: 'N', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }, { string: 3, fret: 2 }] }] }] }] });
  const nr = run('transpose', n, cur(0, 0, 0), SEL.selectionRange(n, 0, P(0, 0), P(0, 0)), -1);
  eq([nr.score.tracks[0].measures[0].beats[0].notes, said(nr)], [[{ pitch: 'C4' }, { string: 3, fret: 1 }], 'Transposed 1 note down 1 semitone, 1 pitch-only note skipped']);
  const p = model({ tracks: [{ name: 'N', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }, { beats: [] }] }] });
  const none = run('transpose', p, cur(0, 0, 0), SEL.selectionRange(p, 0, P(0, 0), P(0, 0)), 1);
  eq([none.changed, said(none)], [false, 'No fretted notes to transpose, 1 pitch-only note skipped']);
  eq(said(run('transpose', p, cur(0, 1, 0), SEL.selectionRange(p, 0, P(1, 0), P(1, 0)), 1)), 'No fretted notes to transpose', 'a blank selection');
  ok(CMD.COMMANDS.transpose.keepsSelection && same(r.score) && same(nr.score));
});

// ---------- E. Ctrl+Shift+Home / End ----------
test('criterion 28 (model): selectScoreStart goes to the first position of measure 1, selectScoreEnd to the last position of the last measure (the slot included); at the edge they announce it', () => {
  const s = model({ tracks: [tab([{ beats: [grace(), nt('half')] }, { beats: [nt('whole')] }, { beats: [nt('half')] }])] });
  const go = (name, c) => CMD.run(name, s, c, st(), { allowAppend: false });
  eq(go('selectScoreStart', cur(0, 2, 0)).cursor, cur(0, 0, 1), 'past the grace');
  eq(go('selectScoreStart', cur(0, 0, 1)).announce, { id: 'startOfScore' });
  eq(go('selectScoreEnd', cur(0, 0, 1)).cursor, cur(0, 2, 1), 'the slot of the underfull last measure');
  eq(go('selectScoreEnd', cur(0, 2, 1)).announce, { id: 'endOfScore' });
  eq([CMD.COMMANDS.selectScoreStart.kind, CMD.COMMANDS.selectScoreEnd.kind], ['select', 'select']);
});

// ---------- D. reflow: split and cascade ----------
const RS = await imp('src/editor/model/reflowSplit.js');
const { R, ZERO } = await imp('src/rational.js');
test('criterion 23: in 4/4 a dotted half on beat 4 is split into a tied quarter ending measure 1 and a half with tieEnd on every chord note opening measure 2; a rest splits without ties; the cursor on it stays on the first piece', () => {
  const chord = { type: 'note', duration: 'half', dots: 1, notes: [{ string: 1, fret: 3 }, { string: 2, fret: 5 }] };
  const s = model({ tracks: [tab([{ beats: [nt('half'), nt('quarter'), chord] }, { beats: [nt('quarter')] }])] });
  const r = run('reflow', s, cur(0, 0, 2), null);
  eq(v1(r.score, 0, 0)[2], { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 3, tieStart: true }, { string: 2, fret: 5, tieStart: true }] });
  eq(v1(r.score, 0, 1), [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 3, tieEnd: true }, { string: 2, fret: 5, tieEnd: true }] }, nt('quarter')]);
  eq([said(r), r.cursor], ['Moved 1 beat to measure 2, beat 3 split at the barline', cur(0, 0, 2)]);
  const rs = model({ tracks: [tab([{ beats: [nt('half'), nt('quarter'), rest('half', { dots: 1, hidden: true })] }])] });
  const rr = run('reflow', rs, cur(0, 0, 0), null);
  eq([v1(rr.score, 0, 0)[2], v1(rr.score, 0, 1)], [rest('quarter', { hidden: true }), [rest('half', { hidden: true })]]);
  eq(said(rr), 'Measure 2 added, moved 1 beat to it, beat 3 split at the barline');
  const long = model({ tracks: [tab([{ beats: [nt('8th'), nt('whole', 1, 2)] }])] });
  const rl = run('reflow', long, cur(0, 0, 0), null);
  eq([v1(rl.score, 0, 0).map((b) => b.duration), v1(rl.score, 0, 1).map((b) => b.duration)], [['8th', '8th', 'quarter', 'half'], ['8th']], 'each side a greedy run aligned to its onset');
  ok(same(r.score) && same(rr.score) && same(rl.score));
});
test('criterion 24: a crossing triplet (or tuplets) beat stays and is announced; plainRun refuses what plain durations cannot write', () => {
  const s = model({ tracks: [tab([{ beats: [nt('half'), nt('quarter'), nt('half', 1, 0, { tuplet: 3 })] }, { beats: [] }])] });
  const r = run('reflow', s, cur(0, 0, 0), null);
  eq([r.changed, said(r)], [false, 'Beat 3 crosses the barline and stays']);
  eq(RS.plainRun(R(1, 3), R(1, 1)), null, 'a triplet onset');
  eq(RS.plainRun(ZERO, R(3, 4)), ['half', 'quarter']);
  eq(RS.plainRun(R(3, 4), R(1, 1)), ['quarter']);
});
test('criteria 25 / 26: a beat inserted into measure 1 of 4 full measures: one Shift+F reflows 4 measures, adds 1 column, one result, the cursor follows its beat; the cascade stops at the first measure that is not over', () => {
  const s = model({ tracks: [tab([q4(), q4(), q4(), q4()]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  const ins = run('insertBeat', s, cur(0, 0, 0), null);
  const r = run('reflow', ins.score, cur(0, 0, 4), null);
  eq(r.score.tracks[0].measures.map((m) => m.beats.length), [4, 4, 4, 4, 1]);
  eq([0, 1, 2, 3].map((mi) => r.score.tracks[0].measures[mi].beats.map((b) => b.notes?.[0].fret ?? 'r').join('')), ['r123', '4123', '4123', '4123'], 'measures 1-4 full');
  eq([r.score.tracks[1].measures.length, said(r)], [5, 'Reflowed 4 measures, 1 measure added']);
  eq(r.cursor, cur(0, 1, 0), 'beat 4 of measure 1 moved to the start of measure 2');
  const stop = model({ tracks: [tab([{ beats: [...q4().beats, nt('quarter', 1, 9)] }, { beats: [nt('half')] }, { beats: [...q4().beats, nt('quarter')] }])] });
  const r2 = run('reflow', stop, cur(0, 0, 0), null);
  eq([r2.score.tracks[0].measures.map((m) => m.beats.length), said(r2)], [[4, 2, 5], 'Moved 1 beat to measure 2'], 'measure 2 is not over: measure 3 stays overfull');
  const mixed = model({ tracks: [tab([{ beats: [nt('whole'), nt('half')] }, { beats: [nt('quarter'), nt('half', 1, 0, { tuplet: 3 }), nt('quarter')] }])] });
  eq(said(run('reflow', mixed, cur(0, 0, 0), null)), 'Reflowed 2 measures, 1 measure added, measure 2 beat 3 crosses the barline and stays');
});
test('D-D3: the cascade is all or nothing against the 2000-measure and 256-beat limits, and ignores the selection', () => {
  const n = L.measuresPerTrack;
  const s = model({ tracks: [tab(Array.from({ length: n }, (_, i) => (i === 0 ? { beats: [nt('whole'), nt('whole')] } : { beats: [nt('whole')] })))] });
  const r = run('reflow', s, cur(0, 0, 0), null);
  eq([r.changed, said(r)], [false, 'The score would be too large'], 'the last measure would need a column 2001');
  const big = model({ timeSignature: { beats: 32, beatType: 4 }, tracks: [tab([{ beats: [nt('whole'), ...Array.from({ length: 8 }, () => nt('whole')), nt('quarter')] }, { beats: [...Array.from({ length: 255 }, () => nt('64th')), nt('whole', 1, 0)] }])] });
  eq(run('reflow', big, cur(0, 0, 0), null).changed, false, 'the next measure would pass 256 beats');
  const sel = SEL.selectionRange(s, 0, P(1, 0), P(2, 0));
  eq(run('reflow', model({ tracks: [tab([{ beats: [nt('whole'), nt('half')] }, q4()])] }), cur(0, 0, 0), sel).score.tracks[0].measures.length, 3);
});
test('criterion 27 / D-D2: the pieces carry the fields by table (first / last / every), dots are dropped, unknown fields go first; trailing graces after a split beat stay; sanitize identity', () => {
  const x = { keep: 1 };
  const beat = {
    type: 'note', duration: 'whole', dots: 1, x, tempo: 90, text: 'Am', lyrics: 'la', dynamic: 'mf', articulations: ['accent'], palmMute: true, letRing: true, vibrato: true,
    notes: [{ string: 1, fret: 5, x, mute: true, ghost: true, harmonic: 'natural', harmonicFret: 12, pitch: 'A4', tieEnd: true, tieStart: true, slideIn: 'below', bend: 'full', hammerPull: true, slide: true, slideOut: 'down' }],
  };
  const pieces = RS.splitBeat(beat, ['half', 'quarter', 'whole']);
  eq(pieces[0], { type: 'note', duration: 'half', x, tempo: 90, text: 'Am', lyrics: 'la', dynamic: 'mf', articulations: ['accent'], palmMute: true, letRing: true, vibrato: true,
    notes: [{ string: 1, fret: 5, x, mute: true, ghost: true, harmonic: 'natural', harmonicFret: 12, pitch: 'A4', tieEnd: true, slideIn: 'below', bend: 'full', tieStart: true }] });
  eq(pieces[1], { type: 'note', duration: 'quarter', palmMute: true, letRing: true, vibrato: true, notes: [{ string: 1, fret: 5, mute: true, ghost: true, harmonic: 'natural', harmonicFret: 12, pitch: 'A4', tieStart: true, tieEnd: true }] });
  eq(pieces[2], { type: 'note', duration: 'whole', palmMute: true, letRing: true, vibrato: true, notes: [{ string: 1, fret: 5, mute: true, ghost: true, harmonic: 'natural', harmonicFret: 12, pitch: 'A4', tieStart: true, hammerPull: true, slide: true, slideOut: 'down', tieEnd: true }] });
  eq(RS.splitBeat({ type: 'rest', duration: 'half', hidden: true, slash: true, tempo: 60 }, ['quarter', 'quarter']), [{ type: 'rest', duration: 'quarter', hidden: true, slash: true, tempo: 60 }, { type: 'rest', duration: 'quarter', hidden: true, slash: true }]);
  eq([RS.BEAT_EVERY, RS.NOTE_LAST].map((t) => t.length), [6, 4]);
  const s = model({ tracks: [tab([{ beats: [nt('half'), nt('quarter'), { ...beat, duration: 'half' }, grace()] }, { beats: [tn('quarter', 1, 5, { tieEnd: true })] }])] });
  const r = run('reflow', s, cur(0, 0, 0), null);
  eq(v1(r.score, 0, 0).map((b) => b.type + b.duration), ['notehalf', 'notequarter', 'notequarter', 'grace16th'], 'the trailing grace stays');
  eq(v1(r.score, 0, 1).map((b) => b.type + b.duration), ['notehalf', 'notequarter'], 'the dotted half: a quarter before the barline, a half after');
  ok(same(r.score), 'sanitize identity');
  eq(v1(r.score, 0, 1)[0].notes[0].tieStart, true, 'the original tieStart (to the next measure\'s tieEnd) is on the last piece');
});

// ---------- B10 / E12 ----------
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');
const { leadSoloF } = await imp('examples/lead-solo-f.js');
const { defaultScore } = await imp('src/editor/model/defaultScore.js');
const { EFFECTS } = await imp('src/editor/model/effectTable.js');
const B10_START = () => [
  ['default', defaultScore()], ['lead-riff', model(leadRiff)], ['lead-solo-f', model(leadSoloF)], ['example-score', model(exampleScore)],
  ['rich', model({ tracks: [tab([{ beats: [nt('quarter'), grace(), tn('quarter', 2, 2, { tieStart: true }), rest('quarter', { hidden: true }), nt('quarter', 1, 0, { dots: 1 })] },
    { voices: [{ beats: [grace(), tn('half', 2, 2, { tieEnd: true }), nt('half', 1, 0, { tempo: 80 }), nt('8th', 1, 1, { tuplet: 3 })] }, { beats: [nt('whole', 4, 0)] }] }, { beats: [{ type: 'note', duration: 'whole', slash: true }] }, null, { beats: [] }, { beats: [] }]),
  { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [nt('half', 1, 0, { tempo: 70 })] }] }] })],
  ['mixed', model({ timeSignature: { beats: 3, beatType: 4 }, tracks: [{ name: 'Notes', measures: [{ beats: [{ type: 'note', duration: 'half', notes: [{ pitch: 'C4' }, { string: 2, fret: 22 }] }] }] }, tab([{ beats: [] }], { tuning: ['E1', 'A1', 'D2', 'G2'], showStandardNotation: false })] })],
];
const NAVS = ['moveLeft', 'moveRight', 'moveRight', 'moveUp', 'moveDown', 'prevMeasure', 'nextMeasure', 'measureStart', 'measureEnd', 'scoreStart', 'scoreEnd', 'prevTrack', 'nextTrack'];
const EDITS = ['digit', 'digit', 'digit', 'deleteNote', 'deleteBeat', 'deleteMeasure', 'toggleRest', 'toggleTie', 'shorter', 'longer', 'cycleDots', 'toggleTriplet', 'insertBeat', 'insertMeasureAfter', 'insertMeasureBefore',
  'fill', 'reflow', 'reflow', 'reflow', 'transpose', 'transpose', 'transpose', ...EFFECTS.map((d) => d.name)];
const SELECTS = ['selectLeft', 'selectRight', 'selectRight', 'selectMeasureStart', 'selectMeasureEnd', 'selectPrevMeasure', 'selectNextMeasure', 'selectAll', 'selectScoreStart', 'selectScoreEnd'];
const SEMIS = [1, -1, 12, -12];
test('B10 (2.3.1): 6 start scores x 2000 random steps mixing commands, selections (blank ones too), range effects, transpose, the reflow cascade and both pastes keep sanitizeScore(model) === model, a valid cursor and a valid selection; undo all restores the start, redo all the end', () => {
  const rnd = mulberry32(20261231);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  for (const [label, start] of B10_START()) {
    let s = start;
    let c = C.clampCursor(s, cur(0, 0, 0));
    let state = st();
    let sel = null;
    let clipboard = null;
    const history = [];
    const seen = { pasteOver: 0, insert: 0, rangeFx: 0, transpose: 0, cascade: 0, blank: 0 };
    for (let i = 0; i < 2000; i++) {
      const r0 = rnd();
      const before = { s, c };
      let next = null;
      if (r0 < 0.22) {
        const name = pick(SELECTS);
        const anchor = CMD.COMMANDS[name].fromStart ? SEL.startOf(s, c) : sel?.anchor ?? { measure: c.measure, beat: c.beat };
        const r = CMD.run(name, s, c, state, { allowAppend: false });
        c = r.cursor; state = r.state;
        sel = SEL.selectionRange(s, c.track, anchor, c);
        if (sel && !sel.info.beatCount) seen.blank++;
      } else if (r0 < 0.30) {
        const range = sel ?? CL.cursorRange(s, c);
        if (range) clipboard = CL.buildClip(s, range).text;
      } else if (r0 < 0.40) {
        if (clipboard) {
          const insert = rnd() < 0.4;
          const r = PA.applyPaste(s, c, sel, CL.parseClip(clipboard).clip, { insert });
          if (!r.refused && io.exportedLength(r.score) <= L.jsonChars) {
            next = r;
            if (insert) seen.insert++;
            if (r.announce.id === 'pastedOver') seen.pasteOver++;
            sel = null;
          }
        }
      } else {
        const name = rnd() < 0.3 ? pick(NAVS) : pick(EDITS);
        const arg = name === 'transpose' ? pick(SEMIS) : Math.floor(rnd() * 10);
        const r = CMD.run(name, s, c, state, { maxFret: 24, now: i * 1000, twoDigitDelayMs: 800, allowAppend: true, selection: sel }, arg);
        state = r.state;
        if (r.changed) {
          next = r;
          if (sel && CMD.COMMANDS[name].keepsSelection) seen[name === 'transpose' ? 'transpose' : 'rangeFx']++;
          if (r.announce?.id === 'reflowedMany') seen.cascade++;
        } else c = r.cursor;
        if (r.changed && sel && CMD.COMMANDS[name].keepsSelection) sel = SEL.selectionRange(r.score, sel.track, sel.anchor, sel.focus);
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
    ok(seen.insert > 10 && seen.rangeFx > 10 && seen.pasteOver > 5 && seen.transpose > 2 && seen.cascade > 2 && seen.blank > 10 && history.length > 300, `${label}: ${JSON.stringify(seen)}, ${history.length} steps`);
    const end = s;
    for (let k = history.length - 1; k >= 0; k--) { ok(history[k].after.s === s); s = history[k].before.s; }
    ok(s === start, `${label}: undo all restores the start`);
    for (const h of history) s = h.after.s;
    ok(s === end, `${label}: redo all reaches the end`);
  }
});
test('E12 (2.3.1): unknown fields survive overwrite pastes (measure-level ones kept), range effects, transpose and the reflow split (beat and note fields on the first piece) when the operation does not own them', () => {
  const x = { keep: [1, { deep: true }] };
  const s0 = model({ x, tracks: [
    { x, name: 'A', showTablature: true, measures: [
      { x, beats: [{ x, type: 'note', duration: 'quarter', notes: [{ x, string: 1, fret: 2 }] }, { x, type: 'rest', duration: 'quarter' }, { x, type: 'note', duration: 'half', notes: [{ x, string: 2, fret: 1 }] }] },
      { x, voices: [{ x, beats: [{ x, type: 'note', duration: 'half', notes: [{ x, string: 2, fret: 1 }] }] }, { x, beats: [] }] },
      { x, beats: [] },
    ] },
    { x, name: 'B', showTablature: true, measures: [{ x, beats: [] }, { x, beats: [] }, { x, beats: [] }] },
  ] });
  const count = (v) => (Array.isArray(v) ? v.reduce((a, y) => a + count(y), 0) : v && typeof v === 'object' ? (JSON.stringify(v.x) === JSON.stringify(x) ? 1 : 0) + Object.values(v).reduce((a, y) => a + count(y), 0) : 0);
  const n0 = count(s0);
  const all = SEL.selectionRange(s0, 0, P(0, 0), P(1, 1));
  eq(count(run('palmMute', s0, cur(0, 1, 1), all).score), n0);
  eq(count(run('ghostNote', s0, cur(0, 1, 1), all).score), n0);
  eq(count(run('transpose', s0, cur(0, 1, 1), all, 3).score), n0);
  eq(count(run('transpose', s0, cur(0, 0, 0), null, 3).score), n0);
  const clip = CL.parseClip(CL.buildClip(s0, SEL.selectionRange(s0, 0, P(0, 0), P(0, 2))).text).clip;
  const over = PA.applyPaste(s0, cur(0, 2, 0), null, clip);
  eq([over.announce.id, count(over.score)], ['pastedOver', n0 + 5], 'the blank measure 3 keeps its own field; the pasted beats and notes bring theirs');
  const onto = PA.applyPaste(s0, cur(0, 1, 0), SEL.selectionRange(s0, 0, P(1, 0), P(1, 1)), clip);
  eq(count(onto.score), n0 - 4 + 5, 'measure 2 keeps its field; its two voices and their beats and note go');
  const long = model({ tracks: [tab([{ x, beats: [nt('half'), nt('quarter'), { x, type: 'note', duration: 'half', notes: [{ x, string: 1, fret: 0 }] }] }])] });
  const r = run('reflow', long, cur(0, 0, 0), null);
  eq([count(long), count(r.score)], [3, 3], 'the unknown fields go to the first piece only');
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
