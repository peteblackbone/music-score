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
