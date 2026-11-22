/**
 * model/history.js — undo / redo stacks. An entry is
 * `{ before: { score, cursor }, after: { score, cursor }, label }`; the
 * scores are shared, never-mutated model objects, so an entry costs two
 * references. A push clears redo and drops the oldest entry past the limit.
 */

import { DEFAULTS, intOption } from '../options.js';

/** The history limit: an integer 0–DEFAULTS.historyCap, default DEFAULTS.historyLimit. */
export const clampLimit = (v) => intOption(v, DEFAULTS.historyLimit, 0, DEFAULTS.historyCap);

export function createHistory(limit = DEFAULTS.historyLimit) {
  const max = clampLimit(limit);
  let undos = [];
  let redos = [];
  return {
    limit: max,
    push(entry) {
      redos = [];
      if (!max) return;
      undos.push(entry);
      if (undos.length > max) undos.shift();
    },
    /** Replace the top entry's `after` (a two-digit fret becomes one step). */
    coalesce(after) {
      const top = undos[undos.length - 1];
      if (top) top.after = after;
    },
    top: () => undos[undos.length - 1] ?? null,
    undo() {
      const e = undos.pop();
      if (e) redos.push(e);
      return e ?? null;
    },
    redo() {
      const e = redos.pop();
      if (e) undos.push(e);
      return e ?? null;
    },
    clear() { undos = []; redos = []; },
    canUndo: () => undos.length > 0,
    canRedo: () => redos.length > 0,
    size: () => undos.length,
  };
}
