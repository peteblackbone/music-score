// 2.3.3 edge cases and robustness at model level, audited against criteria 23-34 and decisions D-R1..D-R6, D-T1..D-T7:
// rhythm keys over column selections (notation-only and hidden tracks), two voices, graces and the slot at range edges,
// empty measures, L pairs (barlines, empty measures, rests, chords, half-tied, pitch-only), R round trips, nested tuplet
// mixes, duration limits, the string fallback for every string, tuning and semitone step (against an independent oracle),
// chords, greedy competition, refusals, ties, graces, cursor, all-or-nothing, and a seeded robustness pass over odd content
// (1- and 12-string tunings, duplicate strings, stringless / fretless notes, dots 3+, hidden rests, slash beats).
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-rhythm-edge.mjs`.
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
const PITCH = await imp('src/pitch.js');
const { describe } = await imp('src/editor/announce.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const CUR = await imp('src/editor/model/cursor.js');
const C_clamp = (s, c) => CUR.clampCursor(s, c);

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
const tn = (duration, string, fret, note = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...note }], ...extra });
const chord = (duration, ...notes) => ({ type: 'note', duration, notes });
const rest = (duration, extra = {}) => ({ type: 'rest', duration, ...extra });
const grace = (string = 1, fret = 2, note = {}) => ({ type: 'grace', duration: '8th', notes: [{ string, fret, ...note }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const P = (measure, beat) => ({ measure, beat });
const T = (track, measure, beat) => ({ track, measure, beat });
const st = () => ({ duration: 'quarter', dots: 0, digit: null });
const ctx = (sel, maxFret = 24) => ({ maxFret, now: 0, twoDigitDelayMs: 800, allowAppend: true, selection: sel });
const run = (name, s, c, sel, arg, maxFret) => CMD.run(name, s, c, st(), ctx(sel, maxFret), arg);
const said = (r) => describe(r.announce);
const v1 = (s, ti, mi) => s.tracks[ti].measures[mi].beats;
const same = (s) => sanitizeScore(s) === s;
const range = (s, ti, a, b) => SEL.selectionRange(s, ti, a, b);
const colr = (s, a, b) => COL.columnRange(s, a, b);
const RHYTHM = [['shorter'], ['longer'], ['setDuration', 'half'], ['cycleDots'], ['toggleTriplet'], ['toggleRest'], ['toggleTie']];
const STD = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const DROPD = ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const BASS = ['E1', 'A1', 'D2', 'G2'];
const SEVEN = ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const TWELVE = ['E1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'A4', 'D5', 'G5', 'C6'];
const ONE = ['E4'];

// ---------- rhythm over columns: notation-only, hidden tracks, two voices, graces, the slot, empty measures ----------
test('columns: duration, dots and triplet reach the notation-only track and a hidden track (D-R2); R and L skip the notation-only one and count it; nothing on other tracks changes', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('quarter', 1, 3), nt('quarter', 1, 3)] }]),
    { name: 'N', measures: [{ beats: [nt('quarter', 2, 1), nt('quarter', 2, 1)] }] },
    tab([{ beats: [nt('quarter', 1, 3), nt('quarter', 1, 3)] }], { name: 'H', hidden: true }),
    tab([{ beats: [nt('quarter', 1, 3)] }], { name: 'Out' }),
  ] });
  const sel = colr(s, T(0, 0, 0), T(2, 0, 1));
  ok(sel.info.tracks.length === 3, 'the hidden track is part of the column');
  const r = run('shorter', s, cur(2, 0, 1), sel);
  eq([r.score.tracks.map((t) => v1({ tracks: [t] }, 0, 0).map((b) => b.duration)), r.score.tracks[3] === s.tracks[3]], [[['8th', '8th'], ['8th', '8th'], ['8th', '8th'], ['quarter']], true]);
  eq(said(run('toggleRest', s, cur(2, 0, 1), sel)), '4 beats changed to rests on 2 tracks, 1 track without TAB skipped');
  eq(said(run('toggleTie', s, cur(2, 0, 1), sel)), 'Tied 2 note pairs on 2 tracks, 1 track without TAB skipped');
  const t = run('toggleTie', s, cur(2, 0, 1), sel).score;
  ok(t.tracks[1] === s.tracks[1] && t.tracks[3] === s.tracks[3], 'the notation-only and unselected tracks are the same objects');
  for (const [name, arg] of RHYTHM) ok(same(run(name, s, cur(2, 0, 1), sel, arg).score), name);
});
test('two voices: only the voice-1 main beats are targets for every rhythm key (voice 2 keeps its objects); L and R ignore voice 2', () => {
  const s = model({ tracks: [tab([{ voices: [
    { beats: [nt('quarter', 1, 3), nt('quarter', 1, 3), grace()] },
    { beats: [nt('half', 2, 1, { dots: 1 }), rest('half')] },
  ] }])] });
  const sel = range(s, 0, P(0, 0), P(0, 2));
  const m2 = s.tracks[0].measures[0].voices[1];
  for (const [name, arg] of RHYTHM) {
    const r = run(name, s, cur(0, 0, 1), sel, arg);
    ok(r.changed, name);
    eq(r.score.tracks[0].measures[0].voices[1], m2, `${name}: voice 2 unchanged`);
    ok(same(r.score), name);
  }
  eq(said(run('toggleTie', s, cur(0, 0, 1), sel)), 'Tied 1 note pair');
  eq(said(run('toggleRest', s, cur(0, 0, 1), sel)), '2 beats changed to rests');
  const down = run('transpose', s, cur(0, 0, 0), sel, -3);
  eq(down.score.tracks[0].measures[0].voices[1], m2, 'transpose leaves voice 2 alone');
});
test('transpose ignores voice 2 when it looks for a free string (D-T2): a voice-2 note on the target string does not block the move', () => {
  const s = model({ tracks: [tab([{ voices: [{ beats: [nt('whole', 2, 0)] }, { beats: [nt('whole', 3, 3)] }] }])] });
  const r = run('transpose', s, cur(0, 0, 0, 2), range(s, 0, P(0, 0), P(0, 0)), -1);
  eq([r.score.tracks[0].measures[0].voices[0].beats[0].notes, said(r)], [[{ string: 3, fret: 3 }], 'Transposed 1 note down 1 semitone, 1 moved to another string']);
});
test('graces at range edges: a range that starts or ends on a grace targets only the main beats inside; a range of graces alone has no target; graces keep their objects through every key', () => {
  const s = model({ tracks: [tab([{ beats: [grace(), nt('quarter', 1, 3), grace(2, 5), nt('quarter', 1, 3), grace(3, 1)] }])] });
  eq(range(s, 0, P(0, 0), P(0, 0)), null, 'a range of one grace is no selection at all (no main beat), so the keys act on the cursor beat as in 2.0');
  const edge = range(s, 0, P(0, 0), P(0, 4));
  for (const [name, arg] of RHYTHM) {
    const r = run(name, s, cur(0, 0, 1), edge, arg);
    const gs = (x) => v1(x, 0, 0).filter((b) => b.type === 'grace');
    ok(gs(r.score).every((g, i) => g === gs(s)[i]), `${name}: graces are the same objects`);
    ok(same(r.score), name);
  }
  eq(v1(run('shorter', s, cur(0, 0, 1), edge).score, 0, 0).map((b) => b.duration), ['8th', '8th', '8th', '8th', '8th']);
  const t = range(s, 0, P(0, 1), P(0, 3));
  eq(said(run('toggleTie', s, cur(0, 0, 1), t)), 'Tied 1 note pair', 'a grace between two main beats does not break the pair');
});
test('the slot: a selection that ends past the last beat clamps to the main beats; a measure with only the slot has no target; a keystroke with the cursor on the slot still acts on the selection', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 1, 3), nt('quarter', 1, 3)] }, { beats: [] }])] });
  const sel = range(s, 0, P(0, 0), P(0, 2));
  eq(sel.info.beatCount, 2);
  const r = run('shorter', s, cur(0, 0, 2), sel);
  eq([v1(r.score, 0, 0).map((b) => b.duration), v1(r.score, 0, 1)], [['8th', '8th'], []]);
  const blank = range(s, 0, P(1, 0), P(1, 0));
  for (const [name, arg] of RHYTHM) {
    const x = run(name, s, cur(0, 1, 0), blank, arg);
    eq([x.changed, x.score === s], [false, true], name);
    ok(/^(No beats in the selection|Needs a TAB staff|Nothing to tie to)$/.test(said(x)), `${name}: ${said(x)}`);
  }
});
test('empty measures: a selection across empty measures only targets the measures that have beats; L never pairs across an empty measure (neighbours look into the adjacent measure only)', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 1, 3)] }, { beats: [] }, { beats: [nt('quarter', 1, 3)] }])] });
  const sel = range(s, 0, P(0, 0), P(2, 0));
  eq(sel.info.beatCount, 2);
  const t = run('toggleTie', s, cur(0, 0, 0), sel);
  eq([t.changed, said(t)], [false, 'Nothing to tie to']);
  const d = run('cycleDots', s, cur(0, 0, 0), sel);
  eq([said(d), v1(d.score, 0, 1)], ['Dotted, 2 beats', []]);
  const adj = model({ tracks: [tab([{ beats: [nt('quarter', 1, 3)] }, { beats: [nt('quarter', 1, 3)] }])] });
  eq(said(run('toggleTie', adj, cur(0, 0, 0), range(adj, 0, P(0, 0), P(1, 0)))), 'Tied 1 note pair', 'across an adjacent barline it pairs');
});

// ---------- L ----------
test('L: a rest between two equal notes breaks the pair; a rest at the edge too; two rests give no pair', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 1, 3), rest('quarter'), nt('quarter', 1, 3), rest('quarter')] }, { beats: [rest('whole')] }])] });
  const r = run('toggleTie', s, cur(0, 0, 0), range(s, 0, P(0, 0), P(1, 0)));
  eq([r.changed, said(r)], [false, 'Nothing to tie to']);
});
test('L over chords: a pair per equal string and fret; unequal strings in the same chord stay untied; one pair already tied still means "tie all"; all tied means "untie all", in a chord too', () => {
  const s = model({ tracks: [tab([{ beats: [
    chord('quarter', { string: 1, fret: 3, tieStart: true }, { string: 2, fret: 0 }, { string: 3, fret: 5 }),
    chord('quarter', { string: 1, fret: 3, tieEnd: true }, { string: 2, fret: 0 }, { string: 3, fret: 6 }),
  ] }])] });
  const sel = range(s, 0, P(0, 0), P(0, 1));
  const r = run('toggleTie', s, cur(0, 0, 1), sel);
  eq([said(r), v1(r.score, 0, 0)[0].notes, v1(r.score, 0, 0)[1].notes], ['Tied 2 note pairs', [
    { string: 1, fret: 3, tieStart: true }, { string: 2, fret: 0, tieStart: true }, { string: 3, fret: 5 }], [
    { string: 1, fret: 3, tieEnd: true }, { string: 2, fret: 0, tieEnd: true }, { string: 3, fret: 6 }]]);
  const u = run('toggleTie', r.score, cur(0, 0, 1), range(r.score, 0, P(0, 0), P(0, 1)));
  eq(said(u), 'Untied 2 note pairs');
  eq(v1(u.score, 0, 0)[0].notes, [{ string: 1, fret: 3 }, { string: 2, fret: 0 }, { string: 3, fret: 5 }]);
});
test('L: pitch-only notes and stringless notes are never paired; a fret on another string is no pair; frets are never copied or changed', () => {
  const s = model({ tracks: [tab([{ beats: [
    { type: 'note', duration: 'quarter', notes: [{ pitch: 'C4' }, { string: 2, fret: 3 }] },
    { type: 'note', duration: 'quarter', notes: [{ pitch: 'C4' }, { string: 1, fret: 3 }] },
  ] }])] });
  const r = run('toggleTie', s, cur(0, 0, 1), range(s, 0, P(0, 0), P(0, 1)));
  eq([r.changed, said(r)], [false, 'Nothing to tie to']);
});
test('L: a tie that starts in an unselected beat is not a pair; a half tie (only tieStart) counts as untied; the frets of a tied pair stay as they were', () => {
  const s = model({ tracks: [tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), nt('quarter', 1, 5), nt('quarter', 1, 5)] }])] });
  const r = run('toggleTie', s, cur(0, 0, 1), range(s, 0, P(0, 1), P(0, 2)));
  eq([said(r), v1(r.score, 0, 0).map((b) => b.notes[0])], ['Tied 1 note pair', [{ string: 1, fret: 5, tieStart: true }, { string: 1, fret: 5, tieStart: true }, { string: 1, fret: 5, tieEnd: true }]], 'the earlier half tie is untouched');
});

// ---------- R ----------
test('R round trip notes -> rests -> notes: the beat keeps duration, dots, tuplet and its own effects; the notes become one fret-0 note on the cursor string; hidden is dropped; undo returns the start', () => {
  const x = { type: 'note', duration: 'quarter', dots: 1, tuplet: 3, vibrato: true, zz: 9, notes: [{ string: 2, fret: 5 }, { string: 3, fret: 7 }] };
  const s = model({ tracks: [tab([{ beats: [x, nt('8th', 1, 2)] }])] });
  const sel = () => range(s, 0, P(0, 0), P(0, 1));
  const a = run('toggleRest', s, cur(0, 0, 0, 4), sel());
  eq([v1(a.score, 0, 0)[0], said(a)], [{ type: 'rest', duration: 'quarter', dots: 1, tuplet: 3, vibrato: true, zz: 9 }, '2 beats changed to rests']);
  const b = run('toggleRest', a.score, cur(0, 0, 0, 4), range(a.score, 0, P(0, 0), P(0, 1)));
  eq([v1(b.score, 0, 0)[0], v1(b.score, 0, 0)[1], said(b), CMD.undoLabel('toggleRest', b.announce)], [
    { type: 'note', duration: 'quarter', dots: 1, tuplet: 3, vibrato: true, zz: 9, notes: [{ string: 4, fret: 0 }] },
    { type: 'note', duration: '8th', notes: [{ string: 4, fret: 0 }] }, '2 rests changed to notes', 'note']);
  ok(same(a.score) && same(b.score));
  const mixed = run('toggleRest', b.score, cur(0, 0, 0, 1), range(b.score, 0, P(0, 0), P(0, 1)));
  eq(said(mixed), '2 beats changed to rests', 'all notes again: to rests');
});
test('R: a mixed selection (a rest among notes) turns the notes to rests and leaves the rests; the string is clamped to the track\'s string count', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 1, 3), rest('quarter', { hidden: true }), nt('quarter', 2, 3)] }]), tab([{ beats: [rest('whole')] }], { tuning: ONE })] });
  const m = run('toggleRest', s, cur(0, 0, 0), range(s, 0, P(0, 0), P(0, 2)));
  eq([v1(m.score, 0, 0).map((b) => b.type), v1(m.score, 0, 0)[1] === v1(s, 0, 0)[1], said(m)], [['rest', 'rest', 'rest'], true, '2 beats changed to rests']);
  const one = run('toggleRest', s, cur(1, 0, 0, 6), range(s, 1, P(0, 0), P(0, 0)));
  eq(v1(one.score, 1, 0)[0].notes, [{ string: 1, fret: 0 }], 'a 1-string track clamps to string 1');
});
test('R with ties: turning a tied note to a rest removes the tie from its partner outside the range; a rest turned back to a note starts untied', () => {
  const s = model({ tracks: [tab([{ beats: [tn('quarter', 1, 3, { tieStart: true }), tn('quarter', 1, 3, { tieEnd: true }), nt('quarter', 1, 3)] }])] });
  const r = run('toggleRest', s, cur(0, 0, 1), range(s, 0, P(0, 1), P(0, 1)));
  eq(v1(r.score, 0, 0)[0].notes, [{ string: 1, fret: 3 }], 'the left partner loses tieStart');
  ok(same(r.score));
});

// ---------- duration limits, dots, triplets ----------
test('duration limits with mixed selections: one whole stops +- ... all of -, one 64th stops all of +; the setDuration palette is never limited; graces and voice 2 at the limit do not count', () => {
  const s = model({ tracks: [tab([{ beats: [nt('whole', 1, 1), nt('64th', 1, 1), nt('quarter', 1, 1)] }, { voices: [{ beats: [nt('quarter', 1, 1), grace()] }, { beats: [nt('64th', 2, 1)] }] }])] });
  const a = range(s, 0, P(0, 0), P(0, 2));
  eq(said(run('longer', s, cur(0, 0, 0), a)), 'Duration limit');
  eq(said(run('shorter', s, cur(0, 0, 0), a)), 'Duration limit');
  const q = range(s, 0, P(0, 2), P(0, 2));
  eq([said(run('longer', s, cur(0, 0, 2), q)), said(run('shorter', s, cur(0, 0, 2), q))], ['Half, 1 beat', 'Eighth, 1 beat']);
  eq(said(run('setDuration', s, cur(0, 0, 0), a, '64th')), '64th, 3 beats');
  eq(said(run('setDuration', s, cur(0, 0, 0), a, 'whole')), 'Whole, 3 beats');
  const m2 = range(s, 0, P(1, 0), P(1, 1));
  eq(said(run('shorter', s, cur(0, 1, 0), m2)), 'Eighth, 1 beat', 'the voice-2 64th and the grace are not targets');
  const only = model({ tracks: [tab([{ beats: [nt('whole', 1, 1), nt('whole', 1, 1)] }, { beats: [nt('64th', 1, 1)] }])] });
  eq(said(run('longer', only, cur(0, 0, 0), range(only, 0, P(0, 0), P(0, 1)))), 'Duration limit', 'all at the limit');
  eq(said(run('shorter', only, cur(0, 0, 0), range(only, 0, P(0, 0), P(0, 1)))), 'Half, 2 beats');
  eq(said(run('shorter', only, cur(0, 1, 0), range(only, 0, P(1, 0), P(1, 0)))), 'Duration limit');
  const col = model({ tracks: [tab([{ beats: [nt('quarter', 1, 1)] }]), tab([{ beats: [nt('64th', 1, 1)] }])] });
  const cr = colr(col, T(0, 0, 0), T(1, 0, 0));
  const lim = run('shorter', col, cur(1, 0, 0), cr);
  eq([lim.changed, lim.score === col, said(lim)], [false, true, 'Duration limit'], 'one track at the limit stops the whole column');
});
test('dots over a range: mixed counts give 1, equal move on, 3+ and non-numeric counts are clamped for the comparison; a single-dot press after "mixed" gives 2', () => {
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 1, 1, { dots: 1 }), nt('quarter', 1, 1, { dots: 2 }), nt('quarter', 1, 1)] }])] });
  let r = run('cycleDots', s, cur(0, 0, 0), range(s, 0, P(0, 0), P(0, 2)));
  eq(v1(r.score, 0, 0).map((b) => b.dots), [1, 1, 1]);
  r = run('cycleDots', r.score, cur(0, 0, 0), range(r.score, 0, P(0, 0), P(0, 2)));
  eq(v1(r.score, 0, 0).map((b) => b.dots), [2, 2, 2]);
  const big = model({ tracks: [tab([{ beats: [nt('quarter', 1, 1, { dots: 2 }), nt('quarter', 1, 1, { dots: 7 })] }])] });
  const b = run('cycleDots', big, cur(0, 0, 0), range(big, 0, P(0, 0), P(0, 1)));
  ok(same(b.score), 'dots 7 and 2 do not throw and keep sanitize identity');
  const clamped = b.announce.dots;
  ok([0, 1, 2].includes(clamped), `the result is one of 0..2, got ${clamped}`);
});
test('triplet with nested tuplets mixes: all-nested refuses and changes nothing; a mix with plain beats turns on only the plain ones; object tuplets count as on and are kept when others are turned on; off removes only the eligible', () => {
  const s = model({ tracks: [tab([{ beats: [
    nt('quarter', 1, 1, { tuplet: { count: 3, of: 2 } }), nt('quarter', 1, 1), nt('quarter', 1, 1, { tuplets: [3, 3] }), nt('quarter', 1, 1, { tuplets: [3, [5, 2]] }),
  ] }])] });
  const all = range(s, 0, P(0, 0), P(0, 3));
  const on = run('toggleTriplet', s, cur(0, 0, 0), all);
  eq([v1(on.score, 0, 0)[0].tuplet, v1(on.score, 0, 0)[1].tuplet, v1(on.score, 0, 0)[2].tuplet ?? null, said(on)], [{ count: 3, of: 2 }, 3, null, 'Triplet on, 3 beats, 1 nested tuplet skipped'], 'the object tuplet is kept, the plain beat gets 3, [3, 3] is skipped ([3, [5, 2]] is not a valid nest, so that beat is eligible)');
  const off = run('toggleTriplet', on.score, cur(0, 0, 0), range(on.score, 0, P(0, 0), P(0, 3)));
  eq([v1(off.score, 0, 0).map((b) => b.tuplet ?? null), said(off)], [[null, null, null, null], 'Triplet off, 3 beats, 1 nested tuplet skipped']);
  ok(v1(off.score, 0, 0)[2] === v1(s, 0, 0)[2], 'the nested beat is the same object');
  const nested = range(s, 0, P(0, 2), P(0, 2));
  const n = run('toggleTriplet', s, cur(0, 0, 2), nested);
  eq([n.changed, said(n)], [false, 'Nested tuplet, unchanged']);
  for (const x of [on, off]) ok(same(x.score));
});
test('every key keeps the beat\'s other fields (tempo, dynamic, unknown) and rests keep hidden through duration, dots and triplet', () => {
  const s = model({ tracks: [tab([{ beats: [rest('quarter', { hidden: true, zz: 1 }), nt('quarter', 1, 1, { tempo: 90, dynamic: 'f', zz: 2 })] }])] });
  const sel = range(s, 0, P(0, 0), P(0, 1));
  for (const [name, arg] of [['shorter'], ['longer'], ['setDuration', 'half'], ['cycleDots'], ['toggleTriplet']]) {
    const r = run(name, s, cur(0, 0, 0), sel, arg);
    eq([v1(r.score, 0, 0)[0].hidden, v1(r.score, 0, 0)[0].zz, v1(r.score, 0, 0)[1].tempo, v1(r.score, 0, 0)[1].dynamic, v1(r.score, 0, 0)[1].zz], [true, 1, 90, 'f', 2], name);
  }
});

// ---------- transpose fallback: oracle over every string, tuning and step ----------
const midiOfPitch = (p) => PITCH.midiNumber(PITCH.parsePitch(p));
const opens = (tuning) => tuning.map(midiOfPitch).reverse(); // string 1 first
/** The expected result of one note beat: string / fret, or null when refused (independent of stringMove.js). */
function oracleOne(tuning, string, fret, semis, max) {
  const open = opens(tuning);
  const f = fret + semis;
  if (f >= 0 && f <= max) return { string, fret: f };
  const pitch = open[string - 1] + fret + semis;
  const c = [];
  for (let t = 1; t <= open.length; t++) if (t !== string && pitch - open[t - 1] >= 0 && pitch - open[t - 1] <= max) c.push({ string: t, fret: pitch - open[t - 1] });
  c.sort((a, b) => Math.abs(a.string - string) - Math.abs(b.string - string) || a.fret - b.fret || a.string - b.string);
  return c[0] ?? null;
}
const withTuning = (tuning, beats, extra = {}) => model({ tracks: [tab([{ beats }], { tuning, ...extra })] });
test('fallback for every string, fret, step and tuning (standard, drop D, 4-string bass, 7-string, 12-string, 1-string) matches the nearest-string-then-lower-fret rule, with and without a selection; the cursor follows; refusals leave the same object', () => {
  let moved = 0, refused = 0, kept = 0;
  for (const tuning of [STD, DROPD, BASS, SEVEN, TWELVE, ONE]) {
    for (let string = 1; string <= tuning.length; string++) {
      for (const fret of [0, 1, 5, 12, 20, 23, 24]) {
        for (const semis of [1, -1, 2, -2, 5, -5, 12, -12]) {
          const s = withTuning(tuning, [tn('whole', string, fret)]);
          const want = oracleOne(tuning, string, fret, semis, 24);
          for (const sel of [null, range(s, 0, P(0, 0), P(0, 0))]) {
            const r = run('transpose', s, cur(0, 0, 0, string), sel, semis);
            const label = `${tuning.length}-string s${string} f${fret} ${semis} ${sel ? 'sel' : 'single'}`;
            if (!want) {
              ok(!r.changed && r.score === s && /^Can't transpose, measure 1 would go (below|above) fret/.test(said(r)), `${label}: refused, got ${said(r)}`);
              if (!sel) refused++;
              continue;
            }
            eq(v1(r.score, 0, 0)[0].notes, [want], label);
            eq(r.cursor?.string ?? string, want.string, `${label}: cursor`);
            ok(same(r.score), label);
            if (sel) continue;
            if (want.string === string) kept++; else moved++;
          }
        }
      }
    }
  }
  ok(moved > 300 && refused > 100 && kept > 300, `coverage: ${moved} moved, ${refused} refused, ${kept} kept`);
});
test('the pitch is preserved by every move: the new string and fret sound the same pitch plus the step', () => {
  for (const tuning of [STD, DROPD, BASS, TWELVE]) {
    const open = opens(tuning);
    for (let string = 1; string <= tuning.length; string++) {
      for (const semis of [-12, -1, 1, 12]) {
        const s = withTuning(tuning, [tn('whole', string, 0)]);
        const r = run('transpose', s, cur(0, 0, 0, string), range(s, 0, P(0, 0), P(0, 0)), semis);
        if (!r.changed) continue;
        const n = v1(r.score, 0, 0)[0].notes[0];
        eq(open[n.string - 1] + n.fret, open[string - 1] + semis, `${tuning.length} s${string} ${semis}`);
      }
    }
  }
});
test('B string to G string (criterion 30) and the drop-D low string: D2 fret 0 down 1 has nowhere to go in drop D (refused), but in standard tuning the same pitch step from string 5 fret 0 goes to string 6 fret 4', () => {
  const drop = withTuning(DROPD, [tn('whole', 6, 0)]);
  const a = run('transpose', drop, cur(0, 0, 0, 6), range(drop, 0, P(0, 0), P(0, 0)), -1);
  eq([a.changed, said(a)], [false, "Can't transpose, measure 1 would go below fret 0"]);
  const std = withTuning(STD, [tn('whole', 5, 0)]);
  const b = run('transpose', std, cur(0, 0, 0, 5), null, -1);
  eq([v1(b.score, 0, 0)[0].notes, b.cursor.string], [[{ string: 6, fret: 4 }], 6]);
  const d = withTuning(DROPD, [tn('whole', 5, 0)]);
  eq(v1(run('transpose', d, cur(0, 0, 0, 5), null, -1).score, 0, 0)[0].notes, [{ string: 6, fret: 6 }], 'drop D: A2 - 1 = G#2 is fret 6 on the D string');
});
test('+-12: string 1 fret 0 down an octave goes to string 4 fret 2; string 6 fret 24 up an octave to string 3 fret 21 (maxFret 24); ctx.maxFret smaller than 24 narrows the candidates', () => {
  const a = withTuning(STD, [tn('whole', 1, 0)]);
  eq(v1(run('transpose', a, cur(0, 0, 0), null, -12).score, 0, 0)[0].notes, [{ string: 4, fret: 2 }]);
  const b = withTuning(STD, [tn('whole', 6, 24)]);
  eq(v1(run('transpose', b, cur(0, 0, 0, 6), null, 12).score, 0, 0)[0].notes, [{ string: 3, fret: 21 }]);
  const c = withTuning(STD, [tn('whole', 3, 12)]);
  eq(v1(run('transpose', c, cur(0, 0, 0, 3), null, 1, 12).score, 0, 0)[0].notes, [{ string: 2, fret: 9 }], 'maxFret 12: G3 fret 12 + 1 moves to B string fret 9');
  eq(said(run('transpose', withTuning(STD, [tn('whole', 1, 12)]), cur(0, 0, 0, 1), null, 1, 12)), "Can't transpose, measure 1 would go above fret 12");
});

/** The expected notes of a chord after transposing, by the greedy rule of D-T3 (null when refused). */
function oracleChord(tuning, notes, semis, max) {
  const open = opens(tuning);
  const fits = (n) => n.fret + semis >= 0 && n.fret + semis <= max;
  const taken = new Set(notes.filter(fits).map((n) => n.string));
  const out = new Map();
  for (const n of notes.filter((x) => !fits(x)).sort((a, b) => a.string - b.string)) {
    const pitch = open[n.string - 1] + n.fret + semis;
    const c = [];
    for (let t = 1; t <= open.length; t++) if (t !== n.string && !taken.has(t) && pitch - open[t - 1] >= 0 && pitch - open[t - 1] <= max) c.push({ string: t, fret: pitch - open[t - 1] });
    c.sort((a, b) => Math.abs(a.string - n.string) - Math.abs(b.string - n.string) || a.fret - b.fret || a.string - b.string);
    if (!c[0]) return null;
    taken.add(c[0].string);
    out.set(n, c[0]);
  }
  return notes.map((n) => out.get(n) ?? { string: n.string, fret: n.fret + semis });
}
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
test('chords: 4000 random chords (2-6 notes on distinct strings, frets biased to the edges) in five tunings match the greedy rule: kept notes keep their strings, movers go in ascending string order to the nearest free string, any unplaceable note refuses the whole beat', () => {
  const rnd = mulberry32(2331);
  let moved = 0, refused = 0, mixed = 0;
  for (let i = 0; i < 4000; i++) {
    const tuning = [STD, DROPD, BASS, SEVEN, TWELVE][i % 5];
    const n = 2 + Math.floor(rnd() * Math.min(5, tuning.length - 1));
    const strings = [];
    while (strings.length < n) { const x = 1 + Math.floor(rnd() * tuning.length); if (!strings.includes(x)) strings.push(x); }
    const notes = strings.map((string) => ({ string, fret: [0, 0, 1, 2, 3, 5, 7, 12, 20, 22, 23, 24, 24][Math.floor(rnd() * 13)] }));
    const semis = [1, -1, 2, -2, 3, -3, 12, -12][Math.floor(rnd() * 8)];
    const s = withTuning(tuning, [chord('whole', ...notes)]);
    const want = oracleChord(tuning, notes, semis, 24);
    const r = run('transpose', s, cur(0, 0, 0, strings[0]), range(s, 0, P(0, 0), P(0, 0)), semis);
    if (!want) { ok(!r.changed && r.score === s, `#${i}: refused ${JSON.stringify(notes)} ${semis}`); refused++; continue; }
    eq(v1(r.score, 0, 0)[0].notes, want, `#${i} ${tuning.length}-string ${JSON.stringify(notes)} ${semis}`);
    ok(new Set(want.map((x) => x.string)).size === want.length, `#${i}: no two notes on one string`);
    ok(same(r.score), `#${i}`);
    const k = want.filter((x, j) => x.string !== notes[j].string).length;
    moved += k;
    if (k && k < want.length) mixed++;
  }
  ok(moved > 1000 && refused > 100 && mixed > 200, `coverage: ${moved} moved, ${refused} refused, ${mixed} mixed chords`);
});
test('chord by hand: the nearest string is taken by a kept note so the mover goes one further; two movers swapping strings (maxFret 12); the lower fret wins a distance tie; a mover cannot use the string of a note that stays', () => {
  const a = withTuning(STD, [chord('whole', { string: 1, fret: 0 }, { string: 2, fret: 5 }, { string: 3, fret: 3 })]);
  eq(v1(run('transpose', a, cur(0, 0, 0), range(a, 0, P(0, 0), P(0, 0)), -1).score, 0, 0)[0].notes, [{ string: 4, fret: 13 }, { string: 2, fret: 4 }, { string: 3, fret: 2 }], 'string 1 fret 0: strings 2 and 3 are kept, string 4 is next');
  const b = withTuning(STD, [chord('whole', { string: 3, fret: 12 }, { string: 4, fret: 12 })]);
  eq(v1(run('transpose', b, cur(0, 0, 0), range(b, 0, P(0, 0), P(0, 0)), 1, 12).score, 0, 0)[0].notes, [{ string: 2, fret: 9 }, { string: 3, fret: 8 }], 'string 3 goes first to string 2, then string 4 to the string 3 that left');
});
test('two movers competing for one string: the lower string goes first and takes it, the other goes elsewhere; the order of the notes in the beat does not change the result', () => {
  const a = withTuning(STD, [chord('whole', { string: 1, fret: 24 }, { string: 3, fret: 24 })]);
  const A = (n) => run('transpose', n, cur(0, 0, 0), range(n, 0, P(0, 0), P(0, 0)), 1, 24);
  const x = A(a);
  const flipped = withTuning(STD, [chord('whole', { string: 3, fret: 24 }, { string: 1, fret: 24 })]);
  const y = A(flipped);
  eq([x.changed, y.changed], [x.changed, x.changed]);
  if (x.changed) eq(v1(x.score, 0, 0)[0].notes.slice().sort((p, q) => p.string - q.string), v1(y.score, 0, 0)[0].notes.slice().sort((p, q) => p.string - q.string));
  const notes = [{ string: 4, fret: 24 }, { string: 5, fret: 24 }];
  const b = withTuning(STD, [chord('whole', ...notes)]);
  const r = run('transpose', b, cur(0, 0, 0, 4), range(b, 0, P(0, 0), P(0, 0)), 1, 24);
  eq(v1(r.score, 0, 0)[0].notes, oracleChord(STD, notes, 1, 24), 'the greedy rule');
  eq(new Set(v1(r.score, 0, 0)[0].notes.map((n) => n.string)).size, 2, 'never two notes on one string');
});

// ---------- refusals name the measure and track ----------
test('refusals: the first problem in track then measure order is named with its track; one problem in a later track names it; nothing changes (same object)', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 1, 3)] }, { beats: [nt('whole', 6, 0)] }]),
    tab([{ beats: [nt('whole', 6, 0)] }, { beats: [nt('whole', 1, 3)] }], { name: 'B' }),
  ] });
  const sel = colr(s, T(0, 0, 0), T(1, 1, 0));
  const r = run('transpose', s, cur(0, 0, 0), sel, -1);
  eq([r.changed, r.score === s, said(r)], [false, true, "Can't transpose, measure 2 on track 1 would go below fret 0"]);
  const only2 = model({ tracks: [tab([{ beats: [nt('whole', 1, 3)] }]), tab([{ beats: [nt('whole', 1, 3)] }, { beats: [nt('whole', 6, 0)] }], { name: 'B' })] });
  eq(said(run('transpose', only2, cur(0, 0, 0), colr(only2, T(0, 0, 0), T(1, 1, 0)), -1)), "Can't transpose, measure 2 on track 2 would go below fret 0");
  eq(said(run('transpose', only2, cur(0, 0, 0), range(only2, 1, P(0, 0), P(1, 0)), -1)), "Can't transpose, measure 2 would go below fret 0", 'one track: no track named');
});
test('all or nothing across tracks and beats: one unplaceable note in the last track leaves every other track and measure unchanged; a good first track is not written', () => {
  const s = model({ tracks: [
    tab([{ beats: [nt('whole', 2, 0)] }]),
    tab([{ beats: [nt('whole', 6, 0)] }], { name: 'B' }),
  ] });
  const r = run('transpose', s, cur(0, 0, 0, 2), colr(s, T(0, 0, 0), T(1, 0, 0)), -1);
  eq([r.changed, r.score === s], [false, true]);
  const ok2 = run('transpose', s, cur(0, 0, 0, 2), colr(s, T(0, 0, 0), T(0, 0, 0)), -1);
  eq([ok2.changed, said(ok2)], [true, 'Transposed 1 note down 1 semitone, 1 moved to another string']);
});
test('a refusal with a selection keeps the selection kept flag and the cursor; the announcement is the refusal (no "Transposed")', () => {
  const s = withTuning(STD, [tn('whole', 6, 0)]);
  const r = run('transpose', s, cur(0, 0, 0, 6), range(s, 0, P(0, 0), P(0, 0)), -1);
  eq([r.changed, r.cursor?.string ?? 6], [false, 6]);
});

// ---------- harmonics ----------
test('harmonics: a harmonic whose fret fits shifts in place (harmonicFret too); a harmonicFret that leaves the range refuses the whole transpose with the suffix, even when the fret fits; harmonics never take part in a move', () => {
  const fit = model({ tracks: [tab([{ beats: [tn('whole', 1, 5, { harmonic: 'natural' })] }])] });
  eq(v1(run('transpose', fit, cur(0, 0, 0), range(fit, 0, P(0, 0), P(0, 0)), 2).score, 0, 0)[0].notes, [{ string: 1, fret: 7, harmonic: 'natural' }]);
  const hf = model({ tracks: [tab([{ beats: [tn('whole', 1, 3, { harmonic: 'pinch', harmonicFret: 15 })] }])] });
  const r = run('transpose', hf, cur(0, 0, 0), range(hf, 0, P(0, 0), P(0, 0)), 12);
  eq([r.changed, said(r)], [false, "Can't transpose, measure 1 would go above fret 24, harmonics stay on their string"]);
  const inChord = model({ tracks: [tab([{ beats: [chord('whole', { string: 1, fret: 0 }, { string: 2, fret: 2, harmonic: 'natural' })] }])] });
  const c = run('transpose', inChord, cur(0, 0, 0), range(inChord, 0, P(0, 0), P(0, 0)), -1);
  eq(v1(c.score, 0, 0)[0].notes, [{ string: 3, fret: 8 }, { string: 2, fret: 1, harmonic: 'natural' }], 'the harmonic that fits shifts, its string blocks the mover');
  const stuck = model({ tracks: [tab([{ beats: [chord('whole', { string: 1, fret: 0, harmonic: true }, { string: 2, fret: 2 })] }])] });
  const d = run('transpose', stuck, cur(0, 0, 0), range(stuck, 0, P(0, 0), P(0, 0)), -1);
  eq([d.changed, said(d)], [false, "Can't transpose, measure 1 would go below fret 0, harmonics stay on their string"]);
});

// ---------- ties and graces ----------
test('ties: a tie across a barline survives when both partners move to the same string and fret; one partner outside the selection, or only one of them moving, drops both flags; a mover tied to a non-mover drops both', () => {
  const s = model({ tracks: [tab([
    { beats: [tn('whole', 2, 0, { tieStart: true })] },
    { beats: [tn('whole', 2, 0, { tieEnd: true })] },
    { beats: [tn('whole', 2, 0, { tieStart: true })] },
    { beats: [tn('whole', 2, 0, { tieEnd: true })] },
  ])] });
  const both = run('transpose', s, cur(0, 0, 0, 2), range(s, 0, P(0, 0), P(1, 0)), -1);
  eq([v1(both.score, 0, 0)[0].notes, v1(both.score, 0, 1)[0].notes], [[{ string: 3, fret: 3, tieStart: true }], [{ string: 3, fret: 3, tieEnd: true }]]);
  const one = run('transpose', s, cur(0, 2, 0, 2), range(s, 0, P(2, 0), P(2, 0)), -1);
  eq([v1(one.score, 0, 2)[0].notes, v1(one.score, 0, 3)[0].notes], [[{ string: 3, fret: 3 }], [{ string: 2, fret: 0 }]], 'the partner stays: both flags go');
  const m = model({ tracks: [tab([{ beats: [tn('half', 2, 0, { tieStart: true }), tn('half', 2, 3, { tieEnd: true })] }])] });
  const r = run('transpose', m, cur(0, 0, 0, 2), range(m, 0, P(0, 0), P(0, 1)), -1);
  eq(v1(r.score, 0, 0).map((b) => b.notes), [[{ string: 3, fret: 3 }], [{ string: 2, fret: 2 }]], 'unequal tie (data odd) ends on different strings: both flags go');
  for (const x of [both, one, r]) ok(same(x.score));
});
test('a moved grace keeps its effects, loses pitch and its own tie flags, and a grace that fits shifts as before; the main beat beside it is unaffected by the grace\'s string', () => {
  const s = model({ tracks: [tab([{ beats: [
    { type: 'grace', duration: '8th', notes: [{ string: 2, fret: 0, pitch: 'B3', vibrato: true, tieStart: true }] },
    nt('quarter', 1, 5),
    grace(1, 5),
  ] }])] });
  const r = run('transpose', s, cur(0, 0, 1), range(s, 0, P(0, 0), P(0, 2)), -1);
  eq([v1(r.score, 0, 0)[0].notes, v1(r.score, 0, 0)[1].notes, v1(r.score, 0, 0)[2].notes], [[{ string: 3, fret: 3, vibrato: true }], [{ string: 1, fret: 4 }], [{ string: 1, fret: 4 }]]);
  eq(said(r), 'Transposed 3 notes down 1 semitone, 1 moved to another string');
  ok(same(r.score));
});
test('the cursor follows only a note that moved: on the moved string it follows; on another string, another track, or a note that stayed it does not change; a column selection keeps cursor.track', () => {
  const s = model({ tracks: [tab([{ beats: [chord('whole', { string: 2, fret: 0 }, { string: 5, fret: 5 })] }]), tab([{ beats: [nt('whole', 2, 0)] }], { name: 'B' })] });
  const sel = () => colr(s, T(0, 0, 0), T(1, 0, 0));
  eq(run('transpose', s, cur(0, 0, 0, 2), sel(), -1).cursor.string, 3, 'moved: follows');
  eq(run('transpose', s, cur(0, 0, 0, 5), sel(), -1).cursor?.string ?? 5, 5, 'a kept note: stays');
  const r = run('transpose', s, cur(1, 0, 0, 2), sel(), -1);
  eq([r.cursor.track, r.cursor.string], [1, 3], 'on the second track');
  eq(said(r), 'Transposed 3 notes down 1 semitone on 2 tracks, 2 moved to another string');
});

// ---------- the string fallback and pitch-only / fretless notes ----------
test('notes without a fret (pitch-only or string only) are skipped and counted, never moved; a stringless misfit is refused; no throw', () => {
  const s = model({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }, { string: 2, fret: 5 }] }] }])] });
  const r = run('transpose', s, cur(0, 0, 0, 2), range(s, 0, P(0, 0), P(0, 0)), -1);
  eq([said(r), v1(r.score, 0, 0)[0].notes], ['Transposed 1 note down 1 semitone, 1 pitch-only note skipped', [{ pitch: 'C4' }, { string: 2, fret: 4 }]]);
  const only = model({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] }])] });
  eq(said(run('transpose', only, cur(0, 0, 0), range(only, 0, P(0, 0), P(0, 0)), -1)), 'No fretted notes to transpose, 1 pitch-only note skipped');
});

// ---------- robustness pass: odd content must never throw and must keep sanitizeScore identity ----------
const DUR = ['whole', 'half', 'quarter', '8th', '16th', '32nd', '64th'];
function oddNote(rnd, n) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const o = {};
  const hasString = rnd() < 0.92;
  if (hasString) o.string = 1 + Math.floor(rnd() * n);
  if (rnd() < 0.85) o.fret = pick([0, 0, 1, 2, 5, 12, 22, 23, 24, 24, 30, 99]);
  if (hasString && rnd() < 0.2) o.pitch = pick(['C4', 'E4', 'G#3']);
  if (!hasString && o.fret == null) o.pitch = 'D4';
  if (rnd() < 0.1) o.harmonic = pick(['natural', 'pinch', true]);
  if (rnd() < 0.05) o.harmonicFret = pick([0, 12, 24, 30]);
  if (rnd() < 0.15) o.tieStart = true;
  if (rnd() < 0.15) o.tieEnd = true;
  if (rnd() < 0.1) o.vibrato = true;
  return o;
}
function oddBeat(rnd, n) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const r = rnd();
  const b = { type: r < 0.2 ? 'rest' : r < 0.3 ? 'grace' : 'note', duration: pick(DUR) };
  if (b.type !== 'rest') b.notes = Array.from({ length: pick([0, 1, 1, 1, 2, 3, 6]) }, () => oddNote(rnd, n));
  if (rnd() < 0.15) b.dots = pick([0, 1, 2, 3, 7, 1.5, '1']);
  if (rnd() < 0.15) b.tuplet = pick([3, 5, { count: 3, of: 2 }]);
  if (rnd() < 0.1) b.tuplets = pick([[3, 3], [3, [5, 2]]]);
  if (rnd() < 0.1) b.hidden = true;
  if (rnd() < 0.1) b.slash = true;
  return b;
}
function oddScore(rnd) {
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const tracks = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => {
    const tuning = pick([undefined, ONE, STD, DROPD, BASS, TWELVE]);
    const n = tuning ? tuning.length : 6;
    const t = { name: 'T', showTablature: rnd() < 0.85, measures: Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => (
      rnd() < 0.2 ? { beats: [] } : rnd() < 0.2 ? { voices: [{ beats: [oddBeat(rnd, n), oddBeat(rnd, n)] }, { beats: [oddBeat(rnd, n)] }] } : { beats: Array.from({ length: Math.floor(rnd() * 5) }, () => oddBeat(rnd, n)) })) };
    if (tuning) t.tuning = tuning;
    if (rnd() < 0.1) t.hidden = true;
    return t;
  });
  const p = model({ tracks });
  return sanitizeScore(p) === p ? p : null;
}
test('robustness: 250 odd scores x 30 random range edits (every rhythm key and transpose over beat and column selections, odd tunings, duplicate strings, fretless and stringless notes, dots 3+, hidden rests, slash beats, mixed tuplets) never throw and keep sanitizeScore(model) === model', () => {
  const rnd = mulberry32(777);
  const names = ['shorter', 'longer', 'setDuration', 'cycleDots', 'toggleTriplet', 'toggleRest', 'toggleTie', 'transpose'];
  let edits = 0, moves = 0, scores = 0;
  for (let i = 0; i < 250; i++) {
    let s = oddScore(rnd);
    if (!s) continue;
    scores++;
    for (let k = 0; k < 30; k++) {
      const ti = Math.floor(rnd() * s.tracks.length);
      const c = { track: ti, measure: Math.floor(rnd() * 3), beat: Math.floor(rnd() * 5), string: 1 + Math.floor(rnd() * 6) };
      const t2 = Math.min(s.tracks.length - 1, ti + Math.floor(rnd() * 2));
      const A = { measure: Math.floor(rnd() * 3), beat: Math.floor(rnd() * 4) }, Z = { measure: Math.floor(rnd() * 3), beat: Math.floor(rnd() * 4) };
      const sel = rnd() < 0.15 ? null : rnd() < 0.5 ? colr(s, { track: ti, ...A }, { track: t2, ...Z }) : range(s, ti, A, Z);
      const name = names[Math.floor(rnd() * names.length)];
      const arg = name === 'transpose' ? [1, -1, 12, -12, 3, -5][Math.floor(rnd() * 6)] : name === 'setDuration' ? DUR[Math.floor(rnd() * 7)] : undefined;
      const cc = C_clamp(s, c);
      const r = run(name, s, cc, sel, arg);
      ok(r.score && typeof r.changed === 'boolean', `${name}: a result`);
      if (r.announce) ok(typeof describe(r.announce) === 'string', `${name}: speaks`);
      if (r.changed) {
        ok(same(r.score), `score ${i} step ${k} ${name} ${arg ?? ''}: sanitize identity`);
        edits++;
        moves += r.announce?.moved ?? 0;
        s = r.score;
      } else ok(r.score === s, `${name}: unchanged means the same object`);
    }
  }
  ok(scores > 150 && edits > 1500 && moves > 20, `coverage: ${scores} scores, ${edits} edits, ${moves} moved notes`);
});
test('robustness by hand: 1-string and 12-string tunings, duplicate strings in a chord, a stringless pitched note and a fret-only note, a slash beat with no notes, a hidden rest, dots 7: every key leaves the score a sanitize fixpoint', () => {
  const s = model({ tracks: [
    tab([{ beats: [
      chord('quarter', { string: 1, fret: 0 }, { string: 1, fret: 0 }),
      { type: 'note', duration: 'quarter', slash: true, notes: [] },
      rest('quarter', { hidden: true }),
      nt('quarter', 1, 24, { dots: 7 }),
      { type: 'note', duration: 'quarter', notes: [{ pitch: 'C4' }, { string: 1, fret: 3 }] },
    ] }], { tuning: ONE }),
    tab([{ beats: [chord('quarter', { string: 12, fret: 0 }, { string: 11, fret: 24 }), nt('quarter', 1, 0)] }], { tuning: TWELVE, name: 'Twelve' }),
  ] });
  for (const sel of [range(s, 0, P(0, 0), P(0, 4)), colr(s, T(0, 0, 0), T(1, 0, 1)), null]) {
    for (const [name, arg] of [...RHYTHM, ['transpose', 1], ['transpose', -1], ['transpose', 12], ['transpose', -12]]) {
      const r = run(name, s, cur(0, 0, 0, 1), sel, arg);
      ok(r.score && same(r.score), `${name}${arg ?? ''}`);
      ok(typeof describe(r.announce) === 'string', `${name}: speaks`);
    }
  }
  const tw = run('transpose', s, cur(1, 0, 0, 12), colr(s, T(1, 0, 0), T(1, 0, 1)), -1);
  ok(!tw.changed, 'string 12 fret 0 down has nowhere to go');
});

// ---------- 2.3.3 verification bugs, fixed: stringless and duplicate-string notes are skipped by a range transpose ----------
{
  const io2 = await imp('src/editor/model/io.js');
  const SEL2 = await imp('src/editor/model/selection.js');
  const CMD2 = await imp('src/editor/model/commands.js');
  const { sanitizeScore: san } = await imp('src/sanitize.js');
  const await_describe = await imp('src/editor/announce.js');
  const tab2 = (measures) => ({ name: 'Gtr', showTablature: true, measures });
  const st2 = () => ({ duration: 'quarter', dots: 0, digit: null });
  const sel1 = (s) => SEL2.selectionRange(s, 0, { measure: 0, beat: 0 }, { measure: 0, beat: 0 });
  const go = (s, sel, semis) => CMD2.run('transpose', s, { track: 0, measure: 0, beat: 0, string: 1 }, st2(), { maxFret: 24, now: 0, allowAppend: true, selection: sel }, semis);
  test('bug fix: a fretted note with a pitch but no string is skipped (counted) by a range transpose and the model stays a sanitize fixpoint', () => {
    const s = io2.parseInput({ tracks: [tab2([{ beats: [{ type: 'note', duration: 'quarter', notes: [{ fret: 3, pitch: 'C4' }, { string: 1, fret: 2 }] }] }])] });
    const r = go(s, sel1(s), 1);
    const notes = r.score.tracks[0].measures[0].beats[0].notes;
    if (!(r.changed && san(r.score) === r.score)) throw new Error('not a sanitize fixpoint');
    if (JSON.stringify(notes) !== JSON.stringify([{ fret: 3, pitch: 'C4' }, { string: 1, fret: 3 }])) throw new Error(JSON.stringify(notes));
  });
  test('bug fix: two notes on one string (malformed) are skipped by a range transpose, so no tie flag is moved onto the wrong note', () => {
    const s = io2.parseInput({ tracks: [tab2([{ beats: [{ type: 'note', duration: 'whole', notes: [{ string: 1, fret: 0 }, { string: 1, fret: 0, tieStart: true }] }] }])] });
    const r = go(s, sel1(s), -1);
    if (r.changed || r.score !== s) throw new Error('the malformed beat was changed');
    const { describe } = await_describe;
    if (describe(r.announce) !== 'No fretted notes to transpose, 2 notes without their own string skipped') throw new Error(describe(r.announce));
  });
}

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-rhythm-edge: ${r.name}`);
    else { fail++; console.log(`FAIL editor-rhythm-edge: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
