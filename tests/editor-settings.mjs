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
