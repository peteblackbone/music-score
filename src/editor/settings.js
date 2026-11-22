/**
 * settings.js — the 2.2 score and track settings API, installed onto
 * ScoreEditor (which stays under its size budget this way).
 *
 *   editor.updateScore({ title: 'Song' });                 // header text, showTuningChart, multiMeasureRests
 *   editor.updateTrack(0, { capo: 2, tuning: [...] });     // names, clef, staves, TAB options, capo, tuning
 *   editor.addTrack('bass4'); editor.removeTrack(1); editor.moveTrack(1, 0);
 *   editor.updateMeasure(4, { timeSignature: { beats: 3, beatType: 4 } });
 *   editor.setTempo(120);                                  // at the cursor beat
 *   editor.getMeasureSettings(4);                          // read-only
 *   editor.lastMessage;                                    // the last spoken text
 *
 * Each call runs a pure model operation (model/settings/ops.js). Bad
 * arguments throw (TypeError / RangeError) before anything happens, even
 * in read-only mode. Then the two-digit fret entry is cancelled, and the
 * call is refused (false, reason announced, no history, no event) in
 * read-only mode, for an editor-state refusal, a call that changes
 * nothing ("No change") or a result whose getScore() JSON is past
 * LIMITS.jsonChars (so the editor's own output always reloads). Otherwise it
 * is one undo step: the cursor event first if the cursor moved, then one
 * `change` after the render with `{ source: 'edit', command, message }`;
 * returns true. Settings calls skip the hidden-track check commands make.
 * Their messages are kept when the live region joins announcements, so a
 * second call or the focus move after a dialog does not drown them.
 */
import { SETTINGS } from './model/settings/ops.js';
import { getMeasureSettings } from './model/settings/measureSettings.js';
import { INSTRUMENTS, TUNINGS } from './model/settings/instruments.js';
import { EDITOR_LIMITS } from './model/limits.js';
import { exportedLength } from './model/io.js';
import { clampCursor, syncDuration, sameCursor } from './model/cursor.js';
import { describe } from './announce.js';

/** The public names settings.js installs on ScoreEditor.prototype (the 7 calls, getMeasureSettings and the lastMessage getter). */
export const SETTINGS_API = Object.freeze([...Object.keys(SETTINGS), 'getMeasureSettings', 'lastMessage']);

const hidden = (value) => ({ value, enumerable: false, writable: true, configurable: true });

/** Install the settings API on `Editor` (ScoreEditor): prototype methods, the lastMessage getter, helpers and statics. */
export function installSettings(Editor) {
  const proto = Editor.prototype;
  for (const name of Object.keys(SETTINGS)) {
    Object.defineProperty(proto, name, hidden({ [name](...args) { return this._settings(name, args); } }[name]));
  }
  Object.defineProperty(proto, 'getMeasureSettings', hidden(function getMeasure(mi, ti) {
    this._alive();
    return getMeasureSettings(this._model, mi, ti === undefined ? this._cursor.track : ti);
  }));
  Object.defineProperty(proto, 'lastMessage', {
    get() { this._alive(); return this._lastMessage ?? ''; },
    enumerable: false,
    configurable: true,
  });
  Object.defineProperty(proto, '_settings', hidden(function runSettings(name, args) {
    this._alive();
    const def = SETTINGS[name];
    const r = def.fn(this._model, this._cursor, ...args); // throws before any state change
    this._cancelBuffer();
    if (this._readOnly) return this._settingsRefused({ id: 'readOnly' });
    if (r.refused) return this._settingsRefused(r.refused);
    if (r.score === this._model) return this._settingsRefused({ id: 'noChange' });
    if (exportedLength(r.score) > EDITOR_LIMITS.jsonChars) return this._settingsRefused({ id: 'tooLarge' });
    return this._applyModel(name, r.label ?? def.label, r);
  }));
  Object.defineProperty(proto, '_settingsRefused', hidden(function refused(d) {
    this._sayKept(describe(d));
    return false;
  }));
  Object.defineProperty(proto, '_sayKept', hidden(function sayKept(text) {
    this._lastMessage = text;
    this._view.announce(text, true);
  }));
  Object.defineProperty(proto, '_applyModel', hidden(function applyModel(name, label, r) {
    const before = { score: this._model, cursor: this._cursor };
    const cursor = clampCursor(r.score, r.cursor ?? this._cursor);
    this._model = r.score;
    this._cursor = cursor;
    this._history.push({ before, after: { score: r.score, cursor }, label });
    this._digitEntry = null;
    this._state = syncDuration(this._model, cursor, this._state);
    this._syncRoot();
    const message = describe(r.announce);
    this._sayKept(message); // before any handler runs: with no animation frames the render (and `change`) is synchronous
    if (!sameCursor(before.cursor, cursor)) this._emitCursor();
    this._events.queue('change', { source: 'edit', command: name, message });
    this._view.requestScroll();
    this._view.scheduleRender();
    return true;
  }));
  const frozen = (value) => ({ value, enumerable: true, writable: false, configurable: false });
  Object.defineProperty(Editor, 'INSTRUMENTS', frozen(INSTRUMENTS));
  Object.defineProperty(Editor, 'TUNINGS', frozen(TUNINGS));
}
