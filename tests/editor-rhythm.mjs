// 2.3.3 rhythm keys over a selection and transpose to another string at model level: duration, dots and
// triplet (criteria 23-25), R and L (26-27), the shared rules (28-29), the string fallback (30-34),
// midiOf against pitch.js, B10 over every rhythm key and transpose, and E12.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-rhythm.mjs`.
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
const RR = await imp('src/editor/model/rhythmRange.js');
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
/** A note beat whose note has `note` fields (ties), the beat `extra`. */
const tn = (duration, string, fret, note = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...note }], ...extra });
const rest = (duration, extra = {}) => ({ type: 'rest', duration, ...extra });
const grace = (string = 1, fret = 2) => ({ type: 'grace', duration: '8th', notes: [{ string, fret }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const P = (measure, beat) => ({ measure, beat });
const T = (track, measure, beat) => ({ track, measure, beat });
const st = () => ({ duration: 'quarter', dots: 0, digit: null });
const ctx = (sel) => ({ maxFret: 24, now: 0, twoDigitDelayMs: 800, allowAppend: true, selection: sel });
const run = (name, s, c, sel, arg) => CMD.run(name, s, c, st(), ctx(sel), arg);
const said = (r) => describe(r.announce);
const v1 = (s, ti, mi) => s.tracks[ti].measures[mi].beats;
const same = (s) => sanitizeScore(s) === s;
const range = (s, ti, a, b) => SEL.selectionRange(s, ti, a, b);
const field = (s, ti, mi, k) => v1(s, ti, mi).map((b) => (b.type === 'grace' ? 'g' : b[k] ?? null));

/** Criterion 23's 8th, quarter, quarter (string 1), a grace before the second; measure 2 a whole. */
const eqq = () => model({ tracks: [tab([{ beats: [nt('8th', 1, 1), grace(), nt('quarter', 1, 2), nt('quarter', 1, 3)] }, { beats: [nt('whole', 1, 4)] }])] });
/** Two TAB tracks and a notation-only one, two measures each. */
const cols = () => model({ tracks: [
  tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 1), nt('half', 1, 3)] }, { beats: [nt('whole', 1, 3)] }]),
  { name: 'Notes', measures: [{ beats: [nt('half', 2, 1), rest('half')] }, { beats: [nt('whole', 2, 1)] }] },
  tab([{ beats: [nt('half', 2, 5), nt('half', 2, 5)] }, { beats: [rest('whole')] }], { name: 'C' }),
] });

// ---------- criterion 23: duration ----------
test('criterion 23: with 8th, quarter, quarter selected + halves and - doubles every beat (graces and the next measure untouched); one result each, the selection kept', () => {
  const s = eqq();
  const sel = range(s, 0, P(0, 0), P(0, 3));
  const sh = run('shorter', s, cur(0, 0, 3), sel);
  eq([field(sh.score, 0, 0, 'duration'), said(sh), CMD.undoLabel('shorter', sh.announce)], [['16th', 'g', '8th', '8th'], '3 beats halved', 'duration']);
  eq([v1(sh.score, 0, 0)[1], v1(sh.score, 0, 1)], [v1(s, 0, 0)[1], v1(s, 0, 1)], 'the grace and measure 2 are the same objects');
  const lo = run('longer', s, cur(0, 0, 3), sel);
  eq([field(lo.score, 0, 0, 'duration'), said(lo)], [['quarter', 'g', 'half', 'half'], '3 beats doubled']);
  ok(CMD.COMMANDS.shorter.keepsSelection && CMD.COMMANDS.longer.keepsSelection && CMD.COMMANDS.setDuration.keepsSelection);
  ok(same(sh.score) && same(lo.score));
  const two = range(s, 0, P(0, 2), P(0, 3));
  eq(said(run('shorter', s, cur(0, 0, 3), two)), 'Eighth, 2 beats', 'every result the same: the duration is named');
});
test('criterion 23: if any beat would go past whole or 64th nothing changes and the editor says "Duration limit" (the single-beat limit message is unchanged)', () => {
  const s = model({ tracks: [tab([{ beats: [nt('whole', 1, 1), nt('quarter', 1, 2)] }, { beats: [nt('64th', 1, 1), nt('8th', 1, 2)] }])] });
  const a = run('longer', s, cur(0, 0, 1), range(s, 0, P(0, 0), P(0, 1)));
  eq([a.changed, a.score === s, said(a)], [false, true, 'Duration limit']);
  const b = run('shorter', s, cur(0, 1, 1), range(s, 0, P(1, 0), P(1, 1)));
  eq([b.changed, said(b)], [false, 'Duration limit']);
  eq(said(run('longer', s, cur(0, 0, 0), null)), 'No further duration');
});
test('setDuration over a range (D-R1) writes the duration where it differs and sets the current duration; dots are named when they agree; an unknown name is refused', () => {
  const s = model({ tracks: [tab([{ beats: [nt('half', 1, 1), nt('quarter', 1, 2), nt('quarter', 1, 3, { dots: 1 })] }])] });
  const sel = range(s, 0, P(0, 0), P(0, 1));
  const r = run('setDuration', s, cur(0, 0, 1), sel, 'half');
  eq([field(r.score, 0, 0, 'duration'), v1(r.score, 0, 0)[0] === v1(s, 0, 0)[0], r.state.duration, said(r)], [['half', 'half', 'quarter'], true, 'half', 'Half, 2 beats']);
  const mixed = run('setDuration', s, cur(0, 0, 2), range(s, 0, P(0, 1), P(0, 2)), '8th');
  eq(said(mixed), 'Eighth, 2 beats', 'mixed dots: the duration alone');
  const dotted = run('setDuration', s, cur(0, 0, 2), range(s, 0, P(0, 2), P(0, 2)), '8th');
  eq(said(dotted), 'Dotted eighth, 1 beat');
  eq(said(run('setDuration', s, cur(0, 0, 1), sel, 'breve')), 'No further duration');
  const noop = run('setDuration', s, cur(0, 0, 1), range(s, 0, P(0, 1), P(0, 1)), 'quarter');
  eq([noop.changed, said(noop)], [false, 'Quarter, 1 beat'], 'D-R6: no change, no new model, still spoken');
});

// ---------- criterion 24: dots ----------
test('criterion 24: equal dot counts all move to the next (0 -> 1 -> 2 -> 0, the key deleted at 0); mixed counts all get 1 dot', () => {
  let s = eqq();
  const sel = () => range(s, 0, P(0, 0), P(0, 3));
  const words = [];
  for (const want of [[1, 'g', 1, 1], [2, 'g', 2, 2], [null, 'g', null, null]]) {
    const r = run('cycleDots', s, cur(0, 0, 3), sel());
    eq(field(r.score, 0, 0, 'dots'), want);
    ok(same(r.score));
    words.push(said(r));
    s = r.score;
  }
  eq(words, ['Dotted, 3 beats', 'Double-dotted, 3 beats', 'No dot, 3 beats']);
  ok(!v1(s, 0, 0).some((b) => 'dots' in b), 'the key is deleted');
  const m = model({ tracks: [tab([{ beats: [nt('quarter', 1, 1, { dots: 2 }), nt('quarter', 1, 1), nt('quarter', 1, 1, { dots: 4 })] }])] });
  const r = run('cycleDots', m, cur(0, 0, 2), range(m, 0, P(0, 0), P(0, 2)));
  eq([field(r.score, 0, 0, 'dots'), said(r), CMD.undoLabel('cycleDots', r.announce)], [[1, 1, 1], 'Dotted, 3 beats', 'dots']);
});

// ---------- criterion 25: triplet ----------
test('criterion 25: all eligible beats triplets -> off, else on (tuplet: 3 only where missing); nested tuplets are skipped and counted; only nested beats: refused', () => {
  const nested = { tuplets: [3, 3] };
  const s = model({ tracks: [tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 1, { tuplet: 3 }), nt('quarter', 1, 1, nested)] }])] });
  ok(Array.isArray(v1(s, 0, 0)[2].tuplets), 'the fixture keeps its nested tuplets');
  const sel = range(s, 0, P(0, 0), P(0, 2));
  const on = run('toggleTriplet', s, cur(0, 0, 2), sel);
  eq([field(on.score, 0, 0, 'tuplet'), v1(on.score, 0, 0)[1] === v1(s, 0, 0)[1], said(on)], [[3, 3, null], true, 'Triplet on, 2 beats, 1 nested tuplet skipped']);
  const off = run('toggleTriplet', on.score, cur(0, 0, 2), range(on.score, 0, P(0, 0), P(0, 2)));
  eq([field(off.score, 0, 0, 'tuplet'), said(off), CMD.undoLabel('toggleTriplet', off.announce)], [[null, null, null], 'Triplet off, 2 beats, 1 nested tuplet skipped', 'triplet']);
  ok(same(on.score) && same(off.score) && v1(off.score, 0, 0)[2] === v1(s, 0, 0)[2]);
  const only = run('toggleTriplet', s, cur(0, 0, 2), range(s, 0, P(0, 2), P(0, 2)));
  eq([only.changed, said(only)], [false, 'Nested tuplet, unchanged']);
});

// ---------- columns, slot, zero-beat ----------
test('duration, dots and triplet act on every selected track (D-R2), notation-only ones too, and say the track count', () => {
  const s = cols();
  const sel = COL.columnRange(s, T(0, 0, 0), T(2, 1, 0));
  const r = run('shorter', s, cur(2, 1, 0), sel);
  eq([field(r.score, 0, 0, 'duration'), field(r.score, 1, 0, 'duration'), field(r.score, 2, 1, 'duration'), said(r)],
    [['8th', '8th', 'quarter'], ['quarter', 'quarter'], ['half'], '10 beats halved on 3 tracks']);
  eq(said(run('cycleDots', s, cur(2, 1, 0), sel)), 'Dotted, 10 beats on 3 tracks');
  eq(said(run('toggleTriplet', s, cur(2, 1, 0), sel)), 'Triplet on, 10 beats on 3 tracks');
  eq(said(run('setDuration', s, cur(2, 1, 0), sel, '8th')), 'Eighth, 10 beats on 3 tracks');
});
test('the slot is never a target: a selection of blank measures (no main beat) says "No beats in the selection" for every rhythm key', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [] }])] });
  const sel = range(s, 0, P(0, 0), P(1, 0));
  ok(sel && sel.info.beatCount === 0, 'a zero-beat selection');
  for (const [name, arg] of [['shorter'], ['longer'], ['setDuration', 'half'], ['cycleDots'], ['toggleTriplet']]) {
    const r = run(name, s, cur(0, 1, 0), sel, arg);
    eq([r.changed, said(r)], [false, 'No beats in the selection'], name);
  }
});
test('mainBeats / mapMain: graces are never targets; nothing changed returns the same score', () => {
  const s = eqq();
  const parts = [range(s, 0, P(0, 0), P(1, 0))];
  eq(RR.mainBeats(s, parts).map((x) => [x.loc.measure, x.loc.beat]), [[0, 0], [0, 2], [0, 3], [1, 0]]);
  ok(RR.mapMain(s, parts, (b) => b) === s);
  const seen = [];
  RR.mapMain(s, parts, (b, loc) => { seen.push(loc); return b; });
  eq(seen, [T(0, 0, 0), T(0, 0, 2), T(0, 0, 3), T(0, 1, 0)]);
});

/// ---------- criterion 26: R ----------
test('criterion 26: any note among the targets -> every note beat becomes a rest of the same length, effects kept as with Delete; ties at the edges repaired; graces kept', () => {
  const s = model({ tracks: [tab([
    { beats: [tn('quarter', 1, 3, { tieStart: true })] },
    { beats: [tn('quarter', 1, 3, { tieEnd: true }, { vibrato: true, zz: 1 }), grace(), rest('quarter'), tn('half', 2, 1, { tieStart: true })] },
    { beats: [tn('whole', 2, 1, { tieEnd: true })] },
  ])] });
  ok(same(s));
  const sel = range(s, 0, P(1, 0), P(1, 3));
  const r = run('toggleRest', s, cur(0, 1, 3), sel);
  eq(v1(r.score, 0, 1), [rest('quarter', { vibrato: true, zz: 1 }), grace(), rest('quarter'), rest('half')]);
  eq([v1(r.score, 0, 0)[0].notes[0], v1(r.score, 0, 2)[0].notes[0]], [{ string: 1, fret: 3 }, { string: 2, fret: 1 }], 'both outside partners untied');
  eq([said(r), CMD.undoLabel('toggleRest', r.announce)], ['2 beats changed to rests', 'rest']);
  ok(same(r.score) && CMD.COMMANDS.toggleRest.keepsSelection);
});
test("criterion 26: all targets rests -> notes at fret 0 on the cursor string, clamped to each track's string count (hidden dropped, other fields kept); undo label \"note\"", () => {
  const s = model({ tracks: [
    tab([{ beats: [rest('half', { hidden: true, zz: 2 }), rest('half')] }]),
    tab([{ beats: [rest('whole')] }], { name: 'Bass', tuning: ['E1', 'A1', 'D2', 'G2'] }),
  ] });
  const sel = COL.columnRange(s, T(0, 0, 0), T(1, 0, 0));
  const r = run('toggleRest', s, cur(1, 0, 0, 6), sel);
  eq([v1(r.score, 0, 0), v1(r.score, 1, 0)], [
    [{ type: 'note', duration: 'half', zz: 2, notes: [{ string: 6, fret: 0 }] }, { type: 'note', duration: 'half', notes: [{ string: 6, fret: 0 }] }],
    [{ type: 'note', duration: 'whole', notes: [{ string: 4, fret: 0 }] }],
  ]);
  eq([said(r), CMD.undoLabel('toggleRest', r.announce)], ['3 rests changed to notes on 2 tracks', 'note']);
  ok(same(r.score));
});
test('criterion 26: notation-only tracks are skipped and counted; with no TAB track selected R is refused "Needs a TAB staff"; no main beat: "No beats in the selection"', () => {
  const s = cols();
  const sel = COL.columnRange(s, T(0, 0, 0), T(2, 0, 0));
  const r = run('toggleRest', s, cur(2, 0, 0), sel);
  eq([said(r), r.score.tracks[1] === s.tracks[1], field(r.score, 2, 0, 'type')], ['5 beats changed to rests on 2 tracks, 1 track without TAB skipped', true, ['rest', 'rest']]);
  const n = run('toggleRest', s, cur(1, 0, 0), range(s, 1, P(0, 0), P(0, 1)));
  eq([n.changed, said(n)], [false, 'Needs a TAB staff']);
  const e = model({ tracks: [tab([{ beats: [] }])] });
  eq(said(run('toggleRest', e, cur(0, 0, 0), range(e, 0, P(0, 0), P(0, 0)))), 'No beats in the selection');
});

// ---------- criterion 27: L ----------
test('criterion 27: L ties every pair of neighbouring selected main beats with a note on the same string at the same fret, across a barline too; frets are never copied', () => {
  const s = model({ tracks: [tab([
    { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5 }, { string: 2, fret: 3 }] }, nt('quarter', 1, 5), grace(), nt('quarter', 1, 7), nt('quarter', 1, 7)] },
    { beats: [nt('half', 1, 7), rest('quarter'), nt('quarter', 1, 7)] },
  ])] });
  const sel = range(s, 0, P(0, 0), P(1, 2));
  const r = run('toggleTie', s, cur(0, 1, 2), sel);
  eq(v1(r.score, 0, 0).map((b) => b.notes), [
    [{ string: 1, fret: 5, tieStart: true }, { string: 2, fret: 3 }], [{ string: 1, fret: 5, tieEnd: true }], grace().notes,
    [{ string: 1, fret: 7, tieStart: true }], [{ string: 1, fret: 7, tieEnd: true, tieStart: true }],
  ]);
  eq(v1(r.score, 0, 1).map((b) => b.notes ?? null), [[{ string: 1, fret: 7, tieEnd: true }], null, [{ string: 1, fret: 7 }]], 'a rest breaks adjacency');
  eq([said(r), CMD.undoLabel('toggleTie', r.announce)], ['Tied 3 note pairs', 'tie']);
  ok(same(r.score) && CMD.COMMANDS.toggleTie.keepsSelection);
  const back = run('toggleTie', r.score, cur(0, 1, 2), range(r.score, 0, P(0, 0), P(1, 2)));
  eq([JSON.stringify(back.score) === JSON.stringify(s), said(back)], [true, 'Untied 3 note pairs'], 'every pair tied: all removed');
});
test('criterion 27: some pairs tied -> all tied; unequal frets, pitch-only notes and different strings are no pair: "Nothing to tie to"; TAB only (needsTab, skipped count)', () => {
  const s = model({ tracks: [tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), tn('quarter', 1, 5, { tieEnd: true }), nt('quarter', 1, 5), nt('quarter', 2, 5)] }])] });
  const r = run('toggleTie', s, cur(0, 0, 3), range(s, 0, P(0, 0), P(0, 3)));
  eq([v1(r.score, 0, 0).map((b) => [!!b.notes[0].tieStart, !!b.notes[0].tieEnd]), said(r)], [[[true, false], [true, true], [false, true], [false, false]], 'Tied 2 note pairs']);
  const none = model({ tracks: [tab([{ beats: [nt('quarter', 1, 5), nt('quarter', 1, 6), nt('quarter', 2, 6), { type: 'note', duration: 'quarter', notes: [{ pitch: 'C4' }] }] }])] });
  const n = run('toggleTie', none, cur(0, 0, 3), range(none, 0, P(0, 0), P(0, 3)));
  eq([n.changed, said(n)], [false, 'Nothing to tie to']);
  const c = cols();
  const t = run('toggleTie', c, cur(2, 0, 0), COL.columnRange(c, T(0, 0, 0), T(2, 1, 0)));
  eq(said(t), 'Tied 3 note pairs on 2 tracks, 1 track without TAB skipped');
  eq(said(run('toggleTie', c, cur(1, 0, 0), range(c, 1, P(0, 0), P(1, 0)))), 'Needs a TAB staff');
});

// ---------- criteria 28-29 ----------
test('criterion 28: nothing reflows (measures may end over or under); sanitize identity after every rhythm key', () => {
  const s = eqq();
  for (const [name, arg] of [['shorter'], ['longer'], ['setDuration', 'whole'], ['cycleDots'], ['toggleTriplet'], ['toggleRest'], ['toggleTie']]) {
    const r = run(name, s, cur(0, 0, 3), range(s, 0, P(0, 0), P(1, 0)), arg);
    eq([r.score.tracks[0].measures.length, v1(r.score, 0, 0).length], [2, 4], name);
    ok(same(r.score), name);
  }
});
const B = await imp('src/editor/model/beats.js');
const N = await imp('src/editor/model/notes.js');
test('criterion 29: without a selection every rhythm key runs the 2.0 single-beat command', () => {
  const s = eqq();
  for (const [name, fn, arg] of [['shorter', B.shorter], ['longer', B.longer], ['setDuration', B.setDuration, 'half'], ['cycleDots', B.cycleDots], ['toggleTriplet', B.toggleTriplet], ['toggleRest', B.toggleRest], ['toggleTie', N.toggleTie]]) {
    for (const c of [cur(0, 0, 3), cur(0, 0, 4), cur(0, 1, 0)]) eq(CMD.COMMANDS[name].fn(s, c, st(), ctx(null), arg), fn(s, c, st(), ctx(null), arg), name);
  }
});

// ---------- criteria 30-34: transpose to another string ----------
const SM = await imp('src/editor/model/stringMove.js');
const PITCH = await imp('src/pitch.js');
test('midiOf equals midiNumber(parsePitch(p)) from pitch.js for every valid pitch (both letter cases, #, ##, x, b, bb, octaves -1 to 10, padded); anything else is NaN', () => {
  let n = 0;
  for (const step of 'ABCDEFGabcdefg') {
    for (const acc of ['', '#', '##', 'x', 'b', 'bb']) {
      for (let oct = -1; oct <= 10; oct++) {
        const p = `${step}${acc}${oct}`;
        eq(SM.midiOf(p), PITCH.midiNumber(PITCH.parsePitch(p)), p);
        eq(SM.midiOf(` ${p} `), SM.midiOf(p), 'trimmed');
        n++;
      }
    }
  }
  eq(n, 14 * 6 * 12);
  eq([SM.midiOf('E4'), SM.midiOf('B3'), SM.midiOf('E2'), SM.midiOf('C-1')], [64, 59, 40, 0]);
  for (const bad of ['H4', 'E', 'E#b4', '4E', '', null, undefined, 64, 'Ebbb4']) ok(Number.isNaN(SM.midiOf(bad)), String(bad));
});
const one = (string, fret, note = {}) => model({ tracks: [tab([{ beats: [tn('whole', string, fret, note)] }])] });
test('criterion 30: string 2 fret 0 and Ctrl+Down moves the note to string 3 fret 3, without and with a selection; "Transposed 1 note down 1 semitone, 1 moved to another string"; the cursor follows', () => {
  const s = one(2, 0);
  const a = run('transpose', s, cur(0, 0, 0, 2), null, -1);
  eq([v1(a.score, 0, 0)[0].notes, said(a), a.cursor.string], [[{ string: 3, fret: 3 }], 'Transposed 1 note down 1 semitone, 1 moved to another string', 3]);
  const b = run('transpose', s, cur(0, 0, 0, 2), range(s, 0, P(0, 0), P(0, 0)), -1);
  eq([v1(b.score, 0, 0)[0].notes, said(b), b.cursor.string], [[{ string: 3, fret: 3 }], 'Transposed 1 note down 1 semitone, 1 moved to another string', 3]);
  const c = run('transpose', s, cur(0, 0, 0, 1), range(s, 0, P(0, 0), P(0, 0)), -1);
  eq(c.cursor.string, 1, 'a cursor on another string stays');
  ok(same(a.score) && same(b.score));
});
test('criterion 31: string 6 fret 0 with Ctrl+Down and string 1 fret 24 with Ctrl+Up (maxFret 24) are refused; the score is unchanged', () => {
  for (const [s, string, semis, word] of [[one(6, 0), 6, -1, 'below fret 0'], [one(1, 24), 1, 1, 'above fret 24']]) {
    for (const sel of [null, range(s, 0, P(0, 0), P(0, 0))]) {
      const r = run('transpose', s, cur(0, 0, 0, string), sel, semis);
      eq([r.changed, r.score === s, said(r)], [false, true, `Can't transpose, measure 1 would go ${word}`]);
    }
  }
});
test('criterion 32: a note never moves onto a string another note keeps; movers go nearest first, then the lower fret; if any note cannot be placed nothing changes and the measure is named', () => {
  const chord = (...notes) => ({ type: 'note', duration: 'whole', notes });
  const s = model({ tracks: [tab([
    { beats: [chord({ string: 1, fret: 0 }, { string: 2, fret: 5 })] },
    { beats: [chord({ string: 1, fret: 0 }, { string: 2, fret: 0 })] },
    { beats: [chord({ string: 5, fret: 0 }, { string: 6, fret: 0 })] },
  ])] });
  const r = run('transpose', s, cur(0, 1, 0), range(s, 0, P(0, 0), P(1, 0)), -1);
  eq(v1(r.score, 0, 0)[0].notes, [{ string: 3, fret: 8 }, { string: 2, fret: 4 }], 'string 2 is kept: string 1 goes to string 3');
  eq(v1(r.score, 0, 1)[0].notes, [{ string: 2, fret: 4 }, { string: 3, fret: 3 }], 'both move: string 1 first, onto the string 2 leaves');
  eq(said(r), 'Transposed 4 notes down 1 semitone, 3 moved to another string');
  ok(same(r.score));
  const bad = run('transpose', s, cur(0, 2, 0), range(s, 0, P(0, 0), P(2, 0)), -1);
  eq([bad.changed, bad.score === s, said(bad)], [false, true, "Can't transpose, measure 3 would go below fret 0"]);
  const tie = model({ tracks: [tab([{ beats: [tn('whole', 3, 2)] }])] });
  eq(v1(run('transpose', tie, cur(0, 0, 0, 3), null, 23).score, 0, 0)[0].notes[0], { string: 2, fret: 21 }, 'up: the nearest string');
  const far = SM.placeMoves({ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }, [{ string: 3, fret: 0 }], [{ string: 3, fret: 0 }], -1, 24);
  eq([...far.values()], [{ string: 4, fret: 4 }], 'G3 - 1: string 4 (distance 1) beats string 5 (distance 2)');
  const even = SM.placeMoves({ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }, [{ string: 3, fret: 24 }], [{ string: 3, fret: 24 }], 1, 24);
  eq([...even.values()], [{ string: 2, fret: 21 }], 'both neighbours in reach: the lower fret');
});
test('criterion 33: notes in range keep their string; a moved note keeps its effects and unknown fields and loses pitch', () => {
  const s = model({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', zz: 1, notes: [{ string: 1, fret: 0, pitch: 'E4', vibrato: true, zz: 2 }, { string: 4, fret: 2, pitch: 'E3' }] }] }])] });
  const r = run('transpose', s, cur(0, 0, 0), range(s, 0, P(0, 0), P(0, 0)), -1);
  eq(v1(r.score, 0, 0)[0], { type: 'note', duration: 'whole', zz: 1, notes: [{ string: 2, fret: 4, vibrato: true, zz: 2 }, { string: 4, fret: 1 }] });
  ok(same(r.score));
});
test('criterion 33: a tie survives only when both partners end on the same string and fret (or neither moved); otherwise both flags go, at the final strings; a moved grace drops its own flags', () => {
  const s = model({ tracks: [tab([
    { beats: [tn('half', 2, 0, { tieStart: true }), tn('half', 2, 0, { tieEnd: true })] },
    { beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 0, tieStart: true }, { string: 2, fret: 5 }] }, tn('half', 1, 0, { tieEnd: true })] },
    { beats: [tn('half', 2, 3, { tieStart: true }), tn('half', 2, 3, { tieEnd: true })] },
    { beats: [{ type: 'grace', duration: '8th', notes: [{ string: 2, fret: 0, tieStart: true }] }, tn('whole', 3, 4)] },
  ])] });
  const r = run('transpose', s, cur(0, 0, 0), range(s, 0, P(0, 0), P(3, 0)), -1);
  eq(v1(r.score, 0, 0).map((b) => b.notes), [[{ string: 3, fret: 3, tieStart: true }], [{ string: 3, fret: 3, tieEnd: true }]], 'both moved to string 3 fret 3: kept');
  eq(v1(r.score, 0, 1).map((b) => b.notes), [[{ string: 3, fret: 8 }, { string: 2, fret: 4 }], [{ string: 2, fret: 4 }]], 'different strings: both flags go');
  eq(v1(r.score, 0, 2).map((b) => b.notes), [[{ string: 2, fret: 2, tieStart: true }], [{ string: 2, fret: 2, tieEnd: true }]], 'neither moved: kept');
  eq(v1(r.score, 0, 3)[0].notes, [{ string: 3, fret: 3 }], 'a moved grace drops its flags');
  ok(same(r.score));
  const half = run('transpose', s, cur(0, 0, 0), range(s, 0, P(0, 0), P(0, 0)), -1);
  eq(v1(half.score, 0, 0).map((b) => b.notes), [[{ string: 3, fret: 3 }], [{ string: 2, fret: 0 }]], 'the partner was not transposed: both flags go');
});
test('criterion 34: a harmonic (harmonic or harmonicFret) that would leave the range is never moved: the whole transpose is refused with ", harmonics stay on their string"', () => {
  for (const note of [{ harmonic: 'natural' }, { harmonic: 'pinch', harmonicFret: 0 }]) {
    const s = model({ tracks: [tab([{ beats: [tn('whole', 1, 5)] }, { beats: [tn('whole', 2, 0, note)] }])] });
    const sel = run('transpose', s, cur(0, 1, 0), range(s, 0, P(0, 0), P(1, 0)), -1);
    eq([sel.changed, said(sel)], [false, "Can't transpose, measure 2 would go below fret 0, harmonics stay on their string"]);
    const single = run('transpose', s, cur(0, 1, 0, 2), null, -1);
    eq([single.changed, said(single)], [false, "Can't transpose, measure 2 would go below fret 0, harmonics stay on their string"]);
  }
  const c = model({ tracks: [tab([{ beats: [tn('whole', 1, 0, { harmonic: 'natural' })] }]), tab([{ beats: [tn('whole', 2, 0)] }], { name: 'B' })] });
  eq(said(run('transpose', c, cur(1, 0, 0), COL.columnRange(c, T(0, 0, 0), T(1, 0, 0)), -1)), "Can't transpose, measure 1 on track 1 would go below fret 0, harmonics stay on their string");
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-rhythm: ${r.name}`);
    else { fail++; console.log(`FAIL editor-rhythm: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
