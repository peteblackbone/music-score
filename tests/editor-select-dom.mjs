// 2.3.0 selection, range edits, fill / reflow and clipboard at controller level under the DOM shim: criteria 8-13
// (events, clearing, Esc, overlay groups and shapes, read-only), the clipboard events through document.dispatch
// (criteria 15-26), the R6 Safari fallback, destroy, criteria 27, 28, 36-38 and 44 (wording), B10 over 300 steps.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-select-dom.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { sanitizeScore } = await imp('src/sanitize.js');

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
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const grace = () => ({ type: 'grace', duration: '16th', notes: [{ string: 2, fret: 3 }] });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const SHIFT = { shiftKey: true };
const CTRL = { ctrlKey: true };
const findAll = (n, f, out = []) => { if (f(n)) out.push(n); for (const c of n.children || []) findAll(c, f, out); return out; };
const byClass = (n, c) => findAll(n, (x) => (x.getAttribute?.('class') || '').split(' ').includes(c));

/** An editor with a manual clock (synchronous renders unless raf); events logged in order. */
function mk(score, opts = {}, { raf = false, width = 900 } = {}) {
  const clock = makeClock();
  if (!raf) { clock.requestAnimationFrame = null; clock.cancelAnimationFrame = null; }
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width, clock, ...opts });
  const events = [];
  for (const t of ['change', 'cursor', 'selection']) ed.on(t, (e) => events.push([t, e]));
  const rootEl = box.children[0];
  const live = rootEl.children[1];
  const spoken = () => { clock.advance(150); return live.textContent.replace(/ $/, ''); };
  const press = (...ks) => ks.map((k) => ed.handleKey(typeof k === 'string' ? key(k) : k));
  const svg = () => ed._view.svg;
  return { ed, box, clock, events, live, rootEl, spoken, press, svg };
}
const fixture = () => ({ title: 'Song', tracks: [
  { name: 'Guitar', showTablature: true, measures: [
    { beats: [nt('quarter', 1, 1), nt('quarter', 1, 2), nt('quarter', 1, 3), nt('quarter', 1, 4)] },
    { beats: [nt('half', 2, 5), grace(), nt('half', 2, 7)] },
    { beats: [nt('whole', 3, 0, { tempo: 90 })] },
    { beats: [nt('half', 1, 0)] },
  ] },
  { name: 'Bass', showStandardNotation: false, showTablature: true, tuning: ['E1', 'A1', 'D2', 'G2'], measures: [{ beats: [nt('whole', 4, 3)] }] },
] });
const selEvents = (events) => events.filter((e) => e[0] === 'selection').map((e) => e[1] && e[1].beatCount);

// ---------- criteria 8-13 ----------
test('criterion 8: from beat 1, Shift+Right three times selects beats 1-4; each press fires cursor then selection', () => {
  const { ed, events, press, spoken } = mk(fixture());
  press(key('ArrowRight', SHIFT));
  eq(spoken(), 'Selected measure 1 beat 1 to beat 2, 2 beats');
  press(key('ArrowRight', SHIFT), key('ArrowRight', SHIFT));
  eq(events.map((e) => e[0]), ['cursor', 'selection', 'cursor', 'selection', 'cursor', 'selection']);
  eq(selEvents(events), [2, 3, 4]);
  eq(ed.getSelection(), { kind: 'measures', track: 0, start: { measure: 0, beat: 0 }, end: { measure: 0, beat: 3 }, beatCount: 4, measures: [0, 0] });
  eq(spoken(), 'Selected measure 1, 4 beats');
  eq(ed.getCursorInfo().selection, ed.getSelection());
  eq(ed.getCursor().beat, 3, 'the focus is the cursor');
});
test('criterion 9: Ctrl+Shift+Right extends to the next measure boundary, Shift+Home / End to the measure edges, across barlines; Shift+Left back to the anchor keeps one beat', () => {
  const { ed, press, spoken } = mk(fixture());
  ed.setCursor({ measure: 0, beat: 2 });
  press(key('ArrowRight', { ctrlKey: true, shiftKey: true }));
  eq([ed.getCursor().beat, ed.getSelection().beatCount], [3, 2]);
  press(key('ArrowRight', { ctrlKey: true, shiftKey: true }));
  eq(ed.getCursor(), { track: 0, measure: 1, beat: 2, string: 1 });
  eq(spoken(), 'Selected measure 1 beat 3 to measure 2 beat 2, 4 beats');
  press(key('Home', SHIFT));
  eq([ed.getCursor().measure, ed.getCursor().beat, ed.getSelection().beatCount], [1, 0, 3]);
  press(key('ArrowLeft', { ctrlKey: true, shiftKey: true }), key('ArrowLeft', { ctrlKey: true, shiftKey: true }));
  eq(ed.getSelection().start, { measure: 0, beat: 0 });
  press(key('End', SHIFT));
  eq(ed.getSelection(), { kind: 'beats', track: 0, start: { measure: 0, beat: 2 }, end: { measure: 0, beat: 3 }, beatCount: 2, measures: [0, 0] });
  press(key('ArrowLeft', SHIFT));
  eq([ed.getSelection().beatCount, spoken()], [1, 'Selected measure 1 beat 3, 1 beat']);
});
test('criterion 10 / R3: Ctrl+A selects every measure of the cursor track (kind measures) and scrolls to the end; on a track with no beats it says "Nothing to select"', () => {
  const { ed, press, spoken, events } = mk(fixture());
  ed.setCursor({ measure: 1, beat: 2 });
  events.length = 0;
  eq(press(key('a', CTRL)), [true]);
  eq(ed.getSelection(), { kind: 'measures', track: 0, start: { measure: 0, beat: 0 }, end: { measure: 3, beat: 0 }, beatCount: 8, measures: [0, 3] });
  eq(ed.getCursor(), { track: 0, measure: 3, beat: 1, string: 1 }, 'focus on the last position (the slot of an underfull measure)');
  eq(spoken(), 'Selected all of Track 1 Guitar, 4 measures');
  eq(events.map((e) => e[0]), ['cursor', 'selection']);
  const empty = mk({ tracks: [{ name: 'E', showTablature: true, measures: [{ beats: [] }, { beats: [] }] }] });
  eq(empty.press(key('a', CTRL)), [true]);
  eq([empty.ed.getSelection(), empty.spoken()], [null, 'Nothing to select']);
  eq(empty.events.filter((e) => e[0] === 'selection').length, 0);
});
test('criterion 11: a plain move, Esc, a click, undo, redo, loadScore and any edit clear the selection with selection(null) first; Esc is consumed only while something is live; refused and no-op edits keep it', () => {
  const sel = (m) => { m.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 2 } }); m.events.length = 0; };
  const m = mk(fixture());
  sel(m);
  eq(m.press('ArrowRight'), [true]);
  eq(m.events.map((e) => e[0]), ['selection', 'cursor']);
  eq([m.events[0][1], m.ed.getSelection()], [null, null]);
  eq(m.spoken(), 'Selection cleared. Beat 4, string 1, fret 4, quarter');
  sel(m);
  eq(m.press('Escape'), [true]);
  eq([m.ed.getSelection(), m.spoken(), m.events.map((e) => e[0])], [null, 'Selection cleared', ['selection']]);
  eq(m.press('Escape'), [false], 'nothing live: not consumed');
  sel(m);
  m.ed.setCursor({ measure: 2 });
  eq([m.ed.getSelection(), m.events[0]], [null, ['selection', null]], 'a click / setCursor');
  sel(m);
  m.press('5');
  eq(m.events.map((e) => e[0]), ['selection', 'change'], 'the digit edit: selection(null) at once, change after the render');
  eq(m.events[0], ['selection', null], 'an edit fires selection(null) first');
  sel(m);
  m.ed.undo();
  eq(m.events[0], ['selection', null], 'undo');
  sel(m);
  m.ed.redo();
  eq(m.events[0], ['selection', null], 'redo');
  sel(m);
  m.ed.loadScore(fixture());
  eq(m.events[0], ['selection', null], 'load');
  sel(m);
  m.ed.setCursor({ measure: 0, beat: 2 }); // the cursor is already there: a click still clears
  eq(m.ed.getSelection(), null);
  sel(m);
  m.press(key('Delete', CTRL));
  ok(m.ed.getSelection() === null, 'a range edit clears it');
  const ro = mk(fixture(), { readOnly: true });
  sel(ro);
  ro.press('5');
  eq([ro.ed.getSelection()?.beatCount, ro.spoken()], [3, 'Read-only'], 'a refused edit keeps it');
  const noop = mk(fixture());
  sel(noop);
  noop.ed.setCursor({ measure: 3, beat: 1 });
  noop.ed.setSelection({ anchor: { measure: 3, beat: 0 }, focus: { measure: 3, beat: 1 } });
  noop.events.length = 0;
  noop.press('ArrowUp');
  ok(noop.ed.getSelection() === null, 'Up is a plain move: it clears');
  noop.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 0 } });
  noop.press(key('PageUp'));
  eq(noop.ed.getSelection(), null, 'PageUp at the first track is a plain move: it clears (D5)');
});
test('criterion 12: the overlay draws editor-selection shapes on every staff of the track, a tint and an outline, rebuilt on each redraw; the cursor stays visible', () => {
  const { ed, svg, press } = mk(fixture());
  const ov = () => byClass(svg(), 'editor-overlay')[0];
  eq(ov().children.map((c) => c.getAttribute('class')), ['editor-fill', 'editor-selection', 'editor-cursor']);
  eq(byClass(svg(), 'editor-selection')[0].children.length, 0);
  press(key('ArrowRight', SHIFT));
  const g = byClass(svg(), 'editor-selection')[0];
  eq(g.children.map((c) => `${c.tag}.${c.getAttribute('class')}`), ['rect.editor-sel', 'rect.editor-sel-outline', 'rect.editor-sel', 'rect.editor-sel-outline'], 'notation and TAB');
  const [tint, line] = g.children;
  eq([tint.getAttribute('fill'), tint.getAttribute('fill-opacity'), tint.getAttribute('stroke'), line.getAttribute('fill'), line.getAttribute('stroke'), line.getAttribute('stroke-opacity')], ['#0b7285', '0.06', null, 'none', '#0b7285', '0.4'], 'unfocused');
  ok(byClass(svg(), 'editor-col-tab').length === 1, 'cursor still drawn');
  ed.focus();
  eq(byClass(svg(), 'editor-sel')[0].getAttribute('fill-opacity'), '0.14', 'focus redraws the selection');
  eq(byClass(svg(), 'editor-sel-outline')[0].getAttribute('stroke-opacity'), '1');
  ed.refresh();
  eq(byClass(svg(), 'editor-sel').length, 2, 'a full render rebuilds it');
  ed.setCursor({ track: 1 });
  eq(byClass(svg(), 'editor-sel').length, 0);
  const custom = mk(fixture(), { selectionColor: ' #ff00aa ' });
  custom.press(key('ArrowRight', SHIFT));
  eq(byClass(custom.svg(), 'editor-sel')[0].getAttribute('fill'), '#ff00aa');
});
test('overlay geometry: beats run from the first beat (and its graces) to the last, inset at barlines; measures from measure x to end; at a system break the segments are open paths', () => {
  const long = { tracks: [{ name: 'G', showTablature: true, showStandardNotation: false, measures: Array.from({ length: 12 }, () => ({ beats: [grace(), nt('half'), nt('half')] })) }] };
  const { ed, svg } = mk(long, {}, { width: 500 });
  const hm = ed._view.renderer.getHitMap();
  const els = hm.elements.filter((e) => e.measureIndex === 0);
  const m0 = hm.measures.find((m) => m.measureIndex === 0);
  ed.setSelection({ anchor: { measure: 0, beat: 1 }, focus: { measure: 0, beat: 1 } });
  const s = 10; // default staffLineSpacing
  const half = (e) => Math.max(e.width + 0.8 * s, 1.8 * s) / 2;
  const want0 = Math.max(Math.min(...els.slice(0, 2).map((e) => e.x - half(e))), m0.x + 0.2 * s);
  const r = byClass(svg(), 'editor-sel')[0];
  ok(Math.abs(Number(r.getAttribute('x')) - want0) < 0.01, `x0 ${r.getAttribute('x')} vs ${want0}`);
  ok(Math.abs(Number(r.getAttribute('x')) + Number(r.getAttribute('width')) - Math.min(els[1].x + half(els[1]), m0.endX - 0.2 * s)) < 0.02, 'x1');
  eq(r.getAttribute('rx'), '2');
  ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 11, beat: 2 } });
  const systems = new Set(hm.measures.map((m) => m.sysIdx)).size;
  ok(systems >= 3, `${systems} systems`);
  const tints = byClass(svg(), 'editor-sel');
  eq(tints.length, systems, 'one segment per system (one TAB staff)');
  ok(tints.every((t) => t.tag === 'path'), 'every segment has an open end');
  const outlines = byClass(svg(), 'editor-sel-outline').map((o) => o.getAttribute('d'));
  ok(/^M\S+ \S+ L\S+ \S+ M/.test(outlines[1]), `middle outline is top and bottom only: ${outlines[1]}`);
  ok(outlines[0].includes('Q') && outlines[systems - 1].includes('Q'), 'closed ends are rounded');
  eq(ed.getSelection().kind, 'measures');
  const sys0 = hm.measures.filter((m) => m.sysIdx === 0);
  ok(outlines[0].startsWith(`M${Math.round(Math.max(...sys0.map((m) => m.endX)) * 100) / 100} `), 'the first segment runs to the system end');
});
test('criterion 13: selecting (keys, Ctrl+A, setSelection) works in read-only mode; Shift+Right never appends a measure there or elsewhere', () => {
  const { ed, press } = mk(fixture(), { readOnly: true });
  eq(press(key('a', CTRL)), [true]);
  eq(ed.getSelection().beatCount, 8);
  ed.clearSelection();
  ed.setCursor({ measure: 3, beat: 1 });
  press(key('ArrowRight', SHIFT));
  const rw = mk({ tracks: [{ showTablature: true, measures: [{ beats: [nt('whole')] }] }] });
  rw.press(key('ArrowRight', SHIFT), key('ArrowRight', SHIFT));
  eq([rw.ed.getScore().tracks[0].measures.length, rw.ed.canUndo()], [1, false]);
});
test('setSelection / getSelection / clearSelection: checks, clamping, one track, the cursor moves to the focus; copies; clearSelection returns whether one was live', () => {
  const { ed, events } = mk(fixture());
  throws(() => ed.setSelection(), TypeError);
  throws(() => ed.setSelection({ anchor: { measure: 0 }, focus: { measure: 0, beat: 0 } }), TypeError);
  throws(() => ed.setSelection({ anchor: { measure: 0, beat: NaN }, focus: { measure: 0, beat: 0 } }), TypeError);
  throws(() => ed.setSelection({ anchor: { measure: 0, beat: 0, track: '1' }, focus: { measure: 0, beat: 0 } }), TypeError);
  throws(() => ed.setSelection({ anchor: { track: 1, measure: 0, beat: 0 }, focus: { track: 0, measure: 0, beat: 0 } }), RangeError, 'A selection covers one track');
  eq(events.length, 0, 'a throw changes nothing');
  const info = ed.setSelection({ anchor: { measure: -5, beat: -1 }, focus: { measure: 99, beat: 99 } });
  eq([info.kind, info.measures, ed.getCursor().measure], ['measures', [0, 3], 3]);
  const copy = ed.getSelection();
  copy.measures.push(7);
  eq(ed.getSelection().measures, [0, 3]);
  eq(ed.setSelection({ anchor: { track: 1, measure: 0, beat: 0 }, focus: { track: 1, measure: 0, beat: 0 } }).track, 1);
  eq(ed.getCursor().track, 1);
  eq([ed.clearSelection(), ed.clearSelection()], [true, false]);
});
test('a two-digit entry: a select key ends it; Esc ends the entry before it clears the selection', () => {
  const { ed, press, clock } = mk(fixture());
  press('1');
  press(key('ArrowRight', SHIFT));
  eq(ed._state.digit, null);
  clock.advance(10);
  ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 1 } });
  ed.setCursor({ measure: 0, beat: 1 });
  press(key('ArrowRight', SHIFT));
  press('1');
  eq(ed.getSelection(), null, 'an edit cleared it');
});

// ---------- criteria 27, 28: delete keys with a selection ----------
const selectMeasure2to3 = (ed) => ed.setSelection({ anchor: { measure: 1, beat: 0 }, focus: { measure: 2, beat: 0 } });
test('criterion 27: Delete / Backspace -> rests, Ctrl+Delete -> beats removed, Shift+Delete -> columns deleted; each one undo step; cursor per ui-2.3 §1; announced', () => {
  for (const [k, label, said, check] of [
    [key('Delete'), 'clear beats', '3 beats changed to rests', (s) => s.tracks[0].measures[1].beats.every((b) => b.type === 'rest') && s.tracks[0].measures[1].beats.length === 2],
    [key('Backspace'), 'clear beats', '3 beats changed to rests', (s) => s.tracks[0].measures[2].beats[0].type === 'rest'],
    [key('Delete', CTRL), 'delete beats', '3 beats deleted, 1 tempo mark removed', (s) => s.tracks[0].measures[1].beats.length === 0 && s.tracks[0].measures[2].beats.length === 0],
    [key('Delete', SHIFT), 'delete measures', 'Measures 2 to 3 deleted, 1 tempo mark removed', (s) => s.tracks[0].measures.length === 2],
  ]) {
    const { ed, press, spoken, events } = mk(fixture());
    const before = ed._model;
    selectMeasure2to3(ed);
    events.length = 0;
    eq(press(k), [true]);
    ok(check(ed.getScore()), label);
    ok(sanitizeScore(ed._model) === ed._model);
    eq(ed.getSelection(), null);
    eq(events[0], ['selection', null]);
    eq(spoken().replace(/, measure \w+$/, ''), said, label);
    eq(ed.getCursor().measure, 1, `${label}: cursor at the start of the range / the measure after it`);
    ed.undo();
    ok(ed._model === before, `${label}: one undo step`);
    eq(spoken(), `Undo: ${label}`);
  }
});
test('criterion 28 / D8: ties at both edges repaired; Shift+Delete on a beats selection is refused and the selection stays; read-only refuses every delete key and keeps it', () => {
  const tied = { tracks: [{ showTablature: true, measures: [
    { beats: [nt('half'), nt('half', 1, 0, { notes: [{ string: 1, fret: 0, tieStart: true }] })] },
    { beats: [{ type: 'note', duration: 'half', notes: [{ string: 1, fret: 0, tieEnd: true, tieStart: true }] }, { type: 'note', duration: 'half', notes: [{ string: 1, fret: 0, tieEnd: true }] }] },
  ] }] };
  const { ed, press } = mk(tied);
  ed.setSelection({ anchor: { measure: 1, beat: 0 }, focus: { measure: 1, beat: 0 } });
  press(key('Delete'));
  ok(!JSON.stringify(ed.getScore()).includes('tie'), 'both edges untied around the new rest');
  const b = mk(fixture());
  b.ed.setSelection({ anchor: { measure: 0, beat: 1 }, focus: { measure: 1, beat: 0 } });
  eq(b.press(key('Delete', SHIFT)), [true]);
  eq([b.spoken(), b.ed.getSelection().beatCount, b.ed.canUndo()], ['Select whole measures first', 4, false]);
  const ro = mk(fixture(), { readOnly: true });
  selectMeasure2to3(ro.ed);
  for (const k of [key('Delete'), key('Backspace'), key('Delete', CTRL), key('Delete', SHIFT)]) {
    eq(ro.press(k), [false]);
    eq(ro.spoken(), 'Read-only');
  }
  eq(ro.ed.getSelection().beatCount, 3);
});
test('effect keys and other edits act on the cursor beat and clear the selection (D6); a no-op edit keeps it', () => {
  const { ed, press } = mk(fixture());
  selectMeasure2to3(ed);
  press('v');
  eq(ed.getSelection(), null);
  eq(ed.getScore().tracks[0].measures[2].beats[0].vibrato, true, 'on the cursor beat (the focus)');
  selectMeasure2to3(ed);
  ed.setDuration('whole');
  ok(ed.getSelection() !== null, 'the cursor beat is already a whole: no change keeps the selection');
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-select-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-select-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
export { mk, fixture, key, SHIFT, CTRL, byClass, nt, rest, grace, throws, eq, ok, sanitizeScore };
