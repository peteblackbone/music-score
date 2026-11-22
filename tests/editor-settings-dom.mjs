// 2.2.0 editor settings under the DOM shim: the public surface, the controller path of every settings
// call (events, undo, refusals, read-only, throws, digit buffer, hidden tracks), lastMessage, the
// aria-label and the joined announcements.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-settings-dom.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { SETTINGS_API } = await imp('src/editor/settings.js');
const { INSTRUMENTS, TUNINGS } = await imp('src/editor/model/settings/instruments.js');
const { sanitizeScore } = await imp('src/sanitize.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const throws = (fn, Type) => {
  try { fn(); } catch (e) { if (Type && !(e instanceof Type)) throw new Error(`threw ${e.constructor.name}: ${e.message}`); return e; }
  throw new Error('did not throw');
};
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

/** An editor with a manual clock (renders synchronously); events logged in order. */
function mk(score, opts = {}) {
  const clock = makeClock();
  clock.requestAnimationFrame = null; clock.cancelAnimationFrame = null;
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock, ...opts });
  const events = [];
  ed.on('change', (e) => events.push(['change', e]));
  ed.on('cursor', (e) => events.push(['cursor', e]));
  const rootEl = box.children[0];
  const live = rootEl.children[1];
  const spoken = () => { clock.advance(150); return live.textContent.replace(/ $/, ''); };
  return { ed, box, clock, events, live, rootEl, spoken };
}
const fixture = () => ({ title: 'Song', tracks: [
  { name: 'Gtr', showTablature: true, tuning: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'], measures: [
    { beats: [nt('quarter', 1, 5), nt('quarter', 7, 3), nt('half', 2, 1)] },
    { beats: [nt('whole', 1, 0)] },
  ] },
  { name: 'Bass', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'], measures: [{ beats: [nt('whole', 4, 3)] }, { beats: [] }] },
] });

// One changing call per settings method (on fixture(), cursor at track 0, measure 0, beat 0).
const CALLS = [
  ['updateScore', [{ title: 'New title' }], 'score settings', 'Title set'],
  ['updateTrack', [1, { name: 'Low' }], 'track settings', 'Track 2 Low updated'],
  ['addTrack', ['bass4'], 'add track', 'Track 3 Bass 2 added'],
  ['removeTrack', [0], 'remove track', 'Track 1 Gtr removed'],
  ['moveTrack', [0, 1], 'move track', 'Track Gtr moved to position 2'],
  ['updateMeasure', [1, { timeSignature: { beats: 3, beatType: 4 } }], 'measure settings', 'Time signature 3/4 from measure 2'],
  ['setTempo', [96], 'tempo', 'Tempo 96 at measure 1, beat 1'],
];

// ---------- surface ----------
test('surface: the 2.1 public methods plus SETTINGS_API exactly; the new ones are non-enumerable; INSTRUMENTS / TUNINGS static, frozen, the model tables', () => {
  const V21 = ['loadScore', 'getScore', 'toJSON', 'getCursor', 'setCursor', 'getCursorInfo', 'getMeasureFill', 'handleKey', 'setDuration', 'focus',
    'undo', 'redo', 'canUndo', 'canRedo', 'setReadOnly', 'isReadOnly', 'setWidth', 'refresh', 'on', 'off', 'destroy'];
  eq(SETTINGS_API, ['updateScore', 'updateTrack', 'addTrack', 'removeTrack', 'moveTrack', 'updateMeasure', 'setTempo', 'getMeasureSettings', 'lastMessage']);
  const pub = Object.getOwnPropertyNames(ScoreEditor.prototype).filter((n) => n !== 'constructor' && !n.startsWith('_'));
  eq(pub.sort(), [...V21, ...SETTINGS_API].sort());
  for (const n of [...SETTINGS_API, '_settings', '_applyModel']) eq(Object.getOwnPropertyDescriptor(ScoreEditor.prototype, n).enumerable, false, n);
  eq(Object.keys(ScoreEditor.prototype), [], 'nothing enumerable on the prototype');
  ok(ScoreEditor.INSTRUMENTS === INSTRUMENTS && ScoreEditor.TUNINGS === TUNINGS && Object.isFrozen(ScoreEditor.INSTRUMENTS));
  throws(() => { 'use strict'; ScoreEditor.INSTRUMENTS = {}; }, TypeError);
  ok(ScoreEditor.INSTRUMENTS === INSTRUMENTS);
  eq(typeof Object.getOwnPropertyDescriptor(ScoreEditor.prototype, 'lastMessage').get, 'function');
});

// ---------- per method ----------
test('each settings call: returns true, one change event {source, command, message} after any cursor event, undo label, undo / redo restore model and cursor by reference, lastMessage, sanitize-stable', () => {
  for (const [name, args, label, message] of CALLS) {
    const { ed, events, spoken } = mk(fixture());
    const before = ed._model;
    const cursor = ed.getCursor();
    eq(ed[name](...args), true, name);
    const after = ed._model;
    const afterCursor = ed.getCursor();
    ok(after !== before && sanitizeScore(after) === after, `${name}: new sanitize-stable model`);
    const changes = events.filter((e) => e[0] === 'change');
    eq(changes.map((e) => e[1]), [{ source: 'edit', command: name, message }], name);
    const moved = JSON.stringify(cursor) !== JSON.stringify(afterCursor);
    eq(events.map((e) => e[0]), moved ? ['cursor', 'change'] : ['change'], `${name}: event order`);
    eq([ed.lastMessage, spoken()], [message, message], name);
    eq(ed.undo(), true);
    ok(ed._model === before, `${name}: undo restores the model object`);
    eq(ed.getCursor(), cursor, `${name}: undo restores the cursor`);
    eq(spoken(), `Undo: ${label}`, name);
    eq(ed.lastMessage, `Undo: ${label}`);
    ed.redo();
    ok(ed._model === after, `${name}: redo restores the later model`);
    eq(ed.getCursor(), afterCursor, `${name}: redo restores the cursor`);
    eq(ed.canUndo(), true);
    ed.destroy();
  }
});
test('the cursor follows its track through remove and move, and comes back on undo; addTrack moves it to the new track keeping its measure', () => {
  const { ed } = mk(fixture());
  ed.setCursor({ track: 1, measure: 1 });
  ed.moveTrack(1, 0);
  eq(ed.getCursor().track, 0);
  eq(ed.getCursorInfo().trackName, 'Bass');
  ed.removeTrack(1);
  eq(ed.getCursor().track, 0);
  ed.undo();
  eq(ed.getCursor().track, 0);
  ed.addTrack({ preset: 'ukulele', name: 'Uke' }, 1);
  eq([ed.getCursor().track, ed.getCursor().measure, ed.getCursorInfo().trackName], [1, 1, 'Uke']);
  ed.undo();
  eq(ed.getCursor().track, 0);
});
test('refusals and no-ops: false, the reason spoken and in lastMessage, no history, no events, the model untouched', () => {
  const cases = [
    [fixture(), (ed) => ed.updateScore({ title: 'Song' }), 'No change'],
    [fixture(), (ed) => ed.moveTrack(1, 1), 'No change'],
    [{ tracks: [{ name: 'Only', showTablature: true, measures: [{ beats: [] }] }] }, (ed) => ed.removeTrack(0), 'A score needs at least one track'],
    [{ tracks: [{ showTablature: true, measures: [{ beats: [] }] }, { showStandardNotation: false, measures: [{ beats: [] }] }] }, (ed) => ed.updateTrack(0, { showTablature: false, showStandardNotation: false }), 'At least one track must be visible'],
    [{ tracks: [{ showTablature: true, measures: [{ beats: [] }] }, { showStandardNotation: false, measures: [{ beats: [] }] }] }, (ed) => ed.removeTrack(0), 'At least one track must be visible'],
    [{ tracks: Array.from({ length: 32 }, () => ({ showTablature: true, measures: [{ beats: [] }] })) }, (ed) => ed.addTrack(), 'A score has at most 32 tracks'],
    [fixture(), (ed) => { ed.setCursor({ track: 1, measure: 1 }); return ed.setTempo(100); }, 'No beat here'],
  ];
  for (const [score, call, message] of cases) {
    const { ed, events, spoken } = mk(score);
    const n0 = ed._history.size();
    const out = call(ed);
    const before = ed._model;
    eq(out, false, message);
    events.length = 0;
    const again = call(ed);
    eq([again, events.length, ed._model === before], [false, 0, true], message);
    eq(ed.lastMessage, message);
    ok(spoken().endsWith(message), message);
    ok(ed._history.size() <= n0 + 1, message);
    ed.destroy();
  }
  const { ed, events } = mk(fixture());
  eq(ed.updateMeasure(0, { keySignature: 0 }), false, 'key 0 is already in force');
  eq([events.length, ed.canUndo()], [0, false]);
});
test('read-only: every call is refused with "Read-only" (no event, no history); bad arguments still throw; getMeasureSettings works', () => {
  const { ed, events, spoken } = mk(fixture(), { readOnly: true });
  for (const [name, args] of CALLS) {
    const m = ed._model;
    eq(ed[name](...args), false, name);
    ok(ed._model === m);
    eq(ed.lastMessage, 'Read-only');
  }
  eq([events.length, spoken()], [0, 'Read-only']);
  throws(() => ed.updateScore({ bogus: 1 }), TypeError);
  throws(() => ed.updateMeasure(9, {}), RangeError);
  eq(ed.getMeasureSettings(0).timeSignature.beats, 4);
  ed.setReadOnly(false);
  eq(ed.canUndo(), false);
});
test('throws leave no trace: same model, no event, no history, lastMessage unchanged, the digit buffer kept', () => {
  const { ed, events, clock } = mk(fixture());
  ed.handleKey(key('1'));
  events.length = 0;
  const m = ed._model;
  const msg = ed.lastMessage;
  const bad = [() => ed.updateScore({ title: 5 }), () => ed.updateTrack(5, {}), () => ed.addTrack('nope'), () => ed.removeTrack(-1), () => ed.moveTrack(0, 9),
    () => ed.updateMeasure(0, { timeSignature: null }), () => ed.setTempo(-5), () => ed.getMeasureSettings(0, 7)];
  bad.forEach((f) => throws(f));
  ok(ed._model === m && events.length === 0 && ed.lastMessage === msg && ed._history.size() === 1);
  clock.advance(100);
  ed.handleKey(key('2'));
  eq(ed.getScore().tracks[0].measures[0].beats[0].notes[0].fret, 12, 'the buffer survived the throws');
});
test('a settings call cancels a two-digit fret entry (also a refused one); getMeasureSettings does not', () => {
  for (const call of [(ed) => ed.updateScore({ title: 'X' }), (ed) => ed.updateScore({ title: 'Song' }), (ed) => ed.setTempo(80)]) {
    const { ed, clock } = mk(fixture());
    ed.handleKey(key('1'));
    call(ed);
    clock.advance(100);
    ed.handleKey(key('2'));
    eq(ed.getScore().tracks[0].measures[0].beats[0].notes[0].fret, 2);
  }
  const { ed, clock } = mk(fixture());
  ed.handleKey(key('1'));
  ed.getMeasureSettings(0);
  clock.advance(100);
  ed.handleKey(key('2'));
  eq(ed.getScore().tracks[0].measures[0].beats[0].notes[0].fret, 12);
});
test('settings calls work with every track hidden (commands are refused there), and can make a track visible again', () => {
  const { ed } = mk({ tracks: [{ name: 'H', showStandardNotation: false, measures: [{ beats: [nt('whole')] }] }] });
  eq(ed.handleKey(key('5')), true);
  eq(ed.lastMessage, 'No visible track');
  eq(ed.updateScore({ title: 'Hidden' }), true);
  eq(ed.updateMeasure(0, { barline: 'final' }), true);
  eq(ed.setTempo(70), true);
  eq(ed.updateTrack(0, { showTablature: true }), true);
  ed.handleKey(key('5'));
  eq(ed.getScore().tracks[0].measures[0].beats[0].notes[0].fret, 5);
});
test('the score would be too large: refused past LIMITS.jsonChars', () => {
  const base = { title: 'x', tracks: [{ showTablature: true, measures: [{ beats: [] }] }] };
  const pad = ScoreEditor.LIMITS.jsonChars - JSON.stringify({ ...base, pad: '' }).length - 5;
  const { ed, events } = mk({ ...base, pad: 'p'.repeat(pad) });
  eq(ed.updateScore({ title: 'xxxxxxxxxx' }), false);
  eq([ed.lastMessage, events.length], ['The score would be too large', 0]);
  eq(ed.updateScore({ title: 'y' }), true, 'same size is fine');
});

// ---------- aria-label, lastMessage, joined announcements ----------
test('aria-label follows the title at once, and after undo and redo', () => {
  const { ed, rootEl } = mk(fixture());
  eq(rootEl.getAttribute('aria-label'), 'Song');
  ed.updateScore({ title: 'Other' });
  eq(rootEl.getAttribute('aria-label'), 'Other');
  ed.updateScore({ title: null });
  eq(rootEl.getAttribute('aria-label'), 'Untitled score');
  ed.undo();
  eq(rootEl.getAttribute('aria-label'), 'Other');
  ed.undo();
  eq(rootEl.getAttribute('aria-label'), 'Song');
  ed.redo();
  eq(rootEl.getAttribute('aria-label'), 'Other');
  ed.setReadOnly(true);
  eq(rootEl.getAttribute('aria-label'), 'Other, read-only');
});
test('lastMessage: empty at first; key commands and moves set it too', () => {
  const { ed } = mk(fixture());
  eq(ed.lastMessage, '');
  ed.handleKey(key('ArrowRight'));
  eq(ed.lastMessage, 'Beat 2, string 1, empty, quarter');
  ed.handleKey(key('3'));
  eq(ed.lastMessage, 'Fret 3 added, chord of 2');
});
test('R3: settings messages within one 150 ms window are joined with ". "; a later move or key message is added after them (latest only); key messages alone still replace each other', () => {
  const { ed, spoken, clock, live } = mk(fixture());
  ed.updateMeasure(1, { timeSignature: { beats: 3, beatType: 4 } });
  ed.setTempo(100);
  eq(spoken(), 'Time signature 3/4 from measure 2. Tempo 100 at measure 1, beat 1');
  ed.updateScore({ title: 'A' });
  ed.handleKey(key('ArrowRight'));
  ed.handleKey(key('ArrowRight'));
  eq(spoken(), 'Title set. Beat 3, string 1, empty, half');
  ed.handleKey(key('ArrowLeft'));
  ed.handleKey(key('ArrowLeft'));
  eq(spoken(), 'Beat 1, string 1, fret 5, quarter');
  ed.handleKey(key('Delete', { ctrlKey: true }));
  ed.updateScore({ title: 'B' });
  clock.advance(149);
  eq(live.textContent, 'Beat 1, string 1, fret 5, quarter', 'nothing before 150 ms of quiet');
  clock.advance(1);
  ok(/^Beat deleted\. Beat 1, .*\. Title set$/.test(live.textContent), live.textContent);
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-settings-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-settings-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
