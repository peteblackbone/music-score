// 2.2.0 editor settings, model level: validators, INSTRUMENTS / TUNINGS, score, tempo, tuning, track
// and measure operations, getMeasureSettings, cursorInfo additions, B10 / E12 / F1 extensions.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-settings.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { sanitizeScore } = await imp('src/sanitize.js');
const { EDITOR_LIMITS } = await imp('src/editor/model/limits.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };

// ---------- LIMITS ----------
test('LIMITS: 2.2 caps (textChars, longTextChars, timeSignatureBeats, frozen beatTypes) inside the limits sanitize keeps', () => {
  const L = EDITOR_LIMITS;
  eq([L.textChars, L.longTextChars, L.timeSignatureBeats, L.beatTypes], [200, 2000, 32, [1, 2, 4, 8, 16, 32]]);
  ok(Object.isFrozen(L) && Object.isFrozen(L.beatTypes));
  for (const beatType of L.beatTypes) {
    const s = { tracks: [{ timeSignature: { beats: L.timeSignatureBeats, beatType }, measures: [] }] };
    ok(sanitizeScore(s) === s, `${L.timeSignatureBeats}/${beatType} is kept by sanitize`);
  }
});

// ---------- validators ----------
const V = await imp('src/editor/model/settings/validate.js');
const throws = (fn, Type, msg) => {
  try { fn(); } catch (e) {
    if (Type && !(e instanceof Type)) throw new Error(`threw ${e.constructor.name} "${e.message}", wanted ${Type.name}`);
    if (msg && !String(e.message).includes(msg)) throw new Error(`threw "${e.message}", wanted "${msg}"`);
    return;
  }
  throw new Error(`did not throw${msg ? ` "${msg}"` : ''}`);
};
test('validate: plain, checkKeys (own keys only: __proto__, constructor rejected), index, intIn, text, flag, bool, same, withField', () => {
  eq([{}, Object.create(null), JSON.parse('{"a":1}'), [], null, new Date(), 'x'].map(V.plain), [true, true, true, false, false, false, false]);
  throws(() => V.object([], 'Patch'), TypeError, 'Patch must be an object');
  V.checkKeys({ a: 1 }, ['a', 'b'], 'score');
  throws(() => V.checkKeys({ c: 1 }, ['a'], 'score'), TypeError, 'Unknown score field: c');
  throws(() => V.checkKeys(JSON.parse('{"__proto__":{"x":1}}'), ['a'], 'score'), TypeError, 'Unknown score field: __proto__');
  throws(() => V.checkKeys({ constructor: 1 }, ['a'], 'track'), TypeError, 'constructor');
  throws(() => V.checkKeys({ toString: 1 }, ['a'], 'track'), TypeError, 'toString');
  eq(V.index(2, 3, 'Track'), 2);
  throws(() => V.index(3, 3, 'Track'), RangeError, 'Track must be a whole number from 0 to 2');
  throws(() => V.index(1.5, 3, 'Track'), RangeError);
  throws(() => V.index('1', 3, 'Track'), TypeError);
  throws(() => V.intIn(NaN, 1, 2, 'X'), RangeError);
  eq([V.text('  a  ', { label: 'T' }), V.text('   ', { label: 'T' }), V.text(null, { label: 'T' }), V.text('a\nb', { label: 'T', multiline: true })], ['a', undefined, undefined, 'a\nb']);
  throws(() => V.text('a\nb', { label: 'Title' }), RangeError, 'Title must be a single line');
  throws(() => V.text('a\u2028b', { label: 'Title' }), RangeError);
  throws(() => V.text(5, { label: 'Title' }), TypeError, 'Title must be a string');
  eq(V.text(`  ${'x'.repeat(200)}  `, { label: 'T' }).length, 200, 'counted after trimming');
  throws(() => V.text('x'.repeat(201), { label: 'T' }), RangeError, 'at most 200 characters');
  eq(V.text('x'.repeat(2000), { label: 'T', multiline: true }).length, 2000);
  throws(() => V.text('x'.repeat(2001), { label: 'T', multiline: true }), RangeError, 'at most 2000');
  eq(V.text('😀'.repeat(100), { label: 'T' }).length, 200, 'UTF-16 code units');
  throws(() => V.text('😀'.repeat(101), { label: 'T' }), RangeError);
  eq([V.flag(true, 'F'), V.flag(false, 'F'), V.flag(null, 'F')], [true, undefined, undefined]);
  throws(() => V.flag(1, 'F'), TypeError);
  throws(() => V.flag(undefined, 'F'), TypeError);
  throws(() => V.bool(null, 'B'), TypeError);
  const o = { a: { x: 1 }, b: 2 };
  ok(V.withField(o, 'a', { x: 1 }) === o && V.withField(o, 'c', undefined) === o, 'equal / absent: same object');
  eq([V.withField(o, 'b', undefined), V.withField(o, 'b', 3), o], [{ a: { x: 1 } }, { a: { x: 1 }, b: 3 }, { a: { x: 1 }, b: 2 }]);
  ok(V.same([1, 2], [1, 2]) && !V.same(undefined, null) && !V.same(1, '1'));
});

// ---------- INSTRUMENTS and TUNINGS ----------
const { INSTRUMENTS, TUNINGS } = await imp('src/editor/model/settings/instruments.js');
const { REFERENCE_TUNINGS } = await imp('src/scoreText.js');
const { isValidPitch } = await imp('src/sanitize.js');
const deepFrozen = (o) => Object.isFrozen(o) && Object.values(o).every((v) => !v || typeof v !== 'object' || deepFrozen(v));
test('INSTRUMENTS / TUNINGS: deep-frozen, in picker order, canonical pitches, Standard first and equal to scoreText REFERENCE_TUNINGS', () => {
  ok(deepFrozen(INSTRUMENTS) && deepFrozen(TUNINGS));
  eq(Object.keys(INSTRUMENTS), ['guitar6', 'guitar7', 'guitar8', 'bass4', 'bass5', 'bass6', 'ukulele']);
  eq(Object.keys(TUNINGS), Object.keys(INSTRUMENTS));
  eq(Object.values(INSTRUMENTS).map((i) => [i.name, i.label, i.clef]), [
    ['Guitar', '6-string guitar', 'treble'], ['7-string guitar', '7-string guitar', 'treble'], ['8-string guitar', '8-string guitar', 'treble'],
    ['Bass', '4-string bass', 'bass'], ['5-string bass', '5-string bass', 'bass'], ['6-string bass', '6-string bass', 'bass'], ['Ukulele', 'Ukulele', 'treble']]);
  for (const [id, i] of Object.entries(INSTRUMENTS)) {
    eq(i.staves, { showStandardNotation: true, showTablature: true }, id);
    eq(TUNINGS[id][0].name, 'Standard', id);
    eq(TUNINGS[id][0].tuning, i.tuning, `${id}: the instrument tuning is its Standard preset`);
    for (const pr of TUNINGS[id]) {
      eq(pr.tuning.length, i.tuning.length, `${id} ${pr.name}: string count`);
      ok(pr.tuning.every((x) => /^[A-G][#b]?\d$/.test(x) && isValidPitch(x)), `${id} ${pr.name}: canonical`);
    }
  }
  const ref = { guitar6: 6, guitar7: 7, guitar8: 8, bass4: 4, bass5: 5, bass6: 'bass6' };
  for (const [id, k] of Object.entries(ref)) eq(INSTRUMENTS[id].tuning, REFERENCE_TUNINGS[k], id);
  eq(TUNINGS.guitar6.map((x) => x.name), ['Standard', 'Drop D', 'Half-step down', 'Whole-step down', 'Drop C', 'DADGAD', 'Open G', 'Open D', 'Open E']);
  eq([TUNINGS.guitar7, TUNINGS.guitar8, TUNINGS.bass4, TUNINGS.bass5, TUNINGS.bass6, TUNINGS.ukulele].map((l) => l.map((x) => x.name)),
    [['Standard', 'Drop A'], ['Standard'], ['Standard', 'Drop D'], ['Standard'], ['Standard'], ['Standard']]);
  eq(TUNINGS.guitar6[7].tuning.join(' '), 'D2 A2 D3 F#3 A3 D4');
  eq(TUNINGS.ukulele[0].tuning.join(' '), 'G4 C4 E4 A4');
});

// ---------- shared fixtures ----------
const io = await imp('src/editor/model/io.js');
const { describe } = await imp('src/editor/announce.js');
const clone = (o) => JSON.parse(JSON.stringify(o));
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const graceB = (string = 2, fret = 3) => ({ type: 'grace', duration: '16th', notes: [{ string, fret }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const sc = (...tracks) => ({ tracks });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const model = (s) => io.parseInput(s);
/** Every throw leaves the model untouched (deep-equal and the same object graph). */
const throwsClean = (s, fn, Type, msg) => { const before = JSON.stringify(s); throws(fn, Type, msg); eq(JSON.stringify(s), before, 'model unchanged after a throw'); };
const say = (r) => describe(r.announce);

// ---------- updateScore ----------
const S = await imp('src/editor/model/settings/score.js');
test('updateScore: text trimmed, empty / null deletes, flags write true or delete, unknown keys and bad types throw before any change; no change returns the same score', () => {
  const s = model({ title: 'Old', subtitle: 'Sub', custom: { keep: 1 }, tracks: [tab([{ beats: [] }])] });
  const c = cur(0, 0, 0);
  const r = S.updateScore(s, c, { title: '  New  ', subtitle: '   ', artist: 'A', instructions: 'line 1\nline 2', showTuningChart: true });
  eq(r.score, { title: 'New', custom: { keep: 1 }, tracks: s.tracks, artist: 'A', instructions: 'line 1\nline 2', showTuningChart: true });
  ok(r.score.tracks === s.tracks && sanitizeScore(r.score) === r.score);
  eq(say(r), 'Score settings updated');
  eq(say(S.updateScore(s, c, { title: 'X' })), 'Title set');
  eq(say(S.updateScore(s, c, { subtitle: null })), 'Subtitle removed');
  eq(say(S.updateScore(s, c, { title: 'X', subtitle: 'Sub' })), 'Title set', 'one changed key: its own message');
  eq(say(S.updateScore(s, c, { showTuningChart: true })), 'Tuning chart on');
  eq(say(S.updateScore(r.score, c, { showTuningChart: false })), 'Tuning chart off');
  eq(say(S.updateScore(s, c, { multiMeasureRests: true })), 'Multi-measure rests on, shown when rendered, not in the editor');
  eq(say(S.updateScore(s, c, { multiMeasureRests: true, title: 'Y' })), 'Score settings updated, shown when rendered, not in the editor');
  eq(say(S.updateScore(s, c, { words: 'W' })), 'Words set');
  ok(!('showTuningChart' in S.updateScore(r.score, c, { showTuningChart: null }).score), 'null deletes a flag');
  ok(S.updateScore(s, c, { title: ' Old ', artist: null, showTuningChart: false }).score === s, 'equal values: same object');
  ok(S.updateScore(s, c, {}).score === s);
  throwsClean(s, () => S.updateScore(s, c, { title: 'ok', bogus: 1 }), TypeError, 'Unknown score field: bogus');
  throwsClean(s, () => S.updateScore(s, c, { title: 'ok', tracks: [] }), TypeError, 'tracks');
  throwsClean(s, () => S.updateScore(s, c, JSON.parse('{"__proto__":{"polluted":1}}')), TypeError, '__proto__');
  throwsClean(s, () => S.updateScore(s, c, { constructor: 'x' }), TypeError, 'constructor');
  throwsClean(s, () => S.updateScore(s, c, { title: 5 }), TypeError, 'Title must be a string');
  throwsClean(s, () => S.updateScore(s, c, { title: 'a\nb' }), RangeError, 'single line');
  throwsClean(s, () => S.updateScore(s, c, { copyright: 'x'.repeat(2001) }), RangeError, '2000');
  throwsClean(s, () => S.updateScore(s, c, { tuningLabel: 'x'.repeat(201) }), RangeError, '200');
  throwsClean(s, () => S.updateScore(s, c, { showTuningChart: 'yes' }), TypeError);
  throwsClean(s, () => S.updateScore(s, c, null), TypeError, 'must be an object');
  throwsClean(s, () => S.updateScore(s, c, [['title', 'x']]), TypeError);
  ok(({}).polluted === undefined);
});

// ---------- setTempo / tempoAt ----------
test('setTempo: number for a quarter beat without dots / text, else the object; null removes; bad values throw; refused on the slot; written on voice-1 notes and rests', () => {
  const s = model(sc(tab([{ beats: [nt('quarter'), rest('quarter', { custom: 1 }), nt('half')] }, { beats: [] }])));
  const c = cur(0, 0, 0);
  const r = S.setTempo(s, c, 120);
  eq(r.score.tracks[0].measures[0].beats[0].tempo, 120);
  eq(say(r), 'Tempo 120 at measure 1, beat 1');
  const r2 = S.setTempo(s, cur(0, 0, 1), { bpm: 80.5, unit: 'quarter', dots: 1, text: '  Allegro ' });
  eq(r2.score.tracks[0].measures[0].beats[1], { type: 'rest', duration: 'quarter', custom: 1, tempo: { bpm: 80.5, unit: 'quarter', dots: 1, text: 'Allegro' } });
  eq(say(r2), 'Tempo 80.5, dotted quarter at measure 1, beat 2');
  eq(S.setTempo(s, c, { bpm: 60, unit: 'half' }).score.tracks[0].measures[0].beats[0].tempo, { bpm: 60, unit: 'half' });
  eq(S.setTempo(s, c, { bpm: 60, unit: 'quarter', dots: 0, text: '  ' }).score.tracks[0].measures[0].beats[0].tempo, 60, 'shortest form');
  const removed = S.setTempo(r.score, c, null);
  ok(!('tempo' in removed.score.tracks[0].measures[0].beats[0]));
  eq(say(removed), 'Tempo removed');
  ok(S.setTempo(s, c, null).score === s && S.setTempo(r.score, c, 120).score === r.score, 'no change: same object');
  eq(S.setTempo(s, cur(0, 1, 0), 100), { refused: { id: 'noBeat' } });
  for (const bad of [0, -1, 1000.01, 1.234, NaN, Infinity, { bpm: 120, unit: 'eighth' }, { bpm: 120, dots: 3 }, { bpm: 120, dots: 1.5 }, { bpm: 120, text: 'a\nb' }]) {
    throwsClean(s, () => S.setTempo(s, c, bad), RangeError);
  }
  for (const bad of [undefined, '120', [120], { bpm: '120' }, { bpm: 120, unit: 4 }, { bpm: 120, dots: '1' }, { bpm: 120, extra: 1 }, { unit: 'half' }, true]) {
    throwsClean(s, () => S.setTempo(s, c, bad), TypeError);
  }
  throws(() => S.setTempo(s, cur(0, 1, 0), 'x'), TypeError, 'Tempo must be an object', 'a bad value throws even where it would be refused');
  for (const ok1 of [0.01, 1000, 92.55, 60.33]) eq(S.setTempo(s, c, ok1).score.tracks[0].measures[0].beats[0].tempo, ok1);
  ok(sanitizeScore(r2.score) === r2.score);
});
test('tempoAt: nearest tempo the renderer reads, backwards on voice 1 into earlier measures; here only on the cursor beat; the slot reads the last beat; null without one', () => {
  const s = model(sc(
    tab([{ beats: [nt('quarter', 1, 0, { tempo: 90 }), nt('quarter'), nt('half', 1, 0, { tempo: 'x' })] },
      { voices: [{ beats: [nt('half'), nt('quarter', 1, 0, { tempo: { bpm: 70, unit: 'half', text: 'Slow' } })] }, { beats: [nt('whole', 2, 0, { tempo: 200 })] }] },
      { beats: [] }]),
    tab([{ beats: [nt('whole')] }]),
  ));
  eq(S.tempoAt(s, cur(0, 0, 0)), { bpm: 90, unit: 'quarter', dots: 0, text: null, here: true });
  eq(S.tempoAt(s, cur(0, 0, 2)), { bpm: 90, unit: 'quarter', dots: 0, text: null, here: false }, 'an invalid tempo is skipped');
  eq(S.tempoAt(s, cur(0, 1, 0)).bpm, 90, 'voice 2 is not read');
  eq(S.tempoAt(s, cur(0, 1, 1)), { bpm: 70, unit: 'half', dots: 0, text: 'Slow', here: true });
  eq(S.tempoAt(s, cur(0, 1, 2)).here, false);
  eq(S.tempoAt(s, cur(0, 2, 0)).bpm, 70, 'empty measure: carried from earlier measures');
  eq(S.tempoAt(s, cur(1, 0, 0)), null, 'per track');
});

// ---------- keySignatureAt / cursorInfo additions ----------
const F = await imp('src/editor/model/fill.js');
const C = await imp('src/editor/model/cursor.js');
const { normalizeScore } = await imp('src/normalize.js');
test('keySignatureAt: track, else score, else 0, replaced by measure keys; equals normalizeScore per track and measure', () => {
  const s = model({ keySignature: -2, tracks: [
    tab([{ beats: [] }, { keySignature: 3, beats: [] }, { beats: [] }, { keySignature: 0, beats: [] }]),
    tab([{ beats: [] }, null, { keySignature: -7, beats: [] }], { keySignature: 1 }),
    tab([]),
  ] });
  const n = normalizeScore(s);
  for (let ti = 0; ti < 3; ti++) for (let mi = 0; mi < 4; mi++) eq(F.keySignatureAt(s, { track: ti, measure: mi }), n.tracks[ti].measures[mi].keySignature, `${ti}/${mi}`);
  eq(F.keySignatureAt(model(sc(tab([]))), { track: 0, measure: 0 }), 0);
});
test('cursorInfo: timeSignature (a fresh object), keySignature and tempo in force at the cursor', () => {
  const ts = { beats: 3, beatType: 4 };
  const s = model({ timeSignature: ts, keySignature: 2, tracks: [tab([{ beats: [nt('half', 1, 0, { tempo: 100 }), nt('quarter')] }, { timeSignature: { beats: 6, beatType: 8 }, keySignature: -1, beats: [] }])] });
  const st = { duration: 'quarter', dots: 0, digit: null };
  const a = C.cursorInfo(s, cur(0, 0, 1), st);
  eq([a.timeSignature, a.keySignature, a.tempo], [{ beats: 3, beatType: 4 }, 2, { bpm: 100, unit: 'quarter', dots: 0, text: null, here: false }]);
  ok(a.timeSignature !== s.timeSignature, 'a fresh object');
  a.timeSignature.beats = 99;
  eq(s.timeSignature, ts, 'mutating the info does not reach the model');
  const b = C.cursorInfo(s, cur(0, 1, 0), st);
  eq([b.timeSignature, b.keySignature, b.tempo.bpm, b.tempo.here], [{ beats: 6, beatType: 8 }, -1, 100, false]);
  eq(C.cursorInfo(model(sc(tab([{ beats: [] }]))), cur(0, 0, 0), st).tempo, null);
});

// ---------- tuning ----------
const T = await imp('src/editor/model/settings/tuning.js');
const tn = (duration, string, fret, flags = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }], ...extra });
test('canonicalTuning: 1-12 pitches, letter upper case, # or b, octave 0-9, trimmed; anything else throws', () => {
  eq(T.canonicalTuning([' e2 ', 'bb1', 'F#3', 'c0', 'G9']), ['E2', 'Bb1', 'F#3', 'C0', 'G9']);
  eq(T.canonicalTuning(Array(12).fill('E2')).length, 12);
  for (const bad of [[], Array(13).fill('E2'), ['H2'], ['E'], ['E10'], ['E-1'], ['Ex2'], ['E##2'], ['Ebb2'], ['E 2'], ['']]) throws(() => T.canonicalTuning(bad), RangeError, '', JSON.stringify(bad));
  for (const bad of ['E2 A2', null, { 0: 'E2' }, [2], [null]]) throws(() => T.canonicalTuning(bad), TypeError);
});
test('retuneTrack: frets kept; pitch dropped only on changed strings (fret + pitch); pitch-only notes kept; same tuning (absent standard too) unchanged', () => {
  const track = { name: 'G', showTablature: true, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], measures: [
    { beats: [{ type: 'note', duration: 'quarter', notes: [{ string: 6, fret: 0, pitch: 'E2' }, { string: 5, fret: 2, pitch: 'B2' }, { pitch: 'C4' }, { string: 6, pitch: 'F2' }] }] },
    { beats: [] },
  ] };
  const r = T.retuneTrack(track, ['D2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  eq(r.track.measures[0].beats[0].notes, [{ string: 6, fret: 0 }, { string: 5, fret: 2, pitch: 'B2' }, { pitch: 'C4' }, { string: 6, pitch: 'F2' }]);
  eq([r.removed, r.track.tuning, [...r.droppedV1]], [0, ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'], []]);
  ok(r.track.measures[1] === track.measures[1] && track.measures[0].beats[0].notes[0].pitch === 'E2', 'copy-on-write');
  ok(T.retuneTrack(track, [...track.tuning]).track === track);
  const bare = { name: 'G', measures: [] };
  ok(T.retuneTrack(bare, ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']).track === bare, 'absent default tuning stays absent');
  eq(T.retuneTrack(bare, ['D2', 'A2', 'D3', 'G3', 'B3', 'E4']).track.tuning[0], 'D2');
  const seven = T.retuneTrack(track, ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  eq([seven.removed, seven.track.measures[0].beats[0].notes[0]], [0, { string: 6, fret: 0, pitch: 'E2' }], 'adding a low string changes nothing above it');
});
test('retuneTrack: removed strings across beats, every voice and graces; emptied beats become rests (slash beats kept), emptied graces dropped (droppedV1), ties stripped, counts; sanitize-stable', () => {
  const s = model(sc(tab([
    { beats: [tn('quarter', 7, 0, { tieStart: true }), graceB(7, 2), tn('quarter', 7, 0, { tieEnd: true }, { custom: 1 }), { type: 'note', duration: 'half', notes: [{ string: 7, fret: 3 }, { string: 1, fret: 0 }] }] },
    { voices: [
      { beats: [graceB(7, 1), graceB(1, 1), { type: 'note', duration: 'half', slash: true, notes: [{ string: 7, fret: 5 }] }, { type: 'note', duration: 'half', notes: [{ string: 7, fret: 5, pitch: 'C3', tieStart: true }] }] },
      { beats: [tn('whole', 7, 0), { type: 'note', duration: 'whole', slash: true, notes: [{ string: 7, fret: 1 }] }] },
    ], beats: [tn('whole', 7, 9)] },
  ], { tuning: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] })));
  const t0 = s.tracks[0];
  const r = T.retuneTrack(t0, ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  const [m0, m1] = r.track.measures;
  eq(m0.beats, [rest('quarter'), rest('quarter', { custom: 1 }), { type: 'note', duration: 'half', notes: [{ string: 1, fret: 0 }] }]);
  eq(m1.voices[0].beats, [graceB(1, 1), { type: 'note', duration: 'half', slash: true, notes: [] }, { type: 'note', duration: 'half', notes: [{ pitch: 'C3' }] }]);
  eq(m1.voices[1].beats, [rest('whole'), { type: 'rest', duration: 'whole', slash: true }], 'voice 2: a slash beat is not kept with no notes');
  eq(m1.beats, [rest('whole')], 'measure.beats beside voices is visited too');
  eq(r.removed, 10);
  eq([...r.droppedV1], [[0, [1]], [1, [0]]]);
  const out = { ...s, tracks: [r.track] };
  ok(sanitizeScore(out) === out, 'sanitize-stable');
});

// ---------- updateTrack ----------
const TR = await imp('src/editor/model/settings/track.js');
const TS = await imp('src/editor/model/settings/tracks.js');
const twoTracks = () => model({ tracks: [
  tab([{ clef: 'bass', beats: [nt('quarter')] }, { beats: [] }], { name: 'Gtr', clef: 'treble', custom: { x: 1 } }),
  tab([{ beats: [] }, { beats: [] }], { name: 'Bass', tuning: ['E1', 'A1', 'D2', 'G2'], showStandardNotation: false }),
] });
test('updateTrack: every field (written canonical / explicit / deleted), clef deletes measures[0].clef, unknown fields kept, no change returns the same score; announce', () => {
  const s = twoTracks();
  const c = cur(0, 0, 0);
  const r = TR.updateTrack(s, c, 0, { name: ' Lead ', label: 'Ld.', clef: ' Treble8VB ', showStandardNotation: false, tabRhythm: true, tabArticulations: true, tiedFrets: 'parens', capo: 3 });
  const t = r.score.tracks[0];
  eq(t, { name: 'Lead', showTablature: true, clef: 'treble8vb', custom: { x: 1 }, measures: [{ beats: [nt('quarter')] }, { beats: [] }], label: 'Ld.', showStandardNotation: false, tabRhythm: true, tabArticulations: true, tiedFrets: 'parens', capo: 3 });
  ok(r.score.tracks[1] === s.tracks[1] && t.measures[1] === s.tracks[0].measures[1] && sanitizeScore(r.score) === r.score);
  eq(say(r), 'Track 1 Lead updated');
  const back = TR.updateTrack(r.score, c, 0, { label: null, clef: null, tabRhythm: 'auto', tabArticulations: false, tiedFrets: false, capo: 0 }).score.tracks[0];
  eq(['label', 'clef', 'tabRhythm', 'tabArticulations', 'tiedFrets', 'capo'].filter((k) => k in back), []);
  eq(TR.updateTrack(r.score, c, 0, { tabRhythm: false, tiedFrets: null, capo: null }).score.tracks[0].tabRhythm, false);
  const nullClef = TR.updateTrack(s, c, 0, { clef: null }).score.tracks[0];
  ok(!('clef' in nullClef) && !('clef' in nullClef.measures[0]), 'null clef deletes both');
  ok(TR.updateTrack(s, c, 0, { name: 'Gtr', clef: 'treble' }).score !== s, 'clef equal but measures[0].clef removed: a change');
  ok(TR.updateTrack(s, c, 1, { name: ' Bass ', showTablature: true, capo: 0, tabRhythm: null }).score === s, 'equal values: same score');
  ok(TR.updateTrack(s, c, 1, {}).score === s);
  throwsClean(s, () => TR.updateTrack(s, c, 2, {}), RangeError);
  throwsClean(s, () => TR.updateTrack(s, c, -1, {}), RangeError);
  throwsClean(s, () => TR.updateTrack(s, c, '0', {}), TypeError);
  throwsClean(s, () => TR.updateTrack(s, c, 0), TypeError, 'must be an object');
  throwsClean(s, () => TR.updateTrack(s, c, 0, { name: 'ok', measures: [] }), TypeError, 'Unknown track field: measures');
  throwsClean(s, () => TR.updateTrack(s, c, 0, JSON.parse('{"__proto__":{}}')), TypeError, '__proto__');
  throwsClean(s, () => TR.updateTrack(s, c, 0, { name: 'ok', clef: 'soprano' }), RangeError, 'Unknown clef');
  throwsClean(s, () => TR.updateTrack(s, c, 0, { clef: 1 }), TypeError);
  throwsClean(s, () => TR.updateTrack(s, c, 0, { showTablature: null }), TypeError);
  throwsClean(s, () => TR.updateTrack(s, c, 0, { tabRhythm: 'always' }), RangeError);
  throwsClean(s, () => TR.updateTrack(s, c, 0, { tabRhythm: 1 }), TypeError);
  throwsClean(s, () => TR.updateTrack(s, c, 0, { tiedFrets: true }), TypeError);
  throwsClean(s, () => TR.updateTrack(s, c, 0, { tiedFrets: 'brackets' }), RangeError);
  for (const bad of [31, -1, 2.5]) throwsClean(s, () => TR.updateTrack(s, c, 0, { capo: bad }), RangeError);
  throwsClean(s, () => TR.updateTrack(s, c, 0, { capo: '2' }), TypeError);
  throwsClean(s, () => TR.updateTrack(s, c, 0, { tuning: ['E2', 'Q2'] }), RangeError);
  throwsClean(s, () => TR.updateTrack(s, c, 0, { name: 'ok', tuning: 'E2' }), TypeError);
});
test('updateTrack: hiding the last visible track is refused (lastVisible); hiding one of two is fine; a hidden track can be edited', () => {
  const s = twoTracks();
  const c = cur(0, 0, 0);
  const hid = TR.updateTrack(s, c, 1, { showTablature: false, showStandardNotation: false });
  ok(hid.score && !hid.refused);
  eq(TR.updateTrack(hid.score, c, 0, { showTablature: false, showStandardNotation: false }), { refused: { id: 'lastVisible' } });
  ok(TR.updateTrack(hid.score, c, 1, { name: 'Hidden bass' }).score, 'a hidden track is edited');
  eq(describe({ id: 'lastVisible' }), 'At least one track must be visible');
});
test('updateTrack tuning: one call retunes, counts removed notes, adjusts the cursor beat for dropped graces below it; the string clamps later', () => {
  const s = model(sc(tab([{ beats: [graceB(7, 1), graceB(7, 2), nt('quarter', 1, 0), nt('quarter', 7, 3)] }], { tuning: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] })));
  const r = TR.updateTrack(s, cur(0, 0, 3, 7), 0, { tuning: ['e2', 'a2', 'd3', 'g3', 'b3', 'e4'] });
  eq(r.score.tracks[0].tuning, ['E2', 'A2', 'D3', 'G3', 'B3', 'E4']);
  eq(r.score.tracks[0].measures[0].beats, [nt('quarter', 1, 0), rest('quarter')]);
  eq(r.cursor, cur(0, 0, 1, 7));
  eq(C.clampCursor(r.score, r.cursor), cur(0, 0, 1, 6));
  eq(say(r), 'Track 1 Gtr updated, 3 notes removed');
  eq(describe({ id: 'trackUpdated', n: 2, name: '', removed: 1 }), 'Track 2 updated, 1 note removed');
  eq(TR.updateTrack(s, cur(0, 0, 2), 0, { tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }).cursor.beat, 0);
  eq(TR.updateTrack(s, cur(0, 0, 2), 0, { tuning: ['A1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }).cursor, cur(0, 0, 2), 'no strings removed');
});
test('uniqueName: trimmed, case-insensitive; first free "Name n" from 2', () => {
  const ts = [{ name: 'Guitar' }, { name: ' guitar 2 ' }, { name: 'Bass' }, {}];
  eq([TR.uniqueName(ts, 'Guitar'), TR.uniqueName(ts, 'BASS'), TR.uniqueName(ts, 'Uke'), TR.uniqueName([], 'Guitar')], ['Guitar 3', 'BASS 2', 'Uke', 'Guitar']);
});

// ---------- addTrack ----------
test('addTrack: presets, spec precedence, numbering, position, cursor; measures per column with time / key from track 0 and navigation copied, clefs not', () => {
  const s = model({ timeSignature: { beats: 3, beatType: 4 }, tracks: [
    tab([
      { timeSignature: { beats: 3, beatType: 4 }, clef: 'bass', barline: 'repeatStart', beats: [nt('quarter')] },
      { keySignature: 2, ending: [1, 2], beats: [] },
      { timeSignature: { beats: 6, beatType: 8 }, jump: 'D.S.', beats: [] },
    ], { name: 'Guitar', keySignature: 1 }),
    tab([{ beats: [] }, { beats: [], ending: 3, segno: true }, { beats: [], section: { letter: 'A' } }, { beats: [], repeatCount: 3, barline: 'repeatEnd', coda: false }], { name: 'Other' }),
  ] });
  const c = cur(1, 2, 0, 3);
  const r = TS.addTrack(s, c);
  eq(r.score.tracks.length, 3);
  const t = r.score.tracks[2];
  eq(t, { name: 'Guitar 2', clef: 'treble', showStandardNotation: true, showTablature: true, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], measures: [
    { beats: [], keySignature: 1, barline: 'repeatStart' },
    { beats: [], keySignature: 2, ending: [1, 2], segno: true },
    { beats: [], timeSignature: { beats: 6, beatType: 8 }, jump: 'D.S.', section: { letter: 'A' } },
    { beats: [], barline: 'repeatEnd', repeatCount: 3 },
  ] });
  eq(r.cursor, cur(2, 2, 0, 3));
  eq(say(r), 'Track 3 Guitar 2 added');
  ok(sanitizeScore(r.score) === r.score && r.score.tracks[0] === s.tracks[0]);
  const b = TS.addTrack(s, c, 'bass5', 0);
  eq([b.score.tracks[0].name, b.score.tracks[0].clef, b.score.tracks[0].tuning.length, b.cursor.track, b.score.tracks[1] === s.tracks[0]], ['5-string bass', 'bass', 5, 0, true]);
  const spec = TS.addTrack(s, c, { preset: 'ukulele', name: ' Uke ', label: 'U', clef: 'TREBLE8VA', tuning: ['g4', 'c4', 'e4', 'a4'], showStandardNotation: false, capo: 2 }, 1);
  eq(spec.score.tracks[1], { name: 'Uke', label: 'U', clef: 'treble8va', showStandardNotation: false, showTablature: true, tuning: ['G4', 'C4', 'E4', 'A4'], capo: 2, measures: t.measures });
  eq(TS.addTrack(s, c, { name: 'other' }).score.tracks[2].name, 'other 2', 'clash: case-insensitive');
  eq(TS.addTrack(s, c, { capo: 0, clef: null }).score.tracks[2].clef, undefined);
  eq(TS.addTrack(model(sc()), cur(0, 0, 0), 'bass4').score.tracks[0].measures, [{ beats: [] }], 'a score with no tracks');
  for (const [args, Type] of [[['nope'], RangeError], [['constructor'], RangeError], [[{ instrument: 'bass4' }], TypeError], [[5], TypeError], [[null], TypeError],
    [[{ preset: 'x' }], RangeError], [[{ tuning: [] }], RangeError], [[undefined, 3], RangeError], [[undefined, -1], RangeError], [[undefined, '1'], TypeError],
    [[{ name: 'a\nb' }], RangeError], [[{ showTablature: 'yes' }], TypeError], [[{ capo: 40 }], RangeError], [[JSON.parse('{"__proto__":{}}')], TypeError]]) {
    throwsClean(s, () => TS.addTrack(s, c, ...args), Type, '', JSON.stringify(args));
  }
  const full = model({ tracks: Array.from({ length: 32 }, () => tab([{ beats: [] }])) });
  eq(TS.addTrack(full, c), { refused: { id: 'tooManyTracks' } });
  throws(() => TS.addTrack(full, c, 'nope'), RangeError, '', 'throws before the refusal');
  eq(describe({ id: 'tooManyTracks' }), 'A score has at most 32 tracks');
});

// ---------- removeTrack / moveTrack ----------
test('removeTrack: column fields only the removed track sets move to the others (all 9); fields another track sets stay; refusals; cursor', () => {
  const s = model({ tracks: [
    tab([{ beats: [] }, { beats: [], jump: 'Fine' }], { name: 'A' }),
    tab([
      { beats: [nt('quarter')], barline: 'double', ending: { numbers: [1], text: 'x' }, section: 'Verse', segno: true, coda: true, timeSignature: { beats: 3, beatType: 4 }, keySignature: -3 },
      { beats: [], jump: 'D.C.', barline: 'repeatEnd', repeatCount: 4, clef: 'bass', custom: 1 },
      { beats: [], ending: 'bogus' },
    ], { name: 'B' }),
    tab([{ beats: [] }], { name: 'C', showTablature: false, showStandardNotation: false }),
  ] });
  const r = TS.removeTrack(s, cur(1, 0, 0), 1);
  eq(r.score.tracks.map((t) => t.name), ['A', 'C']);
  const nav0 = { barline: 'double', ending: { numbers: [1], text: 'x' }, section: 'Verse', segno: true, coda: true, timeSignature: { beats: 3, beatType: 4 }, keySignature: -3 };
  eq(r.score.tracks[0].measures, [{ beats: [], ...nav0 }, { beats: [], jump: 'Fine', barline: 'repeatEnd', repeatCount: 4 }]);
  eq(r.score.tracks[1].measures, [{ beats: [], ...nav0 }, { beats: [], barline: 'repeatEnd', repeatCount: 4 }], 'hidden tracks get them too; jump set by A stays only on A');
  eq(r.cursor.track, 1);
  eq(C.clampCursor(r.score, r.cursor).track, 0, 'clamped to the nearest visible track');
  eq(say(r), 'Track 2 B removed');
  ok(sanitizeScore(r.score) === r.score);
  eq(TS.removeTrack(s, cur(2, 0, 0), 0).cursor.track, 1, 'after the removed one: -1');
  eq(TS.removeTrack(s, cur(0, 0, 0), 2).cursor.track, 0);
  eq(TS.removeTrack(model(sc(tab([{ beats: [] }]))), cur(0, 0, 0), 0), { refused: { id: 'onlyTrack' } });
  const oneVisible = model({ tracks: [tab([{ beats: [] }]), tab([{ beats: [] }], { showTablature: false, showStandardNotation: false })] });
  eq(TS.removeTrack(oneVisible, cur(0, 0, 0), 0), { refused: { id: 'lastVisible' } });
  ok(TS.removeTrack(oneVisible, cur(0, 0, 0), 1).score, 'the hidden one can go');
  throwsClean(s, () => TS.removeTrack(s, cur(0, 0, 0), 3), RangeError);
  throwsClean(s, () => TS.removeTrack(s, cur(0, 0, 0)), TypeError);
  eq(describe({ id: 'onlyTrack' }), 'A score needs at least one track');
});
test('moveTrack: the track list reorders, the cursor stays on its track (every from / to / cursor combination); same index = no change', () => {
  const s = model({ tracks: ['A', 'B', 'C', 'D'].map((name) => tab([{ beats: [] }], { name })) });
  for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) for (let c = 0; c < 4; c++) {
    const r = TS.moveTrack(s, cur(c, 0, 0), from, to);
    if (from === to) { ok(r.score === s && !r.announce); continue; }
    const names = s.tracks.map((t) => t.name);
    const [m] = names.splice(from, 1);
    names.splice(to, 0, m);
    eq(r.score.tracks.map((t) => t.name), names);
    eq(r.score.tracks[r.cursor.track], s.tracks[c], `${from}->${to} cursor ${c}`);
  }
  eq(say(TS.moveTrack(s, cur(0, 0, 0), 3, 0)), 'Track D moved to position 1');
  throwsClean(s, () => TS.moveTrack(s, cur(0, 0, 0), 0, 4), RangeError);
  throwsClean(s, () => TS.moveTrack(s, cur(0, 0, 0), 0.5, 1), RangeError);
});

// ---------- updateMeasure / getMeasureSettings ----------
const MS = await imp('src/editor/model/settings/measureSettings.js');
const { clefAt } = await imp('src/clef.js');
const measureScore = () => model({ keySignature: 1, tracks: [
  tab([{ beats: [nt('whole')] }, { beats: [] }, { beats: [] }, { beats: [] }], { name: 'Gtr', timeSignature: { beats: 3, beatType: 4 } }),
  tab([{ beats: [] }, { beats: [], clef: 'bass' }], { name: 'Bass', clef: 'bass', showStandardNotation: false, keySignature: -2 }),
  tab([{ beats: [] }], { name: 'Hidden', showTablature: false, showStandardNotation: false }),
] });
test('updateMeasure time / key: equality with the value in force decided per track; written on every track (padding holes), deleted when equal; null deletes; measure 0 throws on null', () => {
  const s = measureScore();
  const c = cur(0, 0, 0);
  const r = MS.updateMeasure(s, c, 2, { timeSignature: { beats: 3, beatType: 4 } });
  eq(r.score.tracks.map((t) => t.measures[2] ?? null), [{ beats: [] }, { beats: [], timeSignature: { beats: 3, beatType: 4 } }, { beats: [], timeSignature: { beats: 3, beatType: 4 } }], 'Gtr is already in 3/4: nothing written there; others padded');
  eq(say(r), 'Time signature 3/4 from measure 3');
  ok(r.score.tracks[0] === s.tracks[0] && sanitizeScore(r.score) === r.score);
  const k0 = MS.updateMeasure(s, c, 0, { keySignature: 1 });
  eq(k0.score.tracks.map((t) => t.measures[0].keySignature ?? null), [null, 1, null], 'at measure 0: compared with track, else score key');
  eq(say(k0), 'Key signature 1 sharp from measure 1');
  const t0 = MS.updateMeasure(s, c, 0, { timeSignature: { beats: 4, beatType: 4 } });
  eq(t0.score.tracks.map((t) => t.measures[0].timeSignature ?? null), [{ beats: 4, beatType: 4 }, null, null]);
  const del = MS.updateMeasure(r.score, c, 2, { timeSignature: null });
  eq(del.score.tracks.map((t) => 'timeSignature' in (t.measures[2] ?? {})), [false, false, false]);
  eq(say(del), 'Time signature change removed at measure 3');
  ok(MS.updateMeasure(s, c, 3, { timeSignature: null, keySignature: null }).score === s, 'deleting nothing: same score, no measures created');
  ok(MS.updateMeasure(s, c, 1, { keySignature: 1 }).score !== s && MS.updateMeasure(s, c, 1, { keySignature: 1 }).score.tracks[0] === s.tracks[0]);
  eq(describe({ id: 'measureSet', key: 'keySignature', value: 0, n: 5 }), 'Key signature no sharps or flats from measure 5');
  eq(describe({ id: 'measureSet', key: 'keySignature', value: -3, n: 5 }), 'Key signature 3 flats from measure 5');
  eq(describe({ id: 'measureSet', key: 'keySignature', value: null, n: 5 }), 'Key signature change removed at measure 5');
  throwsClean(s, () => MS.updateMeasure(s, c, 0, { timeSignature: null }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 0, { keySignature: null }), RangeError);
  for (const bad of [{ beats: 33, beatType: 4 }, { beats: 0, beatType: 4 }, { beats: 3, beatType: 3 }, { beats: 3, beatType: 64 }, { beats: 2.5, beatType: 4 }]) throwsClean(s, () => MS.updateMeasure(s, c, 1, { timeSignature: bad }), RangeError, '', JSON.stringify(bad));
  for (const bad of [[3, 4], '3/4', { beats: 3 }, { beats: 3, beatType: 4, x: 1 }]) throwsClean(s, () => MS.updateMeasure(s, c, 1, { timeSignature: bad }), TypeError, '', JSON.stringify(bad));
  for (const bad of [8, -8, 1.5]) throwsClean(s, () => MS.updateMeasure(s, c, 1, { keySignature: bad }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { keySignature: '1' }), TypeError);
  for (const beatType of [1, 2, 4, 8, 16, 32]) { const x = MS.updateMeasure(s, c, 1, { timeSignature: { beats: 32, beatType } }).score; ok(sanitizeScore(x) === x, `32/${beatType} sanitize-stable`); }
});
test('updateMeasure clef: per track (option or cursor track), equal to the clef in force deletes, measure 0 throws, TAB-only announced', () => {
  const s = measureScore();
  const r = MS.updateMeasure(s, cur(0, 0, 0), 2, { clef: 'Bass' });
  eq([r.score.tracks[0].measures[2].clef, r.score.tracks[1] === s.tracks[1]], ['bass', true]);
  eq(say(r), 'Clef bass from measure 3');
  const b = MS.updateMeasure(s, cur(0, 0, 0), 2, { clef: 'treble8vb' }, { track: 1 });
  eq(say(b), 'Clef treble 8vb from measure 3, not shown on TAB only');
  eq(b.score.tracks[1].measures[2].clef, 'treble8vb');
  ok(MS.updateMeasure(s, cur(0, 0, 0), 1, { clef: 'bass' }, { track: 1 }).score !== s, 'measure 1 of Bass sets bass, equal to the clef in force: deleted');
  eq('clef' in MS.updateMeasure(s, cur(0, 0, 0), 1, { clef: 'bass' }, { track: 1 }).score.tracks[1].measures[1], false);
  eq(say(MS.updateMeasure(s, cur(1, 0, 0), 1, { clef: null })), 'Clef change removed at measure 2');
  ok(MS.updateMeasure(s, cur(0, 0, 0), 3, { clef: 'treble' }).score === s);
  throwsClean(s, () => MS.updateMeasure(s, cur(0, 0, 0), 0, { clef: 'bass' }), RangeError, 'updateTrack');
  throwsClean(s, () => MS.updateMeasure(s, cur(0, 0, 0), 0, { clef: null }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, cur(0, 0, 0), 1, { clef: 'soprano' }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, cur(0, 0, 0), 1, { clef: 'bass' }, { track: 3 }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, cur(0, 0, 0), 1, { clef: 'bass' }, { staff: 1 }), TypeError, 'Unknown option field: staff');
  throwsClean(s, () => MS.updateMeasure(s, cur(0, 0, 0), 1, { clef: 'bass' }, 1), TypeError);
});
test('updateMeasure barline / repeatCount: column-wide; non-repeatEnd removes the count in the same step; a count needs repeatEnd (patch or column)', () => {
  const s = measureScore();
  const c = cur(0, 0, 0);
  const r = MS.updateMeasure(s, c, 1, { barline: 'repeatEnd', repeatCount: 3 });
  eq(r.score.tracks.map((t) => [t.measures[1].barline, t.measures[1].repeatCount]), [['repeatEnd', 3], ['repeatEnd', 3], ['repeatEnd', 3]]);
  eq(say(r), 'Measure 2 settings updated');
  eq(say(MS.updateMeasure(r.score, c, 1, { repeatCount: 4 })), 'Repeat count 4 at measure 2');
  const d = MS.updateMeasure(r.score, c, 1, { barline: 'double' });
  eq(d.score.tracks.map((t) => [t.measures[1].barline, 'repeatCount' in t.measures[1]]), [['double', false], ['double', false], ['double', false]]);
  eq(say(d), 'Double barline at measure 2');
  eq(say(MS.updateMeasure(r.score, c, 1, { barline: null })), 'Barline removed at measure 2');
  ok(!('repeatCount' in MS.updateMeasure(r.score, c, 1, { barline: null }).score.tracks[0].measures[1]));
  eq(say(MS.updateMeasure(s, c, 1, { barline: 'repeatEnd' })), 'Repeat end barline at measure 2');
  ok(MS.updateMeasure(r.score, c, 1, { repeatCount: null }).score.tracks.every((t) => !('repeatCount' in t.measures[1])));
  ok(MS.updateMeasure(r.score, c, 1, { barline: 'repeatEnd', repeatCount: 3 }).score === r.score, 'no change');
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { repeatCount: 3 }), RangeError, 'repeat end');
  throwsClean(s, () => MS.updateMeasure(r.score, c, 1, { barline: 'final', repeatCount: 3 }), RangeError, 'repeat end');
  for (const bad of [1, 100, 2.5]) throwsClean(r.score, () => MS.updateMeasure(r.score, c, 1, { repeatCount: bad }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { barline: 'thick' }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { barline: true }), TypeError);
  eq(MS.updateMeasure(r.score, c, 1, { repeatCount: 2 }).score.tracks[0].measures[1].repeatCount, 2, 'R9: 2 is accepted (the renderer draws x2)');
});
test('updateMeasure ending / segno / coda / jump / section: stored shortest, trimmed, canonical; column-wide overwrite of conflicting values; bad values throw', () => {
  const s = model({ tracks: [tab([{ beats: [] }, { beats: [], ending: 5, jump: 'Fine' }]), tab([{ beats: [] }, { beats: [], ending: 7, jump: 'Custom words' }])] });
  const c = cur(0, 0, 0);
  const end = (v) => MS.updateMeasure(s, c, 1, { ending: v }).score.tracks.map((t) => t.measures[1].ending);
  eq(end(2), [2, 2], 'conflicting values overwritten');
  eq(end([3, 1]), [[1, 3], [1, 3]]);
  eq(end([4])[0], 4);
  eq(end({ numbers: [2, 1] })[0], [1, 2]);
  eq(end({ numbers: [1], text: ' Last ', open: true })[0], { numbers: 1, text: 'Last', open: true });
  eq(end({ numbers: 1, open: false })[0], { numbers: 1, open: false });
  eq(end({ numbers: [1, 2], text: ' ' })[0], [1, 2]);
  eq(say(MS.updateMeasure(s, c, 1, { ending: [1, 2] })), 'Ending 1., 2. at measure 2');
  eq(say(MS.updateMeasure(s, c, 1, { ending: null })), 'Ending removed at measure 2');
  for (const bad of [0, 100, [], Array.from({ length: 33 }, (_, i) => i + 1), [1, 1], 1.5, { numbers: [] }, { numbers: 1, text: 'a\nb' }]) throwsClean(s, () => MS.updateMeasure(s, c, 1, { ending: bad }), RangeError, '', JSON.stringify(bad));
  for (const bad of ['1', { numbers: '1' }, { numbers: 1, open: 'yes' }, { numbers: 1, label: 'x' }, true]) throwsClean(s, () => MS.updateMeasure(s, c, 1, { ending: bad }), TypeError, '', JSON.stringify(bad));
  eq(MS.updateMeasure(s, c, 1, { ending: Array.from({ length: 32 }, (_, i) => 32 - i) }).score.tracks[0].measures[1].ending.length, 32);
  const nav = MS.updateMeasure(s, c, 0, { segno: true, coda: true, jump: ' d.s.  al coda ', section: { letter: ' A ', text: ' Verse ' } });
  eq(nav.score.tracks.map((t) => t.measures[0]), Array(2).fill({ beats: [], segno: true, coda: true, jump: 'D.S. al Coda', section: { letter: 'A', text: 'Verse' } }));
  eq(say(MS.updateMeasure(s, c, 0, { jump: 'To Coda' })), 'To Coda at measure 1');
  eq(say(MS.updateMeasure(s, c, 1, { jump: null })), 'Jump removed at measure 2');
  eq(say(MS.updateMeasure(s, c, 0, { segno: true })), 'Segno at measure 1');
  eq(say(MS.updateMeasure(nav.score, c, 0, { coda: false })), 'Coda removed at measure 1');
  eq(say(MS.updateMeasure(s, c, 0, { section: { letter: 'A', text: 'Verse' } })), 'Section A Verse at measure 1');
  eq(say(MS.updateMeasure(s, c, 0, { section: ' Chorus ' })), 'Section Chorus at measure 1');
  eq(say(MS.updateMeasure(nav.score, c, 0, { section: null })), 'Section removed at measure 1');
  eq(MS.updateMeasure(s, c, 0, { section: { letter: '😀ab' } }).score.tracks[0].measures[0].section, { letter: '😀ab' });
  ok(MS.updateMeasure(s, c, 0, { section: '  ', segno: false, coda: null, jump: null, ending: null }).score === s);
  for (const bad of ['Da Capo', 'Custom words']) throwsClean(s, () => MS.updateMeasure(s, c, 1, { jump: bad }), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { jump: 1 }), TypeError);
  for (const bad of [{ letter: 'ABCD' }, { letter: '' }, { letter: ' ' }, 'x'.repeat(201), 'a\nb', { letter: 'A', text: 'x'.repeat(201) }]) throwsClean(s, () => MS.updateMeasure(s, c, 1, { section: bad }), RangeError, '', JSON.stringify(bad));
  for (const bad of [{ text: 'Verse' }, { letter: 1 }, { letter: 'A', name: 'x' }, 5]) throwsClean(s, () => MS.updateMeasure(s, c, 1, { section: bad }), TypeError, '', JSON.stringify(bad));
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { segno: 'yes' }), TypeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 2, {}), RangeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { bogus: 1 }), TypeError, 'Unknown measure field: bogus');
  throwsClean(s, () => MS.updateMeasure(s, c, 1, { segno: true, beats: [] }), TypeError, 'beats');
  throwsClean(s, () => MS.updateMeasure(s, c, 1, JSON.parse('{"__proto__":{}}')), TypeError);
  throwsClean(s, () => MS.updateMeasure(s, c, 1), TypeError);
  ok([nav].every((x) => sanitizeScore(x.score) === x.score));
});
test('getMeasureSettings: in force + here + inherited; navigation equals normalizeScore(...).navigation[mi]; clef equals clefAt; custom jumps reported', () => {
  const s = model({ keySignature: 1, tracks: [
    tab([{ beats: [] }, { beats: [], timeSignature: { beats: 6, beatType: 8 }, ending: [2, 1], barline: 'repeatEnd', repeatCount: 3 }, { beats: [], jump: 'Play twice', section: { letter: 'B' } }, { beats: [], keySignature: -1, segno: true }], { timeSignature: { beats: 3, beatType: 4 } }),
    tab([{ beats: [], clef: 'alto' }, { beats: [], ending: 9, barline: 'double', coda: true }, null, { beats: [], clef: 'bass', jump: 'Fine' }], { clef: 'tenor', keySignature: -2 }),
  ] });
  const n = normalizeScore(s);
  for (let mi = 0; mi < 4; mi++) for (let ti = 0; ti < 2; ti++) {
    const g = MS.getMeasureSettings(s, mi, ti);
    const col = n.navigation[mi];
    eq([g.ending, g.segno, g.coda, g.jump, g.section, g.repeatCount], [col.ending, col.segno, col.coda, col.jump, col.section ?? null, col.repeatCount ?? null], `nav ${mi}`);
    eq(g.clef.value, clefAt(s.tracks[ti], mi));
    const nm = n.tracks[ti].measures[mi];
    eq([g.timeSignature.beats, g.timeSignature.beatType, g.keySignature.value], [nm.timeSignature.beats, nm.timeSignature.beatType, nm.keySignature], `${mi}/${ti}`);
    if (mi > 0) {
      const prev = n.tracks[ti].measures[mi - 1];
      eq([g.timeSignature.inherited, g.keySignature.inherited, g.clef.inherited], [{ beats: prev.timeSignature.beats, beatType: prev.timeSignature.beatType }, prev.keySignature, clefAt(s.tracks[ti], mi - 1)]);
    }
  }
  const a = MS.getMeasureSettings(s, 1, 0);
  eq(a, { measure: 1, track: 0, timeSignature: { beats: 6, beatType: 8, here: true, inherited: { beats: 3, beatType: 4 } }, keySignature: { value: 1, here: false, inherited: 1 }, clef: { value: 'treble', here: false, inherited: 'treble' },
    barline: 'repeatEnd', repeatCount: 3, ending: { numbers: [1, 2], text: null, open: null }, segno: false, coda: true, jump: null, jumpCustom: false, section: null });
  const z = MS.getMeasureSettings(s, 0, 1);
  eq([z.clef, z.keySignature, z.timeSignature.inherited], [{ value: 'alto', here: true, inherited: 'tenor' }, { value: -2, here: false, inherited: -2 }, { beats: 4, beatType: 4 }]);
  eq([MS.getMeasureSettings(s, 2, 1).jump, MS.getMeasureSettings(s, 2, 1).jumpCustom], ['Play twice', true]);
  eq(MS.getMeasureSettings(s, 3, 1).clef, { value: 'bass', here: true, inherited: 'alto' });
  eq(MS.getMeasureSettings(s, 2, 1).barline, null);
  throws(() => MS.getMeasureSettings(s, 4, 0), RangeError);
  throws(() => MS.getMeasureSettings(s, 0, 2), RangeError);
  throws(() => MS.getMeasureSettings(s, '0', 0), TypeError);
});

// ---------- B10: commands and settings calls mixed ----------
const { run } = await imp('src/editor/model/commands.js');
const { createHistory } = await imp('src/editor/model/history.js');
const { EFFECTS } = await imp('src/editor/model/effectTable.js');
const { SETTINGS } = await imp('src/editor/model/settings/ops.js');
const { defaultScore } = await imp('src/editor/model/defaultScore.js');
const { CLEF_NAMES } = await imp('src/clef.js');
const { exampleScore } = await imp('examples/example-score.js');
const { leadRiff } = await imp('examples/lead-riff.js');
const { leadSoloF } = await imp('examples/lead-solo-f.js');
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const COMMAND_PICKS = ['digit', 'digit', 'digit', 'moveRight', 'moveRight', 'moveLeft', 'moveUp', 'moveDown', 'nextMeasure', 'prevMeasure', 'nextTrack', 'prevTrack',
  'deleteNote', 'toggleTie', 'toggleRest', 'deleteBeat', 'insertBeat', 'insertMeasureAfter', 'insertMeasureBefore', 'deleteMeasure', 'shorter', 'longer', ...EFFECTS.map((d) => d.name)];
/** Random (mostly valid, sometimes invalid) arguments for settings call `name` on `s`. */
function settingsArgs(name, s, rnd) {
  const pick = (list) => list[Math.floor(rnd() * list.length)];
  const n = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const tracks = s.tracks.length;
  const mc = Math.max(1, ...s.tracks.map((t) => (t.measures || []).length));
  const tunings = Object.values(TUNINGS).flat().map((p) => p.tuning);
  switch (name) {
    case 'updateScore': return [pick([{ title: pick(['A', ' B ', null, '']) }, { showTuningChart: rnd() < 0.5 }, { multiMeasureRests: pick([true, null]) }, { instructions: 'a\nb', copyright: null }, { bogus: 1 }])];
    case 'updateTrack': return [n(0, tracks), pick([{ name: pick(['X', null]) }, { clef: pick([...CLEF_NAMES, null, 'soprano']) }, { showTablature: rnd() < 0.7 }, { showStandardNotation: rnd() < 0.5 },
      { tuning: pick(tunings) }, { tuning: pick(tunings) }, { capo: n(0, 31) }, { tabRhythm: pick([true, false, 'auto', null]) }, { tiedFrets: pick(['parens', null]) }, { tabArticulations: rnd() < 0.5 }])];
    case 'addTrack': return [pick([undefined, ...Object.keys(INSTRUMENTS), { preset: 'bass4', name: 'B' }]), pick([undefined, n(0, tracks + 1)])];
    case 'removeTrack': return [n(0, tracks)];
    case 'moveTrack': return [n(0, tracks - 1), n(0, tracks)];
    case 'updateMeasure': {
      const mi = n(0, mc);
      const patch = pick([{ timeSignature: pick([{ beats: n(1, 7), beatType: pick([4, 8]) }, null]) }, { keySignature: pick([n(-7, 7), null]) }, { clef: pick(['bass', 'treble', 'alto', null]) },
        { barline: pick(['repeatEnd', 'repeatStart', 'double', null]) }, { barline: 'repeatEnd', repeatCount: n(2, 5) }, { ending: pick([1, [1, 2], { numbers: [2], text: 'x' }, null]) },
        { segno: rnd() < 0.5, coda: rnd() < 0.5 }, { jump: pick(['D.C.', 'Fine', 'To Coda', null]) }, { section: pick(['Verse', { letter: 'A' }, null]) }, { repeatCount: 3 }]);
      return rnd() < 0.2 ? [mi, patch, { track: n(0, tracks - 1) }] : [mi, patch];
    }
    default: return [pick([120, 60.5, { bpm: 90, unit: 'half', dots: 1 }, null, 0])];
  }
}
const B10_START = () => [
  ['default', defaultScore()],
  ['lead-riff', model(leadRiff)],
  ['lead-solo-f', model(leadSoloF)],
  ['example-score', model(exampleScore)],
  ['rich', model(sc(
    tab([{ beats: [nt('quarter'), graceB(), tn('quarter', 2, 2, { tieStart: true }), rest('quarter', { hidden: true })] },
      { voices: [{ beats: [graceB(), tn('half', 2, 2, { tieEnd: true }), nt('half')] }, { beats: [nt('whole', 4, 0)] }] },
      { beats: [{ type: 'note', duration: 'whole', slash: true, notes: [] }] }, null], { tuning: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }),
    { name: 'Hidden', showStandardNotation: false, measures: [{ beats: [] }] },
  ))],
];
test('B10: 5 start scores x 1000 random steps mixing commands and settings calls keep sanitizeScore(model) === model and a valid cursor; throws change nothing; undo all / redo all', () => {
  const rnd = mulberry32(20261122);
  const names = Object.keys(SETTINGS);
  for (const [label, start] of B10_START()) {
    let s = start;
    let c = C.clampCursor(s, cur(0, 0, 0, 1));
    let st = { duration: 'quarter', dots: 0, digit: null };
    const h = createHistory(10000);
    let now = 0;
    let settingsEdits = 0;
    let throwsSeen = 0;
    for (let i = 0; i < 1000; i++) {
      now += rnd() < 0.6 ? 200 : 1500;
      if (rnd() < 0.35) {
        const name = names[Math.floor(rnd() * names.length)];
        const args = settingsArgs(name, s, rnd);
        const snap = JSON.stringify(s);
        let r;
        try { r = SETTINGS[name].fn(s, c, ...args); } catch (e) {
          if (!(e instanceof TypeError || e instanceof RangeError)) throw e;
          if (JSON.stringify(s) !== snap) throw new Error(`${label} step ${i}: ${name} threw after changing the model`);
          throwsSeen++;
          continue;
        }
        if (r.refused || r.score === s) continue;
        const nc = C.clampCursor(r.score, r.cursor ?? c);
        h.push({ before: { score: s, cursor: c }, after: { score: r.score, cursor: nc } });
        s = r.score; c = nc; st = C.syncDuration(s, c, { ...st, digit: null });
        settingsEdits++;
      } else {
        const pick = COMMAND_PICKS[Math.floor(rnd() * COMMAND_PICKS.length)];
        const r = run(pick, s, c, st, { maxFret: 24, now, twoDigitDelayMs: 800, allowAppend: true }, pick === 'digit' ? Math.floor(rnd() * 10) : undefined);
        if (r.changed) h.push({ before: { score: s, cursor: c }, after: { score: r.score, cursor: r.cursor } });
        s = r.score; c = r.cursor; st = r.state;
      }
      if (sanitizeScore(s) !== s) throw new Error(`${label} step ${i}: sanitize changed the model`);
      if (!C.sameCursor(C.clampCursor(s, c), c)) throw new Error(`${label} step ${i}: invalid cursor ${JSON.stringify(c)}`);
    }
    ok(settingsEdits > 80 && throwsSeen > 5, `${label}: ${settingsEdits} settings edits, ${throwsSeen} throws`);
    const end = s;
    let e;
    let steps = 0;
    while ((e = h.undo())) { s = e.before.score; steps++; }
    ok(s === start, `${label}: undo all returns the start object`);
    for (let k = 0; k < steps; k++) s = h.redo().after.score;
    ok(s === end, `${label}: redo all returns the end object`);
  }
});

// ---------- E12: unknown fields survive settings calls ----------
test('E12: unknown fields at score, track, measure, voice, beat and note level survive every settings call that does not own them', () => {
  const x = { keep: [1, { deep: true }] };
  const s0 = model({ x, title: 'T', tracks: [
    { x, name: 'A', showTablature: true, tuning: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'], measures: [
      { x, beats: [{ x, type: 'note', duration: 'half', notes: [{ x, string: 1, fret: 2 }, { x, string: 7, fret: 0 }] }, { x, type: 'rest', duration: 'half' }] },
      { x, voices: [{ x, beats: [{ x, type: 'note', duration: 'whole', notes: [{ x, string: 2, fret: 1 }] }] }, { x, beats: [] }] },
    ] },
    { x, name: 'B', showTablature: true, measures: [{ x, beats: [] }, { x, beats: [] }] },
  ] });
  let s = s0;
  const c = cur(0, 0, 0);
  const steps = [
    ['updateScore', [{ title: 'U', subtitle: 'S', showTuningChart: true }]],
    ['updateTrack', [0, { name: 'A2', capo: 2, clef: 'bass', tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }]],
    ['updateMeasure', [1, { timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, clef: 'treble', barline: 'repeatEnd', repeatCount: 2, ending: [1], segno: true, coda: true, jump: 'Fine', section: 'V' }]],
    ['setTempo', [80]],
    ['addTrack', ['bass4']],
    ['moveTrack', [0, 2]],
    ['removeTrack', [0]],
  ];
  for (const [name, args] of steps) s = SETTINGS[name].fn(s, c, ...args).score;
  const count = (v) => (Array.isArray(v) ? v.reduce((a, y) => a + count(y), 0) : v && typeof v === 'object' ? (JSON.stringify(v.x) === JSON.stringify(x) ? 1 : 0) + Object.values(v).reduce((a, y) => a + count(y), 0) : 0);
  // track B (4 x: track, 2 measures) is removed; track A loses the note on its removed 7th string (1 x)
  eq([count(s0), count(s)], [15, 15 - 3 - 1]);
  const a = s.tracks.find((t) => t.name === 'A2');
  eq([a.x, a.measures[0].x, a.measures[0].beats[0].x, a.measures[0].beats[0].notes[0].x, a.measures[1].voices[0].x, a.measures[1].voices[0].beats[0].notes[0].x, s.x], [x, x, x, x, x, x, x]);
  ok(sanitizeScore(s) === s);
});

// ---------- F1 / F2: measure commands on 2.2 fields ----------
test('F1/F2: M, Shift+M, Shift+Delete and Right-append keep 2.2-written fields as in 2.1: signatures and clef carry, navigation goes with its measure; an ending run splits; an explicit final barline stays', () => {
  let s = model(sc(tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }, { beats: [nt('whole')] }]), tab([{ beats: [] }, { beats: [] }, { beats: [] }], { name: 'B' })));
  const c = cur(0, 1, 0);
  s = MS.updateMeasure(s, c, 1, { timeSignature: { beats: 3, beatType: 4 }, keySignature: -1, clef: 'bass', ending: [1], section: 'Verse', jump: 'D.C.', barline: 'final' }).score;
  s = MS.updateMeasure(s, c, 2, { ending: [1] }).score;
  s = S.setTempo(s, c, 100).score;
  const st = { duration: 'quarter', dots: 0, digit: null };
  const ctx = { maxFret: 24, now: 0, twoDigitDelayMs: 800, allowAppend: true };
  const before = run('insertMeasureBefore', s, c, st, ctx);
  eq(before.score.tracks[0].measures[2], s.tracks[0].measures[1], 'Shift+M: the measure moves on unchanged');
  ok(sanitizeScore(before.score) === before.score);
  const after = run('insertMeasureAfter', s, c, st, ctx);
  eq(after.score.tracks[0].measures[2], { beats: [] });
  const nav = normalizeScore(after.score).navigation;
  eq([nav[1].ending?.numbers, nav[2].ending, nav[3].ending?.numbers], [[1], null, [1]], 'the ending run is split by the inserted measure');
  const del = run('deleteMeasure', s, c, st, ctx);
  const m1 = del.score.tracks[0].measures[1];
  eq([m1.timeSignature, m1.keySignature, m1.clef, m1.ending, m1.section, m1.jump, m1.barline], [{ beats: 3, beatType: 4 }, -1, 'bass', 1, undefined, undefined, undefined], 'Shift+Delete: signatures and clef carry, navigation and tempo go');
  eq(del.score.tracks[1].measures[1].keySignature, -1, 'on every track');
  const end = run('moveRight', s, cur(0, 2, 0), st, ctx);
  eq([end.score.tracks[0].measures.length, end.score.tracks[0].measures[1].barline], [4, 'final'], 'Right-append: the explicit final barline stays at measure 2');
  [after, del, end].forEach((r) => ok(sanitizeScore(r.score) === r.score));
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-settings: ${r.name}`);
    else { fail++; console.log(`FAIL editor-settings: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
