// 2.3.1 edge cases at controller level under the DOM shim: the insert-paste flag lifecycle (read-only, other targets,
// blur between keydown and paste, Cmd, Alt), overwrite paste cursor / selection / undo, range effects and transpose
// with undo / redo, the cascade ignoring the selection.
// Run via `node tests/run.js` (awaits summary()), or directly: `node tests/editor-range-edge-dom.mjs`.
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import { mk, key, SHIFT, CTRL, nt, rest, eq, ok, sanitizeScore } from './editor-select-dom.mjs';
import { makeClipboardData } from './editor-shim.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CLIP_MIME } = await import(pathToFileURL(path.join(root, 'src/editor/model/clip.js')).href);
const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tab = (measures, extra = {}) => ({ name: 'Gtr', showTablature: true, ...extra, measures });
const ms = (ed, ti = 0) => ed.getScore().tracks[ti].measures;
const clipText = (kind, content) => JSON.stringify({ type: 'music-score-clip', version: 1, kind, tracks: [{ tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], [kind]: content }] });
const firePaste = (text) => document.dispatch('paste', { clipboardData: makeClipboardData(text ? { [CLIP_MIME]: text } : {}) });
const frets = (ed, mi = 0) => ms(ed)[mi].beats.map((b) => b.notes?.[0].fret ?? null);
const four = () => ({ tracks: [tab([{ beats: [1, 2, 3, 4].map((f) => nt('quarter', 1, f)) }, { beats: [] }])] });
const BEAT9 = clipText('beats', [nt('quarter', 1, 9)]);
const CSV = key('V', { ctrlKey: true, shiftKey: true });
const sel = (ed, a, b) => ed.setSelection({ anchor: a, focus: b });

test('flag lifecycle: read-only consumes it (the refused paste says Read-only, a later Ctrl+V replaces); a keydown from another target sets nothing; blur between keydown and paste means a later plain paste replaces', () => {
  const t = mk(four());
  t.ed.focus();
  const down = (k, target = t.rootEl) => t.rootEl.dispatch('keydown', { ...k, target });
  sel(t.ed, { measure: 0, beat: 1 }, { measure: 0, beat: 2 });
  t.ed.setReadOnly(true);
  down(CSV); firePaste(BEAT9);
  eq([t.ed.lastMessage, t.ed._pasteInsert, t.ed.getSelection().beatCount], ['Read-only', false, 2]);
  t.ed.setReadOnly(false);
  down(key('v', CTRL)); firePaste(BEAT9);
  eq(frets(t.ed), [1, 9, 4], 'replaced');
  t.ed.undo();
  sel(t.ed, { measure: 0, beat: 1 }, { measure: 0, beat: 2 });
  down(CSV, { nodeName: 'INPUT' });
  eq([t.ed._pasteInsert, t.ed._pasteTimer], [false, null], 'another target: nothing set');
  down(CSV);
  t.rootEl.blur(); t.ed.focus();
  sel(t.ed, { measure: 0, beat: 1 }, { measure: 0, beat: 2 });
  firePaste(BEAT9);
  eq(frets(t.ed), [1, 9, 4], 'a native paste with no keydown replaces');
  t.ed.destroy();
});
test('insert key variants: Cmd+Shift+V inserts, Ctrl+Alt+Shift+V is no paste key at all (flag untouched, no fallback), Shift+Insert clears a pending flag', () => {
  const t = mk(four());
  t.ed.focus();
  const down = (k) => t.rootEl.dispatch('keydown', { ...k, target: t.rootEl });
  sel(t.ed, { measure: 0, beat: 1 }, { measure: 0, beat: 1 });
  down(key('V', { metaKey: true, shiftKey: true })); firePaste(BEAT9);
  eq(frets(t.ed), [1, 9, 2, 3, 4], 'Cmd inserts');
  t.ed.undo();
  down(key('V', { ctrlKey: true, altKey: true, shiftKey: true }));
  eq([t.ed._pasteInsert, t.ed._pasteTimer], [false, null]);
  t.ed.destroy();
});
test('overwrite paste at controller level: with a selection the cursor goes after the written range and the selection is cleared; one undo restores the model object; redo repeats it; a refused paste keeps the selection', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('whole', 1, 1)] }, { beats: [nt('whole', 1, 2)] }, { beats: [nt('whole', 1, 3)] }, { beats: [] }])] });
  const start = t.ed._model;
  sel(t.ed, { measure: 0, beat: 0 }, { measure: 1, beat: 0 });
  t.ed.copy();
  sel(t.ed, { measure: 2, beat: 0 }, { measure: 2, beat: 0 });
  eq(t.ed.paste(), true);
  eq([frets(t.ed, 2), frets(t.ed, 3), t.ed.getSelection(), t.ed.getCursor().measure], [[1], [2], null, 3]);
  eq(t.ed.lastMessage, 'Pasted 2 measures over measures 3 to 4');
  t.ed.undo();
  ok(t.ed._model === start);
  t.ed.redo();
  eq(frets(t.ed, 3), [2]);
  ok(sanitizeScore(t.ed._model) === t.ed._model);
  t.ed.destroy();
});
test('range effects and transpose: undo / redo restore exactly and clear the selection; X over a selection says dead notes on existing notes only; a refused transpose is no undo step', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('quarter', 1, 5), rest('quarter'), nt('quarter', 6, 7), nt('quarter', 1, 0)] }])] });
  const start = t.ed._model;
  sel(t.ed, { measure: 0, beat: 0 }, { measure: 0, beat: 3 });
  t.press('x');
  eq([t.spoken(), t.ed.getSelection().beatCount], ['Dead note on, 3 notes', 4]);
  eq(ms(t.ed)[0].beats[1], rest('quarter'));
  t.press(key('ArrowDown', { ctrlKey: true, shiftKey: true }));
  eq([t.spoken(), t.ed.getSelection().beatCount], ["Can't transpose, measure 1 would go below fret 0", 4], '2.3.3: string 6 fret 7 an octave down has nowhere to go');
  t.press(key('ArrowDown', CTRL));
  eq([t.spoken(), t.ed.getSelection().beatCount], ['Transposed 3 notes down 1 semitone, 1 moved to another string', 4]);
  eq(ms(t.ed)[0].beats.map((b) => b.notes?.[0] ?? null).map((n) => n && [n.string, n.fret]), [[1, 4], null, [6, 6], [2, 4]], '2.3.3: string 1 fret 0 moved to string 2 fret 4');
  t.press(key('ArrowUp', CTRL));
  eq(frets(t.ed), [5, null, 7, 5]);
  t.ed.undo(); t.ed.undo(); t.ed.undo();
  ok(t.ed._model === start && t.ed.getSelection() === null);
  t.ed.redo(); t.ed.redo(); t.ed.redo();
  eq(frets(t.ed), [5, null, 7, 5]);
  ok(!t.ed.redo());
  t.ed.destroy();
});
test('Shift+F ignores the selection and cascades from the cursor; the cursor follows its beat; one undo step', () => {
  const w = (f) => ({ beats: [nt('whole', 1, f)] });
  const t = mk({ tracks: [tab([{ beats: [nt('whole', 1, 1), nt('whole', 1, 2)] }, w(3), w(4)])] });
  const start = t.ed._model;
  sel(t.ed, { measure: 1, beat: 0 }, { measure: 0, beat: 1 });
  ok(t.ed.getSelection() && t.ed.getCursor().measure === 0, 'the cursor is the selection focus');
  t.press(key('F', SHIFT));
  eq([ms(t.ed).length, t.ed.getSelection(), t.ed.getCursor().measure, t.ed.getCursor().beat], [4, null, 1, 0], 'the second whole of measure 1 moved to measure 2 and the cursor with it');
  eq([0, 1, 2, 3].map((mi) => frets(t.ed, mi)), [[1], [2], [3], [4]]);
  eq(t.ed.lastMessage.startsWith('Reflowed 3 measures, 1 measure added'), true);
  t.ed.undo();
  ok(t.ed._model === start);
  t.ed.destroy();
});

export async function summary() {
  let fail = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`PASS editor-range-edge-dom: ${t.name}`); } catch (e) { fail++; console.log(`FAIL editor-range-edge-dom: ${t.name}\n  ${e.stack || e.message}`); }
  }
  return fail;
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const f = await summary();
  console.log(f ? `\n${f} FAILED` : '\nALL PASSED');
  process.exit(f ? 1 : 0);
}
