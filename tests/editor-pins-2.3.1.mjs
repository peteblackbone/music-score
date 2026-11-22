// 2.3.1 characterization pins, recorded on 2.3.0 before any 2.3.1 change: a measures paste with no
// selection inserts (also on a blank measure and on the slot), Shift+F moves one measure's overflow with
// a crossing beat left in place, effect keys act on the cursor beat and clear the selection, a range
// with no main beat is no selection, Ctrl+Shift+V pastes like Ctrl+V, and the keys reserved for 2.3.1.
// The 2.3.1 commits invert (a)–(f) on purpose, each where its pin says so.
// Run via `node tests/run.js` (calls summary()), or directly: `node tests/editor-pins-2.3.1.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const io = await imp('src/editor/model/io.js');
const SEL = await imp('src/editor/model/selection.js');
const CL = await imp('src/editor/model/clip.js');
const PA = await imp('src/editor/model/paste.js');
const CMD = await imp('src/editor/model/commands.js');
const { keyToCommand } = await imp('src/editor/keymap.js');
const { describe } = await imp('src/editor/announce.js');
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock, makeClipboardData } = await import('./editor-shim.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');

const results = [];
const test = (name, fn) => {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, msg: e.stack || e.message }); }
};
const eq = (a, b, m = '') => {
  const x = JSON.stringify(a), y = JSON.stringify(b);
  if (x !== y) throw new Error(`${m} expected ${y}, got ${x}`);
};
const ok = (c, m = 'assertion failed') => { if (!c) throw new Error(m); };

const model = (s) => io.parseInput(s);
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const cur = (track, measure, beat, string = 1) => ({ track, measure, beat, string });
const st = () => ({ duration: 'quarter', dots: 0, digit: null });
const P = (measure, beat) => ({ measure, beat });
const v1 = (s, ti, mi) => s.tracks[ti].measures[mi].beats;
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const clipText = (kind, content) => JSON.stringify({ type: 'music-score-clip', version: 1, kind, tracks: [{ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], [kind]: content }] });
const parse = (t) => CL.parseClip(t).clip;
const run = (name, s, c, sel) => CMD.run(name, s, c, st(), { maxFret: 24, now: 0, twoDigitDelayMs: 800, allowAppend: true, selection: sel });
function mk(score) {
  const clock = makeClock();
  clock.requestAnimationFrame = null;
  clock.cancelAnimationFrame = null;
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock });
  const rootEl = box.children[0];
  const live = rootEl.children[1];
  const spoken = () => { clock.advance(150); return live.textContent.replace(/ $/, ''); };
  return { ed, clock, rootEl, spoken };
}

// (a) a measures clip with no selection inserts. Inverted in 2.3.1: blank target measures are overwritten, and on the slot the target is the next measure.
test('pin (a), inverted in 2.3.1: a measures clip with no selection overwrites a blank measure; on the slot of a measure with notes the target is the next measure', () => {
  const s = model({ tracks: [tab([{ beats: [nt('half')] }, { beats: [] }])] });
  const clip = parse(clipText('measures', [{ beats: [nt('whole', 2, 5)] }]));
  const blank = PA.applyPaste(s, cur(0, 1, 0), null, clip);
  eq([blank.score.tracks[0].measures.length, v1(blank.score, 0, 1), describe(blank.announce)], [2, [nt('whole', 2, 5)], 'Pasted 1 measure over measure 2']);
  const slot = PA.applyPaste(s, cur(0, 0, 1), null, clip);
  eq([v1(slot.score, 0, 0), v1(slot.score, 0, 1)], [[nt('half')], [nt('whole', 2, 5)]], 'the measure after the slot');
  eq([slot.score.tracks[0].measures.length, describe(slot.announce)], [2, 'Pasted 1 measure over measure 2']);
});

// (b) Shift+F reflows one measure. Inverted in 2.3.1: the crossing beat is split and the cascade carries on.
test('pin (b): Shift+F moves the overflow of one measure only (the next one stays overfull); a crossing dotted half stays in its measure', () => {
  const s = model({ tracks: [tab([{ beats: [nt('whole'), nt('whole')] }, { beats: [nt('whole'), nt('half')] }])] });
  const r = run('reflow', s, cur(0, 0, 0), null);
  eq(r.score.tracks[0].measures.map((m) => m.beats.length), [1, 3], 'one beat moved, measure 2 not reflowed');
  eq(describe(r.announce), 'Moved 1 beat to measure 2');
  const cross = model({ tracks: [tab([{ beats: [nt('half'), nt('half', 1, 0, { dots: 1 })] }, { beats: [] }])] });
  const c = run('reflow', cross, cur(0, 0, 0), null);
  eq([c.changed, describe(c.announce)], [false, 'Beat 2 crosses the barline and stays']);
});

// (c) effect keys clear the selection. Inverted in 2.3.1: they act on every selected beat and keep the selection.
test('pin (c), inverted in 2.3.1: controller: P with a 2-beat selection changes both selected beats and keeps the selection', () => {
  const { ed } = mk({ tracks: [tab([{ beats: [nt('quarter'), nt('quarter'), nt('half')] }])] });
  ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 1 } });
  eq(ed.handleKey(key('p')), true);
  eq(ed.getScore().tracks[0].measures[0].beats.map((b) => !!b.palmMute), [true, true, false]);
  eq(ed.getSelection().beatCount, 2);
  ed.destroy();
});

// (d) a range with no main beat is no selection. Inverted in 2.3.1 for whole blank measures; a zero-beat range inside a non-blank measure stays null.
test('pin (d), inverted in 2.3.1: a selection over empty measures is a zero-beat measures selection and Ctrl+A on an empty track selects it; a zero-beat range inside a non-blank measure is null (not inverted)', () => {
  const s = model({ tracks: [tab([{ beats: [nt('half')] }, { beats: [] }, { beats: [] }])] });
  eq(SEL.selectionRange(s, 0, P(1, 0), P(2, 0)).info, { kind: 'measures', track: 0, start: { measure: 1, beat: 0 }, end: { measure: 2, beat: 0 }, beatCount: 0, measures: [1, 2] }, 'empty measures');
  eq(SEL.selectionRange(s, 0, P(0, 1), P(0, 1)), null, 'the slot of a non-blank measure');
  const { ed, spoken } = mk({ tracks: [tab([{ beats: [] }, { beats: [] }])] });
  ed.handleKey(key('a', { ctrlKey: true }));
  eq([ed.getSelection().measures, spoken()], [[0, 1], 'Selected all of Track 1 Gtr, 2 measures']);
  ed.destroy();
});

// (e) Ctrl+Shift+V pastes like Ctrl+V. Inverted in 2.3.1: it inserts and keeps the selected beats.
test('pin (e), inverted in 2.3.1: Ctrl+Shift+V over a beats selection inserts before it and keeps the selected beats, with the native paste event and through the fallback', () => {
  const score = { tracks: [tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 2), nt('quarter', 1, 3), nt('quarter', 1, 4)] }])] };
  const clip = clipText('beats', [nt('quarter', 1, 9)]);
  for (const native of [true, false]) {
    if (!native) { const src = mk({ tracks: [tab([{ beats: [nt('quarter', 1, 9)] }])] }); src.ed.copy(); src.ed.destroy(); } // the internal clipboard
    const { ed, clock, rootEl } = mk(score);
    ed.focus();
    ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 1 } });
    const kd = rootEl.dispatch('keydown', { ...key('V', { ctrlKey: true, shiftKey: true }), target: rootEl });
    eq(kd.defaultPrevented, false, 'keydown never prevented');
    if (native) document.dispatch('paste', { clipboardData: makeClipboardData({ [CL.CLIP_MIME]: clip }) });
    clock.advance(0);
    eq(ed.getScore().tracks[0].measures[0].beats.map((b) => b.notes[0].fret), [9, 1, 2, 3, 4], native ? 'native' : 'fallback');
    eq([ed.lastMessage, ed.getCursor().beat, ed.getSelection()], ['Pasted 1 beat', 1, null]);
    ed.destroy();
  }
});

// (f) reserved keys. Inverted in 2.3.1: Ctrl+Up / Down and Ctrl+Shift+Up / Down transpose, Ctrl+Shift+Home / End select; the rest stay reserved.
test('pin (f), inverted in 2.3.1: Ctrl+Up / Down transpose by 1, Ctrl+Shift+Up / Down by 12, Ctrl+Shift+Home / End select to the score edges; Shift+Up / Down, Shift+R / I and Ctrl+Shift+V stay unbound', () => {
  const C = { ctrlKey: true };
  const CS = { ctrlKey: true, shiftKey: true };
  const S = { shiftKey: true };
  eq([['ArrowUp', C], ['ArrowDown', C], ['ArrowUp', CS], ['ArrowDown', CS], ['Home', CS], ['End', CS]].map(([k, m]) => keyToCommand(key(k, m))), [
    { name: 'transpose', arg: 1 }, { name: 'transpose', arg: -1 }, { name: 'transpose', arg: 12 }, { name: 'transpose', arg: -12 }, { name: 'selectScoreStart' }, { name: 'selectScoreEnd' },
  ]);
  for (const [k, m] of [['ArrowUp', S], ['ArrowDown', S], ['R', S], ['I', S], ['V', CS], ['v', CS]]) {
    eq(keyToCommand(key(k, m)), null, `${k} ${JSON.stringify(m)}`);
  }
});

// ---------- report ----------
export function summary() {
  let fail = 0;
  for (const r of results) {
    if (r.ok) console.log(`PASS editor-pins-2.3.1: ${r.name}`);
    else { fail++; console.log(`FAIL editor-pins-2.3.1: ${r.name}\n  ${r.msg}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
