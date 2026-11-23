// 2.3.0 edge cases against requirements-2.3.md criteria 1-45 and design-2.3.md D1-D19 / R1-R7, controller level
// (the ScoreEditor under the DOM shim with synchronous renders): selections over holes, empty measures, two-voice
// measures and graces; range edits and ties; paste into other time signatures, tunings and string counts; fill and
// reflow on odd meters and at the limits; pickup through paste, delete and track operations; score-wide tempo
// de-duplication and migration after random edits; native clipboard events (dialogs, two editors, precedence,
// hostile clips, the R6 fallback). Run via `node tests/run.js` (awaits summary()), or `node tests/editor-select-edge.mjs`.
import { register } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

register('./hooks.mjs', import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { makeContainer } = await import('./dom-shim.mjs');
const { makeClock, makeClipboardData } = await import('./editor-shim.mjs');
const { drawnTempos } = await import('./editor-pins-2.3.mjs');
const { ScoreEditor } = await imp('src/editor/ScoreEditor.js');
const { sanitizeScore } = await imp('src/sanitize.js');
const { CLIP_MIME, CLIP_TYPE } = await imp('src/editor/model/clip.js');
const { EDITOR_LIMITS } = await imp('src/editor/model/limits.js');
const TP = await imp('src/editor/model/settings/tempo.js');
const { formatBpm } = await imp('src/expression.js');

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
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const nt = (duration, string = 1, fret = 0, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret }], ...extra });
const tn = (duration, string, fret, flags = {}, extra = {}) => ({ type: 'note', duration, notes: [{ string, fret, ...flags }], ...extra });
const rest = (duration = 'quarter', extra = {}) => ({ type: 'rest', duration, ...extra });
const grace = (string = 2, fret = 3) => ({ type: 'grace', duration: '16th', notes: [{ string, fret }] });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const key = (k, mods = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
const SHIFT = { shiftKey: true };
const CTRL = { ctrlKey: true };
const f = (n) => Array.from({ length: n }, (_, i) => nt('quarter', 1, i));

/** An editor with synchronous renders and a manual clock. */
function mk(score, opts = {}) {
  const clock = makeClock();
  clock.requestAnimationFrame = null; clock.cancelAnimationFrame = null;
  const box = makeContainer();
  const ed = new ScoreEditor(box, score, { width: 900, clock, ...opts });
  const live = box.children[0].children[1];
  const events = [];
  for (const t of ['change', 'cursor', 'selection']) ed.on(t, (e) => events.push([t, e]));
  const press = (...ks) => ks.map((k) => ed.handleKey(typeof k === 'string' ? key(k) : k));
  const say = () => { clock.advance(150); return live.textContent.replace(/ $/, ''); };
  return { ed, box, clock, events, press, say, root: box.children[0] };
}
const sel = (ed, a, b, track) => ed.setSelection({ anchor: { track, ...a }, focus: { track, ...b } });
const P = (measure, beat) => ({ measure, beat });
const ms = (ed, ti = 0) => ed.getScore().tracks[ti].measures;
const v1 = (m) => (m.beats ?? m.voices[0].beats);
const fire = (kind, init = {}, opts) => { const clipboardData = makeClipboardData(init, opts); return { e: document.dispatch(kind, { clipboardData }), clipboardData }; };
const clipText = (kind, content, extra = {}) => JSON.stringify({ type: CLIP_TYPE, version: 1, kind, tracks: [{ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], [kind]: content, ...extra }] });
const stable = (ed) => { ok(sanitizeScore(ed._model) === ed._model, 'sanitizeScore(model) === model'); };

// =====================================================================================================
// Selection over empty measures, holes, two voices, graces (criteria 8-10, design section 2)
// =====================================================================================================
test('holes and empty measures: Ctrl+A over [beat, hole, empty, beat] is a measures selection of 4 with 2 beats; Ctrl+Delete removes only the beats, Shift+Delete the columns, a measures clip carries holes as empty measures', () => {
  const s = () => ({ tracks: [tab([{ beats: [nt('whole')] }, null, { beats: [] }, { beats: [nt('whole', 2, 2)] }])] });
  const t = mk(s());
  t.press(key('a', CTRL));
  eq(t.ed.getSelection(), { kind: 'measures', track: 0, start: P(0, 0), end: P(3, 0), beatCount: 2, measures: [0, 3], tracks: [0] });
  const clip = JSON.parse(t.ed.copy());
  eq(clip.kind, 'measures');
  eq(clip.tracks[0].measures.map((m) => m.beats.length), [1, 0, 0, 1]);
  t.press(key('Delete', CTRL));
  eq(ms(t.ed).length, 4, 'measures stay');
  eq(ms(t.ed).map((m) => (m ? v1(m).length : null)), [0, null, 0, 0], 'the hole stays a hole, only beats go');
  stable(t.ed);
  t.ed.undo();
  t.press(key('a', CTRL), key('Delete', SHIFT));
  eq(ms(t.ed), [{ beats: [] }], 'every column deleted keeps one empty measure');
  t.ed.undo();
  t.ed.setCursor({ measure: 1, beat: 0 });
  t.ed.paste(JSON.stringify(clip));
  eq(ms(t.ed).length, 8);
  eq(ms(t.ed).slice(1, 5).map((m) => v1(m).length), [1, 0, 0, 1], 'the clip lands before measure 2 (holes became empty measures)');
  stable(t.ed);
});
test('a beats selection across an empty measure and a hole counts only main beats; clear turns them into rests, remove splices them out; the empty measures are untouched', () => {
  const s = () => ({ tracks: [tab([{ beats: [nt('half'), nt('half')] }, { beats: [] }, null, { beats: [nt('half'), nt('half', 2, 2)] }])] });
  const t = mk(s());
  const info = sel(t.ed, P(0, 1), P(3, 0));
  eq([info.kind, info.beatCount, info.measures], ['beats', 2, [0, 3]]);
  t.press('Delete');
  eq(ms(t.ed).map((m) => (m ? v1(m).map((b) => b.type) : null)), [['note', 'rest'], [], null, ['rest', 'note']]);
  t.ed.undo();
  sel(t.ed, P(0, 1), P(3, 0));
  t.press(key('Delete', CTRL));
  eq(ms(t.ed).map((m) => (m ? v1(m).length : null)), [1, 0, null, 1]);
  eq(t.ed.getCursor().measure, 0);
  stable(t.ed);
});
test('selection on a slot-only empty measure: 2.3.1: a lone slot selects its blank measure (no beats) and Shift+Right never appends a measure', () => {
  const t = mk({ tracks: [tab([{ beats: [] }, { beats: [nt('whole')] }])] });
  eq(t.press(key('ArrowRight', SHIFT)), [true]);
  t.ed.setCursor({ measure: 1, beat: 0 });
  t.press(key('ArrowRight', SHIFT));
  eq(ms(t.ed).length, 2, 'never appends');
  eq(t.ed.getSelection().beatCount, 1);
  const u = mk({ tracks: [tab([{ beats: [] }])] });
  u.press(key('ArrowRight', SHIFT));
  eq(u.ed.getSelection(), { kind: 'measures', track: 0, start: { measure: 0, beat: 0 }, end: { measure: 0, beat: 0 }, beatCount: 0, measures: [0, 0], tracks: [0] }, '2.3.1: the slot alone is the whole blank measure');
});
const twoVoice = () => ({ tracks: [tab([
  { voices: [{ beats: f(4) }, { beats: [nt('whole', 3, 7)] }] },
  { voices: [{ beats: f(4) }, { beats: [nt('half', 4, 2), nt('half', 4, 3)] }] },
  { beats: f(4) },
])] });
test('two voices: clear / remove / paste of voice-1 beats leave voice 2 untouched, also through undo and redo', () => {
  const t = mk(twoVoice());
  const v2 = () => JSON.stringify(ms(t.ed).slice(0, 2).map((m) => m.voices[1]));
  const before = v2();
  sel(t.ed, P(0, 1), P(1, 2));
  t.press('Delete');
  eq(v2(), before, 'clear');
  eq(v1(ms(t.ed)[0]).map((b) => b.type), ['note', 'rest', 'rest', 'rest']);
  t.ed.undo();
  sel(t.ed, P(0, 1), P(1, 2));
  t.press(key('Delete', CTRL));
  eq(v2(), before, 'remove');
  eq(ms(t.ed).map((m) => v1(m).length), [1, 1, 4]);
  t.ed.undo();
  sel(t.ed, P(0, 0), P(0, 1));
  t.ed.copy();
  t.ed.setCursor({ measure: 1, beat: 0 });
  t.ed.paste();
  eq(v2(), before, 'paste');
  eq(v1(ms(t.ed)[1]).length, 6);
  t.ed.undo(); t.ed.redo();
  eq(v2(), before, 'redo');
  stable(t.ed);
});
test('two voices: a measures clip carries voice 2 and pastes it into another editor; a measures cut clears voice 1 only; selection counts voice-1 beats only', () => {
  const a = mk(twoVoice());
  sel(a.ed, P(0, 0), P(1, 3));
  eq(a.ed.getSelection().kind, 'measures');
  eq(a.ed.getSelection().beatCount, 8, 'voice 2 is not counted');
  const text = a.ed.copy();
  eq(JSON.parse(text).tracks[0].measures.map((m) => m.voices.length), [2, 2]);
  const b = mk({ tracks: [tab([{ beats: [nt('whole')] }])] });
  b.ed.paste(text);
  eq(ms(b.ed).length, 3);
  eq(ms(b.ed)[0].voices[1].beats, [nt('whole', 3, 7)]);
  eq(ms(b.ed)[1].voices[1].beats.length, 2);
  stable(b.ed);
  const c = mk(twoVoice());
  sel(c.ed, P(0, 0), P(0, 3));
  eq(c.ed.getSelection().kind, 'measures');
  c.ed.cut();
  eq(ms(c.ed)[0].voices[1].beats, [nt('whole', 3, 7)], 'cut clears voice 1 only');
  eq(v1(ms(c.ed)[0]).every((x) => x.type === 'rest'), true);
});
test('two voices: Shift+Delete on a measures selection deletes the whole column including voice 2', () => {
  const t = mk(twoVoice());
  sel(t.ed, P(0, 0), P(0, 3));
  t.press(key('Delete', SHIFT));
  eq(ms(t.ed).length, 2);
  eq(ms(t.ed)[0].voices[1].beats.length, 2);
});
// graces: [g q1 g q2 q3 q4 g] (indices 0..6; main beats at 1, 3, 4, 5), then a whole measure
const gm = () => ({ tracks: [tab([{ beats: [grace(), nt('quarter', 1, 1), grace(3, 3), nt('quarter', 1, 2), nt('quarter', 1, 3), nt('quarter', 1, 4), grace(4, 4)] }, { beats: [nt('whole')] }])] });
test('graces at both range edges: a beat takes its leading graces, the last main beat of a measure also its trailing graces; a range inside takes only its own', () => {
  const t = mk(gm());
  const clip = (a, b) => { sel(t.ed, a, b); return JSON.parse(t.ed.copy()).tracks[0].beats.map((x) => x.type[0]); };
  eq(clip(P(0, 1), P(0, 1)), ['g', 'n'], 'first beat with its grace');
  eq(clip(P(0, 3), P(0, 3)), ['g', 'n'], 'second beat with its grace');
  eq(clip(P(0, 4), P(0, 4)), ['n'], 'no grace either side');
  eq(clip(P(0, 5), P(0, 5)), ['n', 'g'], 'the last main beat takes its trailing grace');
  eq(clip(P(0, 4), P(0, 5)), ['n', 'n', 'g']);
  eq(clip(P(0, 1), P(0, 3)), ['g', 'n', 'g', 'n']);
  eq(clip(P(0, 5), P(1, 0)), ['n', 'g', 'n'], 'across the barline');
});
test('graces: clear removes the range\'s graces, remove splices them out, graces outside the range stay; undo restores by reference', () => {
  const t = mk(gm());
  const before = t.ed._model;
  sel(t.ed, P(0, 3), P(0, 3));
  t.press('Delete');
  eq(v1(ms(t.ed)[0]).map((b) => b.type), ['grace', 'note', 'rest', 'note', 'note', 'grace'], 'only the selected beat\'s grace goes');
  t.ed.undo();
  ok(t.ed._model === before);
  sel(t.ed, P(0, 1), P(0, 4));
  t.press(key('Delete', CTRL));
  eq(v1(ms(t.ed)[0]).map((b) => b.type), ['note', 'grace'], 'a range ending before the last main beat leaves the trailing grace');
  t.ed.undo();
  sel(t.ed, P(0, 1), P(0, 5));
  t.press(key('Delete', CTRL));
  eq(v1(ms(t.ed)[0]).length, 0, 'to the last main beat of a measure also removes its trailing graces');
  stable(t.ed);
});
test('graces: a range from a beat to the slot of an underfull measure takes the trailing graces; a range that starts on the slot takes nothing there', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('half'), grace(), nt('quarter', 1, 2), grace(3, 3)] }, { beats: [nt('whole')] }])] });
  const a = sel(t.ed, P(0, 0), P(0, 2));
  eq(a.beatCount, 2);
  eq(JSON.parse(t.ed.copy()).tracks[0].beats.length, 3, 'leading grace of the third beat is inside; the trailing grace is not (the slot follows)');
  const u = sel(t.ed, P(0, 4), P(1, 0));
  eq(u.beatCount, 1, 'the slot has no beat');
  t.press('Delete');
  eq(v1(ms(t.ed)[0]).length, 4, 'nothing removed from measure 1');
  eq(v1(ms(t.ed)[1])[0].type, 'rest');
});
test('only the cursor track is selected: other tracks, hidden ones included, keep their beats under clear and remove; Shift+Delete deletes the column from every track', () => {
  const t = mk({ tracks: [
    tab([{ beats: f(4) }, { beats: f(4) }]),
    { name: 'Hid', showStandardNotation: false, measures: [{ beats: f(4) }, { beats: f(4) }] },
  ] });
  sel(t.ed, P(0, 0), P(0, 3));
  t.press('Delete');
  eq(ms(t.ed, 1)[0].beats.map((b) => b.type), ['note', 'note', 'note', 'note']);
  t.press(key('a', CTRL), key('Delete', CTRL));
  eq(ms(t.ed, 1).map((m) => m.beats.length), [4, 4]);
  t.ed.undo();
  t.press(key('a', CTRL), key('Delete', SHIFT));
  eq(ms(t.ed, 1).length, 1, 'columns go from every track, hidden ones too');
});

// =====================================================================================================
// Range edits and ties at both edges
// =====================================================================================================
test('ties: clear / remove with a selection break ties at both edges, across barlines; cut then undo restores by reference', () => {
  const s = () => ({ tracks: [tab([
    { beats: [nt('half'), tn('half', 1, 0, { tieStart: true })] },
    { beats: [tn('half', 1, 0, { tieEnd: true }), tn('half', 2, 2, { tieStart: true })] },
    { beats: [tn('half', 2, 2, { tieEnd: true }), nt('half')] },
  ])] });
  const t = mk(s());
  sel(t.ed, P(1, 0), P(1, 1));
  t.press('Delete');
  const m = ms(t.ed);
  eq([m[0].beats[1].notes[0].tieStart, m[2].beats[0].notes[0].tieEnd], [undefined, undefined], 'both outer partners lose the flag');
  t.ed.undo();
  sel(t.ed, P(1, 0), P(1, 1));
  t.press(key('Delete', CTRL));
  eq([ms(t.ed)[0].beats[1].notes[0].tieStart, ms(t.ed)[2].beats[0].notes[0].tieEnd], [undefined, undefined]);
  t.ed.undo();
  const before = t.ed._model;
  sel(t.ed, P(1, 0), P(1, 1));
  t.ed.cut();
  ok(t.ed._model !== before);
  t.ed.undo();
  ok(t.ed._model === before, 'cut then undo restores the model by reference');
  eq(t.ed.getSelection(), null);
});
test('ties: a tie that is valid after remove (the partners are now adjacent on one string) is kept', () => {
  const t = mk({ tracks: [tab([{ beats: [tn('quarter', 1, 5, { tieStart: true }), nt('quarter', 1, 1), tn('quarter', 1, 5, { tieEnd: true }), nt('quarter')] }])] });
  sel(t.ed, P(0, 1), P(0, 1));
  t.press(key('Delete', CTRL));
  eq([ms(t.ed)[0].beats[0].notes[0].tieStart, ms(t.ed)[0].beats[1].notes[0].tieEnd], [true, true]);
});
test('tempo marks: clear keeps the tempo field on a cleared beat; remove counts every drawn mark it takes away', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('half', 1, 0, { tempo: 100 }), nt('half')] }, { beats: [nt('whole', 1, 0, { tempo: 80 })] }])] });
  sel(t.ed, P(0, 0), P(0, 0));
  t.press('Delete');
  eq(ms(t.ed)[0].beats[0].tempo, 100, 'a cleared beat keeps its tempo');
  t.ed.undo();
  sel(t.ed, P(0, 0), P(1, 0));
  t.press(key('Delete', CTRL));
  ok(/2 tempo marks removed/.test(t.say()), t.say());
});

// =====================================================================================================
// Paste edge cases
// =====================================================================================================
test('paste into a different time signature changes nothing but the fill indicator: 4 quarters into 3/4 show Over, nothing moves; undo is one step', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }, { beats: f(3), timeSignature: { beats: 3, beatType: 4 } }])] });
  sel(t.ed, P(0, 0), P(0, 2));
  const text = t.ed.copy();
  eq(JSON.parse(text).kind, 'beats');
  t.ed.setCursor({ measure: 1, beat: 0 });
  const before = t.ed._model;
  eq(t.ed.paste(text), true);
  eq(v1(ms(t.ed)[1]).length, 6);
  eq([t.ed.getMeasureFill(0, 1), t.ed.getMeasureFill(0, 0)], ['over', 'full']);
  t.ed.undo();
  ok(t.ed._model === before);
});
test('paste into another tuning / string count: pitch dropped from string+fret notes, strings the target lacks dropped and counted, an emptied beat becomes a rest', () => {
  const t = mk({ tracks: [tab([{ beats: [] }], { tuning: ['E2', 'A2', 'D3', 'G3'], name: 'Bass' })] });
  const clip = clipText('beats', [
    { type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 3, pitch: 'G4' }] },
    { type: 'note', duration: 'quarter', notes: [{ string: 6, fret: 0 }] },
    { type: 'note', duration: 'quarter', notes: [{ string: 2, fret: 1 }, { string: 6, fret: 2 }] },
  ]);
  eq(t.ed.paste(clip), true);
  const bs = v1(ms(t.ed)[0]);
  eq(bs[0].notes[0].pitch, undefined, 'string+fret note loses pitch on a different tuning');
  eq(bs[1].type, 'rest', 'emptied beat is a rest');
  eq(bs[2].notes.map((n) => n.string), [2]);
  ok(/2 notes/.test(t.say()) || /dropped|not on/i.test(t.ed.lastMessage), t.ed.lastMessage);
  stable(t.ed);
});
test('paste with the same tuning keeps pitch on string+fret notes', () => {
  const t = mk({ tracks: [tab([{ beats: [] }])] });
  t.ed.paste(clipText('beats', [{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 3, pitch: 'G4' }] }]));
  eq(v1(ms(t.ed)[0])[0].notes[0], { string: 1, fret: 3, pitch: 'G4' });
});
test('paste: ties at both edges are repaired inside a measure and across barlines', () => {
  const t = mk({ tracks: [tab([
    { beats: [nt('half'), tn('half', 1, 0, { tieStart: true })] },
    { beats: [tn('half', 1, 0, { tieEnd: true }), nt('half')] },
  ])] });
  t.ed.setCursor({ measure: 0, beat: 1 });
  t.ed.paste(clipText('beats', [tn('quarter', 1, 9, { tieEnd: true }), tn('quarter', 2, 9, { tieStart: true })]));
  const m0 = v1(ms(t.ed)[0]);
  eq(m0[1].notes[0].tieEnd, undefined, 'the clip\'s first tieEnd has no partner before it');
  eq(m0[2].notes[0].tieStart, undefined, 'the clip\'s last tieStart: the next beat has no tieEnd on string 2');
  eq([m0[3].notes[0].tieStart, ms(t.ed)[1].beats[0].notes[0].tieEnd], [true, true], 'the old tie across the barline is untouched');
  stable(t.ed);
  const u = mk({ tracks: [tab([{ beats: [nt('half'), tn('half', 1, 4, { tieStart: true })] }, { beats: [nt('half')] }])] });
  u.ed.setCursor({ measure: 1, beat: 0 });
  u.ed.paste(clipText('beats', [tn('half', 1, 4, { tieEnd: true })]));
  eq([ms(u.ed)[0].beats[1].notes[0].tieStart, ms(u.ed)[1].beats[0].notes[0].tieEnd], [true, true], 'a valid tie across the barline stays');
  const w = mk({ tracks: [tab([{ beats: [nt('half')] }, { beats: [tn('whole', 1, 4, { tieEnd: true })] }])] });
  w.ed.setCursor({ measure: 0, beat: 1 });
  w.ed.paste(clipText('beats', [tn('half', 1, 4, { tieStart: true })]));
  eq([v1(ms(w.ed)[0])[1].notes[0].tieStart, ms(w.ed)[1].beats[0].notes[0].tieEnd], [true, true], 'a tie into the next measure completed by the paste');
});
test('paste at the slot of the last (underfull) measure inserts at the end; the cursor ends after the pasted beats', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('quarter')] }])] });
  t.ed.setCursor({ measure: 0, beat: 1 });
  eq(t.ed.getCursor().beat, 1);
  t.ed.paste(clipText('beats', [nt('quarter', 2, 2), nt('quarter', 3, 3)]));
  eq(v1(ms(t.ed)[0]).map((b) => b.notes[0].string), [1, 2, 3]);
  eq(t.ed.getCursor().beat, 3);
  eq(t.ed.getMeasureFill(0, 0), 'under');
});
test('paste before a beat with leading graces goes before the graces; the cursor stays on that beat', () => {
  const t = mk(gm());
  t.ed.setCursor({ measure: 0, beat: 3 });
  t.ed.paste(clipText('beats', [rest('8th')]));
  eq(v1(ms(t.ed)[0]).map((b) => b.type), ['grace', 'note', 'rest', 'grace', 'note', 'note', 'note', 'grace']);
  eq(t.ed.getCursor().beat, 4);
});
test('paste replacing a selection that spans measures: one undo, ties repaired, the selection cleared, cursor after the pasted beats, the replaced count announced', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }, { beats: f(4) }, { beats: f(4) }])] });
  sel(t.ed, P(0, 2), P(2, 1));
  const before = t.ed._model;
  t.ed.paste(clipText('beats', [nt('half', 6, 6)]));
  eq(ms(t.ed).map((m) => m.beats.length), [3, 0, 2]);
  eq(t.ed.getSelection(), null);
  eq(t.ed.getCursor().measure, 0);
  eq(t.ed.getCursor().beat, 2, 'after the pasted beat (3), clamped to the last beat of a full measure');
  ok(/replac/i.test(t.say()), t.say());
  t.ed.undo();
  ok(t.ed._model === before, 'one undo');
  stable(t.ed);
});
test('repeated paste: each press inserts again before the cursor beat, the cursor keeps moving after the pasted content, N undos restore', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('quarter', 1, 9)] }])] });
  const start = t.ed._model;
  const clip = clipText('beats', [nt('16th', 2, 2), nt('16th', 2, 3)]);
  for (let i = 0; i < 3; i++) t.ed.paste(clip);
  eq(v1(ms(t.ed)[0]).length, 7);
  eq(t.ed.getCursor().beat, 6);
  eq(v1(ms(t.ed)[0])[6].notes[0].fret, 9);
  for (let i = 0; i < 3; i++) t.ed.undo();
  ok(t.ed._model === start);
  eq(t.ed.canUndo(), false);
});
test('repeated paste events with no data paste the internal clipboard each time', () => {
  const t = mk({ tracks: [tab([{ beats: f(2) }, { beats: [] }])] });
  t.ed.focus();
  t.ed.setCursor({ measure: 0, beat: 0 });
  t.ed.copy();
  t.ed.setCursor({ measure: 1, beat: 0 });
  fire('paste'); fire('paste');
  eq(v1(ms(t.ed)[1]).length, 2);
  t.ed.destroy();
});
test('a measures clip pasted with a selection and the insert option inserts before the selection\'s first measure and leaves the selected beats; the cursor goes to the original measure; other tracks get empty measures', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }, { beats: f(3) }]), tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }], { name: 'B' })] });
  sel(t.ed, P(0, 0), P(0, 3));
  const clipJson = t.ed.copy();
  sel(t.ed, P(1, 0), P(1, 2));
  t.ed.paste(clipJson, { insert: true });
  eq(ms(t.ed).map((m) => v1(m).length), [4, 4, 3]);
  eq(ms(t.ed, 1).map((m) => v1(m).length), [1, 0, 1]);
  eq(t.ed.getCursor().measure, 2);
  eq(t.ed.getSelection(), null);
  stable(t.ed);
});
test('a measures clip pasted at measure 1 drops the pickup flag and leaves the carried fields on the new first measure; a beats clip pasted into a pickup keeps it', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('quarter')], pickup: true, timeSignature: { beats: 3, beatType: 4 } }, { beats: f(3) }])] });
  t.ed.paste(clipText('beats', [nt('quarter', 2, 2)]));
  eq(ms(t.ed)[0].pickup, true, 'beats paste keeps the pickup');
  eq(t.ed.getCursorInfo().pickup, true);
  t.ed.setCursor({ measure: 0, beat: 0 });
  t.ed.paste(clipText('measures', [{ beats: [nt('whole')] }]));
  eq(ms(t.ed)[0].pickup, undefined);
  eq(ms(t.ed)[0].timeSignature, { beats: 3, beatType: 4 }, 'the carried time signature stays first');
  eq(ms(t.ed)[1].pickup, undefined);
  eq(ms(t.ed)[1].timeSignature, undefined);
  eq(t.ed.getCursorInfo().pickup, false);
  stable(t.ed);
});
test('the 2000-measure boundary for a measures clip: 1999 + 1 pastes, 2000 + 1 is refused and announced', () => {
  const a = mk({ tracks: [tab(Array.from({ length: 1999 }, () => ({ beats: [] })))] });
  eq(a.ed.paste(clipText('measures', [{ beats: [nt('whole')] }]), { insert: true }), true);
  eq(ms(a.ed).length, 2000);
  eq(a.ed.paste(clipText('measures', [{ beats: [] }]), { insert: true }), false);
  eq(ms(a.ed).length, 2000);
  ok(/too large/i.test(a.say()), a.say());
});
test('the 256-beat boundary for a beats clip: 255 + 1 pastes, 256 + 1 is refused', () => {
  const a = mk({ tracks: [tab([{ beats: Array.from({ length: 255 }, () => rest('64th')) }])] });
  eq(a.ed.paste(clipText('beats', [rest('64th')])), true);
  eq(a.ed.paste(clipText('beats', [rest('64th')])), false);
  eq(v1(ms(a.ed)[0]).length, 256);
});
test('cut with a measures selection then undo restores by reference; cutting only rests copies and adds no history entry', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }, { beats: [rest('whole')] }])] });
  const m = t.ed._model;
  sel(t.ed, P(0, 0), P(0, 3));
  t.ed.cut();
  ok(t.ed._model !== m);
  t.ed.undo();
  ok(t.ed._model === m);
  sel(t.ed, P(1, 0), P(1, 0));
  t.ed.cut();
  eq(t.ed.canUndo(), false, 'only rests: nothing to clear, no history');
  eq(JSON.parse(t.ed.copy()).kind, 'measures');
});

// =====================================================================================================
// Fill (F) on odd meters, dotted and tuplet content, selections with mixed measures
// =====================================================================================================
/** F on the cursor measure of a one-measure score: the rest durations it appended, the fill word and the message. */
function fillOne(beats, ts) {
  const t = mk({ tracks: [tab([{ beats, ...(ts ? { timeSignature: ts } : {}) }])] });
  const n = beats.length;
  const r = t.press('f');
  const got = v1(ms(t.ed)[0]);
  return { r: r[0], added: got.slice(n).map((b) => b.duration), fill: t.ed.getMeasureFill(0, 0), say: t.say(), ed: t.ed };
}
test('fill an empty measure: 4/4 whole, 6/8 half+quarter, 5/4 whole+quarter, 7/8 half+quarter+eighth, 3/16 eighth+16th, 2/2 whole, 3/4 half+quarter; every one becomes Full', () => {
  const cases = [
    [null, ['whole']],
    [{ beats: 6, beatType: 8 }, ['half', 'quarter']],
    [{ beats: 5, beatType: 4 }, ['whole', 'quarter']],
    [{ beats: 7, beatType: 8 }, ['half', 'quarter', '8th']],
    [{ beats: 3, beatType: 16 }, ['8th', '16th']],
    [{ beats: 2, beatType: 2 }, ['whole']],
    [{ beats: 3, beatType: 4 }, ['half', 'quarter']],
    [{ beats: 12, beatType: 8 }, ['whole', 'half']],
  ];
  for (const [ts, want] of cases) {
    const g = fillOne([], ts);
    eq(g.added, want, JSON.stringify(ts));
    eq(g.fill, 'full', JSON.stringify(ts));
    stable(g.ed);
  }
});
test('fill after dotted and tuplet content: dotted eighth -> 16th, quarter, half; dotted half -> quarter; a complete triplet of eighths -> quarter, half; of quarters -> half; quarter + eighth -> eighth, half', () => {
  eq(fillOne([nt('8th', 1, 0, { dots: 1 })]).added, ['16th', 'quarter', 'half']);
  eq(fillOne([nt('half', 1, 0, { dots: 1 })]).added, ['quarter']);
  eq(fillOne([nt('8th', 1, 0, { tuplet: 3 }), nt('8th', 1, 0, { tuplet: 3 }), nt('8th', 1, 0, { tuplet: 3 })]).added, ['quarter', 'half']);
  eq(fillOne([nt('quarter', 1, 0, { tuplet: 3 }), nt('quarter', 1, 0, { tuplet: 3 }), nt('quarter', 1, 0, { tuplet: 3 })]).added, ['half']);
  eq(fillOne([nt('quarter'), nt('8th')]).added, ['8th', 'half']);
  eq(fillOne([nt('64th')]).added, ['64th', '32nd', '16th', '8th', 'quarter', 'half']);
  const dot = fillOne([nt('quarter', 1, 0, { dots: 1 })]);
  eq(dot.added, ['8th', 'half']);
});
test('fill refusals leave the model identical: unfinished triplet, full, overfull, two incomplete triplets; the selection and history are untouched', () => {
  for (const [beats, text] of [
    [[nt('8th', 1, 0, { tuplet: 3 })], 'Finish the tuplet first'],
    [[nt('8th', 1, 0, { tuplet: 3 }), nt('8th', 1, 0, { tuplet: 3 })], 'Finish the tuplet first'],
    [[nt('whole')], 'Measure already full'],
    [[nt('whole'), nt('quarter')], 'Measure overfull, try Reflow'],
  ]) {
    const t = mk({ tracks: [tab([{ beats }])] });
    const before = t.ed._model;
    eq(t.press('f'), [true]);
    ok(t.ed._model === before, text);
    eq(t.ed.canUndo(), false);
    eq(t.say(), text);
  }
});
test('fill puts the rests after trailing graces; a mid-score 3/4 measure fills to 3/4; the cursor stays valid when the slot disappears', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }, { beats: [nt('quarter'), grace()], timeSignature: { beats: 3, beatType: 4 } }, { beats: [nt('quarter')] }])] });
  t.ed.setCursor({ measure: 1, beat: 2 });
  t.press('f');
  eq(v1(ms(t.ed)[1]).map((b) => b.type[0] + (b.duration[0])), ['nq', 'g1', 'rq', 'rq']);
  eq(t.ed.getMeasureFill(0, 1), 'full');
  ok(t.ed.getCursor().beat < v1(ms(t.ed)[1]).length, 'cursor on a beat');
  t.ed.setCursor({ measure: 2, beat: 1 });
  t.press('f');
  eq(v1(ms(t.ed)[2]).length, 3, 'measure 3 inherits 3/4 and gets two quarter rests');
});
test('fill with a selection mixing pickup, fillable, full, tuplet-gap, overfull and empty measures: fills the fillable ones in one undo step, counts them, keeps the rest', () => {
  const m = [{ beats: [nt('quarter')], pickup: true }, { beats: [nt('quarter')] }, { beats: [nt('whole')] }, { beats: [nt('8th', 1, 0, { tuplet: 3 })] }, { beats: [nt('whole'), nt('quarter')] }, { beats: [] }];
  const t = mk({ tracks: [tab(m)] });
  t.press(key('a', CTRL));
  const before = t.ed._model;
  t.press('f');
  eq(ms(t.ed).map((x) => x.beats.length), [1, 3, 1, 1, 2, 1]);
  ok(/Filled 2 of 6 measures/.test(t.say()), t.say());
  eq(t.ed.getSelection(), null);
  t.ed.undo();
  ok(t.ed._model === before, 'one undo step');
  t.press(key('a', CTRL));
  t.ed.undo();
  const only = mk({ tracks: [tab([{ beats: [nt('whole')] }, { beats: [nt('whole'), nt('quarter')] }])] });
  only.press(key('a', CTRL), 'f');
  ok(/Nothing to fill/.test(only.say()), only.say());
  ok(only.ed.getSelection() !== null, 'a no-op keeps the selection');
  eq(only.ed.canUndo(), false);
});
test('fill on a beats selection fills every measure the selection touches, not just the selected beats; other tracks are untouched', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('quarter'), nt('quarter')] }, { beats: [nt('quarter'), nt('quarter')] }, { beats: [nt('quarter')] }]), tab([{ beats: [nt('quarter')] }], { name: 'B' })] });
  sel(t.ed, P(0, 1), P(1, 0));
  eq(t.ed.getSelection().kind, 'beats');
  t.press('f');
  eq(ms(t.ed).map((m) => m.beats.length), [3, 3, 1]);
  eq(ms(t.ed, 1)[0].beats.length, 1);
});

// =====================================================================================================
// Reflow (Shift+F)
// =====================================================================================================
const reflowKey = key('F', SHIFT);
test('reflow with graces at the boundary: the grace before the first beat past the barline moves with it', () => {
  const t = mk({ tracks: [tab([{ beats: [...f(4), grace(), nt('quarter', 1, 7)] }, { beats: [nt('half', 2, 2)] }])] });
  t.press(reflowKey);
  eq(ms(t.ed).map((m) => m.beats.map((b) => b.type[0])), [['n', 'n', 'n', 'n'], ['g', 'n', 'n']], '2.3.1: measure 2 is not left overfull, so no cascade');
  ok(/Moved 1 beat to measure 2/.test(t.say()), t.say());
});
test('reflow with a crossing beat and overflow after it: the beats at or past the barline move, the crossing beat stays, the announcement names it; cursor on a moved beat follows, cursor before it stays', () => {
  const beats = [nt('quarter'), nt('quarter'), nt('quarter'), nt('half', 1, 0, { tuplet: 3 }), nt('quarter', 1, 7)]; // 2.3.1: a triplet, which is never split
  const a = mk({ tracks: [tab([{ beats }, { beats: [nt('half', 2, 2)] }])] });
  a.ed.setCursor({ measure: 0, beat: 4 });
  a.press(reflowKey);
  eq(ms(a.ed).map((m) => m.beats.length), [4, 2]);
  eq(a.ed.getCursor(), { track: 0, measure: 1, beat: 0, string: a.ed.getCursor().string }, 'follows its beat');
  ok(/beat 4 crosses the barline and stays/.test(a.say()), a.say());
  const b = mk({ tracks: [tab([{ beats }, { beats: [nt('half', 2, 2)] }])] });
  b.ed.setCursor({ measure: 0, beat: 1 });
  b.press(reflowKey);
  eq([b.ed.getCursor().measure, b.ed.getCursor().beat], [0, 1], 'cursor before the moved part stays');
  const c = mk({ tracks: [tab([{ beats: [nt('quarter'), nt('quarter'), nt('quarter'), nt('half', 1, 0, { tuplet: 3 })] }])] });
  c.press(reflowKey);
  ok(/crosses the barline/.test(c.say()) && ms(c.ed).length === 1, 'only a crossing beat: nothing moves, no measure added');
  eq(c.ed.canUndo(), false);
  const d = mk({ tracks: [tab([{ beats: f(4) }])] });
  d.press(reflowKey);
  ok(/Nothing to reflow|nothing/i.test(d.say()), 'a full measure: nothing to move');
  eq(d.ed.canUndo(), false);
});
test('2.3.1: reflow cascades while the next measure is overfull; a 3/4 measure uses its own capacity; ties across the new barline are kept when they pair and repaired otherwise', () => {
  const t = mk({ tracks: [tab([{ beats: [...f(3), tn('quarter', 1, 7, { tieEnd: true })], timeSignature: { beats: 3, beatType: 4 } }, { beats: f(3) }])] });
  t.press(reflowKey);
  eq(ms(t.ed).map((m) => m.beats.length), [3, 3, 1], 'measure 2 became overfull, so the cascade moved its last beat on');
  eq(t.ed.getMeasureFill(0, 1), 'full');
  eq(ms(t.ed)[1].beats[0].notes[0].tieEnd, undefined, 'a tieEnd with no tieStart before it is repaired');
  const u = mk({ tracks: [tab([{ beats: [...f(3), tn('quarter', 1, 0, { tieStart: true }), tn('quarter', 1, 0, { tieEnd: true })], timeSignature: { beats: 3, beatType: 4 } }])] });
  u.ed.setCursor({ measure: 0, beat: 0 });
  u.press(reflowKey);
  eq(ms(u.ed).length, 2);
  const [last, first] = [ms(u.ed)[0].beats.at(-1), ms(u.ed)[1].beats[0]];
  eq([last.notes[0].tieStart, first.notes[0].tieEnd], [undefined, undefined], 'a tie that straddled the beats before the cut is only kept if both partners stay adjacent');
  stable(u.ed);
});
test('reflow on the last measure adds one measure to every track; the other tracks get an empty one; tempo marks travel with their beats; two voices keep voice 2', () => {
  const t = mk({ tracks: [
    tab([{ voices: [{ beats: [...f(4), nt('quarter', 1, 9, { tempo: 77 })] }, { beats: [nt('whole', 3, 3)] }] }]),
    tab([{ beats: [nt('whole')] }], { name: 'B' }),
  ] });
  t.press(reflowKey);
  eq(ms(t.ed).length, 2);
  eq(ms(t.ed, 1).length, 2);
  eq(ms(t.ed, 1)[1].beats, []);
  eq(ms(t.ed)[0].voices[1].beats, [nt('whole', 3, 3)]);
  eq(ms(t.ed)[1].beats[0].tempo, 77);
  eq(drawnTempos(t.ed.getScore()), ['= 77']);
});
test('reflow at the 2000-measure limit: the last measure is refused (tooLarge, nothing changes); a measure before the end still reflows', () => {
  const last = mk({ tracks: [tab(Array.from({ length: 2000 }, (_, i) => (i === 1999 ? { beats: [nt('whole'), nt('quarter')] } : { beats: [] })))] });
  last.ed.setCursor({ measure: 1999, beat: 0 });
  const before = last.ed._model;
  last.press(reflowKey);
  ok(last.ed._model === before);
  ok(/too large/i.test(last.say()), last.say());
  const mid = mk({ tracks: [tab(Array.from({ length: 2000 }, (_, i) => (i === 1998 ? { beats: [nt('whole'), nt('quarter')] } : { beats: [] })))] });
  mid.ed.setCursor({ measure: 1998, beat: 0 });
  mid.press(reflowKey);
  eq(ms(mid.ed).length, 2000);
  eq(v1(ms(mid.ed)[1999]).length, 1);
});
test('reflow ignores a selection (design D18): it acts on the cursor measure (the focus) and the changed model clears the selection', () => {
  const t = mk({ tracks: [tab([{ beats: [...f(4), nt('quarter', 1, 8)] }, { beats: [...f(4), nt('quarter', 1, 8)] }, { beats: f(4) }])] });
  sel(t.ed, P(2, 0), P(1, 3));
  eq(t.ed.getCursor().measure, 1, 'the focus is the cursor');
  t.press(reflowKey);
  eq(ms(t.ed).map((m) => m.beats.length), [5, 4, 4, 1], 'from the cursor measure on (2.3.1 cascade); measure 1, the other end of the selection, is untouched');
  eq(t.ed.getSelection(), null);
});

// =====================================================================================================
// Pickup measure
// =====================================================================================================
test('pickup on any track counts: set only on a hidden track 2, fill is refused on track 1, the overlay reads pickup for every track\'s underfull measure 1 and keeps over', async () => {
  const F = await imp('src/editor/model/fill.js');
  const t = mk({ tracks: [
    tab([{ beats: [nt('quarter')] }, { beats: f(4) }]),
    tab([{ beats: [nt('whole'), nt('quarter')] }], { name: 'B' }),
    { name: 'Hid', showStandardNotation: false, measures: [{ beats: [nt('quarter')], pickup: true }] },
  ] });
  eq(t.ed.getCursorInfo().pickup, true);
  eq(F.overlayFills(t.ed._model).map((r) => r[0]), ['pickup', 'over', 'pickup'], 'every track underfull measure 1 reads pickup, an overfull one keeps over');
  t.press('f');
  ok(/Pickup measure, not filled/.test(t.say()), t.say());
  eq(t.ed.getMeasureFill(0, 0), 'under', 'getMeasureFill still says under');
  eq(F.overlayFills(t.ed._model)[0][1], 'full');
});
test('pickup only counts when true and on measure 1: pickup on measure 2 or a non-true value is ignored by the editor (fill works, cursor info says no pickup)', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('quarter')], pickup: 1 }, { beats: [nt('quarter')], pickup: true }])] });
  eq(t.ed.getCursorInfo().pickup, false);
  t.press('f');
  eq(ms(t.ed)[0].beats.length, 3, 'a non-true pickup does not block fill');
  t.ed.setCursor({ measure: 1, beat: 0 });
  eq(t.ed.getCursorInfo().pickup, false);
  t.press('f');
  eq(ms(t.ed)[1].beats.length, 3);
});
test('pickup: Shift+Delete of measure 1 (alone or with later ones) and Ctrl+A + Shift+Delete never carry the flag; clear / remove / cut of its beats keep it; undo restores by reference', () => {
  const s = () => ({ tracks: [tab([{ beats: [nt('quarter')], pickup: true }, { beats: f(4) }, { beats: f(4) }]), tab([{ beats: [nt('quarter')] }, { beats: [nt('whole')] }], { name: 'B' })] });
  const t = mk(s());
  const before = t.ed._model;
  sel(t.ed, P(0, 0), P(0, 1));
  eq(t.ed.getSelection().kind, 'measures', 'the slot of the underfull pickup is part of the measure');
  t.press(key('Delete', SHIFT));
  eq(ms(t.ed).map((m) => m.pickup), [undefined, undefined]);
  eq(ms(t.ed, 1).map((m) => m.pickup), [undefined], 'track B lost its first column too');
  t.ed.undo();
  ok(t.ed._model === before);
  t.press(key('a', CTRL), key('Delete', SHIFT));
  eq(ms(t.ed), [{ beats: [] }], 'no pickup carried into the single measure left');
  t.ed.undo();
  sel(t.ed, P(0, 0), P(0, 0));
  t.press('Delete');
  eq(ms(t.ed)[0].pickup, true, 'clear keeps it');
  t.ed.undo();
  sel(t.ed, P(0, 0), P(0, 0));
  t.press(key('Delete', CTRL));
  eq([ms(t.ed)[0].pickup, ms(t.ed, 1)[0].pickup], [true, undefined], 'remove keeps it');
});
test('pickup is dropped from clips: a measures clip of a pickup measure has no pickup field and pastes with none', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('quarter')], pickup: true, timeSignature: { beats: 3, beatType: 4 } }, { beats: f(4) }])] });
  t.press(key('a', CTRL));
  const text = t.ed.copy();
  ok(!/pickup|timeSignature/.test(text), text);
  const u = mk({ tracks: [tab([{ beats: f(4) }])] });
  u.ed.paste(text);
  eq(ms(u.ed).map((m) => m.pickup), [undefined, undefined, undefined]);
});
test('pickup: updateMeasure(0) then undo restores by reference; addTrack copies it and removeTrack(0) keeps it on the remaining tracks', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('quarter')] }, { beats: f(4) }]), tab([{ beats: [nt('whole')] }, { beats: [nt('whole')] }], { name: 'B' })] });
  const before = t.ed._model;
  t.ed.updateMeasure(0, { pickup: true });
  eq(ms(t.ed, 1)[0].pickup, true);
  t.ed.addTrack('bass4');
  eq(ms(t.ed, 2)[0].pickup, true);
  t.ed.removeTrack(0);
  eq(ms(t.ed, 0)[0].pickup, true);
  eq(t.ed.getCursorInfo().pickup, true);
  t.ed.undo(); t.ed.undo();
  t.ed.undo();
  ok(t.ed._model === before);
});

// =====================================================================================================
// Score-wide tempo: de-duplication, migration, parity after random edits
// =====================================================================================================
const tempoScore = () => ({ tracks: [
  tab([{ beats: [nt('quarter', 1, 0, { tempo: 100 }), nt('quarter'), nt('half', 1, 0, { tempo: 55 })] }, { beats: [nt('whole')] }], { name: 'T0' }),
  { name: 'Hid', showStandardNotation: false, measures: [{ beats: [nt('quarter', 1, 0, { tempo: 110 }), nt('quarter'), nt('half')] }, { beats: [nt('whole')] }] },
  tab([{ beats: [nt('quarter', 1, 0, { tempo: 120 }), nt('half'), nt('quarter')] }, { beats: [nt('whole')] }], { name: 'T2' }),
] });
const marksOf = (ed) => TP.tempoMarks(ed._model).marks.map((m) => [m.measure, formatBpm(m.tempo.bpm), m.track, m.beat]);
test('setTempo from a higher track removes the readable marks of every lower and hidden track at that onset, leaves other onsets, and draws the new one; one undo restores by reference', () => {
  const t = mk(tempoScore());
  const before = t.ed._model;
  t.ed.setCursor({ track: 2, measure: 0, beat: 0 });
  eq(t.ed.setTempo(90), true);
  eq(marksOf(t.ed), [[0, '90', 2, 0], [0, '55', 0, 2]]);
  eq(drawnTempos(t.ed.getScore()), ['= 90', '= 55']);
  eq(t.ed.getCursorInfo().tempo.bpm, 90);
  t.ed.undo();
  ok(t.ed._model === before);
  t.ed.setCursor({ track: 2, measure: 0, beat: 0 });
  eq(t.ed.setTempo(null), true);
  eq(marksOf(t.ed), [[0, '55', 0, 2]], 'null clears every track at the onset');
  eq(t.ed.setTempo(null), false, 'nothing left at that onset: no change');
});
test('setTempo leaves unreadable marks alone and a value equal to the winner on the cursor track changes nothing', () => {
  const s = tempoScore();
  s.tracks[0].measures[0].beats[0].tempo = 'nope';
  const t = mk(s);
  t.ed.setCursor({ track: 2, measure: 0, beat: 0 });
  eq(drawnTempos(t.ed.getScore())[0], '= 110', 'the hidden track now wins');
  t.ed.setTempo(90);
  eq(ms(t.ed)[0].beats[0].tempo, 'nope', 'the unreadable mark on track 1 stays');
  eq(ms(t.ed, 1)[0].beats[0].tempo, undefined, 'the readable hidden one goes');
  eq(drawnTempos(t.ed.getScore())[0], '= 90');
  const m = t.ed._model;
  eq(t.ed.setTempo(90), false);
  ok(t.ed._model === m);
});
test('removeTrack migration: a mark moves to the lowest remaining track with a voice-1 main beat at exactly that onset (not a straddling beat, not voice 2); otherwise it is dropped and counted; getRemoveTrackImpact agrees', () => {
  const s = { tracks: [
    tab([{ beats: [nt('quarter', 1, 0, { tempo: 100 }), nt('quarter', 1, 0, { tempo: { bpm: 70, unit: 'half' } }), nt('8th'), nt('8th', 1, 0, { tempo: 50 }), nt('quarter')] }], { name: 'T0' }),
    tab([{ beats: [nt('half'), grace(), nt('quarter'), nt('quarter')] }], { name: 'T1' }),
    tab([{ voices: [{ beats: [nt('quarter'), nt('quarter'), nt('half')] }, { beats: [nt('quarter'), nt('quarter'), nt('8th'), nt('8th'), nt('quarter')] }] }], { name: 'T2' }),
  ] };
  const t = mk(s);
  eq(t.ed.getRemoveTrackImpact(0).tempoMarks, 1, 'only the mark at 5/8 has no voice-1 beat on any other track (voice 2 of T2 has one)');
  eq(t.ed.removeTrack(0), true);
  ok(/1 tempo mark removed/.test(t.say()), t.say());
  const out = t.ed.getScore().tracks;
  eq(out[0].measures[0].beats[0].tempo, 100, 'T1 has a beat at onset 0 (the half)');
  eq(out[0].measures[0].beats[1].tempo, undefined, 'T1 has no beat at 1/4: its half straddles it');
  eq(out[1].measures[0].voices[0].beats[1].tempo, { bpm: 70, unit: 'half' }, 'T2 voice 1 has the beat at 1/4; the raw value moves as written');
  eq(drawnTempos(t.ed.getScore()), ['= 100', '= 70'], 'the renderer agrees');
});
test('render parity after random edits: tempo, track and column edits, fills, reflows, clipboard and undo keep the editor\'s winners equal to what the renderer draws, and the model stable', () => {
  for (const seed of [11, 12, 13, 14, 15, 16]) {
    const rnd = mulberry32(seed * 977);
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    const mkTrack = (i, hidden) => {
      const ms2 = Array.from({ length: 4 }, () => ({ beats: Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => nt(pick(['quarter', '8th', 'half']), 1 + Math.floor(rnd() * 6), Math.floor(rnd() * 9), rnd() < 0.3 ? { tempo: pick([60, 90, 120, 150, { bpm: 80, unit: 'half' }]) } : {})) }));
      return hidden ? { name: `H${i}`, showStandardNotation: false, measures: ms2 } : tab(ms2, { name: `T${i}` });
    };
    const t = mk({ tracks: [mkTrack(0, false), mkTrack(1, rnd() < 0.5), mkTrack(2, false)] });
    const ed = t.ed;
    for (let step = 0; step < 70; step++) {
      const n = ed.getScore().tracks.length;
      const c = ed.getCursor();
      const mc = ed.getScore().tracks[0].measures.length;
      const op = Math.floor(rnd() * 16);
      if (op === 0) ed.setCursor({ track: Math.floor(rnd() * n), measure: Math.floor(rnd() * mc), beat: Math.floor(rnd() * 4) });
      else if (op === 1) ed.setTempo(pick([70, 100, 133, null, { bpm: 90, unit: 'half' }]));
      else if (op === 2) { try { ed.removeTrack(Math.floor(rnd() * n)); } catch { /* refused */ } }
      else if (op === 3) { try { ed.moveTrack(Math.floor(rnd() * n), Math.floor(rnd() * n)); } catch { /* refused */ } }
      else if (op === 4 && n < 5) ed.addTrack('guitar6');
      else if (op === 5) t.press('f');
      else if (op === 6) t.press(reflowKey);
      else if (op === 7) { try { sel(ed, P(c.measure, 0), P(Math.min(mc - 1, c.measure + Math.floor(rnd() * 2)), 3), c.track); } catch { /* clamp */ } }
      else if (op === 8) t.press(key('Delete', CTRL));
      else if (op === 9) t.press(key('Delete', SHIFT));
      else if (op === 10) t.press('Delete');
      else if (op === 11) ed.copy();
      else if (op === 12) ed.paste();
      else if (op === 13) ed.undo();
      else if (op === 14) ed.redo();
      else t.press(key('a', CTRL));
      stable(ed);
      const want = TP.tempoMarks(ed._model).winners.map((w) => `= ${formatBpm(w.tempo.bpm)}`);
      eq(drawnTempos(ed.getScore()), want, `seed ${seed} step ${step} op ${op}`);
      const k = ed.getCursor();
      ok(k.track < ed.getScore().tracks.length && k.measure < Math.max(...ed.getScore().tracks.map((x) => x.measures.length)), 'cursor in range');
    }
  }
});

// =====================================================================================================
// Clipboard events: focus, dialogs, two editors, precedence, hostile clips, the R6 fallback
// =====================================================================================================
const beatsClip = (...b) => clipText('beats', b);
test('native events while focus is inside a dialog (not the editor root) are ignored, keydown Ctrl+V on the dialog schedules nothing, and returning focus re-enables them', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }])] });
  const dlg = makeContainer();
  t.ed.focus();
  sel(t.ed, P(0, 0), P(0, 1));
  t.ed.copy();
  const before = t.ed._model;
  dlg.focus();
  eq(document.activeElement, dlg);
  const c = fire('copy');
  const x = fire('cut');
  const p = fire('paste', { [CLIP_MIME]: beatsClip(nt('quarter', 3, 3)) });
  eq([c.e.defaultPrevented, x.e.defaultPrevented, p.e.defaultPrevented], [false, false, false]);
  eq(c.clipboardData.data.size, 0, 'nothing written');
  ok(t.ed._model === before, 'nothing pasted or cut');
  const timers = t.clock.pendingTimers();
  dlg.dispatch('keydown', { ...key('v', CTRL), target: dlg });
  eq(t.clock.pendingTimers(), timers, 'no fallback timer');
  t.clock.advance(10);
  ok(t.ed._model === before);
  t.ed.focus();
  const q = fire('paste', { [CLIP_MIME]: beatsClip(nt('quarter', 3, 3)) });
  eq(q.e.defaultPrevented, true);
  ok(t.ed._model !== before);
  t.ed.destroy();
});
test('an already-prevented native event is not handled twice; a keydown on a child of the root never schedules the fallback', () => {
  const t = mk({ tracks: [tab([{ beats: [] }])] });
  t.ed.focus();
  const before = t.ed._model;
  const clipboardData = makeClipboardData({ [CLIP_MIME]: beatsClip(nt('quarter')) });
  document.dispatch('paste', { clipboardData, defaultPrevented: true });
  ok(t.ed._model === before);
  const child = makeContainer();
  const timers = t.clock.pendingTimers();
  t.root.dispatch('keydown', { ...key('v', CTRL), target: child });
  eq(t.clock.pendingTimers(), timers);
  t.ed.destroy();
});
test('precedence on paste: custom type, then text/plain that is a clip, then the internal clipboard; non-clip text, a throwing clipboardData and empty data fall back to the internal one; a bad custom clip is refused with no fallback', () => {
  const t = mk({ tracks: [tab([{ beats: [] }, { beats: [] }, { beats: [] }, { beats: [] }, { beats: [] }, { beats: [] }, { beats: [] }])] });
  t.ed.focus();
  t.ed.paste(beatsClip(nt('quarter', 1, 11)));
  t.ed.setCursor({ measure: 0, beat: 0 });
  t.ed.copy(); // internal: fret 11
  const fretAt = (mi) => { const b = v1(ms(t.ed)[mi])[0]; return b && b.notes[0].fret; };
  const go = (mi, init, opts) => { t.ed.setCursor({ measure: mi, beat: 0 }); return fire('paste', init, opts); };
  go(1, { [CLIP_MIME]: beatsClip(nt('quarter', 1, 21)), 'text/plain': beatsClip(nt('quarter', 1, 22)) });
  eq(fretAt(1), 21, 'custom wins over text/plain');
  go(2, { 'text/plain': beatsClip(nt('quarter', 1, 23)) });
  eq(fretAt(2), 23, 'text/plain clip over internal');
  go(3, { 'text/plain': 'hello world' });
  eq(fretAt(3), 11, 'plain text falls back to internal');
  go(4, { 'text/plain': JSON.stringify({ type: 'other', version: 1 }) });
  eq(fretAt(4), 11, 'JSON of another type falls back to internal');
  go(5, {}, { throws: true });
  eq(fretAt(5), 11, 'a refusing clipboardData falls back to internal');
  const before = t.ed._model;
  go(6, { [CLIP_MIME]: '{"type":"music-score-clip","version":9}', 'text/plain': beatsClip(nt('quarter', 1, 24)) });
  ok(t.ed._model === before, 'a bad custom clip is refused, not replaced by text/plain or internal');
  ok(/version/i.test(t.say()), t.say());
  go(6, { 'text/plain': '{"type":"music-score-clip","__proto__":{"x":1}}' });
  ok(t.ed._model === before, 'a text/plain clip with __proto__ is refused whole, no fallback');
  t.ed.destroy();
});
test('copy and cut events: a clipboardData that throws on setData leaves the event unhandled but the internal clipboard updated; read-only cut is not prevented and changes nothing', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }, { beats: [] }])] });
  t.ed.focus();
  sel(t.ed, P(0, 1), P(0, 2));
  const c = fire('copy', {}, { throws: true });
  eq(c.e.defaultPrevented, false);
  t.ed.setCursor({ measure: 1, beat: 0 });
  t.ed.paste();
  eq(v1(ms(t.ed)[1]).length, 2, 'the internal clipboard was updated');
  t.ed.setReadOnly(true);
  const before = t.ed._model;
  sel(t.ed, P(0, 0), P(0, 1));
  const x = fire('cut');
  eq(x.e.defaultPrevented, false);
  ok(t.ed._model === before);
  ok(/Read-only/.test(t.say()), t.say());
  const p = fire('paste', { [CLIP_MIME]: beatsClip(nt('quarter')) });
  ok(t.ed._model === before && p.e.defaultPrevented === true);
  const k = fire('copy');
  eq(k.e.defaultPrevented, true, 'copy works in read-only mode');
  t.ed.destroy();
});
test('hostile clips: each variant is refused (or sanitized) without throwing, leaves a sanitize-stable model and no prototype pollution; refusals keep the model by reference', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('whole')] }])] });
  const raw = (beats, extra = {}) => JSON.stringify({ type: CLIP_TYPE, version: 1, kind: 'beats', tracks: [{ beats, ...extra }] });
  const deepObj = (n) => '{"a":'.repeat(n) + '1' + '}'.repeat(n);
  const deepArr = (n) => '['.repeat(n) + ']'.repeat(n);
  const note = '{"type":"note","duration":"quarter","notes":[{"string":1,"fret":0}]';
  const refused = [
    ['version 2', JSON.stringify({ type: CLIP_TYPE, version: 2, kind: 'beats', tracks: [{ beats: [nt('quarter')] }] })],
    ['version string', JSON.stringify({ type: CLIP_TYPE, version: '1', kind: 'beats', tracks: [{ beats: [nt('quarter')] }] })],
    ['version 1.5', JSON.stringify({ type: CLIP_TYPE, version: 1.5, kind: 'beats', tracks: [{ beats: [nt('quarter')] }] })],
    ['no version', JSON.stringify({ type: CLIP_TYPE, kind: 'beats', tracks: [{ beats: [nt('quarter')] }] })],
    ['kind column', JSON.stringify({ type: CLIP_TYPE, version: 1, kind: 'column', tracks: [{ beats: [nt('quarter')] }] })],
    ['two tracks', JSON.stringify({ type: CLIP_TYPE, version: 1, kind: 'beats', tracks: [{ beats: [nt('quarter')] }, { beats: [nt('quarter')] }] })],
    ['tracks object', JSON.stringify({ type: CLIP_TYPE, version: 1, kind: 'beats', tracks: { beats: [] } })],
    ['bare array', JSON.stringify([nt('quarter')])],
    ['string', JSON.stringify('x')],
    ['null', 'null'],
    ['truncated', raw([nt('quarter')]).slice(0, -5)],
    ['__proto__ in a note', `{"type":"${CLIP_TYPE}","version":1,"kind":"beats","tracks":[{"beats":[${note.replace('"fret":0}', '"fret":0,"__proto__":{"x":1}}')}}]}]}`],
    ['__proto__ at the top', `{"__proto__":{"x":1},"type":"${CLIP_TYPE}","version":1,"kind":"beats","tracks":[{"beats":[]}]}`],
    ['tuning of 13', raw([nt('quarter')], { tuning: Array(13).fill('E2') })],
    ['tuning not an array', raw([nt('quarter')], { tuning: 'E2' })],
    ['tuning junk', raw([nt('quarter')], { tuning: ['H9', 'E2'] })],
    ['deep object 5000', `{"type":"${CLIP_TYPE}","version":1,"kind":"beats","tracks":[{"beats":[${note},"x":${deepObj(5000)}}]}]}`],
    ['deep array 100000', `{"type":"${CLIP_TYPE}","version":1,"kind":"beats","tracks":[{"beats":[${note},"x":${deepArr(100000)}}]}]}`],
    ['deep object 100000', `{"type":"${CLIP_TYPE}","version":1,"kind":"beats","tracks":[{"beats":[${note},"x":${deepObj(100000)}}]}]}`],
    ['5 MB + 1', ' '.repeat(EDITOR_LIMITS.jsonChars + 1)],
    ['more than 256 beats', raw(Array.from({ length: 257 }, () => rest('64th')))],
    ['empty beats', raw([])],
    ['no beats key', JSON.stringify({ type: CLIP_TYPE, version: 1, kind: 'beats', tracks: [{}] })],
    ['beats of junk', raw([null, 5, 'x', [1]])],
    ['measures not an array', JSON.stringify({ type: CLIP_TYPE, version: 1, kind: 'measures', tracks: [{ measures: { a: 1 } }] })],
    ['measures with null', JSON.stringify({ type: CLIP_TYPE, version: 1, kind: 'measures', tracks: [{ measures: [null] }] })],
    ['measures over 2000', JSON.stringify({ type: CLIP_TYPE, version: 1, kind: 'measures', tracks: [{ measures: Array.from({ length: 2001 }, () => ({ beats: [] })) }] })],
  ];
  for (const [name, text] of refused) {
    const before = t.ed._model;
    let r;
    try { r = t.ed.paste(text); } catch (e) { throw new Error(`${name}: threw ${e.message}`); }
    eq(r, false, name);
    ok(t.ed._model === before, `${name}: model unchanged`);
    ok(t.say().length > 0, `${name}: announced`);
  }
  eq(t.ed.canUndo(), false);
  // survivors: sanitized, never polluting
  const odd = [
    raw([{ type: 'note', duration: 'banana', notes: [{ string: 1, fret: 0 }] }]),
    raw([{ type: 'note', duration: 'quarter', notes: [{ string: 1e9, fret: -5 }] }]),
    raw([{ ...nt('quarter'), constructor: { prototype: { polluted: 1 } }, prototype: { polluted: 2 } }]),
    raw([{ type: 'note', duration: 'quarter', notes: [{ string: 1, fret: 0, constructor: 'x' }], toString: 1, hasOwnProperty: 2 }]),
  ];
  for (const text of odd) { t.ed.paste(text); stable(t.ed); eq(({}).polluted, undefined); }
  eq(Object.prototype.polluted, undefined);
  ok(JSON.parse(t.ed.getScore() ? JSON.stringify(t.ed.getScore()) : '{}').tracks.length === 1);
  const e2 = mk(JSON.parse(JSON.stringify(t.ed.getScore())));
  stable(e2.ed);
});
test('fuzzed clips: 600 seeded mutations of a valid beats and measures clip never throw; an accepted paste is sanitize-stable with a valid cursor and one undo; a refusal changes nothing', () => {
  const rnd = mulberry32(2330);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const WEIRD = [null, 0, -1, 1e9, 1.5, 'x', '', [], {}, true, [[]], { a: 1 }, 'quarter', 'whole', { string: 1, fret: 2 }, [{ string: 1, fret: 2 }], NaN, 2 ** 53];
  const valid = [
    { type: CLIP_TYPE, version: 1, kind: 'beats', tracks: [{ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], beats: [grace(), nt('quarter', 2, 3, { tieStart: true }), tn('quarter', 2, 3, { tieEnd: true }), rest('half', { tuplet: 3 })] }] },
    { type: CLIP_TYPE, version: 1, kind: 'measures', tracks: [{ measures: [{ beats: [nt('whole')] }, { voices: [{ beats: f(4) }, { beats: [nt('whole', 3, 3)] }] }, { beats: [] }] }] },
  ];
  const mutate = (v, depth = 0) => {
    if (Array.isArray(v)) { const a = v.map((x) => mutate(x, depth + 1)); if (rnd() < 0.1) a.splice(Math.floor(rnd() * (a.length + 1)), 0, pick(WEIRD)); return a; }
    if (v && typeof v === 'object') {
      const o = {};
      for (const [k, x] of Object.entries(v)) { if (rnd() < 0.06) continue; o[k] = rnd() < 0.12 ? pick(WEIRD) : mutate(x, depth + 1); }
      if (rnd() < 0.08) o[pick(['constructor', 'prototype', 'toString', 'extra', 'tempo', 'timeSignature', 'pickup'])] = pick(WEIRD);
      return o;
    }
    return v;
  };
  const t = mk({ tracks: [tab([{ beats: f(4) }, { beats: f(2) }]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  let accepted = 0, refusedN = 0;
  for (let i = 0; i < 600; i++) {
    const text = JSON.stringify(mutate(pick(valid)));
    const before = t.ed._model;
    t.ed.setCursor({ track: Math.floor(rnd() * 2), measure: Math.floor(rnd() * 2), beat: Math.floor(rnd() * 3) });
    let r;
    try { r = t.ed.paste(text); } catch (e) { throw new Error(`run ${i} threw ${e.message}\n${text}`); }
    if (r) {
      accepted++;
      stable(t.ed);
      const c = t.ed.getCursor();
      ok(c.track < t.ed.getScore().tracks.length && c.measure < Math.max(...t.ed.getScore().tracks.map((x) => x.measures.length)), `run ${i}: cursor (the column count is the longest track)`);
      ok(JSON.stringify(t.ed.getScore()).length <= EDITOR_LIMITS.jsonChars);
      t.ed.undo();
      ok(t.ed._model === before, `run ${i}: one undo restores by reference`);
    } else { refusedN++; ok(t.ed._model === before, `run ${i}: refusal changed the model`); }
  }
  ok(accepted > 50 && refusedN > 50, `${accepted} accepted, ${refusedN} refused`);
  eq(Object.prototype.polluted, undefined);
});
test('R6: two quick Ctrl+V keydowns paste once; Ctrl+Shift+V and Shift+Insert also schedule the fallback; read-only refuses it; a native paste after the fallback pasted is a second, separate paste; nothing happens after destroy', () => {
  const t = mk({ tracks: [tab([{ beats: [] }])] });
  t.ed.focus();
  t.ed.paste(beatsClip(nt('quarter', 1, 5)));
  t.ed.setCursor({ beat: 0 });
  t.ed.copy();
  const n = () => v1(ms(t.ed)[0]).length;
  const base = n();
  const kd = (k, m) => t.root.dispatch('keydown', { ...key(k, m), target: t.root });
  const e1 = kd('v', CTRL); const e2 = kd('v', CTRL);
  eq([e1.defaultPrevented, e2.defaultPrevented], [false, false]);
  t.clock.advance(0);
  eq(n(), base + 1, 'the second keydown replaced the first timer: one paste');
  kd('V', { ctrlKey: true, shiftKey: true });
  t.clock.advance(0);
  eq(n(), base + 2);
  kd('Insert', SHIFT);
  t.clock.advance(0);
  eq(n(), base + 3);
  kd('c', CTRL); kd('x', CTRL); kd('Insert', CTRL);
  t.clock.advance(10);
  eq(n(), base + 3, 'copy / cut / Ctrl+Insert keys schedule no paste');
  kd('v', CTRL);
  fire('paste', { [CLIP_MIME]: beatsClip(nt('quarter', 1, 6)) });
  t.clock.advance(50);
  eq(n(), base + 4, 'a native paste cancels the fallback: exactly one paste');
  t.ed.setReadOnly(true);
  kd('v', CTRL);
  t.clock.advance(0);
  eq(n(), base + 4);
  ok(/Read-only/.test(t.say()), t.say());
  t.ed.setReadOnly(false);
  kd('v', CTRL);
  t.ed.destroy();
  t.clock.advance(100);
  eq(t.clock.pendingTimers(), 0);
  const n0 = document.listenerCount();
  fire('paste', { [CLIP_MIME]: beatsClip(nt('quarter')) });
  eq(document.listenerCount(), n0);
});
test('two editors share the internal clipboard across loadScore and destroy of the first; a destroyed editor ignores events and its public clipboard methods throw', () => {
  const a = mk({ tracks: [tab([{ beats: f(2) }])] });
  const b = mk({ tracks: [tab([{ beats: [] }])] });
  sel(a.ed, P(0, 0), P(0, 1));
  a.ed.copy();
  a.ed.destroy();
  throws(() => a.ed.copy(), Error);
  throws(() => a.ed.paste(), Error);
  b.ed.focus();
  fire('paste');
  eq(v1(ms(b.ed)[0]).length, 2, 'the internal clipboard outlives the editor that wrote it');
  b.ed.loadScore({ tracks: [tab([{ beats: [] }])] });
  eq(b.ed.paste(), true);
  eq(v1(ms(b.ed)[0]).length, 2);
  b.ed.destroy();
});

// =====================================================================================================
// Keymap, selection clearing by settings calls, API argument handling
// =====================================================================================================
test('keymap (D1, D7): of Ctrl / Cmd + letter only Z, Y and A are bound (Ctrl+C / X / V never, so the native events fire); Alt and Ctrl+Shift+other stay unbound; the keys still reserved after 2.3.1 stay free', async () => {
  const { keyToCommand } = await imp('src/editor/keymap.js');
  const bound = new Set();
  for (const m of [CTRL, { metaKey: true }, { ctrlKey: true, shiftKey: true }, { ctrlKey: true, altKey: true }, { altKey: true }, { altKey: true, shiftKey: true }]) {
    for (const l of 'abcdefghijklmnopqrstuvwxyz') {
      for (const k of [l, l.toUpperCase()]) { const c = keyToCommand(key(k, m)); if (c) bound.add(`${m.altKey ? 'alt' : m.metaKey ? 'meta' : m.shiftKey ? 'ctrl+shift' : 'ctrl'} ${l} ${c.name}`); }
    }
  }
  eq([...bound].sort(), ['ctrl a selectAll', 'ctrl y redo', 'ctrl z undo', 'ctrl+shift y redo', 'ctrl+shift z redo', 'meta a selectAll', 'meta y redo', 'meta z undo']);
  for (const [k, m] of [['Insert', CTRL], ['Insert', SHIFT], ['Tab', {}], ['F5', {}], ['f', { altKey: true }], ['F', { ctrlKey: true, shiftKey: true }], ['ArrowLeft', { shiftKey: true, altKey: true }], ['R', SHIFT], ['I', SHIFT]]) {
    eq(keyToCommand(key(k, m)), null, `${k} ${JSON.stringify(m)}`);
  }
  eq(keyToCommand(key('f')).name, 'fill');
  eq(keyToCommand(key('F', SHIFT)).name, 'reflow');
});
test('Ctrl+C / X / V through handleKey are never consumed; Esc is consumed only while a selection or a two-digit entry is live; an edit key clears the selection', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }])] });
  eq(t.press(key('c', CTRL), key('x', CTRL), key('v', CTRL), key('Insert', SHIFT), key('Insert', CTRL)), [false, false, false, false, false]);
  eq(t.press('Escape'), [false]);
  t.press(key('a', CTRL));
  eq(t.press('Escape'), [true]);
  eq([t.ed.getSelection(), t.press('Escape')], [null, [false]]);
  t.press('1');
  eq(t.press('Escape'), [true], 'a pending two-digit entry');
  t.press(key('ArrowRight', SHIFT), '2');
  eq(t.ed.getSelection(), null, 'an edit key clears the selection');
});
test('settings calls that change the model clear a live selection with selection(null); a call that changes nothing keeps it; a refused call in read-only keeps it', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }, { beats: f(4) }]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  const nulls = () => t.events.filter((e) => e[0] === 'selection' && e[1] === null).length;
  sel(t.ed, P(0, 0), P(0, 2), 0);
  t.ed.updateScore({ title: 'Song' });
  eq([t.ed.getSelection(), nulls()], [null, 1]);
  sel(t.ed, P(0, 0), P(0, 2), 0);
  eq(t.ed.updateScore({ title: 'Song' }), false, 'no change');
  ok(t.ed.getSelection() !== null);
  t.ed.addTrack('bass4');
  eq(t.ed.getSelection(), null);
  sel(t.ed, P(0, 0), P(0, 2), 0);
  t.ed.removeTrack(1);
  eq(t.ed.getSelection(), null);
  sel(t.ed, P(0, 0), P(0, 2), 0);
  t.ed.setTempo(80);
  eq(t.ed.getSelection(), null);
  sel(t.ed, P(0, 0), P(0, 2), 0);
  t.ed.setReadOnly(true);
  eq(t.ed.updateScore({ title: 'Other' }), false);
  ok(t.ed.getSelection() !== null, 'a refused call keeps the selection');
  t.ed.loadScore({ tracks: [tab([{ beats: f(4) }])] });
  eq(t.ed.getSelection(), null);
  eq(t.ed.getCursorInfo().selection, null);
});
test('getCursorInfo().selection mirrors getSelection() and both are copies', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }, { beats: f(4) }])] });
  sel(t.ed, P(0, 1), P(1, 1));
  eq(t.ed.getCursorInfo().selection, t.ed.getSelection());
  const s1 = t.ed.getSelection();
  s1.start.measure = 99; s1.measures[0] = 99; s1.beatCount = 0;
  eq(t.ed.getSelection().start.measure, 0);
  eq(t.ed.getSelection().measures, [0, 1]);
});
test('paste(input) argument handling: an object clip pastes; a cyclic object, a number, a boolean, null and a function are refused without throwing; no argument uses the internal clipboard', () => {
  const t = mk({ tracks: [tab([{ beats: [] }])] });
  eq(t.ed.paste({ type: CLIP_TYPE, version: 1, kind: 'beats', tracks: [{ beats: [nt('quarter', 1, 4)] }] }), true);
  const cyc = { type: CLIP_TYPE, version: 1, kind: 'beats', tracks: [] };
  cyc.tracks.push(cyc);
  const before = t.ed._model;
  for (const bad of [cyc, 42, true, null, () => 1]) {
    let r;
    try { r = t.ed.paste(bad); } catch (e) { throw new Error(`threw ${e.message}`); }
    eq(r, false);
  }
  ok(t.ed._model === before);
  t.ed.setCursor({ beat: 0 });
  t.ed.copy();
  eq(t.ed.paste(), true);
});
test('a beats clip pasted over a whole-measures selection replaces every beat of those measures; the measures and their fields stay; one undo', () => {
  const t = mk({ tracks: [tab([{ beats: f(4), timeSignature: { beats: 4, beatType: 4 } }, { beats: f(4) }, { beats: f(4) }])] });
  t.press(key('a', CTRL));
  const before = t.ed._model;
  eq(t.ed.paste(beatsClip(nt('half', 5, 5))), true);
  eq(ms(t.ed).map((m) => m.beats.length), [1, 0, 0]);
  eq(ms(t.ed)[0].timeSignature, { beats: 4, beatType: 4 });
  t.ed.undo();
  ok(t.ed._model === before);
});
test('a measures clip pasted on track 2 lands in that track, and the other tracks get empty measures at the same columns', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('whole', 1, 1)] }, { beats: [nt('whole', 1, 2)] }]), tab([{ beats: [nt('whole', 2, 3)] }, { beats: [nt('whole', 2, 4)] }], { name: 'B' })] });
  t.ed.setCursor({ track: 1, measure: 1, beat: 0 });
  eq(t.ed.paste(clipText('measures', [{ beats: [nt('whole', 3, 9)] }, { beats: [nt('half', 3, 8)] }])), true);
  eq(ms(t.ed, 1).map((m) => m.beats.map((b) => b.notes[0].fret)), [[3], [9], [8], [4]]);
  eq(ms(t.ed, 0).map((m) => m.beats.length), [1, 0, 0, 1]);
  eq(t.ed.getCursor().track, 1);
  eq(t.ed.getCursor().measure, 3);
});
test('an oversized clip: the custom type is refused with no fallback; oversized text/plain is not a clip and falls back to the internal clipboard', () => {
  const t = mk({ tracks: [tab([{ beats: [] }, { beats: [] }])] });
  t.ed.focus();
  t.ed.paste(beatsClip(nt('quarter', 1, 11)));
  t.ed.setCursor({ measure: 0, beat: 0 });
  t.ed.copy();
  t.ed.setCursor({ measure: 1, beat: 0 });
  const before = t.ed._model;
  fire('paste', { [CLIP_MIME]: ' '.repeat(EDITOR_LIMITS.jsonChars + 1) });
  ok(t.ed._model === before);
  ok(/too large/i.test(t.say()), t.say());
  fire('paste', { 'text/plain': `${CLIP_TYPE}${' '.repeat(EDITOR_LIMITS.jsonChars + 1)}` });
  eq(v1(ms(t.ed)[1])[0].notes[0].fret, 11);
  t.ed.destroy();
});

test('paste of a 7-string clip into 6 strings: a tie whose only note sits on the dropped string is repaired on both sides, across the barline too', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('half'), tn('half', 1, 3, { tieStart: true })] }, { beats: [nt('whole', 2, 2)] }])] });
  t.ed.setCursor({ measure: 1, beat: 0 });
  const seven = JSON.stringify({ type: CLIP_TYPE, version: 1, kind: 'beats', tracks: [{ tuning: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'], beats: [
    { type: 'note', duration: 'half', notes: [{ string: 7, fret: 3, tieEnd: true }] },
    { type: 'note', duration: 'half', notes: [{ string: 7, fret: 5, tieStart: true }, { string: 2, fret: 2, tieStart: true }] },
  ] }] });
  eq(t.ed.paste(seven), true);
  const m1 = ms(t.ed)[1].beats;
  eq(m1[0].type, 'rest', 'the string-7 beat is a rest');
  eq(ms(t.ed)[0].beats[1].notes[0].tieStart, undefined, 'the tie into the dropped note is broken');
  eq(m1[1].notes.map((n) => n.string), [2], 'string 7 dropped from the second beat');
  eq(m1[1].notes[0].tieStart, undefined, 'its tieStart has no partner: the next beat is on string 2 without tieEnd');
  ok(/dropped|2 notes|not on/i.test(t.ed.lastMessage), t.ed.lastMessage);
  stable(t.ed);
});
test('the cursor never sits on a hidden track, so a selection asked for on one lands on a visible track and the hidden track is untouched', () => {
  const t = mk({ tracks: [tab([{ beats: f(4) }]), { name: 'H', showStandardNotation: false, measures: [{ beats: f(4) }] }, tab([{ beats: f(4) }], { name: 'C' })] });
  const hidden = JSON.stringify(ms(t.ed, 1));
  const info = t.ed.setSelection({ anchor: { track: 1, measure: 0, beat: 0 }, focus: { track: 1, measure: 0, beat: 2 } });
  ok(info.track !== 1, `track ${info.track}`);
  t.press('Delete', key('Delete', CTRL));
  eq(JSON.stringify(ms(t.ed, 1)), hidden);
});
test('getRemoveTrackImpact validates its argument and has no side effects', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('whole', 1, 0, { tempo: 90 })] }]), tab([{ beats: [] }], { name: 'B' })] });
  const m = t.ed._model;
  eq(t.ed.getRemoveTrackImpact(0).tempoMarks, 1);
  ok(t.ed._model === m && !t.ed.canUndo());
  throws(() => t.ed.getRemoveTrackImpact(5), Error);
  throws(() => t.ed.getRemoveTrackImpact(-1), Error);
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-select-edge: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-select-edge: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const n = await summary();
  console.log(n ? `\n${n} FAILED` : '\nALL PASSED');
  process.exit(n ? 1 : 0);
}
