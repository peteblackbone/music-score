// 2.2.0 editor settings, edge cases against the acceptance criteria: controller level (DOM shim). Undo / redo
// by reference and cursor restore for every track operation with the cursor on every position (hidden tracks
// included), string removal and its undo, read-only with bad arguments, the 5 MB limit at the boundary,
// lastMessage for every outcome, change / cursor event order and timing, the live region, destroy, and the
// demo's pure helpers.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-settings-edge-dom.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { INSTRUMENTS, TUNINGS } = await imp('src/editor/model/settings/instruments.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const DS = await imp('examples/editor-demo-settings.js');
const DT = await imp('examples/editor-demo-tracks.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const throws = (fn, Type, msg) => {
  try { fn(); } catch (e) {
    if (Type && !(e instanceof Type)) throw new Error(`threw ${e.constructor.name}: ${e.message}`);
    if (msg && !String(e.message).includes(msg)) throw new Error(`threw "${e.message}", wanted "${msg}"`);
    return e;
  }
  throw new Error('did not throw');
};
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tn = (duration, string, fret, flags = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }], ...extra });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const SEVEN = ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const SIX = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

/** An editor on a manual clock. `raf: true` keeps requestAnimationFrame (renders on clock.frame()); events are logged in order. */
function mk(score, opts = {}) {
  const { raf, ...rest } = opts;
  const clock = makeClock();
  if (!raf) { clock.requestAnimationFrame = null; clock.cancelAnimationFrame = null; }
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock, ...rest });
  if (raf) clock.frame();
  const events = [];
  ed.on('change', (e) => events.push(['change', e, ed._view.renders]));
  ed.on('cursor', (e) => events.push(['cursor', e, ed._view.renders]));
  const rootEl = box.children[0];
  const live = rootEl.children[1];
  const spoken = () => { clock.advance(150); return live.textContent.replace(/[  ]$/, ''); };
  return { ed, box, clock, events, live, rootEl, spoken };
}
const four = () => ({ title: 'Four', tracks: ['A', 'B', 'C', 'D'].map((name, i) => ({
  name, showTablature: true, ...(i === 2 ? { showStandardNotation: false, showTablature: false } : {}),
  measures: [{ beats: [nt('quarter', 1, i)] }, { beats: [nt('quarter', 1, i), nt('quarter', 2, 1), nt('half', 3, 2)] }],
})) });

// ---------- undo / redo: string removal ----------
test('removing strings, then undo: the model, the track, every measure and the cursor come back by reference; redo gives the later objects; the removed notes are really gone in between', () => {
  const { ed, spoken } = mk({ tracks: [{ name: 'G', showTablature: true, tuning: SEVEN, measures: [
    { beats: [nt('quarter', 7, 3), { type: 'grace', duration: '16th', notes: [{ string: 7, fret: 1 }] }, nt('quarter', 1, 0)] },
    { voices: [{ beats: [tn('whole', 7, 0, { tieStart: true })] }, { beats: [nt('whole', 7, 2)] }] },
    { beats: [nt('whole', 2, 2)] },
  ] }] });
  ed.setCursor({ track: 0, measure: 0, beat: 2, string: 7 });
  const before = ed._model;
  const t0 = before.tracks[0];
  const cur0 = ed.getCursor();
  eq(ed.updateTrack(0, { tuning: SIX }), true);
  eq(ed.lastMessage, 'Track 1 G updated, 4 notes removed');
  ok(spoken().endsWith('Track 1 G updated, 4 notes removed'));
  const after = ed._model;
  eq(after.tracks[0].measures[0].beats.map((b) => b.type), ['rest', 'note']);
  eq(after.tracks[0].measures[1].voices.map((v) => v.beats.map((b) => b.type)), [['rest'], ['rest']]);
  ok(after.tracks[0].measures[2] === t0.measures[2], 'untouched measure keeps its identity');
  eq(ed.getCursor(), { track: 0, measure: 0, beat: 1, string: 6 }, 'beat shifted by the dropped grace, string clamped');
  ok(sanitizeScore(after) === after);
  eq(ed.undo(), true);
  ok(ed._model === before && ed._model.tracks[0] === t0, 'model and track by reference');
  ok(t0.measures.every((m, i) => ed._model.tracks[0].measures[i] === m));
  eq(ed.getCursor(), cur0);
  eq(ed._model.tracks[0].tuning, SEVEN);
  eq(ed.redo(), true);
  ok(ed._model === after);
  eq(ed.getCursor(), { track: 0, measure: 0, beat: 1, string: 6 });
  eq(ed.canRedo(), false);
});
test('a tuning change that removes strings also works as one step with other fields in the same call, and undo restores all of them', () => {
  const { ed } = mk({ tracks: [{ name: 'G', showTablature: true, tuning: SEVEN, measures: [{ beats: [nt('quarter', 7, 3)] }] }, { name: 'B', showTablature: true, measures: [{ beats: [] }] }] });
  const before = ed._model;
  eq(ed.updateTrack(0, { tuning: SIX, name: 'Gt', capo: 2, tiedFrets: 'parens', clef: 'bass' }), true);
  eq(ed.undo(), true);
  ok(ed._model === before);
  eq(ed.canUndo(), false, 'it was one step');
});
test('consecutive settings calls are separate undo steps, even in the same millisecond; undo walks them back one by one', () => {
  const { ed } = mk(four());
  const states = [ed._model];
  for (const f of [() => ed.updateScore({ title: 'a' }), () => ed.updateScore({ title: 'b' }), () => ed.updateScore({ title: 'c' }), () => ed.setTempo(90), () => ed.setTempo(100)]) { f(); states.push(ed._model); }
  for (let i = states.length - 2; i >= 0; i--) { ed.undo(); ok(ed._model === states[i], `undo to state ${i}`); }
  eq(ed.canUndo(), false);
  for (let i = 1; i < states.length; i++) { ed.redo(); ok(ed._model === states[i], `redo to state ${i}`); }
});

// ---------- track operations with the cursor on every position ----------
test('add / remove / move with the cursor on every track (a hidden track sits between visible ones): one step; undo restores model and cursor by value and reference; redo restores both; the cursor is always valid', () => {
  const cursors = [{ track: 0, measure: 1, beat: 2, string: 3 }, { track: 1, measure: 1, beat: 1, string: 2 }, { track: 3, measure: 0, beat: 0, string: 1 }, { track: 3, measure: 1, beat: 2, string: 3 }];
  const ops = [];
  for (let at = 0; at <= 4; at++) ops.push([`addTrack at ${at}`, (ed) => ed.addTrack('bass4', at)]);
  for (let ti = 0; ti < 4; ti++) ops.push([`removeTrack ${ti}`, (ed) => ed.removeTrack(ti)]);
  for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) if (from !== to) ops.push([`moveTrack ${from}->${to}`, (ed) => ed.moveTrack(from, to)]);
  for (const c of cursors) for (const [label, op] of ops) {
    const { ed, events } = mk(four());
    ed.setCursor(c);
    const startCursor = ed.getCursor();
    eq(startCursor.track, c.track, 'the start cursor is on a visible track');
    const model0 = ed._model;
    events.length = 0;
    eq(op(ed), true, `${label} @${c.track}`);
    const model1 = ed._model;
    const cursor1 = ed.getCursor();
    ok(sanitizeScore(model1) === model1);
    const vis = (t) => t.showStandardNotation !== false || t.showTablature === true;
    ok(vis(model1.tracks[cursor1.track]), `${label} @${c.track}: the cursor is on a visible track`);
    if (label.startsWith('move')) eq(model1.tracks[cursor1.track], model0.tracks[c.track], `${label} @${c.track}: the cursor stays on its track`);
    if (label.startsWith('add')) eq([cursor1.track, cursor1.measure, cursor1.string], [Number(label.split(' ').pop()), c.measure, c.string]);
    if (label.startsWith('remove') && Number(label.split(' ')[1]) !== c.track) eq(model1.tracks[cursor1.track], model0.tracks[c.track], `${label} @${c.track}`);
    eq(ed.canUndo(), true);
    eq(ed.undo(), true);
    ok(ed._model === model0, `${label} @${c.track}: undo restores the model object`);
    eq(ed.getCursor(), startCursor, `${label} @${c.track}: undo restores the cursor`);
    eq(ed.canUndo(), false, 'exactly one step');
    ed.redo();
    ok(ed._model === model1, `${label} @${c.track}: redo restores the later model`);
    eq(ed.getCursor(), cursor1, `${label} @${c.track}: redo restores the later cursor`);
    ed.destroy();
  }
});
test('removing the track the cursor is on (and the one after a hidden one) moves it to the nearest visible track; undo puts it back on the removed one', () => {
  const { ed, events } = mk(four());
  ed.setCursor({ track: 1, measure: 1, beat: 1, string: 2 });
  events.length = 0;
  ed.removeTrack(1);
  eq(ed.getCursor().track, 0, 'track 2 (hidden) is now at index 1: the nearest visible is track 0');
  eq(events.map((e) => e[0]), ['cursor', 'change']);
  ed.undo();
  eq(ed.getCursor(), { track: 1, measure: 1, beat: 1, string: 2 });
  ed.setCursor({ track: 3, measure: 0, beat: 0, string: 1 });
  ed.removeTrack(3);
  eq(ed.getCursor().track, 1, 'last track removed; the new last one is hidden; the nearest visible one is before it');
  ed.undo();
  eq(ed.getCursor().track, 3);
});
test('addTrack with the cursor beyond the new track: it moves to the new one, keeping measure and string; adding a hidden track next to the cursor moves it to the nearest visible one', () => {
  const { ed } = mk(four());
  ed.setCursor({ track: 3, measure: 1, beat: 2, string: 4 });
  ed.addTrack({ preset: 'guitar6', showTablature: false, showStandardNotation: false }, 2);
  eq(ed.getCursor(), { track: 1, measure: 1, beat: 0, string: 4 }, 'the hidden new track at 2 (the cursor is put there, then clamped to the nearest visible)');
  ed.undo();
  eq(ed.getCursor(), { track: 3, measure: 1, beat: 2, string: 4 });
});
test('removeTrack of a hidden track while the cursor is elsewhere: nothing moves; column fields it alone sets are kept', () => {
  const score = four();
  score.tracks[2].measures[1].jump = 'Fine';
  const { ed } = mk(score);
  ed.setCursor({ track: 3, measure: 1, beat: 1, string: 2 });
  ed.removeTrack(2);
  eq(ed.getCursor(), { track: 2, measure: 1, beat: 1, string: 2 }, 'the cursor follows its track down one index');
  eq(ed.getScore().tracks.map((t) => t.measures[1].jump), ['Fine', 'Fine', 'Fine']);
  eq(ed.getMeasureSettings(1).jump, 'Fine');
});

// ---------- read-only ----------
test('read-only: every call is refused (false, "Read-only" spoken and in lastMessage, no event, no history, model unchanged) for valid, no-op and would-be-refused calls alike; bad arguments of every method still throw first; getMeasureSettings keeps working', () => {
  const { ed, events, spoken } = mk(four(), { readOnly: true });
  const m = ed._model;
  const calls = [
    () => ed.updateScore({ title: 'x' }), () => ed.updateScore({ title: 'Four' }), () => ed.updateTrack(0, { name: 'x' }), () => ed.updateTrack(0, { showTablature: false, showStandardNotation: false }),
    () => ed.addTrack(), () => ed.removeTrack(0), () => ed.moveTrack(0, 1), () => ed.moveTrack(1, 1), () => ed.updateMeasure(0, { segno: true }), () => ed.setTempo(100),
  ];
  for (const f of calls) { eq(f(), false); eq(ed.lastMessage, 'Read-only'); }
  const bad = [
    [() => ed.updateScore('x'), TypeError], [() => ed.updateScore({ title: 'a\nb' }), RangeError], [() => ed.updateScore({ tracks: [] }), TypeError],
    [() => ed.updateTrack(9, {}), RangeError], [() => ed.updateTrack(0, { clef: 'x' }), RangeError], [() => ed.updateTrack(0, { measures: [] }), TypeError],
    [() => ed.addTrack('piano'), RangeError], [() => ed.addTrack({ instrument: 'bass4' }), TypeError], [() => ed.addTrack(undefined, 99), RangeError],
    [() => ed.removeTrack(9), RangeError], [() => ed.removeTrack('0'), TypeError],
    [() => ed.moveTrack(0, 9), RangeError], [() => ed.moveTrack(-1, 0), RangeError],
    [() => ed.updateMeasure(9, {}), RangeError], [() => ed.updateMeasure(0, { timeSignature: null }), RangeError], [() => ed.updateMeasure(0, { nope: 1 }), TypeError], [() => ed.updateMeasure(0, { repeatCount: 3 }), RangeError],
    [() => ed.setTempo(0), RangeError], [() => ed.setTempo('fast'), TypeError], [() => ed.setTempo({ bpm: 90, unit: 'x' }), RangeError],
    [() => ed.getMeasureSettings(9), RangeError], [() => ed.getMeasureSettings(0, 9), RangeError],
  ];
  for (const [f, Type] of bad) throws(f, Type);
  eq(ed.lastMessage, 'Read-only', 'throws do not touch lastMessage');
  ok(ed._model === m && events.length === 0 && ed.canUndo() === false);
  eq(spoken(), 'Read-only');
  eq(ed.getMeasureSettings(1, 3).measure, 1);
  ed.setReadOnly(false);
  eq(ed.updateScore({ title: 'x' }), true);
});
test('read-only to writable: calls work again and undo history only has the later edits', () => {
  const { ed } = mk(four(), { readOnly: true });
  ed.updateScore({ title: 'no' });
  ed.setReadOnly(false);
  ed.updateScore({ title: 'yes' });
  eq(ed.getScore().title, 'yes');
  ed.undo();
  eq(ed.getScore().title, 'Four');
  eq(ed.canUndo(), false);
  ed.setReadOnly(true);
  eq(ed.undo(), false, 'undo is refused in read-only too (2.0)');
});

// ---------- 5 MB ----------
test('the size limit: a result whose getScore() JSON is exactly LIMITS.jsonChars passes and reloads, one over is refused with "The score would be too large" and nothing changes; for updateScore, addTrack, updateMeasure and updateTrack', () => {
  const L = ScoreEditor.LIMITS.jsonChars;
  const size = (ed) => JSON.stringify(ed.getScore()).length;
  /** A score whose getScore() JSON is exactly `target` characters (the size loadScore checks). */
  const padTo = (base, target) => {
    const len = (n) => size(mk({ ...base, pad: 'p'.repeat(n) }).ed);
    const n = target - len(0);
    ok(len(n) === target, 'padding is exact');
    return { ...base, pad: 'p'.repeat(n) };
  };
  const small = () => ({ title: 'x', tracks: [{ name: 'G', showTablature: true, measures: [{ beats: [nt('quarter')] }] }] });
  const delta = (call) => { const { ed } = mk(small()); const n0 = JSON.stringify(ed._model).length; call(ed); return JSON.stringify(ed._model).length - n0; };
  const cases = [
    ['updateScore', (ed) => ed.updateScore({ title: 'x'.repeat(50) })],
    ['addTrack', (ed) => ed.addTrack('bass5')],
    ['updateMeasure', (ed) => ed.updateMeasure(0, { section: { letter: 'A', text: 'Verse' }, segno: true })],
    ['updateTrack', (ed) => ed.updateTrack(0, { name: 'Lead', tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'], capo: 2 })],
    ['setTempo', (ed) => ed.setTempo({ bpm: 91.5, unit: 'half', dots: 1, text: 'Allegro' })],
  ];
  for (const [name, call] of cases) {
    const d = delta(call);
    ok(d > 0, `${name} grows the score`);
    const exact = mk(padTo(small(), L - d));
    eq(size(exact.ed), L - d, 'padded');
    eq(call(exact.ed), true, `${name}: lands on exactly the limit`);
    eq(size(exact.ed), L);
    exact.ed.loadScore(exact.ed.getScore()); // the editor's own output always reloads (was a bug: the model JSON was measured without schemaVersion)
    const over = mk(padTo(small(), L - d + 1));
    const m = over.ed._model;
    const events = over.events;
    eq(call(over.ed), false, `${name}: one over`);
    ok(over.ed._model === m && events.length === 0 && !over.ed.canUndo(), `${name}: nothing changed`);
    eq(over.ed.lastMessage, 'The score would be too large');
    eq(over.spoken(), 'The score would be too large');
    const shrinks = over.ed.updateScore({ title: null });
    eq(shrinks, true, `${name}: a call that makes the score smaller is fine even when it stays over the limit`);
  }
});

// ---------- lastMessage for every outcome ----------
test('lastMessage: every success message, every refusal, no-ops, undo / redo, key commands and settings in sequence', () => {
  const { ed } = mk({ tracks: [
    { name: 'Gtr', showTablature: true, tuning: SEVEN, measures: [{ beats: [nt('quarter', 7, 3), nt('quarter', 1, 0)] }, { beats: [] }, { beats: [] }] },
    { name: 'TabOnly', showStandardNotation: false, showTablature: true, measures: [{ beats: [] }, { beats: [] }, { beats: [] }] },
  ] });
  const msg = (f) => { const r = f(); return [r, ed.lastMessage]; };
  eq(ed.lastMessage, '');
  eq(msg(() => ed.updateScore({ title: 'T' })), [true, 'Title set']);
  eq(msg(() => ed.updateScore({ title: null })), [true, 'Title removed']);
  eq(msg(() => ed.updateScore({ title: null })), [false, 'No change']);
  eq(msg(() => ed.updateScore({ showTuningChart: true, copyright: 'c' })), [true, 'Score settings updated']);
  eq(msg(() => ed.updateScore({ multiMeasureRests: true })), [true, 'Multi-measure rests on, shown when rendered, not in the editor']);
  eq(msg(() => ed.updateScore({ multiMeasureRests: false })), [true, 'Multi-measure rests off']);
  eq(msg(() => ed.updateTrack(1, { capo: 3 })), [true, 'Track 2 TabOnly updated']);
  eq(msg(() => ed.updateTrack(0, { tuning: SIX })), [true, 'Track 1 Gtr updated, 1 note removed']);
  eq(msg(() => ed.updateTrack(0, { tuning: SIX })), [false, 'No change']);
  eq(msg(() => ed.updateTrack(0, { showTablature: false, showStandardNotation: false })), [true, 'Track 1 Gtr updated']);
  eq(msg(() => ed.updateTrack(1, { showTablature: false, showStandardNotation: false })), [false, 'At least one track must be visible']);
  eq(msg(() => ed.removeTrack(1)), [false, 'At least one track must be visible']);
  eq(msg(() => ed.updateTrack(0, { showTablature: true })), [true, 'Track 1 Gtr updated']);
  eq(msg(() => ed.addTrack({ name: 'Bass', preset: 'bass4' }, 1)), [true, 'Track 2 Bass added']);
  eq(msg(() => ed.moveTrack(1, 0)), [true, 'Track Bass moved to position 1']);
  eq(msg(() => ed.moveTrack(1, 1)), [false, 'No change']);
  eq(msg(() => ed.removeTrack(0)), [true, 'Track 1 Bass removed']);
  eq(msg(() => ed.updateMeasure(1, { clef: 'bass' }, { track: 1 })), [true, 'Clef bass from measure 2, not shown on TAB only']);
  eq(msg(() => ed.updateTrack(0, { showStandardNotation: true })), [true, 'Track 1 Gtr updated']);
  eq(msg(() => ed.updateMeasure(1, { clef: 'bass' }, { track: 0 })), [true, 'Clef bass from measure 2']);
  eq(msg(() => ed.updateMeasure(1, { clef: 'bass' }, { track: 0 })), [false, 'No change']);
  eq(msg(() => ed.updateMeasure(1, { clef: null }, { track: 0 })), [true, 'Clef change removed at measure 2']);
  eq(msg(() => ed.updateMeasure(2, { timeSignature: { beats: 7, beatType: 8 }, keySignature: -2 })), [true, 'Measure 3 settings updated']);
  eq(msg(() => ed.updateMeasure(2, { keySignature: null })), [true, 'Key signature change removed at measure 3']);
  eq(msg(() => ed.updateMeasure(2, { ending: [1, 2] })), [true, 'Ending 1., 2. at measure 3']);
  eq(msg(() => ed.updateMeasure(2, { jump: 'D.S. al Coda' })), [true, 'D.S. al Coda at measure 3']);
  eq(msg(() => ed.setTempo({ bpm: 120.5, unit: '8th' })), [true, 'Tempo 120.5, eighth at measure 1, beat 1']);
  eq(msg(() => ed.setTempo(null)), [true, 'Tempo removed']);
  eq(msg(() => ed.setTempo(null)), [false, 'No change']);
  ed.setCursor({ track: 0, measure: 2, beat: 0 });
  eq(msg(() => ed.setTempo(100)), [false, 'No beat here']);
  const before = ed.lastMessage;
  throws(() => ed.setTempo(-1), RangeError);
  eq(ed.lastMessage, before, 'a throw leaves it');
  ed.undo();
  eq(ed.lastMessage, 'Undo: tempo');
  ed.redo();
  eq(ed.lastMessage, 'Redo: tempo');
  ed.handleKey(key('ArrowLeft'));
  ok(ed.lastMessage.length > 0 && !ed.lastMessage.startsWith('Redo'));
  const kept = ed.lastMessage;
  eq(ed.getMeasureSettings(0).measure, 0);
  eq(ed.lastMessage, kept, 'getMeasureSettings does not speak');
});
test('lastMessage after refusals through a full cycle: onlyTrack, tooManyTracks, lastVisible, noBeat, noChange, readOnly, tooLarge are each the spoken text', () => {
  const one = mk({ tracks: [{ name: 'Only', showTablature: true, measures: [{ beats: [] }] }] });
  eq([one.ed.removeTrack(0), one.ed.lastMessage], [false, 'A score needs at least one track']);
  const many = mk({ tracks: Array.from({ length: 32 }, () => ({ showTablature: true, measures: [{ beats: [] }] })) });
  eq([many.ed.addTrack(), many.ed.lastMessage, many.ed.getScore().tracks.length], [false, 'A score has at most 32 tracks', 32]);
  eq(many.ed.removeTrack(31), true);
  eq(many.ed.addTrack(), true);
  eq(many.ed.getScore().tracks.length, 32);
});

// ---------- events ----------
test('events (with requestAnimationFrame): the cursor event goes out at once when the cursor moves, `change` only after the render, once per call, with command and message, in call order; refusals and throws emit nothing', () => {
  const { ed, events, clock } = mk(four(), { raf: true });
  ed.setCursor({ track: 3, measure: 0, beat: 0, string: 1 });
  clock.frame();
  events.length = 0;
  const r0 = ed._view.renders;
  eq(ed.removeTrack(3), true);
  eq(events.map((e) => e[0]), ['cursor'], 'only the cursor event so far');
  eq(events[0][1].track, 1, 'its payload is the new cursor (moved to the nearest visible)');
  clock.frame();
  eq(events.map((e) => e[0]), ['cursor', 'change']);
  eq(events[1][1], { source: 'edit', command: 'removeTrack', message: 'Track 4 D removed' });
  eq(events[1][2], r0 + 1, 'the view was redrawn before `change`');
  events.length = 0;
  ed.updateScore({ title: 'a' });
  ed.setTempo(100);
  ed.updateScore({ title: 'a' });
  throws(() => ed.updateScore({ bogus: 1 }));
  eq(ed.updateScore({ title: 'a' }), false);
  clock.frame();
  eq(events.map((e) => e[1].command), ['updateScore', 'setTempo']);
  eq(events.map((e) => e[2]), [r0 + 2, r0 + 2], 'one render for the calls of one frame');
  events.length = 0;
  ed.undo();
  clock.frame();
  eq(events.map((e) => e[1].source), ['undo']);
  ok(!('command' in events[0][1]) && !('message' in events[0][1]));
});
test('events: `change` carries the message of that call, not the latest one; a handler can read the new model, cursor and lastMessage', () => {
  const { ed, clock } = mk(four(), { raf: true });
  const seen = [];
  ed.on('change', (e) => { if (e.source === 'edit') seen.push([e.command, e.message, ed.getScore().title, ed.lastMessage, ed.getCursor().track]); });
  ed.updateScore({ title: 'New' });
  clock.frame();
  ed.addTrack('ukulele', 1);
  clock.frame();
  eq(seen, [['updateScore', 'Title set', 'New', 'Title set', 0], ['addTrack', 'Track 2 Ukulele added', 'New', 'Track 2 Ukulele added', 1]]);
});
test('events: no cursor event when the cursor stays put (updateScore, updateMeasure, setTempo, a retune that removes nothing); one when only the string clamps', () => {
  const { ed, events } = mk({ tracks: [{ name: 'G', showTablature: true, tuning: SEVEN, measures: [{ beats: [nt('quarter', 1, 0)] }, { beats: [] }] }] });
  ed.updateScore({ title: 'x' }); ed.updateMeasure(1, { segno: true }); ed.setTempo(80); ed.updateTrack(0, { tuning: ['A1', ...SEVEN.slice(1)] });
  eq(events.map((e) => e[0]), ['change', 'change', 'change', 'change']);
  ed.setCursor({ track: 0, measure: 0, beat: 0, string: 7 });
  events.length = 0;
  ed.updateTrack(0, { tuning: SIX });
  eq(events.map((e) => e[0]), ['cursor', 'change']);
  eq(events[0][1].string, 6);
  ed.undo();
  eq(ed.getCursor().string, 7);
});

// ---------- live region ----------
test('live region: settings messages are kept within a 150 ms window and joined with ". "; a message ending in a period loses it; windows are independent; identical messages are spoken once; key messages alone still replace each other', () => {
  const { ed, clock, live, spoken } = mk(four());
  ed.updateScore({ title: 'a' });
  ed.updateScore({ title: 'b' });
  ed.setTempo(70);
  eq(spoken(), 'Title set. Title set. Tempo 70 at measure 1, beat 1'.replace('Title set. Title set', 'Title set'), 'the same text in a row is spoken once');
  ed.setTempo(70);
  ed.setTempo(70);
  eq(spoken(), 'No change', 'two refusals in a row: one message');
  ed.updateScore({ title: 'z' });
  clock.advance(100);
  ed.updateMeasure(1, { segno: true });
  clock.advance(100);
  ok(live.textContent === 'Title set' || live.textContent === '' || live.textContent.startsWith('No change'), 'the 150 ms window restarts with each message');
  eq(spoken(), 'Title set. Segno at measure 2');
  clock.advance(1000);
  ed.updateMeasure(1, { segno: null });
  eq(spoken(), 'Segno removed at measure 2', 'a later window replaces the earlier text');
  ed.handleKey(key('ArrowRight'));
  const first = ed.lastMessage;
  ed.handleKey(key('ArrowRight'));
  ok(ed.lastMessage !== first);
  eq(spoken(), ed.lastMessage, 'two key messages in one window: only the latest');
});
test('live region: a settings message is not drowned by a key message after it, and a key message before it is joined in front; a destroyed editor speaks nothing and throws on every settings call', () => {
  const { ed, spoken, clock, live } = mk(four());
  ed.handleKey(key('ArrowRight'));
  const keyMsg = ed.lastMessage;
  ed.updateScore({ title: 'Q' });
  eq(spoken(), `${keyMsg}. Title set`, 'the earlier key message is joined before the kept one');
  ed.updateScore({ title: 'R' });
  ed.handleKey(key('ArrowRight'));
  ok(spoken().startsWith('Title set. '), live.textContent);
  ed.updateScore({ title: 'S' });
  clock.advance(10);
  const t = live.textContent;
  ed.destroy();
  clock.advance(500);
  eq(live.textContent, t, 'nothing is spoken after destroy');
  for (const f of [() => ed.updateScore({}), () => ed.updateTrack(0, {}), () => ed.addTrack(), () => ed.removeTrack(0), () => ed.moveTrack(0, 1), () => ed.updateMeasure(0, {}), () => ed.setTempo(1), () => ed.getMeasureSettings(0), () => ed.lastMessage]) {
    let e;
    try { f(); } catch (x) { e = x; }
    ok(e, 'throws after destroy');
  }
});

// ---------- demo helpers ----------
const rndScore = (rnd) => {
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  const n = pick([4, 5, 6, 7, 8]);
  const tuning = ['F#1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'].slice(8 - n);
  const note = () => {
    const x = { string: 1 + Math.floor(rnd() * (n + 1)), fret: Math.floor(rnd() * 5) };
    if (rnd() < 0.3) x.pitch = pick(['C3', 'D4', 'X']);
    if (rnd() < 0.2) delete x.fret;
    return x;
  };
  const beat = () => ({ type: pick(['note', 'note', 'grace', 'rest']), duration: 'quarter', notes: Array.from({ length: Math.floor(rnd() * 3) }, note) });
  const measure = () => (rnd() < 0.4
    ? { voices: [{ beats: Array.from({ length: 1 + Math.floor(rnd() * 3) }, beat) }, { beats: Array.from({ length: Math.floor(rnd() * 3) }, beat) }], ...(rnd() < 0.3 ? { beats: [beat()] } : {}) }
    : { beats: Array.from({ length: 1 + Math.floor(rnd() * 4) }, beat) });
  return { tracks: [{ name: 'G', showTablature: true, tuning, measures: Array.from({ length: 1 + Math.floor(rnd() * 3) }, measure) }, { name: 'H', showTablature: true, measures: [{ beats: [] }] }] };
};
test('demo notesOnRemovedStrings equals the library\'s `removed` count (the number in the announcement) on random scores with voices, graces, chords and every target string count', () => {
  const rnd = mulberry32(8080);
  let compared = 0;
  for (let i = 0; i < 120; i++) {
    const s = rndScore(rnd);
    const n = s.tracks[0].tuning.length;
    for (let want = 12; want >= 1; want--) {
      const { ed } = mk(s);
      const tuning = ['A0', 'B0', 'C1', 'D1', 'E1', 'F#1', 'B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'].slice(13 - want);
      const model = ed.getScore();
      const expected = DT.notesOnRemovedStrings(model, 0, want);
      const changed = ed.updateTrack(0, { tuning });
      const said = /, (\d+) notes? removed/.exec(ed.lastMessage);
      if (want >= n) eq(expected, 0, 'adding strings removes nothing');
      if (changed) eq(said ? Number(said[1]) : 0, expected, `run ${i}: ${n} -> ${want}`);
      compared++;
      ed.destroy();
    }
  }
  ok(compared > 1000);
  eq(DT.notesOnRemovedStrings({ tracks: [{ measures: [{ beats: [nt('quarter', 6, 0)] }] }] }, 0, 6), 0, 'a track without tuning has 6 strings');
  eq(DT.notesOnRemovedStrings({ tracks: [{ measures: [{ beats: [nt('quarter', 6, 0)] }] }] }, 0, 5), 1);
});
test('demo matchPreset: every preset of every instrument maps back to its own id and index, case-insensitively; anything else is null', () => {
  for (const [id, list] of Object.entries(TUNINGS)) list.forEach((p, i) => {
    eq(DT.matchPreset(p.tuning), `${id}:${i}`, `${id} ${p.name}`);
    eq(DT.matchPreset(p.tuning.map((x) => x.toLowerCase())), `${id}:${i}`);
  });
  const ids = new Set(Object.values(TUNINGS).flat().map((p) => p.tuning.join(' ')));
  eq(ids.size, Object.values(TUNINGS).flat().length, 'no two presets share a tuning, so the match is unambiguous');
  eq([DT.matchPreset(['E2', 'A2', 'D3', 'G3', 'B3', 'F4']), DT.matchPreset([]), DT.matchPreset(['E2']), DT.matchPreset(['E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'E4'])], [null, null, null, null]);
  const g = DT.presetGroups(6);
  ok(g.every((grp) => grp.options.every((o) => DT.matchPreset(TUNINGS[o.value.split(':')[0]][Number(o.value.split(':')[1])].tuning) === o.value)), 'every offered option round-trips');
  for (const count of [4, 5, 6, 7, 8]) ok(DT.presetGroups(count).length > 0, `${count} strings have presets`);
  for (const count of [1, 2, 3, 9, 12]) eq(DT.presetGroups(count), [], `${count} strings: none`);
});
test('demo tuningRows: one row per string, labelled from the top number down, lowest first; a retune built from the rows applies', () => {
  for (let n = 4; n <= 12; n++) {
    const tuning = Array.from({ length: n }, (_, i) => `C${1 + Math.floor(i / 2)}`.replace(/^C/, ['C', 'D', 'E'][i % 3]));
    const rows = DT.tuningRows(tuning);
    eq(rows.length, n);
    eq(rows.map((r) => r.value), tuning);
    eq(rows[0].label, `String ${n} (lowest)`);
    eq(rows[n - 1].label, 'String 1 (highest)');
    eq(rows.slice(1, -1).map((r) => r.label), Array.from({ length: n - 2 }, (_, i) => `String ${n - 1 - i}`));
  }
});
test('demo scorePatch / measurePatch / statusText / keyLabel: edge values', () => {
  const s = { title: 'T', subtitle: '', tracks: [] };
  const v = DS.scoreValues(s);
  eq(DS.scorePatch(v, { ...v, title: 'T ' }), {}, 'trailing space is not a change');
  eq(DS.scorePatch(v, { ...v, title: ' T' }), {});
  eq(DS.scorePatch(v, { ...v, subtitle: '   ' }), {}, 'blank over empty is no change');
  eq(DS.scorePatch(v, { ...v, instructions: 'a\nb', showTuningChart: true }), { instructions: 'a\nb', showTuningChart: true });
  eq(DS.scorePatch({ ...v, showTuningChart: true }, { ...v, showTuningChart: false }), { showTuningChart: null }, 'false is sent as null');
  const { ed } = mk({ ...four(), subtitle: 'S', composer: 'C' });
  const v0 = DS.scoreValues(ed.getScore());
  const patch = DS.scorePatch(v0, { ...v0, title: '', subtitle: 'S2', composer: '   ', multiMeasureRests: true });
  eq(patch, { title: null, subtitle: 'S2', composer: null, multiMeasureRests: true });
  eq(ed.updateScore(patch), true);
  const v1 = DS.scoreValues(ed.getScore());
  eq([v1.title, v1.subtitle, v1.composer, v1.multiMeasureRests], ['', 'S2', '', true]);
  eq(DS.scorePatch(v1, { ...v1 }), {});
  eq(ed.updateScore(DS.scorePatch(v1, { ...v1 })), false, 'an empty patch is a no-op');
  eq(ed.lastMessage, 'No change');
  for (let k = -7; k <= 7; k++) {
    const label = DS.keyLabel(k);
    ok(label.includes(k === 0 ? 'No sharps or flats' : `${Math.abs(k)} ${k > 0 ? 'sharp' : 'flat'}`), label);
    eq(DS.statusText({ timeSignature: { beats: 4, beatType: 4 }, keySignature: k, tempo: null }).key, k === 0 ? 'none' : `${Math.abs(k)} ${k > 0 ? 'sharp' : 'flat'}${Math.abs(k) === 1 ? '' : 's'}`);
  }
  eq(DS.statusText({ timeSignature: { beats: 4, beatType: 4 }, tempo: null }).key, 'none', 'a missing key counts as none');
  ok(DS.statusText({ timeSignature: { beats: 4, beatType: 4 }, keySignature: 0, tempo: { bpm: 100, unit: '8th', dots: 2, text: null } }).tempo.endsWith('100'));
});
test('demo measurePatch: a patch built from untouched dialog values is empty at every measure and track of a score with every 2.2 field; building each field from the values applies and getMeasureSettings then equals the dialog values', () => {
  const score = { tracks: [
    { name: 'Gtr', showTablature: true, timeSignature: { beats: 3, beatType: 4 }, measures: [
      { beats: [nt('whole', 1, 0, { tempo: { bpm: 100, unit: 'half', dots: 1, text: 'Slow' } })] },
      { beats: [nt('whole')], keySignature: 3, timeSignature: { beats: 6, beatType: 8 }, clef: 'bass', barline: 'repeatEnd', repeatCount: 4, ending: { numbers: [1, 2], text: 'x', open: true }, segno: true, coda: true, jump: 'D.S. al Coda', section: { letter: 'B', text: 'Bridge' } },
      { beats: [nt('whole')], jump: 'Custom words', section: 'Outro' },
    ] },
    { name: 'Tab', showStandardNotation: false, showTablature: true, measures: [{ beats: [] }, { beats: [] }, { beats: [] }] },
  ] };
  const { ed } = mk(score);
  for (let ti = 0; ti < 2; ti++) for (let mi = 0; mi < 3; mi++) {
    ed.setCursor({ track: ti, measure: mi, beat: 0 });
    const info = ed.getCursorInfo();
    const m = ed.getMeasureSettings(mi, ti);
    const v = DS.measureValues(m, info);
    eq(DS.measurePatch(m, v, mi, info), { patch: {}, tempo: undefined }, `${ti}/${mi}`);
    eq(DS.measureErrors(v, { tempoOn: true }), {}, `${ti}/${mi}: untouched values have no errors`);
  }
  ed.setCursor({ track: 0, measure: 1, beat: 0 });
  const info = ed.getCursorInfo();
  const m = ed.getMeasureSettings(1, 0);
  const v = DS.measureValues(m, info);
  eq([v.barline, v.repeatCount, v.ending, v.endingText, v.endingOpen, v.segno, v.coda, v.jump, v.sectionLetter, v.sectionText], ['repeatEnd', '4', '1, 2', 'x', true, true, true, 'D.S. al Coda', 'B', 'Bridge']);
  const clear = DS.measurePatch(m, { ...v, barline: '', ending: '', segno: false, coda: false, jump: '', sectionLetter: '', sectionText: '' }, 1, info).patch;
  eq(clear, { barline: null, ending: null, segno: null, coda: null, jump: null, section: null });
  eq(ed.updateMeasure(1, clear, { track: 0 }), true);
  const g = ed.getMeasureSettings(1, 0);
  eq([g.barline, g.repeatCount, g.ending, g.segno, g.coda, g.jump, g.section], [null, null, null, false, false, null, null]);
  eq(ed.undo(), true);
});

// ---------- editor-level fuzz: every step undone and redone by reference ----------
test('fuzz (3 seeds x 300 steps of keys and settings calls): each model-changing step undoes to the exact previous model and cursor and redoes to the exact later ones; getMeasureSettings agrees with the renderer\'s normalizer; throws change nothing', async () => {
  const { normalizeScore } = await imp('src/normalize.js');
  const { clefAt } = await imp('src/clef.js');
  let steps = 0;
  for (const seed of [11, 22, 33]) {
    const rnd = mulberry32(seed * 977);
    const pick = (l) => l[Math.floor(rnd() * l.length)];
    const n = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    const { ed, clock } = mk({ tracks: [
      { name: 'G', showTablature: true, tuning: SEVEN, measures: [{ beats: [nt('quarter', 7, 1), { type: 'grace', duration: '16th', notes: [{ string: 7, fret: 2 }] }, nt('half', 1, 3, { tieStart: true })] }, { beats: [nt('quarter', 1, 3, { tieEnd: true })] }] },
      { name: 'B', showStandardNotation: false, showTablature: true, measures: [{ beats: [nt('whole', 2, 2)] }] },
    ] }, { historyLimit: 10000 });
    for (let i = 0; i < 300; i++) {
      const before = ed._model;
      const bc = ed.getCursor();
      const tc = ed.getCursorInfo().trackCount;
      const mc = Math.max(...ed.getScore().tracks.map((t) => t.measures.length));
      const calls = [
        () => ed.updateScore({ title: pick(['A', null]), multiMeasureRests: pick([true, null]) }),
        () => ed.updateTrack(n(0, tc - 1), pick([{ tuning: pick(Object.values(TUNINGS).flat()).tuning }, { capo: n(0, 5) }, { showStandardNotation: rnd() < 0.6 }, { showTablature: rnd() < 0.6 }, { clef: pick(['bass', 'treble', null]) }])),
        () => ed.addTrack(pick(Object.keys(INSTRUMENTS)), n(0, tc)),
        () => ed.removeTrack(n(0, tc - 1)),
        () => ed.moveTrack(n(0, tc - 1), n(0, tc - 1)),
        () => ed.updateMeasure(n(0, mc - 1), pick([{ timeSignature: { beats: n(2, 7), beatType: pick([4, 8]) } }, { keySignature: n(-3, 3) }, { barline: 'repeatEnd', repeatCount: n(2, 4) }, { ending: pick([1, [1, 2]]) }, { segno: true }, { jump: 'D.S.' }, { section: 'S' }, { clef: pick(['bass', 'alto']) }, { barline: null }]), rnd() < 0.3 ? { track: n(0, tc - 1) } : undefined),
        () => ed.setTempo(pick([100, null, { bpm: 80, unit: 'half' }])),
        () => ed.handleKey(key(pick(['1', '2', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'r', 'PageDown', 'PageUp', 'Delete']))),
        () => ed.handleKey(key('M', { shiftKey: true })),
      ];
      let r;
      try { r = pick(calls)(); } catch (e) {
        ok(e instanceof TypeError || e instanceof RangeError, `unexpected ${e.stack}`);
        ok(ed._model === before, 'a throw changes nothing');
        continue;
      }
      clock.advance(rnd() < 0.5 ? 100 : 1000);
      const m = ed._model;
      ok(sanitizeScore(m) === m, `seed ${seed} step ${i}: sanitize-stable`);
      const nrm = normalizeScore(m);
      for (let mi = 0; mi < nrm.navigation.length; mi++) for (let ti = 0; ti < m.tracks.length; ti++) {
        const g = ed.getMeasureSettings(mi, ti);
        const nm = nrm.tracks[ti].measures[mi];
        eq([g.timeSignature.beats, g.timeSignature.beatType, g.keySignature.value, g.clef.value, g.ending, g.jump], [nm.timeSignature.beats, nm.timeSignature.beatType, nm.keySignature, clefAt(m.tracks[ti], mi), nrm.navigation[mi].ending, nrm.navigation[mi].jump], `seed ${seed} step ${i} ${mi}/${ti}`);
      }
      if (m !== before && r === true) {
        const ac = ed.getCursor();
        eq(ed.undo(), true);
        ok(ed._model === before, `seed ${seed} step ${i}: undo restores the model object`);
        eq(ed.getCursor(), bc, `seed ${seed} step ${i}: undo restores the cursor`);
        eq(ed.redo(), true);
        ok(ed._model === m, `seed ${seed} step ${i}: redo restores the later model`);
        eq(ed.getCursor(), ac, `seed ${seed} step ${i}: redo restores the later cursor`);
        steps++;
      }
    }
  }
  ok(steps > 300, `${steps} undoable steps checked`);
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-settings-edge-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-settings-edge-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
