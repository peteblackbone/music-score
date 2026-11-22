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

// ---------- criteria 36-38: fill and reflow ----------
test('criterion 36: F in 4/4 after a dotted quarter adds an eighth rest, then a half rest; the measure becomes full; one undo step', () => {
  const { ed, press, spoken } = mk({ tracks: [{ name: 'G', showTablature: true, measures: [{ beats: [nt('quarter', 1, 0, { dots: 1 })] }, { beats: [] }] }] });
  ed.setCursor({ measure: 0, beat: 1 });
  const before = ed._model;
  eq(press('f'), [true]);
  eq(ed.getScore().tracks[0].measures[0].beats.slice(1), [rest('8th'), rest('half')]);
  eq([ed.getMeasureFill(0, 0), spoken()], ['full', 'Added 2 rests: eighth, half, measure full']);
  ed.undo();
  ok(ed._model === before);
  eq(spoken(), 'Undo: fill');
});
test('criterion 37: F is refused on an unfinished triplet gap and on a pickup measure, with the reason; nothing changes', () => {
  const t = mk({ tracks: [{ showTablature: true, measures: [{ beats: [nt('8th', 1, 0, { tuplet: 3 })] }] }] });
  eq(t.press('f'), [true]);
  eq([t.spoken(), t.ed.canUndo()], ['Finish the tuplet first', false]);
  const p = mk({ tracks: [{ showTablature: true, measures: [{ beats: [nt('quarter')], pickup: true }, { beats: [] }] }] });
  p.press('f');
  eq([p.spoken(), p.ed.canUndo()], ['Pickup measure, not filled', false]);
  p.ed.setCursor({ measure: 1 });
  p.press('f');
  eq(p.ed.getMeasureFill(0, 1), 'full', 'measure 2 still fills');
});
test('criterion 38: Shift+F moves the overflow, adds a measure on the last one, leaves a crossing beat with an announcement; one undo step; read-only refuses', () => {
  const { ed, press, spoken } = mk({ tracks: [{ name: 'G', showTablature: true, measures: [{ beats: [nt('half'), nt('half', 1, 0, { dots: 1 }), nt('quarter'), nt('8th')] }] }] });
  const before = ed._model;
  eq(press(key('F', SHIFT)), [true]);
  eq(ed.getScore().tracks[0].measures.map((m) => m.beats.length), [2, 2]);
  eq(spoken(), 'Measure 2 added, moved 2 beats to it, beat 2 crosses the barline and stays', 'still overfull: no fill suffix');
  ed.undo();
  ok(ed._model === before, 'one undo step, the added measure included');
  eq(spoken(), 'Undo: reflow');
  const ro = mk(fixture(), { readOnly: true });
  eq([ro.press('f'), ro.spoken(), ro.press(key('F', SHIFT)), ro.spoken()], [[false], 'Read-only', [false], 'Read-only']);
});

// ---------- clipboard (criteria 15-26), the R6 fallback, destroy ----------
const { makeClipboardData } = await import('./editor-shim.mjs');
const { CLIP_MIME } = await imp('src/editor/model/clip.js');
const { EDITOR_LIMITS } = await imp('src/editor/model/limits.js');
const { clampCursor } = await imp('src/editor/model/cursor.js');
const SEVEN = ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
const clipText = (kind, content, extra = {}) => JSON.stringify({ type: 'music-score-clip', version: 1, kind, tracks: [{ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], [kind]: content, ...extra }] });
/** Dispatch a native clipboard event on document; returns the event. */
const fire = (kind, init = {}, opts) => { const clipboardData = makeClipboardData(init, opts); return { e: document.dispatch(kind, { clipboardData }), clipboardData }; };
test('criterion 15: Ctrl+C with focus: keydown not prevented; the copy event sets the custom type and text/plain (same JSON), updates the internal clipboard and is prevented; "Copied N beats"', () => {
  const { ed, rootEl, spoken } = mk(fixture());
  ed.focus();
  ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 2 } });
  const kd = rootEl.dispatch('keydown', { ...key('c', CTRL), target: rootEl });
  eq(kd.defaultPrevented, false);
  const { e, clipboardData } = fire('copy');
  eq(e.defaultPrevented, true);
  const text = clipboardData.data.get(CLIP_MIME);
  eq(clipboardData.data.get('text/plain'), text);
  eq(JSON.parse(text).tracks[0].beats.length, 3);
  eq(spoken(), 'Copied 3 beats');
  ed.clearSelection();
  ed.setCursor({ measure: 3, beat: 1 });
  eq(ed.paste(), true, 'the internal clipboard has it');
  eq(ed.getScore().tracks[0].measures[3].beats.length, 4);
  for (const k of ['x', 'v', 'Insert']) eq(rootEl.dispatch('keydown', { ...key(k, k === 'Insert' ? SHIFT : CTRL), target: rootEl }).defaultPrevented, false, k);
  ed.destroy();
});
test('criterion 16 / R2: copy, cut and paste events are ignored without focus; copy without a selection takes the cursor beat; on the slot "Nothing to copy" and the event is left alone', () => {
  const { ed, spoken } = mk(fixture());
  document.activeElement = null;
  for (const kind of ['copy', 'cut', 'paste']) {
    const { e, clipboardData } = fire(kind, { [CLIP_MIME]: clipText('beats', [nt('quarter')]) });
    eq([e.defaultPrevented, clipboardData.data.size], [false, 1], kind);
  }
  eq(ed.canUndo(), false);
  ed.focus();
  const one = fire('copy');
  eq([one.e.defaultPrevented, JSON.parse(one.clipboardData.data.get('text/plain')).tracks[0].beats.length, spoken()], [true, 1, 'Copied 1 beat']);
  ed.setCursor({ measure: 3, beat: 1 });
  const slot = fire('copy');
  eq([slot.e.defaultPrevented, slot.clipboardData.data.size, spoken()], [false, 0, 'Nothing to copy']);
  eq([ed.copy(), ed.cut()], [null, null]);
  const pre = { defaultPrevented: true, clipboardData: makeClipboardData() };
  ed.setCursor({ measure: 0, beat: 0 });
  document.dispatch('copy', pre);
  eq(pre.clipboardData.data.size, 0, 'an event already handled by the page is left alone');
  ed.destroy();
});
test('criteria 17 / 18 / 25: a beats clip pastes before the cursor beat (one undo removes it; overflow shows Over); a measures clip inserts before the cursor measure in every track; sanitize-stable', () => {
  const { ed, spoken } = mk(fixture());
  ed.focus();
  ed.setCursor({ measure: 0, beat: 1 });
  spoken();
  const before = ed._model;
  fire('paste', { [CLIP_MIME]: clipText('beats', [nt('half', 3, 3)]) });
  eq(ed.getScore().tracks[0].measures[0].beats.map((b) => b.notes[0].fret), [1, 3, 2, 3, 4]);
  eq([ed.getMeasureFill(0, 0), ed.getCursor().beat, spoken()], ['over', 2, 'Pasted 1 beat']);
  ok(sanitizeScore(ed._model) === ed._model);
  ed.undo();
  ok(ed._model === before, 'one undo step');
  ed.setCursor({ measure: 2, beat: 0 });
  spoken();
  fire('paste', { [CLIP_MIME]: clipText('measures', [{ beats: [nt('whole', 1, 7)] }, { beats: [] }]) });
  eq(ed.getScore().tracks.map((t) => t.measures.length), [6, 4]);
  eq(ed.getScore().tracks[0].measures[2].beats[0].notes[0].fret, 7);
  eq(ed.getScore().tracks[1].measures, [{ beats: [nt('whole', 4, 3)] }, { beats: [] }, { beats: [] }, { beats: [] }]);
  eq([ed.getCursor().measure, spoken()], [4, 'Pasted 2 measures at measure 3']);
  ok(sanitizeScore(ed._model) === ed._model);
  ed.destroy();
});
test('criterion 19: editor A copies, editor B pastes through the internal clipboard; across tabs the system clipboard\'s custom type wins over the internal one, then text/plain that is a clip, else the internal one', () => {
  const a = mk(fixture());
  const b = mk({ tracks: [{ name: 'Other', showTablature: true, measures: [{ beats: [] }] }] });
  a.ed.setSelection({ anchor: { measure: 1, beat: 0 }, focus: { measure: 1, beat: 2 } });
  a.ed.copy();
  b.ed.focus();
  eq(b.ed.paste(), true);
  eq(b.ed.getScore().tracks[0].measures[0].beats.map((x) => x.type), ['note', 'grace', 'note']);
  b.ed.undo();
  fire('paste', { [CLIP_MIME]: clipText('beats', [nt('8th', 1, 9)]), 'text/plain': clipText('beats', [nt('8th', 1, 8)]) });
  eq(b.ed.getScore().tracks[0].measures[0].beats.map((x) => x.notes[0].fret), [9], 'custom type first');
  b.ed.undo();
  fire('paste', { 'text/plain': clipText('beats', [nt('8th', 1, 8)]) });
  eq(b.ed.getScore().tracks[0].measures[0].beats.map((x) => x.notes[0].fret), [8], 'then text/plain that is a clip');
  b.ed.undo();
  fire('paste', { 'text/plain': 'just some text' });
  eq(b.ed.getScore().tracks[0].measures[0].beats.length, 3, 'else the internal clipboard');
  b.ed.undo();
  const denied = fire('paste', {}, { throws: true });
  eq([denied.e.defaultPrevented, b.ed.getScore().tracks[0].measures[0].beats.length], [true, 3], 'unreadable clipboardData: internal');
  b.ed.undo();
  fire('paste', { [CLIP_MIME]: clipText('beats', []).replace('"version":1', '"version":9') });
  eq([b.ed.lastMessage, b.ed.getScore().tracks[0].measures[0].beats.length], ['Unsupported clip version', 0], 'a bad custom clip is refused, no fallback');
  const ro = fire('copy', {}, { throws: true });
  eq(ro.e.defaultPrevented, false, 'setData refused: the event is left alone');
  a.ed.destroy(); b.ed.destroy();
});
test('criteria 20-22: notes on string 7 into a 6-string track are dropped and counted; a stray tieEnd is removed; pasted beats never carry tempo, measures clips no column or settings fields', () => {
  const { ed, spoken } = mk({ tracks: [{ name: 'G', showTablature: true, measures: [{ beats: [] }] }] });
  eq(ed.paste(clipText('beats', [{ type: 'note', duration: 'quarter', notes: [{ string: 7, fret: 1 }, { string: 6, fret: 1, tieEnd: true }], tempo: 77 }, { type: 'note', duration: 'quarter', notes: [{ string: 7, fret: 3 }] }], { tuning: SEVEN })), true);
  eq(ed.getScore().tracks[0].measures[0].beats, [{ type: 'note', duration: 'quarter', notes: [{ string: 6, fret: 1 }] }, { type: 'rest', duration: 'quarter' }]);
  eq(spoken(), 'Pasted 2 beats, 2 notes on missing strings dropped');
  ed.paste(clipText('measures', [{ beats: [nt('whole')], timeSignature: { beats: 3, beatType: 4 }, barline: 'final', segno: true, pickup: true, section: 'A' }]));
  eq(ed.getScore().tracks[0].measures[0], { beats: [nt('whole')] });
});
test('criterion 23: hostile clips change nothing and are refused with an announcement (malformed, wrong type or version, an array, __proto__, over 5 MB, over the limits)', () => {
  const { ed, spoken } = mk(fixture());
  const before = ed._model;
  for (const [input, said] of [
    ['{', 'Not a music-score clip'], ['{"type":"x","version":1}', 'Not a music-score clip'], ['[]', 'Not a music-score clip'],
    [clipText('beats', []).replace('"version":1', '"version":2'), 'Unsupported clip version'],
    [clipText('beats', [nt('quarter')]).replace('"type":"note"', '"__proto__":{"p":1},"type":"note"'), 'Not a music-score clip'],
    [' '.repeat(EDITOR_LIMITS.jsonChars + 1), 'Clip too large'],
    [clipText('beats', Array.from({ length: 257 }, () => nt('64th'))), 'Clip too large'],
  ]) {
    eq(ed.paste(input), false);
    eq([spoken(), ed.lastMessage], [said, said]);
  }
  ok(ed._model === before && !ed.canUndo() && ({}).p === undefined);
  eq([ed.paste(null), spoken()], [false, 'Nothing to paste']);
});
test('criterion 24: a paste past jsonChars, 2000 measures or 256 beats per voice is refused ("The score would be too large")', () => {
  const big = mk({ tracks: [{ showTablature: true, measures: [{ beats: Array.from({ length: 255 }, () => nt('64th')) }] }] });
  eq([big.ed.paste(clipText('beats', [nt('64th'), nt('64th')])), big.spoken()], [false, 'The score would be too large']);
  const many = mk({ tracks: [{ showTablature: true, measures: Array.from({ length: 1999 }, () => ({ beats: [] })) }] });
  eq([many.ed.paste(clipText('measures', [{ beats: [] }, { beats: [] }])), many.spoken()], [false, 'The score would be too large']);
  const wide = mk({ zz: 'x'.repeat(EDITOR_LIMITS.jsonChars - 20000), tracks: [{ showTablature: true, measures: [{ beats: [] }] }] });
  const clip = clipText('beats', [{ ...nt('quarter'), pad: 'y'.repeat(30000) }]);
  ok(clip.length < EDITOR_LIMITS.jsonChars);
  eq([wide.ed.paste(clip), wide.ed.lastMessage, wide.ed.canUndo()], [false, 'The score would be too large', false]);
  eq(wide.ed.paste(clipText('beats', [nt('quarter')])), true, 'a small paste still fits');
});
test('criterion 26: cut, paste and the delete keys in read-only mode announce "Read-only" and change nothing; copy works', () => {
  const { ed, spoken } = mk(fixture(), { readOnly: true });
  ed.focus();
  ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 1 } });
  spoken();
  const before = ed._model;
  eq([ed.cut(), spoken()], [null, 'Read-only']);
  eq([ed.paste(clipText('beats', [nt('quarter')])), spoken()], [false, 'Read-only']);
  const cut = fire('cut');
  eq([cut.e.defaultPrevented, cut.clipboardData.data.size], [false, 0]);
  fire('paste', { [CLIP_MIME]: clipText('beats', [nt('quarter')]) });
  eq(spoken(), 'Read-only');
  eq(typeof ed.copy(), 'string');
  ok(ed._model === before && ed.getSelection().beatCount === 2);
  ed.destroy();
});
test('cut: copy, then the range becomes rests in one undo step ("Cut 3 beats, now rests"); cursor at the start; a measures cut; without a selection the cursor beat', () => {
  const { ed, spoken } = mk(fixture());
  ed.focus();
  ed.setSelection({ anchor: { measure: 0, beat: 1 }, focus: { measure: 0, beat: 3 } });
  spoken();
  const before = ed._model;
  const { e, clipboardData } = fire('cut');
  eq(e.defaultPrevented, true);
  eq(JSON.parse(clipboardData.data.get(CLIP_MIME)).tracks[0].beats.length, 3);
  eq(ed.getScore().tracks[0].measures[0].beats.map((b) => b.type), ['note', 'rest', 'rest', 'rest']);
  eq([ed.getCursor().beat, spoken(), ed.getSelection()], [1, 'Cut 3 beats, now rests', null]);
  ed.undo();
  ok(ed._model === before);
  eq(spoken(), 'Undo: cut');
  ed.setSelection({ anchor: { measure: 2, beat: 0 }, focus: { measure: 2, beat: 0 } });
  spoken();
  ed.cut();
  eq(spoken(), 'Cut 1 measure, now rests');
  ed.setCursor({ measure: 0, beat: 0 });
  spoken();
  ed.cut();
  eq([ed.getScore().tracks[0].measures[0].beats[0].type, spoken()], ['rest', 'Cut 1 beat, now rests']);
  ed.cut();
  eq([ed.canUndo(), spoken()], [true, 'Cut 1 beat, now rests'], 'cutting a rest copies it and changes nothing');
  ed.destroy();
});
test('R6: one Ctrl+V keystroke pastes once, with the native paste event (it cancels the fallback) and without it (the 0 ms fallback pastes from the internal clipboard); keydown is never prevented', () => {
  const { ed, rootEl, clock } = mk({ tracks: [{ showTablature: true, measures: [{ beats: [] }] }] });
  ed.focus();
  ed.paste(clipText('beats', [nt('quarter', 1, 5)]));
  ed.setCursor({ beat: 0 });
  eq(JSON.parse(ed.copy()).tracks[0].beats.length, 1, 'the shared clipboard holds this beat');
  const count = () => ed.getScore().tracks[0].measures[0].beats.length;
  let kd = rootEl.dispatch('keydown', { ...key('v', CTRL), target: rootEl });
  eq([kd.defaultPrevented, clock.pendingTimers() > 0], [false, true]);
  fire('paste', { [CLIP_MIME]: clipText('beats', [nt('quarter', 1, 6)]) });
  clock.advance(10);
  eq(count(), 2, 'the native event pasted; the fallback was cancelled');
  kd = rootEl.dispatch('keydown', { ...key('V', { metaKey: true }), target: rootEl });
  eq(kd.defaultPrevented, false);
  eq(count(), 2, 'nothing before the fallback runs');
  clock.advance(0);
  eq(count(), 3, 'Safari: the fallback pasted once');
  clock.advance(100);
  eq(count(), 3);
  rootEl.dispatch('keydown', { ...key('Insert', SHIFT), target: rootEl });
  ed.destroy();
  eq(clock.pendingTimers(), 0, 'destroy cancels a pending fallback');
});
test('F1: a native paste the page already handled (a capture listener that prevents it) still cancels the fallback: one keystroke, nothing pasted; one without focus too', () => {
  const block = (e) => e.preventDefault();
  document.addEventListener('paste', block);
  const { ed, rootEl, clock } = mk({ tracks: [{ showTablature: true, measures: [{ beats: [nt('quarter', 1, 5)] }] }] });
  ed.focus();
  ed.setCursor({ beat: 0 });
  ed.copy();
  const count = () => ed.getScore().tracks[0].measures[0].beats.length;
  rootEl.dispatch('keydown', { ...key('v', CTRL), target: rootEl });
  ok(clock.pendingTimers() > 0, 'fallback scheduled');
  fire('paste', { [CLIP_MIME]: clipText('beats', [nt('quarter', 1, 6)]) });
  clock.advance(10);
  eq([count(), ed.canUndo()], [1, false], 'the page handled it: no paste at all');
  document.removeEventListener('paste', block);
  rootEl.dispatch('keydown', { ...key('v', CTRL), target: rootEl });
  document.activeElement = null; // focus moved away before the native event
  fire('paste', {});
  clock.advance(10);
  eq(count(), 1, 'a native paste elsewhere also ends the fallback');
  ed.destroy();
});
test('F1: inside a shadow root the focus check reads the root node\'s activeElement (document.activeElement is the shadow host)', () => {
  const { ed, rootEl } = mk(fixture());
  ed.focus();
  const host = makeContainer();
  rootEl.getRootNode = () => ({ activeElement: rootEl });
  document.activeElement = host;
  ed.setCursor({ measure: 0, beat: 0 });
  const { e, clipboardData } = fire('copy');
  eq([e.defaultPrevented, JSON.parse(clipboardData.data.get(CLIP_MIME)).tracks[0].beats.length], [true, 1]);
  const other = makeContainer();
  rootEl.getRootNode = () => ({ activeElement: other });
  eq(fire('copy').e.defaultPrevented, false, 'focus elsewhere in the shadow root: ignored');
  delete rootEl.getRootNode;
  ed.destroy();
});
test('F2: a cut event writes clipboardData first; when it throws or is missing the score is unchanged, the event is left alone, the clip stays in the internal clipboard and that is said', () => {
  const { ed, spoken } = mk(fixture());
  ed.focus();
  ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 1 } });
  spoken();
  const before = ed._model;
  const denied = fire('cut', {}, { throws: true });
  eq([denied.e.defaultPrevented, ed._model === before, ed.canUndo()], [false, true, false]);
  eq([spoken(), ed.lastMessage], ['Clipboard unavailable, nothing cut. 2 beats copied in the editor', 'Clipboard unavailable, nothing cut. 2 beats copied in the editor']);
  eq(ed.getSelection().beatCount, 2, 'nothing changed, so the selection stays');
  const bare = document.dispatch('cut', {});
  eq([bare.defaultPrevented, ed._model === before], [false, true], 'no clipboardData at all');
  ed.clearSelection();
  ed.setCursor({ measure: 3, beat: 1 });
  eq(ed.paste(), true, 'the internal clipboard has the clip');
  eq(ed.getScore().tracks[0].measures[3].beats.length, 3);
  ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 0 } });
  const okCut = fire('cut');
  eq([okCut.e.defaultPrevented, okCut.clipboardData.data.has(CLIP_MIME), okCut.clipboardData.data.has('text/plain'), ed.getScore().tracks[0].measures[0].beats[0].type], [true, true, true, 'rest']);
  ed.destroy();
});
test('destroy removes the document listeners (listenerCount restored); two editors: only the focused one acts on a native event', () => {
  const n0 = document.listenerCount();
  const a = mk(fixture());
  const b = mk(fixture());
  eq(document.listenerCount(), n0 + 6);
  b.ed.focus();
  b.ed.setCursor({ measure: 0, beat: 0 });
  const { clipboardData } = fire('copy');
  eq(JSON.parse(clipboardData.data.get(CLIP_MIME)).tracks[0].beats.length, 1);
  eq(a.ed.lastMessage, '', 'editor A did nothing');
  a.ed.destroy(); b.ed.destroy();
  eq(document.listenerCount(), n0);
});
test('B10 (controller, 300 steps): keys, selection, fill, reflow, ranged deletes and clipboard events keep sanitizeScore(model) === model and a valid cursor; undo all restores the start, redo all the end', () => {
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const rnd = mulberry32(2303);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const KEYS = [key('ArrowRight'), key('ArrowLeft'), key('ArrowDown'), key('5'), key('7'), key('r'), key('f'), key('F', SHIFT), key('Delete'), key('Delete', CTRL), key('Delete', SHIFT),
    key('ArrowRight', SHIFT), key('ArrowRight', SHIFT), key('ArrowLeft', SHIFT), key('End', SHIFT), key('ArrowRight', { ctrlKey: true, shiftKey: true }), key('a', CTRL), key('Escape'), key('m'), key('i'), key('v'), key('PageDown'), key('PageUp')];
  const { ed, clock } = mk(fixture(), { historyLimit: 1000 });
  ed.focus();
  const start = ed._model;
  for (let i = 0; i < 300; i++) {
    const r = rnd();
    if (r < 0.1) fire('copy');
    else if (r < 0.15) fire('cut');
    else if (r < 0.25) fire('paste');
    else ed.handleKey(pick(KEYS));
    clock.advance(1000);
    ok(sanitizeScore(ed._model) === ed._model, `step ${i}`);
    eq(clampCursor(ed._model, ed._cursor), ed._cursor, `step ${i}: valid cursor`);
  }
  const end = ed._model;
  while (ed.undo());
  ok(ed._model === start, 'undo all');
  while (ed.redo());
  ok(ed._model === end, 'redo all');
  ed.destroy();
});

// ---------- demo (criterion 43) ----------
const DE = await imp('examples/editor-demo-edit.js');
const DT = await imp('examples/editor-demo-tracks.js');
const DM = await imp('examples/editor-demo-measure.js');
const fsMod = await import('node:fs');
const html = fsMod.readFileSync(path.join(root, 'editor.html'), 'utf8');
test('demo helpers: Selection status text, clip text check, the Remove confirm with tempo marks, the pickup patch from the Measure dialog', () => {
  eq(DE.selectionText(null), '–');
  eq(DE.selectionText({ kind: 'beats', beatCount: 6, measures: [1, 2] }), '6 beats, measures 2–3');
  eq(DE.selectionText({ kind: 'beats', beatCount: 4, measures: [1, 1] }), '4 beats, measure 2');
  eq(DE.selectionText({ kind: 'beats', beatCount: 1, measures: [0, 0] }), '1 beat, measure 1');
  eq(DE.selectionText({ kind: 'measures', beatCount: 9, measures: [1, 3] }), '3 measures (2–4)');
  eq(DE.selectionText({ kind: 'measures', beatCount: 2, measures: [1, 1] }), '1 measure (2)');
  eq([DE.isClipText(clipText('beats', [])), DE.isClipText('{"type":"x"}'), DE.isClipText('music-score-clip'), DE.isClipText(undefined)], [true, false, false, false]);
  eq(DE.isClipText(clipText('beats', []) + ' '.repeat(EDITOR_LIMITS.jsonChars)), false, 'the length cap applies');
  ok(Object.isFrozen(ScoreEditor) || Object.getOwnPropertyDescriptor(ScoreEditor, 'looksLikeClip').writable === false, 'a read-only static');
  eq(DT.removeConfirm('Guitar', { notes: 24, tempoMarks: 1 }), 'Remove track "Guitar"? Its 24 notes and 1 tempo mark will be deleted.');
  eq(DT.removeConfirm('Guitar', { notes: 0, tempoMarks: 2 }), 'Remove track "Guitar"? Its 2 tempo marks will be deleted.');
  eq(DT.removeConfirm('Guitar', { notes: 1, tempoMarks: 0 }), 'Remove track "Guitar"? Its 1 note will be deleted.');
  eq(DT.removeConfirm('Guitar', { notes: 0, tempoMarks: 0 }), 'Remove track "Guitar"?');
  const { ed } = mk({ tracks: [
    { name: 'Gtr', showTablature: true, measures: [{ beats: [nt('quarter', 1, 0, { tempo: 90 }), nt('quarter', 1, 0, { tempo: 100 })] }] },
    { name: 'B', showTablature: true, measures: [{ beats: [nt('half')] }] },
  ] });
  eq(ed.getRemoveTrackImpact(0), { notes: 2, tempoMarks: 1 }, 'the onset-0 mark moves to track 2, the other one is dropped');
  eq(ed.getRemoveTrackImpact(1), { notes: 1, tempoMarks: 0 });
  throws(() => ed.getRemoveTrackImpact(2), RangeError);
  ed.setCursor({ measure: 0, beat: 0 });
  const info = ed.getCursorInfo();
  const m = ed.getMeasureSettings(0, 0);
  const v = DM.measureValues(m, info);
  eq(v.pickup, false);
  eq(DM.measurePatch(m, { ...v, pickup: true }, 0, info).patch, { pickup: true });
  eq(ed.updateMeasure(0, { pickup: true }), true);
  const on = ed.getCursorInfo();
  const v2 = DM.measureValues(ed.getMeasureSettings(0, 0), on);
  eq([v2.pickup, DM.measurePatch(ed.getMeasureSettings(0, 0), { ...v2, pickup: false }, 0, on).patch], [true, { pickup: null }]);
  eq(DM.measurePatch(ed.getMeasureSettings(0, 0), v2, 0, on).patch, {}, 'unchanged');
  ed.destroy();
});
test('demo markup: Edit group (Copy, Cut, Paste) between History and Settings, Measures group (Fill, Reflow) after Duration, Selection status after Beat, the pickup checkbox in the Time signature fieldset, Tempo under All tracks, shortcut sections in order', () => {
  const at = (s) => html.indexOf(s);
  ok(at('aria-label="History"') < at('aria-label="Edit"') && at('aria-label="Edit"') < at('aria-label="Settings"'));
  for (const [id, title] of [['copy-btn', 'Ctrl+C'], ['cut-btn', 'Ctrl+X'], ['paste-btn', 'Paste before the cursor (Ctrl+V)'], ['fill-btn', 'Fill the measure with rests (F)'], ['reflow-btn', 'Move overflow to the next measure (Shift+F)']]) {
    ok(new RegExp(`<button type="button" id="${id}" title="[^"]*${title.replace(/[()+]/g, '\\$&')}`).test(html), id);
  }
  ok(at('aria-label="Duration"') < at('aria-label="Measures"') && at('aria-label="Measures"') < at('id="readonly"'));
  ok(at('id="st-beat"') < at('id="st-selection"') && at('id="st-selection"') < at('id="st-string"'));
  const time = html.slice(at('<legend>Time signature</legend>'), html.indexOf('</fieldset>', at('<legend>Time signature</legend>')));
  ok(time.includes('id="ms-pickup"') && time.includes('aria-describedby="ms-pickup-help"') && time.includes('Pickup measure'));
  ok(at('<legend>Navigation</legend>') < at('id="ms-tempo-set"') && at('id="ms-tempo-set"') < at('id="ms-track-heading"'));
  ok(html.includes('Applies to every track. A mark at this beat on another track is replaced.'));
  const sections = [...html.matchAll(/<section><h3>([^<]+)<\/h3>/g)].map((x) => x[1]);
  eq(sections, ['Move', 'Selection', 'Enter', 'Rhythm', 'Edit', 'Clipboard', 'Measures', 'Effects', 'Settings', 'History']);
});
test('demo wiring: buttons call the public API, Copy / Cut also try navigator.clipboard (refusal ignored), Paste reads the system clipboard only with the permission granted; disabled states; a focused button that turns disabled hands focus on', async () => {
  const mkBtn = (id) => ({ id, disabled: false, handlers: [], addEventListener(t, f) { this.handlers.push(f); }, focus() { fake.activeElement = this; }, click(detail = 0) { return Promise.all(this.handlers.map((f) => f({ detail }))); } });
  const els = Object.fromEntries(['copy-btn', 'cut-btn', 'paste-btn', 'fill-btn', 'reflow-btn'].map((id) => [id, mkBtn(id)]));
  els['st-selection'] = { textContent: '' };
  const writes = [];
  let state = 'prompt';
  const fake = {
    activeElement: null,
    getElementById: (id) => els[id],
    defaultView: { navigator: {
      clipboard: { writeText: (t) => { writes.push(t); return Promise.reject(new Error('denied')); }, readText: async () => clipText('beats', [nt('8th', 1, 9)]) },
      permissions: { query: async () => ({ state }) },
    } },
  };
  const { ed } = mk({ tracks: [{ showTablature: true, measures: [{ beats: [nt('half', 1, 1)] }] }] });
  let refreshed = 0;
  const refreshEdit = DE.wireEdit(fake, ed, { refresh: () => { refreshed++; refreshEdit(ed.getCursorInfo(), ed.isReadOnly()); } });
  refreshEdit(ed.getCursorInfo(), false);
  eq(['copy-btn', 'cut-btn', 'paste-btn'].map((id) => els[id].disabled), [false, false, false]);
  await els['copy-btn'].click();
  eq(writes.length, 1);
  ed.setCursor({ beat: 1 });
  await els['paste-btn'].click();
  eq(ed.getScore().tracks[0].measures[0].beats.map((b) => b.notes[0].fret), [1, 1], 'prompt state: the internal clipboard');
  state = 'granted';
  await els['paste-btn'].click();
  eq(ed.getScore().tracks[0].measures[0].beats.map((b) => b.notes[0].fret), [1, 9, 1], 'granted: the system clipboard (before the cursor beat; the full measure has no slot)');
  ed.setCursor({ beat: 3 });
  refreshEdit(ed.getCursorInfo(), false);
  eq([els['copy-btn'].disabled, els['cut-btn'].disabled, els['st-selection'].textContent], [false, false, '–'], 'overfull: no slot, the cursor is on a beat');
  ed.setCursor({ beat: 0 });
  els['cut-btn'].focus();
  ed.setReadOnly(true);
  refreshEdit(ed.getCursorInfo(), true);
  eq(['copy-btn', 'cut-btn', 'paste-btn', 'fill-btn', 'reflow-btn'].map((id) => els[id].disabled), [false, true, true, true, true]);
  eq(fake.activeElement, els['copy-btn'], 'focus moved to an enabled sibling');
  ed.setReadOnly(false);
  ed.loadScore({ tracks: [{ showTablature: true, measures: [{ beats: [nt('whole'), nt('quarter')] }] }] });
  await els['reflow-btn'].click();
  eq(ed.getScore().tracks[0].measures.length, 2, 'Reflow goes through handleKey');
  ed.loadScore({ tracks: [{ showTablature: true, measures: [{ beats: [] }] }] });
  await els['fill-btn'].click();
  eq(ed.getScore().tracks[0].measures[0].beats, [rest('whole')]);
  ok(refreshed >= 5);
  ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 0 } });
  refreshEdit(ed.getCursorInfo(), false);
  eq(els['st-selection'].textContent, '1 measure (1)');
  ed.destroy();
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
