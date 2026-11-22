/**
 * ScoreEditor.js — the public keyboard TAB editor (2.0.0).
 *
 *   import { ScoreEditor } from './index.js';
 *   const editor = new ScoreEditor(document.getElementById('editor'), scoreOrJson, { width: 900 });
 *   editor.on('change', () => save(editor.getScore()));
 *
 * It owns a model (a sanitized copy of the score, replaced copy-on-write
 * by every command), a cursor, the current duration, the undo history and
 * the event listeners; the DOM lives in view.js. Every command goes through
 * model/commands.js run(); edits re-render once per animation frame and
 * emit one `change` per model change after that render, cursor moves
 * redraw the overlay only and emit `cursor` at once.
 */
import { EditorView, defaultClock } from './view.js';
import { parseInput, exportScore } from './model/io.js';
import { EDITOR_LIMITS } from './model/limits.js';
import { defaultScore } from './model/defaultScore.js';
import { clampCursor, cursorInfo, syncDuration, sameCursor } from './model/cursor.js';
import { measureFill, fillTable } from './model/fill.js';
import { tracksOf, measureCount } from './model/access.js';
import { COMMANDS, run } from './model/commands.js';
import { createHistory } from './model/history.js';
import { bufferLive } from './model/notes.js';
import { DURATIONS } from './model/beats.js';
import { keyToCommand } from './keymap.js';
import { resolveStyle } from './style.js';
import { describe, describeCursor, describeEdit, undoLabel } from './announce.js';

const START = { track: 0, measure: 0, beat: 0, string: 1 };
const freshState = () => ({ duration: 'quarter', dots: 0, digit: null });
const CURSOR_KEYS = ['track', 'measure', 'beat', 'string'];

export class ScoreEditor {
  /** Input size limits (model/limits.js); a larger score throws Error('Score too large: …'). */
  static LIMITS = EDITOR_LIMITS;

  /**
   * @param {HTMLElement} container - the editor builds its own wrapper inside and never writes outside it.
   * @param {object|string} [score] - score object or JSON string (schemaVersion missing or 1); default: one empty guitar measure.
   * @param {object} [options] - `{ width, theme, readOnly, maxFret, historyLimit, twoDigitDelayMs, cursorColor, overfullColor, underfullColor }`.
   */
  constructor(container, score, options = {}) {
    if (!container || typeof container.appendChild !== 'function') throw new TypeError('ScoreEditor needs a container element');
    const model = score == null ? defaultScore() : parseInput(score); // parse first: a bad score writes nothing
    const o = options || {};
    this._maxFret = Number.isFinite(o.maxFret) ? Math.min(99, Math.max(0, Math.floor(o.maxFret))) : 24;
    this._delay = Number.isFinite(o.twoDigitDelayMs) && o.twoDigitDelayMs >= 0 ? o.twoDigitDelayMs : 800;
    this._readOnly = !!o.readOnly;
    this._model = model;
    this._cursor = clampCursor(model, START);
    this._state = syncDuration(model, this._cursor, freshState());
    this._history = createHistory(o.historyLimit ?? 200);
    this._digitEntry = null;
    this._listeners = new Map();
    this._queue = [];
    this._focused = false;
    this._destroyed = false;
    this._clock = { ...defaultClock(), ...(o.clock || {}) }; // internal, test-only
    this._view = new EditorView(container, {
      viewScore: () => (this._model.multiMeasureRests ? { ...this._model, multiMeasureRests: false } : this._model),
      cursorInfo: () => this._info(),
      fills: () => fillTable(this._model),
      afterRender: () => this._drain(),
      onKey: (e) => this.handleKey(e),
      onClick: (hit) => this._moveTo({ track: hit.ti, measure: hit.measureIndex, beat: hit.beatIndex, string: hit.string ?? this._cursor.string }),
      onFocusChange: (f) => this._focusChanged(f),
    }, { width: o.width, theme: o.theme, style: resolveStyle(o), clock: this._clock });
    this._syncRoot();
    this._view.flush();
  }

  // ---- model I/O ----
  /** Replace the score (object or JSON string); clears history; emits change {source:'load'} after the render, then cursor. */
  loadScore(input) {
    this._alive();
    // everything that can throw runs on locals first, so a failed load changes nothing
    const model = parseInput(input);
    const cursor = clampCursor(model, START);
    const state = syncDuration(model, cursor, freshState());
    this._model = model;
    this._cursor = cursor;
    this._state = state;
    this._history.clear();
    this._digitEntry = null;
    this._syncRoot();
    this._queue.push(['change', { source: 'load' }], ['cursor', null]);
    this._view.scheduleRender();
  }

  /** A deep JSON clone of the score with `schemaVersion: 1`. */
  getScore() { this._alive(); return exportScore(this._model); }
  toJSON() { return this.getScore(); }

  // ---- cursor ----
  getCursor() { this._alive(); return { ...this._cursor }; }
  /** Move the cursor to `partial` (missing fields kept), clamped to a valid position; returns the cursor. */
  setCursor(partial = {}) {
    this._alive();
    const want = { ...this._cursor };
    for (const k of CURSOR_KEYS) if (Number.isFinite(partial?.[k])) want[k] = Math.trunc(partial[k]);
    return this._moveTo(want);
  }
  /** Status-bar summary of the cursor (fret, duration, dots, triplet, slot, fill, names, tuning …). */
  getCursorInfo() { this._alive(); return this._info(); }
  /** 'under' | 'full' | 'over' of track `track` measure `measure` (voice 1); RangeError when out of range. */
  getMeasureFill(track, measure) {
    this._alive();
    if (!Number.isInteger(track) || track < 0 || track >= tracksOf(this._model).length) throw new RangeError('track out of range');
    if (!Number.isInteger(measure) || measure < 0 || measure >= measureCount(this._model)) throw new RangeError('measure out of range');
    return measureFill(this._model, track, measure);
  }

  // ---- input ----
  /** Run the command bound to keyboard event `e`; true when the key was consumed (the listener then calls preventDefault). */
  handleKey(e) {
    this._alive();
    const c = keyToCommand(e);
    if (!c) return false;
    const kind = COMMANDS[c.name].kind;
    if (kind === 'buffer') {
      if (!this._bufferActive()) return false;
      this._state = { ...this._state, digit: null };
      this._digitEntry = null;
      return true;
    }
    if (kind === 'history') {
      if (this._readOnly) { this._say(describe({ id: 'readOnly' })); return false; }
      if (c.name === 'undo') this.undo(); else this.redo();
      return true;
    }
    return this._exec(c.name, c.arg);
  }
  /** Set the current duration (and the cursor beat's): 'whole' … '64th'. False when unknown or read-only. */
  setDuration(name) {
    this._alive();
    return DURATIONS.includes(name) ? this._exec('setDuration', name) : false;
  }
  focus() { this._alive(); this._view.root.focus({ preventScroll: true }); }

  // ---- history ----
  undo() { return this._step('undo'); }
  redo() { return this._step('redo'); }
  canUndo() { this._alive(); return !this._readOnly && this._history.canUndo(); }
  canRedo() { this._alive(); return !this._readOnly && this._history.canRedo(); }

  // ---- settings ----
  setReadOnly(flag) {
    this._alive();
    this._readOnly = !!flag;
    this._state = { ...this._state, digit: null };
    this._syncRoot();
  }
  isReadOnly() { this._alive(); return this._readOnly; }
  setWidth(px) {
    this._alive();
    if (!Number.isFinite(px) || px <= 0) throw new RangeError('width must be a positive number');
    this._view.renderer.width = px;
    this._view.scheduleRender();
  }
  /** Schedule a full re-render (e.g. after the page's fonts load). */
  refresh() { this._alive(); this._view.scheduleRender(); }

  // ---- events ----
  /** Listen to 'change' or 'cursor'; returns an unsubscribe function. */
  on(type, fn) {
    this._alive();
    if (typeof fn !== 'function') throw new TypeError('listener must be a function');
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this._listeners.get(type)?.delete(fn);
  }
  off(type, fn) { this._alive(); this._listeners.get(type)?.delete(fn); }

  /** Remove listeners, DOM and timers. Idempotent; any other method throws afterwards. */
  destroy() {
    if (this._destroyed) return;
    this._view.destroy();
    this._listeners.clear();
    this._queue = [];
    this._destroyed = true;
  }

  // ---- internals ----
  _alive() { if (this._destroyed) throw new Error('ScoreEditor destroyed'); }
  _info() { return cursorInfo(this._model, this._cursor, this._state); }
  _ctx() { return { maxFret: this._maxFret, now: this._clock.now(), twoDigitDelayMs: this._delay, allowAppend: !this._readOnly }; }
  _bufferActive() { return bufferLive(this._state.digit, this._cursor, this._ctx()); }
  _say(text) { if (text) this._view.announce(text); }

  _syncRoot() {
    const t = typeof this._model.title === 'string' && this._model.title.trim() ? this._model.title.trim() : 'Untitled score';
    this._view.setRootState({ focused: this._focused, readOnly: this._readOnly, title: t });
  }

  _emit(type, payload) {
    for (const fn of [...(this._listeners.get(type) || [])]) {
      try { fn(payload); } catch (err) { console.error(err); }
    }
  }
  _emitCursor() { this._emit('cursor', { ...this._cursor, voice: 1 }); }
  /** Queued events, after a render: one change per model change; a null cursor payload is the cursor at that time. */
  _drain() {
    const q = this._queue;
    this._queue = [];
    for (const [type, payload] of q) {
      if (type === 'cursor' && !payload) this._emitCursor(); else this._emit(type, payload);
    }
  }
  _modelChanged(source, command) {
    this._queue.push(['change', command ? { source, command } : { source }]);
    this._view.requestScroll();
    this._view.scheduleRender();
  }
  _cursorMoved() {
    this._view.requestScroll();
    if (!this._view.pending) this._view.drawCursor();
    this._emitCursor();
  }

  _exec(name, arg) {
    if (this._readOnly && COMMANDS[name].kind === 'edit') { this._say(describe({ id: 'readOnly' })); return false; }
    const prev = this._info();
    const before = { score: this._model, cursor: this._cursor };
    const r = run(name, this._model, this._cursor, this._state, this._ctx(), arg);
    this._model = r.score;
    this._cursor = r.cursor;
    this._state = r.state;
    if (r.changed) {
      const after = { score: r.score, cursor: r.cursor };
      const label = undoLabel(name, r.announce);
      if (r.coalesce && this._digitEntry && this._history.top() === this._digitEntry) {
        this._history.coalesce(after);
        this._digitEntry.label = label;
        this._digitEntry = null;
      } else {
        const entry = { before, after, label };
        this._history.push(entry);
        this._digitEntry = name === 'digit' && r.state.digit ? entry : null;
      }
      this._modelChanged('edit', name);
      if (r.moved) this._emitCursor();
    } else {
      this._digitEntry = null;
      if (r.moved) this._cursorMoved();
    }
    const info = this._info();
    if (r.announce) this._say(r.changed ? describeEdit(r.announce, info, prev) : describe(r.announce));
    else if (r.moved) this._say(describeCursor(info, prev));
    return true;
  }

  _step(kind) {
    this._alive();
    if (this._readOnly) return false;
    const e = kind === 'undo' ? this._history.undo() : this._history.redo();
    if (!e) { this._say(describe({ id: kind === 'undo' ? 'nothingToUndo' : 'nothingToRedo' })); return false; }
    const snap = kind === 'undo' ? e.before : e.after;
    const prevCursor = this._cursor;
    this._model = snap.score;
    this._cursor = clampCursor(snap.score, snap.cursor);
    this._state = syncDuration(this._model, this._cursor, { ...this._state, digit: null });
    this._digitEntry = null;
    this._modelChanged(kind);
    if (!sameCursor(prevCursor, this._cursor)) this._emitCursor();
    this._say(describe({ id: kind, label: e.label }));
    return true;
  }

  _moveTo(want) {
    const prev = this._info();
    const next = clampCursor(this._model, want);
    this._state = { ...this._state, digit: null };
    this._digitEntry = null;
    if (!sameCursor(next, this._cursor)) {
      this._cursor = next;
      this._state = syncDuration(this._model, next, this._state);
      this._cursorMoved();
      this._say(describeCursor(this._info(), prev));
    }
    return { ...this._cursor };
  }

  _focusChanged(focused) {
    this._focused = focused;
    this._view.focused = focused;
    this._syncRoot();
    this._view.drawCursor();
    if (focused) this._say(describeCursor(this._info(), null, true));
  }
}
