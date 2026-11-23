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
  eq(t.ed.getSelection(), { kind: 'measures', track: 0, start: { measure: 4, beat: 0 }, end: { measure: 6, beat: 0 }, beatCount: 0, measures: [4, 6], tracks: [0] });
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
test('criterion 6: the insert flag is one-shot: a paste takes it, every paste keydown sets or clears it, Shift+Insert never inserts, blur and destroy clear it and the fallback, a paste the page handled clears it', () => {
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
  eq([t.ed._pasteInsert, t.ed._pasteTimer, t.ed.canUndo()], [false, null, false], 'a paste the page handled cancels the fallback and clears the flag (2.3.1 review F1)');
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

// ---------- criteria 22, 28: transpose keys, Ctrl+Shift+Home / End ----------
test('criterion 22: Ctrl / Cmd+Up / Down and Ctrl+Shift+Up / Down transpose through the root\'s keydown (prevented), not from other targets; with a selection it is kept; one undo step "Undo: transpose"', () => {
  const t = mk(four());
  t.ed.focus();
  const down = (k, target = t.rootEl) => t.rootEl.dispatch('keydown', { ...k, target });
  eq(down(key('ArrowUp', CTRL)).defaultPrevented, true);
  eq([frets(t.ed)[0], t.spoken()], [2, 'Fret 2, up 1 semitone']);
  eq(down(key('ArrowUp', { metaKey: true, shiftKey: true })).defaultPrevented, true);
  eq(frets(t.ed)[0], 14, 'Cmd+Shift+Up: an octave');
  eq(down(key('ArrowDown', CTRL), { nodeName: 'INPUT' }).defaultPrevented, false, 'another target: not consumed');
  eq(frets(t.ed)[0], 14);
  t.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 3 } });
  t.spoken();
  t.events.length = 0;
  down(key('ArrowDown', { ctrlKey: true, shiftKey: true }));
  eq([frets(t.ed), t.spoken(), t.ed.getSelection().beatCount, t.ed.canUndo()], [[14, 2, 3, 4], "Can't transpose, measure 1 would go below fret 0", 4, true]);
  down(key('ArrowUp', CTRL));
  eq([frets(t.ed), t.ed.lastMessage, t.ed.getSelection().beatCount], [[15, 3, 4, 5], 'Transposed 4 notes up 1 semitone', 4]);
  eq(t.events.map((e) => e[0]), ['change'], 'the selection stays, no selection event');
  t.ed.undo();
  eq([frets(t.ed), t.spoken(), t.ed.getSelection()], [[14, 2, 3, 4], 'Undo: transpose', null]);
  for (const k of [key('PageUp', { ctrlKey: true, shiftKey: true }), key('F', { ctrlKey: true, shiftKey: true }), key('ArrowUp', { ctrlKey: true, altKey: true })]) eq(down(k).defaultPrevented, false, k.key);
  eq([down(key('ArrowUp', SHIFT)).defaultPrevented, t.ed.getSelection()], [true, null], '2.3.2: Shift+Up extends to a track (here the first: nothing changes)');
  stable(t.ed);
  t.ed.destroy();
});
test('criterion 28: Ctrl+Shift+End extends the selection to the last position of the score on the cursor track (the slot included), Ctrl+Shift+Home to the first; at the edge it says so', () => {
  const t = mk({ tracks: [tab([{ beats: [nt('whole', 1, 1)] }, { beats: [nt('whole', 1, 2)] }, { beats: [nt('half', 1, 3)] }]), tab([{ beats: [nt('whole')] }], { name: 'B' })] });
  t.ed.setCursor({ measure: 1, beat: 0 });
  t.press(key('End', { ctrlKey: true, shiftKey: true }));
  eq([t.ed.getSelection().measures, t.ed.getSelection().beatCount, t.ed.getCursor()], [[1, 2], 2, { track: 0, measure: 2, beat: 1, string: 1 }]);
  eq(t.spoken(), 'Selected measures 2 to 3, 2 beats');
  t.press(key('End', { ctrlKey: true, shiftKey: true }));
  eq(t.spoken(), 'End of score');
  t.press(key('Home', { ctrlKey: true, shiftKey: true }));
  eq([t.ed.getSelection().measures, t.ed.getSelection().start, t.spoken()], [[0, 1], { measure: 0, beat: 0 }, 'Selected measures 1 to 2, 2 beats'], 'the anchor stays at measure 2');
  t.press(key('Home', { ctrlKey: true, shiftKey: true }));
  eq(t.spoken(), 'Start of score');
  t.ed.setCursor({ track: 1, measure: 0, beat: 0 });
  t.press(key('End', { ctrlKey: true, shiftKey: true }));
  eq([t.ed.getSelection().track, t.ed.getSelection().measures, t.ed.getSelection().beatCount], [1, [0, 2], 1], 'on the cursor track; its missing measures are blank');
  t.ed.setReadOnly(true);
  t.ed.clearSelection();
  t.press(key('Home', { ctrlKey: true, shiftKey: true }));
  ok(t.ed.getSelection(), 'select commands work in read-only mode');
  t.ed.destroy();
});

// ---------- criterion 25: the reflow cascade ----------
test('criterion 25 (controller): Insert in measure 1 of 4 full measures, then one Shift+F: measures 1-4 full, 1 column added, one undo step, "Reflowed 4 measures, 1 measure added"', () => {
  const q = () => ({ beats: [1, 2, 3, 4].map((f) => nt('quarter', 1, f)) });
  const t = mk({ tracks: [tab([q(), q(), q(), q()])] });
  t.press('Insert');
  const before = t.ed._model;
  t.spoken();
  eq(t.press(key('F', SHIFT)), [true]);
  eq([0, 1, 2, 3].map((mi) => t.ed.getMeasureFill(0, mi)), ['full', 'full', 'full', 'full']);
  eq([ms(t.ed).length, t.spoken()], [5, 'Reflowed 4 measures, 1 measure added, measure full'], 'with the usual fill suffix: the cursor measure is now full');
  t.ed.undo();
  ok(t.ed._model === before, 'one undo step');
  eq(t.spoken(), 'Undo: reflow');
  t.ed.destroy();
});

// ---------- criterion 29: the demo ----------
const fsMod = await import('node:fs');
const DE = await imp('examples/editor-demo-edit.js');
const html = fsMod.readFileSync(path.join(root, 'editor.html'), 'utf8');
const TRANSPOSE_IDS = ['transpose-down-1-btn', 'transpose-up-1-btn', 'transpose-down-12-btn', 'transpose-up-12-btn'];
test('criterion 29: markup: Paste as new measures after Paste, the Paste title, a Transpose group after Measures with labelled buttons naming their keys, the new shortcuts', () => {
  const at = (s) => html.indexOf(s);
  ok(/<button type="button" id="paste-new-btn" title="Insert measures or beats without replacing anything \(Ctrl\+Shift\+V\)">Paste as new measures<\/button>/.test(html));
  ok(at('id="paste-btn"') < at('id="paste-new-btn"') && at('id="paste-new-btn"') < at('aria-label="Settings"'));
  ok(html.includes('id="paste-btn" title="Paste over the selected or blank measures, else before the cursor (Ctrl+V)"'));
  ok(at('aria-label="Measures"') < at('aria-label="Transpose"') && at('aria-label="Transpose"') < at('id="readonly"'));
  for (const [id, label, title] of [['transpose-down-1-btn', 'Transpose down 1 semitone', 'Ctrl+↓'], ['transpose-up-1-btn', 'Transpose up 1 semitone', 'Ctrl+↑'],
    ['transpose-down-12-btn', 'Transpose down an octave', 'Ctrl+Shift+↓'], ['transpose-up-12-btn', 'Transpose up an octave', 'Ctrl+Shift+↑']]) {
    ok(html.includes(`id="${id}" aria-label="${label}" title="${title}"`), id);
  }
  for (const s of ['<dt>Ctrl+Shift+Home / End</dt>', '<dt>Ctrl+Shift+V</dt>', '<section><h3>Transpose</h3>', '<dt>Ctrl+↑ ↓</dt>', '<dt>Ctrl+Shift+↑ ↓</dt>', 'and on through the following measures', 'With a selection, each key acts on every selected beat or note.']) ok(html.includes(s), s);
});
test('criterion 29: wiring: Paste as new measures calls paste(text, { insert: true }) (system clipboard only when granted), Transpose buttons go through handleKey, every new button is disabled in read-only mode and hands focus on within its group', async () => {
  const mkBtn = (id) => ({ id, disabled: false, handlers: [], addEventListener(tp, f) { this.handlers.push(f); }, focus() { fake.activeElement = this; }, click(detail = 0) { return Promise.all(this.handlers.map((f) => f({ detail }))); } });
  const ids = ['select-all-tracks-btn', 'copy-btn', 'cut-btn', 'paste-btn', 'paste-new-btn', 'fill-btn', 'reflow-btn', ...TRANSPOSE_IDS];
  const els = Object.fromEntries(ids.map((id) => [id, mkBtn(id)]));
  els['st-selection'] = { textContent: '' };
  let state = 'prompt';
  const fake = {
    activeElement: null,
    getElementById: (id) => els[id],
    defaultView: { navigator: { clipboard: { writeText: async () => {}, readText: async () => clipText('measures', [{ beats: [nt('whole', 1, 9)] }]) }, permissions: { query: async () => ({ state }) } } },
  };
  const t = mk(four());
  const refreshEdit = DE.wireEdit(fake, t.ed, { refresh: () => refreshEdit(t.ed.getCursorInfo(), t.ed.isReadOnly()) });
  refreshEdit(t.ed.getCursorInfo(), false);
  t.ed.setSelection({ anchor: { measure: 0, beat: 0 }, focus: { measure: 0, beat: 3 } });
  t.ed.copy();
  await els['paste-new-btn'].click();
  eq([ms(t.ed).length, frets(t.ed, 0), frets(t.ed, 1), t.ed.lastMessage], [3, [1, 2, 3, 4], [1, 2, 3, 4], 'Inserted 1 measure at measure 1'], 'prompt state: the internal clipboard, inserted');
  state = 'granted';
  t.ed.setCursor({ measure: 2, beat: 0 });
  await els['paste-btn'].click();
  eq([ms(t.ed).length, frets(t.ed, 2), t.ed.lastMessage], [3, [9], 'Pasted 1 measure over measure 3'], 'granted: the system clipboard; Paste overwrites the blank measure');
  t.ed.setCursor({ measure: 0, beat: 0 });
  await els['transpose-up-12-btn'].click();
  await els['transpose-down-1-btn'].click();
  eq([frets(t.ed, 0)[0], t.ed.lastMessage], [12, 'Fret 12, down 1 semitone']);
  await els['transpose-up-1-btn'].click();
  await els['transpose-down-12-btn'].click();
  eq(frets(t.ed, 0)[0], 1);
  els['transpose-up-1-btn'].focus();
  t.ed.setReadOnly(true);
  refreshEdit(t.ed.getCursorInfo(), true);
  eq(['paste-new-btn', ...TRANSPOSE_IDS].map((id) => els[id].disabled), [true, true, true, true, true]);
  ok(document.activeElement === t.rootEl, 'no enabled sibling in the Transpose group: focus goes back to the editor');
  els['paste-new-btn'].focus();
  refreshEdit(t.ed.getCursorInfo(), true);
  eq(fake.activeElement, els['select-all-tracks-btn'], 'the Edit group hands focus to its first enabled button (2.3.2: Select all tracks)');
  t.ed.destroy();
});

// ---------- B10 (controller) ----------
const { clampCursor } = await imp('src/editor/model/cursor.js');
const { selectionOf, anchorOf, focusOf } = await imp('src/editor/model/columns.js');
test('B10 (controller, 300 steps): keys (transpose, range effects, Ctrl+Shift+Home / End, the reflow cascade), Ctrl+V and Ctrl+Shift+V with native events or the fallback, blur, keep sanitizeScore(model) === model, a valid cursor and a valid selection; undo all restores the start, redo all the end', () => {
  function mulberry32(a) {
    return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const rnd = mulberry32(2311);
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const CS = { ctrlKey: true, shiftKey: true };
  const KEYS = [key('ArrowRight'), key('ArrowLeft'), key('ArrowDown'), key('5'), key('7'), key('r'), key('f'), key('F', SHIFT), key('F', SHIFT), key('Delete'), key('Delete', CTRL), key('Delete', SHIFT),
    key('ArrowRight', SHIFT), key('ArrowRight', SHIFT), key('End', SHIFT), key('ArrowRight', CS), key('Home', CS), key('End', CS), key('a', CTRL), key('Escape'), key('m'), key('i'), key('Insert'),
    key('ArrowUp', CTRL), key('ArrowDown', CTRL), key('ArrowUp', CS), key('ArrowDown', CS), key('p'), key('h'), key('x'), key('d'), key('a'), key('PageDown'), key('PageUp')];
  const t = mk({ tracks: [
    tab([{ beats: [1, 2, 3, 4].map((f) => nt('quarter', 1, f)) }, { beats: [nt('half', 2, 5), nt('half', 2, 7, { dots: 1 })] }, { beats: [] }, { beats: [nt('whole', 3, 0, { tempo: 90 })] }]),
    tab([{ beats: [nt('whole', 4, 3)] }], { name: 'Bass', showStandardNotation: false, tuning: ['E1', 'A1', 'D2', 'G2'] }),
  ] }, { historyLimit: 1000 });
  t.ed.focus();
  const start = t.ed._model;
  const down = (k) => t.rootEl.dispatch('keydown', { ...k, target: t.rootEl });
  for (let i = 0; i < 300; i++) {
    const r = rnd();
    if (r < 0.08) t.ed.copy();
    else if (r < 0.14) { down(key('v', CTRL)); if (rnd() < 0.5) firePaste(null); }
    else if (r < 0.20) { down(key('V', CS)); if (rnd() < 0.5) firePaste(null); }
    else if (r < 0.22) { t.rootEl.blur(); t.ed.focus(); }
    else t.ed.handleKey(pick(KEYS));
    t.clock.advance(1000);
    ok(sanitizeScore(t.ed._model) === t.ed._model, `step ${i}`);
    eq(clampCursor(t.ed._model, t.ed._cursor), t.ed._cursor, `step ${i}: valid cursor`);
    const sel = t.ed._selection;
    if (sel) eq(selectionOf(t.ed._model, anchorOf(sel), focusOf(sel))?.info, sel.info, `step ${i}: valid selection`); // 2.3.2: a second Ctrl+A makes a column
  }
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
