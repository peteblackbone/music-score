/**
 * install.js — the helper settings.js, selection.js and clipboard.js use to
 * add methods to ScoreEditor.prototype (which keeps ScoreEditor.js under
 * its size budget). Installed methods are non-enumerable, like class
 * methods, so `Object.keys(ScoreEditor.prototype)` stays empty.
 */

/** A property descriptor for a non-enumerable, writable, configurable `value`. */
export const hidden = (value) => ({ value, enumerable: false, writable: true, configurable: true });

/** Install `fn` as the non-enumerable method `name` of `Editor.prototype`. */
export const method = (Editor, name, fn) => Object.defineProperty(Editor.prototype, name, hidden(fn));
