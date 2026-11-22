/**
 * clipboard.js — 2.3 copy, cut and paste on ScoreEditor, installed by
 * selection.js. DOM-free: view.js listens for the native copy / cut /
 * paste events (only while the editor root has focus) and hands them to
 * `_clipboardEvent`, which reads and writes their clipboardData.
 *
 *   const text = editor.copy();   // the clip JSON, or null (nothing to copy)
 *   editor.cut();                 // copy, then the range becomes rests (one undo step)
 *   editor.paste();               // from the internal clipboard; paste(text) from a clip string
 *   editor.paste(text, { insert: true });   // 2.3.1 Insert paste: new measures / beats, nothing replaced
 *
 * `internal` is the module-level clipboard every editor on the page shares
 * (always available; the fallback when the system clipboard has no clip).
 * Copy takes the selection, or the cursor beat with its leading graces.
 * A paste event reads the custom type first, then text/plain that is a
 * clip, then the internal clipboard. Safari may fire no paste event on the
 * root, so a Ctrl+V keydown schedules an internal paste after 0 ms that a
 * paste event for this editor cancels: one keystroke pastes once.
 * Ctrl+Shift+V (2.3.1) is the same keystroke with a one-shot insert flag:
 * every paste keydown sets it (or clears it), the native paste or the
 * fallback takes it, and blur and destroy clear it.
 */
import { CLIP_MIME, cursorRange, buildClip, parseClip, looksLikeClip } from './model/clip.js';
import { applyPaste } from './model/paste.js';
import { clearSlices } from './model/rangeEdit.js';
import { exportedLength } from './model/io.js';
import { EDITOR_LIMITS } from './model/limits.js';
import { describe } from './announce.js';
import { method } from './install.js';
import { isInsertPasteKey } from './keymap.js';

/** The clipboard shared by every editor on the page: clip JSON text, or null. */
let internal = null;

/** Write clip `text` to clipboardData `data` as the custom type and text/plain; false when it is missing or refused. */
function writeClip(data, text) {
  try {
    data.setData(CLIP_MIME, text);
    data.setData('text/plain', text);
    return true;
  } catch {
    return false;
  }
}


/** Install copy, cut, paste and the clipboard event handler on `Editor` (ScoreEditor), and the static `looksLikeClip(text)`. */
export function installClipboard(Editor) {
  Object.defineProperty(Editor, 'looksLikeClip', { value: looksLikeClip, enumerable: true, writable: false, configurable: false });
  const def = (name, fn) => method(Editor, name, fn);

  /** The clip of the selection or the cursor beat → `{ text, kind, count, range }`, or null on the slot. */
  def('_clip', function clip() {
    const range = this._selection ?? cursorRange(this._model, this._cursor);
    return range && { ...buildClip(this._model, range), range };
  });

  def('copy', function copy() {
    this._alive();
    const c = this._clip();
    if (!c) { this._say(describe({ id: 'nothingToCopy' })); return null; }
    internal = c.text;
    this._say(describe({ id: 'copied', kind: c.kind, count: c.count }));
    return c.text;
  });

  def('cut', function cut() {
    this._alive();
    return this._cut(false);
  });

  /**
   * Cut: copy, then clear the range (one undo step). From a cut event
   * (`event`) the clip goes into `data` (clipboardData) first; when that is
   * missing or refused the score is left alone. The internal clipboard
   * still gets the clip, so Paste in the editor works, and that is said.
   */
  def('_cut', function cutTo(event, data) {
    this._cancelBuffer();
    if (this._readOnly) { this._sayKept(describe({ id: 'readOnly' })); return null; }
    const c = this._clip();
    if (!c) { this._say(describe({ id: 'nothingToCopy' })); return null; }
    internal = c.text;
    if (event && !writeClip(data, c.text)) { this._sayKept(describe({ id: 'cutUnwritten', kind: c.kind, count: c.count })); return null; }
    const r = clearSlices(this._model, c.range);
    const announce = { id: 'cut', kind: c.kind, count: c.count };
    if (r.score === this._model) this._say(describe({ ...announce, id: 'copiedRests' })); // only rests: copied, nothing to clear
    else this._applyModel('cut', 'cut', { score: r.score, cursor: { ...this._cursor, ...r.cursor }, announce });
    return c.text;
  });

  /** Paste `input` (a clip, default the internal clipboard); `options.insert === true` inserts (2.3.1). TypeError for options that aren't an object. */
  def('paste', function paste(input, options) {
    this._alive();
    if (options != null && typeof options !== 'object') throw new TypeError('paste options must be an object');
    return this._pasteFrom(input === undefined ? internal : input, options?.insert === true);
  });

  /** Paste clip `src` (text or object; null: nothing to paste) as one undo step, inserting when `insert`; refusals are announced; returns a boolean. */
  def('_pasteFrom', function pasteFrom(src, insert = false) {
    this._cancelBuffer();
    if (this._readOnly) return this._refused({ id: 'readOnly' });
    if (src == null) return this._refused({ id: 'nothingToPaste' });
    const p = parseClip(src);
    if (p.refused) return this._refused(p.refused);
    const r = applyPaste(this._model, this._cursor, this._selection, p.clip, { insert });
    if (r.refused) return this._refused(r.refused);
    if (exportedLength(r.score) > EDITOR_LIMITS.jsonChars) return this._refused({ id: 'tooLarge' });
    return this._applyModel('paste', 'paste', r);
  });

  /** Safari fallback: paste from the internal clipboard after 0 ms unless a native paste arrives first. */
  def('_schedulePasteFallback', function schedulePasteFallback() {
    this._cancelPasteFallback();
    this._pasteTimer = this._clock.setTimeout(() => { this._pasteTimer = null; if (!this._destroyed) this._pasteFrom(internal, this._takeInsert()); }, 0);
  });
  /** Read and clear the one-shot insert flag of the last paste keydown. */
  def('_takeInsert', function takeInsert() {
    const insert = this._pasteInsert === true;
    this._pasteInsert = false;
    return insert;
  });
  def('_cancelPasteFallback', function cancelPasteFallback() {
    if (this._pasteTimer != null) this._clock.clearTimeout(this._pasteTimer);
    this._pasteTimer = null;
  });

  /**
   * View notifications: 'pastekey' (a paste shortcut on the root: set the
   * insert flag from it and schedule the fallback), 'pasteseen' (any native
   * paste: cancel the fallback, keep the flag), 'blur' and 'destroy' (clear
   * both), or a native event `e` of `kind` ('copy' | 'cut' | 'paste') while
   * the root has focus. True when the event was handled (the view then
   * cancels its default action).
   */
  def('_clipboardEvent', function clipboardEvent(kind, e) {
    if (kind === 'pastekey') {
      if (this._destroyed) return false;
      this._pasteInsert = isInsertPasteKey(e);
      this._schedulePasteFallback();
      return false;
    }
    if (kind === 'blur' || kind === 'destroy') this._pasteInsert = false;
    if (kind === 'pasteseen' || kind === 'blur' || kind === 'destroy' || kind === 'paste') this._cancelPasteFallback();
    if (this._destroyed || kind === 'pasteseen' || kind === 'blur' || kind === 'destroy') return false;
    const data = e?.clipboardData;
    const read = (type) => { try { return data?.getData(type) || null; } catch { return null; } };
    if (kind === 'paste') {
      const custom = read(CLIP_MIME);
      const text = custom ? null : read('text/plain');
      this._pasteFrom(custom ?? (looksLikeClip(text) ? text : internal), this._takeInsert());
      return true;
    }
    if (kind === 'cut') return this._cut(true, data) != null;
    const text = this.copy();
    return text != null && writeClip(data, text);
  });
}
