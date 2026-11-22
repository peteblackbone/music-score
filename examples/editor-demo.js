/**
 * editor-demo.js — page logic of editor.html (the 2.0.0 ScoreEditor demo).
 * Not part of the package. The pure helpers are exported for the tests:
 * sanitizeFilename, newScore, readAutosave, checkUpload. The Effects
 * group is wired by editor-demo-effects.js.
 *
 * Flows (ui.md §1, §6): first visit loads lead-riff with a notice; later
 * visits restore the browser autosave (debounced 500 ms after each edit,
 * undo or redo; loading a score is not saved). A restore that never
 * finished its first render (sessionStorage flag) is skipped next time;
 * New… / Load / Open JSON ask before replacing unsaved work ("unsaved" =
 * changed since the last load, New or Download); errors are shown as text
 * notices and never change the editor.
 */
import { ScoreEditor } from '../index.js';
import { leadRiff } from './lead-riff.js';
import { leadSoloF } from './lead-solo-f.js';
import { exampleScore } from './example-score.js';
import { durationWords, FILL_WORDS } from '../src/editor/model/durations.js';
import { wireEffects } from './editor-demo-effects.js';

export const AUTOSAVE_KEY = 'music-score-editor:autosave';
/** sessionStorage flag set while a restore renders; still set on the next load = that restore never finished. */
export const RESTORING_KEY = 'music-score-editor:restoring';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MIN_WIDTH = 560;
const EXAMPLES = { 'lead-riff': leadRiff, 'lead-solo-f': leadSoloF, 'example-score': exampleScore };
const PRESETS = {
  guitar6: { name: 'Guitar', clef: 'treble', tuning: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
  bass4: { name: 'Bass', clef: 'bass', tuning: ['E1', 'A1', 'D2', 'G2'] },
  guitar7: { name: '7-string Guitar', clef: 'treble', tuning: ['B1', 'E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
};

/** Download file name from a title: only [A-Za-z0-9-_ ], trimmed, + '.json'; 'score.json' when nothing is left. */
export function sanitizeFilename(title) {
  const s = String(title ?? '').replace(/[^A-Za-z0-9\-_ ]/g, '').slice(0, 100).trim();
  return s ? `${s}.json` : 'score.json';
}

/** The score New… creates: one track of the preset, time signature on the track, one empty measure. */
export function newScore({ title = 'Untitled', beats = 4, beatType = 4, preset = 'guitar6', tabOnly = false } = {}) {
  const p = PRESETS[preset] || PRESETS.guitar6;
  const b = Number.isInteger(Number(beats)) ? Math.min(16, Math.max(1, Number(beats))) : 4;
  const bt = [2, 4, 8, 16].includes(Number(beatType)) ? Number(beatType) : 4;
  return {
    title: String(title ?? '').trim() || 'Untitled',
    tracks: [{
      name: p.name, clef: p.clef, showStandardNotation: !tabOnly, showTablature: true, tuning: [...p.tuning],
      timeSignature: { beats: b, beatType: bt }, measures: [{ beats: [] }],
    }],
  };
}

/**
 * The autosave in `storage`: { status: 'ok', score } | { status: 'none' } |
 * { status: 'corrupt' } | { status: 'unavailable' }. With `session`
 * (sessionStorage) still flagged by an earlier restore that never finished
 * its first render, the autosave is reported corrupt and not restored.
 */
export function readAutosave(storage, session = null) {
  let raw;
  try { raw = storage.getItem(AUTOSAVE_KEY); } catch { return { status: 'unavailable' }; }
  if (raw == null) return { status: 'none' };
  if (isRestoring(session)) return { status: 'corrupt', unfinished: true };
  try {
    const score = JSON.parse(raw);
    return score && typeof score === 'object' && !Array.isArray(score) ? { status: 'ok', score } : { status: 'corrupt' };
  } catch { return { status: 'corrupt' }; }
}

const sessionOp = (fn) => { try { return fn(); } catch { return null; } };
/** Whether `session` carries the restoring flag. */
export const isRestoring = (session) => !!session && sessionOp(() => session.getItem(RESTORING_KEY)) != null;
/** Set the restoring flag (before a restore renders). */
export const markRestoring = (session) => { if (session) sessionOp(() => session.setItem(RESTORING_KEY, '1')); };
/** Clear the restoring flag (the restore rendered, or the autosave was replaced). */
export const clearRestoring = (session) => { if (session) sessionOp(() => session.removeItem(RESTORING_KEY)); };

/** Size check before reading an upload: { ok: true } or { ok: false, error } (over 5 MB, or no file). */
export function checkUpload(file) {
  if (!file) return { ok: false, error: 'No file was chosen.' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `Couldn't open "${file.name}": the file is larger than 5 MB.` };
  return { ok: true };
}

const noteLetter = (pitch) => (pitch ? String(pitch).replace(/-?\d+$/, '') : '');
const clone = (o) => JSON.parse(JSON.stringify(o));

/** Wire editor.html (`doc` = document). */
export function startEditorDemo(doc) {
  const win = doc.defaultView;
  const $ = (id) => doc.getElementById(id);
  const card = $('card');
  const notices = $('notices');
  const save = $('st-save');
  let storage = null;
  let session = null;
  try { storage = win.localStorage; } catch { storage = null; }
  try { session = win.sessionStorage; } catch { session = null; }

  // ---- notices: one per kind, replaced, dismissed by the user only ----
  const shown = {};
  function notify(kind, text) {
    shown[kind]?.remove();
    const n = doc.createElement('div');
    n.className = `notice ${kind}`;
    n.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    const t = doc.createElement('span');
    t.textContent = text;
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = 'Dismiss';
    b.addEventListener('click', () => { n.remove(); if (shown[kind] === n) delete shown[kind]; });
    n.append(t, b);
    notices.append(n);
    shown[kind] = n;
  }

  // ---- first load ----
  const width = () => {
    const cs = win.getComputedStyle(card);
    return Math.max(MIN_WIDTH, card.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
  };
  const saved = storage ? readAutosave(storage, session) : { status: 'unavailable' };
  let editor = null;
  if (saved.status === 'ok') {
    // the flag stays set if this render hangs or crashes the tab; the next load then skips the restore
    markRestoring(session);
    try {
      editor = new ScoreEditor(card, saved.score, { width: width() });
      notify('info', 'Restored your last session from this browser.');
      // the constructor renders synchronously, so reaching here means the first render finished
      // (not an animation frame: background tabs pause those and the flag would stick)
      clearRestoring(session);
    } catch {
      clearRestoring(session);
      saved.status = 'corrupt';
    }
  }
  if (!editor) {
    editor = new ScoreEditor(card, clone(leadRiff), { width: width() });
    if (saved.status === 'corrupt') notify('error', 'Your saved session couldn\'t be read, so the lead-riff example was loaded instead.');
    else notify('info', 'Showing the lead-riff example. Choose New… to start an empty score.');
  }
  if (win.matchMedia?.('(pointer: coarse)').matches) $('hint').textContent = 'Editing needs a hardware keyboard';

  // ---- dirty flag and autosave ----
  // A restored session was never downloaded: replacing it must ask first, because the next
  // autosave overwrites the only copy.
  let dirty = saved.status === 'ok';
  let saveTimer = null;
  let storageWarned = false;
  function storageFailed() {
    save.textContent = 'Not saved in this browser';
    if (!storageWarned) {
      storageWarned = true;
      notify('error', 'Changes can\'t be saved in this browser (storage is full or blocked). Use Download JSON to keep your work.');
    }
  }
  function scheduleSave() {
    win.clearTimeout(saveTimer);
    save.textContent = 'Saving…';
    saveTimer = win.setTimeout(() => {
      try {
        if (!storage) throw new Error('no storage');
        storage.setItem(AUTOSAVE_KEY, JSON.stringify(editor.getScore()));
        clearRestoring(session); // a skipped, unfinished session has now been replaced
        save.textContent = 'Saved in this browser';
      } catch { storageFailed(); }
    }, 500);
  }
  if (!storage) storageFailed();

  // ---- status bar, palette, history buttons ----
  const durationButtons = [...doc.querySelectorAll('[data-duration]')];
  const dotsBtn = $('dots-btn');
  const tripletBtn = $('triplet-btn');
  const undoBtn = $('undo-btn');
  const redoBtn = $('redo-btn');
  const readOnlyBox = $('readonly');
  // Effects group: a click runs the button's key, then the whole UI refreshes and a pointer click returns focus
  const refreshEffects = wireEffects(doc.querySelectorAll('[data-effect]'), editor, (e) => { refreshUi(); back(e); });
  function refreshUi() {
    const i = editor.getCursorInfo();
    const ro = editor.isReadOnly();
    $('st-track').textContent = `${i.trackName || `Track ${i.track + 1}`}, ${i.track + 1}/${i.trackCount}`;
    $('st-measure').textContent = `${i.measure + 1}/${i.measureCount}`;
    $('st-beat').textContent = i.empty ? 'empty' : i.appendSlot ? 'end' : `${i.beatNumber}/${i.beatTotal}`;
    $('st-string').textContent = i.hasTab ? `${i.string} (${noteLetter(i.tuningNote)})` : '–';
    $('st-fret').textContent = i.hasTab && i.fret != null ? String(i.fret) : '–';
    $('st-duration').textContent = durationWords(i.duration, i.dots, i.triplet);
    $('st-fill').textContent = FILL_WORDS[i.fill]?.label ?? i.fill;
    $('st-effects').textContent = i.effects.length ? i.effects.join(', ') : '–';
    $('st-readonly').hidden = !ro;
    durationButtons.forEach((b) => { b.setAttribute('aria-pressed', String(b.dataset.duration === i.duration)); b.disabled = ro; });
    dotsBtn.textContent = `Dots: ${i.dots}`;
    tripletBtn.setAttribute('aria-pressed', String(!!i.triplet));
    dotsBtn.disabled = ro;
    tripletBtn.disabled = ro;
    undoBtn.disabled = !editor.canUndo();
    redoBtn.disabled = !editor.canRedo();
    refreshEffects(i, ro);
  }
  editor.on('cursor', refreshUi);
  editor.on('change', (e) => {
    // only real edits (edit / undo / redo) are unsaved work and autosaved; a load is not
    if (e.source !== 'load') {
      dirty = true;
      scheduleSave();
    }
    refreshUi();
  });
  refreshUi();

  // A pointer click (detail > 0) on a toolbar control returns focus to the editor; a keyboard click keeps it.
  const back = (e) => { if (e.detail > 0) editor.focus(); };
  durationButtons.forEach((b) => b.addEventListener('click', (e) => { editor.setDuration(b.dataset.duration); refreshUi(); back(e); }));
  dotsBtn.addEventListener('click', (e) => { editor.handleKey({ key: '.' }); refreshUi(); back(e); });
  tripletBtn.addEventListener('click', (e) => { editor.handleKey({ key: '/' }); refreshUi(); back(e); });
  undoBtn.addEventListener('click', (e) => { editor.undo(); refreshUi(); back(e); });
  redoBtn.addEventListener('click', (e) => { editor.redo(); refreshUi(); back(e); });
  readOnlyBox.addEventListener('change', (e) => { editor.setReadOnly(readOnlyBox.checked); refreshUi(); back(e); });

  // ---- replacing the score ----
  const title = () => editor.getScore().title || 'Untitled';
  const okToReplace = () => !dirty || win.confirm(`Replace "${title()}"? Your changes since the last download will be lost (the browser copy is overwritten).`);
  function replace(score) {
    editor.loadScore(score);
    // a new score makes earlier notices (first visit, restore, a failed open) stale
    Object.keys(shown).forEach((k) => { shown[k].remove(); delete shown[k]; });
    dirty = false;
    refreshUi();
  }

  // New…
  const dialog = $('new-dialog');
  const newBtn = $('new-btn');
  let created = false;
  newBtn.addEventListener('click', () => {
    created = false;
    dialog.showModal();
    $('new-name').focus();
  });
  $('new-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!okToReplace()) return; // the dialog stays open
    replace(newScore({
      title: $('new-name').value,
      beats: Number($('new-beats').value),
      beatType: Number($('new-beat-type').value),
      preset: $('new-preset').value,
      tabOnly: doc.querySelector('input[name="staves"]:checked')?.value === 'tab',
    }));
    created = true;
    dialog.close();
    editor.focus();
  });
  $('new-cancel').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!created) newBtn.focus(); });

  // Load example (the select alone does nothing)
  $('load-btn').addEventListener('click', () => {
    if (!okToReplace()) return;
    replace(clone(EXAMPLES[$('example').value] || leadRiff));
    editor.focus();
  });

  // Open JSON…
  const file = $('file');
  $('open-btn').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    const check = checkUpload(f);
    if (!check.ok) { notify('error', check.error); return; }
    let data;
    try { data = JSON.parse(await f.text()); } catch (err) { notify('error', `Couldn't open "${f.name}": not valid JSON (${err.message}).`); return; }
    if (!okToReplace()) return;
    try { replace(data); } catch (err) { notify('error', `Couldn't open "${f.name}": ${err.message}${/[.!?]$/.test(err.message) ? '' : '.'}`); return; }
    editor.focus();
  });

  // Download JSON
  $('download-btn').addEventListener('click', (e) => {
    const name = sanitizeFilename(title());
    const url = URL.createObjectURL(new Blob([JSON.stringify(editor.getScore(), null, 2)], { type: 'application/json' }));
    const a = doc.createElement('a');
    a.href = url;
    a.download = name;
    doc.body.append(a);
    a.click();
    a.remove();
    win.setTimeout(() => URL.revokeObjectURL(url), 0);
    dirty = false;
    save.textContent = `Downloaded ${name}`;
    back(e);
  });

  // ---- layout: editor width follows the card, sticky header offset for scrolling ----
  let frame = 0;
  const top = $('top');
  const relayout = () => {
    frame = 0;
    doc.documentElement.style.scrollPaddingTop = `${top.offsetHeight + 8}px`;
    editor.setWidth(width());
  };
  if (win.ResizeObserver) new win.ResizeObserver(() => { if (!frame) frame = win.requestAnimationFrame(relayout); }).observe(card);
  doc.documentElement.style.scrollPaddingTop = `${top.offsetHeight + 8}px`;
  // Re-render once the music font has loaded (the editor also refreshes on document.fonts.ready).
  doc.fonts?.load?.('40px Bravura').then(() => editor.refresh(), () => {});
  return editor;
}
