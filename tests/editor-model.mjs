// 2.0.0 editor model checks (pure: src/editor/model/*, keymap, announce, geometry, style, demo helpers).
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-model.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { sanitizeScore } = await imp('src/sanitize.js');
const { normalizeScore } = await imp('src/normalize.js');
const io = await imp('src/editor/model/io.js');
const { defaultScore } = await imp('src/editor/model/defaultScore.js');
const A = await imp('src/editor/model/access.js');
const F = await imp('src/editor/model/fill.js');
const C = await imp('src/editor/model/cursor.js');
const { cases } = await import('./cases.mjs');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const throws = (fn, msg) => {
  try { fn(); } catch (e) { if (msg && !String(e.message).includes(msg)) throw new Error(`threw "${e.message}", wanted "${msg}"`); return; }
  throw new Error(`did not throw${msg ? ` "${msg}"` : ''}`);
};
const clone = (o) => JSON.parse(JSON.stringify(o));
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const graceB = (string = 2, fret = 3) => ({ type: 'grace', duration: '16th', notes: [{ string, fret }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const sc = (...tracks) => ({ tracks });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });

// ---------- io ----------
test('io: parseInput accepts objects and JSON strings, drops schemaVersion 1 / null / missing, clones the input', () => {
  const src = sc(tab([{ beats: [nt('quarter')] }]));
  const a = io.parseInput(src);
  ok(a !== src && a.tracks[0] !== src.tracks[0], 'deep clone');
  eq(a, src);
  eq(io.parseInput({ ...src, schemaVersion: 1 }), src);
  eq(io.parseInput({ ...src, schemaVersion: null }), src);
  eq(io.parseInput(JSON.stringify({ schemaVersion: 1, ...src })), src);
});
test('io: schemaVersion above 1 (or any other value) throws Unsupported schemaVersion; non-objects and bad JSON throw', () => {
  throws(() => io.parseInput({ schemaVersion: 2, tracks: [] }), 'Unsupported schemaVersion');
  throws(() => io.parseInput('{"schemaVersion":"1"}'), 'Unsupported schemaVersion');
  throws(() => io.parseInput('[1,2]'), 'Score must be a JSON object');
  throws(() => io.parseInput('null'), 'Score must be a JSON object');
  throws(() => io.parseInput(42), 'Score must be a JSON object');
  throws(() => io.parseInput('{"tracks": ['));
});
test('io: __proto__ keys are dropped at every depth and never reach Object.prototype', () => {
  const s = io.parseInput('{"__proto__":{"polluted":1},"tracks":[{"showTablature":true,"__proto__":{"x":1},"measures":[{"beats":[]}]}]}');
  eq(Object.keys(s), ['tracks']);
  eq(Object.getPrototypeOf(s), Object.prototype);
  eq({}.polluted, undefined);
  eq(Object.prototype.hasOwnProperty.call(s.tracks[0], '__proto__'), false);
});
test('io: the result is a sanitize fixed point (bad input repaired), and exportScore puts schemaVersion first in a deep clone', () => {
  const s = io.parseInput({ tracks: [{ showTablature: true, tuning: 'x', measures: [{ beats: [{ type: 'note', duration: 'x', notes: [{ string: 9, fret: 1 }] }, 5] }, 'm'] }] });
  ok(sanitizeScore(s) === s, 'fixed point');
  eq(s.tracks[0].measures, [{ beats: [{ type: 'rest', duration: 'quarter' }] }, { beats: [] }]);
  const out = io.exportScore(s);
  eq(Object.keys(out)[0], 'schemaVersion');
  eq(out, { schemaVersion: 1, ...s });
  ok(out.tracks !== s.tracks, 'clone');
});
test('io: round trip exportScore(parseInput(x)) deep-equals {schemaVersion:1, ...sanitizeScore(x)} for every snapshot case (B4)', () => {
  for (const c of cases) {
    const x = clone(c.score);
    eq(io.exportScore(io.parseInput(x)), { schemaVersion: 1, ...JSON.parse(JSON.stringify(sanitizeScore(x))) }, c.id);
    const m = io.parseInput(x);
    ok(sanitizeScore(m) === m, `${c.id}: fixed point`);
  }
});
test('defaultScore: one guitar track, standard tuning, notation + TAB, 4/4, one empty measure; sanitize-stable', () => {
  const d = defaultScore();
  eq(d.tracks.length, 1);
  eq([d.tracks[0].showStandardNotation, d.tracks[0].showTablature, d.tracks[0].tuning, d.tracks[0].timeSignature, d.tracks[0].measures], [true, true, ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], { beats: 4, beatType: 4 }, [{ beats: [] }]]);
  ok(sanitizeScore(d) === d);
  ok(defaultScore() !== d && defaultScore().tracks[0].tuning !== d.tracks[0].tuning, 'fresh each call');
});

// ---------- access ----------
test('access: voice-1 reads mirror normalize (voices[0].beats, beats, holes, non-array voices)', () => {
  const s = sc(tab([
    { beats: [nt('half')] },
    { voices: [{ beats: [nt('whole')] }, { beats: [nt('whole', 3, 2)] }], beats: [nt('quarter')] },
    null,
    { voices: [5] },
    { voices: [], beats: [rest()] },
  ]));
  eq([0, 1, 2, 3, 4, 9].map((mi) => A.beatsAt(s, 0, mi).map((b) => b.duration)), [['half'], ['whole'], [], [], ['quarter'], []]);
  const n = normalizeScore(s);
  [0, 1, 2, 3, 4].forEach((mi) => eq(A.beatsAt(s, 0, mi).length, n.tracks[0].measures[mi].beats.length, `m${mi}`));
});
test('access: track helpers (stringCount, hasTab, hasNotation, isVisible, measureCount with hidden tracks and holes)', () => {
  eq(A.stringCount({ tuning: ['E1', 'A1', 'D2', 'G2'] }), 4);
  eq(A.stringCount({}), 6);
  eq([A.hasTab({}), A.hasNotation({}), A.isVisible({})], [false, true, true]);
  eq(A.isVisible({ showStandardNotation: false }), false);
  eq(A.isVisible({ showStandardNotation: false, showTablature: true }), true);
  eq(A.measureCount({}), 1);
  eq(A.measureCount(sc(tab([{}, {}]), { showStandardNotation: false, measures: [{}, {}, {}] })), 3);
});
test('access: updateBeats copies only the edited path; a two-voice measure keeps voice 2 and measure.beats by reference (C8)', () => {
  const v1 = { beats: [nt('whole')], extra: 1 };
  const v2 = { beats: [nt('whole', 3, 2)] };
  const legacy = [nt('quarter')];
  const s = sc(tab([{ beats: [nt('whole')] }, { voices: [v1, v2], beats: legacy }]), tab([{ beats: [] }]));
  const out = A.updateBeats(s, 0, 1, (b) => [...b, rest()]);
  ok(out !== s && out.tracks !== s.tracks && out.tracks[0] !== s.tracks[0], 'path copied');
  ok(out.tracks[1] === s.tracks[1] && out.tracks[0].measures[0] === s.tracks[0].measures[0], 'siblings shared');
  const m = out.tracks[0].measures[1];
  ok(m.voices[1] === v2 && m.beats === legacy, 'voice 2 and beats by reference');
  eq(m.voices[0], { beats: [nt('whole'), rest()], extra: 1 });
  eq(s.tracks[0].measures[1].voices[0].beats.length, 1, 'input untouched');
  ok(sanitizeScore(out) === out);
});
test('access: writing a hole materializes { beats: [] } (padding up to it); updateBeat / updateNote return the score itself when nothing changes', () => {
  const s = sc(tab([{ beats: [nt('whole')] }]));
  const out = A.updateBeats(s, 0, 2, (b) => [...b, rest('whole')]);
  eq(out.tracks[0].measures, [{ beats: [nt('whole')] }, { beats: [] }, { beats: [rest('whole')] }]);
  ok(A.updateBeat(s, 0, 0, 0, (b) => b) === s);
  ok(A.updateNote(s, 0, 0, 0, 5, () => ({})) === s, 'no note on string 5');
  ok(A.updateNote(s, 0, 0, 0, 1, (n) => n) === s);
  eq(A.updateNote(s, 0, 0, 0, 1, (n) => ({ ...n, fret: 7 })).tracks[0].measures[0].beats[0].notes, [{ string: 1, fret: 7 }]);
});
test('access: clampDots mirrors normalize; without() keeps identity when no key is present', () => {
  eq([undefined, 0, 1, 2, '1', 7, -1, 'x', 2.7].map(A.clampDots), [0, 0, 1, 2, 1, 4, 0, 0, 2]);
  const o = { a: 1 };
  ok(A.without(o, 'b') === o);
  eq(A.without({ a: 1, b: 2 }, 'b'), { a: 1 });
});

// ---------- fill ----------
test('fill: timeSignatureAt mirrors normalize (track, score, 4/4, measure changes carried forward)', () => {
  const s = { timeSignature: { beats: 2, beatType: 4 }, tracks: [
    tab([{ beats: [] }, { timeSignature: { beats: 3, beatType: 8 }, beats: [] }, { beats: [] }, null, { timeSignature: { beats: 5, beatType: 4 } }]),
    tab([{ beats: [] }], { timeSignature: { beats: 6, beatType: 8 } }),
  ] };
  const n = normalizeScore(s);
  n.tracks.forEach((t, ti) => t.measures.forEach((m, mi) => eq(F.timeSignatureAt(s, ti, mi), m.timeSignature, `t${ti} m${mi}`)));
  eq(F.timeSignatureAt({ tracks: [tab([{}])] }, 0, 0), { beats: 4, beatType: 4 });
});
test('fill: measureFill counts voice 1 only (hidden rests count, graces do not, dots and tuplets exact); empty / hole is under', () => {
  const s = sc(tab([
    { beats: [nt('half'), rest('quarter', { hidden: true }), graceB(), nt('quarter')] },
    { beats: [nt('half', 1, 0, { dots: 1 }), nt('half')] },
    { beats: [nt('8th', 1, 0, { tuplet: 3 }), nt('8th', 1, 0, { tuplet: 3 }), nt('8th', 1, 0, { tuplet: 3 }), nt('half', 1, 0, { dots: 1 })] },
    { voices: [{ beats: [nt('half')] }, { beats: [nt('whole')] }] },
    { beats: [] },
    { beats: [graceB()] },
    { beats: [nt('whole'), nt('8th', 1, 0, { dots: '1' })] },
  ]));
  eq([0, 1, 2, 3, 4, 5, 6, 7].map((mi) => F.measureFill(s, 0, mi)), ['full', 'over', 'full', 'under', 'under', 'under', 'over', 'under']);
  eq(F.fillTable(s), [['full', 'over', 'full', 'under', 'empty', 'empty', 'over']]);
});
test('fill: onsetOf sums non-grace beats before i; the append slot onset is the total', () => {
  const beats = [nt('quarter'), graceB(), nt('8th'), rest('8th', { hidden: true })];
  eq([0, 1, 2, 3, 4].map((i) => F.onsetOf(beats, i)), [{ n: 0, d: 1 }, { n: 1, d: 4 }, { n: 1, d: 4 }, { n: 3, d: 8 }, { n: 1, d: 2 }]);
  eq(F.measureTotal(beats), { n: 1, d: 2 });
});

// ---------- cursor ----------
const riff = () => sc(
  tab([
    { beats: [nt('quarter'), graceB(), nt('quarter', 2, 2), rest('quarter', { hidden: true }), nt('quarter')] },
    { beats: [nt('half'), nt('quarter')] },
    { beats: [] },
  ]),
  { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [] }] },
  tab([{ beats: [nt('8th'), nt('8th'), nt('8th'), nt('8th'), nt('half')] }], { tuning: ['E1', 'A1', 'D2', 'G2'], showStandardNotation: false }),
  { name: 'Notes', measures: [{ beats: [nt('whole')] }] },
);
test('cursor: positions skip graces, include hidden rests, add the append slot only when under (C2-C4)', () => {
  const s = riff();
  eq(C.positions(s, 0, 0), [0, 2, 3, 4]);
  eq(C.positions(s, 0, 1), [0, 1, 2]);
  eq(C.positions(s, 0, 2), [0]);
  eq(C.positions(s, 2, 1), [0], 'hole is an empty measure');
  eq(C.positions(sc(tab([{ beats: [graceB()] }])), 0, 0), [1]);
});
test('cursor: clampCursor (invisible track -> nearest visible, measure, next position at or after, string by tuning)', () => {
  const s = riff();
  eq(C.clampCursor(s, cur(1, 0, 0)), cur(0, 0, 0), 'hidden track 1 -> nearest (lower first)');
  eq(C.clampCursor(s, cur(9, 9, 9, 9)), cur(3, 2, 0, 6));
  eq(C.clampCursor(s, cur(0, 0, 1, 0)), cur(0, 0, 2, 1), 'grace -> next position');
  eq(C.clampCursor(s, cur(0, 1, 9, 3)), cur(0, 1, 2, 3), 'past the end -> last (append slot)');
  eq(C.clampCursor(s, cur(2, 0, 0, 6)), cur(2, 0, 0, 4));
  eq(C.clampCursor(s, { track: 'x', measure: NaN, beat: undefined, string: null }), cur(0, 0, 0, 1));
  eq(C.clampCursor({}, cur(0, 0, 0)), cur(0, 0, 0), 'no tracks');
});
test('cursor: syncDuration takes the beat duration and dots, keeps state on the append slot (C9)', () => {
  const s = sc(tab([{ beats: [nt('half', 1, 0, { dots: 1 }), nt('8th')] }]));
  const st = { duration: 'quarter', dots: 0, digit: null };
  eq(C.syncDuration(s, cur(0, 0, 0), st), { duration: 'half', dots: 1, digit: null });
  ok(C.syncDuration(s, cur(0, 0, 2), st) === st);
});
test('cursor: Left/Right walk positions across measures, Right stops at the end of the score; Left mirrors Right', () => {
  const s = riff();
  const seq = [];
  let c = cur(0, 0, 0);
  for (let i = 0; i < 9; i++) { const r = C.moveRight(s, c); if (!r.cursor) { seq.push(r.announce.id); break; } c = r.cursor; seq.push(`${c.measure}:${c.beat}`); }
  eq(seq, ['0:2', '0:3', '0:4', '1:0', '1:1', '1:2', '2:0', 'endOfScore']);
  const back = [];
  for (let i = 0; i < 9; i++) { const r = C.moveLeft(s, c); if (!r.cursor) { back.push(r.announce.id); break; } c = r.cursor; back.push(`${c.measure}:${c.beat}`); }
  eq(back, ['1:2', '1:1', '1:0', '0:4', '0:3', '0:2', '0:0', 'startOfScore']);
});
test('cursor: Up/Down change string without wrapping; no-op without TAB', () => {
  const s = riff();
  eq(C.moveUp(s, cur(0, 0, 0, 1)).cursor.string, 1);
  eq(C.moveDown(s, cur(0, 0, 0, 1)).cursor.string, 2);
  eq(C.moveDown(s, cur(0, 0, 0, 6)).cursor.string, 6);
  eq(C.moveDown(s, cur(2, 0, 0, 4)).cursor.string, 4);
  eq(C.moveDown(s, cur(3, 0, 0, 1)), {});
});
test('cursor: measure moves, Home/End, Ctrl+Home/End (track kept; Ctrl+End = last beat, not the slot)', () => {
  const s = riff();
  eq(C.nextMeasure(s, cur(0, 0, 3)).cursor, cur(0, 1, 0));
  eq(C.prevMeasure(s, cur(0, 1, 2)).cursor, cur(0, 0, 0));
  eq(C.prevMeasure(s, cur(0, 0, 2)).announce.id, 'startOfScore');
  eq(C.nextMeasure(s, cur(0, 2, 0)).announce.id, 'endOfScore');
  eq(C.measureEnd(s, cur(0, 1, 0)).cursor, cur(0, 1, 2), 'End reaches the append slot');
  eq(C.measureEnd(s, cur(0, 0, 0)).cursor, cur(0, 0, 4));
  eq(C.measureStart(s, cur(0, 0, 4)).cursor, cur(0, 0, 0));
  eq(C.scoreEnd(s, cur(2, 0, 0, 2)).cursor, cur(2, 2, 0, 2));
  const s2 = sc(tab([{ beats: [nt('whole')] }, { beats: [nt('half')] }]));
  eq(C.scoreEnd(s2, cur(0, 0, 0)).cursor, cur(0, 1, 0), 'last beat, not the slot');
  eq(C.scoreStart(s, cur(2, 0, 3, 3)).cursor, cur(2, 0, 0, 3));
});
test('cursor: PageUp/PageDown skip invisible tracks, keep the measure, take the nearest onset (ties earlier), clamp the string (C5, C10)', () => {
  const s = riff();
  eq(C.nextTrack(s, cur(0, 0, 2, 6)).cursor, cur(2, 0, 2, 4), 'onset 1/4 -> third 8th');
  eq(C.prevTrack(s, cur(2, 0, 1, 2)).cursor, cur(0, 0, 0, 2), '1/8 is equally near 0 and 1/4 -> earlier');
  eq(C.nextTrack(s, cur(2, 0, 4, 1)).cursor, cur(3, 0, 0, 1));
  eq(C.nextTrack(s, cur(3, 0, 0)).announce.id, 'lastTrack');
  eq(C.prevTrack(s, cur(0, 0, 0)).announce.id, 'firstTrack');
});
test('cursor: cursorInfo summarizes the cursor (fret, duration, slot, fill, names, tuning note, beat number)', () => {
  const s = riff();
  const st = { duration: '8th', dots: 1, digit: null };
  const i = C.cursorInfo(s, cur(0, 0, 2, 2), st);
  eq([i.fret, i.duration, i.dots, i.isRest, i.appendSlot, i.fill, i.measureCount, i.trackName, i.trackCount, i.stringCount, i.tuningNote, i.hasTab, i.beatNumber, i.beatTotal, i.voice],
    [2, 'quarter', 0, false, false, 'full', 3, 'Gtr', 4, 6, 'B3', true, 2, 4, 1]);
  const slot = C.cursorInfo(s, cur(0, 1, 2, 1), st);
  eq([slot.appendSlot, slot.duration, slot.dots, slot.fret, slot.fill, slot.beatNumber], [true, '8th', 1, null, 'under', 2]);
  const empty = C.cursorInfo(s, cur(0, 2, 0, 1), st);
  eq([empty.empty, empty.appendSlot], [true, true]);
  eq(C.cursorInfo(s, cur(2, 0, 0, 4), st).tuningNote, 'E1');
  eq(C.cursorInfo(s, cur(3, 0, 0, 1), st).tuningNote, null);
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-model: ${r.name}`);
    else { fail++; console.log(`FAIL editor-model: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
