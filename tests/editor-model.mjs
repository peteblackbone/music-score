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
const { EDITOR_LIMITS } = await imp('src/editor/model/limits.js');
test('io limits: each structure limit accepts exactly the limit and rejects one more with "Score too large" (before sanitize)', () => {
  const L = EDITOR_LIMITS;
  eq(L, { jsonChars: 5 * 1024 * 1024, tracks: 32, measuresPerTrack: 2000, voicesPerMeasure: 4, beatsPerVoice: 256, notesPerBeat: 16, tuningStrings: 12 });
  const T = (extra = {}, measures = [{ beats: [] }]) => ({ showTablature: true, ...extra, measures });
  const notes = (n) => Array.from({ length: n }, (_, i) => ({ pitch: 'C4', fret: i % 20 }));
  const cases = [
    ['tracks', (n) => ({ tracks: Array.from({ length: n }, () => T()) }), L.tracks],
    ['measures in a track', (n) => ({ tracks: [T({}, Array.from({ length: n }, () => ({ beats: [] })))] }), L.measuresPerTrack],
    ['beats in a measure', (n) => ({ tracks: [T({}, [{ beats: Array.from({ length: n }, () => ({ type: 'rest', duration: '64th' })) }])] }), L.beatsPerVoice],
    ['beats in a measure', (n) => ({ tracks: [T({}, [{ voices: [{ beats: [] }, { beats: Array.from({ length: n }, () => ({ type: 'rest', duration: '64th' })) }] }])] }), L.beatsPerVoice],
    ['voices in a measure', (n) => ({ tracks: [T({}, [{ voices: Array.from({ length: n }, () => ({ beats: [] })) }])] }), L.voicesPerMeasure],
    ['notes in a beat', (n) => ({ tracks: [T({}, [{ beats: [{ type: 'note', duration: 'whole', notes: notes(n) }] }])] }), L.notesPerBeat],
    ['tuning strings', (n) => ({ tracks: [T({ tuning: Array.from({ length: n }, () => 'E2') })] }), L.tuningStrings],
  ];
  for (const [what, make, limit] of cases) {
    io.parseInput(make(limit));
    throws(() => io.parseInput(make(limit + 1)), `Score too large: ${limit + 1} ${what} (limit ${limit})`);
    throws(() => io.parseInput(JSON.stringify(make(limit + 1))), 'Score too large');
  }
});
test('io limits: JSON text over 5 MB characters is rejected before parsing (strings and objects)', () => {
  const pad = (n) => `{"title":"${'x'.repeat(n - 12)}"}`;
  eq(pad(100).length, 100);
  io.parseInput(pad(EDITOR_LIMITS.jsonChars));
  throws(() => io.parseInput(pad(EDITOR_LIMITS.jsonChars + 1)), 'Score too large');
  throws(() => io.parseInput(`${pad(EDITOR_LIMITS.jsonChars)} `), 'characters of JSON');
  throws(() => io.parseInput({ title: 'x'.repeat(EDITOR_LIMITS.jsonChars) }), 'Score too large');
  throws(() => io.parseInput({ schemaVersion: 2, tracks: Array.from({ length: 40 }, () => ({})) }), 'Unsupported schemaVersion');
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
  const many = { tracks: Array.from({ length: 300000 }, (_, i) => ({ measures: i === 7 ? [{}, {}] : [] })) };
  eq(A.measureCount(many), 2, 'a loop, not Math.max(...spread): no RangeError on huge track counts');
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

// ---------- ties ----------
const T = await imp('src/editor/model/ties.js');
const N = await imp('src/editor/model/notes.js');
const tn = (duration, string, fret, flags = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }] });
const beatsOf = (s, ti = 0, mi = 0) => A.beatsAt(s, ti, mi);
test('ties: prevMainBeat / nextMainBeat skip graces and cross into the adjacent measure only', () => {
  const s = sc(tab([{ beats: [nt('half'), graceB(), nt('half')] }, { beats: [] }, { beats: [graceB(), nt('whole')] }]));
  eq(T.prevMainBeat(s, 0, 0, 2), { mi: 0, bi: 0 });
  eq(T.prevMainBeat(s, 0, 0, 0), null);
  eq(T.nextMainBeat(s, 0, 0, 0), { mi: 0, bi: 2 });
  eq(T.nextMainBeat(s, 0, 0, 2), null, 'next measure is empty');
  eq(T.prevMainBeat(s, 0, 2, 1), null, 'previous measure is empty');
  eq(T.prevMainBeat(s, 0, 1, 0), { mi: 0, bi: 2 });
  eq(T.nextMainBeat(s, 0, 1, -1), { mi: 2, bi: 1 });
});
test('ties: fixSeam keeps a pair, strips half ties, and returns the score itself when nothing changes', () => {
  const s = sc(tab([{ beats: [tn('half', 1, 5, { tieStart: true }), tn('half', 1, 5, { tieEnd: true })] }, { beats: [tn('whole', 2, 3, { tieEnd: true })] }]));
  ok(T.fixSeam(s, 0, { mi: 0, bi: 0 }, { mi: 0, bi: 1 }) === s, 'pair kept');
  const out = T.fixSeam(s, 0, { mi: 0, bi: 1 }, { mi: 1, bi: 0 });
  eq(beatsOf(out, 0, 1)[0].notes[0], { string: 2, fret: 3 });
  const broken = T.fixSeam(s, 0, { mi: 0, bi: 0 }, null);
  eq(beatsOf(broken)[0].notes[0], { string: 1, fret: 5 });
  ok(beatsOf(broken)[1] === beatsOf(s)[1], 'other beat untouched');
});

// ---------- notes (E1–E3, E5, E7, E11) ----------
const ST = { duration: 'quarter', dots: 0, digit: null };
const CTX = { maxFret: 24, now: 1000, twoDigitDelayMs: 800, allowAppend: true };
const ctxAt = (now, extra = {}) => ({ ...CTX, now, ...extra });
test('digit: on a note beat replaces the fret on that string (pitch deleted) or adds a chord note (E1, E3)', () => {
  const s = sc(tab([{ beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 1, pitch: 'C4' }] }] }]));
  const r = N.digit(s, cur(0, 0, 0, 2), ST, CTX, 3);
  eq(beatsOf(r.score)[0].notes, [{ string: 2, fret: 3 }]);
  eq(r.announce, { id: 'fret', fret: 3 });
  const r2 = N.digit(s, cur(0, 0, 0, 5), ST, CTX, 7);
  eq(beatsOf(r2.score)[0].notes, [{ string: 2, fret: 1, pitch: 'C4' }, { string: 5, fret: 7 }]);
  eq(r2.announce, { id: 'chordNote', fret: 7, count: 2 });
  ok(sanitizeScore(r.score) === r.score && sanitizeScore(r2.score) === r2.score);
});
test('digit: on a rest the beat becomes a note keeping its other fields (hidden dropped); on the slot / empty measure a new beat with the current duration (E1)', () => {
  const s = sc(tab([{ beats: [rest('half', { hidden: true, dynamic: 'p', dots: 1 })] }, { beats: [] }]));
  eq(beatsOf(N.digit(s, cur(0, 0, 0, 3), ST, CTX, 5).score)[0], { type: 'note', duration: 'half', dynamic: 'p', dots: 1, notes: [{ string: 3, fret: 5 }] });
  eq(beatsOf(N.digit(s, cur(0, 0, 1, 3), { ...ST, duration: '8th', dots: 1 }, CTX, 5).score)[1], { type: 'note', duration: '8th', dots: 1, notes: [{ string: 3, fret: 5 }] });
  eq(beatsOf(N.digit(s, cur(0, 1, 0, 6), ST, CTX, 0).score, 0, 1), [{ type: 'note', duration: 'quarter', notes: [{ string: 6, fret: 0 }] }], 'no dots key at 0');
  const hole = sc(tab([{ beats: [nt('whole')] }]), tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }]));
  eq(N.digit(hole, cur(0, 1, 0, 1), ST, CTX, 2).score.tracks[0].measures[1], { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 2 }] }] }, 'a short track is padded on write');
});
test('digit: appended after trailing graces; slash removed (E11); same fret is no change', () => {
  const s = sc(tab([{ beats: [nt('half'), graceB()] }, { beats: [{ type: 'note', duration: 'whole', slash: true }] }]));
  eq(beatsOf(N.digit(s, cur(0, 0, 2, 1), ST, CTX, 9).score).map((b) => b.type), ['note', 'grace', 'note']);
  eq(beatsOf(N.digit(s, cur(0, 1, 0, 4), ST, CTX, 2).score, 0, 1)[0], { type: 'note', duration: 'whole', notes: [{ string: 4, fret: 2 }] });
  ok(N.digit(s, cur(0, 0, 0, 1), ST, CTX, 0).score === s, 'same fret');
});
test('digit: refused without TAB (C6) and above maxFret; never writes pitch, soundingPitch or fromFret', () => {
  const s = sc({ measures: [{ beats: [nt('quarter')] }] });
  eq(N.digit(s, cur(0, 0, 0), ST, CTX, 1).announce, { id: 'refusedNoTab' });
  eq(N.digit(s, cur(0, 0, 0), ST, CTX, 1).score, undefined);
  const t = sc(tab([{ beats: [] }]));
  eq(N.digit(t, cur(0, 0, 0), ST, ctxAt(0, { maxFret: 5 }), 7).announce, { id: 'refusedMaxFret', max: 5 });
  const out = JSON.stringify(N.digit(t, cur(0, 0, 0), ST, CTX, 7).score);
  ok(!/pitch|fromFret/i.test(out), out);
});
test('digit buffer: second digit within the delay at the same position combines (coalesce), else replaces (E2)', () => {
  let s = sc(tab([{ beats: [nt('quarter', 1, 0)] }, { beats: [] }]));
  const c = cur(0, 0, 0, 1);
  const a = N.digit(s, c, ST, ctxAt(1000), 1);
  eq([a.coalesce, a.state.digit.first], [false, 1]);
  const b = N.digit(a.score, c, a.state, ctxAt(1700), 2);
  eq([b.coalesce, b.state.digit, beatsOf(b.score)[0].notes[0].fret, b.announce], [true, null, 12, { id: 'fret', fret: 12 }]);
  const late = N.digit(a.score, c, a.state, ctxAt(1801), 2);
  eq([late.coalesce, beatsOf(late.score)[0].notes[0].fret], [false, 2]);
  const big = N.digit(a.score, c, { ...a.state, digit: { ...a.state.digit, first: 3 } }, ctxAt(1100), 5);
  eq([big.coalesce, beatsOf(big.score)[0].notes[0].fret, big.state.digit.first], [false, 5, 5], '35 > 24 replaces');
  const moved = N.digit(a.score, cur(0, 0, 0, 2), a.state, ctxAt(1100), 2);
  eq(moved.coalesce, false, 'other string');
  // on the append slot the first digit creates a beat at the cursor index; the second combines on it
  s = sc(tab([{ beats: [] }]));
  const x = N.digit(s, cur(0, 0, 0, 3), ST, ctxAt(0), 1);
  const y = N.digit(x.score, cur(0, 0, 0, 3), x.state, ctxAt(10), 5);
  eq([y.coalesce, beatsOf(y.score).length, beatsOf(y.score)[0].notes[0].fret], [true, 1, 15]);
});
test('digit: re-fretting a tied note unties it and its partners; adding a note breaks a dangling tie into the beat', () => {
  const s = sc(tab([{ beats: [tn('half', 1, 5, { tieStart: true }), tn('quarter', 1, 5, { tieEnd: true, tieStart: true })] }, { beats: [tn('whole', 1, 5, { tieEnd: true })] }]));
  const r = N.digit(s, cur(0, 0, 1, 1), ST, CTX, 7);
  eq([beatsOf(r.score)[0].notes[0], beatsOf(r.score)[1].notes[0], beatsOf(r.score, 0, 1)[0].notes[0]], [{ string: 1, fret: 5 }, { string: 1, fret: 7 }, { string: 1, fret: 5 }]);
  const same = N.digit(s, cur(0, 0, 1, 1), ST, CTX, 5);
  ok(same.score === s, 'same fret keeps the ties');
  const d = sc(tab([{ beats: [tn('half', 2, 5, { tieStart: true }), nt('half', 1, 0)] }]));
  eq(beatsOf(N.digit(d, cur(0, 0, 1, 2), ST, CTX, 5).score)[0].notes[0], { string: 2, fret: 5 });
});
test('deleteNote: removes the note on the string; the last note leaves a rest keeping other fields; partners untied (E5)', () => {
  const s = sc(tab([{ beats: [
    { type: 'note', duration: 'half', dynamic: 'f', slash: false, notes: [{ string: 1, fret: 3, tieStart: true }] },
    { type: 'note', duration: 'half', notes: [{ string: 1, fret: 3, tieEnd: true }, { string: 2, fret: 1 }] },
  ] }]));
  const a = N.deleteNote(s, cur(0, 0, 1, 1));
  eq(beatsOf(a.score)[1].notes, [{ string: 2, fret: 1 }]);
  eq(beatsOf(a.score)[0].notes[0], { string: 1, fret: 3 });
  eq(a.announce.id, 'noteDeleted');
  const b = N.deleteNote(s, cur(0, 0, 0, 1));
  eq(beatsOf(b.score)[0], { type: 'rest', duration: 'half', dynamic: 'f' });
  eq(beatsOf(b.score)[1].notes[0], { string: 1, fret: 3 });
  eq(b.announce.id, 'noteDeletedRest');
  ok(sanitizeScore(b.score) === b.score);
  eq(N.deleteNote(s, cur(0, 0, 0, 4)), { announce: { id: 'noNote' } });
  eq(N.deleteNote(sc(tab([{ beats: [rest()] }])), cur(0, 0, 0, 1)), { announce: { id: 'noNote' } });
  eq(N.deleteNote(sc(tab([{ beats: [rest()] }])), cur(0, 0, 1, 1)), { announce: { id: 'noNote' } }, 'append slot');
});
test('toggleTie: ties to the previous main beat (also across a barline), copies the fret, then removes both flags (E7)', () => {
  const s = sc(tab([{ beats: [nt('half', 3, 7), graceB(3, 9), { type: 'note', duration: 'half', notes: [{ string: 3, fret: 2, pitch: 'A3' }] }] }, { beats: [nt('whole', 3, 4)] }]));
  const a = N.toggleTie(s, cur(0, 0, 2, 3));
  eq([beatsOf(a.score)[0].notes[0], beatsOf(a.score)[2].notes[0]], [{ string: 3, fret: 7, tieStart: true }, { string: 3, fret: 7, tieEnd: true }]);
  eq(a.announce, { id: 'tiedTo', fret: 7 });
  const b = N.toggleTie(a.score, cur(0, 0, 2, 3));
  eq([beatsOf(b.score)[0].notes[0], beatsOf(b.score)[2].notes[0]], [{ string: 3, fret: 7 }, { string: 3, fret: 7 }]);
  eq(b.announce.id, 'tieRemoved');
  const x = N.toggleTie(s, cur(0, 1, 0, 3));
  eq([beatsOf(x.score)[2].notes[0].tieStart, beatsOf(x.score, 0, 1)[0].notes[0]], [true, { string: 3, fret: 2, tieEnd: true }]);
  eq(N.toggleTie(s, cur(0, 0, 0, 3)).announce.id, 'nothingToTie');
  eq(N.toggleTie(s, cur(0, 0, 0, 1)).announce.id, 'noNoteHere');
  eq(N.toggleTie(sc(tab([{ beats: [rest(), nt('half', 1, 1)] }])), cur(0, 0, 1, 1)).announce.id, 'nothingToTie');
});

// ---------- beats (E4, E6, E8, rhythm keys) ----------
const B = await imp('src/editor/model/beats.js');
test('shorter / longer: step the cursor beat duration and the state; limits at whole and 64th; slot changes the state only (E4)', () => {
  const s = sc(tab([{ beats: [nt('quarter', 1, 0, { dots: 1 }), nt('whole'), nt('64th')] }]));
  const a = B.shorter(s, cur(0, 0, 0), ST);
  eq([beatsOf(a.score)[0], a.state.duration, a.announce], [nt('8th', 1, 0, { dots: 1 }), '8th', { id: 'duration', duration: '8th', dots: 1 }]);
  ok(beatsOf(a.score)[1] === beatsOf(s)[1], 'other beats untouched');
  eq(B.longer(s, cur(0, 0, 0), ST).state.duration, 'half');
  eq(B.longer(s, cur(0, 0, 1), ST), { announce: { id: 'limit' } });
  eq(B.shorter(s, cur(0, 0, 2), ST), { announce: { id: 'limit' } });
  const u = sc(tab([{ beats: [nt('half')] }]));
  const slot = B.shorter(u, cur(0, 0, 1), ST);
  eq([slot.score, slot.state.duration, slot.announce.id], [undefined, '8th', 'nextDuration']);
});
test('setDuration: sets the duration directly; unknown names are refused; same duration is no change', () => {
  const s = sc(tab([{ beats: [nt('quarter')] }]));
  eq(beatsOf(B.setDuration(s, cur(0, 0, 0), ST, CTX, '16th').score)[0].duration, '16th');
  ok(B.setDuration(s, cur(0, 0, 0), ST, CTX, 'quarter').score === s);
  eq(B.setDuration(s, cur(0, 0, 0), ST, CTX, 'breve'), { announce: { id: 'limit' } });
});
test('cycleDots: 0 -> 1 -> 2 -> 0, 3 or 4 -> 0, key deleted at 0; slot changes the state only', () => {
  const run = (dots) => beatsOf(B.cycleDots(sc(tab([{ beats: [nt('quarter', 1, 0, dots === undefined ? {} : { dots })] }])), cur(0, 0, 0), ST).score)[0].dots;
  eq([undefined, 1, 2, 3, 4, '1'].map(run), [1, 2, undefined, undefined, undefined, 2]);
  const r = B.cycleDots(sc(tab([{ beats: [] }])), cur(0, 0, 0), { ...ST, dots: 1 });
  eq([r.score, r.state.dots, r.announce], [undefined, 2, { id: 'dots', duration: 'quarter', dots: 2 }]);
});
test('toggleTriplet: sets tuplet 3 / deletes any tuplet; refused on the slot and with valid nested tuplets', () => {
  const s = sc(tab([{ beats: [nt('8th'), nt('8th', 1, 0, { tuplet: { count: 5 } }), nt('8th', 1, 0, { tuplets: [3, 3] }), nt('8th', 1, 0, { tuplets: 'x' })] }]));
  eq([beatsOf(B.toggleTriplet(s, cur(0, 0, 0)).score)[0].tuplet, B.toggleTriplet(s, cur(0, 0, 0)).announce.id], [3, 'tripletOn']);
  eq(['tuplet' in beatsOf(B.toggleTriplet(s, cur(0, 0, 1)).score)[1], B.toggleTriplet(s, cur(0, 0, 1)).announce.id], [false, 'tripletOff']);
  eq(B.toggleTriplet(s, cur(0, 0, 2)), { announce: { id: 'nestedTuplet' } });
  eq(beatsOf(B.toggleTriplet(s, cur(0, 0, 3)).score)[3].tuplet, 3, 'invalid nested tuplets are ignored');
  eq(B.toggleTriplet(sc(tab([{ beats: [] }])), cur(0, 0, 0)), { announce: { id: 'noBeat' } });
});
test('toggleRest: note -> rest (notes, slash dropped, ties repaired); rest -> fret 0 on TAB; refused without TAB; slot appends a rest', () => {
  const s = sc(tab([{ beats: [tn('half', 2, 3, { tieStart: true }), { type: 'note', duration: 'half', slash: false, lyric: 'la', notes: [{ string: 2, fret: 3, tieEnd: true }] }] }]));
  const a = B.toggleRest(s, cur(0, 0, 1, 2), ST);
  eq(beatsOf(a.score)[1], { type: 'rest', duration: 'half', lyric: 'la' });
  eq(beatsOf(a.score)[0].notes[0], { string: 2, fret: 3 });
  const b = B.toggleRest(a.score, cur(0, 0, 1, 4), ST);
  eq(beatsOf(b.score)[1], { type: 'note', duration: 'half', lyric: 'la', notes: [{ string: 4, fret: 0 }] });
  eq(B.toggleRest(sc({ measures: [{ beats: [rest()] }] }), cur(0, 0, 0), ST).announce.id, 'refusedNoTab');
  const n = B.toggleRest(sc({ measures: [{ beats: [nt('quarter')] }] }), cur(0, 0, 0), ST);
  eq(beatsOf(n.score)[0], rest(), 'note -> rest works without TAB');
  const h = B.toggleRest(sc(tab([{ beats: [rest('quarter', { hidden: true })] }])), cur(0, 0, 0, 1), ST);
  eq(beatsOf(h.score)[0], { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 0 }] });
  const slot = B.toggleRest(sc(tab([{ beats: [nt('half')] }])), cur(0, 0, 1), { ...ST, duration: '8th', dots: 1 });
  eq([beatsOf(slot.score)[1], slot.cursor.beat], [rest('8th', { dots: 1 }), 1]);
  [a, b, n, h, slot].forEach((r) => ok(sanitizeScore(r.score) === r.score));
});
test('deleteBeat: removes the beat with its leading graces, bridges ties across the gap, keeps the index (E6)', () => {
  const s = sc(tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), graceB(), graceB(), tn('quarter', 1, 5, { tieEnd: true }), nt('half')] }]));
  const a = B.deleteBeat(s, cur(0, 0, 3));
  eq(beatsOf(a.score).map((b) => b.duration), ['quarter', 'half']);
  eq(beatsOf(a.score)[0].notes[0], { string: 1, fret: 5 }, 'dangling tieStart removed');
  eq(a.cursor.beat, 1);
  const chain = sc(tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), tn('quarter', 1, 5, { tieStart: true, tieEnd: true }), tn('half', 1, 5, { tieEnd: true })] }]));
  const c = B.deleteBeat(chain, cur(0, 0, 1));
  eq(beatsOf(c.score).map((b) => b.notes[0]), [{ string: 1, fret: 5, tieStart: true }, { string: 1, fret: 5, tieEnd: true }], 'a chain stays tied');
  const last = B.deleteBeat(sc(tab([{ beats: [nt('whole')] }])), cur(0, 0, 0));
  eq(beatsOf(last.score), [], 'a measure may end up empty');
  eq(B.deleteBeat(sc(tab([{ beats: [] }])), cur(0, 0, 0)), { announce: { id: 'noBeat' } });
});
test('insertBeat: a rest with the current duration before the beat and its leading graces; on the slot before trailing graces (E8)', () => {
  const s = sc(tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), graceB(), tn('quarter', 1, 5, { tieEnd: true }), graceB()] }]));
  const a = B.insertBeat(s, cur(0, 0, 2), { ...ST, duration: '16th' });
  eq(beatsOf(a.score).map((b) => b.type), ['note', 'rest', 'grace', 'note', 'grace']);
  eq([a.cursor.beat, beatsOf(a.score)[1]], [1, rest('16th')]);
  eq([beatsOf(a.score)[0].notes[0].tieStart, beatsOf(a.score)[3].notes[0].tieEnd], [undefined, undefined], 'tie broken by the rest');
  const b = B.insertBeat(s, cur(0, 0, 4), ST);
  eq(beatsOf(b.score).map((x) => x.type), ['note', 'grace', 'note', 'rest', 'grace']);
  eq(b.cursor.beat, 3);
  ok(sanitizeScore(a.score) === a.score && sanitizeScore(b.score) === b.score);
});

// ---------- measures (E9, E10, C4 auto-append) ----------
const M = await imp('src/editor/model/measures.js');
test('insertMeasure: {beats: []} at the index in every track, short tracks padded, voices carried, cursor to the new measure (E9, E10)', () => {
  const v = { voices: [{ beats: [nt('whole')] }, { beats: [nt('whole', 3, 3)] }] };
  const s = sc(tab([{ beats: [nt('whole')] }, v, { beats: [nt('whole')] }]), tab([{ beats: [nt('whole')] }]));
  const a = M.insertMeasureAfter(s, cur(0, 1, 0));
  eq(a.score.tracks[0].measures.map((m) => m.beats?.length ?? 'v'), [1, 'v', 0, 1]);
  ok(a.score.tracks[0].measures[1] === v, 'two-voice measure kept by reference');
  eq(a.score.tracks[1].measures, [{ beats: [nt('whole')] }, { beats: [] }, { beats: [] }], 'short track padded to the index');
  eq([a.cursor, a.announce], [cur(0, 2, 0), { id: 'measureInserted', n: 3 }]);
  const b = M.insertMeasureBefore(s, cur(1, 0, 0));
  eq(b.score.tracks.map((t) => t.measures.length), [4, 2]);
  eq([b.cursor.measure, b.announce.n], [0, 1]);
  ok(sanitizeScore(a.score) === a.score && sanitizeScore(b.score) === b.score);
});
test('insertMeasure: ties across the new empty measure are broken', () => {
  const s = sc(tab([{ beats: [tn('whole', 1, 3, { tieStart: true })] }, { beats: [tn('whole', 1, 3, { tieEnd: true })] }]));
  const a = M.insertMeasureAfter(s, cur(0, 0, 0));
  eq([beatsOf(a.score, 0, 0)[0].notes[0], beatsOf(a.score, 0, 2)[0].notes[0]], [{ string: 1, fret: 3 }, { string: 1, fret: 3 }]);
});
test('deleteMeasure: removes index m from every track that has it, carries time/key/clef forward, takes nav marks and voices (E9)', () => {
  const s = sc(
    tab([{ beats: [nt('whole')] }, { timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, clef: 'bass', ending: 1, beats: [nt('half', 1, 0, { dots: 1 })] }, { keySignature: -1, beats: [nt('half', 1, 0, { dots: 1 })] }]),
    tab([{ beats: [nt('whole')] }, { voices: [{ beats: [nt('whole')] }, { beats: [nt('whole')] }] }]),
    tab([{ beats: [nt('whole')] }]),
  );
  const r = M.deleteMeasure(s, cur(0, 1, 0));
  eq(r.score.tracks[0].measures[1], { keySignature: -1, beats: [nt('half', 1, 0, { dots: 1 })], timeSignature: { beats: 3, beatType: 4 }, clef: 'bass' });
  eq(r.score.tracks[1].measures.length, 1);
  ok(r.score.tracks[2] === s.tracks[2], 'track without measure 1 untouched');
  eq([r.cursor, r.announce], [cur(0, 1, 0), { id: 'measureDeleted', n: 2 }]);
  const last = M.deleteMeasure(s, cur(0, 2, 0));
  eq([last.score.tracks[0].measures.length, last.cursor.measure], [2, 1]);
  ok(sanitizeScore(r.score) === r.score);
});
test('deleteMeasure: the only measure is emptied, keeping time / key / clef; an already empty one is no change', () => {
  const s = sc(tab([{ timeSignature: { beats: 6, beatType: 8 }, keySignature: 1, segno: true, beats: [nt('half')] }]), tab([null]));
  const r = M.deleteMeasure(s, cur(0, 0, 0));
  eq(r.score.tracks[0].measures, [{ timeSignature: { beats: 6, beatType: 8 }, keySignature: 1, beats: [] }]);
  ok(r.score.tracks[1] === s.tracks[1]);
  eq(r.announce.id, 'measureCleared');
  eq(M.deleteMeasure(sc(tab([{ beats: [] }])), cur(0, 0, 0)), { announce: { id: 'measureCleared' } });
});
test('deleteMeasure: ties across the new barline are repaired (pairs kept, halves removed)', () => {
  const s = sc(tab([{ beats: [tn('whole', 1, 3, { tieStart: true })] }, { beats: [tn('whole', 1, 3, { tieEnd: true })] }, { beats: [nt('whole', 1, 1)] }]));
  const r = M.deleteMeasure(s, cur(0, 1, 0));
  eq(beatsOf(r.score, 0, 0)[0].notes[0], { string: 1, fret: 3 });
});
test('Right from the last beat of a full last measure appends a measure (allowAppend); not from an underfull one or read-only (C4)', () => {
  const s = sc(tab([{ beats: [nt('whole')] }]), tab([{ beats: [nt('half')] }]));
  const r = C.moveRight(s, cur(0, 0, 0), ST, CTX);
  eq([r.score.tracks.map((t) => t.measures.length), r.cursor, r.announce], [[2, 2], cur(0, 1, 0), { id: 'measureAdded', n: 2 }]);
  eq(C.moveRight(s, cur(0, 0, 0), ST, { ...CTX, allowAppend: false }), { announce: { id: 'endOfScore' } });
  eq(C.moveRight(s, cur(1, 0, 0), ST, CTX).cursor, cur(1, 0, 1), 'underfull: to the append slot');
  eq(C.moveRight(s, cur(1, 0, 1), ST, CTX), { announce: { id: 'endOfScore' } }, 'from the slot: end of score');
  const over = sc(tab([{ beats: [nt('whole'), nt('quarter')] }]));
  eq(C.moveRight(over, cur(0, 0, 1), ST, CTX).announce.id, 'measureAdded');
});

// ---------- commands, history, keymap ----------
const { run, COMMANDS } = await imp('src/editor/model/commands.js');
const { createHistory, clampLimit } = await imp('src/editor/model/history.js');
const { keyToCommand } = await imp('src/editor/keymap.js');
test('run: clamps the cursor, reports changed / moved, clears the buffer after other commands, re-syncs the duration', () => {
  const s = sc(tab([{ beats: [nt('half'), nt('8th', 1, 0, { dots: 1 })] }]));
  const st = { duration: 'quarter', dots: 0, digit: { track: 0, measure: 0, beat: 0, string: 1, first: 1, time: 0 } };
  const r = run('moveRight', s, cur(0, 0, 0), st, CTX);
  eq([r.changed, r.moved, r.cursor, r.state], [false, true, cur(0, 0, 1), { duration: '8th', dots: 1, digit: null }]);
  const d = run('digit', s, cur(0, 0, 0), ST, CTX, 4);
  eq([d.changed, d.moved, d.state.digit.first, d.announce], [true, false, 4, { id: 'fret', fret: 4 }]);
  const e = run('deleteBeat', s, cur(0, 0, 0), ST, CTX);
  eq([e.changed, e.cursor, e.state.duration], [true, cur(0, 0, 0), '8th']);
  const n = run('moveUp', s, cur(0, 0, 0), ST, CTX);
  eq([n.changed, n.moved], [false, false]);
  eq(run('moveRight', { tracks: [{ showStandardNotation: false, measures: [] }] }, cur(0, 0, 0), ST, CTX).announce, { id: 'noTrack' });
  let threw = false; try { run('nope', s, cur(0, 0, 0), ST, CTX); } catch { threw = true; }
  ok(threw, 'unknown command throws');
  eq(Object.entries(COMMANDS).filter(([, v]) => v.kind === 'nav').length, 12);
});
test('history: push clears redo, limit drops the oldest, coalesce replaces the top after, undo/redo walk entries (F1-F4)', () => {
  const h = createHistory(2);
  const e = (i) => ({ before: i, after: i + 1 });
  h.push(e(0)); h.push(e(1)); h.push(e(2));
  eq(h.size(), 2);
  eq(h.undo().before, 2); eq(h.undo().before, 1); eq(h.undo(), null);
  eq([h.canUndo(), h.canRedo()], [false, true]);
  eq(h.redo().before, 1);
  h.push(e(9));
  eq(h.canRedo(), false);
  h.coalesce(42);
  eq(h.top().after, 42);
  h.clear();
  eq([h.canUndo(), h.canRedo()], [false, false]);
  const zero = createHistory(0); zero.push(e(0)); eq(zero.canUndo(), false);
  eq([clampLimit(undefined), clampLimit(-5), clampLimit(1e9), clampLimit(3.7), clampLimit('x')], [200, 0, 10000, 3, 200]);
});
const K = (key, mods = {}) => keyToCommand({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
test('keymap: every row of the key table (D1)', () => {
  const rows = [
    [['ArrowLeft'], 'moveLeft'], [['ArrowRight'], 'moveRight'], [['ArrowUp'], 'moveUp'], [['ArrowDown'], 'moveDown'],
    [['ArrowLeft', { ctrlKey: true }], 'prevMeasure'], [['ArrowRight', { ctrlKey: true }], 'nextMeasure'],
    [['ArrowRight', { metaKey: true }], 'nextMeasure'],
    [['Home'], 'measureStart'], [['End'], 'measureEnd'], [['Home', { ctrlKey: true }], 'scoreStart'], [['End', { ctrlKey: true }], 'scoreEnd'],
    [['PageUp'], 'prevTrack'], [['PageDown'], 'nextTrack'],
    [['+'], 'shorter'], [['+', { shiftKey: true }], 'shorter'], [['='], 'shorter'], [['+', { code: 'NumpadAdd' }], 'shorter'],
    [['-'], 'longer'], [['-', { code: 'NumpadSubtract' }], 'longer'],
    [['.'], 'cycleDots'], [['.', { code: 'NumpadDecimal' }], 'cycleDots'], [[',', { code: 'NumpadDecimal' }], 'cycleDots'],
    [['/'], 'toggleTriplet'], [['/', { code: 'NumpadDivide' }], 'toggleTriplet'],
    [['r'], 'toggleRest'], [['R'], 'toggleRest'], [['l'], 'toggleTie'], [['L'], 'toggleTie'],
    [['Delete'], 'deleteNote'], [['Backspace'], 'deleteNote'],
    [['Delete', { ctrlKey: true }], 'deleteBeat'], [['Backspace', { metaKey: true }], 'deleteBeat'],
    [['Insert'], 'insertBeat'], [['i'], 'insertBeat'], [['I'], 'insertBeat'],
    [['m'], 'insertMeasureAfter'], [['M', { shiftKey: true }], 'insertMeasureBefore'],
    [['Delete', { shiftKey: true }], 'deleteMeasure'], [['Backspace', { shiftKey: true }], 'deleteMeasure'],
    [['z', { ctrlKey: true }], 'undo'], [['Z', { ctrlKey: true, shiftKey: true }], 'redo'], [['y', { ctrlKey: true }], 'redo'], [['z', { metaKey: true }], 'undo'],
    [['Escape'], 'clearBuffer'],
  ];
  for (const [[key, mods], want] of rows) eq(K(key, mods)?.name, want, `${key} ${JSON.stringify(mods || {})}`);
  for (let d = 0; d <= 9; d++) eq(K(String(d)), { name: 'digit', arg: d });
  eq(K('7', { code: 'Numpad7' }), { name: 'digit', arg: 7 });
});
test('keymap: never consumes Tab, Alt, F-keys, IME, browser Ctrl combos, Shift+arrows, reserved Shift+R/L/I and 2.1 letters', () => {
  const none = [
    ['Tab'], ['Tab', { shiftKey: true }], ['ArrowLeft', { altKey: true }], ['ArrowRight', { altKey: true }], ['r', { altKey: true }],
    ['F1'], ['F5'], ['F12'], ['a', { isComposing: true }], ['Process'], ['Dead'],
    ...['w', 't', 'n', 'l', 'p', 's', 'i', 'm', 'r', 'a', 'c', 'v', 'x', 'f'].map((k) => [k, { ctrlKey: true }]),
    ...['1', '5', '9'].map((k) => [k, { ctrlKey: true }]),
    ['PageUp', { ctrlKey: true }], ['PageDown', { ctrlKey: true }], ['ArrowUp', { ctrlKey: true }], ['ArrowLeft', { ctrlKey: true, shiftKey: true }],
    ['ArrowLeft', { shiftKey: true }], ['ArrowRight', { shiftKey: true }], ['ArrowUp', { shiftKey: true }], ['ArrowDown', { shiftKey: true }],
    ['Home', { shiftKey: true }], ['End', { shiftKey: true }],
    ['R', { shiftKey: true }], ['L', { shiftKey: true }], ['I', { shiftKey: true }],
    ['h'], ['s'], ['b'], ['v'], ['p'], ['x'], ['g'], ['H'], ['a'], [' '], ['Enter'], [''], [undefined],
  ];
  for (const [key, mods] of none) eq(K(key, mods), null, `${key} ${JSON.stringify(mods || {})}`);
  eq(keyToCommand(null), null);
});

// ---------- B10 property test: sanitize identity and valid cursor after every command; undo / redo all ----------
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');
const { leadSoloF } = await imp('examples/lead-solo-f.js');
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WEIGHTED = [
  ...Array(10).fill('digit'), ...Array(4).fill('moveRight'), ...Array(3).fill('moveLeft'), 'moveUp', 'moveDown', 'moveUp', 'moveDown',
  'prevMeasure', 'nextMeasure', 'measureStart', 'measureEnd', 'scoreStart', 'scoreEnd', 'prevTrack', 'nextTrack',
  'deleteNote', 'deleteNote', 'toggleTie', 'toggleTie', 'shorter', 'longer', 'setDuration', 'cycleDots', 'toggleTriplet', 'toggleRest', 'toggleRest',
  'deleteBeat', 'insertBeat', 'insertMeasureAfter', 'insertMeasureBefore', 'deleteMeasure', 'jump',
];
export const B10_SCORES = () => [
  ['default', defaultScore()],
  ['lead-riff', io.parseInput(leadRiff)],
  ['lead-solo-f', io.parseInput(leadSoloF)],
  ['example-score', io.parseInput(exampleScore)],
  ['rich', io.parseInput(sc(
    tab([{ beats: [nt('quarter'), graceB(), tn('quarter', 2, 2, { tieStart: true }), rest('quarter', { hidden: true }), nt('quarter')] },
      { voices: [{ beats: [graceB(), tn('half', 2, 2, { tieEnd: true }), nt('half')] }, { beats: [nt('whole', 4, 0)] }] },
      { beats: [{ type: 'note', duration: 'whole', slash: true }] }, null]),
    { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [] }] },
  ))],
  ['mixed', io.parseInput({ timeSignature: { beats: 3, beatType: 4 }, tracks: [
    { name: 'Notes', measures: [{ beats: [{ type: 'note', duration: 'half', notes: [{ pitch: 'C4' }, { pitch: 'E4' }] }] }] },
    tab([{ beats: [] }], { tuning: ['E1', 'A1', 'D2', 'G2'], showStandardNotation: false }),
  ] })],
];
test('B10: 6 start scores x 2000 random commands keep sanitizeScore(model) === model and a valid cursor; undo all restores the start, redo all the end', () => {
  const rnd = mulberry32(20261122);
  for (const [name, start] of B10_SCORES()) {
    let s = start;
    let c = C.clampCursor(s, cur(0, 0, 0, 1));
    let st = { duration: 'quarter', dots: 0, digit: null };
    const h = createHistory(10000);
    let digitEntry = null;
    let now = 0;
    let edits = 0;
    for (let i = 0; i < 2000; i++) {
      const pick = WEIGHTED[Math.floor(rnd() * WEIGHTED.length)];
      now += rnd() < 0.6 ? 200 : 1500;
      const ctx = { maxFret: 24, now, twoDigitDelayMs: 800, allowAppend: true };
      if (pick === 'jump') {
        c = C.clampCursor(s, cur(Math.floor(rnd() * 4), Math.floor(rnd() * 30), Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 7)));
        st = C.syncDuration(s, c, { ...st, digit: null });
        continue;
      }
      const arg = pick === 'digit' ? Math.floor(rnd() * 10) : pick === 'setDuration' ? ['whole', 'half', 'quarter', '8th', '16th', '32nd', '64th', 'bogus'][Math.floor(rnd() * 8)] : undefined;
      const r = run(pick, s, c, st, ctx, arg);
      if (r.changed) {
        edits++;
        const after = { score: r.score, cursor: r.cursor };
        if (r.coalesce && digitEntry && h.top() === digitEntry) h.coalesce(after);
        else { const entry = { before: { score: s, cursor: c }, after, label: pick }; h.push(entry); digitEntry = pick === 'digit' ? entry : null; }
      } else if (pick !== 'digit') digitEntry = null;
      s = r.score; c = r.cursor; st = r.state;
      if (sanitizeScore(s) !== s) throw new Error(`${name} step ${i} (${pick}): sanitize changed the model`);
      if (!C.sameCursor(C.clampCursor(s, c), c)) throw new Error(`${name} step ${i} (${pick}): invalid cursor ${JSON.stringify(c)}`);
    }
    ok(edits > 300, `${name}: only ${edits} edits`);
    const end = s;
    let e;
    let steps = 0;
    while ((e = h.undo())) { s = e.before.score; steps++; }
    ok(s === start, `${name}: undo all returns the start object`);
    for (let k = 0; k < steps; k++) s = h.redo().after.score;
    ok(s === end, `${name}: redo all returns the end object`);
  }
});

// ---------- announce (ui.md §7) ----------
const AN = await imp('src/editor/announce.js');
const infoOf = (s, c, st = ST) => C.cursorInfo(s, c, st);
test('announce: duration words with dots and triplet', () => {
  eq([AN.durationWords('8th'), AN.durationWords('quarter', 1), AN.durationWords('half', 2), AN.durationWords('16th', 0, true)],
    ['eighth', 'dotted quarter', 'double-dotted half', '16th, triplet']);
});
test('announce: moves speak track and measure only when they change, string alone for Up/Down, fill when entering a non-full measure', () => {
  const s = sc(tab([{ beats: [tn('quarter', 1, 5, { tieEnd: true }), rest('8th'), nt('half', 2, 7, { tuplet: 3 })] }, { beats: [] }]), { name: 'Piano', measures: [{ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }, { pitch: 'E4' }] }] }] });
  const a = infoOf(s, cur(0, 0, 0, 1));
  eq(AN.describeCursor(a, null), 'Track 1 Gtr, measure 1, beat 1, string 1, fret 5, quarter, tied, underfull');
  const b = infoOf(s, cur(0, 0, 1, 1));
  eq(AN.describeCursor(b, a), 'Beat 2, rest, eighth');
  const c = infoOf(s, cur(0, 0, 2, 3));
  eq(AN.describeCursor(c, b), 'Beat 3, string 3, empty, half, triplet');
  eq(AN.describeCursor(infoOf(s, cur(0, 0, 2, 2)), c), 'String 2, fret 7');
  eq(AN.describeCursor(infoOf(s, cur(0, 0, 3, 2)), c), 'End of measure, quarter');
  eq(AN.describeCursor(infoOf(s, cur(0, 1, 0, 2)), c), 'Measure 2, empty measure');
  eq(AN.describeCursor(infoOf(s, cur(1, 0, 0, 1)), c), 'Track 2 Piano, measure 1, beat 1, chord of 2, whole');
  eq(AN.describeCursor(a, a, true), AN.describeCursor(a, null), 'full on focus');
});
test('announce: edit messages, fill suffix after an edit, beat deleted followed by the position, undo labels', () => {
  eq(AN.describe({ id: 'fret', fret: 12 }), 'Fret 12');
  eq(AN.describe({ id: 'chordNote', fret: 7, count: 3 }), 'Fret 7 added, chord of 3');
  eq(AN.describe({ id: 'duration', duration: '8th', dots: 0 }), 'Eighth');
  eq(AN.describe({ id: 'nextDuration', duration: '8th', dots: 0 }), 'Next: eighth');
  eq([0, 1, 2].map((dots) => AN.describe({ id: 'dots', duration: 'quarter', dots })), ['Quarter, no dot', 'Dotted quarter', 'Double-dotted quarter']);
  eq(AN.describe({ id: 'restInserted', duration: 'quarter', dots: 0 }), 'Rest inserted, quarter');
  eq([AN.describe({ id: 'measureInserted', n: 4 }), AN.describe({ id: 'measureDeleted', n: 3 }), AN.describe({ id: 'measureAdded', n: 5 })], ['Measure 4 inserted', 'Measure 3 deleted', 'Measure 5 added']);
  eq([AN.describe({ id: 'undo', label: 'fret 5' }), AN.describe({ id: 'nothingToRedo' }), AN.describe({ id: 'refusedNoTab' }), AN.describe({ id: 'readOnly' }), AN.describe({ id: 'nothingToTie' })],
    ['Undo: fret 5', 'Nothing to redo', 'Fret entry needs a TAB staff', 'Read-only', 'Nothing to tie to']);
  eq(AN.describe({ id: 'bogus' }), '');
  const s0 = sc(tab([{ beats: [nt('half'), nt('quarter')] }]));
  const s1 = sc(tab([{ beats: [nt('half'), nt('quarter'), nt('quarter')] }]));
  eq(AN.describeEdit({ id: 'fret', fret: 3 }, infoOf(s1, cur(0, 0, 2)), infoOf(s0, cur(0, 0, 2))), 'Fret 3, measure full');
  eq(AN.describeEdit({ id: 'fret', fret: 3 }, infoOf(s1, cur(0, 0, 2)), infoOf(s1, cur(0, 0, 2))), 'Fret 3');
  eq(AN.describeEdit({ id: 'beatDeleted' }, infoOf(s0, cur(0, 0, 1)), infoOf(s0, cur(0, 0, 1))), 'Beat deleted. Beat 2, string 1, fret 0, quarter');
  eq([AN.undoLabel('digit', { fret: 5 }), AN.undoLabel('toggleRest', { id: 'changedToRest' }), AN.undoLabel('toggleRest', { id: 'changedToNote' }), AN.undoLabel('insertMeasureBefore'), AN.undoLabel('longer'), AN.undoLabel('insertBeat')],
    ['fret 5', 'rest', 'note', 'insert measure', 'duration', 'insert rest']);
});

// ---------- style and geometry (ui.md §3–§5) ----------
const { EDITOR_STYLE, resolveStyle } = await imp('src/editor/style.js');
const G = await imp('src/editor/geometry.js');
const { resolveTheme } = await imp('src/theme.js');
const theme = resolveTheme();
test('style: ui.md defaults; colour options override only with non-empty strings', () => {
  eq([EDITOR_STYLE.cursorColor, EDITOR_STYLE.overfullColor, EDITOR_STYLE.underfullColor], ['#3b5bdb', '#d92d20', '#62636a']);
  eq([EDITOR_STYLE.focused.colFill, EDITOR_STYLE.unfocused.colStroke, EDITOR_STYLE.focused.stringFill, EDITOR_STYLE.unfocused.stringFill, EDITOR_STYLE.unfocused.slotStroke], [0.1, 0.35, 0.22, 0.08, 0.35]);
  const st = resolveStyle({ cursorColor: 'red', overfullColor: '', underfullColor: 5 });
  eq([st.cursorColor, st.overfullColor, st.underfullColor], ['red', '#d92d20', '#62636a']);
  ok(Object.isFrozen(EDITOR_STYLE) && Object.isFrozen(st));
});
// A synthetic hit map: one system, track 0 notation (y 100) + TAB (y 170, 6 strings), track 1 TAB only (y 300, 4 strings).
const MAP = {
  width: 800, height: 400,
  staves: [
    { sysIdx: 0, ti: 0, kind: 'notation', y: 100, lineBottom: 40, x1: 50, x2: 750 },
    { sysIdx: 0, ti: 0, kind: 'tab', y: 170, lineBottom: 75, x1: 50, x2: 750, stringSpacing: 15, stringCount: 6 },
    { sysIdx: 0, ti: 1, kind: 'tab', y: 300, lineBottom: 45, x1: 50, x2: 750, stringSpacing: 15, stringCount: 4 },
  ],
  measures: [
    { sysIdx: 0, ti: 0, measureIndex: 0, x: 100, contentX: 110, endX: 300 },
    { sysIdx: 0, ti: 0, measureIndex: 1, x: 300, contentX: 300, endX: 500 },
    { sysIdx: 0, ti: 1, measureIndex: 0, x: 100, contentX: 110, endX: 300 },
    { sysIdx: 0, ti: 1, measureIndex: 1, x: 300, contentX: 300, endX: 500 },
  ],
  elements: [
    { sysIdx: 0, ti: 0, measureIndex: 0, voice: 1, beatIndex: 0, x: 120, width: 60, isGrace: false, isRest: false },
    { sysIdx: 0, ti: 0, measureIndex: 0, voice: 1, beatIndex: 1, x: 175, width: 8, isGrace: true, isRest: false },
    { sysIdx: 0, ti: 0, measureIndex: 0, voice: 1, beatIndex: 2, x: 200, width: 60, isGrace: false, isRest: false },
    { sysIdx: 0, ti: 0, measureIndex: 0, voice: 2, beatIndex: 0, x: 120, width: 60, isGrace: false, isRest: false },
    { sysIdx: 0, ti: 1, measureIndex: 0, voice: 1, beatIndex: 0, x: 120, width: 180, isGrace: false, isRest: false },
  ],
};
const IDX = G.indexHitMap(MAP);
const ci = (extra) => ({ track: 0, measure: 0, beat: 0, string: 2, appendSlot: false, empty: false, frets: [], fret: null, ...extra });
test('geometry: indexHitMap keys measures, voice-1 elements and staves', () => {
  eq(IDX.measures.get('0:1').x, 300);
  eq(IDX.elements.get('0:0').map((e) => e.beatIndex), [0, 1, 2]);
  eq(IDX.staves.get('0:0').map((s) => s.kind), ['notation', 'tab']);
  const runs = G.indexHitMap({ ...MAP, measures: [{ sysIdx: 0, ti: 0, measureIndex: 0, x: 0, contentX: 0, endX: 9, lastMeasureIndex: 3 }] });
  ok(runs.measures.get('0:3') === runs.measures.get('0:0'));
  eq(G.indexHitMap(null).measures.size, 0);
});
test('geometry: cursor column on notation and TAB centred on the element, width max(ink + 0.8sp, 1.8sp), y spans, string box (G1)', () => {
  const sh = G.cursorShapes(IDX, ci({ beat: 2, string: 3, fret: 12, frets: [12, 3] }), EDITOR_STYLE, theme, true);
  eq(sh.map((x) => x.attrs.class), ['editor-col editor-col-notation', 'editor-col editor-col-tab', 'editor-string']);
  const ink = 2 * 0.5 * 12 + 3; // '12' at 12px + 0.3 sp knock-out
  const w = Math.max(ink + 8, 18);
  eq([sh[0].attrs.x, sh[0].attrs.width, sh[0].attrs.y, sh[0].attrs.height], [200 - w / 2, w, 100 - 15, 40 + 30]);
  eq([sh[1].attrs.x, sh[1].attrs.y, sh[1].attrs.height], [200 - w / 2, 170 - 7.5, 75 + 15]);
  eq([sh[2].attrs.y, sh[2].attrs.height, sh[2].attrs.width], [170 + 2 * 15 - 7.5, 15, Math.min(Math.max(ink + 4, 16), w)]);
  eq([sh[1].attrs['fill-opacity'], sh[1].attrs['stroke-opacity'], sh[2].attrs['fill-opacity'], sh[1].attrs.fill, sh[1].attrs.rx, sh[1].attrs['stroke-width']], [0.1, 1, 0.22, '#3b5bdb', 2, 1.5]);
  const dim = G.cursorShapes(IDX, ci({ beat: 2 }), EDITOR_STYLE, theme, false);
  eq([dim[1].attrs['stroke-opacity'], dim[1].attrs['fill-opacity'], dim[2].attrs['stroke-opacity'], dim[2].attrs['fill-opacity'], dim[2].attrs.width], [0.35, 0.04, 0.5, 0.08, 16]);
});
test('geometry: column clamped inside the measure; TAB-only track has column + string box; unknown beat draws nothing', () => {
  const sh = G.cursorShapes(IDX, ci({ beat: 0, frets: [] }), EDITOR_STYLE, theme, true);
  eq([sh[0].attrs.x, sh[0].attrs.width], [111, 18]);
  const near = G.indexHitMap({ ...MAP, elements: [{ ...MAP.elements[0], x: 104 }] });
  const cl = G.cursorShapes(near, ci({ beat: 0 }), EDITOR_STYLE, theme, true);
  eq([cl[0].attrs.x, cl[0].attrs.width], [102, 104 + 9 - 102], 'clamped to measure.x + 0.2 sp');
  const t1 = G.cursorShapes(IDX, ci({ track: 1, string: 4 }), EDITOR_STYLE, theme, true);
  eq(t1.map((x) => x.attrs.class), ['editor-col editor-col-tab', 'editor-string']);
  eq(t1[1].attrs.y, 300 + 3 * 15 - 7.5);
  eq(G.cursorShapes(IDX, ci({ beat: 7 }), EDITOR_STYLE, theme, true), []);
  eq(G.cursorShapes(IDX, ci({ measure: 9 }), EDITOR_STYLE, theme, true), []);
});
test('geometry: append slot dashed between the last element and endX; empty measure slot from contentX (ui.md §3)', () => {
  const sh = G.cursorShapes(IDX, ci({ beat: 3, appendSlot: true }), EDITOR_STYLE, theme, true);
  eq(sh.map((x) => x.attrs.class), ['editor-slot', 'editor-slot', 'editor-string']);
  eq([sh[1].attrs.x, sh[1].attrs.width, sh[1].attrs.fill, sh[1].attrs['stroke-dasharray']], [250 - 8, 16, 'none', '4 2.5']);
  eq([sh[2].attrs.fill, sh[2].attrs['stroke-dasharray']], ['none', '4 2.5']);
  const e = G.cursorShapes(IDX, ci({ measure: 1, beat: 0, appendSlot: true, empty: true }), EDITOR_STYLE, theme, false);
  eq([e[0].attrs.x, e[0].attrs.width, e[0].attrs['stroke-opacity']], [300, 16, 0.35]);
});
test('geometry: fill bands over the track staves; overfull tint + bar, underfull dashed line, empty and full none (G4)', () => {
  const sh = G.fillShapes(IDX, [['over', 'empty'], ['under', 'full']], EDITOR_STYLE, theme);
  eq(sh.map((x) => x.attrs.class), ['editor-band-over', 'editor-band-over', 'editor-band-under']);
  eq([sh[0].attrs.x, sh[0].attrs.width, sh[0].attrs.y, sh[0].attrs.height, sh[0].attrs['fill-opacity']], [100, 200, 90, 170 + 75 + 10 - 90, 0.1]);
  eq([sh[1].attrs.y, sh[1].attrs.height, sh[1].attrs.opacity, sh[1].attrs.fill], [100 - 12.5, 2.5, 0.85, '#d92d20']);
  eq([sh[2].tag, sh[2].attrs.y1, sh[2].attrs.x1, sh[2].attrs.x2, sh[2].attrs['stroke-opacity'], sh[2].attrs['stroke-width'], sh[2].attrs.stroke], ['line', 300 - 12.5 + 1.25, 100, 300, 0.7, 1, '#62636a']);
});

// ---------- demo helpers (examples/editor-demo.js, H4–H5) ----------
const demo = await imp('examples/editor-demo.js');
test('demo: sanitizeFilename keeps [A-Za-z0-9-_ ], trims, adds .json, falls back to score.json', () => {
  eq([demo.sanitizeFilename('Lead Riff in A Minor'), demo.sanitizeFilename('  a/b\\c:<x>?_1-2  '), demo.sanitizeFilename('ÅÄÖ…'), demo.sanitizeFilename(''), demo.sanitizeFilename(undefined), demo.sanitizeFilename('../../etc/passwd')],
    ['Lead Riff in A Minor.json', 'abcx_1-2.json', 'score.json', 'score.json', 'score.json', 'etcpasswd.json']);
});
test('demo: newScore presets (guitar, bass clef, 7-string), time signature on the track, TAB-only, clamped inputs; sanitize-stable', () => {
  const g = demo.newScore({ title: ' My song ', beats: 3, beatType: 8 });
  eq(g, { title: 'My song', tracks: [{ name: 'Guitar', clef: 'treble', showStandardNotation: true, showTablature: true, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], timeSignature: { beats: 3, beatType: 8 }, measures: [{ beats: [] }] }] });
  const b = demo.newScore({ preset: 'bass4', tabOnly: true });
  eq([b.tracks[0].name, b.tracks[0].clef, b.tracks[0].tuning, b.tracks[0].showStandardNotation, b.title], ['Bass', 'bass', ['E1', 'A1', 'D2', 'G2'], false, 'Untitled']);
  const n = normalizeScore({ tracks: [{ ...b.tracks[0], showStandardNotation: true, measures: [{ beats: [nt('quarter', 4, 0)] }] }] }).tracks[0];
  eq([n.clef, n.octaveClef], ['bass', true], 'bass clef with the 8vb (octave) clef from fret-derived pitches');
  eq(demo.newScore({ preset: 'guitar7' }).tracks[0].tuning.length, 7);
  eq(demo.newScore({ beats: 40, beatType: 5, preset: 'nope' }).tracks[0].timeSignature, { beats: 16, beatType: 4 });
  eq(demo.newScore({ beats: 0 }).tracks[0].timeSignature.beats, 1);
  [g, b].forEach((x) => ok(sanitizeScore(x) === x));
});
test('demo: readAutosave reports ok / none / corrupt / unavailable', () => {
  const store = (v) => ({ getItem: (k) => (k === demo.AUTOSAVE_KEY ? v : null) });
  eq(demo.readAutosave(store('{"tracks":[]}')), { status: 'ok', score: { tracks: [] } });
  eq(demo.readAutosave(store(null)), { status: 'none' });
  eq(demo.readAutosave(store('{bad')), { status: 'corrupt' });
  eq(demo.readAutosave(store('[1]')), { status: 'corrupt' });
  eq(demo.readAutosave(store('null')), { status: 'corrupt' });
  eq(demo.readAutosave({ getItem: () => { throw new Error('blocked'); } }), { status: 'unavailable' });
  eq(demo.AUTOSAVE_KEY, 'music-score-editor:autosave');
});
test('demo: restoring guard — a flagged session skips the restore (reported corrupt) until cleared; storage errors are swallowed', () => {
  const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const local = mem(); local.setItem(demo.AUTOSAVE_KEY, '{"tracks":[]}');
  const session = mem();
  eq(demo.readAutosave(local, session).status, 'ok');
  demo.markRestoring(session);
  eq([demo.isRestoring(session), session.getItem(demo.RESTORING_KEY)], [true, '1']);
  eq(demo.readAutosave(local, session), { status: 'corrupt', unfinished: true });
  eq(demo.readAutosave(mem(), session), { status: 'none' }, 'no autosave: nothing to skip');
  demo.clearRestoring(session);
  eq([demo.isRestoring(session), demo.readAutosave(local, session).status], [false, 'ok']);
  const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
  demo.markRestoring(broken); demo.clearRestoring(broken); demo.markRestoring(null);
  eq([demo.isRestoring(broken), demo.isRestoring(null), demo.readAutosave(local, broken).status], [false, false, 'ok']);
  eq(demo.RESTORING_KEY, 'music-score-editor:restoring');
});
test('demo: checkUpload rejects files over 5 MB before reading', () => {
  eq(demo.checkUpload({ name: 'a.json', size: 5 * 1024 * 1024 }), { ok: true });
  eq(demo.checkUpload({ name: 'big.json', size: 5 * 1024 * 1024 + 1 }), { ok: false, error: 'Couldn\'t open "big.json": the file is larger than 5 MB.' });
  eq(demo.checkUpload(null).ok, false);
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
