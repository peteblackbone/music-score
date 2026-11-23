// 2.3.2 column selection at controller level under the DOM shim: criteria 1-7 with exact wording (track
// extends, hidden tracks and edges, column moves, Ctrl+A twice, the API shape, the column band, clearing and
// read-only), the column clipboard through native events and the fallback (8-16), range edits over a column
// (17-22), accessibility (37), one-beat measures (35), the demo (36) and B10 over 300 steps.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-columns-dom.mjs`.
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
const { EDITOR_LIMITS: L } = await imp('src/editor/model/limits.js');
const { exportedLength } = await imp('src/editor/model/io.js');

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
const findAll = (n, f, out = []) => { if (f(n)) out.push(n); for (const c of n.children || []) findAll(c, f, out); return out; };
const byClass = (n, c) => findAll(n, (x) => (x.getAttribute?.('class') || '').split(' ').includes(c));
const stable = (ed) => ok(sanitizeScore(ed._model) === ed._model, 'sanitize identity');
const fire = (kind, init = {}, opts) => { const clipboardData = makeClipboardData(init, opts); return { e: document.dispatch(kind, { clipboardData }), clipboardData }; };
const TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

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
/** Three visible tracks, 3 measures each (different rhythms, so the nearest onset matters). */
const trio = () => ({ tracks: [
  tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 2), nt('half', 1, 3)] }, { beats: [nt('quarter', 1, 4), nt('quarter', 1, 5), nt('half', 1, 6)] }, { beats: [nt('whole', 1, 7)] }]),
  tab([{ beats: [nt('half', 2, 1), nt('half', 2, 2)] }, { beats: [nt('quarter', 2, 3), nt('quarter', 2, 4), nt('half', 2, 5)] }, { beats: [nt('whole', 2, 6)] }], { name: 'B' }),
  tab([{ beats: [nt('whole', 3, 1)] }, { beats: [nt('whole', 3, 2)] }, { beats: [nt('whole', 3, 3)] }], { name: 'C' }),
] });
/** trio with a hidden track inserted at index 1 and a TAB-only bass last. */
const withHidden = () => { const t = trio().tracks; return { tracks: [t[0], { name: 'Hid', showStandardNotation: false, measures: [{ beats: [nt('whole')] }, { beats: [] }, { beats: [] }] }, t[1], tab(t[2].measures, { name: 'Bass', showStandardNotation: false })] }; };
const selEvents = (events) => events.filter((e) => e[0] === 'selection');

// ---------- criteria 1-7 ----------
test('criterion 1: from track 1 measure 2 beat 2, Shift+PageDown moves the cursor to track 2 at the nearest onset and selects measure 2 on tracks 1-2 ("Selected measure 2, tracks 1 to 2"); Shift+PageUp restores the beat selection; Shift+Down / Up the same', () => {
  for (const [dn, up] of [['PageDown', 'PageUp'], ['ArrowDown', 'ArrowUp']]) {
    const { ed, events, press, spoken } = mk(trio());
    ed.setCursor({ track: 0, measure: 1, beat: 1 });
    spoken();
    events.length = 0;
    eq(press(key(dn, SHIFT)), [true]);
    eq(ed.getCursor(), { track: 1, measure: 1, beat: 1, string: 1 }, 'the beat at the same onset (1/4)');
    eq(ed.getSelection(), { kind: 'measures', track: 0, start: { measure: 1, beat: 0 }, end: { measure: 1, beat: 0 }, beatCount: 6, measures: [1, 1], tracks: [0, 1] });
    eq([spoken(), events.map((e) => e[0])], ['Selected measure 2, tracks 1 to 2', ['cursor', 'selection']]);
    press(key(up, SHIFT));
    eq(ed.getSelection(), { kind: 'beats', track: 0, start: { measure: 1, beat: 1 }, end: { measure: 1, beat: 1 }, beatCount: 1, measures: [1, 1], tracks: [0] });
    eq(spoken(), 'Selected measure 2 beat 2, 1 beat');
    eq(ed.getCursor().track, 0);
    press(key(dn, SHIFT), key(dn, SHIFT));
    eq([ed.getSelection().tracks, spoken()], [[0, 1, 2], 'Selected measure 2, tracks 1 to 3']);
    ed.destroy();
  }
});
test('criterion 2: a hidden track is skipped and not listed ("1 hidden track skipped"); at the last / first visible track "Last track" / "First track" and the selection does not change (no selection event)', () => {
  const { ed, events, press, spoken } = mk(withHidden());
  ed.setCursor({ track: 0, measure: 0, beat: 0 });
  press(key('ArrowDown', SHIFT));
  eq([ed.getCursor().track, ed.getSelection().tracks, spoken()], [2, [0, 2], 'Selected measure 1, tracks 1 to 3, 1 hidden track skipped']);
  press(key('ArrowDown', SHIFT));
  const sel = ed.getSelection();
  eq([sel.tracks, spoken()], [[0, 2, 3], 'Selected measure 1, tracks 1 to 4, 1 hidden track skipped']);
  events.length = 0;
  eq(press(key('PageDown', SHIFT)), [true]);
  eq([ed.getSelection(), spoken(), events, ed.getCursor().track], [sel, 'Last track', [], 3]);
  const top = mk(withHidden());
  top.press(key('ArrowUp', SHIFT));
  eq([top.ed.getSelection(), top.spoken(), top.events], [null, 'First track', []]);
  top.press(key('ArrowRight', SHIFT));
  top.events.length = 0;
  top.press(key('PageUp', SHIFT));
  eq([top.ed.getSelection().beatCount, top.spoken(), top.events], [2, 'First track', []], 'a beat selection stays as it was');
  ed.destroy(); top.ed.destroy();
});
test('criterion 3: in column mode Shift+Right adds a measure, Shift+Left takes it back, Ctrl+Shift+Left / Right move a whole measure, Shift+Home / End change nothing and repeat the words, Ctrl+Shift+End extends to the last measure; at the end "End of score"', () => {
  const { ed, events, press, spoken } = mk(trio());
  ed.setCursor({ track: 0, measure: 0, beat: 1 });
  press(key('ArrowDown', SHIFT));
  spoken();
  press(key('ArrowRight', SHIFT));
  eq([ed.getSelection().measures, ed.getCursor(), spoken()], [[0, 1], { track: 1, measure: 1, beat: 2, string: 1 }, 'Selected measures 1 to 2, tracks 1 to 2']);
  press(key('ArrowLeft', SHIFT));
  eq([ed.getSelection().measures, ed.getCursor().measure, ed.getCursor().beat, spoken()], [[0, 0], 0, 0, 'Selected measure 1, tracks 1 to 2']);
  press(key('ArrowRight', CS));
  eq(ed.getSelection().measures, [0, 1]);
  events.length = 0;
  press(key('Home', SHIFT));
  eq([ed.getSelection().measures, spoken(), events], [[0, 1], 'Selected measures 1 to 2, tracks 1 to 2', []]);
  press(key('End', SHIFT));
  eq([spoken(), events], ['Selected measures 1 to 2, tracks 1 to 2', []]);
  press(key('End', CS));
  eq([ed.getSelection().measures, ed.getCursor(), spoken()], [[0, 2], { track: 1, measure: 2, beat: 0, string: 1 }, 'Selected measures 1 to 3, tracks 1 to 2']);
  press(key('ArrowRight', SHIFT));
  eq([ed.getSelection().measures, spoken()], [[0, 2], 'End of score']);
  press(key('ArrowLeft', CS), key('ArrowLeft', CS), key('ArrowLeft', CS));
  eq([ed.getSelection().measures, spoken()], [[0, 0], 'Start of score']);
  press(key('Home', CS));
  eq([ed.getSelection().measures, ed.getCursor().track], [[0, 0], 1], 'Ctrl+Shift+Home stays a column (the anchor keeps its track)');
  ed.destroy();
});
test('criterion 4: Ctrl+A twice selects every measure of every visible track ("Selected all measures, all tracks"), the cursor on the last visible track\'s last position; a third press changes nothing (no event) and repeats it', () => {
  const { ed, events, press, spoken } = mk(withHidden());
  ed.setCursor({ track: 2, measure: 1, beat: 0 });
  press(key('a', CTRL));
  eq([ed.getSelection().tracks, spoken()], [[2], 'Selected all of Track 3 B, 3 measures']);
  press(key('a', CTRL));
  const all = ed.getSelection();
  eq(all, { kind: 'measures', track: 0, start: { measure: 0, beat: 0 }, end: { measure: 2, beat: 0 }, beatCount: 7 + 6 + 3, measures: [0, 2], tracks: [0, 2, 3] });
  eq([ed.getCursor(), spoken()], [{ track: 3, measure: 2, beat: 0, string: 1 }, 'Selected all measures, all tracks']);
  events.length = 0;
  press(key('a', CTRL));
  eq([ed.getSelection(), spoken(), events], [all, 'Selected all measures, all tracks', []]);
  const one = mk({ tracks: [tab([{ beats: [nt('whole')] }]), { showStandardNotation: false, measures: [{ beats: [] }] }] });
  one.press(key('a', CTRL), key('a', CTRL));
  eq([one.ed.getSelection().tracks, one.spoken()], [[0], 'Selected all of Track 1 Gtr, 1 measure'], 'one visible track: as in 2.3.1');
  ed.destroy(); one.ed.destroy();
});
test('criterion 5: getSelection of a column (D4), a single-track selection is 2.3.1 plus tracks; setSelection across tracks returns a column, clamps a hidden anchor track to the nearest visible one; getCursorInfo().selection matches; the selection event fires only when the info changes', () => {
  const { ed, events } = mk(withHidden());
  const info = ed.setSelection({ anchor: { track: 3, measure: 2, beat: 0 }, focus: { track: 0, measure: 1, beat: 2 } });
  eq(info, { kind: 'measures', track: 0, start: { measure: 1, beat: 0 }, end: { measure: 2, beat: 0 }, beatCount: 3 + 1 + 3 + 1 + 1 + 1, measures: [1, 2], tracks: [0, 2, 3] });
  eq([ed.getCursor(), ed.getCursorInfo().selection], [{ track: 0, measure: 1, beat: 2, string: 1 }, info]);
  const copy = ed.getSelection();
  copy.tracks.push(9);
  eq(ed.getSelection().tracks, [0, 2, 3], 'a copy');
  const hid = ed.setSelection({ anchor: { track: 1, measure: 0, beat: 0 }, focus: { track: 0, measure: 0, beat: 1 } });
  eq([hid.kind, hid.tracks, hid.beatCount], ['beats', [0], 2], 'the hidden track 1 clamps to track 0 (the nearest, lower first)');
  events.length = 0;
  ed.setSelection({ anchor: { track: 1, measure: 0, beat: 0 }, focus: { track: 0, measure: 0, beat: 1 } });
  eq(selEvents(events), [], 'same info: no event');
  const one = ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 0 } });
  eq(Object.keys(one), ['kind', 'track', 'start', 'end', 'beatCount', 'measures', 'tracks']);
  ed.destroy();
});
test('criterion 6: the column band is one tint plus one outline per system (class editor-sel-columns) from the top of the first selected track\'s top staff to the bottom of the last one\'s bottom staff, open at system breaks, dimmed when unfocused; hidden tracks take no space; a single-track selection draws no column band', () => {
  const score = { tracks: [
    tab(Array.from({ length: 12 }, (_, mi) => ({ beats: [nt('quarter', 1, mi), nt('quarter', 2, 1), nt('half', 3, 2)] }))),
    { name: 'Hid', showStandardNotation: false, measures: Array.from({ length: 12 }, () => ({ beats: [] })) },
    tab(Array.from({ length: 12 }, () => ({ beats: [nt('whole', 4, 3)] })), { name: 'Bass', showStandardNotation: false, tuning: ['E1', 'A1', 'D2', 'G2'] }),
  ] };
  const { ed } = mk(score);
  ed.focus();
  const svg = ed._view.svg;
  const idx = ed._view.index;
  const style = ed._view.style;
  const s = ed._view.renderer.theme.staffLineSpacing;
  ed.setSelection({ anchor: { track: 0, measure: 2, beat: 0 }, focus: { track: 2, measure: 2, beat: 0 } });
  let band = byClass(svg, 'editor-sel-columns');
  eq(band.map((n) => `${n.tag}.${n.getAttribute('class')}`), ['rect.editor-sel editor-sel-columns', 'rect.editor-sel-outline editor-sel-columns']);
  const m = idx.measures.get('0:2');
  const top = idx.staves.get(`${m.sysIdx}:0`)[0];
  const bottom = idx.staves.get(`${m.sysIdx}:2`).at(-1);
  const near = (a, b, m) => ok(Math.abs(a - b) < 0.01, `${m}: ${a} vs ${b}`);
  near(+band[0].getAttribute('x'), m.x, 'x from the top track measure');
  near(+band[0].getAttribute('width'), m.endX - m.x, 'width');
  near(+band[0].getAttribute('y'), top.y - style.notationColOverhangSp * s, 'top of the notation staff of track 1 with its overhang');
  near(+band[0].getAttribute('y') + +band[0].getAttribute('height'), bottom.y + bottom.lineBottom + style.tabColOverhangSp * s, 'bottom of the bass TAB staff with its overhang');
  eq([band[0].getAttribute('fill-opacity'), band[1].getAttribute('stroke-opacity'), band[1].getAttribute('fill'), band[0].getAttribute('rx')], ['0.14', '1', 'none', String(style.selRadiusSp * s)]);
  ed.setSelection({ anchor: { track: 0, measure: 1, beat: 0 }, focus: { track: 2, measure: 9, beat: 0 } });
  band = byClass(svg, 'editor-sel-columns');
  const systems = new Set(Array.from({ length: 9 }, (_, i) => idx.measures.get(`0:${i + 1}`).sysIdx));
  eq([band.length, systems.size > 1, band.every((n) => n.tag === 'path')], [systems.size * 2, true, true], 'one tint and one outline per system, open at the breaks');
  ed._focusChanged(false);
  eq(byClass(svg, 'editor-sel-columns').map((n) => n.getAttribute(n.getAttribute('fill') === 'none' ? 'stroke-opacity' : 'fill-opacity')).slice(0, 2), [String(style.unfocused.selFill), String(style.unfocused.selStroke)]);
  ed.setSelection({ anchor: { track: 0, measure: 1, beat: 0 }, focus: { track: 0, measure: 1, beat: 1 } });
  eq([byClass(svg, 'editor-sel-columns').length, byClass(svg, 'editor-sel').length], [0, 2], 'a single-track selection: the 2.3.1 shapes');
  ed.destroy();
});
test('criterion 7: every 2.3 clearing rule applies to a column (plain move, Esc, an edit, undo, load, a click); read-only: you can still extend to tracks, select all tracks and copy; edits say "Read-only"', () => {
  const t = mk(trio());
  const col = () => { t.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 2, measure: 1, beat: 0 } }); t.spoken(); };
  col();
  t.press('ArrowRight');
  eq([t.ed.getSelection(), t.spoken().startsWith('Selection cleared')], [null, true], 'a plain move');
  col();
  t.press('Escape');
  eq([t.ed.getSelection(), t.spoken()], [null, 'Selection cleared']);
  col();
  t.press('m');
  eq(t.ed.getSelection(), null, 'an edit');
  t.ed.undo();
  col();
  t.press(key('z', CTRL));
  eq(t.ed.getSelection(), null, 'undo');
  col();
  t.ed.loadScore(trio());
  eq(t.ed.getSelection(), null, 'load');
  col();
  t.ed._moveTo({ track: 1, measure: 0, beat: 0, string: 1 });
  eq(t.ed.getSelection(), null, 'a click');
  t.ed.destroy();
  const ro = mk(trio(), { readOnly: true });
  ro.press(key('ArrowDown', SHIFT));
  eq(ro.ed.getSelection().tracks, [0, 1]);
  ro.press(key('a', CTRL), key('a', CTRL));
  eq([ro.ed.getSelection().tracks, ro.spoken()], [[0, 1, 2], 'Selected all measures, all tracks']);
  const before = ro.ed._model;
  ro.press('Delete');
  eq(ro.spoken(), 'Read-only');
  eq(JSON.parse(ro.ed.copy()).tracks.length, 3);
  eq(ro.spoken(), 'Copied 3 measures, 3 tracks');
  ok(ro.ed._model === before);
  ro.ed.destroy();
});

// ---------- clipboard (criteria 8-16) ----------
test('criteria 8-9: the copy event writes one clip with an entry per selected track ("Copied 2 measures, 3 tracks"); the cut event clears every selected track in one undo step ("Cut 2 measures, 3 tracks, now rests"); only rests: "Copied ..., already rests"; a refused clipboardData cuts nothing and says so', () => {
  const t = mk(withHidden());
  t.ed.focus();
  const col = () => { t.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 3, measure: 1, beat: 0 } }); t.spoken(); };
  col();
  const c = fire('copy');
  const clip = JSON.parse(c.clipboardData.data.get(CLIP_MIME));
  eq([c.e.defaultPrevented, clip.kind, clip.tracks.length, clip.tracks.map((x) => x.measures.length), c.clipboardData.data.get('text/plain') === c.clipboardData.data.get(CLIP_MIME)], [true, 'measures', 3, [2, 2, 2], true]);
  eq(t.spoken(), 'Copied 2 measures, 3 tracks');
  const before = t.ed._model;
  const cut = fire('cut');
  eq([cut.e.defaultPrevented, JSON.parse(cut.clipboardData.data.get(CLIP_MIME)).tracks.length], [true, 3]);
  eq(t.spoken(), 'Cut 2 measures, 3 tracks, now rests');
  const sc = t.ed.getScore();
  for (const ti of [0, 2, 3]) ok(sc.tracks[ti].measures.slice(0, 2).every((m) => m.beats.every((b) => b.type === 'rest')), `track ${ti}`);
  eq([sc.tracks[1], t.ed.getSelection(), t.ed.getCursor().track], [withHidden().tracks[1], null, 0], 'hidden untouched; the cursor on the top track');
  t.ed.undo();
  ok(t.ed._model === before);
  eq(t.spoken(), 'Undo: cut');
  t.ed.redo();
  col();
  fire('cut');
  eq(t.spoken(), 'Copied 2 measures, 3 tracks, already rests');
  t.ed.undo();
  col();
  const refused = fire('cut', {}, { throws: true });
  eq([refused.e.defaultPrevented, t.spoken(), t.ed._model === before], [false, 'Clipboard unavailable, nothing cut. 2 measures, 3 tracks copied in the editor', true]);
  t.ed.destroy();
});
test('criteria 11, 13, 16: a pasted column clip (native paste event) overwrites the column selection on each mapped track in one undo step; "1 clip track not pasted"; the cursor after the written measures on the base track; the fallback pastes once; Ctrl+V / Ctrl+Shift+V keydowns are never prevented', () => {
  const src = mk(trio());
  src.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 2, measure: 0, beat: 0 } });
  const text = src.ed.copy();
  src.ed.destroy();
  const t = mk(withHidden());
  t.ed.focus();
  t.ed.setSelection({ anchor: { track: 2, measure: 1, beat: 0 }, focus: { track: 3, measure: 1, beat: 0 } });
  t.spoken();
  const before = t.ed._model;
  eq(t.down(key('v', CTRL)).defaultPrevented, false);
  fire('paste', { [CLIP_MIME]: text });
  t.clock.advance(0);
  eq(t.spoken(), 'Pasted 1 measure over measure 2, 2 tracks, 1 clip track not pasted');
  const sc = t.ed.getScore();
  eq([sc.tracks[2].measures[1].beats.map((b) => b.notes[0].fret), sc.tracks[3].measures[1].beats.map((b) => b.notes[0].fret)], [[1, 2, 3], [1, 2]]);
  eq([t.ed.getCursor(), t.ed.getSelection(), t.ed.canUndo()], [{ track: 2, measure: 2, beat: 0, string: 1 }, null, true]);
  t.ed.undo();
  ok(t.ed._model === before);
  t.ed.setCursor({ track: 0, measure: 1, beat: 0 });
  t.spoken();
  eq(t.down(key('V', CS)).defaultPrevented, false);
  t.clock.advance(0);
  eq(t.spoken(), 'Inserted 1 measure at measure 2, 3 tracks', 'the fallback: the internal clipboard, inserted once');
  eq(t.ed.getScore().tracks.map((x) => x.measures.length), [4, 4, 4, 4]);
  eq(t.ed.getScore().tracks[1].measures[1], { beats: [] }, 'the hidden track gets the empty column, never the clip');
  t.ed.destroy();
});
test('criterion 12 and size: Ctrl+V with no selection overwrites blank measures on every mapped track; a beats selection refuses ("Select whole measures to paste measures"); a paste that would export more than 5 MB is refused and changes nothing', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [] }]), tab([{ beats: [nt('whole')] }, { beats: [] }], { name: 'B' })] });
  const clip = JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'measures', tracks: [{ tuning: TUNING, measures: [{ beats: [nt('whole', 1, 5)] }] }, { tuning: TUNING, measures: [{ beats: [nt('whole', 2, 6)] }] }] });
  t.ed.setCursor({ measure: 1, beat: 0 });
  t.spoken();
  eq([t.ed.paste(clip), t.spoken()], [true, 'Pasted 1 measure over measure 2, 2 tracks']);
  eq(t.ed.getScore().tracks.map((x) => x.measures[1].beats[0].notes[0].fret), [5, 6]);
  t.ed.loadScore({ tracks: [tab([{ beats: [nt('half'), nt('half')] }]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  t.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 0 } });
  t.spoken();
  eq([t.ed.paste(clip), t.spoken()], [false, 'Select whole measures to paste measures']);
  t.ed.destroy();
  const filler = 'x'.repeat(L.jsonChars - 3000);
  const big = mk({ pad: filler, tracks: [tab([{ beats: [] }]), tab([{ beats: [] }], { name: 'B' })] });
  ok(exportedLength(big.ed._model) < L.jsonChars);
  const heavy = JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'measures', tracks: [0, 1].map(() => ({ tuning: TUNING, measures: [{ beats: Array.from({ length: 40 }, (_, k) => nt('64th', 1, k % 20)) }] })) });
  const before = big.ed._model;
  eq([big.ed.paste(heavy), big.spoken(), big.ed._model === before], [false, 'The score would be too large', true]);
  big.ed.destroy();
});

test('a clip longer than 5 MB is still copied and said to be too large to paste back; a cut then clears nothing; pasting it is refused as "Clip too large"; a normal clip says nothing more', () => {
  const t = mk(trio());
  t.ed.focus();
  const pad = 'x'.repeat(Math.ceil(L.jsonChars / 2) + 1000);
  const m = t.ed._model; // a model too large to load (the limit is on input), reached here directly: copy reads only the model
  t.ed._model = { ...m, tracks: m.tracks.slice(0, 2).map((tr) => ({ ...tr, measures: [{ beats: [{ ...tr.measures[0].beats[0], pad }] }] })) };
  t.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 1, measure: 0, beat: 0 } });
  t.spoken();
  const text = t.ed.copy();
  ok(text.length > L.jsonChars);
  eq(t.spoken(), 'Copied 1 measure, 2 tracks, too large to paste back');
  eq([t.ed.paste(text), t.spoken()], [false, 'Clip too large']);
  const c = fire('copy');
  eq([c.e.defaultPrevented, c.clipboardData.data.get(CLIP_MIME) === text, t.spoken()], [true, true, 'Copied 1 measure, 2 tracks, too large to paste back'], 'the copy event writes it too');
  const refused = fire('cut', {}, { throws: true });
  eq([refused.e.defaultPrevented, t.spoken()], [false, 'Clipboard unavailable, nothing cut. 1 measure, 2 tracks copied in the editor, too large to paste back']);
  const beforeCut = t.ed._model;
  fire('cut');
  eq(t.spoken(), 'Copied 1 measure, 2 tracks, too large to paste back, nothing cut');
  ok(t.ed._model === beforeCut && !t.ed.canUndo(), 'an over-limit cut copies but clears nothing (no undo step)');
  eq(t.ed._model.tracks[0].measures[0].beats[0].pad.length, pad.length, 'the beats are still there');
  t.ed.loadScore(trio());
  t.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 1, measure: 0, beat: 0 } });
  t.spoken();
  t.ed.copy();
  eq(t.spoken(), 'Copied 1 measure, 2 tracks');
  t.ed.destroy();
});

// ---------- range edits (criteria 17-22) ----------
test('criteria 17-22 at controller level: Delete, Ctrl+Delete, Shift+Delete, F and Shift+F on a column; effects and transpose keep the column selection (re-derived, no selection event) with one undo step each', () => {
  const t = mk(trio());
  const col = () => { t.ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 2, measure: 1, beat: 0 } }); t.spoken(); };
  col();
  t.press('Delete');
  eq([t.spoken(), t.ed.getSelection(), t.ed.getCursor().track], ['13 beats changed to rests on 3 tracks, measure full', null, 0], 'the cursor goes to the top track: its fill is said, as after any edit that changes the cursor measure');
  col();
  t.press('Delete');
  eq(t.spoken(), 'Already rests');
  ok(t.ed.getSelection() !== null, 'a no-op keeps the selection');
  t.ed.undo();
  col();
  t.press(key('Delete', CTRL));
  eq([t.spoken(), t.ed.getScore().tracks.map((x) => x.measures.map((m) => m.beats.length))], ['13 beats deleted on 3 tracks', [[0, 0, 1], [0, 0, 1], [0, 0, 1]]]);
  col();
  t.press('f');
  eq(t.spoken(), 'Filled 6 measures on 3 tracks, 6 rests added, measure full', 'the cursor measure was empty');
  t.ed.undo(); t.ed.undo();
  col();
  t.press(key('Delete', SHIFT));
  eq([t.spoken(), t.ed.getScore().tracks.map((x) => x.measures.length)], ['Measures 1 to 2 deleted, measure full', [1, 1, 1]]);
  t.ed.undo();
  col();
  t.events.length = 0;
  t.press('p');
  eq([t.spoken(), t.ed.getSelection().tracks, selEvents(t.events)], ['Palm mute on, 13 beats on 3 tracks', [0, 1, 2], []]);
  t.press(key('ArrowUp', CTRL));
  eq([t.spoken(), t.ed.getSelection().beatCount], ['Transposed 13 notes up 1 semitone on 3 tracks', 13]);
  t.ed.undo();
  eq(t.spoken(), 'Undo: transpose');
  t.ed.undo();
  eq(t.spoken(), 'Undo: palm mute');
  col();
  t.press(key('F', SHIFT));
  eq([t.spoken(), t.ed.getSelection().tracks], ['Nothing to reflow', [0, 1, 2]], 'Shift+F ignores the selection: the full cursor measure has nothing to move, a no-op keeps the selection');
  stable(t.ed);
  t.ed.destroy();
});
test('criterion 37: Tab is never taken in column mode; the selection is re-announced only when its info changes; every column result is announced', () => {
  const t = mk(trio());
  t.ed.focus();
  t.press(key('ArrowDown', SHIFT));
  t.events.length = 0;
  eq([t.down(key('Tab')).defaultPrevented, t.down(key('Tab', SHIFT)).defaultPrevented], [false, false]);
  t.press(key('Home', SHIFT));
  eq(selEvents(t.events), [], 'Shift+Home in column mode: no change, no event');
  t.press(key('ArrowRight', SHIFT));
  eq(selEvents(t.events).length, 1);
  t.ed.destroy();
});

// ---------- one-beat measures (criterion 35) ----------
test('criterion 35: with nothing selected on a one-position measure, Ctrl+Shift+Right / Left first select that measure ("Selected measure 1, 1 beat"), then go on; an empty measure gives its blank selection; multi-beat measures and a live selection are as in 2.3.1; no history entry', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [] }, { beats: [nt('half'), nt('half')] }, { beats: [nt('whole')] }])] });
  t.press(key('ArrowRight', CS));
  eq([t.ed.getSelection().measures, t.ed.getCursor().beat, t.spoken()], [[0, 0], 0, 'Selected measure 1, 1 beat']);
  t.press(key('ArrowRight', CS));
  eq([t.ed.getSelection().measures, t.spoken()], [[0, 1], 'Selected measures 1 to 2, 1 beat']);
  t.press('Escape');
  t.ed.setCursor({ measure: 1, beat: 0 });
  t.spoken();
  t.press(key('ArrowLeft', CS));
  eq([t.ed.getSelection().measures, t.ed.getSelection().beatCount, t.spoken()], [[1, 1], 0, 'Selected measure 2, no beats'], 'the empty measure: one position (its slot)');
  t.press('Escape');
  t.ed.setCursor({ measure: 3, beat: 0 });
  t.spoken();
  t.press(key('ArrowLeft', CS));
  eq([t.ed.getSelection().measures, t.spoken()], [[3, 3], 'Selected measure 4, 1 beat']);
  t.press(key('ArrowLeft', CS));
  eq([t.ed.getSelection().measures, t.ed.getCursor().beat, t.spoken()], [[2, 3], 0, 'Selected measures 3 to 4, 3 beats']);
  t.press('Escape');
  t.ed.setCursor({ measure: 2, beat: 0 });
  t.press(key('ArrowRight', CS));
  eq([t.ed.getSelection().measures, t.ed.getCursor().beat], [[2, 2], 1], 'a 2-beat measure: to its last position, as in 2.3.1');
  eq(t.ed.canUndo(), false, 'select commands add no history entry');
  t.ed.destroy();
});

// ---------- demo (criterion 36) ----------
const fsMod = await import('node:fs');
const DE = await imp('examples/editor-demo-edit.js');
const html = fsMod.readFileSync(path.join(root, 'editor.html'), 'utf8');
test('criterion 36: markup: "Select all tracks" opens the Edit group with its title; the shortcuts list Shift+Up / Down and Shift+PageUp / PageDown and the second Ctrl+A', () => {
  const at = (s) => html.indexOf(s);
  ok(html.includes('<button type="button" id="select-all-tracks-btn" title="Select every measure of every visible track (Ctrl+A twice)">Select all tracks</button>'));
  ok(at('aria-label="Edit"') < at('id="select-all-tracks-btn"') && at('id="select-all-tracks-btn"') < at('id="copy-btn"'));
  ok(html.includes('<dt>Shift+↑ ↓ or Shift+PageUp / PageDown</dt><dd>Extend to the previous / next track (whole measures)</dd>'));
  ok(html.includes('<dt>Ctrl+A</dt><dd>Select the whole track; press again for all tracks</dd>'));
  const sel = html.slice(at('<section><h3>Selection</h3>'), html.indexOf('</section>', at('<section><h3>Selection</h3>')));
  ok(sel.includes('Shift+PageUp / PageDown') && sel.includes('press again for all tracks'), 'both in the Selection section');
});
test('criterion 36: wiring: Select all tracks is Ctrl+A twice through handleKey (once when the first press already took several tracks), never disabled (read-only too), first in the Edit focus group; the Selection status names the tracks', async () => {
  const mkBtn = (id) => ({ id, disabled: false, handlers: [], addEventListener(tp, f) { this.handlers.push(f); }, focus() { fake.activeElement = this; }, click(detail = 0) { return Promise.all(this.handlers.map((f) => f({ detail }))); } });
  const ids = ['select-all-tracks-btn', 'copy-btn', 'cut-btn', 'paste-btn', 'paste-new-btn', 'fill-btn', 'reflow-btn', 'transpose-down-1-btn', 'transpose-up-1-btn', 'transpose-down-12-btn', 'transpose-up-12-btn'];
  const els = Object.fromEntries(ids.map((id) => [id, mkBtn(id)]));
  els['st-selection'] = { textContent: '' };
  const fake = { activeElement: null, getElementById: (id) => els[id], defaultView: { navigator: {} } };
  const t = mk(withHidden(), { readOnly: true });
  const refreshEdit = DE.wireEdit(fake, t.ed, { refresh: () => refreshEdit(t.ed.getCursorInfo(), t.ed.isReadOnly()) });
  refreshEdit(t.ed.getCursorInfo(), true);
  eq([els['select-all-tracks-btn'].disabled, els['copy-btn'].disabled, els['cut-btn'].disabled], [false, false, true], 'read-only: selecting and copying stay enabled');
  await els['select-all-tracks-btn'].click();
  eq([t.ed.getSelection().tracks, t.ed.lastMessage, els['st-selection'].textContent], [[0, 2, 3], 'Selected all measures, all tracks', '3 measures (1–3), 3 tracks']);
  await els['select-all-tracks-btn'].click();
  eq([t.ed.getSelection().tracks, t.ed.lastMessage], [[0, 2, 3], 'Selected all measures, all tracks'], 'already all tracks: one press, the same selection');
  t.ed.setReadOnly(false);
  t.ed.setCursor({ track: 2, measure: 0, beat: 0 });
  els['cut-btn'].focus();
  t.ed.setReadOnly(true);
  refreshEdit(t.ed.getCursorInfo(), true);
  eq(fake.activeElement, els['select-all-tracks-btn'], 'the Edit group hands focus to Select all tracks');
  t.ed.destroy();
  const one = mk({ tracks: [tab([{ beats: [nt('whole')] }])] });
  for (const b of Object.values(els)) if (b.handlers) b.handlers = [];
  const r1 = DE.wireEdit(fake, one.ed);
  r1(one.ed.getCursorInfo(), false);
  await els['select-all-tracks-btn'].click();
  eq([one.ed.getSelection().tracks, one.ed.lastMessage], [[0], 'Selected all of Track 1 Gtr, 1 measure'], 'one visible track: the whole track');
  one.ed.destroy();
  eq([DE.selectionText({ kind: 'measures', beatCount: 9, measures: [2, 3], tracks: [0, 1, 2] }), DE.selectionText({ kind: 'measures', beatCount: 2, measures: [1, 1], tracks: [0] }), DE.selectionText({ kind: 'beats', beatCount: 4, measures: [1, 1], tracks: [0] })],
    ['2 measures (3–4), 3 tracks', '1 measure (2)', '4 beats, measure 2']);
});

// ---------- B10 (controller) ----------
const { clampCursor } = await imp('src/editor/model/cursor.js');
const { selectionOf, anchorOf, focusOf } = await imp('src/editor/model/columns.js');
test('B10 (2.3.2 controller, 300 steps): track extends, column moves, Ctrl+A twice, copy / cut / paste events and the fallback on columns, the delete keys, F, effects and transpose keep sanitizeScore(model) === model, a valid cursor and a re-derivable selection; undo all restores the start, redo all the end', () => {
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const rnd = mulberry32(2322);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const KEYS = [key('ArrowDown', SHIFT), key('ArrowUp', SHIFT), key('PageDown', SHIFT), key('PageUp', SHIFT), key('ArrowRight', SHIFT), key('ArrowLeft', SHIFT), key('Home', SHIFT), key('End', SHIFT),
    key('ArrowRight', CS), key('ArrowLeft', CS), key('End', CS), key('Home', CS), key('a', CTRL), key('a', CTRL), key('Escape'),
    key('Delete'), key('Delete', CTRL), key('Delete', SHIFT), key('f'), key('F', SHIFT), key('p'), key('x'), key('h'), key('ArrowUp', CTRL), key('ArrowDown', CS),
    key('ArrowRight'), key('ArrowDown'), key('PageDown'), key('PageUp'), key('5'), key('m'), key('Insert')];
  const t = mk(withHidden(), { historyLimit: 1000 });
  t.ed.focus();
  const start = t.ed._model;
  let columns = 0;
  for (let i = 0; i < 300; i++) {
    const r = rnd();
    if (r < 0.08) fire('copy');
    else if (r < 0.12) fire('cut');
    else if (r < 0.18) { t.down(key('v', CTRL)); if (rnd() < 0.5) fire('paste'); }
    else if (r < 0.22) { t.down(key('V', CS)); if (rnd() < 0.5) fire('paste'); }
    else t.ed.handleKey(pick(KEYS));
    t.clock.advance(1000);
    ok(sanitizeScore(t.ed._model) === t.ed._model, `step ${i}`);
    eq(clampCursor(t.ed._model, t.ed._cursor), t.ed._cursor, `step ${i}: valid cursor`);
    const sel = t.ed._selection;
    if (sel) eq(selectionOf(t.ed._model, anchorOf(sel), focusOf(sel))?.info, sel.info, `step ${i}: valid selection`);
    if (sel?.parts) { columns++; ok(!sel.tracks.includes(1), 'the hidden track is never selected'); }
  }
  ok(columns > 20, `${columns} column steps`);
  const end = t.ed._model;
  while (t.ed.undo());
  ok(t.ed._model === start, 'undo all');
  while (t.ed.redo());
  ok(t.ed._model === end, 'redo all');
  t.ed.destroy();
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-columns-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-columns-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
