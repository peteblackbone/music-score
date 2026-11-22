/**
 * editor-demo-edit.js — the 2.3 Edit group (Copy, Cut, Paste) and Measures
 * group (Fill, Reflow) of editor.html, and the Selection status item. Not
 * part of the package; uses the ScoreEditor public API only.
 *
 * Copy and Cut also try navigator.clipboard.writeText and stay silent when
 * that is refused. Paste reads the system clipboard only when the
 * 'clipboard-read' permission is already granted (never a prompt), else
 * the editor's internal clipboard; Ctrl+V in the editor uses the native
 * paste event and so also reaches other tabs. Fill and Reflow go through
 * handleKey. A pointer click returns focus to the editor; a focused button
 * that becomes disabled hands focus to an enabled sibling.
 *
 * Pure helpers (exported for the tests): selectionText, isClipText.
 */
import { ScoreEditor } from '../index.js';

/** The status bar's Selection text for getSelection() `sel`: '–', '6 beats, measures 2–3', '4 beats, measure 2', '3 measures (2–4)', '1 measure (2)'. */
export function selectionText(sel) {
  if (!sel) return '–';
  const [a, b] = sel.measures;
  const span = a === b ? `${a + 1}` : `${a + 1}–${b + 1}`;
  if (sel.kind === 'measures') {
    const n = b - a + 1;
    return `${n} measure${n === 1 ? '' : 's'} (${span})`;
  }
  return `${sel.beatCount} beat${sel.beatCount === 1 ? '' : 's'}, measure${a === b ? '' : 's'} ${span}`;
}

/** Whether clipboard text `t` is a music-score clip (the library's check, size cap included). */
export const isClipText = (t) => ScoreEditor.looksLikeClip(t);

/**
 * Wire the Edit and Measures groups. `refresh` re-reads the page after an
 * action; `back(e)` returns focus to the editor after a pointer click.
 * Returns `refreshEdit(info, readOnly)`.
 */
export function wireEdit(doc, editor, { refresh = () => {}, back = () => {} } = {}) {
  const $ = (id) => doc.getElementById(id);
  const nav = doc.defaultView?.navigator;
  const copyBtn = $('copy-btn');
  const cutBtn = $('cut-btn');
  const pasteBtn = $('paste-btn');
  const fillBtn = $('fill-btn');
  const reflowBtn = $('reflow-btn');
  const write = (text) => { if (text) nav?.clipboard?.writeText?.(text).catch(() => {}); };
  const done = (e) => { refresh(); back(e); };

  copyBtn.addEventListener('click', (e) => { write(editor.copy()); done(e); });
  cutBtn.addEventListener('click', (e) => { write(editor.cut()); done(e); });
  pasteBtn.addEventListener('click', async (e) => {
    let text;
    try {
      const p = await nav?.permissions?.query?.({ name: 'clipboard-read' });
      if (p?.state === 'granted') text = await nav.clipboard.readText();
    } catch { text = undefined; }
    editor.paste(isClipText(text) ? text : undefined);
    done(e);
  });
  fillBtn.addEventListener('click', (e) => { editor.handleKey({ key: 'f' }); done(e); });
  reflowBtn.addEventListener('click', (e) => { editor.handleKey({ key: 'F', shiftKey: true }); done(e); });

  const groups = [[copyBtn, cutBtn, pasteBtn], [fillBtn, reflowBtn]];
  return function refreshEdit(info, readOnly) {
    const nothing = !info.selection && info.appendSlot;
    const was = doc.activeElement;
    copyBtn.disabled = nothing;
    cutBtn.disabled = nothing || readOnly;
    pasteBtn.disabled = readOnly;
    fillBtn.disabled = readOnly;
    reflowBtn.disabled = readOnly;
    $('st-selection').textContent = selectionText(info.selection);
    for (const group of groups) {
      if (!group.includes(was) || !was.disabled) continue;
      (group.find((b) => !b.disabled) ?? editor).focus();
    }
  };
}
