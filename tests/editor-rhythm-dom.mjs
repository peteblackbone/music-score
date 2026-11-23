// 2.3.3 rhythm keys over a selection and transpose to another string at controller level under the DOM
// shim: exact wording (with the measure-fill suffix of describeEdit), undo labels, the kept selection (no
// event, no re-announce), read-only, the demo palette / Dots / Triplet buttons, the cursor following a
// moved note, and B10 over 300 steps.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-rhythm-dom.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const { clampCursor } = await imp('src/editor/model/cursor.js');
const { selectionOf, anchorOf, focusOf } = await imp('src/editor/model/columns.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const rest = (duration) => ({ type: 'rest', duration });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const SHIFT = { shiftKey: true };
const CTRL = { ctrlKey: true };
const CS = { ctrlKey: true, shiftKey: true };
const stable = (ed) => ok(sanitizeScore(ed._model) === ed._model, 'sanitize identity');

function mk(score, opts = {}) {
  const clock = makeClock();
  clock.requestAnimationFrame = null;
  clock.cancelAnimationFrame = null;
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock, ...opts });
  const events = [];
  for (const t of ['change', 'cursor', 'selection']) ed.on(t, (e) => events.push([t, e]));
  const live = box.children[0].children[1];
  const spoken = () => { clock.advance(150); return live.textContent.trimEnd(); };
  return { ed, clock, events, spoken };
}
/** 8th, quarter, quarter on string 1 fret 5 and a quarter on string 2 (underfull); measure 2 a whole on string 1 fret 5. */
const fx = () => ({ tracks: [tab([{ beats: [nt('8th', 1, 5), nt('quarter', 1, 5), nt('quarter', 1, 5), nt('quarter', 2, 0)] }, { beats: [nt('whole', 1, 5)] }])] });
/** Two TAB tracks and a notation-only one between them. */
const trio = () => ({ tracks: [
  tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 1), nt('half', 1, 3)] }, { beats: [nt('whole', 1, 3)] }]),
  { name: 'Notes', measures: [{ beats: [nt('half', 2, 1), rest('half')] }, { beats: [nt('whole', 2, 1)] }] },
  tab([{ beats: [nt('half', 2, 5), nt('half', 2, 5)] }, { beats: [rest('whole')] }], { name: 'C' }),
] });
const select = (ed, a, b) => { ed.setSelection({ anchor: a, focus: b }); };
const beats = (ed, ti = 0, mi = 0) => ed.getScore().tracks[ti].measures[mi].beats;

test('wording: each rhythm key over beats 1-3 says its result with the beat count, plus the measure fill when it changed; undo says the label', () => {
  for (const [k, said, label] of [
    [key('+'), '3 beats halved', 'duration'],
    [key('='), '3 beats halved', 'duration'],
    [key('-'), '3 beats doubled, measure overfull', 'duration'],
    [key('.'), 'Dotted, 3 beats, measure overfull', 'dots'],
    [key('/'), 'Triplet on, 3 beats', 'triplet'],
    [key('r'), '3 beats changed to rests', 'rest'],
    [key('l'), 'Tied 2 note pairs', 'tie'],
  ]) {
    const { ed, spoken } = mk(fx());
    select(ed, { measure: 0, beat: 0 }, { measure: 0, beat: 2 });
    spoken();
    ed.handleKey(k);
    eq(spoken(), said, k.key);
    stable(ed);
    ed.undo();
    eq(spoken(), `Undo: ${label}`, k.key);
    ed.destroy();
  }
  const { ed, spoken } = mk(fx());
  select(ed, { measure: 0, beat: 0 }, { measure: 0, beat: 2 });
  ed.setDuration('16th');
  eq(spoken(), '16th, 3 beats');
  ed.handleKey(key('r'));
  ed.handleKey(key('r'));
  eq(spoken(), '3 rests changed to notes');
  ed.undo();
  eq(spoken(), 'Undo: note');
  ed.destroy();
});
test('wording over a column: the track count, and for R and L the notation-only tracks skipped; refusals', () => {
  const { ed, spoken } = mk(trio());
  select(ed, { track: 0, measure: 0, beat: 0 }, { track: 2, measure: 1, beat: 0 });
  spoken();
  for (const [k, said] of [
    [key('.'), 'Dotted, 10 beats on 3 tracks, measure overfull'],
    [key('.'), 'Double-dotted, 10 beats on 3 tracks'],
    [key('/'), 'Triplet on, 10 beats on 3 tracks'],
    [key('l'), 'Tied 3 note pairs on 2 tracks, 1 track without TAB skipped'],
    [key('l'), 'Untied 3 note pairs on 2 tracks, 1 track without TAB skipped'],
    [key('r'), '6 beats changed to rests on 2 tracks, 1 track without TAB skipped'],
  ]) {
    ed.handleKey(k);
    eq(spoken(), said, k.key);
    eq(ed.getSelection().tracks, [0, 1, 2], 'kept');
  }
  ed.destroy();
  const n = mk(trio());
  select(n.ed, { track: 1, measure: 0, beat: 0 }, { track: 1, measure: 1, beat: 0 });
  n.ed.handleKey(key('r'));
  eq([n.spoken(), n.ed.canUndo()], ['Needs a TAB staff', false]);
  n.ed.handleKey(key('l'));
  eq(n.spoken(), 'Needs a TAB staff');
  n.ed.destroy();
  const lim = mk({ tracks: [tab([{ beats: [nt('whole', 1, 1)] }, { beats: [nt('64th', 1, 1)] }])] });
  select(lim.ed, { measure: 0, beat: 0 }, { measure: 1, beat: 0 });
  lim.ed.handleKey(key('-'));
  eq([lim.spoken(), lim.ed.canUndo(), lim.ed.getSelection().beatCount], ['Duration limit', false, 2]);
  lim.ed.handleKey(key('+'));
  eq([lim.spoken(), lim.ed.canUndo()], ['Duration limit', false]);
  lim.ed.destroy();
});
test('the selection is kept: one change event, no selection event while its info is unchanged, no cursor event, no "Selected ..." re-announce; one undo step each, undo restores the same model and clears the selection', () => {
  const { ed, events, spoken } = mk(fx(), { historyLimit: 100 });
  const start = ed._model;
  select(ed, { measure: 0, beat: 0 }, { measure: 0, beat: 2 });
  spoken();
  const sel = ed.getSelection();
  const keys = [key('+'), key('-'), key('.'), key('/'), key('/'), key('l'), key('r'), key('r')];
  for (const k of keys) {
    events.length = 0;
    ed.handleKey(k);
    eq(events.map((e) => e[0]), ['change'], k.key);
    eq(ed.getSelection(), sel, k.key);
    ok(!/^Selected/.test(spoken()), k.key);
  }
  ed.setDuration('half');
  eq(ed.getSelection(), sel);
  for (let i = 0; i <= keys.length; i++) ok(ed.undo());
  ok(ed._model === start && ed.getSelection() === null && !ed.canUndo());
  ed.destroy();
});
test('D-R6: a range key that changes nothing makes no undo step and no change event but still speaks; the selection stays', () => {
  const { ed, events, spoken } = mk(fx());
  select(ed, { measure: 0, beat: 1 }, { measure: 0, beat: 2 });
  spoken();
  events.length = 0;
  ed.setDuration('quarter');
  eq([spoken(), ed.canUndo(), events.length, ed.getSelection().beatCount], ['Quarter, 2 beats', false, 0, 2]);
  ed.destroy();
});
test('read-only over a column: every rhythm key and transpose say "Read-only", change nothing and keep the selection', () => {
  const { ed, spoken } = mk(trio(), { readOnly: true });
  select(ed, { track: 0, measure: 0, beat: 0 }, { track: 2, measure: 1, beat: 0 });
  const before = ed._model;
  for (const k of [key('+'), key('='), key('-'), key('.'), key('/'), key('r'), key('l'), key('ArrowDown', CTRL)]) {
    eq(ed.handleKey(k), false, k.key);
    eq([spoken(), ed.getSelection().tracks], ['Read-only', [0, 1, 2]], k.key);
  }
  eq(ed.setDuration('half'), false);
  ok(ed._model === before);
  ed.destroy();
});
test('demo: the palette buttons call setDuration and the Dots / Triplet buttons handleKey(\'.\' / \'/\'), so with a selection they act on every selected beat', () => {
  const src = fs.readFileSync(path.join(root, 'examples/editor-demo.js'), 'utf8');
  ok(/editor\.setDuration\(b\.dataset\.duration\)/.test(src) && /editor\.handleKey\(\{ key: '\.' \}\)/.test(src) && /editor\.handleKey\(\{ key: '\/' \}\)/.test(src), 'the demo wiring');
  const { ed, spoken } = mk(fx());
  select(ed, { measure: 0, beat: 0 }, { measure: 0, beat: 2 });
  ed.setDuration('8th');
  eq([beats(ed).map((b) => b.duration), spoken()], [['8th', '8th', '8th', 'quarter'], 'Eighth, 3 beats']);
  ed.handleKey({ key: '.' });
  eq([beats(ed).map((b) => b.dots ?? 0), spoken()], [[1, 1, 1, 0], 'Dotted, 3 beats']);
  ed.handleKey({ key: '/' });
  eq([beats(ed).map((b) => b.tuplet ?? null), spoken(), ed.getSelection().beatCount], [[3, 3, 3, null], 'Triplet on, 3 beats', 3]);
  ed.destroy();
});
test('the shortcuts panel says the rhythm keys, R and L act on a selection and that transpose moves a note to the nearest string', () => {
  const html = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
  for (const t of ['<p>With a selection: every selected beat.</p>', 'Rest / note (with a selection: every selected beat)', 'Tie to the previous note on this string (with a selection: tie or untie every pair of equal notes)', 'a note past fret 0 or the top fret moves to the nearest string']) ok(html.includes(t), t);
});
test('transpose: the cursor follows its note to the new string (with and without a selection); undo puts it back; a note that fits keeps the 2.3.1 wording', () => {
  const { ed, spoken } = mk({ tracks: [tab([{ beats: [nt('whole', 2, 0)] }, { beats: [nt('whole', 2, 3)] }])] });
  ed.setCursor({ string: 2 });
  spoken();
  ed.handleKey(key('ArrowDown', CTRL));
  eq([ed.getCursor().string, spoken()], [3, 'Transposed 1 note down 1 semitone, 1 moved to another string']);
  ed.undo();
  eq(ed.getCursor().string, 2);
  ed.setCursor({ measure: 1 });
  ed.handleKey(key('ArrowUp', CTRL));
  eq(spoken(), 'Fret 4, up 1 semitone');
  select(ed, { measure: 0, beat: 0 }, { measure: 0, beat: 0 });
  eq(ed.getCursor().string, 2);
  ed.handleKey(key('ArrowDown', CS));
  eq([ed.getCursor().string, beats(ed)[0].notes, spoken(), ed.getSelection().beatCount], [5, [{ string: 5, fret: 2 }], 'Transposed 1 note down an octave, 1 moved to another string', 1]);
  stable(ed);
  ed.destroy();
});
test('B10 (2.3.3 controller, 300 steps): selections (columns too), every rhythm key, the palette and transpose keep sanitizeScore(model) === model, a valid cursor and a re-derivable selection; undo all restores the start, redo all the end', () => {
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const rnd = mulberry32(2333);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const KEYS = [key('ArrowDown', SHIFT), key('ArrowUp', SHIFT), key('ArrowRight', SHIFT), key('ArrowLeft', SHIFT), key('End', SHIFT), key('ArrowRight', CS), key('a', CTRL), key('a', CTRL), key('Escape'),
    key('+'), key('='), key('-'), key('.'), key('/'), key('r'), key('l'), key('+'), key('-'), key('.'), key('r'), key('l'),
    key('ArrowUp', CTRL), key('ArrowDown', CTRL), key('ArrowDown', CTRL), key('ArrowDown', CS), key('ArrowUp', CS),
    key('ArrowRight'), key('ArrowDown'), key('ArrowUp'), key('PageDown'), key('PageUp'), key('0'), key('2'), key('Delete'), key('m'), key('Insert')];
  const DURS = ['whole', 'half', 'quarter', '8th', '16th'];
  const { ed, clock } = mk(trio(), { historyLimit: 1000 });
  const start = ed._model;
  let ranged = 0;
  for (let i = 0; i < 300; i++) {
    const had = !!ed._selection;
    const m0 = ed._model;
    if (rnd() < 0.08) ed.setDuration(pick(DURS));
    else ed.handleKey(pick(KEYS));
    if (had && ed._selection && ed._model !== m0) ranged++;
    clock.advance(1000);
    ok(sanitizeScore(ed._model) === ed._model, `step ${i}`);
    eq(clampCursor(ed._model, ed._cursor), ed._cursor, `step ${i}: valid cursor`);
    const sel = ed._selection;
    if (sel) eq(selectionOf(ed._model, anchorOf(sel), focusOf(sel))?.info, sel.info, `step ${i}: valid selection`);
  }
  ok(ranged > 20, `${ranged} edits that kept a selection`);
  const end = ed._model;
  while (ed.undo());
  ok(ed._model === start, 'undo all');
  while (ed.redo());
  ok(ed._model === end, 'redo all');
  ed.destroy();
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-rhythm-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-rhythm-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
