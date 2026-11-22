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
