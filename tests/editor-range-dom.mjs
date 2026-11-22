// 2.3.1 controller level under the DOM shim: insert paste (criterion 6: keys, the one-shot flag on blur and
// destroy, Shift+Insert, the API), blank-measure selections with exact wording (10), paste limits and
// read-only (11), effects over a selection (12, 16), transpose keys (22), the reflow cascade (25),
// the demo (29), announcements (30) and B10 over 300 steps.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-range-dom.mjs`.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { mk, key, SHIFT, CTRL, nt, rest, eq, ok, throws, sanitizeScore } from './editor-select-dom.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const ms = (ed, ti = 0) => ed.getScore().tracks[ti].measures;
const stable = (ed) => ok(sanitizeScore(ed._model) === ed._model, 'sanitize identity');

// ---------- criterion 10: blank-measure selections ----------
test('criterion 10: Shift+Right across 3 blank measures selects them ("Selected measures 5 to 7, no beats"); Delete says "Already rests", Copy gives empty measures, F fills each, Shift+Delete deletes them; Ctrl+A on an empty track selects it', () => {
  const score = { tracks: [tab([...Array.from({ length: 4 }, () => ({ beats: [nt('whole')] })), { beats: [] }, { beats: [] }, { beats: [] }, { beats: [nt('whole')] }])] };
  const t = mk(score);
  t.ed.setCursor({ measure: 4, beat: 0 });
  t.spoken();
  t.press(key('ArrowRight', SHIFT), key('ArrowRight', SHIFT));
  eq(t.ed.getSelection(), { kind: 'measures', track: 0, start: { measure: 4, beat: 0 }, end: { measure: 6, beat: 0 }, beatCount: 0, measures: [4, 6] });
  eq(t.spoken(), 'Selected measures 5 to 7, no beats');
  t.press('Delete');
  eq([t.spoken(), t.ed.canUndo(), t.ed.getSelection().measures], ['Already rests', false, [4, 6]]);
  t.press(key('Delete', CTRL));
  eq([t.spoken(), t.ed.canUndo()], ['No beats to delete', false]);
  const text = t.ed.copy();
  eq(JSON.parse(text).tracks[0].measures, [{ beats: [] }, { beats: [] }, { beats: [] }]);
  eq(t.spoken(), 'Copied 3 measures');
  t.press('f');
  eq(ms(t.ed).slice(4, 7).map((m) => m.beats), [[rest('whole')], [rest('whole')], [rest('whole')]]);
  eq(t.ed.getSelection(), null, 'an edit clears the selection');
  t.ed.undo();
  t.ed.setSelection({ anchor: { measure: 4, beat: 0 }, focus: { measure: 6, beat: 0 } });
  t.press(key('Delete', SHIFT));
  eq([ms(t.ed).length, t.spoken()], [5, 'Measures 5 to 7 deleted, measure full']);
  stable(t.ed);
  const e = mk({ tracks: [tab(Array.from({ length: 8 }, () => ({ beats: [] })), { name: '' })] });
  e.press(key('a', CTRL));
  eq([e.ed.getSelection().measures, e.spoken()], [[0, 7], 'Selected all of Track 1, 8 measures']);
  t.ed.destroy(); e.ed.destroy();
});

// ---------- criteria 1, 6, 7, 11: paste replace and insert ----------
const { makeClipboardData } = await import('./editor-shim.mjs');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const { CLIP_MIME } = await imp('src/editor/model/clip.js');
const { keyToCommand, isInsertPasteKey } = await imp('src/editor/keymap.js');
const clipText = (kind, content) => JSON.stringify({ type: 'music-score-clip', version: 1, kind, tracks: [{ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], [kind]: content }] });
const firePaste = (text) => document.dispatch('paste', { clipboardData: makeClipboardData(text ? { [CLIP_MIME]: text } : {}) });
const frets = (ed, mi = 0) => ms(ed)[mi].beats.map((b) => b.notes?.[0].fret ?? null);
const four = () => ({ tracks: [tab([{ beats: [nt('quarter', 1, 1), nt('quarter', 1, 2), nt('quarter', 1, 3), nt('quarter', 1, 4)] }, { beats: [] }])] });
const BEAT9 = clipText('beats', [nt('quarter', 1, 9)]);

test('criterion 1 (controller): Ctrl+V of a measures clip on blank measures overwrites them in one undo step; the selection is cleared; change carries the message', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('whole', 1, 1)] }, { beats: [nt('whole', 1, 2)] }, { beats: [] }, { beats: [] }]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  t.ed.focus();
  t.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 1, beat: 0 } });
  t.ed.copy();
  t.ed.setCursor({ measure: 2, beat: 0 });
  const before = t.ed._model;
  t.events.length = 0;
  t.rootEl.dispatch('keydown', { ...key('v', CTRL), target: t.rootEl });
  firePaste(null);
  eq([ms(t.ed).length, frets(t.ed, 2), frets(t.ed, 3)], [4, [1], [2]]);
  eq(t.ed.lastMessage, 'Pasted 2 measures over measures 3 to 4');
  eq(t.events.filter((e) => e[0] === 'change').map((e) => e[1].message), ['Pasted 2 measures over measures 3 to 4']);
  ok(t.ed.getScore().tracks[1].measures.length === 1, 'the other track is untouched');
  t.ed.undo();
  ok(t.ed._model === before, 'one undo step');
  stable(t.ed);
  t.ed.destroy();
});
test('criterion 6: Ctrl+Shift+V inserts, with the native event and through the fallback; keydown is never prevented and keyToCommand ignores both paste keys; a plain paste after it replaces again', () => {
  for (const native of [true, false]) {
    const t = mk(four());
    t.ed.focus();
    if (!native) { const src = mk({ tracks: [tab([{ beats: [nt('quarter', 1, 9)] }])] }); src.ed.copy(); src.ed.destroy(); }
    t.ed.setSelection({ anchor: { measure: 0, beat: 1 }, focus: { measure: 0, beat: 2 } });
    const kd = t.rootEl.dispatch('keydown', { ...key('V', { ctrlKey: true, shiftKey: true }), target: t.rootEl });
    eq(kd.defaultPrevented, false);
    if (native) firePaste(BEAT9);
    t.clock.advance(0);
    eq([frets(t.ed), t.ed.lastMessage, t.ed.getSelection()], [[1, 9, 2, 3, 4], 'Pasted 1 beat', null], native ? 'native' : 'fallback');
    eq(t.ed.getCursor().beat, 2, 'the cursor on the first selected beat');
    t.ed.setSelection({ anchor: { measure: 0, beat: 1 }, focus: { measure: 0, beat: 2 } });
    t.rootEl.dispatch('keydown', { ...key('v', CTRL), target: t.rootEl });
    if (native) firePaste(BEAT9);
    t.clock.advance(0);
    eq([frets(t.ed), t.ed.lastMessage], [[1, 9, 3, 4], 'Pasted 1 beat, replaced 2'], 'Ctrl+V replaces');
    t.ed.destroy();
  }
  for (const k of [key('v', CTRL), key('V', { ctrlKey: true, shiftKey: true }), key('v', { metaKey: true, shiftKey: true })]) eq(keyToCommand(k), null);
  eq([isInsertPasteKey(key('V', { metaKey: true, shiftKey: true })), isInsertPasteKey(key('v', CTRL)), isInsertPasteKey(key('Insert', SHIFT)), isInsertPasteKey(key('V', { ctrlKey: true, shiftKey: true, altKey: true }))], [true, false, false, false]);
});
test('criterion 6: the insert flag is one-shot: a paste takes it, every paste keydown sets or clears it, Shift+Insert never inserts, blur and destroy clear it and the fallback, a paste the page handled keeps it', () => {
  const t = mk(four());
  t.ed.focus();
  const down = (k) => t.rootEl.dispatch('keydown', { ...k, target: t.rootEl });
  const CSV = key('V', { ctrlKey: true, shiftKey: true });
  t.ed.setCursor({ measure: 0, beat: 0 });
  down(CSV);
  firePaste(BEAT9);
  eq(t.ed._pasteInsert, false, 'taken by the paste');
  t.ed.undo();
  down(CSV); down(key('v', CTRL));
  eq(t.ed._pasteInsert, false, 'Ctrl+V overwrites the flag');
  firePaste(null); t.ed.undo();
  down(CSV); down(key('Insert', SHIFT));
  eq(t.ed._pasteInsert, false, 'Shift+Insert is never an insert paste');
  firePaste(null); t.ed.undo();
  down(CSV);
  eq([t.ed._pasteInsert, t.clock.pendingTimers() > 0], [true, true]);
  t.rootEl.blur();
  eq([t.ed._pasteInsert, t.ed._pasteTimer], [false, null], 'blur clears the flag and the fallback');
  t.ed.focus();
  down(CSV);
  document.dispatch('paste', { defaultPrevented: true, clipboardData: makeClipboardData({ [CLIP_MIME]: BEAT9 }) });
  eq([t.ed._pasteInsert, t.ed._pasteTimer, t.ed.canUndo()], [true, null, false], 'pasteseen cancels the fallback and keeps the flag');
  const d = mk(four());
  d.ed.focus();
  d.rootEl.dispatch('keydown', { ...CSV, target: d.rootEl });
  d.ed.destroy();
  eq([d.ed._pasteInsert, d.ed._pasteTimer], [false, null], 'destroy clears both');
  t.ed.destroy();
});
test('criterion 6: paste(text, { insert: true }) inserts; options must be an object (TypeError), only insert === true inserts', () => {
  const t = mk(four());
  t.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 3 } });
  eq(t.ed.paste(clipText('measures', [{ beats: [nt('whole', 1, 7)] }]), { insert: true }), true);
  eq([ms(t.ed).length, frets(t.ed, 0), t.ed.lastMessage, t.ed.getCursor().measure], [3, [7], 'Inserted 1 measure at measure 1', 1]);
  for (const bad of [5, 'insert', true, () => {}]) throws(() => t.ed.paste(BEAT9, bad), TypeError, 'paste options must be an object');
  t.ed.setSelection({ anchor: { measure: 1, beat: 0 }, focus: { measure: 1, beat: 1 } });
  eq(t.ed.paste(BEAT9, { insert: 'yes' }), true);
  eq([frets(t.ed, 1), t.ed.lastMessage], [[9, 3, 4], 'Pasted 1 beat, replaced 2'], 'a truthy insert that is not true replaces');
  ok(t.ed.paste(BEAT9, null) && t.ed.paste(BEAT9, undefined));
  t.ed.destroy();
});
test('criteria 7 / 11: a measures clip on a beats selection is refused and announced, the selection kept, no undo step; read-only refuses either paste and keeps the selection', () => {
  const t = mk(four());
  t.ed.setSelection({ anchor: { measure: 0, beat: 1 }, focus: { measure: 0, beat: 2 } });
  const before = t.ed._model;
  eq(t.ed.paste(clipText('measures', [{ beats: [] }])), false);
  eq([t.ed.lastMessage, t.ed.getSelection().beatCount, t.ed.canUndo()], ['Select whole measures to paste measures', 2, false]);
  ok(t.ed._model === before);
  t.ed.setReadOnly(true);
  eq([t.ed.paste(BEAT9), t.ed.paste(BEAT9, { insert: true }), t.ed.lastMessage, t.ed.getSelection().beatCount], [false, false, 'Read-only', 2]);
  t.ed.destroy();
});

// ---------- criteria 12, 16, 30: effects over a selection ----------
test('criteria 12 / 30: P over a selection: one undo step each, the selection stays live without a new selection event (unchanged info), the overlay keeps it; undo clears it', () => {
  const t = mk(four());
  t.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 3 } });
  t.spoken();
  t.events.length = 0;
  eq(t.press('p'), [true]);
  eq(ms(t.ed)[0].beats.map((b) => b.palmMute), [true, true, true, true]);
  eq([t.spoken(), t.ed.getSelection().beatCount], ['Palm mute on, 4 beats', 4]);
  eq(t.events.map((e) => e[0]), ['change'], 'no selection event: the selection did not change');
  ok(t.ed._selectionView().slices.length === 1);
  t.press('p');
  eq([ms(t.ed)[0].beats.some((b) => b.palmMute), t.spoken()], [false, 'Palm mute off, 4 beats']);
  t.ed.undo();
  eq([ms(t.ed)[0].beats.every((b) => b.palmMute), t.ed.getSelection(), t.spoken()], [true, null, 'Undo: palm mute']);
  t.ed.undo();
  ok(!t.ed.canUndo(), 'two edits, two steps');
  stable(t.ed);
  t.ed.destroy();
});
test('criterion 16 (controller): a refused range effect keeps the selection and announces; read-only refuses with the selection kept', () => {
  const t = mk({ tracks: [tab([{ beats: [rest('half'), rest('half')] }])] });
  t.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 1 } });
  t.spoken();
  t.press('h');
  eq([t.spoken(), t.ed.getSelection().beatCount, t.ed.canUndo()], ['No notes in the selection', 2, false]);
  t.ed.setReadOnly(true);
  eq([t.press('p'), t.spoken(), t.ed.getSelection().beatCount], [[false], 'Read-only', 2]);
  t.ed.destroy();
});

// ---------- report ----------
export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-range-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-range-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
export { test, tab, ms, stable };
