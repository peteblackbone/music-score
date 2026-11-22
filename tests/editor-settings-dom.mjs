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

// ---------- G1 / G2: what the settings write renders ----------
const { MusicScoreRenderer } = await imp('src/MusicScoreRenderer.js');
const walk = (n, f, out = []) => { if (f(n)) out.push(n); n.children.forEach((c) => walk(c, f, out)); return out; };
const classes = (n) => (n.getAttribute?.('class') || '').split(' ');
const renderScore = (score) => { const box = makeContainer(); new MusicScoreRenderer(box, score, { width: 1400 }).render(); return box.children[0]; };
const countClass = (svg, cls) => walk(svg, (n) => classes(n).includes(cls)).length;
const texts = (svg) => walk(svg, (n) => n.tag === 'text').map((n) => n.textContent);
test('G1: each value the settings write renders its class (volta, segno, coda, jump, section, repeat-count x2, clef-change, tempo-change, multi-rest, key and time changes, tuning chart, capo, TAB articulations, tied-fret parentheses)', () => {
  const score = { title: 'G1', tracks: [
    { name: 'Gtr', showTablature: true, measures: [
      { beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 5, tieStart: true }] }, { type: 'note', duration: 'half', notes: [{ string: 1, fret: 5, tieEnd: true }] }] },
      ...Array.from({ length: 8 }, () => ({ beats: [] })),
    ] },
    { name: 'TabOnly', showStandardNotation: false, showTablature: true, measures: [{ beats: [nt('whole', 2, 3)] }] },
  ] };
  const { ed } = mk(score);
  ed.setCursor({ track: 1, measure: 0, beat: 0 });
  ed.handleKey(key('a'));
  ed.setCursor({ track: 0, measure: 0, beat: 0 });
  const steps = [
    ['segno', () => ed.updateMeasure(0, { segno: true })],
    ['volta', () => ed.updateMeasure(1, { ending: [1, 2] })],
    ['section', () => ed.updateMeasure(1, { section: { letter: 'A', text: 'Verse' } })],
    ['coda', () => ed.updateMeasure(2, { coda: true })],
    ['repeat-count', () => ed.updateMeasure(2, { barline: 'repeatEnd', repeatCount: 2 })],
    ['jump', () => ed.updateMeasure(3, { jump: 'D.S. al Coda' })],
    ['clef-change', () => ed.updateMeasure(3, { clef: 'bass' }, { track: 0 })],
    ['key-signature', () => ed.updateMeasure(2, { keySignature: 3 })],
    ['time-signature', () => ed.updateMeasure(3, { timeSignature: { beats: 3, beatType: 4 } })],
    ['tempo-change', () => ed.setTempo({ bpm: 90, unit: 'quarter', text: 'Allegro' })],
    ['tuning-chart', () => ed.updateScore({ showTuningChart: true }) && ed.updateTrack(0, { tuning: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] })],
    ['multi-rest', () => ed.updateScore({ multiMeasureRests: true })],
    ['tab-articulations', () => ed.updateTrack(1, { tabArticulations: true })],
  ];
  for (const [cls, call] of steps) {
    const before = countClass(renderScore(ed.getScore()), cls);
    eq(call(), true, cls);
    const svg = renderScore(ed.getScore());
    ok(countClass(svg, cls) > before, `${cls}: ${before} -> ${countClass(svg, cls)}`);
  }
  const svg = renderScore(ed.getScore());
  ok(texts(svg).includes('x2'), 'R9: a repeat count of 2 is drawn as x2');
  ok(texts(svg).some((t) => t.includes('⑥ = D')), 'tuning chart entry');
  ok(!texts(svg).some((t) => t.includes('Capo fret 2')));
  ed.updateTrack(0, { capo: 2 });
  ok(texts(renderScore(ed.getScore())).includes('Gtr: Capo fret 2'), 'capo');
  ok(!texts(svg).includes('(5)'));
  ed.updateTrack(0, { tiedFrets: 'parens' });
  ok(texts(renderScore(ed.getScore())).includes('(5)'), 'tied fret in parentheses');
});
test('G2: the editor view keeps multiMeasureRests off while the score has it on; turning it on says so', () => {
  const { ed, box, spoken } = mk({ tracks: [{ name: 'G', showTablature: true, measures: [{ beats: [nt('whole')] }, { beats: [] }, { beats: [] }, { beats: [] }] }] });
  ed.updateScore({ multiMeasureRests: true });
  eq(spoken(), 'Multi-measure rests on, shown when rendered, not in the editor');
  eq(ed.getScore().multiMeasureRests, true);
  eq(countClass(box.children[0].children[0].children[0], 'multi-rest'), 0, 'not in the editor view');
  ok(countClass(renderScore(ed.getScore()), 'multi-rest') > 0, 'rendered elsewhere');
});

// ---------- B10 at editor level with API calls ----------
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
test('B10 (editor): 300 random steps of keys and settings calls; every step sanitize-stable; undo all restores the start byte for byte, redo all the end', () => {
  const rnd = mulberry32(22);
  const pick = (l) => l[Math.floor(rnd() * l.length)];
  const { ed, clock } = mk(fixture(), { historyLimit: 10000 });
  const start = JSON.stringify(ed.getScore());
  const keys = ['1', '2', '5', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', 'r', 'm', 'h', 's', 'Delete'];
  const calls = [
    () => ed.updateScore({ title: pick(['A', 'B', null]), showTuningChart: rnd() < 0.5 }),
    () => ed.updateTrack(Math.floor(rnd() * ed.getCursorInfo().trackCount), pick([{ capo: pick([0, 2]) }, { tuning: pick(Object.values(TUNINGS).flat()).tuning }, { showStandardNotation: rnd() < 0.5 }, { clef: pick(['bass', 'treble']) }])),
    () => ed.addTrack(pick(Object.keys(INSTRUMENTS))),
    () => ed.removeTrack(Math.floor(rnd() * ed.getCursorInfo().trackCount)),
    () => ed.moveTrack(0, ed.getCursorInfo().trackCount - 1),
    () => ed.updateMeasure(ed.getCursor().measure, pick([{ timeSignature: { beats: pick([3, 4, 5]), beatType: 4 } }, { barline: 'repeatEnd', repeatCount: 3 }, { ending: [1, 2] }, { segno: true, jump: 'D.S.' }, { section: { letter: 'A' } }])),
    () => ed.setTempo(pick([80, null, { bpm: 60, unit: 'half' }])),
  ];
  let steps = 0;
  for (let i = 0; i < 300; i++) {
    const before = ed._model;
    if (rnd() < 0.4) pick(calls)();
    else ed.handleKey(key(pick(keys)));
    clock.advance(rnd() < 0.5 ? 100 : 1000);
    if (ed._model !== before) steps++;
    ok(sanitizeScore(ed._model) === ed._model, `step ${i}: sanitize-stable`);
  }
  ok(steps > 100, `${steps} model changes`);
  const end = JSON.stringify(ed.getScore());
  while (ed.canUndo()) ed.undo();
  eq(JSON.stringify(ed.getScore()), start, 'undo all');
  while (ed.canRedo()) ed.redo();
  eq(JSON.stringify(ed.getScore()), end, 'redo all');
});

// ---------- demo helpers ----------
const DS = await imp('examples/editor-demo-settings.js');
const DT = await imp('examples/editor-demo-tracks.js');
const fs = await import('node:fs');
const readText = (p) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n');
test('demo Score dialog: scoreValues / scorePatch send only changed keys (empty text null, cleared box null); scoreErrors; the patch applies', () => {
  const s = { title: 'Song', artist: ' A ', showTuningChart: true, tracks: [] };
  const v = DS.scoreValues(s);
  eq([v.title, v.subtitle, v.artist, v.showTuningChart, v.multiMeasureRests], ['Song', '', ' A ', true, false]);
  eq(DS.scorePatch(v, { ...v }), {});
  eq(DS.scorePatch(v, { ...v, artist: 'A', title: '  ' }), { title: null });
  eq(DS.scorePatch(v, { ...v, subtitle: ' Sub ', showTuningChart: false, multiMeasureRests: true }), { subtitle: 'Sub', showTuningChart: null, multiMeasureRests: true });
  eq(DS.scoreErrors({ ...v, title: 'x'.repeat(201), copyright: 'y'.repeat(2001), instructions: 'z'.repeat(2000) }), { title: 'At most 200 characters.', copyright: 'At most 2000 characters.' });
  const { ed } = mk(fixture());
  eq(ed.updateScore(DS.scorePatch(DS.scoreValues(ed.getScore()), { ...DS.scoreValues(ed.getScore()), title: 'T2', copyright: 'c\nd' })), true);
  eq([ed.getScore().title, ed.getScore().copyright], ['T2', 'c\nd']);
});
test('demo status bar and key labels: statusText time / key / tempo; keyLabel matches the Measure dialog options', () => {
  eq(DS.statusText(null), { time: '–', key: '–', tempo: '–' });
  const info = { timeSignature: { beats: 3, beatType: 4 }, keySignature: 2, tempo: { bpm: 120, unit: 'quarter', dots: 0, text: null } };
  eq(DS.statusText(info), { time: '3/4', key: '2 sharps', tempo: '120 bpm' });
  eq(DS.statusText({ ...info, keySignature: -3, tempo: { bpm: 80, unit: 'quarter', dots: 1, text: null } }), { time: '3/4', key: '3 flats', tempo: 'dotted quarter = 80' });
  eq(DS.statusText({ ...info, keySignature: 0, tempo: { bpm: 92.5, unit: 'quarter', dots: 0, text: 'Allegro' } }).tempo, 'Allegro, 92.5 bpm');
  eq([DS.statusText({ ...info, keySignature: 0 }).key, DS.statusText({ ...info, keySignature: -1, tempo: null }).key, DS.statusText({ ...info, tempo: null }).tempo], ['none', '1 flat', '–']);
  eq([DS.keyLabel(0), DS.keyLabel(2), DS.keyLabel(-3), DS.keyLabel(7), DS.keyLabel(-7)],
    ['No sharps or flats (C major / A minor)', '2 sharps (D major / B minor)', '3 flats (E flat major / C minor)', '7 sharps (C sharp major / A sharp minor)', '7 flats (C flat major / A flat minor)']);
  const html = readText('editor.html');
  const keySelect = html.slice(html.indexOf('<select id="ms-key">'), html.indexOf('</select>', html.indexOf('<select id="ms-key">')));
  const opts = [...keySelect.matchAll(/<option value="(-?\d)">([^<]+)<\/option>/g)].map((m) => [Number(m[1]), m[2]]);
  eq(opts.length, 15);
  opts.forEach(([n, label]) => eq(label, DS.keyLabel(n), `key ${n}`));
  const { ed } = mk({ keySignature: -2, tracks: [{ showTablature: true, timeSignature: { beats: 6, beatType: 8 }, measures: [{ beats: [nt('half', 1, 0, { tempo: { bpm: 60, unit: 'half' } })] }] }] });
  eq(DS.statusText(ed.getCursorInfo()), { time: '6/8', key: '2 flats', tempo: 'half = 60' });
});
test('demo Measure dialog: parseEnding / measureErrors messages; unchanged values give no calls; each field change gives its patch and the patch applies', () => {
  eq([DS.parseEnding(''), DS.parseEnding(' 2, 1 '), DS.parseEnding('1, x'), DS.parseEnding('0'), DS.parseEnding('100'), DS.parseEnding('1, 1'), DS.parseEnding(Array.from({ length: 33 }, (_, i) => i + 1).join(','))],
    [{ numbers: [] }, { numbers: [1, 2] }, { error: 'Use whole numbers from 1 to 99, separated by commas, such as 1, 2.' }, { error: 'Use whole numbers from 1 to 99, separated by commas, such as 1, 2.' },
      { error: 'Use whole numbers from 1 to 99, separated by commas, such as 1, 2.' }, { error: 'Each number can be used once.' }, { error: 'At most 32 numbers.' }]);
  const base = { beats: '4', barline: '', repeatCount: '', ending: '', tempoMode: 'none', bpm: '120' };
  eq(DS.measureErrors(base), {});
  eq(DS.measureErrors({ ...base, beats: '33', barline: 'repeatEnd', repeatCount: '1', ending: '1,1', tempoMode: 'mark', bpm: '1000.001' }), {
    beats: 'Beats must be a whole number from 1 to 32.', repeatCount: 'Repeat count must be a whole number from 2 to 99.', ending: 'Each number can be used once.', bpm: 'BPM must be above 0 and at most 1000, with up to 2 decimals.' });
  eq(DS.measureErrors({ ...base, tempoMode: 'mark', bpm: '' }, { tempoOn: false }), {});
  const score = { tracks: [
    { name: 'Gtr', showTablature: true, measures: [{ beats: [nt('whole')] }, { beats: [nt('whole', 1, 0, { tempo: 90 })], ending: { numbers: [1], text: 'One' }, jump: 'Custom', section: { letter: 'A' } }, { beats: [nt('whole')] }] },
    { name: 'Tab', showStandardNotation: false, showTablature: true, measures: [{ beats: [] }, { beats: [] }, { beats: [] }] },
  ] };
  const { ed } = mk(score);
  const at = (mi, ti = 0) => { ed.setCursor({ track: ti, measure: mi, beat: 0 }); const info = ed.getCursorInfo(); const m = ed.getMeasureSettings(mi, ti); return { info, m, v: DS.measureValues(m, info) }; };
  for (const [mi, ti] of [[0, 0], [1, 0], [2, 0], [1, 1]]) { const { m, v, info } = at(mi, ti); eq(DS.measurePatch(m, v, mi, info), { patch: {}, tempo: undefined }, `${mi}/${ti} unchanged`); }
  let { m, v, info } = at(1);
  eq([v.jump, v.ending, v.endingText, v.sectionLetter, v.tempoMode, v.bpm], ['custom', '1', 'One', 'A', 'mark', '90']);
  const cases = [
    [{ timeMode: 'change', beats: '3', beatType: '4' }, { timeSignature: { beats: 3, beatType: 4 } }],
    [{ timeMode: 'change', beats: '4', beatType: '4' }, {}],
    [{ keyMode: 'change', key: '-2' }, { keySignature: -2 }],
    [{ clefMode: 'change', clef: 'bass' }, { clef: 'bass' }],
    [{ barline: 'repeatEnd', repeatCount: '3' }, { barline: 'repeatEnd', repeatCount: 3 }],
    [{ barline: 'repeatEnd' }, { barline: 'repeatEnd' }],
    [{ ending: '1, 2', endingText: '' }, { ending: [1, 2] }],
    [{ ending: '2', endingText: '' }, { ending: 2 }],
    [{ endingOpen: true }, { ending: { numbers: [1], text: 'One', open: true } }],
    [{ ending: '' }, { ending: null }],
    [{ segno: true, coda: true }, { segno: true, coda: true }],
    [{ jump: '' }, { jump: null }],
    [{ jump: 'Fine' }, { jump: 'Fine' }],
    [{ sectionLetter: '', sectionText: ' Verse ' }, { section: 'Verse' }],
    [{ sectionLetter: 'B', sectionText: 'Bridge' }, { section: { letter: 'B', text: 'Bridge' } }],
    [{ sectionLetter: '' }, { section: null }],
  ];
  for (const [change, patch] of cases) {
    const r = DS.measurePatch(m, { ...v, ...change }, 1, info);
    eq(r, { patch, tempo: undefined }, JSON.stringify(change));
    if (Object.keys(patch).length) { eq(ed.updateMeasure(1, patch, { track: 0 }), true, JSON.stringify(patch)); ed.undo(); }
  }
  eq(DS.measurePatch(m, { ...v, tempoMode: 'none' }, 1, info).tempo, null);
  eq(DS.measurePatch(m, { ...v, bpm: '100', dots: '1', tempoText: ' Slow ' }, 1, info).tempo, { bpm: 100, unit: 'quarter', dots: 1, text: 'Slow' });
  ({ m, v, info } = at(2));
  eq(v.tempoMode, 'none');
  eq(DS.measurePatch(m, { ...v, tempoMode: 'mark' }, 2, info).tempo, { bpm: 90, unit: 'quarter', dots: 0 }, 'a new mark starts from the tempo in force');
  ed.updateMeasure(2, { timeSignature: { beats: 5, beatType: 4 } });
  ({ m, v, info } = at(2));
  eq(DS.measurePatch(m, { ...v, timeMode: 'same' }, 2, info).patch, { timeSignature: null });
  ({ m, v, info } = at(0));
  eq(DS.measurePatch(m, { ...v, beats: '2', key: '1' }, 0, info).patch, { timeSignature: { beats: 2, beatType: 4 }, keySignature: 1 }, 'measure 1: plain inputs');
  eq(DS.measurePatch(m, { ...v, clefMode: 'change', clef: 'bass' }, 0, info).patch, {}, 'no clef at measure 1');
});
test('demo Tracks dialog: instrumentOptions, tuningRows, canonicalPitch, matchPreset, presetGroups, lowerFourth, trackLabel', () => {
  eq(DT.instrumentOptions().map((o) => o.value), Object.keys(INSTRUMENTS));
  eq(DT.instrumentOptions()[3], { value: 'bass4', label: '4-string bass' });
  eq(DT.tuningRows(['E2', 'A2', 'D3', 'G3', 'B3', 'E4']).map((r) => r.label), ['String 6 (lowest)', 'String 5', 'String 4', 'String 3', 'String 2', 'String 1 (highest)']);
  eq([DT.canonicalPitch(' f#3 '), DT.canonicalPitch('bb1'), DT.canonicalPitch('E10'), DT.canonicalPitch('H2'), DT.canonicalPitch('')], ['F#3', 'Bb1', null, null, null]);
  eq([DT.matchPreset(['d2', 'A2', 'D3', 'G3', 'B3', 'E4']), DT.matchPreset(['B0', 'E1', 'A1', 'D2', 'G2', 'C3']), DT.matchPreset(['E2', 'A2'])], ['guitar6:1', 'bass6:0', null]);
  const g6 = DT.presetGroups(6);
  eq(g6.map((g) => g.label), ['6-string guitar', '6-string bass']);
  eq(g6[0].options[1], { value: 'guitar6:1', text: 'Drop D (D2 A2 D3 G3 B3 E4)' });
  eq(DT.presetGroups(4).map((g) => g.label), ['4-string bass', 'Ukulele']);
  eq([DT.lowerFourth('E2'), DT.lowerFourth('B1'), DT.lowerFourth('F#1'), DT.lowerFourth('C0'), DT.lowerFourth('Eb2'), DT.lowerFourth('??')], ['B1', 'F#1', 'C#1', 'G0', 'A#1', 'E2']);
  eq([DT.trackLabel({ name: 'Guitar', showTablature: true }, 0), DT.trackLabel({ showStandardNotation: false }, 1), DT.trackLabel({ name: ' ' }, 2)], ['1. Guitar', '2. Track 2 (hidden)', '3. Track 3']);
});
test('demo Tracks dialog: notesOnRemovedStrings equals the library\'s removed count; trackNoteCount; trackValues / trackPatch / trackErrors', () => {
  const sc7 = { tracks: [{ name: 'G', showTablature: true, tuning: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'], measures: [
    { beats: [nt('quarter', 7, 0), { type: 'grace', duration: '16th', notes: [{ string: 6, fret: 1 }] }, { type: 'note', duration: 'quarter', notes: [{ string: 7, fret: 2, pitch: 'C#2' }, { string: 1, fret: 0 }] }, nt('half', 5, 3)] },
    { voices: [{ beats: [nt('whole', 6, 0)] }, { beats: [nt('half', 7, 5), { type: 'note', duration: 'half', notes: [{ pitch: 'C4' }] }] }] },
  ] }] };
  for (const n of [7, 6, 5, 4]) {
    const tuning = ['E1', 'A1', 'D2', 'G2', 'C3', 'F3', 'B3'].slice(7 - n);
    const { ed } = mk(sc7);
    const want = DT.notesOnRemovedStrings(ed.getScore(), 0, n);
    ed.updateTrack(0, { tuning });
    const said = /, (\d+) notes? removed/.exec(ed.lastMessage);
    eq(said ? Number(said[1]) : 0, want, `${n} strings`);
  }
  eq(DT.notesOnRemovedStrings(sc7, 0, 6), 3);
  eq(DT.notesOnRemovedStrings(sc7, 0, 8), 0);
  eq(DT.trackNoteCount(sc7, 0), 8);
  const t = { name: 'Bass', showStandardNotation: false, showTablature: true, tabRhythm: false, tiedFrets: ' Parens ', capo: 3, tuning: ['e1', 'A1', 'D2', 'G2'] };
  const before = DT.trackValues(t, 'bass');
  eq(before, { name: 'Bass', label: '', clef: 'bass', notation: false, tab: true, rhythm: 'false', artic: false, tied: true, tuning: ['e1', 'A1', 'D2', 'G2'], capo: '3' });
  eq(DT.trackPatch(before, { ...before }), {});
  eq(DT.trackPatch(before, { ...before, tuning: ['E1', 'A1', 'D2', 'G2'] }), {}, 'compared canonically');
  eq(DT.trackPatch(before, { ...before, name: ' ', label: 'B.', clef: 'treble', notation: true, rhythm: 'auto', artic: true, tied: false, tuning: ['d1', 'A1', 'D2', 'G2'], capo: '0' }),
    { name: null, label: 'B.', clef: 'treble', showStandardNotation: true, tabRhythm: null, tabArticulations: true, tiedFrets: null, tuning: ['D1', 'A1', 'D2', 'G2'], capo: 0 });
  const bare = DT.trackValues({ name: 'P' }, 'treble');
  eq([bare.tuning, bare.notation, bare.tab, bare.capo], [null, true, false, '0']);
  eq(DT.trackPatch(bare, { ...bare, tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] }), {}, 'standard tuning on a track without one is no change');
  eq(DT.trackErrors({ ...before, tuning: ['E1', 'X1', 'D2', 'G10'], capo: '31' }), { string1: 'Use a note and octave from 0 to 9, such as E2 or F#3.', string3: 'Use a note and octave from 0 to 9, such as E2 or F#3.', capo: 'Capo must be a whole number from 0 to 30.' });
  eq(DT.trackErrors({ ...before, notation: false, tab: false }, { lastVisible: true }), { tab: 'At least one track must be visible.' });
  eq(DT.trackErrors({ ...before, capo: '' }).capo, 'Capo must be a whole number from 0 to 30.');
  const { ed } = mk(sc7);
  const v0 = DT.trackValues(ed.getScore().tracks[0], ed.getMeasureSettings(0, 0).clef.value);
  eq(ed.updateTrack(0, DT.trackPatch(v0, { ...v0, capo: '2', label: 'Gt.' })), true);
});
test('demo New dialog: newScore uses INSTRUMENTS and the API time-signature range', async () => {
  const demo = await imp('examples/editor-demo.js');
  for (const id of Object.keys(INSTRUMENTS)) {
    const t = demo.newScore({ preset: id }).tracks[0];
    eq([t.name, t.clef, t.tuning], [INSTRUMENTS[id].name, INSTRUMENTS[id].clef, INSTRUMENTS[id].tuning], id);
  }
  eq([1, 32, 33].map((b) => demo.newScore({ beats: b }).tracks[0].timeSignature.beats), [1, 32, 32]);
  eq([1, 2, 4, 8, 16, 32, 3, 64].map((bt) => demo.newScore({ beatType: bt }).tracks[0].timeSignature.beatType), [1, 2, 4, 8, 16, 32, 4, 4]);
  ok(!/const PRESETS/.test(readText('examples/editor-demo.js')), 'the local PRESETS table is gone');
});

// ---------- editor.html and the demo boundary ----------
test('editor.html: Settings group with 3 buttons; 3 dialogs (aria-labelledby, novalidate form, alert line, Apply first); every field labelled; fieldset / legend; error slots; status items; shortcuts; New dialog ranges', () => {
  const html = readText('editor.html');
  ok(/<div class="group" role="group" aria-label="Settings">/.test(html));
  for (const [id, text, title] of [['score-btn', 'Score…', 'Header and options'], ['tracks-btn', 'Tracks…', 'Tracks, tuning and capo'], ['measure-btn', 'Measure…', "Settings for the cursor's measure"]]) {
    ok(html.includes(`<button type="button" id="${id}" aria-haspopup="dialog" title="${title}">${text}</button>`), id);
  }
  ok(html.indexOf('aria-label="History"') < html.indexOf('aria-label="Settings"'), 'after History');
  for (const [d, title] of [['score', 'Score settings'], ['tracks', 'Tracks'], ['measure', 'Measure 1']]) {
    const body = html.slice(html.indexOf(`<dialog id="${d}-dialog"`), html.indexOf('</dialog>', html.indexOf(`<dialog id="${d}-dialog"`)));
    ok(body.startsWith(`<dialog id="${d}-dialog" class="settings" aria-labelledby="${d}-title">`), d);
    ok(body.includes(`<form method="dialog" id="${d}-form" novalidate>`) && body.includes(`<h2 id="${d}-title">${title}</h2>`), `${d}: form and title`);
    ok(body.includes(`<p class="form-error" id="${d}-error" role="alert"></p>`), `${d}: alert line`);
    ok(/<div class="actions">\s*<button type="submit"[^>]*>Apply<\/button>\s*<button type="button" id="[a-z]+-cancel">Cancel<\/button>/.test(body), `${d}: Apply first, then Cancel`);
    const fieldsets = (body.match(/<fieldset[\s>]/g) || []).length;
    ok(fieldsets > 1 && fieldsets === (body.match(/<legend[\s>]/g) || []).length, `${d}: every fieldset has a legend`);
    const ids = [...body.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].map((m) => [m[2], /id="([^"]+)"/.exec(m[2])?.[1]]);
    for (const [attrs, id] of ids) {
      if (/type="radio"|type="checkbox"/.test(attrs)) { ok(new RegExp(`<label class="inline"><input [^>]*id="${id}"`).test(body), `${id}: wrapped in its label`); continue; }
      ok(/aria-label="/.test(attrs) || body.includes(`<label for="${id}">`), `${id}: labelled`);
    }
    for (const m of body.matchAll(/aria-describedby="([^"]+)"/g)) for (const ref of m[1].split(' ')) ok(body.includes(`id="${ref}"`), `${d}: ${ref} exists`);
  }
  for (const id of ['sc-title', 'sc-copyright', 'ms-beats', 'ms-repeat', 'ms-ending', 'ms-bpm', 'tr-name', 'tr-tab', 'tr-capo']) ok(html.includes(`<p class="field-error" id="${id}-err" hidden></p>`), `${id}: error slot`);
  ok(html.includes('<select id="ms-beat-type" aria-label="Beat type">'));
  ok(html.includes('<select id="tr-list" size="4"></select>') && html.includes('<div id="tr-panel" role="region" aria-labelledby="tr-panel-title">'));
  for (const id of ['st-time', 'st-key', 'st-tempo']) ok(html.includes(`<span id="${id}">–</span>`), id);
  ok(html.indexOf('<span id="st-measure">') < html.indexOf('<span id="st-time">'), 'after Measure');
  ok(/<h3>Settings<\/h3>\s*<p>No keys\. Use Score…, Tracks… and Measure… in the toolbar\.<\/p>/.test(html) && html.indexOf('<h3>Settings</h3>') < html.indexOf('<h3>History</h3>'));
  ok(html.includes('<input type="number" id="new-beats" min="1" max="32" value="4" />'));
  ok(html.includes('<option>1</option><option>2</option><option selected>4</option><option>8</option><option>16</option><option>32</option>'));
  const newOpts = [...html.slice(html.indexOf('<select id="new-preset">'), html.indexOf('</select>', html.indexOf('<select id="new-preset">'))).matchAll(/<option value="(\w+)">([^<]+)<\/option>/g)].map((m) => ({ value: m[1], label: m[2] }));
  eq(newOpts, DT.instrumentOptions(), 'New dialog instruments = INSTRUMENTS labels, in order');
  ok(!/tabindex="[1-9]/.test(html), 'no positive tabindex');
});
test('demo boundary: the demo modules use the public API only; from src/editor/model/ only durations.js (and the 2.1 effect table for the Effects group)', () => {
  const allowed = { 'examples/editor-demo-effects.js': ['../src/editor/model/effectTable.js'] };
  for (const f of fs.readdirSync(path.join(root, 'examples')).filter((n) => /^editor-demo.*\.js$/.test(n)).map((n) => `examples/${n}`)) {
    const specs = [...readText(f).matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const s of specs) {
      if (!s.includes('/src/')) continue;
      ok(s === '../src/editor/model/durations.js' || (allowed[f] || []).includes(s), `${f} imports ${s}`);
    }
  }
  ok(['examples/editor-demo-settings.js', 'examples/editor-demo-tracks.js'].every((f) => fs.existsSync(path.join(root, f))));
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
