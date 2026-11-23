// 2.3.2 edge cases at controller level under the DOM shim: extending across the anchor, Ctrl+A with one / several /
// short tracks, setSelection with hidden / out-of-range tracks, one-beat measures, the column band over hidden
// tracks and system breaks, read-only, undo of column edits, refusals that keep the selection.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-columns-edge-dom.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock, makeClipboardData } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const { CLIP_MIME } = await imp('src/editor/model/clip.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const SHIFT = { shiftKey: true };
const CTRL = { ctrlKey: true };
const CS = { ctrlKey: true, shiftKey: true };
const byClass = (n, c, out = []) => { if ((n.getAttribute?.('class') || '').split(' ').includes(c)) out.push(n); for (const x of n.children || []) byClass(x, c, out); return out; };
const fire = (kind, init = {}, opts) => { const clipboardData = makeClipboardData(init, opts); return { e: document.dispatch(kind, { clipboardData }), clipboardData }; };

function mk(score, opts = {}) {
  const clock = makeClock();
  clock.requestAnimationFrame = null;
  clock.cancelAnimationFrame = null;
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock, ...opts });
  const events = [];
  for (const t of ['change', 'cursor', 'selection']) ed.on(t, (e) => events.push([t, e]));
  const rootEl = box.children[0];
  const live = rootEl.children[1];
  const spoken = () => { clock.advance(150); return live.textContent.trimEnd(); };
  const press = (...ks) => ks.map((k) => ed.handleKey(typeof k === 'string' ? key(k) : k));
  const down = (k) => rootEl.dispatch('keydown', { ...k, target: rootEl });
  return { ed, box, clock, events, rootEl, spoken, press, down };
}
const trio = () => ({ tracks: [
  tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 2), nt('half', 1, 3)] }, { beats: [nt('quarter', 1, 4), nt('quarter', 1, 5), nt('half', 1, 6)] }, { beats: [nt('whole', 1, 7)] }]),
  tab([{ beats: [nt('half', 2, 1), nt('half', 2, 2)] }, { beats: [nt('quarter', 2, 3), nt('quarter', 2, 4), nt('half', 2, 5)] }, { beats: [nt('whole', 2, 6)] }], { name: 'B' }),
  tab([{ beats: [nt('whole', 3, 1)] }, { beats: [nt('whole', 3, 2)] }, { beats: [nt('whole', 3, 3)] }], { name: 'C' }),
] });
const hiddenMid = () => { const t = trio().tracks; return { tracks: [t[0], { name: 'Hid', showStandardNotation: false, measures: [{ beats: [nt('whole')] }, { beats: [] }, { beats: [] }] }, t[1], t[2]] }; };
const selEvents = (events) => events.filter((e) => e[0] === 'selection');

test('extending down then up across the anchor: up from track 2 selects tracks 1-2, down returns the beat range, down again selects tracks 2-3; the cursor follows the focus', () => {
  const { ed, press, spoken } = mk(trio());
  ed.setCursor({ track: 1, measure: 1, beat: 1 });
  spoken();
  press(key('ArrowUp', SHIFT));
  eq([ed.getSelection().tracks, ed.getSelection().kind, ed.getCursor().track, spoken()], [[0, 1], 'measures', 0, 'Selected measure 2, tracks 1 to 2']);
  press(key('ArrowDown', SHIFT));
  eq([ed.getSelection().tracks, ed.getSelection().kind, ed.getCursor().track, spoken()], [[1], 'beats', 1, 'Selected measure 2 beat 2, 1 beat']);
  press(key('ArrowDown', SHIFT));
  eq([ed.getSelection().tracks, ed.getCursor().track, spoken()], [[1, 2], 2, 'Selected measure 2, tracks 2 to 3']);
  press(key('ArrowDown', SHIFT));
  eq([ed.getSelection().tracks, spoken()], [[1, 2], 'Last track']);
  press(key('ArrowUp', SHIFT), key('ArrowUp', SHIFT));
  eq([ed.getSelection().tracks, ed.getCursor().track], [[0, 1], 0]);
  ed.destroy();
});
test('extending from a hidden-track neighbour: down from track 1 skips the hidden track, up from the last goes back over it; at the edges nothing is emitted', () => {
  const { ed, press, spoken, events } = mk(hiddenMid());
  ed.setCursor({ track: 3, measure: 0, beat: 0 });
  press(key('PageUp', SHIFT), key('PageUp', SHIFT));
  eq([ed.getSelection().tracks, spoken()], [[0, 2, 3], 'Selected measure 1, tracks 1 to 4, 1 hidden track skipped']);
  press(key('PageDown', SHIFT));
  eq([ed.getSelection().tracks, ed.getCursor().track], [[2, 3], 2], 'anchor on track 4: back down from track 1 over the hidden one gives tracks 3-4');
  events.length = 0;
  press(key('PageDown', SHIFT), key('PageDown', SHIFT));
  eq([ed.getSelection().tracks, ed.getCursor().track], [[3], 3], 'back on the anchor track: single-track range');
  ed.destroy();
});
test('Ctrl+A: with one visible track the second and third press stay on the track (no events); with several, a third press repeats; Esc after the second clears; a column Ctrl+A then Shift+Down says "Last track"', () => {
  const one = mk({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [] }])] });
  one.press(key('a', CTRL));
  const first = one.ed.getSelection();
  one.events.length = 0;
  one.press(key('a', CTRL), key('a', CTRL));
  eq([one.ed.getSelection(), one.events.filter((e) => e[0] === 'selection'), one.spoken()], [first, [], 'Selected all of Track 1 Gtr, 2 measures']);
  const t = mk(trio());
  t.press(key('a', CTRL), key('a', CTRL));
  t.spoken();
  t.press(key('ArrowDown', SHIFT));
  eq([t.spoken(), t.ed.getSelection().tracks], ['Last track', [0, 1, 2]]);
  t.press('Escape');
  eq([t.ed.getSelection(), t.spoken()], [null, 'Selection cleared']);
  t.press(key('a', CTRL));
  eq(t.ed.getSelection().tracks, [t.ed.getCursor().track], 'a fresh Ctrl+A is the cursor track again');
  one.ed.destroy(); t.ed.destroy();
});
test('Ctrl+A twice from a short track (fewer measures than the score) still reaches all tracks; Ctrl+A twice in read-only mode; second press from a column that already covers every measure', () => {
  const score = { tracks: [
    tab([{ beats: [nt('whole', 1, 1)] }, { beats: [nt('whole', 1, 2)] }, { beats: [nt('whole', 1, 3)] }, { beats: [nt('whole', 1, 4)] }]),
    tab([{ beats: [nt('whole', 2, 1)] }], { name: 'Short' }),
    tab([{ beats: [nt('whole', 2, 1)] }, { beats: [] }], { name: 'Mid' }),
  ] };
  for (const tr of [0, 1, 2]) {
    const t = mk(score, { readOnly: tr === 1 });
    t.ed.setCursor({ track: tr, measure: 0, beat: 0 });
    t.press(key('a', CTRL), key('a', CTRL));
    eq([t.ed.getSelection().tracks, t.ed.getSelection().measures, t.spoken()], [[0, 1, 2], [0, 3], 'Selected all measures, all tracks'], `from track ${tr}`);
    t.ed.destroy();
  }
  const t = mk(trio());
  t.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 1, measure: 2, beat: 0 } });
  t.press(key('a', CTRL));
  eq([t.ed.getSelection().tracks, t.spoken()], [[0, 1, 2], 'Selected all measures, all tracks'], 'a column over every measure: Ctrl+A goes straight to all tracks');
  t.ed.destroy();
});
test('setSelection: hidden and out-of-range tracks clamp to visible ones, fractions truncate, a missing anchor track follows the focus, non-finite numbers throw TypeError and change nothing', () => {
  const { ed, events } = mk(hiddenMid());
  const a = ed.setSelection({ anchor: { track: 99, measure: 0, beat: 0 }, focus: { track: -5, measure: 99, beat: 99 } });
  eq([a.tracks, a.measures, ed.getCursor().track], [[0, 2, 3], [0, 2], 0]);
  const b = ed.setSelection({ anchor: { track: 1, measure: 0, beat: 0 }, focus: { track: 3, measure: 1, beat: 0 } });
  eq([b.tracks, b.kind], [[0, 2, 3], 'measures'], 'a hidden anchor track clamps to the nearest visible one, the lower first');
  const c = ed.setSelection({ anchor: { track: 2.9, measure: 0.7, beat: 0 }, focus: { track: 3.2, measure: 1.9, beat: 0 } });
  eq([c.tracks, c.measures], [[2, 3], [0, 1]]);
  const d = ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { track: 2, measure: 0, beat: 0 } });
  eq(d.tracks, [2]);
  const before = ed.getSelection();
  events.length = 0;
  for (const bad of [{ anchor: { track: NaN, measure: 0, beat: 0 }, focus: { measure: 0, beat: 0 } }, { anchor: { measure: 0, beat: 0 }, focus: { track: Infinity, measure: 0, beat: 0 } }, { anchor: { track: '1', measure: 0, beat: 0 }, focus: { measure: 0, beat: 0 } }, null, { anchor: 1, focus: {} }]) {
    let err = null;
    try { ed.setSelection(bad); } catch (e) { err = e; }
    ok(err instanceof TypeError, JSON.stringify(bad));
  }
  eq([ed.getSelection(), events], [before, []]);
  ed.destroy();
});
test('one-beat rule: the second press goes on ("End of score" on a one-measure score), Esc then Ctrl+Shift+Left selects the measure again, no selection event for an unchanged first press, a live selection is never re-selected', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('whole')] }])] });
  t.press(key('ArrowRight', CS));
  eq([t.ed.getSelection().measures, t.spoken()], [[0, 0], 'Selected measure 1, 1 beat']);
  t.events.length = 0;
  t.press(key('ArrowRight', CS));
  eq([t.spoken(), selEvents(t.events)], ['End of score', []]);
  t.press('Escape');
  t.press(key('ArrowLeft', CS));
  eq([t.ed.getSelection().measures, t.spoken()], [[0, 0], 'Selection cleared. Selected measure 1, 1 beat']);
  t.press(key('ArrowLeft', CS));
  eq(t.spoken(), 'Start of score');
  eq(t.ed.canUndo(), false);
  t.ed.destroy();
  const three = mk({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }, { beats: [nt('whole')] }])] });
  three.ed.setCursor({ measure: 1, beat: 0 });
  three.press(key('ArrowLeft', CS));
  eq(three.ed.getSelection().measures, [1, 1]);
  three.press(key('ArrowLeft', CS));
  eq(three.ed.getSelection().measures, [0, 1]);
  three.press(key('ArrowRight', CS), key('ArrowRight', CS));
  eq(three.ed.getSelection().measures, [1, 2], 'with a live selection: the normal path (the anchor stays on measure 2)');
  three.ed.destroy();
});
test('overlay: the band spans hidden tracks without extra staves, takes its overhang from the top and bottom staves, and each system segment starts and ends at its own measures', () => {
  const nm = 12;
  const score = { tracks: [
    tab(Array.from({ length: nm }, (_, mi) => ({ beats: [nt('quarter', 1, mi % 5), nt('quarter', 2, 1), nt('half', 3, 2)] })), { showStandardNotation: false }),
    { name: 'Hid', showStandardNotation: false, measures: Array.from({ length: nm }, () => ({ beats: [] })) },
    { name: 'Notes', measures: Array.from({ length: nm }, () => ({ beats: [{ type: 'note', duration: 'whole', notes: [{ pitch: 'C4' }] }] })) },
  ] };
  const { ed } = mk(score);
  ed.focus();
  const idx = ed._view.index;
  const style = ed._view.style;
  const s = ed._view.renderer.theme.staffLineSpacing;
  ed.setSelection({ anchor: { track: 0, measure: 1, beat: 0 }, focus: { track: 2, measure: 10, beat: 0 } });
  const band = byClass(ed._view.svg, 'editor-sel-columns');
  const systems = [];
  for (let mi = 1; mi <= 10; mi++) { const m = idx.measures.get(`0:${mi}`); if (!systems.length || systems[systems.length - 1].sys !== m.sysIdx) systems.push({ sys: m.sysIdx, first: mi, last: mi }); else systems[systems.length - 1].last = mi; }
  ok(systems.length > 1, 'the selection crosses system breaks');
  eq(band.length, systems.length * 2);
  ok(band.every((n) => n.tag === 'path'), 'open at the breaks: paths');
  const near = (x, y, m) => ok(Math.abs(x - y) < 0.5, `${m}: ${x} vs ${y}`);
  const tints = band.filter((n) => n.getAttribute('class').startsWith('editor-sel '));
  tints.forEach((n, i) => {
    const seg = systems[i];
    const nums = (n.getAttribute('d').match(/-?\d+(\.\d+)?/g) || []).map(Number);
    const xs = nums.filter((_, k) => k % 2 === 0);
    const left = idx.measures.get(`0:${seg.first}`).x;
    const right = idx.measures.get(`0:${seg.last}`).endX;
    near(Math.min(...xs), left, `segment ${i} left`);
    near(Math.max(...xs), right, `segment ${i} right`);
    const ys = nums.filter((_, k) => k % 2 === 1);
    const top = idx.staves.get(`${seg.sys}:0`)[0];
    const bottom = idx.staves.get(`${seg.sys}:2`).at(-1);
    near(Math.min(...ys), top.y - style.tabColOverhangSp * s, `segment ${i} top: TAB staff overhang`);
    near(Math.max(...ys), bottom.y + 4 * s + style.notationColOverhangSp * s, `segment ${i} bottom: notation staff overhang`);
    ok(!idx.staves.get(`${seg.sys}:1`), 'the hidden track has no staves');
  });
  ed.destroy();
});
test('read-only: copy and track extends work, Delete / Ctrl+Delete / Shift+Delete / F / effects / transpose say "Read-only" and change nothing, cut and paste are refused, Ctrl+V is not prevented', () => {
  const t = mk(trio(), { readOnly: true });
  t.ed.focus();
  t.press(key('a', CTRL), key('a', CTRL));
  t.spoken();
  const before = t.ed._model;
  const sel = t.ed.getSelection();
  for (const k of [key('Delete'), key('Delete', CTRL), key('Delete', SHIFT), key('f'), key('p'), key('ArrowUp', CTRL)]) {
    t.press(k);
    eq([t.spoken(), t.ed._model === before, t.ed.getSelection()], ['Read-only', true, sel], k.key);
  }
  const text = t.ed.copy();
  eq(JSON.parse(text).tracks.length, 3);
  t.spoken();
  eq([t.ed.cut(), t.spoken(), t.ed._model === before], [null, 'Read-only', true]);
  eq([t.ed.paste(text), t.spoken()], [false, 'Read-only']);
  eq(t.down(key('v', CTRL)).defaultPrevented, false);
  t.clock.advance(0);
  eq(t.ed._model === before, true);
  t.ed.destroy();
});
test('refusals keep the column selection: a transpose that would fail on the last track, "Needs a TAB staff", Ctrl+Delete of blank measures; a beats clip pasted over a column goes to the top track only; refusals add no history', () => {
  const score = { tracks: [
    tab([{ beats: [nt('whole', 1, 3)] }]),
    tab([{ beats: [nt('whole', 1, 24)] }], { name: 'Last' }),
  ] };
  const t = mk(score);
  t.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 1, measure: 0, beat: 0 } });
  t.spoken();
  const sel = t.ed.getSelection();
  t.press(key('ArrowUp', CTRL));
  eq([t.spoken(), t.ed.getSelection(), t.ed.canUndo()], ["Can't transpose, measure 1 on track 2 would go above fret 24", sel, false]);
  t.press(key('ArrowDown', CTRL));
  eq([t.ed.canUndo(), t.ed.getSelection().tracks], [true, [0, 1]], 'down works: the selection is kept and one undo step added');
  t.ed.undo();
  const beats = JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'beats', tracks: [{ beats: [nt('quarter')] }] });
  t.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 1, measure: 0, beat: 0 } });
  t.spoken();
  const keep = t.ed._model.tracks[1];
  eq([t.ed.paste(beats), t.spoken(), t.ed._model.tracks[1] === keep, t.ed.getSelection()], [true, 'Pasted 1 beat, replaced 1', true, null], 'a beats clip on a column replaces the top part only (C14)');
  t.ed.undo();
  const notation = mk({ tracks: [{ name: 'A', measures: [{ beats: [nt('whole')] }] }, { name: 'B', measures: [{ beats: [nt('whole')] }] }] });
  notation.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 1, measure: 0, beat: 0 } });
  notation.spoken();
  notation.press('x');
  eq([notation.spoken(), notation.ed.getSelection().tracks, notation.ed.canUndo()], ['Needs a TAB staff', [0, 1], false]);
  const blank = mk({ tracks: [tab([{ beats: [] }]), tab([{ beats: [] }], { name: 'B' })] });
  blank.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 1, measure: 0, beat: 0 } });
  blank.press(key('Delete', CTRL));
  eq([blank.spoken(), blank.ed.getSelection().tracks], ['No beats to delete', [0, 1]]);
  t.ed.destroy(); notation.ed.destroy(); blank.ed.destroy();
});
test('column edits are one undo step each and undo restores the same model object: Delete, Ctrl+Delete, Shift+Delete, an effect, cut, overwrite paste, insert paste', () => {
  const t = mk(hiddenMid());
  t.ed.focus();
  const start = t.ed._model;
  const col = () => { t.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 3, measure: 1, beat: 0 } }); t.spoken(); };
  for (const run of [() => t.press('Delete'), () => t.press(key('Delete', CTRL)), () => t.press(key('Delete', SHIFT)), () => t.press('p'), () => fire('cut'), () => t.press(key('Delete'))]) {
    col();
    run();
    ok(t.ed._model !== start, 'changed');
    eq(t.ed.undo(), true);
    ok(t.ed._model === start, 'one undo restores the model');
    ok(sanitizeScore(t.ed._model) === t.ed._model);
  }
  col();
  const text = t.ed.copy();
  col();
  eq(t.ed.paste(text), true);
  const afterOver = t.ed._model;
  ok(t.ed.undo() && t.ed._model === start);
  t.ed.redo();
  ok(t.ed._model === afterOver);
  t.ed.undo();
  t.ed.setCursor({ track: 0, measure: 1, beat: 0 });
  eq(t.ed.paste(text, { insert: true }), true);
  eq(t.ed.getScore().tracks.map((x) => x.measures.length), [5, 5, 5, 5], 'every track gets the columns, the hidden one too');
  ok(t.ed.undo() && t.ed._model === start);
  const f = fire('paste', { [CLIP_MIME]: text });
  ok(f.e.defaultPrevented !== undefined);
  t.ed.destroy();
});

export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-columns-edge-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-columns-edge-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
