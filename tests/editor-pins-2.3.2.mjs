// 2.3.2 characterization pins, recorded on 2.3.1 before any 2.3.2 change: setSelection refuses two
// tracks, Shift+Up / Down / PageUp / PageDown are unbound, a second Ctrl+A repeats the track selection,
// parseClip refuses more than one track entry, Ctrl+Shift+Right / Left on a one-beat measure takes two
// measures, the exact single-track overlay shapes and the exact 2.3.1 getSelection() object.
// The 2.3.2 commits invert (a)–(e) and (g) on purpose, each where its pin says so; (f) is never inverted.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-pins-2.3.2.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const CL = await imp('src/editor/model/clip.js');
const GEO = await imp('src/editor/geometry.js');
const { keyToCommand } = await imp('src/editor/keymap.js');
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const throws = (fn, type, m = '') => {
  try { fn(); } catch (e) { if (!(e instanceof type)) throw new Error(`${m} expected ${type.name}, got ${e}`); return; }
  throw new Error(`${m} expected ${type.name}, nothing thrown`);
};

const nt = (duration, string = 1, fret = 0) => ({ type: 'note', duration, notes: [{ string, fret }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const sha = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];
function mk(score) {
  const clock = makeClock();
  clock.requestAnimationFrame = null;
  clock.cancelAnimationFrame = null;
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock });
  const live = box.children[0].children[1];
  const spoken = () => { clock.advance(150); return live.textContent.trimEnd(); };
  return { ed, clock, spoken };
}
const twoTracks = () => ({ tracks: [tab([{ beats: [nt('half'), nt('half')] }, { beats: [nt('whole')] }]), tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }], { name: 'B' })] });

// (a) Inverted in 2.3.2 commit 5: setSelection accepts the two ends on different tracks (a column selection).
test('pin (a): setSelection with anchor and focus on different tracks throws a RangeError and changes nothing', () => {
  const { ed } = mk(twoTracks());
  throws(() => ed.setSelection({ anchor: { track: 0, measure: 0, beat: 0 }, focus: { track: 1, measure: 1, beat: 0 } }), RangeError);
  eq([ed.getSelection(), ed.getCursor()], [null, { track: 0, measure: 0, beat: 0, string: 1 }]);
  ed.destroy();
});

// (b) Inverted in 2.3.2 commit 5: Shift+Up / Down and Shift+PageUp / PageDown extend the selection to the previous / next track.
test('pin (b): Shift+ArrowUp / ArrowDown / PageUp / PageDown map to no command and handleKey returns false', () => {
  const { ed } = mk(twoTracks());
  for (const k of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown']) {
    eq(keyToCommand(key(k, { shiftKey: true })), null, k);
    eq(ed.handleKey(key(k, { shiftKey: true })), false, k);
  }
  eq([ed.getSelection(), ed.getCursor().track], [null, 0]);
  ed.destroy();
});

// (c) Inverted in 2.3.2 commit 5: the second Ctrl+A selects every measure of every visible track.
test('pin (c): a second Ctrl+A changes nothing and repeats "Selected all of Track 1 Gtr, 2 measures"', () => {
  const { ed, spoken } = mk(twoTracks());
  ed.handleKey(key('a', { ctrlKey: true }));
  const first = ed.getSelection();
  eq(spoken(), 'Selected all of Track 1 Gtr, 2 measures');
  ed.handleKey(key('a', { ctrlKey: true }));
  eq([ed.getSelection(), spoken()], [first, 'Selected all of Track 1 Gtr, 2 measures']);
  ed.destroy();
});

// (d) Inverted in 2.3.2 commit 4 for measures clips; a beats clip with two entries stays refused.
test('pin (d), inverted in 2.3.2: parseClip of a measures clip with 2 track entries is a multi-track clip; a beats clip with 2 entries stays clipInvalid (not inverted)', () => {
  const entry = { tuning: TUNING, measures: [{ beats: [nt('whole')] }] };
  eq(CL.parseClip(JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'measures', tracks: [entry, entry] })), { clip: { kind: 'measures', tracks: [entry, entry] } });
  const beats = { tuning: TUNING, beats: [nt('quarter')] };
  eq(CL.parseClip(JSON.stringify({ type: 'music-score-clip', version: 1, kind: 'beats', tracks: [beats, beats] })), { refused: { id: 'clipInvalid' } });
});

// (e) Inverted in 2.3.2 commit 6: on a one-beat measure the first press selects the measure alone; multi-beat measures stay.
test('pin (e): with nothing selected, Ctrl+Shift+Right on a whole-note measure 1 selects measures 1-2, and Ctrl+Shift+Left on a whole-note measure 2 selects measures 1-2', () => {
  const score = { tracks: [tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }, { beats: [nt('whole')] }])] };
  const r = mk(score);
  r.ed.handleKey(key('ArrowRight', { ctrlKey: true, shiftKey: true }));
  eq([r.ed.getSelection().measures, r.spoken()], [[0, 1], 'Selected measures 1 to 2, 2 beats']);
  r.ed.destroy();
  const l = mk(score);
  l.ed.setCursor({ measure: 1, beat: 0 });
  l.ed.handleKey(key('ArrowLeft', { ctrlKey: true, shiftKey: true }));
  eq([l.ed.getSelection().measures, l.spoken()], [[0, 1], 'Selected measures 1 to 2, 2 beats']);
  l.ed.destroy();
});

// (f) Never inverted: the single-track overlay is unchanged by the column band.
test('pin (f): exact selectionShapes of a beats selection across two system breaks (notation and TAB), a measures selection on a TAB-only track, and the same unfocused', () => {
  const score = { tracks: [
    tab(Array.from({ length: 12 }, (_, mi) => ({ beats: [nt('quarter', 1, mi), nt('quarter', 2, 1), nt('half', 3, 2)] }))),
    tab(Array.from({ length: 12 }, () => ({ beats: [nt('whole', 4, 3)] })), { name: 'Bass', showStandardNotation: false, tuning: ['E1', 'A1', 'D2', 'G2'] }),
  ] };
  const { ed } = mk(score);
  const shapes = (focused) => GEO.selectionShapes(ed._view.index, ed._selectionView(), ed._view.style, ed._view.renderer.theme, focused);
  ed.setSelection({ anchor: { measure: 1, beat: 1 }, focus: { measure: 9, beat: 1 } });
  const beats = shapes(true);
  eq([beats.length, [...new Set(beats.map((s) => s.tag))]], [8, ['path']]);
  eq(sha(beats), 'ed6754bd194155b8d13458d33378ab232735c5ec90c6a60e81b16454ae6a70c0', 'beats');
  ed.setSelection({ anchor: { track: 1, measure: 2, beat: 0 }, focus: { track: 1, measure: 3, beat: 0 } });
  eq(shapes(true), [
    { tag: 'rect', attrs: { x: 423.70000000000005, y: 256.6, width: 293.3800000000001, height: 60, class: 'editor-sel', fill: '#0b7285', 'fill-opacity': 0.14, rx: 2 } },
    { tag: 'rect', attrs: { x: 423.70000000000005, y: 256.6, width: 293.3800000000001, height: 60, class: 'editor-sel-outline', fill: 'none', stroke: '#0b7285', 'stroke-opacity': 1, 'stroke-width': 1, rx: 2 } },
  ], 'measures');
  eq(sha(shapes(false)), '1bdcf656c5d5b6dbb0fccb72d6b63a40b8ac9e0eb77cd743e411c0ccc21ec592', 'unfocused');
  ed.destroy();
});

// (g) Inverted in 2.3.2 commit 5: `tracks: [0]` is appended.
test('pin (g): the exact 2.3.1 getSelection() object of a single-track selection', () => {
  const { ed } = mk(twoTracks());
  ed.setSelection({ anchor: { measure: 0, beat: 1 }, focus: { measure: 1, beat: 0 } });
  eq(ed.getSelection(), { kind: 'beats', track: 0, start: { measure: 0, beat: 1 }, end: { measure: 1, beat: 0 }, beatCount: 2, measures: [0, 1] });
  eq(Object.keys(ed.getSelection()), ['kind', 'track', 'start', 'end', 'beatCount', 'measures']);
  ed.destroy();
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-pins-2.3.2: ${r.name}`);
    else { fail++; console.log(`FAIL editor-pins-2.3.2: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
