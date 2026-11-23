/**
 * selection.js — the 2.3 keyboard selection on ScoreEditor, installed the
 * way settings.js is (ScoreEditor stays under its size budget).
 *
 *   editor.setSelection({ anchor: { measure: 1, beat: 0 }, focus: { measure: 2, beat: 3 } });
 *   editor.getSelection();   // { kind, track, start, end, beatCount, measures, tracks } or null
 *   editor.clearSelection();
 *   editor.on('selection', (info) => …);   // info or null
 *
 * State: `_selection` is null or `{ track, anchor, focus, slices, info }`
 * (model/selection.js), or (2.3.2) a column selection `{ track, tracks,
 * anchor, focus, parts, info }` (model/columns.js) when the two ends are on
 * different tracks; the focus is always the cursor, and the ends carry their
 * tracks. Select commands (Shift+arrows, Ctrl+Shift+arrows, Shift+Home /
 * End, Ctrl+A, 2.3.2 Shift+Up / Down / PageUp / PageDown) go through
 * `_extend`, also in read-only mode. Every model change, plain move,
 * click, undo / redo and load clears the selection (`_dropSelection`,
 * which fires `selection` with null first); a refused or no-op edit keeps
 * it. 2.3.1: a command flagged `keepsSelection` (the effects and transpose,
 * model/commands.js) keeps it after a change, re-derived from the same
 * anchor and focus on the new model (`_settleSelection`; `selection` fires
 * only when its info changed). A selection may cover no beat at all: a
 * zero-beat selection of blank measures (beatCount 0). Esc clears it
 * (`_escape`). DOM-free: the view draws it. Copy, cut and paste come from
 * clipboard.js (installed here).
 */
import { COMMANDS, run } from './model/commands.js';
import { selectionInfo, startOf } from './model/selection.js';
import { anchorOf, focusOf, selectionOf, coversTrack, allTracks, wordsOf } from './model/columns.js';
import { clampCursor, syncDuration, positions } from './model/cursor.js';
import { tracksOf } from './model/access.js';
import { removeTrackImpact } from './model/settings/tracks.js';
import { describe } from './announce.js';
import { method } from './install.js';
import { installClipboard } from './clipboard.js';

/** The public names selection.js installs on ScoreEditor.prototype. */
export const SELECTION_API = Object.freeze(['getSelection', 'setSelection', 'clearSelection', 'getRemoveTrackImpact', 'copy', 'cut', 'paste']);

const same = (a, b) => JSON.stringify(a?.info ?? null) === JSON.stringify(b?.info ?? null);

/** `p` checked to be `{ track?, measure, beat }` with finite numbers (truncated); TypeError otherwise. */
function point(p, what) {
  if (p === null || typeof p !== 'object') throw new TypeError(`Selection ${what} must be an object`);
  const { track, measure, beat } = p;
  for (const [k, v] of [['measure', measure], ['beat', beat], ['track', track ?? 0]]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new TypeError(`Selection ${what} ${k} must be a finite number`);
  }
  return { track: track === undefined ? undefined : Math.trunc(track), measure: Math.trunc(measure), beat: Math.trunc(beat) };
}

/** Install the selection API, and the clipboard (clipboard.js), on `Editor` (ScoreEditor). */
export function installSelection(Editor) {
  installClipboard(Editor);
  const def = (name, fn) => method(Editor, name, fn);

  def('getSelection', function getSelection() { this._alive(); return selectionInfo(this._selection); });

  /** Select from `anchor` to `focus` (`{ track?, measure, beat }`, clamped; 2.3.2: on two tracks, a column); the cursor moves to the focus. Returns getSelection(). */
  def('setSelection', function setSelection(spec) {
    this._alive();
    if (spec === null || typeof spec !== 'object') throw new TypeError('setSelection needs { anchor, focus }');
    const a = point(spec.anchor, 'anchor');
    const f = point(spec.focus, 'focus');
    const ti = f.track ?? this._cursor.track;
    const ai = a.track ?? ti;
    this._cancelBuffer();
    const cursor = clampCursor(this._model, { ...this._cursor, track: ti, measure: f.measure, beat: f.beat });
    const anchor = clampCursor(this._model, { ...cursor, track: ai, measure: a.measure, beat: a.beat });
    this._state = syncDuration(this._model, cursor, this._state);
    this._range(anchor, cursor, false, null);
    return selectionInfo(this._selection);
  });

  def('clearSelection', function clearSelection() { this._alive(); return this._dropSelection(); });

  /** What removeTrack(ti) would delete: `{ notes, tempoMarks }` (no side effects). */
  def('getRemoveTrackImpact', function getRemoveTrackImpact(ti) { this._alive(); return removeTrackImpact(this._model, ti); });

  /**
   * Run select command `name`: anchor (kept, else the cursor; Select all:
   * the start), move, reselect, announce. 2.3.2: a second Ctrl+A on a
   * selection that covers the track selects all visible tracks; with
   * nothing selected, Ctrl+Shift+Left / Right on a measure with one
   * position selects that measure first; a track extend at an edge
   * (`edgeKeeps`) says so and changes nothing.
   */
  def('_extend', function extend(name) {
    this._cancelBuffer();
    const cmd = COMMANDS[name];
    const c = this._cursor;
    const sel = this._selection;
    if (cmd.fromStart && coversTrack(this._model, sel)) {
      const all = allTracks(this._model, c);
      if (all) { this._state = syncDuration(this._model, all.cursor, this._state); this._range(all.anchor, all.cursor, true, null); return true; }
    }
    const here = { track: c.track, measure: c.measure, beat: c.beat };
    if (cmd.measureStep && !sel && positions(this._model, c).length === 1) { this._range(here, c, false, null); return true; }
    const anchor = cmd.fromStart ? { track: c.track, ...startOf(this._model, c) } : anchorOf(sel) ?? here;
    const r = run(name, this._model, c, this._state, this._ctx());
    this._state = r.state;
    if (cmd.edgeKeeps && !r.moved) { this._say(describe(r.announce)); return true; }
    this._range(anchor, r.cursor, !!cmd.fromStart, r.moved ? null : r.announce);
    return true;
  });

  /** Move the cursor to `cursor` and select from `anchor` to it; events: cursor, then selection when it changed. */
  def('_range', function range(anchor, cursor, all, edge) {
    const prev = this._selection;
    const moved = cursor.measure !== this._cursor.measure || cursor.beat !== this._cursor.beat || cursor.track !== this._cursor.track;
    this._cursor = cursor;
    const sel = tracksOf(this._model).length ? selectionOf(this._model, { ...anchor, track: anchor.track ?? cursor.track }, cursor) : null;
    this._selection = sel;
    if (moved) { this._view.requestScroll(); this._emitCursor(); }
    if (!same(prev, sel)) this._events.emit('selection', selectionInfo(sel));
    if (!this._view.pending) this._view.drawOverlay();
    if (edge && same(prev, sel) && sel) this._say(describe(edge)); // at an edge with nothing new: say the edge
    else if (sel) this._say(describe(wordsOf(this._model, sel, all && sel.info.kind === 'measures')));
    else this._say(describe({ id: prev ? 'selectionCleared' : 'nothingToSelect' }));
  });

  /** After command `name` ran with result `r` (_exec): keep the selection, re-derived, after a change by a keepsSelection command (true), else clear it after a change or a plain move. */
  def('_settleSelection', function settle(name, r) {
    const cmd = COMMANDS[name];
    if (r.changed && cmd.keepsSelection && this._selection) {
      const prev = this._selection;
      const next = selectionOf(this._model, anchorOf(prev), focusOf(prev));
      if (!next) return this._dropSelection();
      this._selection = next;
      if (!same(prev, next)) this._events.emit('selection', selectionInfo(next));
      return true;
    }
    if (r.changed || cmd.kind === 'nav') this._dropSelection(cmd.kind === 'nav');
    return false;
  });

  /** Esc: end a two-digit entry, else clear the selection (announced); true when either was live. */
  def('_escape', function escape() { return this._cancelBuffer() || this._dropSelection(true); });

  /** Clear a live selection: redraw, fire `selection` with null, optionally say "Selection cleared"; true when there was one. */
  def('_dropSelection', function drop(say = false) {
    if (!this._selection) return false;
    this._selection = null;
    this._view.drawSelection();
    this._events.emit('selection', null);
    if (say) { this._lastMessage = describe({ id: 'selectionCleared' }); this._view.announce(this._lastMessage, { lead: true }); }
    return true;
  });

  def('_selectionInfo', function info() { return selectionInfo(this._selection); });
  def('_selectionView', function view() {
    const s = this._selection;
    if (!s) return s;
    return s.parts ? { tracks: s.tracks, measures: s.info.measures } : { track: s.track, kind: s.info.kind, slices: s.slices };
  });
}
