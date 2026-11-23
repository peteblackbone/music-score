// 2.3.3 characterization pins, recorded on 2.3.2 before any 2.3.3 change: with a selection the rhythm
// keys (+ / - / setDuration, . and /, R, L) act on the cursor beat only and clear the selection, L copies
// the previous fret, and a transpose that would take a note below fret 0 is refused even when another
// string could play it.
// The 2.3.3 commits invert (a)-(e) on purpose, each where its pin says so; (f) is never inverted.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-pins-2.3.3.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
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

const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const CTRL = { ctrlKey: true };
function mk(score, opts = {}) {
  const clock = makeClock();
  clock.requestAnimationFrame = null;
  clock.cancelAnimationFrame = null;
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock, ...opts });
  const live = box.children[0].children[1];
  const spoken = () => { clock.advance(150); return live.textContent.trimEnd(); };
  return { ed, spoken };
}
/** 8th, quarter, quarter on string 1 fret 5, then a quarter on string 2 fret 0; measure 2 a whole. */
const fx = () => ({ tracks: [tab([{ beats: [nt('8th', 1, 5), nt('quarter', 1, 5), nt('quarter', 1, 5), nt('quarter', 2, 0)] }, { beats: [nt('whole', 1, 3)] }])] });
const beats = (ed) => ed.getScore().tracks[0].measures[0].beats;
const durs = (ed) => beats(ed).map((b) => b.duration);
/** An editor on `score` with beats 1-3 of measure 1 selected (the cursor on beat 3). */
function selected(score = fx(), opts = {}) {
  const r = mk(score, opts);
  r.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 2 } });
  r.spoken();
  return r;
}

// (a) Inverted in 2.3.3 commit 3: + / - / setDuration act on every selected beat and keep the selection.
test('pin (a): with beats 1-3 selected, + / - / setDuration change the cursor beat (the focus) only and clear the selection', () => {
  for (const [act, want, said] of [
    [(ed) => ed.handleKey(key('+')), ['8th', 'quarter', '8th', 'quarter'], 'Eighth'],
    [(ed) => ed.handleKey(key('-')), ['8th', 'quarter', 'half', 'quarter'], 'Half, measure overfull'],
    [(ed) => ed.setDuration('whole'), ['8th', 'quarter', 'whole', 'quarter'], 'Whole, measure overfull'],
  ]) {
    const { ed, spoken } = selected();
    act(ed);
    eq([durs(ed), spoken(), ed.getSelection()], [want, said, null]);
    ed.destroy();
  }
});

// (b) Inverted in 2.3.3 commit 3: . and / act on every selected beat and keep the selection.
test('pin (b): with beats 1-3 selected, . and / change the cursor beat only and clear the selection', () => {
  const d = selected();
  d.ed.handleKey(key('.'));
  eq([beats(d.ed).map((b) => b.dots ?? 0), d.spoken(), d.ed.getSelection()], [[0, 0, 1, 0], 'Dotted quarter, measure full', null]);
  d.ed.destroy();
  const t = selected();
  t.ed.handleKey(key('/'));
  eq([beats(t.ed).map((b) => b.tuplet ?? null), t.spoken(), t.ed.getSelection()], [[null, null, 3, null], 'Triplet on', null]);
  t.ed.destroy();
});

// (c) Inverted in 2.3.3 commit 4: R acts on every selected beat and keeps the selection.
test('pin (c): with beats 1-3 selected, R turns the cursor beat only into a rest and clears the selection', () => {
  const { ed, spoken } = selected();
  ed.handleKey(key('r'));
  eq([beats(ed).map((b) => b.type), spoken(), ed.getSelection()], [['note', 'note', 'rest', 'note'], 'Changed to rest', null]);
  ed.destroy();
});

// (d) Inverted in 2.3.3 commit 4: L ties or unties every pair of equal neighbouring notes and never copies a fret.
test('pin (d): with beats 1-3 selected, L ties the cursor note to the previous note on its string, copying that fret, and clears the selection', () => {
  const { ed, spoken } = selected({ tracks: [tab([{ beats: [nt('8th', 1, 5), nt('quarter', 1, 5), nt('quarter', 1, 7), nt('quarter', 2, 0)] }])] });
  ed.handleKey(key('l'));
  eq([beats(ed).slice(0, 3).map((b) => b.notes[0]), spoken(), ed.getSelection()],
    [[{ string: 1, fret: 5 }, { string: 1, fret: 5, tieStart: true }, { string: 1, fret: 5, tieEnd: true }], 'Tied to fret 5', null]);
  ed.destroy();
});

// (e) Inverted in 2.3.3 commit 5: the note moves to string 3 fret 3.
test('pin (e): Ctrl+Down on string 2 fret 0, with and without a selection, is refused ("Can\'t transpose, measure 1 would go below fret 0") and changes nothing', () => {
  const score = () => ({ tracks: [tab([{ beats: [nt('whole', 2, 0)] }])] });
  const n = mk(score());
  n.ed.setCursor({ string: 2 });
  n.spoken();
  n.ed.handleKey(key('ArrowDown', CTRL));
  eq([n.ed.getScore().tracks[0].measures[0].beats[0].notes, n.spoken(), n.ed.canUndo(), n.ed.getCursor().string], [[{ string: 2, fret: 0 }], "Can't transpose, measure 1 would go below fret 0", false, 2]);
  n.ed.destroy();
  const s = mk(score());
  s.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 0 } });
  s.spoken();
  s.ed.handleKey(key('ArrowDown', CTRL));
  eq([s.ed.getScore().tracks[0].measures[0].beats[0].notes, s.spoken(), s.ed.canUndo(), s.ed.getSelection().beatCount], [[{ string: 2, fret: 0 }], "Can't transpose, measure 1 would go below fret 0", false, 1]);
  s.ed.destroy();
});

// (f) Never inverted.
test('pin (f): string 6 fret 0 down and string 1 fret 24 up (maxFret 24) are refused; a harmonic that would leave the range is refused', () => {
  const one = (string, fret, extra = {}) => ({ tracks: [tab([{ beats: [{ type: 'note', duration: 'whole', notes: [{ string, fret, ...extra }] }] }])] });
  for (const [score, string, k, said] of [
    [one(6, 0), 6, key('ArrowDown', CTRL), "Can't transpose, measure 1 would go below fret 0"],
    [one(1, 24), 1, key('ArrowUp', CTRL), "Can't transpose, measure 1 would go above fret 24"],
    [one(2, 0, { harmonic: 'natural' }), 2, key('ArrowDown', CTRL), null],
  ]) {
    for (const withSel of [false, true]) {
      const { ed, spoken } = mk(score);
      const before = JSON.stringify(ed.getScore());
      ed.setCursor({ string });
      if (withSel) ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 0 } });
      spoken();
      ed.handleKey(k);
      const text = spoken();
      eq([JSON.stringify(ed.getScore()) === before, ed.canUndo()], [true, false], `${string} ${withSel}`);
      if (said) eq(text, said);
      else eq(text.startsWith("Can't transpose, measure 1 would go below fret 0"), true, text);
      ed.destroy();
    }
  }
});
test('pin (f): read-only refuses every rhythm key with "Read-only", changes nothing and keeps the selection', () => {
  const { ed, spoken } = selected(fx(), { readOnly: true });
  const before = JSON.stringify(ed.getScore());
  for (const k of ['+', '=', '-', '.', '/', 'r', 'l']) {
    eq(ed.handleKey(key(k)), false, k);
    eq([spoken(), ed.getSelection().beatCount], ['Read-only', 3], k);
  }
  eq(ed.setDuration('half'), false);
  eq([JSON.stringify(ed.getScore()) === before, ed.getSelection().beatCount], [true, 3]);
  ed.destroy();
});
test('pin (f): without a selection every rhythm key gives exactly the 2.0 result on the cursor beat', () => {
  const b2 = (extra) => ({ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5 }], ...extra });
  const rest = [{ type: 'note', duration: '8th', notes: [{ string: 1, fret: 5 }] }];
  const last = { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 0 }] };
  for (const [act, want, said] of [
    [(ed) => ed.handleKey(key('+')), [...rest, b2(), b2({ duration: '8th' }), last], 'Eighth'],
    [(ed) => ed.handleKey(key('=')), [...rest, b2(), b2({ duration: '8th' }), last], 'Eighth'],
    [(ed) => ed.handleKey(key('-')), [...rest, b2(), b2({ duration: 'half' }), last], 'Half, measure overfull'],
    [(ed) => ed.setDuration('whole'), [...rest, b2(), b2({ duration: 'whole' }), last], 'Whole, measure overfull'],
    [(ed) => ed.handleKey(key('.')), [...rest, b2(), b2({ dots: 1 }), last], 'Dotted quarter, measure full'],
    [(ed) => ed.handleKey(key('/')), [...rest, b2(), b2({ tuplet: 3 }), last], 'Triplet on'],
    [(ed) => ed.handleKey(key('r')), [...rest, b2(), { type: 'rest', duration: 'quarter' }, last], 'Changed to rest'],
    [(ed) => ed.handleKey(key('l')), [...rest, { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5, tieStart: true }] }, { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 5, tieEnd: true }] }, last], 'Tied to fret 5'],
  ]) {
    const { ed, spoken } = mk(fx());
    ed.setCursor({ measure: 0, beat: 2 });
    spoken();
    act(ed);
    eq([beats(ed), spoken(), ed.getSelection(), ed.getCursor()], [want, said, null, { track: 0, measure: 0, beat: 2, string: 1 }], said);
    ed.destroy();
  }
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-pins-2.3.3: ${r.name}`);
    else { fail++; console.log(`FAIL editor-pins-2.3.3: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
